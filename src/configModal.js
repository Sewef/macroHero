import OBR from "@owlbear-rodeo/sdk";
import { STORAGE_KEY, MODAL_LABEL, loadConfig, saveConfig, saveConfigToLocalStorage } from "./config.js";
import { saveGoogleSheetsApiKey, saveGoogleSheetsSheetId, getGoogleSheetsCredentials } from "./commands/integrations/GoogleSheets.js";

let currentConfig = null;
let currentTab = 'editor';
let editingPageIndex = null;
let editingElementIndex = null;
let expandedPages = new Set();
// Variable modal state (inlined from variableModal.js)
let editingVariablePageIndex = null;
let editingVariableKey = null;

function showVariableError(msg) {
  const err = document.getElementById('variableError');
  if (err) {
    err.textContent = msg;
    err.style.display = 'block';
  }
}

function ensureVariableModalInDom() {
  return new Promise(resolve => {
    if (document.getElementById('variableModal')) {
      resolve();
    } else {
      // Inline modal HTML directly to avoid fetch timing issues
      const html = `
      <div id="variableModal" class="modal">
        <div class="modal-content" style="width: 420px; max-width: 95vw;">
          <div class="modal-header">
            <h3 id="variableModalTitle">Edit Variable</h3>
            <button type="button" class="close-modal" onclick="(function(){document.getElementById('variableModal').style.display='none';})();">×</button>
          </div>
          <div class="input-group">
            <label for="variableKey">Name</label>
            <input type="text" id="variableKey" />
          </div>
          <div class="input-group">
            <label for="variableExpression">Expression</label>
            <input type="text" id="variableExpression" placeholder="e.g. player.hp + 5" />
          </div>
          <div class="row" style="margin-top: 8px; gap: 8px;">
            <div class="input-group" style="flex:1; margin-bottom:0;">
              <label for="variableMin">Min</label>
              <input type="number" id="variableMin" placeholder="optional" />
            </div>
            <div class="input-group" style="flex:1; margin-bottom:0;">
              <label for="variableMax">Max</label>
              <input type="number" id="variableMax" placeholder="optional" />
            </div>
          </div>
          <div id="variableError" style="color: #ff4e4e; font-size: 0.9em; display: none; margin-bottom: 8px;"></div>
          <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
            <button type="button" class="btn-small" id="saveVariableBtn">Save</button>
            <button type="button" class="btn-small btn-danger" id="cancelVariableBtn">Cancel</button>
          </div>
        </div>
      </div>
      `;
      document.body.insertAdjacentHTML('beforeend', html);
      // small delay to ensure inserted elements are available
      setTimeout(resolve, 0);
    }
  });
}

function openVariableModal(pageIndex, key = '', value = '', isEdit = false) {
  editingVariablePageIndex = pageIndex;
  editingVariableKey = key;
  const title = document.getElementById('variableModalTitle');
  if (title) title.textContent = isEdit ? 'Edit Variable' : 'Add Variable';
  const keyInput = document.getElementById('variableKey');
  if (keyInput) keyInput.value = key;
  if (keyInput) keyInput.disabled = isEdit;
  // Populate expression/min/max fields
  const exprInput = document.getElementById('variableExpression');
  const minInput = document.getElementById('variableMin');
  const maxInput = document.getElementById('variableMax');
  if (typeof value === 'object' && value !== null && ('expression' in value || 'min' in value || 'max' in value)) {
    if (exprInput) exprInput.value = value.expression ?? '';
    if (minInput) minInput.value = (value.min !== undefined && value.min !== null) ? value.min : '';
    if (maxInput) maxInput.value = (value.max !== undefined && value.max !== null) ? value.max : '';
  } else {
    if (exprInput) exprInput.value = (value !== undefined && value !== null) ? String(value) : '';
    if (minInput) minInput.value = '';
    if (maxInput) maxInput.value = '';
  }
  const err = document.getElementById('variableError');
  if (err) err.style.display = 'none';
  const modal = document.getElementById('variableModal');
  if (modal) modal.style.display = 'flex';
}

function closeVariableModal() {
  const modal = document.getElementById('variableModal');
  if (modal) modal.style.display = 'none';
  editingVariablePageIndex = null;
  editingVariableKey = null;
}

function saveVariableFromModal(currentConfigParam) {
  const keyEl = document.getElementById('variableKey');
  const exprEl = document.getElementById('variableExpression');
  const minEl = document.getElementById('variableMin');
  const maxEl = document.getElementById('variableMax');
  if (!keyEl || !exprEl || !minEl || !maxEl) return false;
  const key = keyEl.value.trim();
  const exprRaw = exprEl.value.trim();
  const minRaw = minEl.value.trim();
  const maxRaw = maxEl.value.trim();
  // Build value object
  let value = {};
  if (exprRaw !== '') value.expression = exprRaw;
  if (minRaw !== '') {
    const m = Number(minRaw);
    if (!Number.isFinite(m)) {
      showVariableError('Min must be a number');
      return false;
    }
    value.min = m;
  }
  if (maxRaw !== '') {
    const M = Number(maxRaw);
    if (!Number.isFinite(M)) {
      showVariableError('Max must be a number');
      return false;
    }
    value.max = M;
  }
  if (!key) {
    showVariableError('Variable name is required.');
    return false;
  }
  if (editingVariablePageIndex === 'global') {
    if (!currentConfigParam.global) currentConfigParam.global = {};
    if (!currentConfigParam.global.variables) currentConfigParam.global.variables = {};
    currentConfigParam.global.variables[key] = value;
  } else {
    if (!currentConfigParam.pages[editingVariablePageIndex].variables) {
      currentConfigParam.pages[editingVariablePageIndex].variables = {};
    }
    currentConfigParam.pages[editingVariablePageIndex].variables[key] = value;
  }
  closeVariableModal();
  return true;
}

async function closeModal(data) {
  try {
    if (data) {
      // Try primary send first
      let sent = false;
      const attempts = [
        { opts: { destination: "LOCAL" }, desc: 'LOCAL' },
        { opts: undefined, desc: 'no-options' },
        { opts: { destination: "ROOM" }, desc: 'ROOM' },
        { opts: { destination: "ALL" }, desc: 'ALL' }
      ];

      for (const attempt of attempts) {
        try {
          if (attempt.opts !== undefined) {
            await OBR.broadcast.sendMessage("macrohero.config.result", data, attempt.opts);
          } else {
            await OBR.broadcast.sendMessage("macrohero.config.result", data);
          }
          console.log(`[MODAL] broadcast.sendMessage succeeded (mode=${attempt.desc})`);
          sent = true;
          break;
        } catch (err) {
          // Log detailed info for debugging
          try {
            console.warn(`[MODAL] broadcast.sendMessage failed (mode=${attempt.desc}):`, err && err.error ? err.error : err);
          } catch (logErr) {
            console.warn('[MODAL] broadcast.sendMessage failed (and could not stringify error)');
          }
        }
      }

      if (!sent) {
        console.error('[MODAL] ERROR: All attempts to broadcast config.result failed');
      }
    }
  } catch (err) {
    console.error("[MODAL] Unexpected error while broadcasting config result:", err);
  }

  try {
    await OBR.modal.close(MODAL_LABEL);
  } catch (err) {
    console.warn("[MODAL] Warning: modal.close failed:", err);
  }
}

