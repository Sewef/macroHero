/**
 * debugMode.js — UI for managing debug mode modules
 */
import { addTrackedListener } from './utils.js';
import { ASYNC_INTEGRATION_NAMES } from '../constants.js';
import OBR from "@owlbear-rodeo/sdk";

const DEBUG_MODULES_BY_CATEGORY = {
  'Core Modules': ['executor', 'expressionEvaluator', 'expressionHelpers', 'ui', 'storage', 'parser', 'main', 'config', 'configModal'],
  'Engine Modules': ['VariableEngine', 'ExecutionSandbox', 'VariableStore'],
  'Event System': ['EventBus'],
  'Shared Utilities': ['sdkHelpers'],
  'Command Modules': ['playerMetadata', 'sceneMetadata', 'tokenMetadata', 'tokenAttachments', 'sceneHelpers', 'tokenHelpers'],
  'Integration Modules': ['Local', 'Manager', ...ASYNC_INTEGRATION_NAMES]
};

function loadDebugModes() {
  try {
    const s = localStorage.getItem('macroHero_debugMode');
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

function saveDebugModes(modes) {
  try { localStorage.setItem('macroHero_debugMode', JSON.stringify(modes)); } catch { /* ignore */ }
}

async function broadcastDebugModes(modes) {
  try {
    await OBR.broadcast.sendMessage('macrohero.debug.modes', modes, { destination: 'LOCAL' });
  } catch { /* ignore */ }
}

const ALL_MODULES = Object.values(DEBUG_MODULES_BY_CATEGORY).flat();

function _updateToggleAllBtn() {
  const btn = document.getElementById('debugToggleAllBtn');
  if (!btn) return;
  const modes = loadDebugModes();
  const allOn = ALL_MODULES.every(m => modes[m]);
  btn.textContent = allOn ? 'Disable All' : 'Enable All';
}

export function initDebugModeUI() {
  const container = document.getElementById('debugModulesContainer');
  if (!container) return;
  const modes = loadDebugModes();
  container.innerHTML = '';

  const toggleAllBtn = document.getElementById('debugToggleAllBtn');
  if (toggleAllBtn) {
    toggleAllBtn.onclick = async () => {
      const current = loadDebugModes();
      const allOn = ALL_MODULES.every(m => current[m]);
      const updated = {};
      ALL_MODULES.forEach(m => { updated[m] = !allOn; });
      saveDebugModes(updated);
      await broadcastDebugModes(updated);
      initDebugModeUI();
    };
  }

  Object.entries(DEBUG_MODULES_BY_CATEGORY).forEach(([catName, modules]) => {
    const allEnabled  = modules.every(m => modes[m]);
    const someEnabled = modules.some(m => modes[m]);

    const catDiv = document.createElement('div');
    catDiv.className = 'debug-category';

    const header = document.createElement('div');
    header.className = 'debug-category-header';

    const catCb = document.createElement('input');
    catCb.type  = 'checkbox';
    catCb.className = 'debug-category-checkbox';
    catCb.id    = `debug-cat-${catName}`;
    catCb.checked = allEnabled;
    catCb.indeterminate = someEnabled && !allEnabled;

    const catLabel = document.createElement('label');
    catLabel.className  = 'debug-category-title';
    catLabel.htmlFor    = catCb.id;
    catLabel.textContent = catName;

    header.appendChild(catCb);
    header.appendChild(catLabel);
    addTrackedListener(header, 'click', e => {
      if (e.target === catCb) return;
      catCb.checked = !catCb.checked;
      catCb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    addTrackedListener(catCb, 'change', async () => {
      const updated = loadDebugModes();
      modules.forEach(m => { updated[m] = catCb.checked; });
      saveDebugModes(updated);
      await broadcastDebugModes(updated);
      modules.forEach(m => {
        const cb = document.getElementById(`debug-mod-${m}`);
        if (cb) cb.checked = catCb.checked;
      });
      catCb.indeterminate = false;
      _updateToggleAllBtn();
    });

    const modContainer = document.createElement('div');
    modContainer.className = 'debug-category-modules';

    modules.forEach(modName => {
      const item = document.createElement('div');
      item.className = 'debug-module-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id   = `debug-mod-${modName}`;
      cb.className = 'debug-checkbox';
      cb.checked = !!modes[modName];

      const lbl = document.createElement('label');
      lbl.className = 'debug-module-label';
      lbl.htmlFor   = cb.id;
      lbl.textContent = modName;

      item.appendChild(cb);
      item.appendChild(lbl);

      addTrackedListener(item, 'click', async e => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
      addTrackedListener(cb, 'change', async () => {
        const updated = loadDebugModes();
        updated[modName] = cb.checked;
        saveDebugModes(updated);
        await broadcastDebugModes(updated);
        const all  = modules.every(m => loadDebugModes()[m]);
        const some = modules.some(m => loadDebugModes()[m]);
        catCb.checked = all;
        catCb.indeterminate = some && !all;
        _updateToggleAllBtn();
      });

      modContainer.appendChild(item);
    });

    catDiv.appendChild(header);
    catDiv.appendChild(modContainer);
    container.appendChild(catDiv);
  });

  _updateToggleAllBtn();
}
