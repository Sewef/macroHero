import OBR from "@owlbear-rodeo/sdk";
import { STORAGE_KEY, MODAL_LABEL, loadConfig, saveConfig, saveConfigToLocalStorage } from "./config.js";
import { saveGoogleSheetsApiKey, saveGoogleSheetsSheetId, getGoogleSheetsCredentials } from "./commands/integrations/GoogleSheets.js";
import { isDebugEnabled } from "./debugMode.js";

// Debug mode constants - use centralized debugMode module
const debugLog = (...args) => isDebugEnabled('configModal') && console.log(...args);
const debugWarn = (...args) => console.warn(...args);
const debugError = (...args) => console.error(...args);

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
        <div class="modal-content" style="width: 500px; max-width: 95vw;">
          <div class="modal-header">
            <h3 id="variableModalTitle">Edit Variable</h3>
            <button type="button" class="close-modal" onclick="(function(){document.getElementById('variableModal').style.display='none';})();">×</button>
          </div>
          <div class="input-group">
            <label for="variableKey">Name</label>
            <input type="text" id="variableKey" />
          </div>
          <div class="input-group">
            <label>
              <input type="radio" name="variableType" value="value" id="variableTypeValue" checked />
              Literal Value
            </label>
            <input type="text" id="variableValue" placeholder="e.g. 42 or 'text' or true" />
          </div>
          <div class="input-group">
            <label>
              <input type="radio" name="variableType" value="eval" id="variableTypeEval" />
              Expression (Eval)
            </label>
            <input type="text" id="variableEval" placeholder="e.g. Math.floor(atk * 1.5)" disabled />
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
      // Add event listeners for radio buttons to enable/disable inputs
      setTimeout(() => {
        const valueRadio = document.getElementById('variableTypeValue');
        const evalRadio = document.getElementById('variableTypeEval');
        const valueInput = document.getElementById('variableValue');
        const evalInput = document.getElementById('variableEval');
        
        if (valueRadio && evalRadio && valueInput && evalInput) {
          valueRadio.addEventListener('change', () => {
            valueInput.disabled = false;
            evalInput.disabled = true;
          });
          evalRadio.addEventListener('change', () => {
            valueInput.disabled = true;
            evalInput.disabled = false;
          });
        }
        resolve();
      }, 0);
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
  
  // Get input elements
  const valueRadio = document.getElementById('variableTypeValue');
  const evalRadio = document.getElementById('variableTypeEval');
  const valueInput = document.getElementById('variableValue');
  const evalInput = document.getElementById('variableEval');
  const minInput = document.getElementById('variableMin');
  const maxInput = document.getElementById('variableMax');
  
  // Reset form
  if (valueInput) valueInput.value = '';
  if (evalInput) evalInput.value = '';
  if (minInput) minInput.value = '';
  if (maxInput) maxInput.value = '';
  
  // Populate fields based on variable structure
  if (typeof value === 'object' && value !== null) {
    // New format: {value: ..., eval: ..., min: ..., max: ...}
    if ('value' in value) {
      if (valueRadio) valueRadio.checked = true;
      if (valueInput) {
        valueInput.disabled = false;
        valueInput.value = typeof value.value === 'string' ? value.value : JSON.stringify(value.value);
      }
      if (evalInput) evalInput.disabled = true;
    } else if ('eval' in value) {
      if (evalRadio) evalRadio.checked = true;
      if (evalInput) {
        evalInput.disabled = false;
        evalInput.value = value.eval ?? '';
      }
      if (valueInput) valueInput.disabled = true;
    } else if ('expression' in value) {
      // Legacy format - treat as eval
      if (evalRadio) evalRadio.checked = true;
      if (evalInput) {
        evalInput.disabled = false;
        evalInput.value = value.expression ?? '';
      }
      if (valueInput) valueInput.disabled = true;
    }
    
    if (minInput) minInput.value = (value.min !== undefined && value.min !== null) ? value.min : '';
    if (maxInput) maxInput.value = (value.max !== undefined && value.max !== null) ? value.max : '';
  } else {
    // Simple value
    if (valueRadio) valueRadio.checked = true;
    if (valueInput) {
      valueInput.disabled = false;
      valueInput.value = (value !== undefined && value !== null) ? String(value) : '';
    }
    if (evalInput) evalInput.disabled = true;
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
  const valueRadio = document.getElementById('variableTypeValue');
  const valueInput = document.getElementById('variableValue');
  const evalInput = document.getElementById('variableEval');
  const minEl = document.getElementById('variableMin');
  const maxEl = document.getElementById('variableMax');
  
  if (!keyEl || !valueRadio || !valueInput || !evalInput || !minEl || !maxEl) return false;
  
  const key = keyEl.value.trim();
  const isValue = valueRadio.checked;
  const valueRaw = valueInput.value.trim();
  const evalRaw = evalInput.value.trim();
  const minRaw = minEl.value.trim();
  const maxRaw = maxEl.value.trim();
  
  if (!key) {
    showVariableError('Variable name is required.');
    return false;
  }
  
  // Build value object
  let value = {};
  
  if (isValue) {
    // Literal value - try to parse as JSON for proper types
    if (valueRaw === '') {
      showVariableError('Value is required.');
      return false;
    }
    try {
      // Try parsing as JSON to get proper types (numbers, booleans, etc.)
      value.value = JSON.parse(valueRaw);
    } catch {
      // If not valid JSON, treat as string
      value.value = valueRaw;
    }
  } else {
    // Expression to eval
    if (evalRaw === '') {
      showVariableError('Expression is required.');
      return false;
    }
    value.eval = evalRaw;
  }
  
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
          debugLog(`[MODAL] broadcast.sendMessage succeeded (mode=${attempt.desc})`);
          sent = true;
          break;
        } catch (err) {
          // Log detailed info for debugging
          try {
            debugWarn(`[MODAL] broadcast.sendMessage failed (mode=${attempt.desc}):`, err && err.error ? err.error : err);
          } catch (logErr) {
            debugWarn('[MODAL] broadcast.sendMessage failed (and could not stringify error)');
          }
        }
      }

      if (!sent) {
        debugError('[MODAL] ERROR: All attempts to broadcast config.result failed');
      }
    }
  } catch (err) {
    debugError("[MODAL] Unexpected error while broadcasting config result:", err);
  }

  try {
    await OBR.modal.close(MODAL_LABEL);
  } catch (err) {
    debugWarn("[MODAL] Warning: modal.close failed:", err);
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

  // When switching to the Token Helper tab, fetch and render tokens
  if (tabName === 'tokens') {
    // Ensure we have a current user cached (non-blocking)
    getCurrentUserId().then(id => {
      _tokenHelperMeId = id;
    }).catch(() => {});
    // Refresh token data
    refreshTokenHelper();
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
  
  // Render global variables (definitions only)
  const globalVarsContainer = document.getElementById('globalVariablesList');
  if (globalVarsContainer) {
    const globals = config.global?.variables || {};
    const keys = Object.keys(globals || {});
    if (keys.length === 0) {
      globalVarsContainer.innerHTML = '<div style="color: #666; font-size: 0.85em;">No global variables</div>';
    } else {
      globalVarsContainer.innerHTML = keys.map(k => {
        const v = globals[k];
        // Only show definition fields
        let def = '';
        if (typeof v === 'object' && v !== null) {
          def = [
            v.value !== undefined ? `value: <code>${typeof v.value === 'string' ? v.value : JSON.stringify(v.value)}</code>` : '',
            v.eval !== undefined ? `eval: <code>${v.eval}</code>` : '',
            v.expression !== undefined ? `expr: <code>${v.expression}</code>` : '', // legacy fallback
            v.min !== undefined ? `min: ${v.min}` : '',
            v.max !== undefined ? `max: ${v.max}` : ''
          ].filter(Boolean).join(', ');
        } else {
          def = String(v);
        }
        return `
        <div class="variable-item" data-var-key="${k}">
          <span class="variable-key">${k}</span>
          <span class="variable-value">${def}</span>
          <div class="variable-actions">
            <button type="button" class="btn-small" onclick="event.stopPropagation(); editGlobalVariable('${k}')">Edit</button>
            <button type="button" class="btn-small btn-danger" onclick="event.stopPropagation(); deleteGlobalVariable('${k}')">×</button>
          </div>
        </div>
        `;
      }).join('');
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
        const label = item.label || item.expression || item.text || item.var || '';
        
        // Handle row items (treat as container even if children is missing)
        if (item.type === 'row') {
          const childrenArr = (item.children && Array.isArray(item.children)) ? item.children : [];
          const childrenHtml = childrenArr.map((child, childIndex) => {
            // If the child is itself a stack, render it as a nested container with its own children
            if (child.type === 'stack') {
              const nested = (child.children && Array.isArray(child.children)) ? child.children : [];
              const nestedHtml = nested.map((nChild, nestedIndex) => {
                const nLabel = nChild.label || nChild.expression || nChild.text || nChild.var || '';
                const nContent = nChild.type === 'text' && nChild.expression ? nChild.expression.substring(0, 50) + (nChild.expression.length > 50 ? '...' : '') : nLabel;
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

            const childLabel = child.label || child.expression || child.text || child.var || '';
            const childContent = child.type === 'text' && child.expression ? child.expression.substring(0, 50) + (child.expression.length > 50 ? '...' : '') : childLabel;
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
            const childLabel = child.label || child.expression || child.text || child.var || '';
            const childContent = child.type === 'text' && child.expression ? child.expression.substring(0, 50) + (child.expression.length > 50 ? '...' : '') : childLabel;
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
        
        const content = item.type === 'text' && item.expression ? item.expression.substring(0, 50) + (item.expression.length > 50 ? '...' : '') : label;
        
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
              ${page.variables ? Object.entries(page.variables).map(([key, value]) => {
                // Only show definition fields
                let def = '';
                if (typeof value === 'object' && value !== null) {
                  def = [
                    value.value !== undefined ? `value: <code>${typeof value.value === 'string' ? value.value : JSON.stringify(value.value)}</code>` : '',
                    value.eval !== undefined ? `eval: <code>${value.eval}</code>` : '',
                    value.expression !== undefined ? `expr: <code>${value.expression}</code>` : '', // legacy fallback
                    value.min !== undefined ? `min: ${value.min}` : '',
                    value.max !== undefined ? `max: ${value.max}` : ''
                  ].filter(Boolean).join(', ');
                } else {
                  def = String(value);
                }
                return `
                  <div class="variable-item" data-var-key="${key}">
                    <span class="variable-key">${key}</span>
                    <span class="variable-value">${def}</span>
                    <div class="variable-actions">
                      <button type="button" class="btn-small" onclick="event.stopPropagation(); editVariable(${index}, '${key}')">Edit</button>
                      <button type="button" class="btn-small btn-danger" onclick="event.stopPropagation(); deleteVariable(${index}, '${key}')">×</button>
                    </div>
                  </div>
                `;
              }).join('') : '<div style="color: #666; font-size: 0.85em;">No variables</div>'}
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
          <label>Expression</label>
          <input type="text" id="elem_expression" value="${existingElement?.expression || ''}" placeholder="Title expression (e.g. '{sheetValue}')" />
        </div>
      `;
      break;
    case 'text':
      html = `
        <div class="input-group">
          <label>Expression</label>
          <textarea id="elem_expression">${existingElement?.expression || ''}</textarea>
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
      element.expression = document.getElementById("elem_expression")?.value || '';
      break;
    case 'text':
      element.expression = document.getElementById("elem_expression")?.value || '';
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

// --- Token Helper Utilities ---
let _tokenHelperCache = [];
let _tokenHelperMeId = null;
// Cached DOM refs for token helper to avoid repeated lookups
let _tokensListEl = null;
let _tokensStatusEl = null;
let _tokensSearchEl = null;
let _tokensFilterEl = null;
let _tokensRefreshBtn = null;

// Utility: debounce function to limit frequent calls (search input)
function debounce(fn, wait = 200) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

async function getCurrentUserId() {
  if (_tokenHelperMeId) return _tokenHelperMeId;

  // Use the canonical property exposed by the OBR SDK
  try {
    if (OBR && OBR.player) {
      if (OBR.player.id) {
        _tokenHelperMeId = OBR.player.id;
        debugLog('[TOKEN_HELPER] detected current user via OBR.player.id:', _tokenHelperMeId);
        return _tokenHelperMeId;
      }
    }
  } catch (err) {
    debugWarn('[TOKEN_HELPER] getCurrentUserId unexpected error:', err);
  }

  return null;
}

async function fetchSceneItemsForTokenHelper() {
  try {
    // Try the more specific API first, then fallback
    let items = [];
    if (OBR && OBR.scene && OBR.scene.items && typeof OBR.scene.items.getItems === 'function') {
      items = await OBR.scene.items.getItems();
    } else if (OBR && OBR.scene && typeof OBR.scene.getItems === 'function') {
      items = await OBR.scene.getItems();
    } else {
      throw new Error('No compatible OBR scene item API found');
    }

    _tokenHelperCache = Array.isArray(items) ? items : [];
    return _tokenHelperCache;
  } catch (err) {
    debugError('[TOKEN_HELPER] Error fetching scene items:', err);
    _tokenHelperCache = [];
    throw err;
  }
}

function truncated(str, len = 36) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '…' : str;
}

async function copyToClipboard(text) {
  // Primary: try to use modern Clipboard API when it's likely allowed.
  // Query the Permissions API first to avoid gratuitous browser policy logs
  // in contexts where clipboard access is blocked by embedding policies.
  let tryClipboard = false;
  try {
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      try {
        const perm = await navigator.permissions.query({ name: 'clipboard-write' });
        tryClipboard = (perm.state === 'granted' || perm.state === 'prompt');
      } catch (permErr) {
        // Some browsers or embedding contexts may throw; fall back to attempting clipboard
        tryClipboard = true;
      }
    } else {
      tryClipboard = true;
    }
  } catch (err) {
    tryClipboard = true;
  }

  if (tryClipboard && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      // Use debug-level logging here — browser will often emit a policy violation message
      // that cannot be suppressed; keep our log quieter and continue to fallbacks.
      console.debug('[TOKEN_HELPER] navigator.clipboard.writeText failed (falling back):', err);
    }
  }

  // Fallback: execCommand with a temporary textarea
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Keep off-screen and non-intrusive
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return;
    debugWarn('[TOKEN_HELPER] document.execCommand returned false');
  } catch (err) {
    debugWarn('[TOKEN_HELPER] execCommand fallback failed:', err);
  }

  // Last resort: show a prompt with the text so the user can copy manually
  try {
    window.prompt('Copy the ID (Ctrl/Cmd+C then Enter):', text);
    return;
  } catch (err) {
    debugWarn('[TOKEN_HELPER] prompt fallback failed:', err);
  }

  throw new Error('Copy to clipboard failed (all fallbacks)');
}

function renderTokenHelperList(items) {
  const container = _tokensListEl || document.getElementById('tokensList');
  const status = _tokensStatusEl || document.getElementById('tokensStatus');
  if (!container) return;
  // Clear previous content efficiently
  container.textContent = '';

  if (!items || items.length === 0) {
    container.innerHTML = '<div style="color:#666">No items found in the scene.</div>';
    if (status) status.textContent = '';
    return;
  }

  // Group by layer
  const groups = {};
  items.forEach(it => {
    const layer = it.layer || 'UNKNOWN';
    if (!groups[layer]) groups[layer] = [];
    groups[layer].push(it);
  });

  Object.keys(groups).sort().forEach(layer => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'page-item';
    groupDiv.style.marginBottom = '10px';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '8px';

    const title = document.createElement('div');
    title.innerHTML = `<strong style="color:#4ea1ff">${layer}</strong> — ${groups[layer].length} items`;
    header.appendChild(title);

    const expandAllBtn = document.createElement('div');
    expandAllBtn.innerHTML = `<button type="button" class="btn-small">Expand all</button>`;
    expandAllBtn.firstChild.onclick = (e) => {
      const itemsEls = groupDiv.querySelectorAll('.token-item');
      itemsEls.forEach(el => el.classList.add('expanded'));
    };
    const collapseAllBtn = document.createElement('div');
    collapseAllBtn.innerHTML = `<button type="button" class="btn-small">Collapse all</button>`;
    collapseAllBtn.firstChild.onclick = (e) => {
      const itemsEls = groupDiv.querySelectorAll('.token-item');
      itemsEls.forEach(el => el.classList.remove('expanded'));
    };

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.appendChild(expandAllBtn);
    actions.appendChild(collapseAllBtn);

    header.appendChild(actions);
    groupDiv.appendChild(header);

    const list = document.createElement('div');
    // Use a fragment for batch DOM updates
    const frag = document.createDocumentFragment();
    groups[layer].forEach(it => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'variable-item token-item';
      itemDiv.style.cursor = 'pointer';
      itemDiv.style.flexDirection = 'column';

      const summary = document.createElement('div');
      summary.style.display = 'flex';
      summary.style.justifyContent = 'space-between';
      summary.style.alignItems = 'center';
      summary.style.gap = '12px';

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.gap = '12px';
      left.style.alignItems = 'center';
      left.style.flex = '1';

      const lblType = document.createElement('span');
      lblType.className = 'layout-item-type';
      lblType.textContent = it.type || 'unknown';
      left.appendChild(lblType);

      const txt = document.createElement('span');
      // Prefer explicit name, then plainText, then richText first child's text, then id
      const displayText = it.name || (it.text && (it.text.plainText || (
        (it.text.richText && it.text.richText[0] && it.text.richText[0].text) || ''
      ))) || it.id || '';
      txt.innerHTML = `<strong>${truncated(displayText, 36)}</strong>`;
      // Ensure the main text expands and is left-aligned (not centered)
      txt.style.flex = '1';
      txt.style.textAlign = 'left';
      txt.style.overflow = 'hidden';
      txt.style.textOverflow = 'ellipsis';
      txt.style.whiteSpace = 'nowrap';
      left.appendChild(txt);

      const meta = document.createElement('span');
      meta.style.color = '#bbb';
      meta.style.fontSize = '0.9em';
      meta.textContent = `${it.layer || ''} • ${it.visible ? 'visible' : 'hidden'}`;
      // show an abbreviated creator id and reveal full id on hover
      const creator = it.createdUserId || it.createdBy || it.ownerId || it.lastModifiedUserId || null;
      if (creator) {
        meta.textContent += ` • creator: ${String(creator).substring(0, 8)}`;
        meta.title = `creator: ${creator}`;
      }
      left.appendChild(meta);

      summary.appendChild(left);

      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.gap = '8px';
      right.style.alignItems = 'center';

      const idSpan = document.createElement('code');
      idSpan.style.fontSize = '0.8em';
      idSpan.textContent = truncated(it.id, 20);
      idSpan.title = it.id;
      right.appendChild(idSpan);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn-small';
      copyBtn.textContent = 'Copy ID';
      copyBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await copyToClipboard(`'${it.id}'`);
          const original = copyBtn.textContent;
          copyBtn.textContent = 'Copied';
          setTimeout(() => { copyBtn.textContent = original; }, 1200);
        } catch (err) {
          debugWarn('[TOKEN_HELPER] copy failed:', err);
          // copyToClipboard already used prompt fallback - inform user in status
          const s = document.getElementById('tokensStatus');
          if (s) s.textContent = 'Copy failed — please copy the ID from the prompt or manually.';
        }
      };
      right.appendChild(copyBtn);

      summary.appendChild(right);

      itemDiv.appendChild(summary);

      // Details (collapsed by default)
      const details = document.createElement('div');
      details.style.display = 'none';
      details.style.marginTop = '8px';
      details.style.width = '100%';
      // Lazy-populate JSON only when expanded to avoid heavy work on large lists
      details.dataset.populated = 'false';
      itemDiv.appendChild(details);

      // Toggle (lazy details population)
      summary.onclick = () => {
        const expanded = details.style.display !== 'none';
        if (!expanded) {
          // Populate details only once
          if (details.dataset.populated !== 'true') {
            const pre = document.createElement('pre');
            pre.style.whiteSpace = 'pre-wrap';
            pre.style.fontFamily = 'monospace';
            pre.style.fontSize = '0.85em';
            pre.style.margin = '0';
            pre.textContent = JSON.stringify(it, null, 2);
            details.appendChild(pre);
            details.dataset.populated = 'true';
          }
          details.style.display = 'block';
          itemDiv.classList.add('expanded');
        } else {
          details.style.display = 'none';
          itemDiv.classList.remove('expanded');
        }
      };

      frag.appendChild(itemDiv);
    });
    list.appendChild(frag);
    groupDiv.appendChild(list);
    container.appendChild(groupDiv);
  });

  if (status) status.textContent = `Loaded ${items.length} items`;
}

async function refreshTokenHelper() {
  const status = document.getElementById('tokensStatus');
  const refreshBtn = document.getElementById('tokensRefresh');
  try {
    if (refreshBtn) refreshBtn.disabled = true;
    if (status) status.textContent = 'Fetching scene items...';
    const me = await getCurrentUserId();
    _tokenHelperMeId = me; // cache
    const items = await fetchSceneItemsForTokenHelper();
    // Apply current filter/search
    applyTokensFiltersAndRender();
  } catch (err) {
    const s = document.getElementById('tokensStatus');
    if (s) s.textContent = 'Failed to fetch items.';
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

async function applyTokensFiltersAndRender() {
  try {
    const q = (document.getElementById('tokensSearch')?.value || '').trim().toLowerCase();
    const filter = document.getElementById('tokensFilter')?.value || 'all';

    // Ensure we have current user id when 'me' filter is requested
    if (filter === 'me' && !_tokenHelperMeId) {
      const status = document.getElementById('tokensStatus');
      if (status) status.textContent = 'Detecting current user...';
      const detected = await getCurrentUserId();
      _tokenHelperMeId = detected;
      if (!detected) {
        // Inform the user and show no items (safer than showing all)
        const container = document.getElementById('tokensList');
        if (container) container.innerHTML = '<div style="color:#ffb86b;">Could not detect current user ID — cannot filter by "Me". Try Refresh.</div>';
        if (status) status.textContent = 'Could not detect current user ID';
        return;
      }
      if (status) status.textContent = '';
    }

    let items = Array.from(_tokenHelperCache || []);
    // Diagnostics: log total and some creator ids
    try {
      const creators = Array.from(new Set(items.map(it => it.createdUserId).filter(Boolean)));
      debugLog('[TOKEN_HELPER] applyFilters', { filter, me: _tokenHelperMeId, total: items.length, creators: creators.slice(0, 20) });
    } catch (err) {
      debugWarn('[TOKEN_HELPER] diagnostics failure', err);
    }

    // Use a robust getter for creator id to handle different possible shapes
    function getCreatorId(it) {
      return (it && (it.createdUserId || it.createdBy || it.created || it.ownerId || it.lastModifiedUserId)) || null;
    }

    if (filter === 'me' && _tokenHelperMeId) {
      items = items.filter(i => {
        const cid = getCreatorId(i);
        return cid && String(cid).trim() === String(_tokenHelperMeId).trim();
      });
    }
    if (q) {
      items = items.filter(i => {
        const textPart = i.text ? (i.text.plainText || (i.text.richText && i.text.richText.map(p => (p.children || []).map(c => c.text || '').join('')).join(' '))) : '';
        const name = `${i.name || ''} ${i.id || ''} ${i.type || ''} ${textPart}`;
        return name.toLowerCase().includes(q);
      });
    }

    renderTokenHelperList(items);
  } catch (err) {
    debugError('[TOKEN_HELPER] Filter/render failed:', err);
  }
}

// Tab click handlers will be attached when the modal is ready (inside OBR.onReady)

// Debug Mode Management
const DEBUG_MODULES_BY_CATEGORY = {
  'Core Modules': [
    'executor',
    'expressionEvaluator',
    'expressionHelpers',
    'ui',
    'storage',
    'parser',
    'main',
    'config',
    'configModal'
  ],
  'Command Modules': [
    'playerMetadata',
    'sceneMetadata',
    'tokenMetadata',
    'tokenAttachments'
  ],
  'Integration Modules': [
    'GoogleSheets',
    'Local',
    'ConditionsMarkers',
    'OwlTrackers',
    'StatBubbles',
    'ColoredRings',
    'JustDices',
    'PrettySordid',
    'Manager'
  ]
};

/**
 * Load debug mode states from localStorage
 * @returns {Object} Object mapping module names to boolean debug states
 */
function loadDebugModes() {
  const stored = localStorage.getItem('macroHero_debugMode');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      debugError('Failed to parse debug modes from localStorage:', e);
      return {};
    }
  }
  return {};
}

/**
 * Save debug mode states to localStorage
 * @param {Object} debugModes - Object mapping module names to boolean debug states
 */
function saveDebugModesToStorage(debugModes) {
  try {
    localStorage.setItem('macroHero_debugMode', JSON.stringify(debugModes));
    debugLog('Debug modes saved to localStorage:', debugModes);
  } catch (e) {
    debugError('Failed to save debug modes to localStorage:', e);
  }
}

/**
 * Broadcast debug mode changes via OBR local message
 * @param {Object} debugModes - Object mapping module names to boolean debug states
 */
async function broadcastDebugModes(debugModes) {
  try {
    await OBR.broadcast.sendMessage('macrohero.debug.modes', debugModes, { destination: 'LOCAL' });
    debugLog('Debug modes broadcasted locally:', debugModes);
  } catch (err) {
    debugWarn('Failed to broadcast debug modes:', err);
  }
}

/**
 * Initialize debug mode UI by rendering checkboxes for each module organized by categories
 */
function initializeDebugModeUI() {
  const container = document.getElementById('debugModulesContainer');
  if (!container) return;

  const debugModes = loadDebugModes();
  container.innerHTML = '';

  // Iterate through categories
  Object.entries(DEBUG_MODULES_BY_CATEGORY).forEach(([categoryName, modules]) => {
    // Create category container
    const categoryDiv = document.createElement('div');
    categoryDiv.className = 'debug-category';

    // Create category header with checkbox to select all in category
    const categoryHeader = document.createElement('div');
    categoryHeader.className = 'debug-category-header';
    
    const categoryCheckbox = document.createElement('input');
    categoryCheckbox.type = 'checkbox';
    categoryCheckbox.className = 'debug-category-checkbox';
    categoryCheckbox.id = `debug-category-${categoryName}`;
    
    // Check if all modules in category are enabled
    const allEnabled = modules.every(m => debugModes[m]);
    const someEnabled = modules.some(m => debugModes[m]);
    categoryCheckbox.checked = allEnabled;
    categoryCheckbox.indeterminate = someEnabled && !allEnabled;

    const categoryLabel = document.createElement('label');
    categoryLabel.className = 'debug-category-title';
    categoryLabel.htmlFor = `debug-category-${categoryName}`;
    categoryLabel.textContent = categoryName;
    categoryLabel.style.cursor = 'pointer';

    categoryHeader.appendChild(categoryCheckbox);
    categoryHeader.appendChild(categoryLabel);

    // Category header click handler (for label/entire header except checkbox)
    categoryHeader.addEventListener('click', async (e) => {
      if (e.target === categoryCheckbox) return; // Let checkbox handle itself
      // Toggle checkbox and call change event
      categoryCheckbox.checked = !categoryCheckbox.checked;
      // Dispatch change event to trigger the change listener
      const changeEvent = new Event('change', { bubbles: true });
      categoryCheckbox.dispatchEvent(changeEvent);
    });

    // Category checkbox change handler
    categoryCheckbox.addEventListener('change', async (e) => {
      await updateCategoryModules(categoryName, modules, categoryCheckbox.checked);
    });

    // Create modules container
    const modulesContainer = document.createElement('div');
    modulesContainer.className = 'debug-category-modules';

    // Add modules to category
    modules.forEach(moduleName => {
      const isEnabled = debugModes[moduleName] || false;
      
      const item = document.createElement('div');
      item.className = 'debug-module-item';
      item.innerHTML = `
        <input 
          type="checkbox" 
          id="debug-${moduleName}" 
          class="debug-checkbox"
          ${isEnabled ? 'checked' : ''}
          data-module="${moduleName}"
          data-category="${categoryName}"
        />
        <label class="debug-module-label" for="debug-${moduleName}">${moduleName}</label>
      `;

      modulesContainer.appendChild(item);

      // Make entire item clickable for checkbox
      item.addEventListener('click', async (e) => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        if (e.target === checkbox) return; // Let checkbox handle itself
        checkbox.checked = !checkbox.checked;
        await handleModuleToggle(moduleName, checkbox.checked, categoryName, categoryCheckbox, modules);
      });

      // Add event listener for checkbox changes
      const checkbox = item.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', async (e) => {
        await handleModuleToggle(moduleName, e.target.checked, categoryName, categoryCheckbox, modules);
      });
    });

    categoryDiv.appendChild(categoryHeader);
    categoryDiv.appendChild(modulesContainer);
    container.appendChild(categoryDiv);
  });
}

