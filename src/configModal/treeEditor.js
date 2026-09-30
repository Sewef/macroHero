/**
 * Visual page builder for MacroHero configs.
 *
 * This editor intentionally edits the canonical v2 shape:
 * - state: mutable persisted inputs
 * - computed: derived expressions
 * - layout: UI components
 *
 * `variables` is rebuilt from state/computed for runtime compatibility.
 */

import { addTrackedListener, dedentCommandList } from './utils.js';
import { buildVariablesFromStateComputed } from '../configSchema.js';
import { deepClone } from '../utils.js';

let _config = null;
let _selectedPageIndex = null;
let _onConfigChange = null;
let _selection = { kind: 'page' };
const _collapsedBuilderPaths = new Set();
let _tooltipsInstalled = false;
let _tooltipEl = null;

const MUTABLE_BIND_TYPES = new Set(['input', 'counter', 'checkbox', 'toggle', 'dropdown']);
const READ_BIND_TYPES = new Set(['value']);
const CONTAINER_TYPES = new Set(['row', 'stack', 'matrix']);

export function initEditor(config, onChange) {
  _config = config;
  _onConfigChange = onChange;
  _ensureConfigShape();
  _installTooltips();

  const addPageBtn = document.getElementById('addPageBtn');
  if (addPageBtn) addPageBtn.onclick = _addPage;

  const addGlobalVarBtn = document.getElementById('addGlobalVariableBtn');
  if (addGlobalVarBtn) addGlobalVarBtn.onclick = () => _selectVariable('global', 'state', null);

  renderSidebar();
  if (_config.pages?.length) {
    _selectPage(0);
  }
}

export function rerenderEditor(config) {
  _config = config;
  _ensureConfigShape();
  renderSidebar();
  if (_selectedPageIndex !== null && _config.pages?.[_selectedPageIndex]) {
    renderPagePanel(_selectedPageIndex);
  } else if (_config.pages?.length) {
    _selectPage(0);
  } else {
    _selectedPageIndex = null;
    _selection = { kind: 'page' };
    const container = document.getElementById('pageEditorContainer');
    if (container) container.innerHTML = _emptyState('Select or create a page');
  }
}

export function buildConfigFromEditor() {
  _syncGlobalFields();
  _syncAllRuntimeVariables();
  return {
    schemaVersion: _config.schemaVersion,
    global: deepClone(_config.global || {}),
    pages: deepClone(_config.pages || []),
  };
}

export function renderSidebar() {
  _renderGlobalFields();
  _renderGlobalVariables();
  _renderPageList();
}

function _ensureConfigShape() {
  if (!_config.global) _config.global = {};
  if (!_config.global.state) _config.global.state = {};
  if (!_config.global.computed) _config.global.computed = {};
  _syncRuntimeVariables(_config.global);

  if (!Array.isArray(_config.pages)) _config.pages = [];
  _config.pages.forEach((page, index) => {
    if (!page.id) page.id = _uniquePageId(_slugify(page.label || `page-${index + 1}`));
    if (!page.label) page.label = `Page ${index + 1}`;
    if (!page.state) page.state = {};
    if (!page.computed) page.computed = {};
    if (!Array.isArray(page.layout)) page.layout = [];
    _syncRuntimeVariables(page);
  });
}

function _syncRuntimeVariables(scope) {
  scope.variables = buildVariablesFromStateComputed(scope);
}

function _syncAllRuntimeVariables() {
  _syncRuntimeVariables(_config.global);
  (_config.pages || []).forEach(_syncRuntimeVariables);
}

function _syncGlobalFields() {
  if (!_config.global) _config.global = {};
  _config.global.title = document.getElementById('globalTitle')?.value || 'Macro Hero';
  _config.global.width = parseInt(document.getElementById('globalWidth')?.value) || 600;
  _config.global.height = parseInt(document.getElementById('globalHeight')?.value) || 600;
}

function _renderGlobalFields() {
  const t = document.getElementById('globalTitle');
  const w = document.getElementById('globalWidth');
  const h = document.getElementById('globalHeight');
  if (t) t.value = _config?.global?.title || '';
  if (w) w.value = _config?.global?.width || 600;
  if (h) h.value = _config?.global?.height || 600;
}

function _renderGlobalVariables() {
  const container = document.getElementById('globalVariablesList');
  if (!container) return;
  const scope = _config.global || {};
  container.innerHTML = _renderVariableGroups(scope, 'global', true);
  _attachVariableActions(container, 'global');
}

