/**
 * treeEditor.js — tree-view visual editor (IDE style)
 *
 * Architecture:
 *   - Left sidebar: Global Settings | Global Variables | Pages
 *   - Right panel: tree of the selected page + inline properties panel
 *
 * No drag-and-drop (too unstable) → ↑ ↓ buttons for reordering.
 */

import { addTrackedListener } from './utils.js';
import { openVariableModal } from './variableModal.js';
import { openElementModal, closeElementModal, saveElement } from './elementModal.js';
import { deepClone } from '../utils.js';

// ── State ─────────────────────────────────────────────────────────────────────

let _config = null;
let _selectedPageIndex = null;
let _onConfigChange = null; // callback when config mutates

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialize the editor.
 * @param {Object} config - current config (will be mutated)
 * @param {Function} onChange - called whenever the config changes
 */
export function initEditor(config, onChange) {
  _config = config;
  _onConfigChange = onChange;

  // Wire static buttons (sidebar)
  const addPageBtn = document.getElementById('addPageBtn');
  if (addPageBtn) {
    addPageBtn.onclick = _addPage;
  }

  const addGlobalVarBtn = document.getElementById('addGlobalVariableBtn');
  if (addGlobalVarBtn) {
    addGlobalVarBtn.onclick = () => _openVarModal('global', null);
  }

  renderSidebar();
  if (_config.pages && _config.pages.length > 0) {
    _selectPage(0);
  }
}

/** Re-render everything (called after config mutates externally, e.g. sync from JSON) */
export function rerenderEditor(config) {
  _config = config;
  renderSidebar();
  if (_selectedPageIndex !== null && _config.pages && _config.pages[_selectedPageIndex]) {
    renderPagePanel(_selectedPageIndex);
  } else if (_config.pages && _config.pages.length > 0) {
    _selectPage(0);
  } else {
    _selectedPageIndex = null;
    const container = document.getElementById('pageEditorContainer');
    if (container) container.innerHTML = _emptyState('Select or create a page');
  }
}