/**
 * Handle toggling a single module and updating category checkbox state
 */
async function handleModuleToggle(moduleName, isChecked, categoryName, categoryCheckbox, categoryModules) {
  const updatedModes = loadDebugModes();
  updatedModes[moduleName] = isChecked;
  
  // Save to localStorage
  saveDebugModesToStorage(updatedModes);
  
  // Broadcast changes
  await broadcastDebugModes(updatedModes);
  
  // Update category checkbox state based on current module states
  const allEnabled = categoryModules.every(m => updatedModes[m]);
  const someEnabled = categoryModules.some(m => updatedModes[m]);
  
  // Temporarily remove change listener to avoid recursion
  const oldChangeHandler = categoryCheckbox.onchange;
  categoryCheckbox.onchange = null;
  
  categoryCheckbox.checked = allEnabled;
  categoryCheckbox.indeterminate = someEnabled && !allEnabled;
  
  // Restore change listener
  categoryCheckbox.onchange = oldChangeHandler;
  
  debugLog(`Debug mode toggled for ${moduleName}:`, isChecked);
}

/**
 * Handle toggling all modules in a category
 */
async function updateCategoryModules(categoryName, modules, isChecked) {
  const updatedModes = loadDebugModes();
  
  // Update all modules in category
  modules.forEach(moduleName => {
    updatedModes[moduleName] = isChecked;
  });
  
  // Save to localStorage
  saveDebugModesToStorage(updatedModes);
  
  // Broadcast changes
  await broadcastDebugModes(updatedModes);
  
  // Update visual checkboxes in DOM for each module in this category
  modules.forEach(moduleName => {
    const checkbox = document.getElementById(`debug-${moduleName}`);
    if (checkbox) {
      checkbox.checked = isChecked;
    }
  });
  
  // Ensure category checkbox state is correct (should be fully checked after this operation)
  const categoryCheckbox = document.getElementById(`debug-category-${categoryName}`);
  if (categoryCheckbox) {
    categoryCheckbox.checked = isChecked;
    categoryCheckbox.indeterminate = false;
  }
  
  debugLog(`Debug category '${categoryName}' toggled to:`, isChecked);
}

