/**
 * variableModal.js — modal for creating/editing variables (global or page-scoped)
 */
import { addTrackedListener } from './utils.js';

let _editingPageIndex = null;
let _editingKey = null;
let _onSave = null; // callback(pageIndex, key, value, isEdit)

const MODAL_HTML = `
<div id="variableModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="variableModalTitle">
  <div class="modal-content" style="width:500px;max-width:95vw;">
    <div class="modal-header">
      <h3 id="variableModalTitle">Edit Variable</h3>
      <button type="button" class="close-modal" id="variableModalClose" aria-label="Close">×</button>
    </div>
    <div class="input-group">
      <label for="variableKey">Name</label>
      <input type="text" id="variableKey" autocomplete="off" />
    </div>
    <div class="input-group">
      <label><input type="radio" name="variableType" value="value" id="variableTypeValue" checked /> Literal Value</label>
      <input type="text" id="variableValue" placeholder="e.g. 42 or 'text' or true" />
    </div>
    <div class="input-group">
      <label><input type="radio" name="variableType" value="eval" id="variableTypeEval" /> Expression (Eval)</label>
      <input type="text" id="variableEval" placeholder="e.g. Math.floor(atk * 1.5)" disabled />
    </div>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <div class="input-group" style="flex:1;margin-bottom:0;">
        <label for="variableMin">Min</label>
        <input type="number" id="variableMin" placeholder="optional" />
      </div>
      <div class="input-group" style="flex:1;margin-bottom:0;">
        <label for="variableMax">Max</label>
        <input type="number" id="variableMax" placeholder="optional" />
      </div>
    </div>
    <div id="variableError" style="color:#ff4e4e;font-size:0.9em;display:none;margin:8px 0 0;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button type="button" class="btn-small" id="saveVariableBtn">Save</button>
      <button type="button" class="btn-small btn-danger" id="cancelVariableBtn">Cancel</button>
    </div>
  </div>
</div>`;

function ensureInDom() {
  return new Promise(resolve => {
    if (document.getElementById('variableModal')) { resolve(); return; }
    document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
    setTimeout(() => {
      const valueRadio = document.getElementById('variableTypeValue');
      const evalRadio  = document.getElementById('variableTypeEval');
      const valueInput = document.getElementById('variableValue');
      const evalInput  = document.getElementById('variableEval');
      addTrackedListener(valueRadio, 'change', () => { valueInput.disabled = false; evalInput.disabled = true; });
      addTrackedListener(evalRadio,  'change', () => { valueInput.disabled = true;  evalInput.disabled = false; });
      addTrackedListener(document.getElementById('variableModalClose'), 'click', close);
      addTrackedListener(document.getElementById('cancelVariableBtn'), 'click', close);
      addTrackedListener(document.getElementById('saveVariableBtn'), 'click', _handleSave);
      resolve();
    }, 0);
  });
}

function _showError(msg) {
  const el = document.getElementById('variableError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function _clearError() {
  const el = document.getElementById('variableError');
  if (el) el.style.display = 'none';
}

function close() {
  const modal = document.getElementById('variableModal');
  if (modal) modal.style.display = 'none';
  _editingPageIndex = null;
  _editingKey = null;
  _onSave = null;
}

function _handleSave() {
  _clearError();
  const key      = document.getElementById('variableKey').value.trim();
  const isValue  = document.getElementById('variableTypeValue').checked;
  const valueRaw = document.getElementById('variableValue').value.trim();
  const evalRaw  = document.getElementById('variableEval').value.trim();
  const minRaw   = document.getElementById('variableMin').value.trim();
  const maxRaw   = document.getElementById('variableMax').value.trim();

  if (!key) { _showError('Variable name is required.'); return; }

  const value = {};
  if (isValue) {
    if (!valueRaw) { _showError('Value is required.'); return; }
    try { value.value = JSON.parse(valueRaw); } catch { value.value = valueRaw; }
  } else {
    if (!evalRaw) { _showError('Expression is required.'); return; }
    value.eval = evalRaw;
  }
  if (minRaw !== '') {
    const m = Number(minRaw);
    if (!Number.isFinite(m)) { _showError('Min must be a number.'); return; }
    value.min = m;
  }
  if (maxRaw !== '') {
    const M = Number(maxRaw);
    if (!Number.isFinite(M)) { _showError('Max must be a number.'); return; }
    value.max = M;
  }

  if (_onSave) _onSave(_editingPageIndex, key, value);
  close();
}

/**
 * Open the variable modal.
 * @param {string|number} pageIndex — 'global' or page index
 * @param {string} key
 * @param {*} existingValue — current value object or undefined for new
 * @param {Function} onSave — callback(pageIndex, key, value)
 */
export async function openVariableModal(pageIndex, key = '', existingValue = undefined, onSave) {
  await ensureInDom();
  _editingPageIndex = pageIndex;
  _editingKey = key;
  _onSave = onSave;
  _clearError();

  const isEdit = key !== '';
  document.getElementById('variableModalTitle').textContent = isEdit ? 'Edit Variable' : 'Add Variable';

  const keyInput   = document.getElementById('variableKey');
  const valueRadio = document.getElementById('variableTypeValue');
  const evalRadio  = document.getElementById('variableTypeEval');
  const valueInput = document.getElementById('variableValue');
  const evalInput  = document.getElementById('variableEval');
  const minInput   = document.getElementById('variableMin');
  const maxInput   = document.getElementById('variableMax');

  keyInput.value    = key;
  keyInput.disabled = isEdit;
  valueInput.value  = '';
  evalInput.value   = '';
  minInput.value    = '';
  maxInput.value    = '';

  if (existingValue !== undefined && typeof existingValue === 'object' && existingValue !== null) {
    if ('value' in existingValue) {
      valueRadio.checked = true; evalRadio.checked = false;
      valueInput.disabled = false; evalInput.disabled = true;
      valueInput.value = typeof existingValue.value === 'string' ? existingValue.value : JSON.stringify(existingValue.value);
    } else if ('eval' in existingValue) {
      evalRadio.checked = true; valueRadio.checked = false;
      evalInput.disabled = false; valueInput.disabled = true;
      evalInput.value = existingValue.eval ?? '';
    }
    if (existingValue.min !== undefined && existingValue.min !== null) minInput.value = existingValue.min;
    if (existingValue.max !== undefined && existingValue.max !== null) maxInput.value = existingValue.max;
  } else {
    valueRadio.checked = true; evalRadio.checked = false;
    valueInput.disabled = false; evalInput.disabled = true;
    if (existingValue !== undefined && existingValue !== null) valueInput.value = String(existingValue);
  }

  document.getElementById('variableModal').style.display = 'flex';
  keyInput.focus();
}