function _renderPageList() {
  const container = document.getElementById('pagesListSidebar');
  if (!container) return;
  const pages = _config?.pages || [];
  if (pages.length === 0) {
    container.innerHTML = '<div class="tree-empty">No pages</div>';
    return;
  }

  container.innerHTML = pages.map((page, i) => {
    const active = i === _selectedPageIndex ? 'active' : '';
    return `<div class="page-item-sidebar ${active}" data-page-index="${i}">
      <span class="page-item-sidebar-name">${_esc(page.label || `Page ${i + 1}`)}</span>
      <div class="page-item-sidebar-actions">
        <button type="button" class="btn-icon" data-action="movePage" data-dir="-1" data-index="${i}" title="Up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn-icon" data-action="movePage" data-dir="1" data-index="${i}" title="Down" ${i === pages.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="btn-icon btn-danger" data-action="deletePage" data-index="${i}" title="Delete">x</button>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.page-item-sidebar').forEach(item => {
    addTrackedListener(item, 'click', e => {
      if (e.target.closest('.page-item-sidebar-actions')) return;
      _selectPage(parseInt(item.dataset.pageIndex));
    });
  });

  container.querySelectorAll('[data-action]').forEach(btn => {
    addTrackedListener(btn, 'click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      if (btn.dataset.action === 'deletePage') _deletePage(idx);
      if (btn.dataset.action === 'movePage') _movePage(idx, parseInt(btn.dataset.dir));
    });
  });
}

function _selectPage(index) {
  _selectedPageIndex = index;
  _selection = { kind: 'page' };
  _renderPageList();
  renderPagePanel(index);
}

export function renderPagePanel(pageIndex) {
  const container = document.getElementById('pageEditorContainer');
  if (!container) return;
  const page = _config?.pages?.[pageIndex];
  if (!page) {
    container.innerHTML = _emptyState('Invalid page');
    return;
  }

  container.innerHTML = `
    <div class="builder-shell">
      <section class="builder-main">
        <div class="page-panel-header builder-header">
          <div class="input-group page-field">
            <label>Page Label</label>
            <input type="text" id="pageLabelInput" value="${_attr(page.label || '')}" placeholder="Page name" />
          </div>
          <div class="input-group page-field">
            <label>Page ID</label>
            <input type="text" id="pageIdInput" value="${_attr(page.id || '')}" placeholder="stable-page-id" />
          </div>
        </div>

        <div class="page-section variables-panel">
          <div class="page-section-header variables-panel-header">
            <span class="section-title">Page variables</span>
            <div class="variable-panel-actions">
              <button type="button" class="btn-small" data-action="addPageState">+ State</button>
              <button type="button" class="btn-small" data-action="addPageComputed">+ Computed</button>
            </div>
          </div>
          <div class="variable-buckets">
            <section class="variable-bucket">
              <div class="variable-bucket-header">
                <span class="variable-kind">State ${_infoTip('State values are saved data that can be changed by inputs, counters, toggles, dropdowns, or commands.')}</span>
                <span class="variable-count">${Object.keys(page.state || {}).length}</span>
              </div>
              <div id="pageStateList" class="variable-list"></div>
            </section>
            <section class="variable-bucket">
              <div class="variable-bucket-header">
                <span class="variable-kind">Computed ${_infoTip('Computed values are formulas derived from State or other values. They are recalculated and should not be edited directly at runtime.')}</span>
                <span class="variable-count">${Object.keys(page.computed || {}).length}</span>
              </div>
              <div id="pageComputedList" class="variable-list"></div>
            </section>
          </div>
        </div>

        <div class="page-section builder-layout-section">
          <div class="page-section-header">
            <span class="section-title">Layout</span>
            <div class="builder-add-row">
              <button type="button" class="btn-small btn-quiet" data-action="collapseAll">Collapse all</button>
              <button type="button" class="btn-small btn-quiet" data-action="expandAll">Expand all</button>
              <select id="addRootType">${_elementTypeOptions()}</select>
              <button type="button" class="btn-small" data-action="addRootElement">+ Add</button>
            </div>
          </div>
          <div id="pageBuilder" class="page-builder"></div>
        </div>
      </section>
      <aside class="inspector-column">
        <div id="propertyPanel" class="property-panel"></div>
        <div class="page-section preview-panel">
          <div class="page-section-header">
            <span class="section-title">Preview</span>
          </div>
          <div id="pagePreview" class="page-preview"></div>
        </div>
      </aside>
    </div>`;

  addTrackedListener(document.getElementById('pageLabelInput'), 'input', e => {
    page.label = e.target.value;
    _renderPageList();
    _notify();
  });
  addTrackedListener(document.getElementById('pageIdInput'), 'change', e => {
    const nextId = _slugify(e.target.value, page.id || `page-${pageIndex + 1}`);
    page.id = _uniquePageId(nextId, page);
    e.target.value = page.id;
    _notify();
  });

  container.querySelector('[data-action="addPageState"]').onclick = () => _selectVariable(pageIndex, 'state', null);
  container.querySelector('[data-action="addPageComputed"]').onclick = () => _selectVariable(pageIndex, 'computed', null);
  container.querySelector('[data-action="collapseAll"]').onclick = () => _setAllBuilderCollapsed(pageIndex, true);
  container.querySelector('[data-action="expandAll"]').onclick = () => _setAllBuilderCollapsed(pageIndex, false);
  container.querySelector('[data-action="addRootElement"]').onclick = () => {
    const type = document.getElementById('addRootType').value;
    _addElement(pageIndex, null, type);
  };

  _renderPageVariables(pageIndex);
  _renderPreview(pageIndex);
  _renderBuilder(pageIndex);
  _renderPropertyPanel();
}

function _renderPageVariables(pageIndex) {
  const page = _config.pages[pageIndex];
  document.getElementById('pageStateList').innerHTML = _renderVariableList(page, pageIndex, 'state');
  document.getElementById('pageComputedList').innerHTML = _renderVariableList(page, pageIndex, 'computed');
  _attachVariableActions(document.getElementById('pageStateList'), pageIndex);
  _attachVariableActions(document.getElementById('pageComputedList'), pageIndex);
}

function _renderGlobalVariableList(scope, type) {
  return _renderVariableList(scope, 'global', type);
}

function _renderVariableGroups(scope, owner, compact = false) {
  const stateHtml = _renderGlobalVariableList(scope, 'state');
  const computedHtml = _renderGlobalVariableList(scope, 'computed');
  return `
    <div class="variable-group ${compact ? 'compact' : ''}">
      <div class="variable-bucket">
        <div class="variable-bucket-header">
          <span class="variable-kind">${owner === 'global' ? 'Global' : 'Page'} State ${_infoTip('State values are saved data that can be changed by inputs, counters, toggles, dropdowns, or commands.')}</span>
          <button type="button" class="btn-icon btn-add" data-action="addVar" data-kind="state" data-owner="${owner}" title="Add state">+</button>
        </div>
        ${stateHtml}
      </div>
      <div class="variable-bucket">
        <div class="variable-bucket-header">
          <span class="variable-kind">${owner === 'global' ? 'Global' : 'Page'} Computed ${_infoTip('Computed values are formulas derived from State or other values. They are recalculated and should not be edited directly at runtime.')}</span>
          <button type="button" class="btn-icon btn-add" data-action="addVar" data-kind="computed" data-owner="${owner}" title="Add computed">+</button>
        </div>
        ${computedHtml}
      </div>
    </div>`;
}

function _renderVariableList(scope, owner, kind) {
  const entries = Object.entries(scope?.[kind] || {});
  if (entries.length === 0) return '<div class="tree-empty compact-empty">None</div>';
  return entries.map(([name, entry]) => {
    const desc = kind === 'state' ? _stateDesc(entry) : _computedDesc(entry);
    const selected = _selection.kind === 'variable'
      && _selection.owner === owner
      && _selection.varKind === kind
      && _selection.name === name
      ? 'selected'
      : '';
    return `<div class="var-item ${selected}" data-action="selectVar" data-owner="${owner}" data-kind="${kind}" data-name="${_attr(name)}">
      <span class="var-key">${_esc(name)}</span>
      <span class="var-val" title="${_attr(desc)}">${_esc(_truncate(desc, 30))}</span>
      <div class="var-actions">
        <button type="button" class="btn-icon" data-action="selectVar" data-owner="${owner}" data-kind="${kind}" data-name="${_attr(name)}" title="Edit">E</button>
        <button type="button" class="btn-icon btn-danger" data-action="deleteVar" data-owner="${owner}" data-kind="${kind}" data-name="${_attr(name)}" title="Delete">x</button>
      </div>
    </div>`;
  }).join('');
}

function _attachVariableActions(container, fallbackOwner) {
  if (!container) return;
  container.querySelectorAll('[data-action]').forEach(btn => {
    addTrackedListener(btn, 'click', e => {
      e.stopPropagation();
      const owner = btn.dataset.owner === 'global' ? 'global' : fallbackOwner;
      const kind = btn.dataset.kind;
      const name = btn.dataset.name || null;
      if (btn.dataset.action === 'addVar') _selectVariable(owner, kind, null);
      if (btn.dataset.action === 'selectVar') _selectVariable(owner, kind, name);
      if (btn.dataset.action === 'deleteVar') _deleteVariable(owner, kind, name);
    });
  });
}

function _renderBuilder(pageIndex) {
  const builder = document.getElementById('pageBuilder');
  if (!builder) return;
  const layout = _config.pages[pageIndex].layout || [];
  builder.innerHTML = layout.length
    ? layout.map((item, idx) => _renderBlock(item, [idx], pageIndex)).join('')
    : '<div class="builder-empty">No elements yet. Add a block above.</div>';
  _attachBuilderActions(builder, pageIndex);
}

function _renderPreview(pageIndex) {
  const preview = document.getElementById('pagePreview');
  if (!preview) return;
  const layout = _config.pages[pageIndex].layout || [];
  preview.innerHTML = layout.length
    ? layout.map((item, idx) => _renderPreviewNode(item, [idx])).join('')
    : '<div class="preview-empty">No layout yet</div>';
  _attachPreviewActions(preview, pageIndex);
}

function _renderPreviewNode(item, path) {
  const type = (item.type || 'unknown').toLowerCase();
  const pathStr = path.join('.');
  const selected = _selection.kind === 'element' && _samePath(_selection.path, path) ? 'selected' : '';
  const label = _blockLabel(item);
  const children = _getChildren(item) || [];
  const hasChildren = children.length > 0;
  const childMode = type === 'row' ? 'row' : type === 'matrix' ? 'matrix' : 'stack';
  const previewColumns = Math.min(12, Math.max(1, Number(item.columns) || 4));
  const childHtml = hasChildren
    ? `<div class="preview-children preview-children-${childMode} ${type === 'matrix' ? `preview-cols-${previewColumns}` : ''}">
        ${children.map((child, index) => _renderPreviewNode(child, [...path, index])).join('')}
      </div>`
    : '';

  return `<div class="preview-node preview-node-${_attr(type)} ${hasChildren ? 'has-children' : ''}">
    <button type="button" class="preview-box ${selected} badge-${_typeColor(type)}" data-preview-path="${pathStr}" title="${_attr(`${type}: ${label}`)}">
      ${_esc(_previewShortLabel(item))}
    </button>
    ${childHtml}
  </div>`;
}

function _attachPreviewActions(preview, pageIndex) {
  preview.querySelectorAll('[data-preview-path]').forEach(item => {
    addTrackedListener(item, 'click', e => {
      e.preventDefault();
      e.stopPropagation();
      _focusElementPath(pageIndex, item.dataset.previewPath.split('.').map(Number));
    });
  });
}

function _renderBlock(item, path, pageIndex) {
  const type = item.type || 'unknown';
  const pathStr = path.join('.');
  const selected = _selection.kind === 'element' && _samePath(_selection.path, path) ? 'selected' : '';
  const children = _getChildren(item);
  const label = _blockLabel(item);
  const meta = _blockMeta(item);
  const canHaveChildren = _isContainer(item);
  const isCollapsed = canHaveChildren && _isBuilderCollapsed(pageIndex, path);
  const parentCount = _getChildArray(_config.pages[pageIndex].layout, path)?.length || 0;
  const index = path[path.length - 1];

  return `<article class="builder-block depth-${Math.min(path.length, 4)} ${selected} ${isCollapsed ? 'collapsed' : ''}" data-path="${pathStr}" data-action="selectElement" tabindex="-1">
    <div class="builder-block-head">
      ${canHaveChildren ? `<button type="button" class="builder-toggle ${isCollapsed ? '' : 'open'}" data-action="toggleCollapse" data-path="${pathStr}" title="${isCollapsed ? 'Expand' : 'Collapse'}">▶</button>` : '<span class="builder-toggle-spacer"></span>'}
      <span class="builder-type badge-${_typeColor(type)}">${_esc(type)}</span>
      <div class="builder-block-title">
        <strong>${_esc(label)}</strong>
        ${meta ? `<small>${_esc(meta)}</small>` : ''}
      </div>
      <div class="builder-actions">
        <button type="button" class="btn-icon" data-action="moveElement" data-path="${pathStr}" data-dir="-1" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn-icon" data-action="moveElement" data-path="${pathStr}" data-dir="1" ${index >= parentCount - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="btn-icon" data-action="duplicateElement" data-path="${pathStr}" title="Duplicate">dup</button>
        <button type="button" class="btn-icon btn-danger" data-action="deleteElement" data-path="${pathStr}">x</button>
      </div>
    </div>
    ${canHaveChildren && isCollapsed ? _renderCollapsedChildrenSummary(children || []) : ''}
    ${canHaveChildren && !isCollapsed ? _renderChildrenZone(item, path, pageIndex, children || []) : ''}
  </article>`;
}

function _renderCollapsedChildrenSummary(children) {
  return `<div class="builder-collapsed-note">${children.length} hidden item${children.length === 1 ? '' : 's'}</div>`;
}

function _renderChildrenZone(item, path, pageIndex, children) {
  const pathStr = path.join('.');
  const isMatrix = (item.type || '').toLowerCase() === 'matrix';
  const options = isMatrix ? '<option value="matrixButton">Matrix Button</option>' : _elementTypeOptions(['matrixButton']);
  return `<div class="builder-children ${isMatrix ? 'matrix-children' : ''}">
    <div class="builder-child-toolbar">
      <span>${children.length}</span>
      <select data-role="childType" data-path="${pathStr}">${options}</select>
      <button type="button" class="btn-small" data-action="addChildElement" data-path="${pathStr}">+ Add inside</button>
    </div>
    <div class="builder-child-list">
      ${children.length ? children.map((child, idx) => _renderBlock(child, [...path, idx], pageIndex)).join('') : '<div class="builder-empty small">Empty container</div>'}
    </div>
  </div>`;
}

function _attachBuilderActions(container, pageIndex) {
  container.querySelectorAll('[data-action]').forEach(el => {
    addTrackedListener(el, 'click', e => {
      if (e.target.closest('select[data-role="childType"]')) {
        e.stopPropagation();
        return;
      }
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      if (!action) return;
      e.stopPropagation();

      const path = actionEl.dataset.path ? actionEl.dataset.path.split('.').map(Number) : null;
      if (action === 'selectElement') _selectElement(path);
      if (action === 'toggleCollapse') _toggleBuilderCollapse(pageIndex, path);
      if (action === 'moveElement') _moveElement(pageIndex, path, parseInt(actionEl.dataset.dir));
      if (action === 'duplicateElement') _duplicateElement(pageIndex, path);
      if (action === 'deleteElement') _deleteElement(pageIndex, path);
      if (action === 'addChildElement') {
        const select = container.querySelector(`select[data-role="childType"][data-path="${actionEl.dataset.path}"]`);
        _addElement(pageIndex, path, select?.value || 'button');
      }
    });
  });
}

function _renderPropertyPanel() {
  const panel = document.getElementById('propertyPanel');
  if (!panel) return;
  if (_selection.kind === 'variable') {
    panel.innerHTML = _renderVariableInspector();
    _attachVariableInspector();
    return;
  }
  if (_selection.kind === 'element') {
    panel.innerHTML = _renderElementInspector();
    _attachElementInspector();
    return;
  }
  panel.innerHTML = _renderPageInspector();
}

function _renderPageInspector() {
  const page = _config.pages?.[_selectedPageIndex];
  if (!page) return '<div class="property-empty">Select a page.</div>';
  return `<div class="property-header">
    <span class="section-title">Page</span>
  </div>
  <p class="property-help">Edit page label and id in the header. Select a variable or block to edit its properties.</p>
  <div class="property-summary">
    <div><strong>${Object.keys(page.state || {}).length}</strong><span>state</span></div>
    <div><strong>${Object.keys(page.computed || {}).length}</strong><span>computed</span></div>
    <div><strong>${(page.layout || []).length}</strong><span>root blocks</span></div>
  </div>`;
}

function _renderVariableInspector() {
  const { owner, varKind, name } = _selection;
  const scope = _getScope(owner);
  const isNew = !name;
  const entry = name ? deepClone(scope[varKind]?.[name]) : {};
  const title = isNew ? `Add ${varKind}` : `Edit ${name}`;

  if (varKind === 'computed') {
    const expr = typeof entry === 'string' ? entry : entry?.eval || '';
    return `<div class="property-header"><span class="section-title">${_esc(title)}</span></div>
      <div class="input-group"><label>Name</label><input id="varNameInput" type="text" value="${_attr(name || '')}" ${isNew ? '' : 'disabled'} /></div>
      <div class="input-group"><label>Expression</label><textarea id="varExpressionInput" class="inspector-expression">${_esc(expr)}</textarea></div>
      <div class="row-2">
        <div class="input-group"><label>Min</label><input id="varMinInput" type="number" value="${_attr(entry?.min ?? '')}" /></div>
        <div class="input-group"><label>Max</label><input id="varMaxInput" type="number" value="${_attr(entry?.max ?? '')}" /></div>
      </div>
      <div class="property-actions">
        <button type="button" id="saveVariableInspector">Save</button>
        <button type="button" class="btn-danger" id="cancelInspector">Cancel</button>
      </div>`;
  }

  const defaultValue = entry && typeof entry === 'object' && 'default' in entry ? entry.default : null;
  return `<div class="property-header"><span class="section-title">${_esc(title)}</span></div>
    <div class="input-group"><label>Name</label><input id="varNameInput" type="text" value="${_attr(name || '')}" ${isNew ? '' : 'disabled'} /></div>
    <div class="input-group"><label>Default Value (JSON or text)</label><input id="varDefaultInput" type="text" value="${_attr(_formatValueForInput(defaultValue))}" /></div>
    <div class="row-2">
      <div class="input-group"><label>Min</label><input id="varMinInput" type="number" value="${_attr(entry?.min ?? '')}" /></div>
      <div class="input-group"><label>Max</label><input id="varMaxInput" type="number" value="${_attr(entry?.max ?? '')}" /></div>
    </div>
    <div class="property-actions">
      <button type="button" id="saveVariableInspector">Save</button>
      <button type="button" class="btn-danger" id="cancelInspector">Cancel</button>
    </div>`;
}

function _attachVariableInspector() {
  document.getElementById('cancelInspector').onclick = () => {
    _selection = { kind: 'page' };
    _renderPropertyPanel();
    _renderGlobalVariables();
    if (_selectedPageIndex !== null) _renderPageVariables(_selectedPageIndex);
  };
  document.getElementById('saveVariableInspector').onclick = () => _saveVariableFromInspector();
}

function _renderElementInspector() {
  const page = _config.pages[_selectedPageIndex];
  const element = _getNodeAt(page.layout, _selection.path);
  if (!element) return '<div class="property-empty">Element not found.</div>';
  const type = element.type || 'button';
  return `<div class="property-header">
    <span class="section-title">${_esc(type)}</span>
    <small>${_esc(_breadcrumb(_selection.path))}</small>
  </div>
  ${_elementFields(type, element)}`;
}

function _attachElementInspector() {
  const page = _config.pages[_selectedPageIndex];
  const element = _getNodeAt(page.layout, _selection.path);
  if (!element) return;

  document.querySelectorAll('#propertyPanel [data-prop]').forEach(input => {
    addTrackedListener(input, input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input', () => {
      _writeElementProp(element, input);
      _syncAfterElementEdit();
    });
  });

  document.querySelectorAll('#propertyPanel [data-command-prop]').forEach(input => {
    addTrackedListener(input, 'input', () => {
      const prop = input.dataset.commandProp;
      element[prop] = input.value.split('\n').filter(line => line.trim());
      _syncAfterElementEdit(false);
    });
  });

  const colorToggle = document.getElementById('inspectorColorEnabled');
  const colorInput = document.getElementById('inspectorColor');
  if (colorToggle && colorInput) {
    addTrackedListener(colorToggle, 'change', () => {
      colorInput.disabled = !colorToggle.checked;
      if (colorToggle.checked) element.color = colorInput.value || '#c8adff';
      else delete element.color;
      _syncAfterElementEdit();
    });
  }
}

function _syncAfterElementEdit(rerenderBuilder = true) {
  _renderPreview(_selectedPageIndex);
  if (rerenderBuilder) _renderBuilder(_selectedPageIndex);
  _notify();
}

function _elementFields(type, e) {
  switch ((type || '').toLowerCase()) {
    case 'button':
      return `
        ${_textInput('Label', 'label', e.label)}
        ${_textareaInput('Tooltip', 'tooltip', e.tooltip, { rows: 3 })}
        ${_colorInput(e.color)}
        ${_commandInput('onclick', 'onclick', e.onclick)}
        ${_commandInput('onrightclick', 'onrightclick', e.onrightclick)}`;
    case 'value':
      return `${_bindingSelect('Read from', e.var, 'all')}${_textInput('Label', 'label', e.label)}`;
    case 'input':
      return `${_bindingSelect('Bind to', e.var, 'state')}${_textInput('Label', 'label', e.label)}${_textInput('Placeholder', 'placeholder', e.placeholder)}${_commandInput('onupdate', 'onupdate', e.onupdate)}`;
    case 'counter':
      return `${_bindingSelect('Bind to', e.var, 'state')}${_textInput('Label', 'label', e.label)}${_numberInput('Step', 'step', e.step)}${_colorInput(e.color)}${_commandInput('onupdate', 'onupdate', e.onupdate)}`;
    case 'checkbox':
    case 'toggle':
      return `${_bindingSelect('Bind to', e.var, 'state')}${_textInput('Label', 'label', e.label)}${_colorInput(e.color)}${_commandInput('onupdate', 'onupdate', e.onupdate)}`;
    case 'dropdown':
      return `${_bindingSelect('Bind to', e.var, 'state')}${_textInput('Label', 'label', e.label)}${_optionsInput(e.options)}${_commandInput('onupdate', 'onupdate', e.onupdate)}`;
    case 'title':
      return `${_textInput('Text', 'text', e.text)}${_colorInput(e.color)}`;
    case 'text':
      return `${_textareaInput('Text', 'text', e.text, { rows: 8 })}`;
    case 'divider':
      return `${_colorInput(e.color)}${_textInput('Height', 'height', e.height)}${_textInput('Margin', 'margin', e.margin)}${_selectInput('Style', 'style', e.style, [['', 'Default'], ['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']])}`;
    case 'row':
      return '<p class="property-help">Row keeps its children on one horizontal line. Add children from the block card.</p>';
    case 'stack':
      return `${_checkboxInput('Border', 'border', e.border)}${_colorInput(e.color)}<p class="property-help">Stack lays children vertically.</p>`;
    case 'matrix':
      return `${_numberInput('Columns', 'columns', e.columns ?? 4)}${_textInput('Button size', 'buttonSize', e.buttonSize ?? '40px')}${_textInput('Gap', 'gap', e.gap ?? '4px')}${_selectInput('Button shape', 'buttonShape', e.buttonShape || 'square', [['square', 'Square'], ['rectangle', 'Rectangle']])}${_checkboxInput('Border', 'border', e.border)}${_colorInput(e.color)}`;
    case 'matrixbutton':
      return `${_textInput('Label', 'label', e.label)}${_textInput('Icon', 'icon', e.icon)}${_textareaInput('Tooltip', 'tooltip', e.tooltip, { rows: 3 })}${_colorInput(e.color)}${_textInput('Border color', 'borderColor', e.borderColor)}${_commandInput('onclick', 'onclick', e.onclick)}${_commandInput('onrightclick', 'onrightclick', e.onrightclick)}`;
    default:
      return `<p class="property-help">Unknown element type: ${_esc(type)}</p>`;
  }
}

function _textInput(label, prop, value = '') {
  return `<div class="input-group"><label>${_esc(label)}</label><input type="text" data-prop="${prop}" value="${_attr(value || '')}" /></div>`;
}

function _numberInput(label, prop, value = '') {
  return `<div class="input-group"><label>${_esc(label)}</label><input type="number" data-prop="${prop}" value="${_attr(value ?? '')}" /></div>`;
}

function _textareaInput(label, prop, value = '', options = {}) {
  return `<div class="input-group"><label>${_esc(label)}</label><textarea data-prop="${prop}" rows="${options.rows || 4}">${_esc(value || '')}</textarea></div>`;
}

function _checkboxInput(label, prop, value) {
  return `<div class="input-group"><label class="checkbox-label"><input type="checkbox" data-prop="${prop}" ${value ? 'checked' : ''} /> ${_esc(label)}</label></div>`;
}

function _selectInput(label, prop, value, options) {
  return `<div class="input-group"><label>${_esc(label)}</label><select data-prop="${prop}">
    ${options.map(([v, l]) => `<option value="${_attr(v)}" ${String(value ?? '') === String(v) ? 'selected' : ''}>${_esc(l)}</option>`).join('')}
  </select></div>`;
}

function _colorInput(value) {
  const enabled = !!value;
  return `<div class="input-group">
    <label class="checkbox-label">
      <input type="checkbox" id="inspectorColorEnabled" ${enabled ? 'checked' : ''} /> Custom color
    </label>
    <input type="color" id="inspectorColor" data-prop="color" value="${_attr(value || '#c8adff')}" ${enabled ? '' : 'disabled'} />
  </div>`;
}

function _commandInput(label, prop, commands) {
  return `<div class="input-group"><label>${_esc(label)}</label><textarea data-command-prop="${prop}" rows="5">${_esc(dedentCommandList(commands || []).join('\n'))}</textarea></div>`;
}

function _optionsInput(options = []) {
  const text = (options || []).map(opt => typeof opt === 'string' ? opt : `${opt.label || ''} | ${opt.value || ''}`).join('\n');
  return `<div class="input-group"><label>Options</label><textarea id="dropdownOptionsInput" data-prop="options" rows="5">${_esc(text)}</textarea><small>One per line, or "Label | value".</small></div>`;
}

function _bindingSelect(label, value, mode) {
  const options = mode === 'state' ? _stateVariableNames() : _allVariableNames();
  const warning = mode === 'state' && value && !options.includes(value)
    ? `<small class="warn">"${_esc(value)}" is not a State variable. Inputs can only bind State.</small>`
    : '';
  return `<div class="input-group"><label>${_esc(label)}</label><select data-prop="var">
    <option value="">Select variable...</option>
    ${options.map(name => `<option value="${_attr(name)}" ${name === value ? 'selected' : ''}>${_esc(name)}</option>`).join('')}
    ${value && !options.includes(value) ? `<option value="${_attr(value)}" selected>${_esc(value)} (missing)</option>` : ''}
  </select>${warning}</div>`;
}

function _writeElementProp(element, input) {
  const prop = input.dataset.prop;
  if (!prop) return;
  let value;
  if (input.type === 'checkbox') value = input.checked;
  else if (input.type === 'number') value = input.value === '' ? undefined : Number(input.value);
  else value = input.value;

  if (prop === 'options') {
    value = input.value.split('\n').filter(Boolean).map(line => line.includes(' | ')
      ? { label: line.split(' | ')[0].trim(), value: line.split(' | ')[1].trim() }
      : line.trim());
  }

  if (value === '' || value === undefined || value === false) delete element[prop];
  else element[prop] = value;
}

function _selectElement(path) {
  _selection = { kind: 'element', path };
  _renderPreview(_selectedPageIndex);
  _renderBuilder(_selectedPageIndex);
  _renderPropertyPanel();
}

function _focusElementPath(pageIndex, path) {
  _selection = { kind: 'element', path };
  _renderPreview(pageIndex);
  _renderBuilder(pageIndex);
  _renderPropertyPanel();

  window.requestAnimationFrame(() => {
    const pathStr = path.join('.');
    const block = document.querySelector(`#pageBuilder .builder-block[data-path="${pathStr}"]`);
    if (!block) return;
    block.scrollIntoView({ block: 'center', behavior: 'smooth' });
    block.focus({ preventScroll: true });
  });
}

