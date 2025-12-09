/**
 * UI Manager
 * Handles rendering and updating the user interface
 */

let config = null;
let currentPage = null;
let globalVariables = {}; // Store global variables for use in button clicks
let renderedValueElements = {}; // Map of varName -> DOM element for live updates
let renderedCheckboxElements = {}; // Map of varName -> checkbox input element for live updates

import OBR from "@owlbear-rodeo/sdk";
import { STORAGE_KEY, MODAL_LABEL, loadConfig, saveConfig } from "./config.js";
import { handleButtonClick } from "./executor.js";
import { resolveVariables, getDependentVariables } from "./expressionEvaluator.js";

/**
 * Initialize the UI with the given configuration
 * @param {Object} cfg - Configuration object
 */
export function initUI(cfg) {
  config = cfg;
  renderPageButtons();
  selectFirstPage();
  // Once initial UI is rendered, remove the loading overlay
  hideLoadingOverlay();
}

// Show a loading overlay and hide content while config is loading
function showLoadingOverlay() {
  try {
    const loader = document.getElementById('loadingOverlay');
    const content = document.getElementById('content');
    if (loader) loader.classList.remove('hidden');
    if (content) content.classList.add('hidden');
  } catch (e) { console.warn('[UI] Failed to show loading overlay', e); }
}

// Hide the loading overlay and show the main content
function hideLoadingOverlay() {
  try {
    const loader = document.getElementById('loadingOverlay');
    const content = document.getElementById('content');
    if (loader) loader.classList.add('hidden');
    if (content) content.classList.remove('hidden');
  } catch (e) { console.warn('[UI] Failed to hide loading overlay', e); }
}

/**
 * Store global variables for use in button clicks
 * @param {Object} vars - Global variables object
 */
export function setGlobalVariables(vars) {
  globalVariables = vars;
  console.log("[UI] Global variables stored:", globalVariables);
}

// ============================================
// RENDER HELPERS - Page Navigation
// ============================================

function renderPageButtons() {
  const bar = document.getElementById("pageBar");
  bar.innerHTML = "";
  // Accessibility: indicate tablist role
  bar.setAttribute('role', 'tablist');

  if (!config.pages?.length) {
    bar.innerHTML = "<i>No pages</i>";
    return;
  }

  config.pages.forEach((p, index) => {
    const btn = document.createElement("button");
    // Use the same tab style as the modal - add 'tab' class
    btn.classList.add('tab');
    btn.textContent = p.title ?? p.label ?? `Page ${index + 1}`;
    btn.addEventListener('click', () => {
      currentPage = index;
      renderPageButtons();
      renderPageContent(p);
    });

    if (currentPage === index) {
      btn.classList.add("active");
      btn.setAttribute('aria-selected', 'true');
    } else {
      btn.setAttribute('aria-selected', 'false');
    }

    bar.appendChild(btn);
  });
}

function selectFirstPage() {
  if (config.pages?.length) {
    const first = config.pages[0];
    currentPage = 0;
    // Ensure the tabs update to reflect the selected page
    renderPageButtons();
    renderPageContent(first);
  } else {
      // No pages configured
      currentPage = null;
  }
}

// ============================================
// RENDER HELPERS - Page Content
// ============================================

export function reloadCurrentPage() {
  if (currentPage !== null && config?.pages?.[currentPage]) {
    const page = config.pages[currentPage];
    renderPageContent(page);
  }
}

function renderPageContent(page) {
  const container = document.getElementById("content");
  container.innerHTML = "";
  
  // Clear previous element maps
  renderedValueElements = {};
  renderedCheckboxElements = {};

  // Render layout if defined
  if (page.layout && Array.isArray(page.layout)) {
    renderLayout(container, page.layout, page);
  } else {
    const emptyMsg = document.createElement("i");
    emptyMsg.textContent = "No layout defined for this page";
    container.appendChild(emptyMsg);
  }
  
  // Now resolve variables with callback to update UI as they resolve
  const onVariableResolved = (varName, value) => {
    page._resolved[varName] = value;
    updateRenderedValue(varName, value);
  };
  
  // Start resolving variables (don't await - let it happen in background)
  // Use any previously-resolved page values plus globals as the starting set
  const previouslyResolved = { ...globalVariables, ...(page._resolved || {}) };

  // Determine which variables still need resolving (skip already-resolved ones)
  const allVarNames = Object.keys(page.variables || {});
  const varsToResolve = allVarNames.filter(v => !(v in (page._resolved || {})));

  if (varsToResolve.length === 0) {
    // Nothing to resolve — ensure _resolved includes globals
    page._resolved = { ...previouslyResolved };
  } else {
    // Resolve only the missing variables (resolveVariables will include dependencies)
    resolveVariables(page.variables, previouslyResolved, onVariableResolved, new Set(varsToResolve)).then((allResolved) => {
      page._resolved = allResolved;
    });
  }
}