// Tab switching
function switchTab(tabName) {
  currentTab = tabName;
  
  // Update tab buttons
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `${tabName}-tab`);
  });
  
  // Sync JSON when switching to JSON tab
  if (tabName === 'json') {
    syncToJson();
  }
}

// Sync visual editor to JSON
function syncToJson() {
  const config = buildConfigFromEditor();
  document.getElementById("cfgArea").value = JSON.stringify(config, null, 2);
}

// Sync JSON to visual editor
function syncFromJson() {
  try {
    const text = document.getElementById("cfgArea").value;
    const parsed = JSON.parse(text);
    // Basic normalization to ensure expected structure for the visual editor
    if (!parsed.global) parsed.global = { title: "Macro Hero", width: 600, height: 600, variables: {} };
    if (!Array.isArray(parsed.pages)) parsed.pages = [];
    parsed.pages = parsed.pages.map(p => {
      if (!p) return { label: 'Page', variables: {}, layout: [] };
      if (typeof p.variables !== 'object' || Array.isArray(p.variables) || p.variables === null) {
        p.variables = p.variables || {};
      }
      if (!Array.isArray(p.layout)) p.layout = [];
      return p;
    });

    currentConfig = parsed;
    renderEditor(parsed);
    alert("✓ Synced to visual editor");
  } catch (e) {
    alert("Invalid JSON: " + e.message);
  }
}

// Build config from visual editor
function buildConfigFromEditor() {
  const config = {
    global: {
      title: document.getElementById("globalTitle").value || "Macro Hero",
      width: parseInt(document.getElementById("globalWidth").value) || 600,
      height: parseInt(document.getElementById("globalHeight").value) || 600,
      variables: currentConfig?.global?.variables || {}
    },
    pages: []
  };
  
  // Get pages from DOM
  const pageItems = document.querySelectorAll('.page-item');
  pageItems.forEach((item, index) => {
    const labelInput = item.querySelector('.page-label-input');
    if (labelInput && currentConfig?.pages?.[index]) {
      const page = JSON.parse(JSON.stringify(currentConfig.pages[index]));
      page.label = labelInput.value || page.label;
      config.pages.push(page);
    }
  });
  
  return config;
}

