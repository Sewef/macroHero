import OBR from "@owlbear-rodeo/sdk";
import { STORAGE_KEY, MODAL_LABEL, loadConfig, saveConfig } from "./config.js";
import { saveGoogleSheetsApiKey, saveGoogleSheetsSheetId, getGoogleSheetsCredentials } from "./commands/integrations/GoogleSheetsConfig.js";

let currentConfig = null;
let currentTab = 'editor';
let editingPageIndex = null;
let editingElementIndex = null;
let expandedPages = new Set();

function closeModal(data) {
  if (data) {
    console.log("Modal sending result broadcast:", data);
    OBR.broadcast.sendMessage("macrohero.config.result", data, { destination: "LOCAL" });
  } else {
    console.log("Modal closed without saving");
  }
  OBR.modal.close(MODAL_LABEL);
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
        
        // Handle row items with children
        if (item.type === 'row' && item.children && Array.isArray(item.children)) {
          const childrenHtml = item.children.map((child, childIndex) => {
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
                <span>Row (${item.children.length} items)</span>
              </div>
              <div class="layout-item-actions">
                <button type="button" class="btn-small" onclick="event.stopPropagation(); addChildElement(${index}, ${itemIndex})">+ Item</button>
                <button type="button" class="btn-small" onclick="event.stopPropagation(); editElement(${index}, ${itemIndex})">Edit</button>
                <button type="button" class="btn-small btn-danger" onclick="event.stopPropagation(); deleteElement(${index}, ${itemIndex})">×</button>
              </div>
            </div>
            <div class="row-children" data-row-index="${itemIndex}" data-page-index="${index}">
              ${childrenHtml}
              ${item.children.length === 0 ? `<div class="row-drop-zone" data-element-index="${itemIndex}" data-page-index="${index}" data-is-empty-row="true">Drop items here</div>` : ''}
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
            <button type="button" class="btn-small">+ Element</button>
            <button type="button" class="btn-small btn-danger">Delete</button>
          </div>
        </div>
        <div class="page-content ${isExpanded ? '' : 'collapsed'}" id="page-content-${index}">
          <div style="font-size: 0.85em; color: #888; margin-bottom: 8px;">
            ${page.variables ? Object.keys(page.variables).length : 0} variables, 
            ${page.layout ? page.layout.length : 0} layout items
          </div>
          ${layoutItemsHtml ? `<div class="layout-items" data-page-index="${index}">${layoutItemsHtml}</div>` : ''}
        </div>
      `;
      container.appendChild(pageDiv);
      
      // Add event listeners after appending to DOM
      const collapseBtn = pageDiv.querySelector('.collapse-btn');
      const addBtn = pageDiv.querySelector('.btn-small');
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
      
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        addElement(index);
      });
      
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
      
      // Add drop listeners to row children containers
      const rowChildContainers = pageDiv.querySelectorAll('.row-children');
      rowChildContainers.forEach(container => {
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
    console.log('Preventing collapse toggle - just finished dragging');
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
let dropIndicator = null;
let lastDropTarget = null;
let dropPosition = null;

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
  if (childIndex !== undefined) {
    draggedChildIndex = parseInt(childIndex);
  } else {
    draggedChildIndex = null;
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
  
  const dropElementIndex = parseInt(lastDropTarget.dataset.elementIndex);
  const dropPageIndex = parseInt(lastDropTarget.dataset.pageIndex);
  const dropChildIndex = lastDropTarget.dataset.childIndex !== undefined ? parseInt(lastDropTarget.dataset.childIndex) : null;
  
  if (draggedFromPageIndex === dropPageIndex) {
    const page = currentConfig.pages[dropPageIndex];
    
    // Get the dragged element/child
    let draggedItem;
    if (draggedChildIndex !== null) {
      // Dragging from a row
      draggedItem = page.layout[draggedElementIndex].children[draggedChildIndex];
    } else {
      // Dragging a top-level element
      draggedItem = page.layout[draggedElementIndex];
    }
    
    // Remove from source
    if (draggedChildIndex !== null) {
      page.layout[draggedElementIndex].children.splice(draggedChildIndex, 1);
    } else {
      page.layout.splice(draggedElementIndex, 1);
    }
    
    // Insert into target
    if (dropChildIndex !== null) {
      // Dropping into a row
      const targetRow = page.layout[dropElementIndex];
      if (!targetRow.children) targetRow.children = [];
      
      let insertIndex = dropChildIndex;
      
      // Adjust insert index for same row reordering
      if (draggedChildIndex !== null && draggedElementIndex === dropElementIndex) {
        if (draggedChildIndex < dropChildIndex) {
          insertIndex = dropChildIndex - 1;
        }
      }
      
      if (dropPosition === 'after') insertIndex++;
      targetRow.children.splice(insertIndex, 0, draggedItem);
    } else {
      // Dropping at top level
      let insertIndex = dropElementIndex;
      
      // Adjust for same-level reordering when source was also top-level
      if (draggedChildIndex === null) {
        if (draggedElementIndex < dropElementIndex) {
          insertIndex = dropElementIndex - 1;
        }
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
  
  if (draggedFromPageIndex === dropPageIndex) {
    const page = currentConfig.pages[dropPageIndex];
    
    // Get the dragged element/child
    let draggedItem;
    if (draggedChildIndex !== null) {
      draggedItem = page.layout[draggedElementIndex].children[draggedChildIndex];
      page.layout[draggedElementIndex].children.splice(draggedChildIndex, 1);
    } else {
      draggedItem = page.layout[draggedElementIndex];
      page.layout.splice(draggedElementIndex, 1);
    }
    
    // Add to empty row
    const targetRow = page.layout[dropElementIndex];
    if (!targetRow.children) targetRow.children = [];
    targetRow.children.push(draggedItem);
    
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

window.addChildElement = function(pageIndex, rowIndex) {
  editingPageIndex = pageIndex;
  editingElementIndex = rowIndex;
  editingChildIndex = -1; // -1 means adding new child
  document.getElementById("modalTitle").textContent = "Add Row Item";
  document.getElementById("saveElementBtn").textContent = "Add Row Item";
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

window.editChildElement = function(pageIndex, rowIndex, childIndex) {
  editingPageIndex = pageIndex;
  editingElementIndex = rowIndex;
  editingChildIndex = childIndex;
  const element = currentConfig.pages[pageIndex].layout[rowIndex].children[childIndex];
  
  document.getElementById("modalTitle").textContent = "Edit Row Item";
  document.getElementById("saveElementBtn").textContent = "Save Changes";
  document.getElementById("elementType").value = element.type;
  updateElementFields(element);
  document.getElementById("elementModal").classList.add("active");
};

window.deleteElement = function(pageIndex, elementIndex) {
  if (confirm("Delete this element?")) {
    currentConfig.pages[pageIndex].layout.splice(elementIndex, 1);
    renderEditor(currentConfig);
  }
};

window.deleteChildElement = function(pageIndex, rowIndex, childIndex) {
  if (confirm("Delete this row item?")) {
    currentConfig.pages[pageIndex].layout[rowIndex].children.splice(childIndex, 1);
    renderEditor(currentConfig);
  }
};

window.closeElementModal = function() {
  document.getElementById("elementModal").classList.remove("active");
  editingPageIndex = null;
  editingElementIndex = null;
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
  }
  
  // Add or update element
  if (editingChildIndex !== null) {
    // Working with row child
    const row = currentConfig.pages[editingPageIndex].layout[editingElementIndex];
    if (editingChildIndex === -1) {
      // Adding new child
      if (!row.children) row.children = [];
      row.children.push(element);
    } else {
      // Editing existing child
      row.children[editingChildIndex] = element;
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

// Tab click handlers
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    switchTab(tab.dataset.tab);
  });
});

// Sync from JSON button
document.getElementById("syncFromJson").onclick = syncFromJson;

// Cancel
document.getElementById("cancelBtn").onclick = () => {
  console.log("Cancel clicked");
  closeModal()
};

// Save
document.getElementById("saveBtn").onclick = () => {
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
    
    saveGoogleSheetsApiKey(apiKey);
    saveGoogleSheetsSheetId(sheetId);
    
    console.log("✓ Config valid, sending to main app...");
    closeModal({ updatedConfig: config, gsheetUpdated: true });
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
  }).catch(error => {
    console.error("Error loading config in modal:", error);
  });
});