/**
 * Update a rendered value element when its variable resolves
 */
export function updateRenderedValue(varName, value) {
  const element = renderedValueElements[varName];
  if (element) {
    // Update value display
    const contentDiv = element.querySelector(".mh-value-content");
    if (contentDiv) {
      contentDiv.textContent = value ?? "N/A";
      contentDiv.classList.remove("mh-loading");
    }

    // Update counter input if this is a counter
    const counterInput = element.querySelector(".mh-counter-input");
    if (counterInput) {
      counterInput.value = value;
    }

    // Update input field if this is an input
    const inputField = element.querySelector(".mh-input-field");
    if (inputField) {
      inputField.value = value ?? "";
    }
  }

  // Update checkbox if this variable has one
  const checkbox = renderedCheckboxElements[varName];
  if (checkbox) {
    checkbox.checked = Boolean(value);
  }
}

// ============================================
// RENDER HELPERS - Layout Renderer
// ============================================

function renderLayout(container, layoutItems, page) {
  layoutItems.forEach(layoutItem => {
    const element = renderLayoutElement(layoutItem, page);
    if (element) {
      container.appendChild(element);
    }
  });
}

function renderLayoutElement(layoutItem, page) {
  switch (layoutItem.type) {
    case "title":
      return renderTitle(layoutItem);
    
    case "row":
      return renderRow(layoutItem, page);

    case "stack":
      return renderStack(layoutItem, page);
    
    case "button":
      return renderButton(layoutItem, page);
    
    case "value":
      return renderValue(layoutItem, page);
    
    case "input":
      return renderInput(layoutItem, page);
    
    case "checkbox":
      return renderCheckbox(layoutItem, page);
    
    case "counter":
      return renderCounter(layoutItem, page);
    
    case "text":
      return renderText(layoutItem);
    
    case "divider":
      return renderDivider();
    
    default:
      console.warn("Unknown layout type:", layoutItem.type);
      return null;
  }
}

// ============================================
// RENDER HELPERS - Layout Elements
// ============================================

function renderTitle(item) {
  const title = document.createElement("h3");
  title.className = "mh-layout-title";
  title.textContent = item.text ?? "";
  return title;
}

function renderRow(item, page) {
  const row = document.createElement("div");
  row.className = "mh-layout-row";

  if (item.children && Array.isArray(item.children)) {
    item.children.forEach(child => {
      const element = renderLayoutElement(child, page);
      if (element) {
        row.appendChild(element);
      }
    });
  }

  return row;
}

function renderStack(item, page) {
  const container = document.createElement("div");
  container.className = "mh-layout-stack";
  container.style.margin = '12px 0';

  // Arrange children vertically (one per row). Use a fixed gap between items.
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '8px';

  // Make the stack act like a normal row child: allow it to flex but prevent overflow
  container.style.flex = item.flex || '1 1 0';
  container.style.minWidth = '0';
  // Stretch children to fill the stack width by default
  container.style.alignItems = 'stretch';

  if (item.children && Array.isArray(item.children)) {
    item.children.forEach((child) => {
        let element;
        // If child is a value, call renderValue with inStack=true so it renders horizontally
        if (child.type === 'value') {
          element = renderValue(child, page, true);
        } else if (child.type === 'input') {
          // Render input with inStack=true so it becomes inline (label + input)
          element = renderInput(child, page, true);
        } else {
          element = renderLayoutElement(child, page);
        }
      if (element) {
        // Ensure child occupies full width of the stack column
        element.style.width = '100%';
        element.style.boxSizing = 'border-box';
        element.classList.add('mh-stack-compact');
        // If this is a value item, add horizontal class for styling
        if (child.type === 'value') {
          element.classList.add('mh-stack-horizontal-value');
        }
        container.appendChild(element);
      }
    });
  }

  return container;
}