function _selectVariable(owner, varKind, name) {
  _selection = { kind: 'variable', owner, varKind, name };
  _renderGlobalVariables();
  if (_selectedPageIndex !== null) {
    _renderPageVariables(_selectedPageIndex);
  }
  _renderPropertyPanel();
}

function _saveVariableFromInspector() {
  const { owner, varKind, name } = _selection;
  const scope = _getScope(owner);
  const nextName = document.getElementById('varNameInput').value.trim();
  if (!nextName) {
    alert('Variable name is required.');
    return;
  }
  if (!name && ((scope.state || {})[nextName] || (scope.computed || {})[nextName])) {
    alert(`Variable "${nextName}" already exists.`);
    return;
  }

  if (name && name !== nextName) delete scope[varKind][name];
  if (!scope[varKind]) scope[varKind] = {};

  if (varKind === 'computed') {
    const expr = document.getElementById('varExpressionInput').value.trim();
    if (!expr) {
      alert('Expression is required.');
      return;
    }
    const entry = { eval: expr };
    _assignOptionalNumber(entry, 'min', 'varMinInput');
    _assignOptionalNumber(entry, 'max', 'varMaxInput');
    scope.computed[nextName] = Object.keys(entry).length === 1 ? expr : entry;
  } else {
    const entry = { default: _parseLooseValue(document.getElementById('varDefaultInput').value) };
    _assignOptionalNumber(entry, 'min', 'varMinInput');
    _assignOptionalNumber(entry, 'max', 'varMaxInput');
    scope.state[nextName] = entry;
  }

  _syncRuntimeVariables(scope);
  _selection = { kind: 'variable', owner, varKind, name: nextName };
  _notify();
  renderSidebar();
  if (_selectedPageIndex !== null) renderPagePanel(_selectedPageIndex);
}

