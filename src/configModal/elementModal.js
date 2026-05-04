/**
 * elementModal.js — modal for creating/editing layout elements
 * Exports openElementModal(element, onSave, opts)
 */
import { addTrackedListener, dedentCommandList } from './utils.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function colorRow(existingColor) {
  const checked = !!existingColor;
  const value   = existingColor || '#c8adff';
  return `
    <div class="input-group">
      <label style="display:flex;align-items:center;gap:6px;">
        <input type="checkbox" id="elem_customColor" ${checked ? 'checked' : ''} />
        Custom Color
      </label>
      <input type="color" id="elem_color" value="${value}" ${checked ? '' : 'disabled'} style="margin-top:4px;width:100%;height:32px;" />
    </div>`;
}

function onUpdateRow(commands, varName = 'variableName', hint = '') {
  return `
    <div class="input-group">
      <label>onupdate (one command per line, optional)</label>
      <textarea id="elem_onupdate" style="min-height:80px;" placeholder="console.log(${varName});">${dedentCommandList(commands || []).join('\n')}</textarea>
      ${hint ? `<small style="color:#888;font-size:0.85em;margin-top:4px;display:block;">${hint}</small>` : ''}
    </div>`;
}

function onClickRow(commands, placeholder = "JustDices.roll('1d20')") {
  return `
    <div class="input-group">
      <label>onclick</label>
      <textarea id="elem_onclick" style="min-height:80px;" placeholder="${placeholder}">${dedentCommandList(commands || []).join('\n')}</textarea>
    </div>`;
}

