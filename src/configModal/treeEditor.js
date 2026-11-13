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
import { buildVariablesFromStateComputed, normalizePageId } from '../configSchema.js';
import { deepClone } from '../utils.js';
import { enhanceCodeEditors } from './codeEditors.js';
import { parseMd } from '../ui/markdownUtils.js';
import { renameEvaluatedPageScope } from '../storage.js';

let _config = null;
let _selectedPageIndex = null;
let _onConfigChange = null;
let _selection = { kind: 'page' };
let _activeWorkspace = 'screen-layout';
const _collapsedBuilderPaths = new Set();
const _builderDragControllers = new WeakMap();
let _tooltipsInstalled = false;
let _tooltipEl = null;
let _projectSearchQuery = '';
let _historyUndo = [];
let _historyRedo = [];
let _lastHistorySnapshot = '';
let _historyRestoring = false;
let _inspectorWidth = 320;
let _draggedElement = null;
let _dropTarget = null;
let _suppressBuilderClickUntil = 0;
let _previewResizeObserver = null;

const HISTORY_LIMIT = 100;

const MUTABLE_BIND_TYPES = new Set(['input', 'counter', 'checkbox', 'toggle', 'dropdown']);
const READ_BIND_TYPES = new Set(['value']);
const CONTAINER_TYPES = new Set(['row', 'stack', 'matrix']);

export function initEditor(config, onChange) {
  _config = config;
  _onConfigChange = onChange;
  _ensureConfigShape();
  _installTooltips();
  _resetHistory();
  _installStudioControls();

  const addPageBtn = document.getElementById('addPageBtn');
  if (addPageBtn) addPageBtn.onclick = _addPage;

  const addGlobalVarBtn = document.getElementById('addGlobalVariableBtn');
  if (addGlobalVarBtn) addGlobalVarBtn.onclick = () => _selectVariable('global', 'state', null);

  const projectSettingsNav = document.getElementById('projectSettingsNav');
  if (projectSettingsNav) projectSettingsNav.onclick = _showProjectSettings;

  const globalVariablesNav = document.getElementById('globalVariablesNav');
  if (globalVariablesNav) globalVariablesNav.onclick = _showGlobalVariablesWorkspace;

  renderSidebar();
  if (_config.pages?.length) {
    _selectPage(0);
  } else {
    _showProjectSettings();
  }
}

export function rerenderEditor(config) {
  _config = config;
  _ensureConfigShape();
  _resetHistory();
  renderSidebar();
  if (_activeWorkspace === 'project') {
    _showProjectSettings();
  } else if (_activeWorkspace === 'variables') {
    _showGlobalVariablesWorkspace();
  } else if (_activeWorkspace === 'screen-variables' && _selectedPageIndex !== null && _config.pages?.[_selectedPageIndex]) {
    renderPageVariablesPanel(_selectedPageIndex);
  } else if (_selectedPageIndex !== null && _config.pages?.[_selectedPageIndex]) {
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
  document.getElementById('projectSettingsNav')?.classList.toggle('active', _activeWorkspace === 'project');
  document.getElementById('globalVariablesNav')?.classList.toggle('active', _activeWorkspace === 'variables');
  _renderProjectSearchResults();
  _updateValidationUI();
}

function _installStudioControls() {
  const search = document.getElementById('projectSearch');
  if (search && !search.dataset.bound) {
    search.dataset.bound = 'true';
    addTrackedListener(search, 'input', () => {
      _projectSearchQuery = search.value.trim().toLowerCase();
      _renderProjectSearchResults();
    });
  }

  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.onclick = _undo;
  if (redoBtn) redoBtn.onclick = _redo;

  const sidebar = document.querySelector('.editor-sidebar');
  const layout = document.querySelector('.editor-layout');
  const handle = document.getElementById('explorerResizeHandle');
  const collapse = document.getElementById('collapseExplorerBtn');
  const expand = document.getElementById('expandExplorerBtn');
  try {
    const savedExplorerWidth = Number(localStorage.getItem('macrohero.studio.explorerWidth'));
    const savedInspectorWidth = Number(localStorage.getItem('macrohero.studio.inspectorWidth'));
    if (sidebar && savedExplorerWidth) sidebar.style.flexBasis = `${Math.min(520, Math.max(210, savedExplorerWidth))}px`;
    if (savedInspectorWidth) _inspectorWidth = Math.min(620, Math.max(260, savedInspectorWidth));
  } catch { /* storage is optional */ }
  const setExplorerCollapsed = collapsed => {
    layout?.classList.toggle('explorer-collapsed', collapsed);
    if (expand) expand.hidden = !collapsed;
    if (collapse) collapse.setAttribute('aria-expanded', String(!collapsed));
  };
  if (collapse) collapse.onclick = () => setExplorerCollapsed(true);
  if (expand) expand.onclick = () => setExplorerCollapsed(false);

  if (handle && sidebar && !handle.dataset.bound) {
    handle.dataset.bound = 'true';
    addTrackedListener(handle, 'pointerdown', event => {
      event.preventDefault();
      handle.setPointerCapture?.(event.pointerId);
      const startX = event.clientX;
      const startWidth = sidebar.getBoundingClientRect().width;
      const move = moveEvent => {
        const width = Math.min(520, Math.max(210, startWidth + moveEvent.clientX - startX));
        sidebar.style.flexBasis = `${width}px`;
      };
      const stop = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', stop);
        try { localStorage.setItem('macrohero.studio.explorerWidth', String(sidebar.getBoundingClientRect().width)); } catch { /* ignore */ }
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', stop, { once: true });
    });
  }

  if (!document.documentElement.dataset.studioKeysBound) {
    document.documentElement.dataset.studioKeysBound = 'true';
    addTrackedListener(window, 'keydown', event => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        search?.focus();
        search?.select();
        return;
      }
      if (!modifier || !document.getElementById('editor-tab')?.classList.contains('active')) return;
      if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        _undo();
      } else if (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)) {
        event.preventDefault();
        _redo();
      }
    });
  }
}

function _installInspectorControls(container) {
  const shell = container?.querySelector('.builder-shell');
  const handle = shell?.querySelector('[data-inspector-resize]');
  if (!shell || !handle) return;
  shell.style.setProperty('--inspector-width', `${_inspectorWidth}px`);

  handle.onpointerdown = event => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = _inspectorWidth;
    const move = moveEvent => {
      _inspectorWidth = Math.min(620, Math.max(260, startWidth + startX - moveEvent.clientX));
      shell.style.setProperty('--inspector-width', `${_inspectorWidth}px`);
    };
    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      try { localStorage.setItem('macrohero.studio.inspectorWidth', String(_inspectorWidth)); } catch { /* ignore */ }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop, { once: true });
  };
}

function _historySnapshot() {
  return JSON.stringify({
    schemaVersion: _config?.schemaVersion,
    global: _config?.global || {},
    pages: _config?.pages || [],
  });
}

function _resetHistory() {
  _historyUndo = [];
  _historyRedo = [];
  _lastHistorySnapshot = _historySnapshot();
  _updateHistoryControls();
}

function _recordHistory() {
  const next = _historySnapshot();
  if (_historyRestoring || next === _lastHistorySnapshot) return;
  if (_lastHistorySnapshot) _historyUndo.push(_lastHistorySnapshot);
  if (_historyUndo.length > HISTORY_LIMIT) _historyUndo.shift();
  _historyRedo = [];
  _lastHistorySnapshot = next;
  _updateHistoryControls();
}

function _undo() {
  if (!_historyUndo.length) return;
  const previous = _historyUndo.pop();
  _historyRedo.push(_lastHistorySnapshot);
  _restoreHistorySnapshot(previous);
}

function _redo() {
  if (!_historyRedo.length) return;
  const next = _historyRedo.pop();
  _historyUndo.push(_lastHistorySnapshot);
  _restoreHistorySnapshot(next);
}

function _restoreHistorySnapshot(snapshot) {
  _historyRestoring = true;
  try {
    _config = JSON.parse(snapshot);
    _ensureConfigShape();
    _lastHistorySnapshot = _historySnapshot();
    if (_selectedPageIndex !== null && !_config.pages?.[_selectedPageIndex]) {
      _selectedPageIndex = _config.pages?.length ? _config.pages.length - 1 : null;
    }
    renderSidebar();
    _renderActiveWorkspace();
    if (_onConfigChange) _onConfigChange(_config);
  } finally {
    _historyRestoring = false;
    _updateHistoryControls();
  }
}

function _updateHistoryControls() {
  const undo = document.getElementById('undoBtn');
  const redo = document.getElementById('redoBtn');
  if (undo) undo.disabled = _historyUndo.length === 0;
  if (redo) redo.disabled = _historyRedo.length === 0;
}

function _renderActiveWorkspace() {
  if (_activeWorkspace === 'project') _showProjectSettings();
  else if (_activeWorkspace === 'variables') _showGlobalVariablesWorkspace();
  else if (_activeWorkspace === 'screen-variables' && _selectedPageIndex !== null) renderPageVariablesPanel(_selectedPageIndex);
  else if (_selectedPageIndex !== null) renderPagePanel(_selectedPageIndex);
  else _showProjectSettings();
}