function renderButton(item, page) {
  const btn = document.createElement("button");
  btn.className = "mh-layout-button";
  btn.textContent = item.label ?? "Button";

  // Handle commands array
  if (item.commands && Array.isArray(item.commands) && item.commands.length > 0) {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "Execution...";
      try {
        const pageObj = (currentPage !== null && currentPage !== undefined) ? findPageByIndex(currentPage) : page;
        
        // Store old resolved values to detect changes
        const oldResolved = { ...pageObj._resolved };
        
        // Create callback to update UI as variables resolve
        const onVariableResolved = (varName, value) => {
          const oldValue = oldResolved[varName];
          // Only update if value actually changed
          if (oldValue !== value) {
            pageObj._resolved[varName] = value;
            updateRenderedValue(varName, value);
          }
        };
        
        await handleButtonClick(item.commands, pageObj, globalVariables, onVariableResolved);
        
        // Auto-save config after commands that may have modified variables
        await saveConfig(config).catch(err => console.error("[UI] Error auto-saving config after button:", err));
        
        // No need to re-render the entire page - individual values were updated via callback
      } catch (error) {
        console.error("Button action error:", error);
      } finally {
        btn.disabled = false;
        btn.textContent = item.label ?? "Button";
      }
    };
    btn.title = `${item.commands.length} command(s)`;
  } else {
    btn.disabled = true;
    btn.title = "No commands defined";
  }

  return btn;
}

/**
 * Find a page by index in the config
 * @param {number} pageIndex - Page index
 * @returns {Object|null} Page object or null
 */
function findPageByIndex(pageIndex) {
  return config.pages?.[pageIndex] || null;
}

function renderValue(item, page, inStack = false) {
  const valueDiv = document.createElement("div");
  valueDiv.className = "mh-layout-value";
  // Get variable definition from page.variables
  const variable = page.variables?.[item.var];
  if (!variable) {
    valueDiv.innerHTML = `<div class="mh-value-label">${item.label ?? item.var}</div><div class="mh-value-error">Variable not found: ${item.var}</div>`;
    return valueDiv;
  }

  // Get resolved value from page._resolved (from expression evaluation)
  let resolvedValue = page._resolved?.[item.var];
  
  // Apply min/max constraints if specified
  if (typeof resolvedValue === 'number') {
    if (variable.min !== undefined && resolvedValue < variable.min) {
      resolvedValue = variable.min;
      page._resolved[item.var] = resolvedValue;
    }
    if (variable.max !== undefined && resolvedValue > variable.max) {
      resolvedValue = variable.max;
      page._resolved[item.var] = resolvedValue;
    }
  }

  // Create the value element structure
    // Only treat as loading if the variable hasn't been resolved yet (undefined, not in _resolved)
    const isLoading = !(item.var in (page._resolved || {}));
    const displayValue = isLoading ? '' : (resolvedValue ?? 'N/A');

    // If this value is being rendered inside a stack, render as single-line 'label: value'
    if (inStack) {
      valueDiv.innerHTML = `<span class="mh-value-label">${item.label ?? item.var}:</span> <span class="mh-value-content ${isLoading ? 'mh-loading' : ''}">${displayValue}</span>`;
      valueDiv.classList.add('mh-stack-horizontal-value');
    } else {
      valueDiv.innerHTML = `<div class="mh-value-label">${item.label ?? item.var}</div><div class="mh-value-content ${isLoading ? 'mh-loading' : ''}">${displayValue}</div>`;
    }

  // Store reference to this element so we can update it later
  renderedValueElements[item.var] = valueDiv;

  return valueDiv;
}

function renderText(item) {
  const text = document.createElement("div");
  text.className = "mh-layout-text";
  text.textContent = item.content ?? item.text ?? "";
  return text;
}