function _deleteVariable(owner, kind, name) {
  if (!name || !confirm(`Delete ${kind} variable "${name}"?`)) return;
  const scope = _getScope(owner);
  delete scope[kind][name];
  _syncRuntimeVariables(scope);
  _selection = { kind: 'page' };
  _notify();
  renderSidebar();
  if (_selectedPageIndex !== null) renderPagePanel(_selectedPageIndex);
}

function _addElement(pageIndex, parentPath, type) {
  const parent = parentPath ? _getNodeAt(_config.pages[pageIndex].layout, parentPath) : null;
  const element = _defaultElement(type, parent);
  const target = parent ? _ensureChildren(parent) : _config.pages[pageIndex].layout;
  target.push(element);
  _selection = { kind: 'element', path: parentPath ? [...parentPath, target.length - 1] : [target.length - 1] };
  _notify();
  renderPagePanel(pageIndex);
}

function _defaultElement(type, parent = null) {
  if ((parent?.type || '').toLowerCase() === 'matrix') type = 'matrixButton';
  const defaults = {
    button: { type: 'button', label: 'Button', onclick: [] },
    value: { type: 'value', var: '', label: '' },
    input: { type: 'input', var: '', label: '' },
    counter: { type: 'counter', var: '', label: '', step: 1 },
    checkbox: { type: 'checkbox', var: '', label: '' },
    toggle: { type: 'toggle', var: '', label: '' },
    dropdown: { type: 'dropdown', var: '', label: '', options: [] },
    title: { type: 'title', text: 'Title' },
    text: { type: 'text', text: '' },
    divider: { type: 'divider' },
    row: { type: 'row', children: [] },
    stack: { type: 'stack', children: [] },
    matrix: { type: 'matrix', columns: 4, buttonSize: '40px', gap: '4px', children: [] },
    matrixButton: { type: 'matrixButton', label: '', onclick: [] },
  };
  return deepClone(defaults[type] || defaults.button);
}

