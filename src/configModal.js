/**
 * configModal.js — point d'entrée principal du modal de configuration
 *
 * Responsabilités :
 *   - Bootstrap OBR.onReady
 *   - Orchestration des onglets
 *   - Save / Cancel
 *   - Sync JSON <=> éditeur visuel
 *
 * La logique détaillée est dans src/configModal/ :
 *   utils.js | variableModal.js | elementModal.js | treeEditor.js |
 *   debugMode.js | tokenHelper.js
 */

import OBR from "@owlbear-rodeo/sdk";
import { MODAL_LABEL, loadConfig, saveConfigToLocalStorage } from "./config.js";
import { createDebugLogger } from "./debugMode.js";
import { loadConfigFile } from "./yamlLoader.js";

import {
  addTrackedListener,
  cleanupAllListeners,
  getConfigFormat,
  formatConfig,
  parseConfig,
} from "./configModal/utils.js";

import {
  initEditor,
  rerenderEditor,
  buildConfigFromEditor,
} from "./configModal/treeEditor.js";

import { closeElementModal, saveElement } from "./configModal/elementModal.js";
import { initDebugModeUI } from "./configModal/debugMode.js";
import { initTokenHelperUI, refresh as refreshTokenHelper } from "./configModal/tokenHelper.js";
import { initGoogleSheetsUI, saveGoogleSheetsInputs, validateGoogleSheets } from "./configModal/googleSheets.js";

const logger = createDebugLogger('configModal');

// ── State ─────────────────────────────────────────────────────────────────────

let currentConfig = null;
let currentTab = 'editor';

// ── Tab management ────────────────────────────────────────────────────────────

function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `${tabName}-tab`));
  if (tabName === 'json')   _syncEditorToJson();
  if (tabName === 'tokens') refreshTokenHelper();
}

// ── JSON <=> Editor sync ──────────────────────────────────────────────────────

function _syncEditorToJson() {
  try {
    const config = buildConfigFromEditor();
    const format = getConfigFormat();
    document.getElementById('cfgArea').value = formatConfig(config, format);
  } catch (e) {
    logger.error('Error exporting config:', e);
    alert('Error exporting config: ' + e.message);
  }
}

function _syncJsonToEditor() {
  try {
    const text   = document.getElementById('cfgArea').value;
    const format = getConfigFormat();
    const parsed = parseConfig(text, format);

    if (!parsed.global) parsed.global = { title: 'Macro Hero', width: 600, height: 600, variables: {} };
    if (!Array.isArray(parsed.pages)) parsed.pages = [];
    parsed.pages = parsed.pages.map(p => {
      if (!p) return { label: 'Page', variables: {}, layout: [] };
      if (!p.variables || Array.isArray(p.variables)) p.variables = {};
      if (!Array.isArray(p.layout)) p.layout = [];
      return p;
    });

    currentConfig = parsed;
    rerenderEditor(parsed);
    alert(`Synced from ${format.toUpperCase()} to visual editor`);
  } catch (e) {
    alert(`Invalid ${format.toUpperCase()}: ` + e.message);
  }
}

function _switchConfigFormat() {
  try {
    const format = getConfigFormat();
    const label  = document.getElementById('cfgLabel');
    if (label) label.textContent = format === 'json' ? 'Raw JSON Configuration' : 'Raw YAML Configuration';
    const cfgArea = document.getElementById('cfgArea');
    const text    = cfgArea.value.trim();
    if (!text) return;
    let config;
    try { config = JSON.parse(text); } catch { config = null; }
    if (!config) {
      // Let it fail silently — YAML requires dynamic import which is async
      return;
    }
    cfgArea.value = formatConfig(config, format);
  } catch { /* silent */ }
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
    currentConfig = defaultConfig;

    // Sync to JSON tab
    const format = getConfigFormat();
    document.getElementById('cfgArea').value = formatConfig(defaultConfig, format);

    // Sync to Editor tab
    rerenderEditor(defaultConfig);

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

  initGoogleSheetsUI();

  loadConfig().then(cfg => {
    currentConfig = cfg;

    initEditor(cfg, updatedCfg => { currentConfig = updatedCfg; });

    document.getElementById('cfgArea').value = JSON.stringify(cfg, null, 2);

    document.querySelectorAll('.tab').forEach(tab => {
      addTrackedListener(tab, 'click', e => { e.preventDefault(); switchTab(tab.dataset.tab); });
    });

    document.getElementById('syncFromJson').onclick = _syncJsonToEditor;
    document.querySelectorAll('input[name="cfgFormat"]').forEach(r => {
      addTrackedListener(r, 'change', _switchConfigFormat);
    });

    document.getElementById('saveBtn').onclick = async () => {
      logger.log('Save clicked');
      try {
        let config;
        if (currentTab === 'json') {
          config = parseConfig(document.getElementById('cfgArea').value, getConfigFormat());
        } else {
          config = buildConfigFromEditor();
        }

        const gsErrEl = document.getElementById('gsheetsError');
        if (gsErrEl) gsErrEl.style.display = 'none';

        const gsError = validateGoogleSheets(config);
        if (gsError) {
          if (gsErrEl) { gsErrEl.textContent = gsError; gsErrEl.style.display = 'block'; }
          switchTab('integrations');
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

    // Expose for HTML onclick attributes
    window.saveElement       = saveElement;
    window.closeElementModal = closeElementModal;

    initDebugModeUI();
    initTokenHelperUI();
    refreshTokenHelper().catch(() => {});

    switchTab(currentTab);
  }).catch(err => {
    logger.error('Error loading config in modal:', err);
  });
});
