/**
 * configModal.js — point d'entrée principal du modal de configuration
 *
 * Responsabilités :
 *   - Bootstrap OBR.onReady
 *   - Orchestration des onglets
 *   - Save / Cancel
 *   - Sync JSON <=> Puck builder
 *
 * La logique détaillée est dans src/configModal/ :
 *   utils.js | puckBuilder.jsx | rawJsonEditor.js |
 *   debugMode.js | tokenHelper.js
 */

import OBR from "@owlbear-rodeo/sdk";
import { MODAL_LABEL, loadConfig, saveConfigToLocalStorage } from "./config.js";
import { normalizeConfig, prepareConfigForSave } from "./configSchema.js";
import { createDebugLogger } from "./debugMode.js";
import { loadConfigFile } from "./configLoader.js";

import {
  addTrackedListener,
  cleanupAllListeners,
  formatConfig,
  parseConfig,
} from "./configModal/utils.js";
import { formatValidationErrors, validateConfigShape } from "./configValidation.js";

import { initDebugModeUI } from "./configModal/debugMode.js";
import { initTokenHelperUI, refresh as refreshTokenHelper } from "./configModal/tokenHelper.js";
import { initGoogleSheetsUI, saveGoogleSheetsInputs, validateGoogleSheets } from "./configModal/googleSheets.js";

const logger = createDebugLogger('configModal');

// ── State ─────────────────────────────────────────────────────────────────────

let currentConfig = null;
let currentTab = 'editor';
let rawJsonEditorModule = null;
let rawJsonEditorPromise = null;
let puckBuilderModule = null;
let puckBuilderPromise = null;
let themeUnsubscribe = null;

// ── Owlbear theme sync ───────────────────────────────────────────────────────

function _applyOwlbearTheme(theme) {
  const isLight = theme?.mode === 'LIGHT';
  const root = document.documentElement;
  const rawEditorHost = document.getElementById('jsonEditorHost');

  root.classList.toggle('mh-light', isLight);
  root.classList.toggle('mh-dark', !isLight);
  rawEditorHost?.classList.toggle('jse-theme-dark', !isLight);

  if (theme?.primary) {
    const accent = isLight
      ? (theme.primary.main || '#7c3aed')
      : (theme.primary.light || theme.primary.main || '#c8adff');
    const accentDim = isLight
      ? (theme.primary.dark || theme.primary.main || '#6d28d9')
      : (theme.primary.main || theme.primary.light || '#a78bfa');

    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-dim', accentDim);
  }

  logger.log(`Applied Owlbear ${isLight ? 'light' : 'dark'} theme`);
}

async function _initThemeSync() {
  try {
    _applyOwlbearTheme(await OBR.theme.getTheme());
    themeUnsubscribe?.();
    themeUnsubscribe = OBR.theme.onChange(_applyOwlbearTheme);
  } catch (error) {
    logger.warn('Theme API unavailable; keeping the default dark theme:', error);
  }
}

// ── Tab management ────────────────────────────────────────────────────────────

async function switchTab(tabName) {
  try {
    await _captureCurrentTabState();
  } catch (e) {
    logger.error('Error syncing current tab:', e);
    alert('Cannot switch tab yet: ' + e.message);
    return;
  }

  currentTab = tabName;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `${tabName}-tab`));

  if (tabName === 'editor') {
    await _mountBuilder();
  }
  if (tabName === 'json') {
    _syncEditorToJson();
    try {
      const rawJsonEditor = await _loadRawJsonEditor();
      rawJsonEditor.ensureRawJsonEditor();
      rawJsonEditor.syncRawJsonEditorFromTextarea();
      _setRawEditorFallback(false);
    } catch (e) {
      logger.warn('Enhanced JSON editor unavailable; using plain text mode:', e);
      _setRawEditorFallback(true, e?.message);
    }
  }
  if (tabName === 'tokens') refreshTokenHelper();
}

async function _captureCurrentTabState() {
  if (!currentConfig) return;
  if (currentTab === 'json') {
    currentConfig = await _parseRawConfig({ validateShape: false });
  }
}

// ── JSON <=> Builder sync ─────────────────────────────────────────────────────

function _syncEditorToJson() {
  try {
    _setRawJsonText(formatConfig(prepareConfigForSave(currentConfig)));
  } catch (e) {
    logger.error('Error exporting config:', e);
    alert('Error exporting config: ' + e.message);
  }
}