function renderInput(item, page, inStack = false) {
  const container = document.createElement("div");
  container.className = "mh-layout-input";

  const variable = page.variables?.[item.var];

  if (!variable) {
    container.innerHTML = `<div class=\"mh-value-error\">Variable not found: ${item.var}</div>`;
    return container;
  }

  const label = document.createElement(inStack ? "span" : "label");
  label.className = "mh-input-label";
  // When inline in a stack, show as 'Label:' to match value rendering
  label.textContent = inStack ? `${item.label ?? item.var}:` : (item.label ?? item.var);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "mh-input-field";
  input.placeholder = item.placeholder ?? "Enter value";
  input.value = variable.expression ?? variable.default ?? "";

  // Store reference for dynamic updates
  renderedValueElements[item.var] = container;

  // Save when input loses focus
  input.onblur = () => {
    variable.expression = input.value;
    page._resolved[item.var] = input.value;

    // Auto-save config after local variable change
    saveConfig(config).catch(err => console.error("[UI] Error auto-saving config:", err));
  };

  // If this is rendered inline for stacks, arrange label and input side-by-side
  if (inStack) {
    container.style.display = 'flex';
    container.style.flexDirection = 'row';
    container.style.alignItems = 'center';
    container.style.gap = '8px';
    container.appendChild(label);
    container.appendChild(input);
  } else {
    container.appendChild(label);
    container.appendChild(input);
  }
  return container;
}

function renderCheckbox(item, page) {
  const container = document.createElement("div");
  container.className = "mh-layout-checkbox";

  const variable = page.variables?.[item.var];

  if (!variable) {
    container.innerHTML = `<div class="mh-value-error">Variable not found: ${item.var}</div>`;
    return container;
  }

  const label = document.createElement("label");
  label.className = "mh-checkbox-label";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "mh-checkbox-field";
  
  // Store reference for dynamic updates
  renderedCheckboxElements[item.var] = checkbox;
  
  // Get initial value from resolved variables
  const currentValue = page._resolved?.[item.var];
  checkbox.checked = Boolean(currentValue);
  
  // Update variable when checkbox changes
  checkbox.onchange = async () => {
    const newValue = checkbox.checked;
    variable.expression = String(newValue);
    page._resolved[item.var] = newValue;

    try {
      // Auto-save config after local variable change
      await saveConfig(config).catch(err => console.error("[UI] Error auto-saving config:", err));

      // Re-resolve dependent variables so value items update
      const dependentVars = getDependentVariables(page.variables, [item.var]);
      if (dependentVars.size > 0) {
        const onVariableResolved = (varName, value) => {
          page._resolved[varName] = value;
          updateRenderedValue(varName, value);
        };
        await resolveVariables(page.variables, globalVariables, onVariableResolved, dependentVars);
      }
    } catch (err) {
      console.error('[UI] Error handling checkbox change:', err);
    }
  };

  const text = document.createElement("span");
  text.textContent = item.label ?? item.var;

  label.appendChild(checkbox);
  label.appendChild(text);
  container.appendChild(label);
  return container;
}

function renderDivider() {
  const divider = document.createElement("div");
  divider.className = "mh-layout-divider";
  return divider;
}