/** Build config object from current editor state (reads global fields) */
export function buildConfigFromEditor() {
  const config = {
    global: {
      title:     document.getElementById('globalTitle')?.value || 'Macro Hero',
      width:     parseInt(document.getElementById('globalWidth')?.value) || 600,
      height:    parseInt(document.getElementById('globalHeight')?.value) || 600,
      variables: _config?.global?.variables || {}
    },
    pages: _config?.pages ? deepClone(_config.pages) : []
  };
  return config;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function renderSidebar() {
  _renderGlobalFields();
  _renderGlobalVariables();
  _renderPageList();
}

function _renderGlobalFields() {
  const t = document.getElementById('globalTitle');
  const w = document.getElementById('globalWidth');
  const h = document.getElementById('globalHeight');
  if (t) t.value = _config?.global?.title || '';
  if (w) w.value = _config?.global?.width  || 600;
  if (h) h.value = _config?.global?.height || 600;
}

function _renderGlobalVariables() {
  const container = document.getElementById('globalVariablesList');
  if (!container) return;
  const vars = _config?.global?.variables || {};
  const keys = Object.keys(vars);
  if (keys.length === 0) {
    container.innerHTML = '<div class="tree-empty">No global variables</div>';
    return;
  }
  container.innerHTML = keys.map(k => {
    const v    = vars[k];
    const desc = _varDesc(v);
    return `<div class="var-item">
      <span class="var-key">${_esc(k)}</span>
      <span class="var-val" title="${_esc(desc)}">${_esc(desc.slice(0, 28))}${desc.length > 28 ? '…' : ''}</span>
      <div class="var-actions">
        <button type="button" class="btn-icon" data-action="editGlobalVar" data-key="${_esc(k)}" title="Edit">✎</button>
        <button type="button" class="btn-icon btn-danger" data-action="deleteGlobalVar" data-key="${_esc(k)}" title="Delete">×</button>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('[data-action]').forEach(btn => {
    addTrackedListener(btn, 'click', e => {
      e.stopPropagation();
      const key = btn.dataset.key;
      if (btn.dataset.action === 'editGlobalVar')   _openVarModal('global', key);
      if (btn.dataset.action === 'deleteGlobalVar')  _deleteGlobalVar(key);
    });
  });
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
        <button type="button" class="btn-icon" data-action="movePage" data-dir="1"  data-index="${i}" title="Down" ${i === pages.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="btn-icon btn-danger" data-action="deletePage" data-index="${i}" title="Delete">×</button>
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
      if (btn.dataset.action === 'movePage')   _movePage(idx, parseInt(btn.dataset.dir));
    });
  });
}

// ── Page panel ────────────────────────────────────────────────────────────────

function _selectPage(index) {
  _selectedPageIndex = index;
  _renderPageList(); // update active state
  renderPagePanel(index);
}

export function renderPagePanel(pageIndex) {
  const container = document.getElementById('pageEditorContainer');
  if (!container) return;
  const page = _config?.pages?.[pageIndex];
  if (!page) { container.innerHTML = _emptyState('Invalid page'); return; }

  container.innerHTML = `
    <div class="page-panel">
      <div class="page-panel-header">
        <div class="input-group" style="margin:0;flex:1;">
          <label>Page Label</label>
          <input type="text" id="pageLabelInput" value="${_esc(page.label || '')}" placeholder="Page name" style="width:100%;" />
        </div>
      </div>

      <div class="page-section">
        <div class="page-section-header" id="pageVarsHeader" style="cursor:pointer;" title="Toggle variables">
          <span class="section-title">
            <span id="pageVarsChevron">▾</span> Variables
          </span>
          <button type="button" class="btn-small" id="addPageVarBtn">+ Variable</button>
        </div>
        <div id="pageVarsList"></div>
      </div>

      <div class="page-section" style="flex:1;min-height:0;">
        <div class="page-section-header">
          <span class="section-title">Layout</span>
          <button type="button" class="btn-small" id="addElementBtn">+ Element</button>
        </div>
        <div id="layoutTree" class="tree-container"></div>
      </div>
    </div>`;

  // Wire page label
  addTrackedListener(document.getElementById('pageLabelInput'), 'input', e => {
    _config.pages[pageIndex].label = e.target.value;
    _renderPageList();
    _notify();
  });

  // Wire variables section toggle
  addTrackedListener(document.getElementById('pageVarsHeader'), 'click', e => {
    if (e.target.closest('#addPageVarBtn')) return; // don't collapse when clicking + Variable
    const list = document.getElementById('pageVarsList');
    const chevron = document.getElementById('pageVarsChevron');
    const collapsed = list.style.display === 'none';
    list.style.display = collapsed ? '' : 'none';
    chevron.textContent = collapsed ? '▾' : '▸';
  });

  // Wire buttons
  document.getElementById('addPageVarBtn').onclick = () => _openVarModal(pageIndex, null);
  document.getElementById('addElementBtn').onclick = () => _openElementModal(pageIndex, null, null, null);

  _renderPageVars(pageIndex);
  _renderLayoutTree(pageIndex);
}

// ── Page variables ─────────────────────────────────────────────────────────────

function _renderPageVars(pageIndex) {
  const container = document.getElementById('pageVarsList');
  if (!container) return;
  const vars = _config.pages[pageIndex].variables || {};
  const keys = Object.keys(vars);
  if (keys.length === 0) {
    container.innerHTML = '<div class="tree-empty">No page variables</div>';
    return;
  }
  container.innerHTML = keys.map(k => {
    const v    = vars[k];
    const desc = _varDesc(v);
    return `<div class="var-item">
      <span class="var-key">${_esc(k)}</span>
      <span class="var-val" title="${_esc(desc)}">${_esc(desc.slice(0, 28))}${desc.length > 28 ? '…' : ''}</span>
      <div class="var-actions">
        <button type="button" class="btn-icon" data-action="editVar" data-key="${_esc(k)}" title="Edit">✎</button>
        <button type="button" class="btn-icon btn-danger" data-action="deleteVar" data-key="${_esc(k)}" title="Delete">×</button>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('[data-action]').forEach(btn => {
    addTrackedListener(btn, 'click', e => {
      e.stopPropagation();
      const key = btn.dataset.key;
      if (btn.dataset.action === 'editVar')   _openVarModal(pageIndex, key);
      if (btn.dataset.action === 'deleteVar') {
        if (confirm(`Delete variable "${key}"?`)) {
          delete _config.pages[pageIndex].variables[key];
          _renderPageVars(pageIndex);
          _notify();
        }
      }
    });
  });
}

// ── Layout tree ───────────────────────────────────────────────────────────────

function _renderLayoutTree(pageIndex) {
  const container = document.getElementById('layoutTree');
  if (!container) return;
  const layout = _config.pages[pageIndex].layout || [];
  if (layout.length === 0) {
    container.innerHTML = '<div class="tree-empty">No elements — click "+ Element" to add one</div>';
    return;
  }
  container.innerHTML = layout.map((item, idx) =>
    _renderTreeNode(item, [idx], pageIndex)
  ).join('');

  _attachTreeActions(container, pageIndex);
  _wireTreeDnd(container, pageIndex);
}

/**
 * Render a tree node and its children recursively.
 * @param {Object} item
 * @param {number[]} path - array of indices forming the path in layout
 * @param {number} pageIndex
 * @param {number} depth
 */
function _renderTreeNode(item, path, pageIndex, depth = 0) {
  const pathStr  = path.join('.');
  const type     = item.type || '?';
  const isMatrix    = type.toLowerCase() === 'matrix';
  const isMatrixBtn = type.toLowerCase() === 'matrixbutton';
  const label    = isMatrix
    ? `${item.columns || 4} cols • ${(item.children || []).length} btn`
    : _nodeLabel(item);
  const isContainer = _isContainer(item);
  const children = _getChildren(item);
  const isLast   = false; // handled by CSS

  const indent = depth * 20;

  const canMoveUp   = path[path.length - 1] > 0;
  const parentLen   = _getParentChildCount(_config.pages[pageIndex].layout, path);
  const canMoveDown = path[path.length - 1] < parentLen - 1;

  const draggable = 'draggable="true"';

  let html = `<div class="tree-node" data-path="${pathStr}" ${draggable} style="padding-left:${indent + 4}px;">
    <div class="tree-node-row">
      ${depth > 0 ? `<span class="tree-indent-guide"></span>` : ''}
      <span class="tree-node-type badge-${_typeColor(type)}">${type}</span>
      <span class="tree-node-label">${_esc(label)}</span>
      <div class="tree-node-actions">
        <button type="button" class="btn-icon" data-path="${pathStr}" data-action="moveUp"   title="Up"   ${canMoveUp   ? '' : 'disabled'}>↑</button>
        <button type="button" class="btn-icon" data-path="${pathStr}" data-action="moveDown" title="Down" ${canMoveDown ? '' : 'disabled'}>↓</button>
        <button type="button" class="btn-icon" data-path="${pathStr}" data-action="editNode"   title="Edit">✎</button>
        <button type="button" class="btn-icon btn-danger" data-path="${pathStr}" data-action="deleteNode" title="Delete">×</button>
        ${isContainer ? `<button type="button" class="btn-icon btn-add" data-path="${pathStr}" data-action="addChild" title="Add child">＋</button>` : ''}
      </div>
    </div>`;

  // Render children
  if (isContainer && children && children.length > 0) {
    html += `<div class="tree-children">`;
    children.forEach((child, cidx) => {
      html += _renderTreeNode(child, [...path, cidx], pageIndex, depth + 1);
    });
    html += `</div>`;
  } else if (isContainer) {
    html += `<div class="tree-children tree-children-empty" style="padding-left:${indent + 24}px;">
      <span class="tree-empty" style="font-size:0.8em;">empty — click ＋ to add</span>
    </div>`;
  }

  html += `</div>`;
  return html;
}

function _attachTreeActions(container, pageIndex) {
  container.querySelectorAll('[data-action]').forEach(btn => {
    addTrackedListener(btn, 'click', e => {
      e.stopPropagation();
      const path   = btn.dataset.path.split('.').map(Number);
      const action = btn.dataset.action;
      switch (action) {
        case 'editNode':   _editNode(pageIndex, path);   break;
        case 'deleteNode': _deleteNode(pageIndex, path); break;
        case 'addChild':   _openElementModal(pageIndex, null, path, null); break;
        case 'moveUp':     _moveNode(pageIndex, path, -1); break;
        case 'moveDown':   _moveNode(pageIndex, path,  1); break;
      }
    });
  });
}

// ── Drag-and-drop ────────────────────────────────────────────────────────────

let _dndDragPath = null;

function _wireTreeDnd(container, pageIndex) {
  container.querySelectorAll('.tree-node[draggable]').forEach(node => {
    const path = node.dataset.path.split('.').map(Number);

    node.addEventListener('dragstart', e => {
      e.stopPropagation();
      _dndDragPath = path;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.dataset.path);
      setTimeout(() => node.classList.add('dnd-dragging'), 0);
    });

    node.addEventListener('dragend', () => {
      node.classList.remove('dnd-dragging');
      container.querySelectorAll('.dnd-drop-before, .dnd-drop-after')
        .forEach(el => el.classList.remove('dnd-drop-before', 'dnd-drop-after'));
      _dndDragPath = null;
    });

    const row = node.querySelector(':scope > .tree-node-row');
    if (!row) return;

    row.addEventListener('dragover', e => {
      if (!_dndDragPath) return;
      const dropPath = node.dataset.path.split('.').map(Number);
      if (!_isValidDrop(pageIndex, _dndDragPath, dropPath)) return;
      e.preventDefault();
      e.stopPropagation();
      container.querySelectorAll('.dnd-drop-before, .dnd-drop-after')
        .forEach(el => el.classList.remove('dnd-drop-before', 'dnd-drop-after'));
      const { top, height } = row.getBoundingClientRect();
      row.classList.add(e.clientY < top + height / 2 ? 'dnd-drop-before' : 'dnd-drop-after');
    });

    row.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      if (!_dndDragPath) return;
      const dropPath = node.dataset.path.split('.').map(Number);
      if (!_isValidDrop(pageIndex, _dndDragPath, dropPath)) return;
      const { top, height } = row.getBoundingClientRect();
      _executeDrop(pageIndex, _dndDragPath, dropPath, e.clientY < top + height / 2);
    });
  });
}