function buildFields(type, el) {
  const e = el || {};
  switch (type) {
    case 'button': return `
      <div class="input-group"><label>Label</label><input type="text" id="elem_label" value="${e.label || ''}" placeholder="Button Text" /></div>
      <div class="input-group"><label>Tooltip</label><input type="text" id="elem_tooltip" value="${e.tooltip || ''}" placeholder="Displayed on hover" /></div>
      ${colorRow(e.color)}
      ${onClickRow(e.onclick)}
      <div class="input-group">
        <label>onrightclick</label>
        <textarea id="elem_onrightclick" style="min-height:80px;" placeholder="JustDices.roll('1d20')">${dedentCommandList(e.onrightclick || []).join('\n')}</textarea>
      </div>`;

    case 'value': return `
      <div class="input-group"><label>Variable Name</label><input type="text" id="elem_var" value="${e.var || ''}" placeholder="variableName" /></div>
      <div class="input-group"><label>Label</label><input type="text" id="elem_label" value="${e.label || ''}" placeholder="Display Label" /></div>`;

    case 'input': return `
      <div class="input-group"><label>Variable Name</label><input type="text" id="elem_var" value="${e.var || ''}" placeholder="variableName" /></div>
      <div class="input-group"><label>Label</label><input type="text" id="elem_label" value="${e.label || ''}" placeholder="Input Label" /></div>
      <div class="input-group"><label>Placeholder</label><input type="text" id="elem_placeholder" value="${e.placeholder || ''}" /></div>
      ${onUpdateRow(e.onupdate, e.var || 'variableName', 'Debounced 500ms during typing, immediate on blur')}`;

    case 'counter': return `
      <div class="input-group"><label>Variable Name</label><input type="text" id="elem_var" value="${e.var || ''}" placeholder="variableName" /></div>
      <div class="input-group"><label>Label</label><input type="text" id="elem_label" value="${e.label || ''}" placeholder="Counter Label" /></div>
      <div class="input-group"><label>Step (optional)</label><input type="number" id="elem_step" value="${e.step || ''}" placeholder="1" /></div>
      ${colorRow(e.color)}
      ${onUpdateRow(e.onupdate, e.var || 'variableName', 'Debounced 150ms')}`;

    case 'checkbox': return `
      <div class="input-group"><label>Variable Name</label><input type="text" id="elem_var" value="${e.var || ''}" placeholder="variableName" /></div>
      <div class="input-group"><label>Label</label><input type="text" id="elem_label" value="${e.label || ''}" placeholder="Checkbox Label" /></div>
      ${colorRow(e.color)}
      ${onUpdateRow(e.onupdate, e.var || 'variableName', 'Executes immediately when toggled')}`;

    case 'dropdown': {
      const optionsText = (e.options || []).map(opt =>
        typeof opt === 'string' ? opt : `${opt.label || ''} | ${opt.value || ''}`
      ).join('\n');
      return `
        <div class="input-group"><label>Variable Name</label><input type="text" id="elem_var" value="${e.var || ''}" placeholder="variableName" /></div>
        <div class="input-group"><label>Label</label><input type="text" id="elem_label" value="${e.label || ''}" placeholder="Dropdown Label" /></div>
        <div class="input-group">
          <label>Options (one per line)</label>
          <textarea id="elem_options" placeholder="Option 1\nLabel | value">${optionsText}</textarea>
          <small style="color:#888;font-size:0.85em;margin-top:4px;display:block;">Format: "Label" or "Label | value"</small>
        </div>
        ${onUpdateRow(e.onupdate, e.var || 'variableName', 'Executes immediately when selection changes')}`;
    }

    case 'title': return `
      <div class="input-group"><label>Text</label><input type="text" id="elem_text" value="${e.text || ''}" placeholder="Title text (e.g. '{sheetValue}')" /></div>
      ${colorRow(e.color)}`;

    case 'text': return `
      <div class="input-group"><label>Text</label><textarea id="elem_text">${e.text || ''}</textarea></div>`;

    case 'divider': return `<p style="color:#888;">Dividers have no properties.</p>`;

    case 'row': return `<p style="color:#c8adff;">Row is a container. Add elements from the tree.</p>`;

    case 'stack': return `
      <div class="input-group">
        <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="elem_border" ${e.border ? 'checked' : ''} /> Add Border</label>
      </div>
      ${colorRow(e.color)}
      <p style="color:#c8adff;margin-top:12px;">Stack is a container. Add elements from the tree.</p>`;

    case 'matrix': return `
      <div class="input-group"><label>Columns</label><input type="number" id="elem_columns" value="${e.columns || 4}" min="1" max="12" /></div>
      <div class="input-group"><label>Button Size</label><input type="text" id="elem_buttonSize" value="${e.buttonSize || '40px'}" placeholder="40px" /></div>
      <div class="input-group"><label>Gap</label><input type="text" id="elem_gap" value="${e.gap || '4px'}" placeholder="4px" /></div>
      <div class="input-group">
        <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="elem_border" ${e.border ? 'checked' : ''} /> Add Border</label>
      </div>
      ${colorRow(e.color)}
      <p style="color:#c8adff;margin-top:12px;">Add buttons from the tree.</p>`;

    case 'matrixButton': {
      const onclickText  = dedentCommandList(e.onclick || []).join('\n');
      const onrightText  = dedentCommandList(e.onrightclick || []).join('\n');
      return `
        <div class="input-group"><label>Label (optional)</label><input type="text" id="mbtn_label" value="${e.label || ''}" placeholder="Button text" /></div>
        <div class="input-group"><label>Icon (emoji or URL)</label><input type="text" id="mbtn_icon" value="${e.icon || ''}" placeholder="🔥 or https://..." /></div>
        <div class="input-group"><label>Tooltip (optional)</label><input type="text" id="mbtn_tooltip" value="${e.tooltip || ''}" /></div>
        <div class="input-group">
          <label style="display:flex;align-items:center;gap:6px;">
            <input type="checkbox" id="mbtn_hasColor" ${e.color ? 'checked' : ''} /> Custom Color
          </label>
          <input type="color" id="mbtn_color" value="${e.color || '#ffffff'}" ${e.color ? '' : 'disabled'} style="margin-top:4px;width:100%;height:32px;" />
        </div>
        <div class="input-group">
          <label style="display:flex;align-items:center;gap:6px;">
            <input type="checkbox" id="mbtn_hasBorderColor" ${e.borderColor ? 'checked' : ''} /> Custom Border Color
          </label>
          <input type="color" id="mbtn_borderColor" value="${e.borderColor || '#c8adff'}" ${e.borderColor ? '' : 'disabled'} style="margin-top:4px;width:100%;height:32px;" />
        </div>
        <div class="input-group"><label>onclick (one per line)</label><textarea id="mbtn_onclick" style="min-height:70px;">${onclickText}</textarea></div>
        <div class="input-group"><label>onrightclick (one per line, optional)</label><textarea id="mbtn_onrightclick" style="min-height:60px;">${onrightText}</textarea></div>`;
    }

    default: return `<p style="color:#888;">Unknown type: ${type}</p>`;
  }
}

// ── Read element from modal fields ────────────────────────────────────────────