// Sync from JSON button
document.getElementById("syncFromJson").onclick = syncFromJson;

// Cancel
document.getElementById("cancelBtn").onclick = () => {
  debugLog("Cancel clicked");
  closeModal()
};

// Save
document.getElementById("saveBtn").onclick = async () => {
  const apiKeyInput = document.getElementById("apiKeyInput");
  const sheetIdInput = document.getElementById("sheetIdInput");
  
  debugLog("Save clicked, validating...");

  try {
    let config;
    
    // Build config from current tab
    if (currentTab === 'json') {
      const text = document.getElementById("cfgArea").value;
      config = JSON.parse(text);
    } else {
      config = buildConfigFromEditor();
    }
    
    debugLog("✓ Config built successfully:", config);
    
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
      debugLog("✓ Config saved to room-scoped localStorage by modal");
    } catch (err) {
      debugWarn("[MODAL] Failed to save full config to localStorage:", err);
    }

    debugLog("✓ Config valid, notifying main app to reload from storage...");
    await closeModal({ savedFromModal: true, gsheetUpdated: true });
  } catch (e) {
    debugError("✗ Validation error:", e);
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
  debugLog("=== Config Modal Ready ===");
  
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
    debugLog("Modal loaded current config:", cfg);
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
      // Token helper UI handlers - cache elements and add debounce for search
      _tokensListEl = document.getElementById('tokensList');
      _tokensStatusEl = document.getElementById('tokensStatus');
      _tokensSearchEl = document.getElementById('tokensSearch');
      _tokensFilterEl = document.getElementById('tokensFilter');
      _tokensRefreshBtn = document.getElementById('tokensRefresh');
      if (_tokensSearchEl) _tokensSearchEl.addEventListener('input', debounce(() => applyTokensFiltersAndRender(), 220));
      if (_tokensFilterEl) _tokensFilterEl.addEventListener('change', () => applyTokensFiltersAndRender());
      if (_tokensRefreshBtn) _tokensRefreshBtn.addEventListener('click', () => refreshTokenHelper());
    
    // Initialize Debug Mode UI
    initializeDebugModeUI();
    
    // No delegated fallback — explicit handlers above are sufficient and less intrusive.
    // Ensure initial tab state
    switchTab(currentTab);
  }).catch(error => {
    debugError("Error loading config in modal:", error);
  });
  
  // --- Token Helper Init ---
  try {
    refreshTokenHelper();
  } catch (err) {
    debugError('[TOKEN_HELPER] Init error:', err);
  }
});