function _duplicateElement(pageIndex, path) {
  const arr = _getChildArray(_config.pages[pageIndex].layout, path);
  if (!arr) return;
  const idx = path[path.length - 1];
  arr.splice(idx + 1, 0, deepClone(arr[idx]));
  _selection = { kind: 'element', path: [...path.slice(0, -1), idx + 1] };
  _notify();
  renderPagePanel(pageIndex);
}

function _deleteElement(pageIndex, path) {
  const arr = _getChildArray(_config.pages[pageIndex].layout, path);
  if (!arr) return;
  arr.splice(path[path.length - 1], 1);
  _selection = { kind: 'page' };
  _notify();
  renderPagePanel(pageIndex);
}

function _moveElement(pageIndex, path, dir) {
  const arr = _getChildArray(_config.pages[pageIndex].layout, path);
  if (!arr) return;
  const idx = path[path.length - 1];
  const next = idx + dir;
  if (next < 0 || next >= arr.length) return;
  const [item] = arr.splice(idx, 1);
  arr.splice(next, 0, item);
  _selection = { kind: 'element', path: [...path.slice(0, -1), next] };
  _notify();
  renderPagePanel(pageIndex);
}

function _addPage() {
  if (!_config.pages) _config.pages = [];
  const page = {
    id: _uniquePageId(`page-${_config.pages.length + 1}`),
    label: 'New Page',
    state: {},
    computed: {},
    variables: {},
    layout: [],
  };
  _config.pages.push(page);
  _selectPage(_config.pages.length - 1);
  _notify();
}