// Render visual editor
function renderEditor(config) {
  currentConfig = config;
  
  // Set global fields
  document.getElementById("globalTitle").value = config.global?.title || "";
  document.getElementById("globalWidth").value = config.global?.width || 600;
  document.getElementById("globalHeight").value = config.global?.height || 600;
  
  // Render global variables
  const globalVarsContainer = document.getElementById('globalVariablesList');
  if (globalVarsContainer) {
    const globals = config.global?.variables || {};
    const keys = Object.keys(globals || {});
    if (keys.length === 0) {
      globalVarsContainer.innerHTML = '<div style="color: #666; font-size: 0.85em;">No global variables</div>';
    } else {
      globalVarsContainer.innerHTML = keys.map(k => `
        <div class="variable-item" data-var-key="${k}">
          <span class="variable-key">${k}</span>
          <span class="variable-value">${typeof globals[k] === 'object' ? JSON.stringify(globals[k]) : globals[k]}</span>
          <div class="variable-actions">
            <button type="button" class="btn-small" onclick="event.stopPropagation(); editGlobalVariable('${k}')">Edit</button>
            <button type="button" class="btn-small btn-danger" onclick="event.stopPropagation(); deleteGlobalVariable('${k}')">×</button>
          </div>
        </div>
      `).join('');
    }
    const addGlobalBtn = document.getElementById('addGlobalVariableBtn');
    if (addGlobalBtn) {
      addGlobalBtn.onclick = () => addGlobalVariable();
    }
  }
  
  // Render pages
  const container = document.getElementById("pagesContainer");
  container.innerHTML = "";
  
  if (config.pages && Array.isArray(config.pages)) {
    config.pages.forEach((page, index) => {
      const pageDiv = document.createElement("div");
      pageDiv.className = "page-item";
      pageDiv.draggable = true;
      pageDiv.dataset.pageIndex = index;
      
      // Check if this page should be expanded
      const isExpanded = expandedPages.has(index);
      
      const layoutItemsHtml = page.layout ? page.layout.map((item, itemIndex) => {
        const typeLabel = item.type || 'unknown';
        const label = item.label || item.text || item.var || '';
        
        // Handle row items (treat as container even if children is missing)
        if (item.type === 'row') {
          const childrenArr = (item.children && Array.isArray(item.children)) ? item.children : [];
          const childrenHtml = childrenArr.map((child, childIndex) => {
            // If the child is itself a stack, render it as a nested container with its own children
            if (child.type === 'stack') {
              const nested = (child.children && Array.isArray(child.children)) ? child.children : [];
              const nestedHtml = nested.map((nChild, nestedIndex) => {
                const nLabel = nChild.label || nChild.text || nChild.var || '';
                const nContent = nChild.type === 'text' && nChild.content ? nChild.content.substring(0, 50) + (nChild.content.length > 50 ? '...' : '') : nLabel;
                return `
                  <div class="layout-item" draggable="true" data-element-index="${itemIndex}" data-child-index="${childIndex}" data-nested-index="${nestedIndex}" data-page-index="${index}">
                    <div class="layout-item-info">
                      <span class="layout-item-type">${nChild.type || 'unknown'}</span>
                      <span>${nContent}</span>
                    </div>
                    <div class="layout-item-actions">
                      <span class="drag-handle">⋮⋮</span>
                      <button type="button" class="btn-small" onclick="event.stopPropagation(); editChildElement(${index}, ${itemIndex}, ${childIndex}, ${nestedIndex})">Edit</button>
                      <button type="button" class="btn-small btn-danger" onclick="event.stopPropagation(); deleteChildElement(${index}, ${itemIndex}, ${childIndex}, ${nestedIndex})">×</button>
                    </div>
                  </div>
                `;
              }).join('');

              return `
                <div class="layout-item stack-container" data-element-index="${itemIndex}" data-child-index="${childIndex}" data-page-index="${index}">
                  <div class="layout-item-info">
                    <span class="layout-item-type">${child.type || 'stack'}</span>
                    <span>Stack (${nested.length} items)</span>
                  </div>
                  <div class="layout-item-actions">
                    <button type="button" class="btn-small" onclick="event.stopPropagation(); addChildElement(${index}, ${itemIndex}, ${childIndex})">+ Item</button>
                    <button type="button" class="btn-small" onclick="event.stopPropagation(); editChildElement(${index}, ${itemIndex}, ${childIndex})">Edit</button>
                    <button type="button" class="btn-small btn-danger" onclick="event.stopPropagation(); deleteChildElement(${index}, ${itemIndex}, ${childIndex})">×</button>
                  </div>
                </div>
                <div class="stack-children" data-parent-element-index="${itemIndex}" data-parent-child-index="${childIndex}" data-page-index="${index}">
                  ${nestedHtml}
                  ${nested.length === 0 ? `<div class="row-drop-zone" data-element-index="${itemIndex}" data-parent-child-index="${childIndex}" data-page-index="${index}" data-is-empty-row="true">Drop items here</div>` : ''}
                </div>
              `;
            }

            const childLabel = child.label || child.text || child.var || '';
            const childContent = child.type === 'text' && child.content ? child.content.substring(0, 50) + (child.content.length > 50 ? '...' : '') : childLabel;
            return `
              <div class="layout-item" draggable="true" data-element-index="${itemIndex}" data-child-index="${childIndex}" data-page-index="${index}">
                <div class="layout-item-info">
                  <span class="layout-item-type">${child.type || 'unknown'}</span>
                  <span>${childContent}</span>
                </div>
                <div class="layout-item-actions">
                  <span class="drag-handle">⋮⋮</span>
                  <button type="button" class="btn-small" onclick="event.stopPropagation(); editChildElement(${index}, ${itemIndex}, ${childIndex})">Edit</button>
                  <button type="button" class="btn-small btn-danger" onclick="event.stopPropagation(); deleteChildElement(${index}, ${itemIndex}, ${childIndex})">×</button>
                </div>
              </div>
            `;
          }).join('');

          return `
            <div class="layout-item row-container" data-element-index="${itemIndex}" data-page-index="${index}">
              <div class="layout-item-info">
                <span class="layout-item-type">${typeLabel}</span>
                <span>Row (${childrenArr.length} items)</span>
              </div>
              <div class="layout-item-actions">
                <button type="button" class="btn-small" onclick="event.stopPropagation(); addChildElement(${index}, ${itemIndex})">+ Item</button>
                <button type="button" class="btn-small" onclick="event.stopPropagation(); editElement(${index}, ${itemIndex})">Edit</button>
                <button type="button" class="btn-small btn-danger" onclick="event.stopPropagation(); deleteElement(${index}, ${itemIndex})">×</button>
              </div>
            </div>
            <div class="row-children" data-row-index="${itemIndex}" data-page-index="${index}">
              ${childrenHtml}
              ${childrenArr.length === 0 ? `<div class="row-drop-zone" data-element-index="${itemIndex}" data-page-index="${index}" data-is-empty-row="true">Drop items here</div>` : ''}
            </div>
          `;
        }
        // Handle stack items (vertical container) even if children missing
        if (item.type === 'stack') {
          const childrenArr = (item.children && Array.isArray(item.children)) ? item.children : [];
          const childrenHtml = childrenArr.map((child, childIndex) => {
            const childLabel = child.label || child.text || child.var || '';
            const childContent = child.type === 'text' && child.content ? child.content.substring(0, 50) + (child.content.length > 50 ? '...' : '') : childLabel;
            return `
              <div class="layout-item" draggable="true" data-element-index="${itemIndex}" data-child-index="${childIndex}" data-page-index="${index}">
                <div class="layout-item-info">
                  <span class="layout-item-type">${child.type || 'unknown'}</span>
                  <span>${childContent}</span>
                </div>
                <div class="layout-item-actions">
                  <span class="drag-handle">⋮⋮</span>
                  <button type="button" class="btn-small" onclick="event.stopPropagation(); editChildElement(${index}, ${itemIndex}, ${childIndex})">Edit</button>
                  <button type="button" class="btn-small btn-danger" onclick="event.stopPropagation(); deleteChildElement(${index}, ${itemIndex}, ${childIndex})">×</button>
                </div>
              </div>
            `;
          }).join('');

          return `
            <div class="layout-item stack-container" data-element-index="${itemIndex}" data-page-index="${index}">
              <div class="layout-item-info">
                <span class="layout-item-type">${typeLabel}</span>
                <span>Stack (${childrenArr.length} items)</span>
              </div>
              <div class="layout-item-actions">
                <button type="button" class="btn-small" onclick="event.stopPropagation(); addChildElement(${index}, ${itemIndex})">+ Item</button>
                <button type="button" class="btn-small" onclick="event.stopPropagation(); editElement(${index}, ${itemIndex})">Edit</button>
                <button type="button" class="btn-small btn-danger" onclick="event.stopPropagation(); deleteElement(${index}, ${itemIndex})">×</button>
              </div>
            </div>
            <div class="stack-children" data-stack-index="${itemIndex}" data-page-index="${index}">
              ${childrenHtml}
              ${childrenArr.length === 0 ? `<div class="row-drop-zone" data-element-index="${itemIndex}" data-page-index="${index}" data-is-empty-row="true">Drop items here</div>` : ''}
            </div>
          `;
        }
        
        const content = item.type === 'text' && item.content ? item.content.substring(0, 50) + (item.content.length > 50 ? '...' : '') : label;
        
        return `
          <div class="layout-item" draggable="true" data-element-index="${itemIndex}" data-page-index="${index}">
            <div class="layout-item-info">
              <span class="layout-item-type">${typeLabel}</span>
              <span>${content}</span>
            </div>
            <div class="layout-item-actions">
              <span class="drag-handle">⋮⋮</span>
              <button type="button" class="btn-small" onclick="event.stopPropagation(); editElement(${index}, ${itemIndex})">Edit</button>
              <button type="button" class="btn-small btn-danger" onclick="event.stopPropagation(); deleteElement(${index}, ${itemIndex})">×</button>
            </div>
          </div>
        `;
      }).join('') : '';
      
      pageDiv.innerHTML = `
        <div class="page-header">
          <button type="button" class="collapse-btn ${isExpanded ? '' : 'collapsed'}">▼</button>
          <input type="text" class="page-label-input" value="${page.label || ''}" placeholder="Page Label" style="flex: 1; margin-right: 12px;" onclick="event.stopPropagation();" />
          <div class="page-actions">
            <button type="button" class="btn-small btn-danger">Delete</button>
          </div>
        </div>
        <div class="page-content ${isExpanded ? '' : 'collapsed'}" id="page-content-${index}">
          <div style="font-size: 0.85em; color: #888; margin-bottom: 8px;">
            ${page.variables ? Object.keys(page.variables).length : 0} variables, 
            ${page.layout ? page.layout.length : 0} layout items
          </div>
          <div style="margin-bottom: 16px;">
            <h4 style="margin: 8px 0; font-size: 0.95em; color: #4ea1ff;">Variables</h4>
            <div class="variables-list" data-page-index="${index}">
              ${page.variables ? Object.entries(page.variables).map(([key, value]) => `
                <div class="variable-item" data-var-key="${key}">
                  <span class="variable-key">${key}</span>
                  <span class="variable-value">${typeof value === 'object' ? JSON.stringify(value) : value}</span>
                  <div class="variable-actions">
                    <button type="button" class="btn-small" onclick="event.stopPropagation(); editVariable(${index}, '${key}')">Edit</button>
                    <button type="button" class="btn-small btn-danger" onclick="event.stopPropagation(); deleteVariable(${index}, '${key}')">×</button>
                  </div>
                </div>
              `).join('') : '<div style="color: #666; font-size: 0.85em;">No variables</div>'}
            </div>
            <button type="button" class="btn-small" onclick="event.stopPropagation(); addVariable(${index})" style="margin-top: 8px;">+ Variable</button>
          </div>
          <h4 style="margin: 8px 0; font-size: 0.95em; color: #4ea1ff;">Layout</h4>
          ${layoutItemsHtml ? `<div class="layout-items" data-page-index="${index}">${layoutItemsHtml}</div>` : ''}
          <button type="button" class="btn-small add-element-btn" onclick="event.stopPropagation(); addElement(${index})" style="margin-top: 12px;">+ Element</button>
        </div>
      `;
      container.appendChild(pageDiv);
      
      // Add event listeners after appending to DOM
      const collapseBtn = pageDiv.querySelector('.collapse-btn');
      const addBtn = pageDiv.querySelector('.add-element-btn');
      const deleteBtn = pageDiv.querySelector('.btn-small.btn-danger');
      
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        const content = document.getElementById(`page-content-${index}`);
        content.classList.toggle('collapsed');
        collapseBtn.classList.toggle('collapsed');
        
        // Remember expanded state
        if (content.classList.contains('collapsed')) {
          expandedPages.delete(index);
        } else {
          expandedPages.add(index);
        }
      });
      
      if (addBtn) {
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          addElement(index);
        });
      }
      
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        deletePage(index);
      });
      
      // Make only the page header draggable for page reordering
      const pageHeader = pageDiv.querySelector('.page-header');
      const pageCollapseBtn = pageHeader.querySelector('.collapse-btn');
      const pageInput = pageHeader.querySelector('.page-label-input');
      
      // Prevent page drag when clicking on input
      pageInput.addEventListener('mousedown', (e) => {
        pageHeader.draggable = false;
      });
      pageInput.addEventListener('mouseup', (e) => {
        setTimeout(() => pageHeader.draggable = true, 10);
      });
      
      pageHeader.draggable = true;
      pageHeader.addEventListener('dragstart', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') {
          e.preventDefault();
          return;
        }
        handlePageDragStart.call(pageDiv, e);
      });
      pageDiv.addEventListener('dragover', handlePageDragOver);
      pageDiv.addEventListener('drop', handlePageDrop);
      pageDiv.addEventListener('dragend', (e) => handlePageDragEnd.call(pageDiv, e));
      
      // Add drag and drop listeners for elements (both top-level and row children)
      const layoutItems = pageDiv.querySelectorAll('.layout-item');
      layoutItems.forEach(item => {
        item.addEventListener('dragstart', handleElementDragStart);
        item.addEventListener('dragover', handleElementDragOver);
        item.addEventListener('drop', handleElementDrop);
        item.addEventListener('dragend', handleElementDragEnd);
        item.addEventListener('dragleave', handleElementDragLeave);
      });
      
      // Add listeners to empty row drop zones
      const dropZones = pageDiv.querySelectorAll('.row-drop-zone');
      dropZones.forEach(zone => {
        zone.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.add('drag-over');
          lastDropTarget = zone;
        });
        zone.addEventListener('dragleave', (e) => {
          zone.classList.remove('drag-over');
        });
        zone.addEventListener('drop', handleEmptyRowDrop);
      });
      
      // Also add drop listener to the layout container
      const layoutContainer = pageDiv.querySelector('.layout-items');
      if (layoutContainer) {
        layoutContainer.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        layoutContainer.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Trigger drop on last hovered element
          if (lastDropTarget) {
            handleElementDrop.call(lastDropTarget, e);
          }
        });
      }
      
      // Add drop listeners to row and stack children containers
      const childContainers = pageDiv.querySelectorAll('.row-children, .stack-children');
      childContainers.forEach(container => {
        container.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        container.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (lastDropTarget) {
            handleElementDrop.call(lastDropTarget, e);
          }
        });
      });
    });
  }
}