function _isValidDrop(pageIndex, dragPath, dropPath) {
  const dragStr = dragPath.join('.');
  const dropStr = dropPath.join('.');
  if (dragStr === dropStr) return false;
  if (dropStr.startsWith(dragStr + '.')) return false; // can't drop into own descendant

  const layout = _config.pages[pageIndex].layout;
  const dragItem = _getNodeAt(layout, dragPath);
  const isDragMBtn = (dragItem?.type || '').toLowerCase() === 'matrixbutton';

  const dropParentPath = dropPath.slice(0, -1);
  const dropParent = dropParentPath.length === 0 ? null : _getNodeAt(layout, dropParentPath);
  const isDropInMatrix = (dropParent?.type || '').toLowerCase() === 'matrix';

  if (isDragMBtn && !isDropInMatrix) return false;
  if (!isDragMBtn && isDropInMatrix) return false;

  return true;
}

function _executeDrop(pageIndex, dragPath, dropPath, insertBefore) {
  const layout = _config.pages[pageIndex].layout;
  const dragParentArr = _getChildArray(layout, dragPath);
  const dropParentArr = _getChildArray(layout, dropPath);
  if (!dragParentArr || !dropParentArr) return;

  const dragIdx = dragPath[dragPath.length - 1];
  const dropIdx = dropPath[dropPath.length - 1];
  const isSameArr = dragPath.slice(0, -1).join('.') === dropPath.slice(0, -1).join('.');

  const [item] = dragParentArr.splice(dragIdx, 1);

  let insertIdx;
  if (isSameArr) {
    const adj = dragIdx < dropIdx ? dropIdx - 1 : dropIdx;
    insertIdx = insertBefore ? adj : adj + 1;
  } else {
    insertIdx = insertBefore ? dropIdx : dropIdx + 1;
  }
  dropParentArr.splice(insertIdx, 0, item);

  const scrollTop = document.getElementById('layoutTree')?.scrollTop ?? 0;
  renderPagePanel(pageIndex);
  const tree = document.getElementById('layoutTree');
  if (tree) tree.scrollTop = scrollTop;
  _notify();
}