function _deletePage(index) {
  if (!confirm(`Delete page "${_config.pages[index].label || index}"?`)) return;
  _config.pages.splice(index, 1);
  if (_selectedPageIndex >= _config.pages.length) _selectedPageIndex = _config.pages.length - 1;
  renderSidebar();
  if (_selectedPageIndex >= 0 && _config.pages.length > 0) renderPagePanel(_selectedPageIndex);
  else {
    _selectedPageIndex = null;
    _selection = { kind: 'page' };
    const c = document.getElementById('pageEditorContainer');
    if (c) c.innerHTML = _emptyState('No pages - click "+" to create one');
  }
  _notify();
}

function _movePage(index, dir) {
  const next = index + dir;
  if (next < 0 || next >= _config.pages.length) return;
  const [page] = _config.pages.splice(index, 1);
  _config.pages.splice(next, 0, page);
  if (_selectedPageIndex === index) _selectedPageIndex = next;
  renderSidebar();
  renderPagePanel(_selectedPageIndex);
  _notify();
}

function _getScope(owner) {
  return owner === 'global' ? _config.global : _config.pages[Number(owner)];
}

function _stateVariableNames() {
  const page = _config.pages?.[_selectedPageIndex] || {};
  return [...Object.keys(_config.global?.state || {}), ...Object.keys(page.state || {})];
}