function readFields(type, existingChildren) {
  const g = id => document.getElementById(id);
  const v = id => g(id)?.value || '';
  const checked = id => g(id)?.checked || false;
  const lines = id => v(id).split('\n').filter(l => l.trim());

  const el = { type };

  switch (type) {
    case 'button':
      el.label = v('elem_label');
      const tt = v('elem_tooltip'); if (tt) el.tooltip = tt;
      if (checked('elem_customColor')) el.color = v('elem_color');
      el.onclick = lines('elem_onclick');
      const rc_b = lines('elem_onrightclick'); if (rc_b.length) el.onrightclick = rc_b;
      break;
    case 'value':
      el.var = v('elem_var'); el.label = v('elem_label');
      break;
    case 'input':
      el.var = v('elem_var'); el.label = v('elem_label'); el.placeholder = v('elem_placeholder');
      const ou_i = lines('elem_onupdate'); if (ou_i.length) el.onupdate = ou_i;
      break;
    case 'counter':
      el.var = v('elem_var'); el.label = v('elem_label');
      const s = v('elem_step'); if (s) el.step = parseInt(s);
      if (checked('elem_customColor')) el.color = v('elem_color');
      const ou_c = lines('elem_onupdate'); if (ou_c.length) el.onupdate = ou_c;
      break;
    case 'checkbox':
      el.var = v('elem_var'); el.label = v('elem_label');
      if (checked('elem_customColor')) el.color = v('elem_color');
      const ou_cb = lines('elem_onupdate'); if (ou_cb.length) el.onupdate = ou_cb;
      break;
    case 'dropdown':
      el.var = v('elem_var'); el.label = v('elem_label');
      el.options = v('elem_options').split('\n').filter(o => o.trim()).map(line =>
        line.includes(' | ')
          ? { label: line.split(' | ')[0].trim(), value: line.split(' | ')[1].trim() }
          : line.trim()
      );
      const ou_dd = lines('elem_onupdate'); if (ou_dd.length) el.onupdate = ou_dd;
      break;
    case 'title':
      el.text = v('elem_text');
      if (checked('elem_customColor')) el.color = v('elem_color');
      break;
    case 'text':
      el.text = v('elem_text');
      break;
    case 'row':
    case 'stack':
      el.children = existingChildren || [];
      if (type === 'stack' && checked('elem_border')) el.border = true;
      if (checked('elem_customColor')) el.color = v('elem_color');
      break;
    case 'matrix':
      el.columns = parseInt(v('elem_columns') || '4');
      el.buttonSize = v('elem_buttonSize') || '40px';
      el.gap = v('elem_gap') || '4px';
      if (checked('elem_border')) el.border = true;
      if (checked('elem_customColor')) el.color = v('elem_color');
      el.buttons = existingChildren || [];
      break;
    case 'matrixButton':
      el.label   = v('mbtn_label');
      el.icon    = v('mbtn_icon');
      el.tooltip = v('mbtn_tooltip');
      if (checked('mbtn_hasColor'))       el.color       = v('mbtn_color');
      if (checked('mbtn_hasBorderColor')) el.borderColor = v('mbtn_borderColor');
      el.onclick = lines('mbtn_onclick');
      const rc = lines('mbtn_onrightclick'); if (rc.length) el.onrightclick = rc;
      break;
  }
  return el;
}

// ── Modal bootstrap ───────────────────────────────────────────────────────────

let _onSave = null;
let _existingChildren = null;

function _wireColorToggle(checkboxId, colorId) {
  const cb = document.getElementById(checkboxId);
  const ci = document.getElementById(colorId);
  if (cb && ci) addTrackedListener(cb, 'change', e => { ci.disabled = !e.target.checked; });
}

function _renderFields() {
  const type = document.getElementById('elementType').value;
  document.getElementById('elementFields').innerHTML = buildFields(type, null);
  _wireColorToggle('elem_customColor', 'elem_color');
  _wireColorToggle('mbtn_hasColor', 'mbtn_color');
  _wireColorToggle('mbtn_hasBorderColor', 'mbtn_borderColor');
}

export function openElementModal({ type = 'button', element = null, title = 'Add Element', saveLabel = 'Add Element', onSave, lockType = false }) {
  _onSave = onSave;
  _existingChildren = element?.children || element?.buttons || null;

  const modal = document.getElementById('elementModal');
  const typeSelect = document.getElementById('elementType');
  typeSelect.value = type;
  typeSelect.disabled = lockType;
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('saveElementBtn').textContent = saveLabel;

  // Render fields from existing element
  document.getElementById('elementFields').innerHTML = buildFields(type, element);
  _wireColorToggle('elem_customColor', 'elem_color');
  _wireColorToggle('mbtn_hasColor', 'mbtn_color');
  _wireColorToggle('mbtn_hasBorderColor', 'mbtn_borderColor');

  // Re-render when type changes (only when not locked)
  if (!lockType) {
    typeSelect.onchange = () => {
      _existingChildren = null;
      document.getElementById('elementFields').innerHTML = buildFields(typeSelect.value, null);
      _wireColorToggle('elem_customColor', 'elem_color');
      _wireColorToggle('mbtn_hasColor', 'mbtn_color');
      _wireColorToggle('mbtn_hasBorderColor', 'mbtn_borderColor');
    };
  }

  modal.classList.add('active');
}

export function closeElementModal() {
  document.getElementById('elementModal').classList.remove('active');
  document.getElementById('elementType').disabled = false;
  _onSave = null;
  _existingChildren = null;
}

export function saveElement() {
  const type = document.getElementById('elementType').value;
  const el = readFields(type, _existingChildren);
  if (_onSave) _onSave(el);
  closeElementModal();
}