function renderCounter(item, page) {
  const container = document.createElement("div");
  container.className = "mh-layout-counter";

  const variable = page.variables?.[item.var];

  if (!variable) {
    container.innerHTML = `<div class="mh-value-error">Variable not found: ${item.var}</div>`;
    return container;
  }

  // Get current value
  const currentValue = page._resolved?.[item.var] ?? variable.expression ?? variable.default ?? 0;
  const numValue = Number(currentValue) || 0;

  // Label
  const label = document.createElement("div");
  label.className = "mh-counter-label";
  label.textContent = item.label ?? item.var;

  // Counter controls
  const controls = document.createElement("div");
  controls.className = "mh-counter-controls";

  // Value input
  const input = document.createElement("input");
  input.type = "number";
  input.className = "mh-counter-input";
  input.value = numValue;
  
  // Set min/max if specified
  if (variable.min !== undefined) {
    input.min = variable.min;
  }
  if (variable.max !== undefined) {
    input.max = variable.max;
  }

  // Scroll wheel support
  input.addEventListener('wheel', (e) => {
    e.preventDefault();
    const currentVal = Number(input.value) || 0;
    const step = item.step ?? 1;
    let newValue;
    
    if (e.deltaY < 0) {
      // Scroll up = increment
      newValue = currentVal + step;
    } else {
      // Scroll down = decrement
      newValue = currentVal - step;
    }
    
    updateValue(newValue);
  }, { passive: false });

  // Debounce timer for async updates
  let updateTimer = null;
  let pendingUpdate = false;

  // Function to update value
  const updateValue = async (newValue) => {
    // Store old value to detect if it actually changed
    const oldValue = Number(input.value) || 0;
    
    // Apply min/max constraints
    if (variable.min !== undefined && newValue < variable.min) {
      newValue = variable.min;
    }
    if (variable.max !== undefined && newValue > variable.max) {
      newValue = variable.max;
    }
    
    // Only trigger update if value actually changed
    if (oldValue === newValue) {
      return; // No change, skip update
    }
    
    input.value = newValue;
    variable.expression = String(newValue);
    page._resolved[item.var] = newValue;
    
    // Debounce the async re-resolution
    if (updateTimer) {
      clearTimeout(updateTimer);
    }
    
    updateTimer = setTimeout(async () => {
      if (pendingUpdate) return; // Skip if already processing
      pendingUpdate = true;
      
      try {
        // Auto-save config after local variable change
        await saveConfig(config).catch(err => console.error("[UI] Error auto-saving config:", err));
        
        // Re-resolve all variables that depend on this one
        const dependentVars = getDependentVariables(page.variables, [item.var]);
        if (dependentVars.size > 1) { // More than just the changed variable itself
          const onVariableResolved = (varName, value) => {
            page._resolved[varName] = value;
            updateRenderedValue(varName, value);
          };
          await resolveVariables(page.variables, globalVariables, onVariableResolved, dependentVars);
        }
      } finally {
        pendingUpdate = false;
      }
    }, 150); // 150ms debounce
  };

  // Increment button
  const incrementBtn = document.createElement("button");
  incrementBtn.className = "mh-counter-btn";
  incrementBtn.textContent = "+";
  incrementBtn.onclick = () => {
    const currentVal = Number(input.value) || 0;
    let newValue = currentVal + (item.step ?? 1);
    updateValue(newValue);
  };

  // Decrement button
  const decrementBtn = document.createElement("button");
  decrementBtn.className = "mh-counter-btn";
  decrementBtn.textContent = "-";
  decrementBtn.onclick = () => {
    const currentVal = Number(input.value) || 0;
    let newValue = currentVal - (item.step ?? 1);
    updateValue(newValue);
  };

  // Button container
  const buttonContainer = document.createElement("div");
  buttonContainer.className = "mh-counter-buttons";
  buttonContainer.appendChild(incrementBtn);
  buttonContainer.appendChild(decrementBtn);

  controls.appendChild(input);
  controls.appendChild(buttonContainer);

  container.appendChild(label);
  container.appendChild(controls);

  // Store reference for updates
  renderedValueElements[item.var] = container;

  return container;
}

// ============================================
// ACTION HANDLERS
// ============================================

// Command execution is handled by executor.js

// ============================================
// RENDER HELPERS - Utilities
// ============================================

export function renderConfigUI() {
  if (!config) {
    console.warn("[UI] No config available");
    return;
  }
  
  renderPageButtons();
  
  // If we have a current page index, re-render it; otherwise select first
  if (currentPage !== null && currentPage !== undefined) {
    const page = config.pages?.[currentPage];
    if (page) {
      renderPageContent(page);
    } else {
      selectFirstPage();
    }
  } else {
    selectFirstPage();
  }
}

export async function updateConfig(newConfig) {
  console.log("[UI] Config updated, refreshing UI");
  // Show the loading overlay while we re-resolve and re-render
  showLoadingOverlay();
  config = newConfig;
  
  // Re-resolve variables when config updates
  try {
    // Resolve global variables
    const globalVars = await resolveVariables(config.global?.variables);
    setGlobalVariables(globalVars);
    config._resolvedGlobal = globalVars;

    // Reset page resolved sets, and resolve only the current page to avoid spamming external integrations
    for (const page of config.pages || []) {
      page._resolved = {}; // cleared — will resolve lazily per-page
    }

    // If we have a current page selected, resolve only that page's variables now
    if (currentPage !== null && currentPage !== undefined && config.pages?.[currentPage]) {
      try {
        const page = config.pages[currentPage];
        // Use globalVars as previouslyResolved so expressions can access globals
        page._resolved = await resolveVariables(page.variables, globalVars, null);
      } catch (err) {
        console.error('[UI] Error resolving current page variables during config update:', err);
        // leave page._resolved as {} to allow render-time resolution
      }
    }
  } catch (error) {
    console.error("[UI] Error re-resolving variables:", error);
  }

  renderConfigUI();
  // Hide overlay after render complete
  hideLoadingOverlay();
}