// ── Node operations ───────────────────────────────────────────────────────────

function _getNodeAt(layout, path) {
  let node = { children: layout };
  for (const idx of path) {
    const children = _getChildren(node) || node.children;
    node = children[idx];
    if (!node) return null;
  }
  return node;
}

function _getParentNode(layout, path) {
  if (path.length === 1) return null;
  return _getNodeAt(layout, path.slice(0, -1));
}

function _getChildArray(layout, path) {
  if (path.length === 1) return layout;
  const parent = _getNodeAt(layout, path.slice(0, -1));
  if (!parent) return null;
  return _getChildren(parent);
}

function _getParentChildCount(layout, path) {
  const arr = _getChildArray(layout, path);
  return arr ? arr.length : 0;
}

function _editNode(pageIndex, path) {
  const layout = _config.pages[pageIndex].layout;
  const node   = _getNodeAt(layout, path);
  if (!node) return;

  const isMatrixButton = path.length >= 2 && (() => {
    const parent = _getNodeAt(layout, path.slice(0, -1));
    return parent?.type === 'matrix' || parent?.type === 'Matrix';
  })();

  openElementModal({
    type:      isMatrixButton ? 'matrixButton' : node.type,
    element:   node,
    title:     'Edit Element',
    saveLabel: 'Save Changes',
    lockType:  true,
    onSave: el => {
      const arr = _getChildArray(layout, path);
      if (arr) {
        arr[path[path.length - 1]] = el;
        renderPagePanel(pageIndex);
        _notify();
      }
    }
  });
}