function _renderProjectSearchResults() {
  const resultsHost = document.getElementById('projectSearchResults');
  const tree = document.querySelector('.project-tree-section');
  if (!resultsHost || !tree) return;
  const query = _projectSearchQuery;
  resultsHost.hidden = !query;
  tree.hidden = Boolean(query);
  if (!query) {
    resultsHost.replaceChildren();
    return;
  }

  const results = [];
  const addVariableResults = (scope, owner, scopeLabel) => {
    ['state', 'computed'].forEach(kind => {
      Object.keys(scope?.[kind] || {}).forEach(name => {
        if (`${name} ${kind} ${scopeLabel}`.toLowerCase().includes(query)) {
          results.push({ kind: 'variable', owner, varKind: kind, name, label: name, meta: `${scopeLabel} · ${kind}` });
        }
      });
    });
  };
  addVariableResults(_config.global, 'global', 'Global');
  (_config.pages || []).forEach((page, pageIndex) => {
    if (`${page.label} ${page.id}`.toLowerCase().includes(query)) {
      results.push({ kind: 'screen', pageIndex, label: page.label, meta: `Screen · ${page.id}` });
    }
    addVariableResults(page, pageIndex, page.label || `Screen ${pageIndex + 1}`);
    _walkLayout(page.layout, (item, path) => {
      const label = _blockLabel(item);
      if (`${item.type} ${label} ${item.var || ''}`.toLowerCase().includes(query)) {
        results.push({ kind: 'component', pageIndex, path, label, meta: `${page.label} · ${item.type}` });
      }
    });
  });

  resultsHost.innerHTML = results.length
    ? results.slice(0, 60).map((result, index) => `<button type="button" class="project-search-result" data-result-index="${index}">
        <span class="tree-icon">${result.kind === 'variable' ? 'V' : result.kind === 'screen' ? '▤' : 'C'}</span>
        <span><strong>${_esc(result.label)}</strong><small>${_esc(result.meta)}</small></span>
      </button>`).join('')
    : '<div class="project-search-empty">No matching screen, variable, or component.</div>';

  resultsHost.querySelectorAll('[data-result-index]').forEach(button => {
    button.onclick = () => {
      const result = results[Number(button.dataset.resultIndex)];
      if (!result) return;
      const search = document.getElementById('projectSearch');
      if (search) search.value = '';
      _projectSearchQuery = '';
      if (result.kind === 'variable') _selectVariable(result.owner, result.varKind, result.name);
      else if (result.kind === 'screen') _selectPage(result.pageIndex);
      else {
        _selectPage(result.pageIndex);
        _focusElementPath(result.pageIndex, result.path);
      }
    };
  });
}