// Page collapse toggle
window.togglePageCollapse = function(index, e) {
  // Prevent toggle if we just finished dragging
  const timeSinceDragEnd = Date.now() - dragEndTime;
  if (timeSinceDragEnd < 200) {
    return;
  }
  
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const content = document.getElementById(`page-content-${index}`);
  const btn = content.previousElementSibling.querySelector('.collapse-btn');
  
  content.classList.toggle('collapsed');
  btn.classList.toggle('collapsed');
};

// Page drag and drop
let draggedPageIndex = null;

function handlePageDragStart(e) {
  draggedPageIndex = parseInt(this.dataset.pageIndex);
  this.style.opacity = '0.5';
}

function handlePageDragOver(e) {
  e.preventDefault();
  this.classList.add('drag-over');
}

function handlePageDragEnd(e) {
  this.style.opacity = '1';
  document.querySelectorAll('.page-item').forEach(item => {
    item.classList.remove('drag-over');
  });
}

function handlePageDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  
  const dropIndex = parseInt(this.dataset.pageIndex);
  
  if (draggedPageIndex !== null && draggedPageIndex !== dropIndex) {
    // Reorder pages
    const [movedPage] = currentConfig.pages.splice(draggedPageIndex, 1);
    currentConfig.pages.splice(dropIndex, 0, movedPage);
    renderEditor(currentConfig);
  }
  
  this.classList.remove('drag-over');
}

// Element drag and drop
let draggedElement = null;
let draggedFromPageIndex = null;
let draggedElementIndex = null;
let draggedChildIndex = null;
let draggedNestedIndex = null; // index inside a nested stack's children
let dropIndicator = null;
let lastDropTarget = null;
let dropPosition = null;
let lastDropTargetMeta = null;

function createDropIndicator() {
  if (!dropIndicator) {
    dropIndicator = document.createElement('div');
    dropIndicator.className = 'drop-indicator';
  }
  return dropIndicator;
}

function removeDropIndicator() {
  if (dropIndicator && dropIndicator.parentNode) {
    dropIndicator.parentNode.removeChild(dropIndicator);
  }
  lastDropTarget = null;
  dropPosition = null;
}