function _deleteNode(pageIndex, path) {
  const layout = _config.pages[pageIndex].layout;
  const node   = _getNodeAt(layout, path);
  if (!node) return;
  const label  = _nodeLabel(node);
  if (!confirm(`Delete "${label}"?`)) return;
  const arr = _getChildArray(layout, path);
  if (arr) {
    arr.splice(path[path.length - 1], 1);
    renderPagePanel(pageIndex);
    _notify();
  }
}

function _moveNode(pageIndex, path, dir) {
  const layout = _config.pages[pageIndex].layout;
  const arr    = _getChildArray(layout, path);
  if (!arr) return;
  const idx    = path[path.length - 1];
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= arr.length) return;
  const [item] = arr.splice(idx, 1);
  arr.splice(newIdx, 0, item);
  const scrollTop = document.getElementById('layoutTree')?.scrollTop ?? 0;
  renderPagePanel(pageIndex);
  const tree = document.getElementById('layoutTree');
  if (tree) tree.scrollTop = scrollTop;
  _notify();
}

/**
 * Open element modal for adding a new element.
 * @param {number} pageIndex
 * @param {string|null} type - force a type or null to let user choose
 * @param {number[]|null} parentPath - path to parent container (null = top level)
 * @param {string|null} parentType - 'matrix' to add as matrix button
 */
function _openElementModal(pageIndex, type, parentPath, parentType) {
  const layout = _config.pages[pageIndex].layout;
  const isMatrix = parentPath && (() => {
    const parent = _getNodeAt(layout, parentPath);
    return parent?.type === 'matrix' || parent?.type === 'Matrix';
  })();

  openElementModal({
    type:      isMatrix ? 'matrixButton' : (type || 'button'),
    element:   null,
    title:     isMatrix ? 'Add Matrix Button' : 'Add Element',
    saveLabel: isMatrix ? 'Add Button' : 'Add Element',
    lockType:  isMatrix,
    onSave: el => {
      if (parentPath === null) {
        // Top-level
        if (!_config.pages[pageIndex].layout) _config.pages[pageIndex].layout = [];
        _config.pages[pageIndex].layout.push(el);
      } else {
        const parent = _getNodeAt(layout, parentPath);
        if (!parent) return;
        if (isMatrix) {
          if (!parent.children) parent.children = [];
          parent.children.push(el);
        } else {
          if (!parent.children) parent.children = [];
          parent.children.push(el);
        }
      }
      renderPagePanel(pageIndex);
      _notify();
    }
  });
}