function _allVariableNames() {
  const page = _config.pages?.[_selectedPageIndex] || {};
  return [
    ...Object.keys(_config.global?.state || {}),
    ...Object.keys(_config.global?.computed || {}),
    ...Object.keys(page.state || {}),
    ...Object.keys(page.computed || {}),
  ];
}

function _getNodeAt(layout, path) {
  let node = { children: layout };
  for (const idx of path || []) {
    const children = _getChildren(node) || node.children;
    node = children?.[idx];
    if (!node) return null;
  }
  return node;
}

function _getChildArray(layout, path) {
  if (!path || path.length === 1) return layout;
  const parent = _getNodeAt(layout, path.slice(0, -1));
  return parent ? _getChildren(parent) : null;
}

function _getChildren(item) {
  if (!item) return null;
  return item.children || null;
}

function _ensureChildren(item) {
  if (!item.children) item.children = [];
  return item.children;
}

function _isContainer(item) {
  return CONTAINER_TYPES.has((item?.type || '').toLowerCase());
}

function _blockLabel(item) {
  const type = (item.type || '').toLowerCase();
  if (type === 'matrix') return `Matrix (${item.columns || 4} columns)`;
  if (type === 'row') return 'Row';
  if (type === 'stack') return 'Stack';
  return item.label || item.text || item.var || item.icon || type || 'Element';
}

function _blockMeta(item) {
  const type = (item.type || '').toLowerCase();
  if (READ_BIND_TYPES.has(type)) return item.var ? `reads ${item.var}` : 'no variable selected';
  if (MUTABLE_BIND_TYPES.has(type)) return item.var ? `binds ${item.var}` : 'no state binding';
  if (type === 'button') return `${(item.onclick || []).length} click command(s)`;
  return '';
}

function _previewShortLabel(item) {
  const type = (item.type || '').toLowerCase();
  if (type === 'matrixbutton' && item.icon) return String(item.icon).slice(0, 2);
  const labels = {
    button: 'B',
    value: 'V',
    input: 'I',
    counter: 'C',
    checkbox: 'Ch',
    toggle: 'Tg',
    dropdown: 'Dd',
    title: 'T',
    text: 'Tx',
    divider: '-',
    row: 'Row',
    stack: 'St',
    matrix: 'Mx',
    matrixbutton: 'Mb',
  };
  return labels[type] || '?';
}

function _breadcrumb(path) {
  return `Page > ${path.map(i => `Block ${i + 1}`).join(' > ')}`;
}

function _elementTypeOptions(exclude = []) {
  const types = ['button', 'value', 'input', 'counter', 'checkbox', 'toggle', 'dropdown', 'title', 'text', 'divider', 'row', 'stack', 'matrix', 'matrixButton'];
  return types
    .filter(type => !exclude.includes(type))
    .map(type => `<option value="${type}">${type}</option>`)
    .join('');
}

function _assignOptionalNumber(target, prop, inputId) {
  const raw = document.getElementById(inputId)?.value;
  if (raw === '') return;
  const value = Number(raw);
  if (Number.isFinite(value)) target[prop] = value;
}

function _parseLooseValue(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return '';
  try { return JSON.parse(text); } catch { return raw; }
}