function handleElementDragStart(e) {
  e.stopPropagation();
  const pageIndex = parseInt(this.dataset.pageIndex);
  draggedElementIndex = parseInt(this.dataset.elementIndex);
  draggedFromPageIndex = pageIndex;
  
  // Check if this is a child element
  const childIndex = this.dataset.childIndex;
  const nestedIndex = this.dataset.nestedIndex;
  if (childIndex !== undefined) {
    draggedChildIndex = parseInt(childIndex);
  } else {
    draggedChildIndex = null;
  }
  if (nestedIndex !== undefined) {
    draggedNestedIndex = parseInt(nestedIndex);
  } else {
    draggedNestedIndex = null;
  }
  
  draggedElement = this;
  this.classList.add('dragging');
}

function handleElementDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  
  if (!draggedElement || this === draggedElement) return;
  
  const dropPageIndex = parseInt(this.dataset.pageIndex);
  
  // Only show indicator within same page
  if (draggedFromPageIndex === dropPageIndex) {
    const rect = this.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const indicator = createDropIndicator();
    
    // Store drop target info
    lastDropTarget = this;
    dropPosition = e.clientY < midpoint ? 'before' : 'after';
    // Capture metadata from dataset for nested handling
    lastDropTargetMeta = {
      elementIndex: this.dataset.elementIndex !== undefined ? parseInt(this.dataset.elementIndex) : null,
      childIndex: this.dataset.childIndex !== undefined ? parseInt(this.dataset.childIndex) : null,
      nestedIndex: this.dataset.nestedIndex !== undefined ? parseInt(this.dataset.nestedIndex) : null,
      parentChildIndex: this.dataset.parentChildIndex !== undefined ? parseInt(this.dataset.parentChildIndex) : null,
      pageIndex: this.dataset.pageIndex !== undefined ? parseInt(this.dataset.pageIndex) : null
    };
    
    // Determine if we should insert before or after this element
    if (dropPosition === 'before') {
      this.parentNode.insertBefore(indicator, this);
    } else {
      this.parentNode.insertBefore(indicator, this.nextSibling);
    }
  }
}

function handleElementDragLeave(e) {
  // Don't remove indicator when leaving to another element
  if (e.target === this && !this.contains(e.relatedTarget)) {
    // Only remove if we're leaving the layout-items container
    const layoutItems = this.closest('.layout-items');
    if (e.relatedTarget && !layoutItems.contains(e.relatedTarget)) {
      removeDropIndicator();
    }
  }
}

function handleElementDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  
  if (!draggedElement || !lastDropTarget) {
    removeDropIndicator();
    return;
  }
  
  // Use metadata captured during dragover
  const dropElementIndex = lastDropTargetMeta?.elementIndex;
  const dropPageIndex = lastDropTargetMeta?.pageIndex;
  const dropChildIndex = lastDropTargetMeta?.childIndex !== undefined ? lastDropTargetMeta.childIndex : null;
  const dropNestedIndex = lastDropTargetMeta?.nestedIndex !== undefined ? lastDropTargetMeta.nestedIndex : null;
  const dropParentChildIndex = lastDropTargetMeta?.parentChildIndex !== undefined ? lastDropTargetMeta.parentChildIndex : null;
  
  if (draggedFromPageIndex === dropPageIndex) {
    const page = currentConfig.pages[dropPageIndex];
    
    // Get the dragged element/child
    let draggedItem;
    if (draggedNestedIndex !== null) {
      // Dragging from a nested stack child
      draggedItem = page.layout[draggedElementIndex].children[draggedChildIndex].children[draggedNestedIndex];
    } else if (draggedChildIndex !== null) {
      // Dragging from a row child (direct)
      draggedItem = page.layout[draggedElementIndex].children[draggedChildIndex];
    } else {
      // Dragging a top-level element
      draggedItem = page.layout[draggedElementIndex];
    }
    
    // Remove from source
    if (draggedNestedIndex !== null) {
      page.layout[draggedElementIndex].children[draggedChildIndex].children.splice(draggedNestedIndex, 1);
    } else if (draggedChildIndex !== null) {
      page.layout[draggedElementIndex].children.splice(draggedChildIndex, 1);
    } else {
      page.layout.splice(draggedElementIndex, 1);
    }
    
    // Insert into target
    if (dropNestedIndex !== null) {
      // Dropping relative to a nested child inside a stack -> insert into that stack's children
      const targetParentStack = page.layout[dropElementIndex].children[dropChildIndex];
      if (!targetParentStack.children) targetParentStack.children = [];
      let insertIndex = dropNestedIndex;
      if (draggedNestedIndex !== null && draggedElementIndex === dropElementIndex && draggedChildIndex === dropChildIndex) {
        if (draggedNestedIndex < dropNestedIndex) insertIndex = dropNestedIndex - 1;
      }
      if (dropPosition === 'after') insertIndex++;
      targetParentStack.children.splice(insertIndex, 0, draggedItem);
    } else if (dropChildIndex !== null) {
      // Dropping into a row (as a child of the row)
      const targetRow = page.layout[dropElementIndex];
      if (!targetRow.children) targetRow.children = [];
      let insertIndex = dropChildIndex;
      if (draggedChildIndex !== null && draggedElementIndex === dropElementIndex) {
        if (draggedChildIndex < dropChildIndex) insertIndex = dropChildIndex - 1;
      }
      if (dropPosition === 'after') insertIndex++;
      targetRow.children.splice(insertIndex, 0, draggedItem);
    } else if (dropParentChildIndex !== null) {
      // Dropping into an empty nested stack container (drop zone that belongs to a parent child)
      const parentStack = page.layout[dropElementIndex].children[dropParentChildIndex];
      if (!parentStack.children) parentStack.children = [];
      parentStack.children.push(draggedItem);
    } else {
      // Dropping at top level
      let insertIndex = dropElementIndex !== null ? dropElementIndex : page.layout.length;
      if (draggedChildIndex === null) {
        if (draggedElementIndex < insertIndex) insertIndex = insertIndex - 1;
      }
      if (dropPosition === 'after') insertIndex++;
      page.layout.splice(insertIndex, 0, draggedItem);
    }
    
    renderEditor(currentConfig);
  }
  
  removeDropIndicator();
}

function handleEmptyRowDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  
  if (!draggedElement) return;
  
  const dropElementIndex = parseInt(this.dataset.elementIndex);
  const dropPageIndex = parseInt(this.dataset.pageIndex);
  const dropParentChildIndex = this.dataset.parentChildIndex !== undefined ? parseInt(this.dataset.parentChildIndex) : null;
  
  if (draggedFromPageIndex === dropPageIndex) {
    const page = currentConfig.pages[dropPageIndex];
    
    // Get the dragged element/child
    let draggedItem;
    if (draggedNestedIndex !== null) {
      draggedItem = page.layout[draggedElementIndex].children[draggedChildIndex].children[draggedNestedIndex];
      page.layout[draggedElementIndex].children[draggedChildIndex].children.splice(draggedNestedIndex, 1);
    } else if (draggedChildIndex !== null) {
      draggedItem = page.layout[draggedElementIndex].children[draggedChildIndex];
      page.layout[draggedElementIndex].children.splice(draggedChildIndex, 1);
    } else {
      draggedItem = page.layout[draggedElementIndex];
      page.layout.splice(draggedElementIndex, 1);
    }

    // Add to empty row or empty nested stack drop zone
    if (dropParentChildIndex !== null) {
      // Add into a nested stack's children
      const parentStack = page.layout[dropElementIndex].children[dropParentChildIndex];
      if (!parentStack.children) parentStack.children = [];
      parentStack.children.push(draggedItem);
    } else {
      const targetRow = page.layout[dropElementIndex];
      if (!targetRow.children) targetRow.children = [];
      targetRow.children.push(draggedItem);
    }
    
    renderEditor(currentConfig);
  }
  
  this.classList.remove('drag-over');
}