async function _syncJsonToEditor() {
  try {
    const parsed = await _parseRawConfig();

    if (!parsed.global) parsed.global = { title: 'Macro Hero', width: 600, height: 600, variables: {} };
    if (!Array.isArray(parsed.pages)) parsed.pages = [];
    parsed.pages = parsed.pages.map(p => {
      if (!p) return { label: 'Page', variables: {}, layout: [] };
      if (!p.variables || Array.isArray(p.variables)) p.variables = {};
      if (!Array.isArray(p.layout)) p.layout = [];
      return p;
    });

    currentConfig = parsed;
    if (puckBuilderModule) {
      puckBuilderModule.refreshPuckBuilder({ getConfig: () => currentConfig, setConfig: _setConfigFromBuilder });
    }
    alert('Synced from JSON to Builder');
  } catch (e) {
    alert('Invalid JSON: ' + e.message);
  }
}

async function _parseRawConfig({ validateShape = true } = {}) {
  const text = rawJsonEditorModule
    ? rawJsonEditorModule.getRawJsonText()
    : document.getElementById('cfgArea')?.value || '';
  const parsed = normalizeConfig(parseConfig(text));
  if (validateShape) {
    const validation = validateConfigShape(prepareConfigForSave(parsed));
    if (!validation.valid) {
      throw new Error(formatValidationErrors(validation.errors));
    }
  }
  return parsed;
}

async function _mountBuilder() {
  if (!currentConfig) {
    _showBuilderStatus('Loading Builder...', 'Waiting for the saved configuration.');
    return;
  }

  try {
    _showBuilderStatus('Loading Builder...', 'Loading Puck and preparing the page editor.');
    const puckBuilder = await _loadPuckBuilder();
    puckBuilder.mountPuckBuilder({
      target: document.getElementById('puckBuilderHost'),
      getConfig: () => currentConfig,
      setConfig: _setConfigFromBuilder,
    });
  } catch (e) {
    logger.error('Puck builder mount failed:', e);
    _showBuilderStatus('Builder failed to load.', e?.message || String(e), true, true);
  }
}

function _setConfigFromBuilder(config) {
  currentConfig = normalizeConfig(config);
}

function _setRawJsonText(text) {
  const textarea = document.getElementById('cfgArea');
  if (textarea) textarea.value = text;
  if (rawJsonEditorModule) {
    rawJsonEditorModule.setRawJsonValue(text);
  }
}

async function _loadRawJsonEditor() {
  if (!rawJsonEditorPromise) {
    rawJsonEditorPromise = import("./configModal/rawJsonEditor.js")
      .then(module => {
        rawJsonEditorModule = module;
        return module;
      })
      .catch(error => {
        rawJsonEditorPromise = null;
        throw error;
      });
  }
  return rawJsonEditorPromise;
}

async function _prepareRawJsonEditor() {
  try {
    await _loadRawJsonEditor();
  } catch (error) {
    logger.warn('JSON editor preload failed; plain text mode remains available:', error);
  }
}

function _setRawEditorFallback(enabled, detail = '') {
  const textarea = document.getElementById('cfgArea');
  const host = document.getElementById('jsonEditorHost');
  const status = document.getElementById('jsonEditorStatus');

  textarea?.classList.toggle('raw-config-source-fallback', enabled);
  host?.classList.toggle('is-unavailable', enabled);

  if (enabled && status) {
    status.textContent = detail
      ? `Plain text mode. Enhanced editor unavailable: ${detail}`
      : 'Plain text mode.';
    status.className = 'json-editor-status error';
  } else if (status?.textContent?.startsWith('Plain text mode.')) {
    status.textContent = '';
    status.className = 'json-editor-status';
  }
}

async function _loadPuckBuilder() {
  if (!puckBuilderPromise) {
    puckBuilderPromise = import("./configModal/puckBuilder.jsx")
      .then(module => {
        puckBuilderModule = module;
        return module;
      });
  }
  return puckBuilderPromise;
}

function _showBuilderStatus(title, detail = '', isError = false, force = false) {
  const host = document.getElementById('puckBuilderHost');
  if (!host || (puckBuilderModule && !force)) return;

  host.replaceChildren();
  const box = document.createElement('div');
  box.className = `puck-empty-state${isError ? ' error' : ''}`;

  const heading = document.createElement('strong');
  heading.textContent = title;
  box.appendChild(heading);

  if (detail) {
    const small = document.createElement('small');
    small.textContent = detail;
    box.appendChild(small);
  }

  host.appendChild(box);
}

// ── Load Default Config ────────────────────────────────────────────────────────