function _formatValueForInput(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function _stateDesc(entry) {
  const value = entry && typeof entry === 'object' && 'default' in entry ? entry.default : entry;
  const parts = [`default: ${_formatValueForInput(value)}`];
  if (entry?.min !== undefined) parts.push(`min: ${entry.min}`);
  if (entry?.max !== undefined) parts.push(`max: ${entry.max}`);
  return parts.join(', ');
}

function _computedDesc(entry) {
  const expr = typeof entry === 'string' ? entry : entry?.eval || '';
  return expr || 'empty expression';
}

function _typeColor(type) {
  const t = (type || '').toLowerCase();
  const map = {
    button: 'purple',
    value: 'blue',
    input: 'green',
    counter: 'orange',
    checkbox: 'cyan',
    toggle: 'cyan',
    dropdown: 'teal',
    title: 'pink',
    text: 'gray',
    divider: 'gray',
    row: 'indigo',
    stack: 'indigo',
    matrix: 'amber',
    matrixbutton: 'amber',
  };
  return map[t] || 'gray';
}

function _slugify(value, fallback = 'page') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function _uniquePageId(base, currentPage = null) {
  const used = new Set((_config.pages || []).filter(page => page !== currentPage).map(page => page.id));
  let id = _slugify(base);
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function _samePath(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}

function _isDescendantPath(path, parentPath) {
  return Array.isArray(path)
    && Array.isArray(parentPath)
    && path.length > parentPath.length
    && parentPath.every((v, i) => path[i] === v);
}

function _builderCollapseKey(pageIndex, path) {
  const page = _config.pages?.[pageIndex];
  return `${page?.id || pageIndex}:${path.join('.')}`;
}

function _isBuilderCollapsed(pageIndex, path) {
  return _collapsedBuilderPaths.has(_builderCollapseKey(pageIndex, path));
}

function _collectContainerPaths(items, basePath = []) {
  const paths = [];
  (items || []).forEach((item, index) => {
    const path = [...basePath, index];
    if (!_isContainer(item)) return;
    paths.push(path);
    paths.push(..._collectContainerPaths(_getChildren(item) || [], path));
  });
  return paths;
}

function _truncate(str, len) {
  const text = String(str ?? '');
  return text.length > len ? `${text.slice(0, len)}...` : text;
}

function _notify() {
  _syncAllRuntimeVariables();
  if (_onConfigChange) _onConfigChange(_config);
}

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _attr(str) {
  return _esc(str).replace(/'/g, '&#39;');
}

function _toggleBuilderCollapse(pageIndex, path) {
  const key = _builderCollapseKey(pageIndex, path);
  const willCollapse = !_collapsedBuilderPaths.has(key);
  if (willCollapse) _collapsedBuilderPaths.add(key);
  else _collapsedBuilderPaths.delete(key);

  if (willCollapse && _selection.kind === 'element' && _isDescendantPath(_selection.path, path)) {
    _selection = { kind: 'element', path };
  }

  _renderBuilder(pageIndex);
  _renderPropertyPanel();
}

function _setAllBuilderCollapsed(pageIndex, collapsed) {
  const page = _config.pages?.[pageIndex];
  if (!page) return;
  const paths = _collectContainerPaths(page.layout || []);

  if (collapsed) {
    paths.forEach(path => _collapsedBuilderPaths.add(_builderCollapseKey(pageIndex, path)));
    if (_selection.kind === 'element') {
      const selectedContainer = paths.find(path => _samePath(path, _selection.path));
      const selectedParent = paths
        .filter(path => _isDescendantPath(_selection.path, path))
        .sort((a, b) => b.length - a.length)[0];
      if (!selectedContainer && selectedParent) {
        _selection = { kind: 'element', path: selectedParent };
      }
    }
  } else {
    paths.forEach(path => _collapsedBuilderPaths.delete(_builderCollapseKey(pageIndex, path)));
  }

  _renderBuilder(pageIndex);
  _renderPropertyPanel();
}

function _infoTip(text) {
  return `<span class="info-tip" tabindex="0" data-tooltip="${_attr(text)}" aria-label="${_attr(text)}">?</span>`;
}

function _installTooltips() {
  if (_tooltipsInstalled) return;
  _tooltipsInstalled = true;

  addTrackedListener(document, 'mouseover', _showTooltipFromEvent);
  addTrackedListener(document, 'focusin', _showTooltipFromEvent);
  addTrackedListener(document, 'mouseout', _hideTooltipFromEvent);
  addTrackedListener(document, 'focusout', _hideTooltipFromEvent);
  addTrackedListener(document, 'keydown', e => {
    if (e.key === 'Escape') _hideTooltip();
  });
}

function _showTooltipFromEvent(e) {
  const target = e.target.closest?.('[data-tooltip]');
  if (!target) return;
  _showTooltip(target);
}

function _hideTooltipFromEvent(e) {
  const target = e.target.closest?.('[data-tooltip]');
  if (!target) return;
  if (e.relatedTarget && target.contains(e.relatedTarget)) return;
  _hideTooltip();
}

function _showTooltip(target) {
  const text = target.dataset.tooltip;
  if (!text) return;

  if (!_tooltipEl) {
    _tooltipEl = document.createElement('div');
    _tooltipEl.id = 'floatingTooltip';
    _tooltipEl.className = 'floating-tooltip';
    _tooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(_tooltipEl);
  }

  _tooltipEl.textContent = text;
  _tooltipEl.classList.add('visible');
  target.setAttribute('aria-describedby', 'floatingTooltip');

  const rect = target.getBoundingClientRect();
  const tooltipRect = _tooltipEl.getBoundingClientRect();
  const gap = 8;
  const left = Math.min(
    window.innerWidth - tooltipRect.width - gap,
    Math.max(gap, rect.left + rect.width / 2 - tooltipRect.width / 2)
  );
  let top = rect.bottom + gap;
  if (top + tooltipRect.height > window.innerHeight - gap) {
    top = rect.top - tooltipRect.height - gap;
  }
  if (top < gap) top = gap;

  _tooltipEl.style.left = `${left}px`;
  _tooltipEl.style.top = `${top}px`;
}

function _hideTooltip() {
  document.querySelectorAll('[aria-describedby="floatingTooltip"]').forEach(el => {
    el.removeAttribute('aria-describedby');
  });
  if (_tooltipEl) _tooltipEl.classList.remove('visible');
}

function _emptyState(msg) {
  return `<div class="empty-state">${_esc(msg)}</div>`;
}