function handleElementDragEnd(e) {
  e.stopPropagation();
  this.classList.remove('dragging');
  removeDropIndicator();
  draggedElement = null;
  draggedFromPageIndex = null;
  draggedElementIndex = null;
  draggedChildIndex = null;
}

// Element modal functions
let editingChildIndex = null;
let editingChildParentIndex = null; // when adding/editing a child of a nested container (stack inside a row)

window.addElement = function(pageIndex) {
  editingPageIndex = pageIndex;
  editingElementIndex = null;
  editingChildIndex = null;
  document.getElementById("modalTitle").textContent = "Add Element";
  document.getElementById("saveElementBtn").textContent = "Add Element";
  document.getElementById("elementType").value = "button";
  updateElementFields();
  document.getElementById("elementModal").classList.add("active");
};

window.addChildElement = function(pageIndex, rowIndex, parentChildIndex) {
  editingPageIndex = pageIndex;
  editingElementIndex = rowIndex;
  editingChildParentIndex = (parentChildIndex !== undefined) ? parentChildIndex : null; // null = direct child of row
  editingChildIndex = -1; // -1 means adding new child
  // Determine parent (row or nested stack)
  const parent = (editingChildParentIndex === null)
    ? currentConfig.pages[pageIndex].layout[rowIndex]
    : (currentConfig.pages[pageIndex].layout[rowIndex].children || [])[editingChildParentIndex];
  const parentTypeLabel = parent?.type === 'stack' ? 'Stack' : 'Row';
  document.getElementById("modalTitle").textContent = `Add ${parentTypeLabel} Item`;
  document.getElementById("saveElementBtn").textContent = `Add ${parentTypeLabel} Item`;
  document.getElementById("elementType").value = "button";
  updateElementFields();
  document.getElementById("elementModal").classList.add("active");
};

window.editElement = function(pageIndex, elementIndex) {
  editingPageIndex = pageIndex;
  editingElementIndex = elementIndex;
  editingChildIndex = null;
  const element = currentConfig.pages[pageIndex].layout[elementIndex];
  
  document.getElementById("modalTitle").textContent = "Edit Element";
  document.getElementById("saveElementBtn").textContent = "Save Changes";
  document.getElementById("elementType").value = element.type;
  updateElementFields(element);
  document.getElementById("elementModal").classList.add("active");
};

window.editChildElement = function(pageIndex, rowIndex, childIndex, nestedChildIndex) {
  editingPageIndex = pageIndex;
  editingElementIndex = rowIndex;
  if (nestedChildIndex !== undefined) {
    // Editing a child of a nested container (stack inside a row)
    editingChildParentIndex = childIndex;
    editingChildIndex = nestedChildIndex;
    const element = currentConfig.pages[pageIndex].layout[rowIndex].children[childIndex].children[nestedChildIndex];
    const parent = currentConfig.pages[pageIndex].layout[rowIndex].children[childIndex];
    const parentTypeLabel = parent?.type === 'stack' ? 'Stack' : 'Row';
    document.getElementById("modalTitle").textContent = `Edit ${parentTypeLabel} Item`;
    document.getElementById("saveElementBtn").textContent = "Save Changes";
    document.getElementById("elementType").value = element.type;
    updateElementFields(element);
    document.getElementById("elementModal").classList.add("active");
  } else {
    editingChildParentIndex = null;
    editingChildIndex = childIndex;
    const element = currentConfig.pages[pageIndex].layout[rowIndex].children[childIndex];
    const parent = currentConfig.pages[pageIndex].layout[rowIndex];
    const parentTypeLabel = parent?.type === 'stack' ? 'Stack' : 'Row';
    document.getElementById("modalTitle").textContent = `Edit ${parentTypeLabel} Item`;
    document.getElementById("saveElementBtn").textContent = "Save Changes";
    document.getElementById("elementType").value = element.type;
    updateElementFields(element);
    document.getElementById("elementModal").classList.add("active");
  }
};

window.deleteElement = function(pageIndex, elementIndex) {
  if (confirm("Delete this element?")) {
    currentConfig.pages[pageIndex].layout.splice(elementIndex, 1);
    renderEditor(currentConfig);
  }
};

window.deleteChildElement = function(pageIndex, rowIndex, childIndex, nestedChildIndex) {
  if (nestedChildIndex !== undefined) {
    if (confirm("Delete this nested item?")) {
      currentConfig.pages[pageIndex].layout[rowIndex].children[childIndex].children.splice(nestedChildIndex, 1);
      renderEditor(currentConfig);
    }
  } else {
    if (confirm("Delete this row item?")) {
      currentConfig.pages[pageIndex].layout[rowIndex].children.splice(childIndex, 1);
      renderEditor(currentConfig);
    }
  }
};

// Variable management functions

window.addVariable = function(pageIndex) {
  ensureVariableModalInDom().then(() => {
    openVariableModal(pageIndex, '', '', false);
    setTimeout(() => {
      document.getElementById('variableKey').disabled = false;
    }, 0);
    window._saveVariableHandler = function() {
      if (saveVariableFromModal(currentConfig)) {
        renderEditor(currentConfig);
      }
    };
    document.getElementById('saveVariableBtn').onclick = window._saveVariableHandler;
    document.getElementById('cancelVariableBtn').onclick = closeVariableModal;
  });
};

window.editVariable = function(pageIndex, varKey) {
  ensureVariableModalInDom().then(() => {
    const value = currentConfig.pages[pageIndex].variables[varKey];
    openVariableModal(pageIndex, varKey, value, true);
    setTimeout(() => {
      document.getElementById('variableKey').disabled = true;
    }, 0);
    window._saveVariableHandler = function() {
      if (saveVariableFromModal(currentConfig)) {
        renderEditor(currentConfig);
      }
    };
    document.getElementById('saveVariableBtn').onclick = window._saveVariableHandler;
    document.getElementById('cancelVariableBtn').onclick = closeVariableModal;
  });
};

window.deleteVariable = function(pageIndex, varKey) {
  if (confirm(`Delete variable "${varKey}"?`)) {
    delete currentConfig.pages[pageIndex].variables[varKey];
    renderEditor(currentConfig);
  }
};