// ── Page operations ───────────────────────────────────────────────────────────

function _addPage() {
  if (!_config.pages) _config.pages = [];
  _config.pages.push({ label: 'New Page', variables: {}, layout: [] });
  _selectPage(_config.pages.length - 1);
  _notify();
}

function _deletePage(index) {
  if (!confirm(`Delete page "${_config.pages[index].label || index}"?`)) return;
  _config.pages.splice(index, 1);
  if (_selectedPageIndex >= _config.pages.length) {
    _selectedPageIndex = _config.pages.length - 1;
  }
  renderSidebar();
  if (_selectedPageIndex >= 0 && _config.pages.length > 0) {
    renderPagePanel(_selectedPageIndex);
  } else {
    _selectedPageIndex = null;
    const c = document.getElementById('pageEditorContainer');
    if (c) c.innerHTML = _emptyState('No pages — click "+" to create one');
  }
  _notify();
}

function _movePage(index, dir) {
  const newIdx = index + dir;
  if (newIdx < 0 || newIdx >= _config.pages.length) return;
  const [page] = _config.pages.splice(index, 1);
  _config.pages.splice(newIdx, 0, page);
  if (_selectedPageIndex === index) _selectedPageIndex = newIdx;
  renderSidebar();
  renderPagePanel(_selectedPageIndex);
  _notify();
}

// ── Variable operations ───────────────────────────────────────────────────────

function _openVarModal(pageIndex, key) {
  const isGlobal = pageIndex === 'global';
  const existing = isGlobal
    ? (_config.global?.variables?.[key])
    : (_config.pages[pageIndex]?.variables?.[key]);

  openVariableModal(pageIndex, key || '', existing, (pi, k, value) => {
    if (isGlobal) {
      if (!_config.global) _config.global = {};
      if (!_config.global.variables) _config.global.variables = {};
      _config.global.variables[k] = value;
      _renderGlobalVariables();
    } else {
      if (!_config.pages[pi].variables) _config.pages[pi].variables = {};
      _config.pages[pi].variables[k] = value;
      _renderPageVars(pi);
    }
    _notify();
  });
}

function _deleteGlobalVar(key) {
  if (!confirm(`Delete global variable "${key}"?`)) return;
  delete _config.global.variables[key];
  _renderGlobalVariables();
  _notify();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _notify() {
  if (_onConfigChange) _onConfigChange(_config);
}

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _emptyState(msg) {
  return `<div style="text-align:center;color:#888;padding:40px;">${msg}</div>`;
}

function _isContainer(item) {
  const t = (item?.type || '').toLowerCase();
  return t === 'row' || t === 'stack' || t === 'matrix';
}

function _getChildren(item) {
  if (!item) return null;
  const t = (item.type || '').toLowerCase();
  if (t === 'matrix') return item.children || [];
  return item.children || null;
}

function _nodeLabel(item) {
  if (!item) return '?';
  return item.label || item.text || item.var || item.icon || '';
}

function _varDesc(v) {
  if (typeof v === 'object' && v !== null) {
    return [
      'value' in v ? `val` : '',
      'eval'  in v ? `eval` : '',
      v.min !== undefined ? `min:${v.min}` : '',
      v.max !== undefined ? `max:${v.max}` : ''
    ].filter(Boolean).join(' ');
  }
  return String(v ?? '');
}

function _typeColor(type) {
  const t = (type || '').toLowerCase();
  const map = {
    button: 'purple', value: 'blue', input: 'green', counter: 'orange',
    checkbox: 'cyan', toggle: 'cyan', dropdown: 'teal', title: 'pink', text: 'gray',
    divider: 'gray', row: 'indigo', stack: 'indigo', matrix: 'amber',
    matrixbutton: 'amber', alert: 'red'
  };
  return map[t] || 'gray';
}