async function _loadDefaultConfig() {
  try {
    logger.log('Loading default config...');
    const defaultConfig = await loadConfigFile('/default');
    
    if (!defaultConfig) {
      alert('Default config not found');
      return;
    }

    // Confirm before overwriting
    if (!confirm('Load default configuration? Your current changes will be replaced.')) {
      return;
    }

    // Update internal state
    currentConfig = normalizeConfig(defaultConfig);

    // Sync to JSON tab
    _setRawJsonText(formatConfig(prepareConfigForSave(currentConfig)));

    // Sync to Builder tab
    if (puckBuilderModule) {
      puckBuilderModule.refreshPuckBuilder({ getConfig: () => currentConfig, setConfig: _setConfigFromBuilder });
    }

    logger.log('Default config loaded');
    alert('Default configuration loaded successfully');
  } catch (e) {
    logger.error('Error loading default config:', e);
    alert('Error loading default config: ' + e.message);
  }
}

// ── Save / Cancel ─────────────────────────────────────────────────────────────

async function _closeModal(data) {
  cleanupAllListeners();
  themeUnsubscribe?.();
  themeUnsubscribe = null;
  if (data) {
    const attempts = [
      { opts: { destination: 'ROOM' }, desc: 'ROOM' },
      { opts: { destination: 'ALL' },  desc: 'ALL'  },
      { opts: undefined,               desc: 'default' }
    ];
    let sent = false;
    for (const { opts, desc } of attempts) {
      try {
        if (opts) await OBR.broadcast.sendMessage('macrohero.config.result', data, opts);
        else      await OBR.broadcast.sendMessage('macrohero.config.result', data);
        logger.log(`broadcast succeeded (${desc})`);
        sent = true;
        break;
      } catch (err) {
        logger.warn(`broadcast failed (${desc}):`, err);
      }
    }
    if (!sent) logger.error('All broadcast attempts failed');
  }
  try { await OBR.modal.close(MODAL_LABEL); } catch (err) { logger.warn('modal.close failed:', err); }
}



// ── Bootstrap ─────────────────────────────────────────────────────────────────

OBR.onReady(() => {
  logger.log('=== Config Modal Ready ===');
  _showBuilderStatus('Loading Builder...', 'Loading configuration.');

  initGoogleSheetsUI();

  Promise.all([_initThemeSync(), loadConfig()]).then(([, cfg]) => {
    currentConfig = cfg;

    _setRawJsonText(JSON.stringify(prepareConfigForSave(cfg), null, 2));
    document.querySelectorAll('.tab').forEach(tab => {
      addTrackedListener(tab, 'click', e => { e.preventDefault(); switchTab(tab.dataset.tab).catch(err => logger.error('Tab switch failed:', err)); });
    });

    document.getElementById('syncFromJson').onclick = () => _syncJsonToEditor().catch(err => {
      logger.error('JSON sync failed:', err);
      alert('Invalid JSON: ' + err.message);
    });
    document.getElementById('saveBtn').onclick = async () => {
      logger.log('Save clicked');
      try {
        let config;
        if (currentTab === 'json') {
          config = await _parseRawConfig();
        } else {
          config = currentConfig;
        }

        const gsErrEl = document.getElementById('gsheetsError');
        if (gsErrEl) gsErrEl.style.display = 'none';

        const gsError = validateGoogleSheets(config);
        if (gsError) {
          if (gsErrEl) { gsErrEl.textContent = gsError; gsErrEl.style.display = 'block'; }
          await switchTab('integrations');
          throw new Error(gsError);
        }

        saveGoogleSheetsInputs();
        await saveConfigToLocalStorage(config);
        logger.log('Config saved to localStorage');
        await _closeModal({ savedFromModal: true, gsheetUpdated: true });
      } catch (e) {
        logger.error('Save error:', e);
        alert('Error: ' + e.message);
      }
    };

    document.getElementById('loadDefaultBtn').onclick = _loadDefaultConfig;

    document.getElementById('cancelBtn').onclick = () => _closeModal();

    initDebugModeUI();
    initTokenHelperUI();
    refreshTokenHelper().catch(() => {});

    switchTab(currentTab)
      .then(() => {
        // Warm the editor after the Builder has mounted so the first tab switch
        // is instant without competing with the initial builder bundle.
        const preload = () => void _prepareRawJsonEditor();
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(preload, { timeout: 1500 });
        } else {
          window.setTimeout(preload, 250);
        }
      })
      .catch(err => logger.error('Initial tab switch failed:', err));
  }).catch(err => {
    logger.error('Error loading config in modal:', err);
    _showBuilderStatus('Configuration failed to load.', err?.message || String(err), true);
  });
});