// Global variable handlers
window.addGlobalVariable = function() {
  ensureVariableModalInDom().then(() => {
    openVariableModal('global', '', '', false);
    setTimeout(() => {
      const el = document.getElementById('variableKey'); if (el) el.disabled = false;
    }, 0);
    window._saveVariableHandler = function() {
      if (saveVariableFromModal(currentConfig)) {
        renderEditor(currentConfig);
      }
    };
    document.getElementById('saveVariableBtn').onclick = window._saveVariableHandler;
    document.getElementById('cancelVariableBtn').onclick = closeVariableModal;
  });
};

window.editGlobalVariable = function(varKey) {
  ensureVariableModalInDom().then(() => {
    const value = currentConfig.global?.variables?.[varKey];
    openVariableModal('global', varKey, value, true);
    setTimeout(() => {
      const el = document.getElementById('variableKey'); if (el) el.disabled = true;
    }, 0);
    window._saveVariableHandler = function() {
      if (saveVariableFromModal(currentConfig)) {
        renderEditor(currentConfig);
      }
    };
    document.getElementById('saveVariableBtn').onclick = window._saveVariableHandler;
    document.getElementById('cancelVariableBtn').onclick = closeVariableModal;
  });
};

window.deleteGlobalVariable = function(varKey) {
  if (confirm(`Delete global variable "${varKey}"?`)) {
    if (currentConfig.global && currentConfig.global.variables) {
      delete currentConfig.global.variables[varKey];
    }
    renderEditor(currentConfig);
  }
};

window.closeElementModal = function() {
  document.getElementById("elementModal").classList.remove("active");
  editingPageIndex = null;
  editingElementIndex = null;
  editingChildIndex = null;
  editingChildParentIndex = null;
};

window.updateElementFields = function(existingElement = null) {
  const type = document.getElementById("elementType").value;
  const fieldsContainer = document.getElementById("elementFields");
  
  let html = '';
  
  switch(type) {
    case 'button':
      html = `
        <div class="input-group">
          <label>Label</label>
          <input type="text" id="elem_label" value="${existingElement?.label || ''}" placeholder="Button Text" />
        </div>
        <div class="input-group">
          <label>Commands (one per line)</label>
          <textarea id="elem_commands" placeholder="JustDices.roll('1d20')">${existingElement?.commands?.join('\n') || ''}</textarea>
        </div>
      `;
      break;
    case 'value':
      html = `
        <div class="input-group">
          <label>Variable Name</label>
          <input type="text" id="elem_var" value="${existingElement?.var || ''}" placeholder="variableName" />
        </div>
        <div class="input-group">
          <label>Label</label>
          <input type="text" id="elem_label" value="${existingElement?.label || ''}" placeholder="Display Label" />
        </div>
      `;
      break;
    case 'input':
      html = `
        <div class="input-group">
          <label>Variable Name</label>
          <input type="text" id="elem_var" value="${existingElement?.var || ''}" placeholder="variableName" />
        </div>
        <div class="input-group">
          <label>Label</label>
          <input type="text" id="elem_label" value="${existingElement?.label || ''}" placeholder="Input Label" />
        </div>
        <div class="input-group">
          <label>Placeholder</label>
          <input type="text" id="elem_placeholder" value="${existingElement?.placeholder || ''}" placeholder="Placeholder text..." />
        </div>
      `;
      break;
    case 'counter':
      html = `
        <div class="input-group">
          <label>Variable Name</label>
          <input type="text" id="elem_var" value="${existingElement?.var || ''}" placeholder="variableName" />
        </div>
        <div class="input-group">
          <label>Label</label>
          <input type="text" id="elem_label" value="${existingElement?.label || ''}" placeholder="Counter Label" />
        </div>
        <div class="input-group">
          <label>Step (optional)</label>
          <input type="number" id="elem_step" value="${existingElement?.step || ''}" placeholder="1" />
        </div>
      `;
      break;
    case 'checkbox':
      html = `
        <div class="input-group">
          <label>Variable Name</label>
          <input type="text" id="elem_var" value="${existingElement?.var || ''}" placeholder="variableName" />
        </div>
        <div class="input-group">
          <label>Label</label>
          <input type="text" id="elem_label" value="${existingElement?.label || ''}" placeholder="Checkbox Label" />
        </div>
      `;
      break;
    case 'title':
      html = `
        <div class="input-group">
          <label>Text</label>
          <input type="text" id="elem_text" value="${existingElement?.text || ''}" placeholder="Title Text" />
        </div>
      `;
      break;
    case 'text':
      html = `
        <div class="input-group">
          <label>Content</label>
          <textarea id="elem_content">${existingElement?.content || ''}</textarea>
        </div>
      `;
      break;
    case 'divider':
      html = `<p style="color: #888;">Dividers have no properties.</p>`;
      break;
    case 'row':
      html = `<p style="color: #4ea1ff;">Row is a container. Use the "+ Item" button to add elements to the row.</p>`;
      break;
    case 'stack':
      html = `<p style="color: #4ea1ff;">Stack is a vertical container. Use the "+ Item" button to add elements to the stack.</p>`;
      break;
  }
  
  fieldsContainer.innerHTML = html;
};

window.saveElement = function() {
  const type = document.getElementById("elementType").value;
  const element = { type };
  
  // Build element based on type
  switch(type) {
    case 'button':
      element.label = document.getElementById("elem_label")?.value || '';
      const commands = document.getElementById("elem_commands")?.value || '';
      element.commands = commands.split('\n').filter(c => c.trim());
      break;
    case 'value':
    case 'checkbox':
      element.var = document.getElementById("elem_var")?.value || '';
      element.label = document.getElementById("elem_label")?.value || '';
      break;
    case 'input':
      element.var = document.getElementById("elem_var")?.value || '';
      element.label = document.getElementById("elem_label")?.value || '';
      element.placeholder = document.getElementById("elem_placeholder")?.value || '';
      break;
    case 'counter':
      element.var = document.getElementById("elem_var")?.value || '';
      element.label = document.getElementById("elem_label")?.value || '';
      const step = document.getElementById("elem_step")?.value;
      if (step) element.step = parseInt(step);
      break;
    case 'title':
      element.text = document.getElementById("elem_text")?.value || '';
      break;
    case 'text':
      element.content = document.getElementById("elem_content")?.value || '';
      break;
    case 'row':
      // Initialize with empty children array if creating new row
      if (editingElementIndex === null || editingChildIndex !== null) {
        element.children = [];
      } else {
        // Preserve existing children when editing
        const existing = currentConfig.pages[editingPageIndex].layout[editingElementIndex];
        element.children = existing.children || [];
      }
      break;
    case 'stack':
      // Initialize with empty children array if creating new stack
      if (editingElementIndex === null || editingChildIndex !== null) {
        element.children = [];
      } else {
        // Preserve existing children when editing
        const existing = currentConfig.pages[editingPageIndex].layout[editingElementIndex];
        element.children = existing.children || [];
      }
      break;
  }
  
  // Add or update element
  if (editingChildIndex !== null) {
    // Working with a child. Support nested containers (stack inside a row) via editingChildParentIndex
    if (editingChildParentIndex === null) {
      // Direct child of a row
      const row = currentConfig.pages[editingPageIndex].layout[editingElementIndex];
      if (editingChildIndex === -1) {
        // Adding new child
        if (!row.children) row.children = [];
        row.children.push(element);
      } else {
        // Editing existing child
        row.children[editingChildIndex] = element;
      }
    } else {
      // Child of a nested container (stack inside a row)
      const parentStack = currentConfig.pages[editingPageIndex].layout[editingElementIndex].children[editingChildParentIndex];
      if (!parentStack.children) parentStack.children = [];
      if (editingChildIndex === -1) {
        parentStack.children.push(element);
      } else {
        parentStack.children[editingChildIndex] = element;
      }
    }
  } else if (editingElementIndex !== null) {
    // Editing existing element
    currentConfig.pages[editingPageIndex].layout[editingElementIndex] = element;
  } else {
    // Adding new element
    if (!currentConfig.pages[editingPageIndex].layout) {
      currentConfig.pages[editingPageIndex].layout = [];
    }
    currentConfig.pages[editingPageIndex].layout.push(element);
  }
  
  closeElementModal();
  renderEditor(currentConfig);
};