function _ensureConfigShape() {
  if (!_config.global) _config.global = {};
  if (!_config.global.state) _config.global.state = {};
  if (!_config.global.computed) _config.global.computed = {};
  _syncRuntimeVariables(_config.global);

  if (!Array.isArray(_config.pages)) _config.pages = [];
  _config.pages.forEach((page, index) => {
    if (!page.id) page.id = _uniquePageId(normalizePageId(page.label || `page_${index + 1}`));
    if (!page.label) page.label = `Page ${index + 1}`;
    page.id = _uniquePageId(normalizePageId(page.id, `page_${index + 1}`), page);
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
  const title = document.getElementById('globalTitle');
  const width = document.getElementById('globalWidth');
  const height = document.getElementById('globalHeight');
  if (title) _config.global.title = title.value || 'Macro Hero';
  if (width) _config.global.width = parseInt(width.value) || 600;
  if (height) _config.global.height = parseInt(height.value) || 600;
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
  const count = document.getElementById('globalVariablesCount');
  if (count) count.textContent = String(Object.keys(scope.state || {}).length + Object.keys(scope.computed || {}).length);
}

function _showProjectSettings() {
  _activeWorkspace = 'project';
  _selection = { kind: 'project' };
  renderSidebar();

  const container = document.getElementById('pageEditorContainer');
  if (!container) return;
  const global = _config.global || {};
  container.innerHTML = `
    <div class="workspace-page settings-workspace">
      <header class="workspace-header">
        <div>
          <span class="workspace-kicker">Application</span>
          <h3>Project settings</h3>
          <p>Window identity and dimensions shared by every screen.</p>
        </div>
      </header>
      <div class="workspace-content narrow-content">
        <section class="settings-card">
          <div class="settings-card-head">
            <span class="tree-icon tree-icon-screen">◆</span>
            <div><strong>Macro window</strong><small>General runtime settings</small></div>
          </div>
          <div class="input-group">
            <label for="globalTitle">Window title</label>
            <input type="text" id="globalTitle" value="${_attr(global.title || 'Macro Hero')}" />
          </div>
          <div class="row-2">
            <div class="input-group">
              <label for="globalWidth">Width</label>
              <input type="number" id="globalWidth" min="240" value="${_attr(global.width || 600)}" />
            </div>
            <div class="input-group">
              <label for="globalHeight">Height</label>
              <input type="number" id="globalHeight" min="240" value="${_attr(global.height || 600)}" />
            </div>
          </div>
        </section>
      </div>
    </div>`;

  ['globalTitle', 'globalWidth', 'globalHeight'].forEach(id => {
    addTrackedListener(document.getElementById(id), 'input', () => {
      _syncGlobalFields();
      _notify();
    });
  });
}

function _showGlobalVariablesWorkspace() {
  _activeWorkspace = 'variables';
  if (_selection.kind !== 'variable' || _selection.owner !== 'global') {
    _selection = { kind: 'variables' };
  }
  renderSidebar();

  const container = document.getElementById('pageEditorContainer');
  if (!container) return;
  const global = _config.global || {};
  const stateCount = Object.keys(global.state || {}).length;
  const computedCount = Object.keys(global.computed || {}).length;

  container.innerHTML = `
    <div class="builder-shell variables-workspace">
      <section class="builder-main">
        <header class="workspace-header">
          <div>
            <span class="workspace-kicker">Application</span>
            <h3>Global variables</h3>
            <p>Values available to every screen and every script.</p>
          </div>
          <div class="workspace-summary">${stateCount + computedCount} variables</div>
        </header>
        <div class="workspace-content variables-workspace-content">
          <section class="variable-table-card">
            <div class="variable-table-head">
              <div><strong>State</strong><small>Stored values that controls and scripts may update</small></div>
              <button type="button" class="btn-small" data-action="addGlobalState">+ State</button>
            </div>
            <div id="globalStateWorkspace" class="variable-table"></div>
          </section>
          <section class="variable-table-card">
            <div class="variable-table-head">
              <div><strong>Computed</strong><small>Read-only expressions recalculated from other values</small></div>
              <button type="button" class="btn-small" data-action="addGlobalComputed">+ Computed</button>
            </div>
            <div id="globalComputedWorkspace" class="variable-table"></div>
          </section>
        </div>
      </section>
      <div class="panel-resize-handle inspector-resize-handle" data-inspector-resize role="separator" aria-label="Resize inspector"></div>
      <aside class="inspector-column">
        <div id="propertyPanel" class="property-panel"></div>
      </aside>
    </div>`;

  _installInspectorControls(container);
  const stateList = document.getElementById('globalStateWorkspace');
  const computedList = document.getElementById('globalComputedWorkspace');
  stateList.innerHTML = _renderVariableList(global, 'global', 'state');
  computedList.innerHTML = _renderVariableList(global, 'global', 'computed');
  _attachVariableActions(stateList, 'global');
  _attachVariableActions(computedList, 'global');
  container.querySelector('[data-action="addGlobalState"]').onclick = () => _selectVariable('global', 'state', null);
  container.querySelector('[data-action="addGlobalComputed"]').onclick = () => _selectVariable('global', 'computed', null);

  const propertyPanel = document.getElementById('propertyPanel');
  if (_selection.kind === 'variable') {
    _renderPropertyPanel();
  } else {
    propertyPanel.innerHTML = `<div class="property-empty property-placeholder">
      <span class="tree-icon tree-icon-variable">V</span>
      <strong>Select a variable</strong>
      <small>Its value, limits, or expression will appear here.</small>
    </div>`;
  }
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
    const selected = i === _selectedPageIndex;
    const active = selected && _activeWorkspace.startsWith('screen-') ? 'active' : '';
    const layoutActive = selected && _activeWorkspace === 'screen-layout' ? 'active' : '';
    const variablesActive = selected && _activeWorkspace === 'screen-variables' ? 'active' : '';
    return `<div class="page-tree-screen ${active}">
      <div class="page-item-sidebar ${active}" data-page-index="${i}">
      <span class="tree-icon tree-icon-page">▤</span>
      <span class="page-item-sidebar-name">${_esc(page.label || `Page ${i + 1}`)}</span>
      <span class="tree-issue-badge" data-page-issues="${i}" hidden>0</span>
      <div class="page-item-sidebar-actions">
        <button type="button" class="btn-icon" data-action="movePage" data-dir="-1" data-index="${i}" title="Up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn-icon" data-action="movePage" data-dir="1" data-index="${i}" title="Down" ${i === pages.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="btn-icon btn-danger" data-action="deletePage" data-index="${i}" title="Delete">x</button>
      </div>
      </div>
      <div class="page-tree-views">
        <button type="button" class="page-tree-view ${variablesActive}" data-page-index="${i}" data-workspace="variables">
          <span class="tree-view-icon">V</span><span>Variables</span>
          <span class="tree-count">${Object.keys(page.state || {}).length + Object.keys(page.computed || {}).length}</span>
        </button>
        <button type="button" class="page-tree-view ${layoutActive}" data-page-index="${i}" data-workspace="layout">
          <span class="tree-view-icon">▦</span><span>Interface</span>
          <span class="tree-count">${(page.layout || []).length}</span>
        </button>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.page-item-sidebar').forEach(item => {
    addTrackedListener(item, 'click', e => {
      if (e.target.closest('.page-item-sidebar-actions')) return;
      _selectPage(parseInt(item.dataset.pageIndex));
    });
  });

  container.querySelectorAll('.page-tree-view').forEach(item => {
    addTrackedListener(item, 'click', e => {
      e.stopPropagation();
      const index = parseInt(item.dataset.pageIndex);
      if (item.dataset.workspace === 'variables') _selectPageVariables(index);
      else _selectPage(index);
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
  _activeWorkspace = 'screen-layout';
  _selectedPageIndex = index;
  _selection = { kind: 'page' };
  renderSidebar();
  renderPagePanel(index);
}

function _selectPageVariables(index) {
  _activeWorkspace = 'screen-variables';
  _selectedPageIndex = index;
  _selection = { kind: 'page-variables' };
  renderSidebar();
  renderPageVariablesPanel(index);
}

export function renderPagePanel(pageIndex) {
  const container = document.getElementById('pageEditorContainer');
  if (!container) return;
  const page = _config?.pages?.[pageIndex];
  if (!page) {
    container.innerHTML = _emptyState('Invalid page');
    return;
  }
  _activeWorkspace = 'screen-layout';

  container.innerHTML = `
    <div class="builder-shell">
      <section class="builder-main">
        <div class="page-panel-header builder-header">
          <div class="input-group page-field">
            <label>Screen label</label>
            <input type="text" id="pageLabelInput" value="${_attr(page.label || '')}" placeholder="Screen name" />
          </div>
          <div class="input-group page-field">
            <label>Screen ID <small>Pages.${_esc(page.id || '')}</small></label>
            <input type="text" id="pageIdInput" value="${_attr(page.id || '')}" placeholder="screen_id" />
          </div>
        </div>

        <div class="page-section builder-layout-section">
          <div class="page-section-header">
            <span class="section-title">Interface hierarchy</span>
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
      <div class="panel-resize-handle inspector-resize-handle" data-inspector-resize role="separator" aria-label="Resize inspector"></div>
      <aside class="inspector-column">
        <div id="propertyPanel" class="property-panel"></div>
        <div class="page-section preview-panel">
          <div class="page-section-header">
            <span class="section-title">Preview <small>${Number(_config.global?.width) || 600} × ${Number(_config.global?.height) || 600}</small></span>
            <button type="button" class="btn-small btn-quiet" data-action="expandPreview">Expand</button>
          </div>
          <div id="pagePreview" class="page-preview"></div>
        </div>
      </aside>
    </div>`;

  _installInspectorControls(container);
  addTrackedListener(document.getElementById('pageLabelInput'), 'input', e => {
    page.label = e.target.value;
    _renderPageList();
    _notify();
  });
  addTrackedListener(document.getElementById('pageIdInput'), 'change', async e => {
    const previousId = page.id;
    const nextId = _uniquePageId(normalizePageId(e.target.value, page.id || `page_${pageIndex + 1}`), page);
    if (previousId !== nextId) {
      _renamePageIdReferences(previousId, nextId);
      await renameEvaluatedPageScope(previousId, nextId).catch(() => false);
    }
    page.id = nextId;
    e.target.value = page.id;
    _notify();
    renderPagePanel(pageIndex);
  });

  container.querySelector('[data-action="collapseAll"]').onclick = () => _setAllBuilderCollapsed(pageIndex, true);
  container.querySelector('[data-action="expandAll"]').onclick = () => _setAllBuilderCollapsed(pageIndex, false);
  container.querySelector('[data-action="expandPreview"]').onclick = () => _openPreviewOverlay(pageIndex);
  container.querySelector('[data-action="addRootElement"]').onclick = () => {
    const type = document.getElementById('addRootType').value;
    _addElement(pageIndex, null, type);
  };

  _renderPreview(pageIndex);
  _renderBuilder(pageIndex);
  _renderPropertyPanel();
}

function renderPageVariablesPanel(pageIndex) {
  const container = document.getElementById('pageEditorContainer');
  const page = _config.pages?.[pageIndex];
  if (!container || !page) return;

  _activeWorkspace = 'screen-variables';
  const stateCount = Object.keys(page.state || {}).length;
  const computedCount = Object.keys(page.computed || {}).length;
  container.innerHTML = `
    <div class="builder-shell variables-workspace page-variables-workspace">
      <section class="builder-main">
        <header class="workspace-header">
          <div>
            <span class="workspace-kicker">${_esc(page.label || `Screen ${pageIndex + 1}`)}</span>
            <h3>Screen variables</h3>
            <p>Values and expressions scoped to this screen · <code>Pages.${_esc(page.id)}.variable</code></p>
          </div>
          <div class="workspace-summary">${stateCount + computedCount} variables</div>
        </header>
        <div class="workspace-content variables-workspace-content">
          <section class="variable-table-card">
            <div class="variable-table-head">
              <div><strong>State</strong><small>Stored values that controls and scripts may update</small></div>
              <button type="button" class="btn-small" data-action="addPageState">+ State</button>
            </div>
            <div id="pageStateWorkspace" class="variable-table"></div>
          </section>
          <section class="variable-table-card">
            <div class="variable-table-head">
              <div><strong>Computed</strong><small>Read-only expressions recalculated from other values</small></div>
              <button type="button" class="btn-small" data-action="addPageComputed">+ Computed</button>
            </div>
            <div id="pageComputedWorkspace" class="variable-table"></div>
          </section>
        </div>
      </section>
      <div class="panel-resize-handle inspector-resize-handle" data-inspector-resize role="separator" aria-label="Resize inspector"></div>
      <aside class="inspector-column">
        <div id="propertyPanel" class="property-panel"></div>
      </aside>
    </div>`;

  _installInspectorControls(container);
  const stateList = document.getElementById('pageStateWorkspace');
  const computedList = document.getElementById('pageComputedWorkspace');
  stateList.innerHTML = _renderVariableList(page, pageIndex, 'state');
  computedList.innerHTML = _renderVariableList(page, pageIndex, 'computed');
  _attachVariableActions(stateList, pageIndex);
  _attachVariableActions(computedList, pageIndex);
  container.querySelector('[data-action="addPageState"]').onclick = () => _selectVariable(pageIndex, 'state', null);
  container.querySelector('[data-action="addPageComputed"]').onclick = () => _selectVariable(pageIndex, 'computed', null);

  const propertyPanel = document.getElementById('propertyPanel');
  if (_selection.kind === 'variable' && Number(_selection.owner) === pageIndex) {
    _renderPropertyPanel();
  } else {
    propertyPanel.innerHTML = `<div class="property-empty property-placeholder">
      <span class="tree-icon tree-icon-variable">V</span>
      <strong>Select a variable</strong>
      <small>Its value, limits, or expression will appear here.</small>
    </div>`;
  }
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
    const usageCount = _variableUsages(owner, name).length;
    const selected = _selection.kind === 'variable'
      && _selection.owner === owner
      && _selection.varKind === kind
      && _selection.name === name
      ? 'selected'
      : '';
    return `<div class="var-item ${selected}" data-action="selectVar" data-owner="${owner}" data-kind="${kind}" data-name="${_attr(name)}">
      <span class="var-key">${_esc(name)}</span>
      <span class="var-val" title="${_attr(desc)}">${_esc(_truncate(desc, 30))}</span>
      <span class="variable-usage-count" title="${usageCount} reference${usageCount === 1 ? '' : 's'}">${usageCount}</span>
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
    ? _renderBlockList(layout, [], pageIndex)
    : '<div class="builder-empty">No elements yet. Add a block above.</div>';
  _attachBuilderActions(builder, pageIndex);
  _attachBuilderDragDrop(builder, pageIndex);
}

function _renderBlockList(items, parentPath, pageIndex) {
  const zonesAndBlocks = [_renderDropZone(parentPath, 0)];
  items.forEach((item, index) => {
    zonesAndBlocks.push(_renderBlock(item, [...parentPath, index], pageIndex));
    zonesAndBlocks.push(_renderDropZone(parentPath, index + 1));
  });
  return zonesAndBlocks.join('');
}

function _renderDropZone(parentPath, index) {
  return `<div class="builder-drop-zone" data-drop-parent="${parentPath.join('.')}" data-drop-index="${index}" aria-hidden="true"><span>Move here</span></div>`;
}

function _renderPreview(pageIndex) {
  const preview = document.getElementById('pagePreview');
  if (!preview) return;
  const layout = _config.pages[pageIndex].layout || [];
  const previewWidth = Math.max(240, Number(_config.global?.width) || 600);
  const previewHeight = Math.max(240, Number(_config.global?.height) || 600);
  preview.style.setProperty('--preview-width', `${previewWidth}px`);
  preview.style.setProperty('--preview-height', `${previewHeight}px`);
  preview.innerHTML = layout.length
    ? `<div class="preview-fit-stage"><div class="live-preview-surface">${layout.map((item, idx) => _renderPreviewNode(item, [idx], pageIndex)).join('')}</div></div>`
    : '<div class="preview-empty">No layout yet</div>';
  if (layout.length) _fitPreviewToFrame(preview, previewWidth, previewHeight);
  _attachPreviewActions(preview, pageIndex);
}

function _fitPreviewToFrame(preview, previewWidth, previewHeight) {
  const stage = preview.querySelector('.preview-fit-stage');
  const surface = stage?.querySelector('.live-preview-surface');
  if (!stage || !surface) return;

  const fit = () => {
    const availableWidth = Math.max(1, preview.clientWidth - 4);
    const scale = Math.min(1, availableWidth / previewWidth);
    surface.style.width = `${previewWidth}px`;
    surface.style.minHeight = `${previewHeight}px`;
    surface.style.transform = `scale(${scale})`;
    stage.style.height = `${Math.ceil(Math.max(previewHeight, surface.scrollHeight) * scale)}px`;
    stage.style.setProperty('--preview-scale', String(scale));
  };

  window.requestAnimationFrame(fit);
  _previewResizeObserver?.disconnect();
  if (typeof ResizeObserver !== 'undefined') {
    _previewResizeObserver = new ResizeObserver(fit);
    _previewResizeObserver.observe(preview);
  }
}

function _renderPreviewNode(item, path, pageIndex) {
  const type = (item.type || 'unknown').toLowerCase();
  const pathStr = path.join('.');
  const selected = _selection.kind === 'element' && _samePath(_selection.path, path) ? 'selected' : '';
  const children = _getChildren(item) || [];
  const colorVars = [];
  if (item.color) {
    colorVars.push(`--component-color:${_attr(item.color)}`);
    colorVars.push(`--component-contrast:${_contrastColor(item.color)}`);
  }
  if (item.borderColor) colorVars.push(`--component-border:${_attr(item.borderColor)}`);
  const colorStyle = colorVars.length ? ` style="${colorVars.join(';')}"` : '';
  const colorClasses = `${item.color ? 'has-custom-color' : ''} ${item.borderColor ? 'has-custom-border' : ''}`;
  const shell = content => `<div class="live-component live-${_attr(type)} ${selected} ${colorClasses}" data-preview-path="${pathStr}" title="${_attr(`${type}: ${_blockLabel(item)}`)}"${colorStyle}>${content}</div>`;

  if (CONTAINER_TYPES.has(type)) {
    const columns = Math.min(12, Math.max(1, Number(item.columns) || 4));
    const style = type === 'matrix' ? ` style="--preview-columns:${columns};--preview-gap:${_attr(item.gap || '4px')}"` : '';
    return shell(`<div class="live-container live-container-${type}"${style}>${children.length
      ? children.map((child, index) => _renderPreviewNode(child, [...path, index], pageIndex)).join('')
      : '<span class="live-empty">Empty</span>'}</div>`);
  }

  const value = _previewVariableValue(item.var, pageIndex);
  switch (type) {
    case 'title': return shell(`<h3>${_esc(item.text || 'Title')}</h3>`);
    case 'text': return shell(`<div class="live-markdown">${parseMd(item.text || 'Text')}</div>`);
    case 'divider': return shell('<hr />');
    case 'button': return shell(`<button type="button" tabindex="-1">${_esc(item.label || 'Button')}</button>`);
    case 'matrixbutton': return shell(`<button type="button" class="live-matrix-button" tabindex="-1">${_esc(item.icon || item.label || '•')}</button>`);
    case 'value': return shell(`<label>${_esc(item.label || item.var || 'Value')}</label><output>${_esc(value)}</output>`);
    case 'input': return shell(`<label>${_esc(item.label || item.var || 'Input')}</label><input tabindex="-1" value="${_attr(value)}" placeholder="${_attr(item.placeholder || '')}" readonly />`);
    case 'counter': return shell(`<label>${_esc(item.label || item.var || 'Counter')}</label><div class="live-counter"><button tabindex="-1">−</button><strong>${_esc(value)}</strong><button tabindex="-1">+</button></div>`);
    case 'checkbox': return shell(`<label class="live-check"><input type="checkbox" tabindex="-1" ${value === true || value === 'true' ? 'checked' : ''} /> ${_esc(item.label || item.var || 'Checkbox')}</label>`);
    case 'toggle': return shell(`<div class="live-toggle"><span>${_esc(item.label || item.var || 'Toggle')}</span><i class="${value ? 'on' : ''}"></i></div>`);
    case 'dropdown': return shell(`<label>${_esc(item.label || item.var || 'Select')}</label><select tabindex="-1"><option>${_esc(value || item.options?.[0]?.label || item.options?.[0] || 'Select…')}</option></select>`);
    default: return shell(`<span>${_esc(_blockLabel(item))}</span>`);
  }
}

function _contrastColor(value) {
  const raw = String(value || '').trim();
  let red;
  let green;
  let blue;
  const hex = _normalizeColorForPicker(raw);
  if (hex) {
    red = parseInt(hex.slice(1, 3), 16);
    green = parseInt(hex.slice(3, 5), 16);
    blue = parseInt(hex.slice(5, 7), 16);
  } else {
    const rgb = raw.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
    if (!rgb) return 'var(--text)';
    [, red, green, blue] = rgb.map(Number);
  }
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 > 0.5 ? '#111' : '#fff';
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

function _previewVariableValue(name, pageIndex) {
  if (!name) return '—';
  const page = _config.pages?.[pageIndex] || {};
  const entry = page.state?.[name] ?? _config.global?.state?.[name];
  if (entry !== undefined) {
    const value = entry && typeof entry === 'object' && 'default' in entry ? entry.default : entry;
    return _formatValueForInput(value);
  }
  const computed = page.computed?.[name] ?? _config.global?.computed?.[name];
  if (computed !== undefined) return 'ƒ Calculated value';
  return `? ${name}`;
}

function _openPreviewOverlay(pageIndex) {
  const page = _config.pages?.[pageIndex];
  if (!page) return;
  document.getElementById('studioPreviewOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'studioPreviewOverlay';
  overlay.className = 'preview-overlay';
  overlay.innerHTML = `<div class="preview-overlay-window" role="dialog" aria-modal="true" aria-label="Screen preview">
    <header><div><span class="workspace-kicker">Live preview</span><strong>${_esc(page.label || 'Screen')}</strong></div><button type="button" class="close-modal" aria-label="Close preview">×</button></header>
    <div class="preview-overlay-canvas" style="--preview-width:${Number(_config.global?.width) || 600}px;--preview-height:${Number(_config.global?.height) || 600}px">
      <div class="live-preview-surface">${(page.layout || []).map((item, index) => _renderPreviewNode(item, [index], pageIndex)).join('') || '<div class="preview-empty">No layout yet</div>'}</div>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.close-modal').onclick = close;
  overlay.onclick = event => { if (event.target === overlay) close(); };
  _attachPreviewActions(overlay, pageIndex);
  overlay.querySelector('.close-modal').focus();
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
      <span class="builder-drag-handle" title="Drag to move" aria-label="Drag to move">&#8942;&#8942;</span>
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
    <div class="builder-child-list" data-drop-parent="${pathStr}">
      ${children.length ? _renderBlockList(children, path, pageIndex) : `${_renderDropZone(path, 0)}<div class="builder-empty small">Empty container</div>`}
    </div>
    <div class="builder-outdent-zone" data-drop-outside="${pathStr}" aria-hidden="true"><span>Move outside container</span></div>
  </div>`;
}

function _attachBuilderActions(container, pageIndex) {
  container.querySelectorAll('[data-action]').forEach(el => {
    addTrackedListener(el, 'click', e => {
      if (Date.now() < _suppressBuilderClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
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

function _attachBuilderDragDrop(container, pageIndex) {
  _builderDragControllers.get(container)?.abort();
  const dragController = new AbortController();
  _builderDragControllers.set(container, dragController);
  const listenerOptions = { signal: dragController.signal };
  let pointerSession = null;

  const clearIndicators = () => {
    container.classList.remove('is-dragging');
    container.querySelectorAll('.dragging, .drop-active, .drop-disabled, .drop-inside').forEach(node => {
      node.classList.remove('dragging', 'drop-active', 'drop-disabled', 'drop-inside');
    });
    _dropTarget = null;
  };

  const refreshDropZones = () => {
    container.querySelectorAll('.builder-drop-zone').forEach(zone => {
      const spec = _dropSpecFromZone(zone);
      zone.classList.toggle('drop-disabled', !_canDropAt(pageIndex, _draggedElement.path, spec.parentPath, spec.index));
    });
    container.querySelectorAll('.builder-outdent-zone').forEach(zone => {
      const spec = _dropSpecFromOutdent(zone);
      zone.classList.toggle('drop-disabled', !_canDropAt(pageIndex, _draggedElement.path, spec.parentPath, spec.index));
    });
  };

  const startPointerDrag = session => {
    session.started = true;
    _draggedElement = { pageIndex, path: [...session.path] };
    session.block.classList.add('dragging');
    container.classList.add('is-dragging');
    document.documentElement.classList.add('builder-pointer-dragging');
    refreshDropZones();
  };

  const updatePointerTarget = event => {
    const hitTarget = document.elementFromPoint(event.clientX, event.clientY);
    const spec = _resolveDropSpec(event, container, pageIndex, hitTarget);
    if (!spec || !_canDropAt(pageIndex, _draggedElement.path, spec.parentPath, spec.index)) {
      if (_dropTarget && _pointNearIndicator(event, _dropTarget.indicator)) return;
      _clearActiveDropIndicator(container);
      return;
    }
    if (_sameDropTarget(_dropTarget, spec)) return;
    _clearActiveDropIndicator(container);
    spec.indicator?.classList.add(spec.inside ? 'drop-inside' : 'drop-active');
    _dropTarget = spec;
  };

  const finishPointerDrag = (event = null, commit = false) => {
    const session = pointerSession;
    if (!session) return;

    let spec = null;
    if (commit && session.started && event) {
      const hitTarget = document.elementFromPoint(event.clientX, event.clientY);
      const resolvedSpec = _resolveDropSpec(event, container, pageIndex, hitTarget);
      const resolvedIsValid = resolvedSpec
        && _canDropAt(pageIndex, session.path, resolvedSpec.parentPath, resolvedSpec.index);
      spec = resolvedIsValid
        ? resolvedSpec
        : (hitTarget && container.contains(hitTarget) ? _dropTarget : null);
    }

    pointerSession = null;
    _draggedElement = null;
    document.documentElement.classList.remove('builder-pointer-dragging');
    if (session.started) _suppressBuilderClickUntil = Date.now() + 250;
    clearIndicators();

    try {
      if (session.handle.hasPointerCapture?.(session.pointerId)) {
        session.handle.releasePointerCapture(session.pointerId);
      }
    } catch {
      // Pointer capture may already have been released by the browser.
    }

    if (spec && _canDropAt(pageIndex, session.path, spec.parentPath, spec.index)) {
      _moveElementToPosition(pageIndex, session.path, spec.parentPath, spec.index);
    }
  };

  container.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    const handle = event.target.closest('.builder-drag-handle');
    const block = handle?.closest('.builder-block');
    if (!handle || !block || !container.contains(block)) return;

    event.preventDefault();
    event.stopPropagation();
    pointerSession = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      path: _pathFromDataset(block.dataset.path),
      block,
      handle,
      started: false,
    };
    handle.setPointerCapture?.(event.pointerId);
  }, listenerOptions);

  container.addEventListener('pointermove', event => {
    if (!pointerSession || event.pointerId !== pointerSession.pointerId) return;
    event.preventDefault();
    if (!pointerSession.started) {
      const distance = Math.hypot(
        event.clientX - pointerSession.startX,
        event.clientY - pointerSession.startY,
      );
      if (distance < 4) return;
      startPointerDrag(pointerSession);
    }
    updatePointerTarget(event);
  }, listenerOptions);

  container.addEventListener('pointerup', event => {
    if (!pointerSession || event.pointerId !== pointerSession.pointerId) return;
    if (pointerSession.started) event.preventDefault();
    finishPointerDrag(event, true);
  }, listenerOptions);

  container.addEventListener('pointercancel', event => {
    if (!pointerSession || event.pointerId !== pointerSession.pointerId) return;
    finishPointerDrag();
  }, listenerOptions);

  container.addEventListener('lostpointercapture', event => {
    if (!pointerSession || event.pointerId !== pointerSession.pointerId) return;
    finishPointerDrag();
  }, listenerOptions);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !pointerSession) return;
    event.preventDefault();
    finishPointerDrag();
  }, listenerOptions);

  window.addEventListener('blur', () => finishPointerDrag(), listenerOptions);
  dragController.signal.addEventListener('abort', () => finishPointerDrag(), { once: true });
}

function _resolveDropSpec(event, container, pageIndex, eventTarget = event.target) {
  if (!eventTarget?.closest) return null;
  const outdent = eventTarget.closest('.builder-outdent-zone');
  if (outdent && container.contains(outdent)) {
    return { ..._dropSpecFromOutdent(outdent), indicator: outdent, inside: false };
  }
  const zone = eventTarget.closest('.builder-drop-zone');
  if (zone && container.contains(zone)) return { ..._dropSpecFromZone(zone), indicator: zone, inside: false };

  const head = eventTarget.closest('.builder-block-head');
  const block = head?.closest('.builder-block') || eventTarget.closest('.builder-block');
  if (block && container.contains(block)) {
    const targetPath = _pathFromDataset(block.dataset.path);
    const item = _getNodeAt(_config.pages[pageIndex].layout, targetPath);
    if (_isContainer(item)) {
      return {
        parentPath: targetPath,
        index: (_getChildren(item) || []).length,
        indicator: block,
        inside: true,
      };
    }
    const rect = block.getBoundingClientRect();
    const after = event.clientY >= rect.top + rect.height / 2;
    return {
      parentPath: targetPath.slice(0, -1),
      index: targetPath[targetPath.length - 1] + (after ? 1 : 0),
      indicator: _findDropZone(container, targetPath.slice(0, -1), targetPath[targetPath.length - 1] + (after ? 1 : 0)),
      inside: false,
    };
  }

  const childList = eventTarget.closest('.builder-child-list');
  if (childList && container.contains(childList)) {
    const parentPath = _pathFromDataset(childList.dataset.dropParent);
    const parent = _getNodeAt(_config.pages[pageIndex].layout, parentPath);
    return {
      parentPath,
      index: (_getChildren(parent) || []).length,
      indicator: childList,
      inside: true,
    };
  }

  if (container.contains(eventTarget)) {
    return {
      parentPath: [],
      index: _config.pages[pageIndex].layout.length,
      indicator: _findDropZone(container, [], _config.pages[pageIndex].layout.length) || container,
      inside: false,
    };
  }
  return null;
}

function _dropSpecFromOutdent(zone) {
  const containerPath = _pathFromDataset(zone.dataset.dropOutside);
  return {
    parentPath: containerPath.slice(0, -1),
    index: containerPath[containerPath.length - 1] + 1,
  };
}

function _dropSpecFromZone(zone) {
  return {
    parentPath: _pathFromDataset(zone.dataset.dropParent),
    index: Number(zone.dataset.dropIndex) || 0,
  };
}

function _sameDropTarget(previous, next) {
  return Boolean(previous && next)
    && previous.indicator === next.indicator
    && previous.index === next.index
    && previous.inside === next.inside
    && _samePath(previous.parentPath, next.parentPath);
}

function _clearActiveDropIndicator(container) {
  container.querySelectorAll('.drop-active, .drop-inside').forEach(node => {
    node.classList.remove('drop-active', 'drop-inside');
  });
  _dropTarget = null;
}

function _pointNearIndicator(event, indicator, margin = 7) {
  if (!indicator?.getBoundingClientRect) return false;
  const rect = indicator.getBoundingClientRect();
  return event.clientX >= rect.left - margin
    && event.clientX <= rect.right + margin
    && event.clientY >= rect.top - margin
    && event.clientY <= rect.bottom + margin;
}

function _findDropZone(container, parentPath, index) {
  const parent = parentPath.join('.');
  return [...container.querySelectorAll('.builder-drop-zone')].find(zone => (
    zone.dataset.dropParent === parent && Number(zone.dataset.dropIndex) === index
  )) || null;
}

function _pathFromDataset(value) {
  return String(value || '').split('.').filter(Boolean).map(Number);
}

function _canDropAt(pageIndex, sourcePath, parentPath, index) {
  const root = _config.pages[pageIndex]?.layout;
  return _canDropInLayout(root, sourcePath, parentPath, index);
}

function _canDropInLayout(root, sourcePath, parentPath, index) {
  const source = _getNodeAt(root, sourcePath);
  if (!root || !source || !Array.isArray(parentPath)) return false;
  if (_samePath(parentPath, sourcePath) || _isDescendantPath(parentPath, sourcePath)) return false;
  const parent = parentPath.length ? _getNodeAt(root, parentPath) : null;
  if (parentPath.length && !_isContainer(parent)) return false;
  if (!_canPlaceInParent(source, parent)) return false;

  return true;
}

export function moveLayoutElement(layout, sourcePath, parentPath, requestedIndex) {
  if (!_canDropInLayout(layout, sourcePath, parentPath, requestedIndex)) return null;
  const source = _getNodeAt(layout, sourcePath);
  const sourceLocation = _findNodeLocation(layout, source);
  const parent = parentPath.length ? _getNodeAt(layout, parentPath) : null;
  const destination = parent ? _ensureChildren(parent) : layout;
  if (!sourceLocation) return null;

  let insertIndex = Math.max(0, Math.min(Number(requestedIndex) || 0, destination.length));
  if (sourceLocation.array === destination && sourceLocation.index < insertIndex) insertIndex -= 1;
  if (sourceLocation.array === destination && sourceLocation.index === insertIndex) {
    return { item: source, path: [...sourcePath], moved: false };
  }
  sourceLocation.array.splice(sourceLocation.index, 1);
  destination.splice(insertIndex, 0, source);
  return { item: source, path: _findPathByReference(layout, source), moved: true };
}

function _moveElementToPosition(pageIndex, sourcePath, parentPath, requestedIndex) {
  const root = _config.pages[pageIndex].layout;
  if (!_canDropAt(pageIndex, sourcePath, parentPath, requestedIndex)) return;
  const collapsedItems = _collectContainerPaths(root)
    .filter(path => _isBuilderCollapsed(pageIndex, path))
    .map(path => _getNodeAt(root, path))
    .filter(Boolean);

  const result = moveLayoutElement(root, sourcePath, parentPath, requestedIndex);
  if (!result) return;
  if (!result.moved) return;

  const pageKeyPrefix = `${_config.pages[pageIndex]?.id || pageIndex}:`;
  [..._collapsedBuilderPaths].forEach(key => {
    if (key.startsWith(pageKeyPrefix)) _collapsedBuilderPaths.delete(key);
  });
  collapsedItems.forEach(item => {
    const path = _findPathByReference(root, item);
    if (path) _collapsedBuilderPaths.add(_builderCollapseKey(pageIndex, path));
  });

  _selection = { kind: 'element', path: result.path || [0] };
  _notify();
  renderPagePanel(pageIndex);
}

function _canPlaceInParent(item, parent) {
  const isMatrixButton = String(item?.type || '').toLowerCase() === 'matrixbutton';
  const isMatrixParent = String(parent?.type || '').toLowerCase() === 'matrix';
  return isMatrixButton === isMatrixParent;
}

function _findNodeLocation(items, target, parent = null) {
  for (let index = 0; index < (items || []).length; index += 1) {
    const item = items[index];
    if (item === target) return { array: items, index, parent };
    const nested = _findNodeLocation(_getChildren(item) || [], target, item);
    if (nested) return nested;
  }
  return null;
}

function _findPathByReference(items, target, basePath = []) {
  for (let index = 0; index < (items || []).length; index += 1) {
    const item = items[index];
    const path = [...basePath, index];
    if (item === target) return path;
    const nested = _findPathByReference(_getChildren(item) || [], target, path);
    if (nested) return nested;
  }
  return null;
}

function _renderPropertyPanel() {
  const panel = document.getElementById('propertyPanel');
  if (!panel) return;
  if (_selection.kind === 'variable') {
    panel.innerHTML = _renderVariableInspector();
    _attachVariableInspector();
    enhanceCodeEditors(panel, { variables: _scriptCompletionVariables() });
    return;
  }
  if (_selection.kind === 'element') {
    panel.innerHTML = _renderElementInspector();
    _attachElementInspector();
    enhanceCodeEditors(panel, { variables: _scriptCompletionVariables() });
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
  const referencesHtml = isNew ? '' : _renderVariableReferences(owner, name);
  const accessHtml = isNew ? '' : _renderVariableAccess(owner, name);

  if (varKind === 'computed') {
    const expr = typeof entry === 'string' ? entry : entry?.eval || '';
    return `<div class="property-header"><span class="section-title">${_esc(title)}</span></div>
      ${accessHtml}
      <div class="input-group"><label>Name</label><input id="varNameInput" type="text" value="${_attr(name || '')}" /></div>
      <div class="input-group"><label>Expression</label><textarea id="varExpressionInput" class="inspector-expression" data-editor-lang="javascript">${_esc(expr)}</textarea></div>
      <div class="row-2">
        <div class="input-group"><label>Min</label><input id="varMinInput" type="number" value="${_attr(entry?.min ?? '')}" /></div>
        <div class="input-group"><label>Max</label><input id="varMaxInput" type="number" value="${_attr(entry?.max ?? '')}" /></div>
      </div>
      ${referencesHtml}
      <div class="property-actions">
        <button type="button" id="saveVariableInspector">Save</button>
        <button type="button" class="btn-danger" id="cancelInspector">Cancel</button>
      </div>`;
  }

  const defaultValue = entry && typeof entry === 'object' && 'default' in entry ? entry.default : null;
  return `<div class="property-header"><span class="section-title">${_esc(title)}</span></div>
    ${accessHtml}
    <div class="input-group"><label>Name</label><input id="varNameInput" type="text" value="${_attr(name || '')}" /></div>
    <div class="input-group"><label>Default Value (JSON or text)</label><input id="varDefaultInput" type="text" value="${_attr(_formatValueForInput(defaultValue))}" /></div>
    <div class="row-2">
      <div class="input-group"><label>Min</label><input id="varMinInput" type="number" value="${_attr(entry?.min ?? '')}" /></div>
      <div class="input-group"><label>Max</label><input id="varMaxInput" type="number" value="${_attr(entry?.max ?? '')}" /></div>
    </div>
    ${referencesHtml}
    <div class="property-actions">
      <button type="button" id="saveVariableInspector">Save</button>
      <button type="button" class="btn-danger" id="cancelInspector">Cancel</button>
    </div>`;
}

function _attachVariableInspector() {
  document.getElementById('cancelInspector').onclick = () => {
    const wasGlobal = _selection.owner === 'global';
    if (wasGlobal) {
      _selection = { kind: 'variables' };
      _showGlobalVariablesWorkspace();
      return;
    }
    _selection = { kind: 'page-variables' };
    if (_selectedPageIndex !== null) renderPageVariablesPanel(_selectedPageIndex);
  };
  document.getElementById('saveVariableInspector').onclick = () => _saveVariableFromInspector();
  document.querySelectorAll('#propertyPanel [data-copy-variable-path]').forEach(button => {
    button.onclick = async () => {
      const path = button.dataset.copyVariablePath;
      try {
        await navigator.clipboard.writeText(path);
        button.textContent = 'Copied';
      } catch {
        button.textContent = path;
      }
    };
  });
  document.querySelectorAll('#propertyPanel [data-variable-reference]').forEach(button => {
    button.onclick = () => {
      const pageIndex = Number(button.dataset.pageIndex);
      const path = button.dataset.path.split('.').map(Number);
      _selectPage(pageIndex);
      _focusElementPath(pageIndex, path);
    };
  });
}

function _renderVariableAccess(owner, name) {
  const paths = owner === 'global'
    ? [`Global.${name}`]
    : [`Page.${name}`, `Pages.${_config.pages[Number(owner)]?.id}.${name}`];
  return `<div class="variable-access-paths">
    <span>Script access</span>
    ${paths.map(path => `<button type="button" class="variable-access-path" data-copy-variable-path="${_attr(path)}" title="Copy reference"><code>${_esc(path)}</code></button>`).join('')}
  </div>`;
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

  _attachInspectorColorInputs(element);
}

function _attachInspectorColorInputs(element) {
  const panel = document.getElementById('propertyPanel');
  panel?.querySelectorAll('[data-color-toggle]').forEach(toggle => {
    const prop = toggle.dataset.colorToggle;
    const picker = panel.querySelector(`[data-color-picker="${prop}"]`);
    const code = panel.querySelector(`[data-color-code="${prop}"]`);
    if (!picker || !code) return;

    const setEnabled = enabled => {
      picker.disabled = !enabled;
      code.disabled = !enabled;
      if (enabled) {
        const value = code.value.trim() || picker.value || '#c8adff';
        code.value = value;
        element[prop] = value;
      } else {
        delete element[prop];
      }
      _syncAfterElementEdit();
    };

    addTrackedListener(toggle, 'change', () => setEnabled(toggle.checked));
    addTrackedListener(picker, 'input', () => {
      code.value = picker.value.toUpperCase();
      code.classList.remove('invalid');
      element[prop] = picker.value;
      _syncAfterElementEdit();
    });
    addTrackedListener(code, 'input', () => {
      const value = code.value.trim();
      const pickerValue = _normalizeColorForPicker(value);
      code.classList.toggle('invalid', Boolean(value) && !CSS.supports('color', value));
      if (pickerValue) picker.value = pickerValue;
      if (value) element[prop] = value;
      else delete element[prop];
      _syncAfterElementEdit();
    });
  });
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
        ${_textareaInput('Tooltip', 'tooltip', e.tooltip, { rows: 3, lang: 'markdown' })}
        ${_colorInput('Color', 'color', e.color)}
        ${_commandInput('onclick', 'onclick', e.onclick)}
        ${_commandInput('onrightclick', 'onrightclick', e.onrightclick)}`;
    case 'value':
      return `${_bindingSelect('Read from', e.var, 'all')}${_textInput('Label', 'label', e.label)}`;
    case 'input':
      return `${_bindingSelect('Bind to', e.var, 'state')}${_textInput('Label', 'label', e.label)}${_textInput('Placeholder', 'placeholder', e.placeholder)}${_commandInput('onupdate', 'onupdate', e.onupdate)}`;
    case 'counter':
      return `${_bindingSelect('Bind to', e.var, 'state')}${_textInput('Label', 'label', e.label)}${_numberInput('Step', 'step', e.step)}${_colorInput('Color', 'color', e.color)}${_commandInput('onupdate', 'onupdate', e.onupdate)}`;
    case 'checkbox':
    case 'toggle':
      return `${_bindingSelect('Bind to', e.var, 'state')}${_textInput('Label', 'label', e.label)}${_colorInput('Color', 'color', e.color)}${_commandInput('onupdate', 'onupdate', e.onupdate)}`;
    case 'dropdown':
      return `${_bindingSelect('Bind to', e.var, 'state')}${_textInput('Label', 'label', e.label)}${_optionsInput(e.options)}${_commandInput('onupdate', 'onupdate', e.onupdate)}`;
    case 'title':
      return `${_textInput('Text', 'text', e.text)}${_colorInput('Color', 'color', e.color)}`;
    case 'text':
      return `${_textareaInput('Text', 'text', e.text, { rows: 8, lang: 'markdown' })}`;
    case 'divider':
      return `${_colorInput('Color', 'color', e.color)}${_textInput('Height', 'height', e.height)}${_textInput('Margin', 'margin', e.margin)}${_selectInput('Style', 'style', e.style, [['', 'Default'], ['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']])}`;
    case 'row':
      return '<p class="property-help">Row keeps its children on one horizontal line. Add children from the block card.</p>';
    case 'stack':
      return `${_checkboxInput('Border', 'border', e.border)}${_colorInput('Color', 'color', e.color)}<p class="property-help">Stack lays children vertically.</p>`;
    case 'matrix':
      return `${_numberInput('Columns', 'columns', e.columns ?? 4)}${_textInput('Button size', 'buttonSize', e.buttonSize ?? '40px')}${_textInput('Gap', 'gap', e.gap ?? '4px')}${_selectInput('Button shape', 'buttonShape', e.buttonShape || 'square', [['square', 'Square'], ['rectangle', 'Rectangle']])}${_checkboxInput('Border', 'border', e.border)}${_colorInput('Color', 'color', e.color)}`;
    case 'matrixbutton':
      return `${_textInput('Label', 'label', e.label)}${_textInput('Icon', 'icon', e.icon)}${_textareaInput('Tooltip', 'tooltip', e.tooltip, { rows: 3, lang: 'markdown' })}${_colorInput('Color', 'color', e.color)}${_colorInput('Border color', 'borderColor', e.borderColor)}${_commandInput('onclick', 'onclick', e.onclick)}${_commandInput('onrightclick', 'onrightclick', e.onrightclick)}`;
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
  const lang = options.lang ? ` data-editor-lang="${_attr(options.lang)}"` : '';
  return `<div class="input-group"><label>${_esc(label)}</label><textarea data-prop="${prop}" rows="${options.rows || 4}"${lang}>${_esc(value || '')}</textarea></div>`;
}

function _checkboxInput(label, prop, value) {
  return `<div class="input-group"><label class="checkbox-label"><input type="checkbox" data-prop="${prop}" ${value ? 'checked' : ''} /> ${_esc(label)}</label></div>`;
}

function _selectInput(label, prop, value, options) {
  return `<div class="input-group"><label>${_esc(label)}</label><select data-prop="${prop}">
    ${options.map(([v, l]) => `<option value="${_attr(v)}" ${String(value ?? '') === String(v) ? 'selected' : ''}>${_esc(l)}</option>`).join('')}
  </select></div>`;
}

function _colorInput(label, prop, value) {
  const enabled = !!value;
  const pickerValue = _normalizeColorForPicker(value) || '#c8adff';
  return `<div class="input-group inspector-color-field">
    <div class="inspector-color-head">
      <label for="inspector-${_attr(prop)}-code">${_esc(label)}</label>
      <label class="checkbox-label"><input type="checkbox" data-color-toggle="${_attr(prop)}" ${enabled ? 'checked' : ''} /> Custom</label>
    </div>
    <div class="inspector-color-row">
      <input type="color" data-color-picker="${_attr(prop)}" value="${_attr(pickerValue)}" aria-label="Pick ${_attr(label)}" ${enabled ? '' : 'disabled'} />
      <input type="text" id="inspector-${_attr(prop)}-code" data-color-code="${_attr(prop)}" value="${_attr(value || pickerValue)}" placeholder="#C8ADFF" aria-label="${_attr(label)} HTML code" ${enabled ? '' : 'disabled'} />
    </div>
  </div>`;
}

function _normalizeColorForPicker(value) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/i.test(raw)) return `#${raw.slice(1).split('').map(char => char + char).join('')}`;
  return '';
}

function _commandInput(label, prop, commands) {
  return `<div class="input-group"><label>${_esc(label)}</label><textarea data-command-prop="${prop}" data-editor-lang="javascript" rows="5">${_esc(dedentCommandList(commands || []).join('\n'))}</textarea></div>`;
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
  let selectedUsed = false;
  const optionGroups = _bindingOptionGroups(mode).map(group => {
    if (group.names.length === 0) return '';
    return `<optgroup label="${_attr(group.label)}">
      ${group.names.map(name => {
        const selected = !selectedUsed && name === value;
        if (selected) selectedUsed = true;
        return `<option value="${_attr(name)}" ${selected ? 'selected' : ''}>${_esc(name)} · ${_esc(group.shortLabel)}</option>`;
      }).join('')}
    </optgroup>`;
  }).join('');

  return `<div class="input-group"><label>${_esc(label)}</label><select data-prop="var">
    <option value="">Select variable...</option>
    ${optionGroups}
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
  if (owner === 'global') {
    _showGlobalVariablesWorkspace();
    return;
  }
  _selectedPageIndex = Number(owner);
  _activeWorkspace = 'screen-variables';
  renderSidebar();
  renderPageVariablesPanel(_selectedPageIndex);
}

function _saveVariableFromInspector() {
  const { owner, varKind, name } = _selection;
  const scope = _getScope(owner);
  const nextName = document.getElementById('varNameInput').value.trim();
  if (!nextName) {
    alert('Variable name is required.');
    return;
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(nextName)) {
    alert('Variable names must be valid JavaScript identifiers (letters, digits, _ or $, and cannot start with a digit).');
    return;
  }
  if (nextName !== name && (Object.prototype.hasOwnProperty.call(scope.state || {}, nextName) || Object.prototype.hasOwnProperty.call(scope.computed || {}, nextName))) {
    alert(`Variable "${nextName}" already exists.`);
    return;
  }

  if (name && name !== nextName) {
    _renameVariableReferences(owner, name, nextName);
    delete scope[varKind][name];
  }
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
  if (owner === 'global') _showGlobalVariablesWorkspace();
  else if (_selectedPageIndex !== null) renderPageVariablesPanel(_selectedPageIndex);
}

function _deleteVariable(owner, kind, name) {
  if (!name) return;
  const usageCount = _variableUsages(owner, name).length;
  const warning = usageCount
    ? `Delete ${kind} variable "${name}"? It still has ${usageCount} reference${usageCount === 1 ? '' : 's'}.`
    : `Delete ${kind} variable "${name}"?`;
  if (!confirm(warning)) return;
  const scope = _getScope(owner);
  delete scope[kind][name];
  _syncRuntimeVariables(scope);
  _selection = owner === 'global' ? { kind: 'variables' } : { kind: 'page-variables' };
  _notify();
  renderSidebar();
  if (owner === 'global') _showGlobalVariablesWorkspace();
  else if (_selectedPageIndex !== null) renderPageVariablesPanel(_selectedPageIndex);
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
    id: _uniquePageId(`page_${_config.pages.length + 1}`),
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
  if (_selectedPageIndex >= 0 && _config.pages.length > 0) {
    if (_activeWorkspace === 'screen-variables') renderPageVariablesPanel(_selectedPageIndex);
    else renderPagePanel(_selectedPageIndex);
  }
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
  if (_activeWorkspace === 'screen-variables') renderPageVariablesPanel(_selectedPageIndex);
  else renderPagePanel(_selectedPageIndex);
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

function _scriptCompletionVariables() {
  const groups = _bindingOptionGroups('all').filter(group => (
    _selection.kind !== 'variable' || _selection.owner !== 'global' || group.shortLabel.startsWith('global')
  ));
  const localVariables = groups.flatMap(group => group.names.map(name => ({
    name,
    scope: group.shortLabel.startsWith('global') ? 'Global' : 'Page',
    detail: `${group.label}${group.shortLabel.includes('computed') ? ' · read-only' : ' · writable'}`,
    info: `${group.label} variable available as ${group.shortLabel.startsWith('global') ? 'Global' : 'Page'}.${name}.`,
  })));
  const pageVariables = (_config.pages || []).flatMap((page, pageIndex) => [
    ...Object.keys(page.state || {}).map(name => ({
      name,
      scope: 'Pages',
      pageKey: page.id,
      pageLabel: page.label || `Page ${pageIndex + 1}`,
      detail: `${page.label || page.id} State · writable`,
      info: `State variable available from every screen as Pages.${page.id}.${name}.`,
    })),
    ...Object.keys(page.computed || {}).map(name => ({
      name,
      scope: 'Pages',
      pageKey: page.id,
      pageLabel: page.label || `Page ${pageIndex + 1}`,
      detail: `${page.label || page.id} Computed · read-only`,
      info: `Computed variable available from every screen as Pages.${page.id}.${name}.`,
    })),
  ]);
  return [...localVariables, ...pageVariables];
}

function _bindingOptionGroups(mode) {
  const page = _config.pages?.[_selectedPageIndex] || {};
  const groups = [
    { label: 'Global State', shortLabel: 'global state', names: Object.keys(_config.global?.state || {}) },
    { label: 'Page State', shortLabel: 'page state', names: Object.keys(page.state || {}) },
  ];
  if (mode !== 'state') {
    groups.push(
      { label: 'Global Computed', shortLabel: 'global computed', names: Object.keys(_config.global?.computed || {}) },
      { label: 'Page Computed', shortLabel: 'page computed', names: Object.keys(page.computed || {}) },
    );
  }
  return groups;
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

function _variableUsages(owner, name) {
  if (!name) return [];
  const usages = [];
  const ownerIndex = owner === 'global' ? null : Number(owner);
  const ownerPageId = ownerIndex === null ? null : _config.pages?.[ownerIndex]?.id;
  const pages = (_config.pages || []).map((page, pageIndex) => ({ page, pageIndex }));
  const referenced = (source, pageIndex) => {
    if (owner === 'global') return _containsPath(source, `Global.${name}`);
    return (pageIndex === ownerIndex && _containsPath(source, `Page.${name}`))
      || _containsPath(source, `Pages.${ownerPageId}.${name}`);
  };

  pages.forEach(({ page, pageIndex }) => {
    if (!page) return;
    _walkLayout(page.layout, (item, path) => {
      const fields = [];
      if ((owner === 'global' || pageIndex === ownerIndex) && item.var === name) fields.push('binding');
      ['onclick', 'onrightclick', 'onupdate'].forEach(prop => {
        const source = Array.isArray(item[prop]) ? item[prop].join('\n') : String(item[prop] || '');
        if (referenced(source, pageIndex)) fields.push(prop);
      });
      ['label', 'text', 'content', 'tooltip', 'placeholder'].forEach(prop => {
        if (referenced(item[prop], pageIndex)) fields.push(prop);
      });
      if (fields.length) {
        usages.push({ kind: 'component', pageIndex, path, label: _blockLabel(item), detail: fields.join(', ') });
      }
    });
    Object.entries(page.computed || {}).forEach(([computedName, entry]) => {
      if (computedName === name) return;
      const expression = typeof entry === 'string' ? entry : entry?.eval || '';
      if (referenced(expression, pageIndex)) {
        usages.push({ kind: 'expression', pageIndex, label: computedName, detail: 'computed expression' });
      }
    });
  });

  if (owner === 'global') {
    Object.entries(_config.global?.computed || {}).forEach(([computedName, entry]) => {
      if (computedName === name) return;
      const expression = typeof entry === 'string' ? entry : entry?.eval || '';
      if (_containsPath(expression, `Global.${name}`)) usages.push({ kind: 'expression', label: computedName, detail: 'global computed expression' });
    });
  } else if (ownerPageId) {
    Object.entries(_config.global?.computed || {}).forEach(([computedName, entry]) => {
      const expression = typeof entry === 'string' ? entry : entry?.eval || '';
      if (_containsPath(expression, `Pages.${ownerPageId}.${name}`)) usages.push({ kind: 'expression', label: computedName, detail: 'global computed expression' });
    });
  }
  return usages;
}

function _renderVariableReferences(owner, name) {
  const usages = _variableUsages(owner, name);
  return `<section class="variable-references">
    <div class="variable-references-head"><strong>References</strong><span>${usages.length}</span></div>
    ${usages.length ? usages.map(usage => usage.kind === 'component'
      ? `<button type="button" class="variable-reference" data-variable-reference data-page-index="${usage.pageIndex}" data-path="${usage.path.join('.')}">
          <span>${_esc(usage.label)}</span><small>${_esc((_config.pages?.[usage.pageIndex]?.label || 'Screen') + ' · ' + usage.detail)}</small>
        </button>`
      : `<div class="variable-reference static"><span>${_esc(usage.label)}</span><small>${_esc(usage.detail)}</small></div>`).join('')
      : '<div class="tree-empty">No references. This variable can be removed safely.</div>'}
  </section>`;
}

function _containsPath(source, path) {
  if (!source || !path) return false;
  return new RegExp(`(^|[^A-Za-z0-9_$])${_escapeRegExp(path)}(?=$|[^A-Za-z0-9_$])`).test(String(source));
}

function _renameVariableReferences(owner, previousName, nextName) {
  if (!previousName || previousName === nextName) return;
  const ownerIndex = owner === 'global' ? null : Number(owner);
  const ownerPageId = ownerIndex === null ? null : _config.pages?.[ownerIndex]?.id;
  const replacePath = (value, previousPath, nextPath) => String(value).replace(
    new RegExp(`\\b${_escapeRegExp(previousPath)}(?=$|[^A-Za-z0-9_$])`, 'g'),
    nextPath,
  );
  const replaceForPage = (value, pageIndex) => {
    let result = String(value);
    if (owner === 'global') return replacePath(result, `Global.${previousName}`, `Global.${nextName}`);
    if (pageIndex === ownerIndex) result = replacePath(result, `Page.${previousName}`, `Page.${nextName}`);
    return replacePath(result, `Pages.${ownerPageId}.${previousName}`, `Pages.${ownerPageId}.${nextName}`);
  };
  (_config.pages || []).forEach((page, pageIndex) => {
    _walkLayout(page.layout, item => {
      if ((owner === 'global' || pageIndex === ownerIndex) && item.var === previousName) item.var = nextName;
      ['onclick', 'onrightclick', 'onupdate'].forEach(prop => {
        if (Array.isArray(item[prop])) item[prop] = item[prop].map(value => replaceForPage(value, pageIndex));
        else if (typeof item[prop] === 'string') item[prop] = replaceForPage(item[prop], pageIndex);
      });
      ['label', 'text', 'content', 'tooltip', 'placeholder'].forEach(prop => {
        if (typeof item[prop] === 'string') item[prop] = replaceForPage(item[prop], pageIndex);
      });
    });
    Object.entries(page.computed || {}).forEach(([key, entry]) => {
      if (typeof entry === 'string') page.computed[key] = replaceForPage(entry, pageIndex);
      else if (entry && typeof entry === 'object' && typeof entry.eval === 'string') entry.eval = replaceForPage(entry.eval, pageIndex);
    });
  });
  Object.entries(_config.global?.computed || {}).forEach(([key, entry]) => {
    const replaceGlobal = value => owner === 'global'
      ? replacePath(value, `Global.${previousName}`, `Global.${nextName}`)
      : replacePath(value, `Pages.${ownerPageId}.${previousName}`, `Pages.${ownerPageId}.${nextName}`);
    if (typeof entry === 'string') _config.global.computed[key] = replaceGlobal(entry);
    else if (entry && typeof entry === 'object' && typeof entry.eval === 'string') entry.eval = replaceGlobal(entry.eval);
  });
}

function _escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function _uniquePageId(base, currentPage = null) {
  const used = new Set((_config.pages || []).filter(page => page !== currentPage).map(page => page.id));
  const root = normalizePageId(base);
  let id = root;
  let suffix = 2;
  while (used.has(id)) {
    id = `${root}_${suffix}`;
    suffix += 1;
  }
  return id;
}

function _renamePageIdReferences(previousId, nextId) {
  if (!previousId || previousId === nextId) return;
  const escaped = previousId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\bPages\\.${escaped}(?=\\.)`, 'g');
  const rewrite = value => {
    if (typeof value === 'string') return value.replace(pattern, `Pages.${nextId}`);
    if (Array.isArray(value)) {
      value.forEach((entry, index) => { value[index] = rewrite(entry); });
      return value;
    }
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(key => { value[key] = rewrite(value[key]); });
    }
    return value;
  };
  rewrite(_config.global?.computed);
  (_config.pages || []).forEach(page => {
    rewrite(page.computed);
    rewrite(page.layout);
  });
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

function _walkLayout(items, visitor, basePath = []) {
  (items || []).forEach((item, index) => {
    const path = [...basePath, index];
    visitor(item, path);
    _walkLayout(_getChildren(item) || [], visitor, path);
  });
}

function _collectProjectIssues() {
  const issues = [];
  const globalState = new Set(Object.keys(_config.global?.state || {}));
  const globalComputed = new Set(Object.keys(_config.global?.computed || {}));
  [...globalState].filter(name => globalComputed.has(name)).forEach(name => {
    issues.push({ scope: 'global', message: `Global variable "${name}" exists in State and Computed.` });
  });
  Object.entries(_config.global?.computed || {}).forEach(([name, entry]) => {
    const expression = typeof entry === 'string' ? entry : entry?.eval;
    if (!String(expression || '').trim()) issues.push({ scope: 'global', message: `Computed variable "${name}" has no expression.` });
  });

  const pageIds = new Map((_config.pages || []).map((page, pageIndex) => [page.id, pageIndex]));
  const seenPageIds = new Set();
  (_config.pages || []).forEach((page, pageIndex) => {
    if (!String(page.label || '').trim()) issues.push({ scope: 'page', pageIndex, message: 'Screen label is empty.' });
    if (!String(page.id || '').trim()) issues.push({ scope: 'page', pageIndex, message: 'Screen ID is empty.' });
    else if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(page.id)) issues.push({ scope: 'page', pageIndex, message: `Screen ID "${page.id}" is not a valid JavaScript identifier.` });
    else if (seenPageIds.has(page.id)) issues.push({ scope: 'page', pageIndex, message: `Screen ID "${page.id}" is duplicated.` });
    else seenPageIds.add(page.id);

    const pageState = new Set(Object.keys(page.state || {}));
    const pageComputed = new Set(Object.keys(page.computed || {}));
    [...pageState].filter(name => pageComputed.has(name)).forEach(name => {
      issues.push({ scope: 'page', pageIndex, message: `Variable "${name}" exists in State and Computed.` });
    });
    Object.entries(page.computed || {}).forEach(([name, entry]) => {
      const expression = typeof entry === 'string' ? entry : entry?.eval;
      if (!String(expression || '').trim()) issues.push({ scope: 'page', pageIndex, message: `Computed variable "${name}" has no expression.` });
    });

    const allNames = new Set([...globalState, ...globalComputed, ...pageState, ...pageComputed]);
    const stateNames = new Set([...globalState, ...pageState]);
    _walkLayout(page.layout, (item, path) => {
      const type = String(item.type || '').toLowerCase();
      if ((MUTABLE_BIND_TYPES.has(type) || READ_BIND_TYPES.has(type)) && !item.var) {
        issues.push({ scope: 'page', pageIndex, path, message: `${item.type || 'Component'} has no variable binding.` });
      } else if (item.var && !allNames.has(item.var)) {
        issues.push({ scope: 'page', pageIndex, path, message: `${item.type || 'Component'} references missing variable "${item.var}".` });
      } else if (item.var && MUTABLE_BIND_TYPES.has(type) && !stateNames.has(item.var)) {
        issues.push({ scope: 'page', pageIndex, path, message: `${item.type} cannot write to Computed variable "${item.var}".` });
      }

    });
  });
  issues.push(..._collectPagesReferenceIssues(pageIds));
  issues.push(..._collectVariableCycleIssues());
  return issues;
}

function _collectPagesReferenceIssues(pageIds) {
  const issues = [];
  const seen = new Set();
  const inspect = (value, issueScope) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\bPages\.([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
        const [, pageId, variableName] = match;
        const targetIndex = pageIds.get(pageId);
        const targetPage = targetIndex === undefined ? null : _config.pages[targetIndex];
        const key = `${issueScope.scope}:${issueScope.pageIndex ?? 'global'}:${pageId}.${variableName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!targetPage) {
          issues.push({ ...issueScope, message: `Pages.${pageId} references an unknown screen ID.` });
        } else if (!Object.prototype.hasOwnProperty.call(targetPage.state || {}, variableName)
          && !Object.prototype.hasOwnProperty.call(targetPage.computed || {}, variableName)) {
          issues.push({ ...issueScope, message: `Pages.${pageId}.${variableName} references an unknown variable.` });
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(entry => inspect(entry, issueScope));
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(entry => inspect(entry, issueScope));
    }
  };

  inspect(_config.global?.computed, { scope: 'global' });
  (_config.pages || []).forEach((page, pageIndex) => {
    inspect(page.computed, { scope: 'page', pageIndex });
    inspect(page.layout, { scope: 'page', pageIndex });
  });
  return issues;
}

function _collectVariableCycleIssues() {
  const nodes = new Map();
  const addScope = (scope, prefix, issueScope) => {
    Object.entries(scope?.state || {}).forEach(([name, entry]) => {
      nodes.set(`${prefix}.${name}`, { expression: null, issueScope, entry });
    });
    Object.entries(scope?.computed || {}).forEach(([name, entry]) => {
      nodes.set(`${prefix}.${name}`, {
        expression: typeof entry === 'string' ? entry : entry?.eval || '',
        issueScope,
      });
    });
  };
  addScope(_config.global, 'Global', { scope: 'global' });
  (_config.pages || []).forEach((page, pageIndex) => {
    addScope(page, `Pages.${page.id}`, { scope: 'page', pageIndex });
  });

  const dependencies = (nodeId, expression) => {
    if (!expression) return [];
    const result = new Set();
    const pagePrefix = nodeId.startsWith('Pages.') ? nodeId.split('.').slice(0, 2).join('.') : null;
    for (const match of String(expression).matchAll(/\bGlobal\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
      const target = `Global.${match[1]}`;
      if (nodes.has(target)) result.add(target);
    }
    if (pagePrefix) {
      for (const match of String(expression).matchAll(/\bPage\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
        const target = `${pagePrefix}.${match[1]}`;
        if (nodes.has(target)) result.add(target);
      }
    }
    for (const match of String(expression).matchAll(/\bPages\.([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
      const target = `Pages.${match[1]}.${match[2]}`;
      if (nodes.has(target)) result.add(target);
    }
    return [...result];
  };

  const issues = [];
  const completed = new Set();
  const visiting = new Set();
  const reported = new Set();
  const visit = (nodeId, path = []) => {
    if (completed.has(nodeId)) return;
    if (visiting.has(nodeId)) {
      const start = path.indexOf(nodeId);
      const cycle = [...path.slice(Math.max(0, start)), nodeId];
      const signature = [...new Set(cycle)].sort().join('|');
      if (!reported.has(signature)) {
        reported.add(signature);
        issues.push({ ...nodes.get(nodeId).issueScope, message: `Variable cycle: ${cycle.join(' → ')}.` });
      }
      return;
    }
    visiting.add(nodeId);
    for (const dependency of dependencies(nodeId, nodes.get(nodeId)?.expression)) {
      visit(dependency, [...path, nodeId]);
    }
    visiting.delete(nodeId);
    completed.add(nodeId);
  };
  nodes.forEach((_node, nodeId) => visit(nodeId));
  return issues;
}

function _updateValidationUI() {
  const issues = _collectProjectIssues();
  const status = document.getElementById('studioValidationStatus');
  if (status) {
    status.textContent = issues.length ? `${issues.length} project issue${issues.length === 1 ? '' : 's'}` : 'Project valid';
    status.classList.toggle('has-issues', issues.length > 0);
    status.title = issues.slice(0, 12).map(issue => issue.message).join('\n');
  }

  const globalIssues = issues.filter(issue => issue.scope === 'global');
  const globalBadge = document.getElementById('globalIssuesBadge');
  if (globalBadge) {
    globalBadge.hidden = globalIssues.length === 0;
    globalBadge.textContent = String(globalIssues.length);
    globalBadge.title = globalIssues.map(issue => issue.message).join('\n');
  }

  document.querySelectorAll('[data-page-issues]').forEach(badge => {
    const pageIssues = issues.filter(issue => issue.pageIndex === Number(badge.dataset.pageIssues));
    badge.hidden = pageIssues.length === 0;
    badge.textContent = String(pageIssues.length);
    badge.title = pageIssues.map(issue => issue.message).join('\n');
  });
}

function _truncate(str, len) {
  const text = String(str ?? '');
  return text.length > len ? `${text.slice(0, len)}...` : text;
}

function _notify() {
  _syncAllRuntimeVariables();
  _recordHistory();
  _updateValidationUI();
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