// Delete page
window.deletePage = function(index) {
  if (confirm("Delete this page?")) {
    currentConfig.pages.splice(index, 1);
    renderEditor(currentConfig);
  }
}

// Add page
document.getElementById("addPageBtn").onclick = () => {
  if (!currentConfig.pages) {
    currentConfig.pages = [];
  }
  currentConfig.pages.push({
    label: "New Page",
    variables: {},
    layout: []
  });
  renderEditor(currentConfig);
};

// Tab click handlers will be attached when the modal is ready (inside OBR.onReady)

// Sync from JSON button
document.getElementById("syncFromJson").onclick = syncFromJson;

// Cancel
document.getElementById("cancelBtn").onclick = () => {
  console.log("Cancel clicked");
  closeModal()
};

// Save
document.getElementById("saveBtn").onclick = async () => {
  const apiKeyInput = document.getElementById("apiKeyInput");
  const sheetIdInput = document.getElementById("sheetIdInput");
  
  console.log("Save clicked, validating...");

  try {
    let config;
    
    // Build config from current tab
    if (currentTab === 'json') {
      const text = document.getElementById("cfgArea").value;
      config = JSON.parse(text);
    } else {
      config = buildConfigFromEditor();
    }
    
    console.log("✓ Config built successfully:", config);
    
    // Validate structure
    if (!config.global || !Array.isArray(config.pages)) {
      throw new Error("Config must have 'global' object and 'pages' array");
    }
    
    // Save Google Sheets credentials to localStorage
    const apiKey = apiKeyInput.value.trim() || apiKeyInput.dataset.original || "";
    const sheetId = sheetIdInput.value.trim() || sheetIdInput.dataset.original || "";

    // Hide any previous GS error
    const gsErrEl = document.getElementById('gsheetsError');
    if (gsErrEl) gsErrEl.style.display = 'none';

    // If config references GoogleSheets but credentials are missing/too short, block save
    function scanObjectForGoogleSheets(obj) {
      if (!obj) return false;
      if (typeof obj === 'string') {
        return obj.includes('GoogleSheets.');
      }
      if (typeof obj === 'object') {
        if (Array.isArray(obj)) {
          for (const it of obj) {
            if (scanObjectForGoogleSheets(it)) return true;
          }
        } else {
          for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (scanObjectForGoogleSheets(v)) return true;
          }
        }
      }
      return false;
    }

    const usesGoogleSheets = scanObjectForGoogleSheets(config);
    const credInvalid = (!apiKey || apiKey.length < 10) || (!sheetId || sheetId.length < 10);
    if (usesGoogleSheets && credInvalid) {
      const errMsg = 'Google Sheets is referenced in the configuration but API Key or Sheet ID is missing/invalid. Please configure them to avoid repeated API calls.';
      if (gsErrEl) {
        gsErrEl.textContent = errMsg;
        gsErrEl.style.display = 'block';
      }
      // Switch user to GS tab so they can correct credentials
      try { switchTab('gsheets'); } catch (e) {}
      throw new Error(errMsg);
    }

    saveGoogleSheetsApiKey(apiKey);
    saveGoogleSheetsSheetId(sheetId);

    // Persist full config to room-scoped localStorage (modal context)
    try {
      await saveConfigToLocalStorage(config);
      console.log("✓ Config saved to room-scoped localStorage by modal");
    } catch (err) {
      console.warn("[MODAL] Failed to save full config to localStorage:", err);
    }

    console.log("✓ Config valid, notifying main app to reload from storage...");
    await closeModal({ savedFromModal: true, gsheetUpdated: true });
  } catch (e) {
    console.error("✗ Validation error:", e);
    alert("Error: " + e.message);
  }
};

/**
 * Mask sensitive string showing only first and last few characters
 * @param {string} str - String to mask
 * @param {number} visibleChars - Number of characters to show at start and end
 * @returns {string} Masked string
 */
function maskSensitiveData(str, visibleChars = 4) {
  if (!str || str.length <= visibleChars * 2) {
    return str;
  }
  const start = str.substring(0, visibleChars);
  const end = str.substring(str.length - visibleChars);
  const masked = '•'.repeat(Math.min(12, str.length - visibleChars * 2));
  return `${start}${masked}${end}`;
}

OBR.onReady(() => {
  console.log("=== Config Modal Ready ===");
  
  // Load Google Sheets credentials from localStorage
  const { apiKey, sheetId } = getGoogleSheetsCredentials();
  
  // Store original values for saving later
  const apiKeyInput = document.getElementById("apiKeyInput");
  const sheetIdInput = document.getElementById("sheetIdInput");
  
  // Display masked values as placeholders, leave inputs empty
  if (apiKey) {
    apiKeyInput.placeholder = maskSensitiveData(apiKey);
  }
  if (sheetId) {
    sheetIdInput.placeholder = maskSensitiveData(sheetId);
  }
  
  // Store original values in data attributes
  apiKeyInput.dataset.original = apiKey;
  sheetIdInput.dataset.original = sheetId;
  
  // Load current config
  loadConfig().then(cfg => {
    console.log("Modal loaded current config:", cfg);
    currentConfig = cfg;
    renderEditor(cfg);
    document.getElementById("cfgArea").value = JSON.stringify(cfg, null, 2);
    // Attach tab handlers now that DOM is ready
      document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
          e.preventDefault();
          switchTab(tab.dataset.tab);
        });
      });
      // No delegated fallback — explicit handlers above are sufficient and less intrusive.
    // Ensure initial tab state
    switchTab(currentTab);
  }).catch(error => {
    console.error("Error loading config in modal:", error);
  });
});
