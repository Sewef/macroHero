/**
 * UI Manager
 * Handles rendering and updating the user interface
 */

import { isDebugEnabled } from "./debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('ui') && console.log(...args);
const debugWarn = (...args) => isDebugEnabled('ui') && console.warn(...args);
const debugError = (...args) => isDebugEnabled('ui') && console.error(...args);

let config = null;
let currentPage = null;
let globalVariables = {}; // Store global variables for use in button clicks
let renderedValueElements = {}; // Map of varName -> DOM element for live updates
let renderedCheckboxElements = {}; // Map of varName -> checkbox input element for live updates
let renderedExpressionElements = []; // Array of { element, item, page } for title/text expression evaluation

import OBR from "@owlbear-rodeo/sdk";
import { STORAGE_KEY, MODAL_LABEL, loadConfig, saveConfig } from "./config.js";
import { handleButtonClick } from "./executor.js";
import { resolveVariables, getDependentVariables, evaluateExpression } from "./expressionEvaluator.js";

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
  } catch (e) { debugWarn('[UI] Failed to show loading overlay', e); }
}

// Hide the loading overlay and show the main content
function hideLoadingOverlay() {
  try {
    const loader = document.getElementById('loadingOverlay');
    const content = document.getElementById('content');
    if (loader) loader.classList.add('hidden');
    if (content) content.classList.remove('hidden');
  } catch (e) { debugWarn('[UI] Failed to hide loading overlay', e); }
}

/**
 * Store global variables for use in button clicks
 * @param {Object} vars - Global variables object
 */
export function setGlobalVariables(vars) {
  globalVariables = vars;
  debugLog("[UI] Global variables stored:", globalVariables);
}

// ============================================
// RENDER HELPERS - Page Navigation
// ============================================

function renderPageButtons() {
  const bar = document.getElementById("pageBar");
  
  // Only update attributes and classes on existing buttons instead of rebuilding
  const existingButtons = bar.querySelectorAll('button.tab');
  
  if (!config.pages?.length) {
    bar.innerHTML = "<i>No pages</i>";
    return;
  }
  
  // If buttons already exist and count matches, just update their state
  if (existingButtons.length === config.pages.length) {
    existingButtons.forEach((btn, index) => {
      if (currentPage === index) {
        btn.classList.add("active");
        btn.setAttribute('aria-selected', 'true');
      } else {
        btn.classList.remove("active");
        btn.setAttribute('aria-selected', 'false');
      }
    });
  } else {
    // First time or page count changed - rebuild
    bar.innerHTML = "";
    bar.setAttribute('role', 'tablist');

    config.pages.forEach((p, index) => {
      const btn = document.createElement("button");
      btn.classList.add('tab');
      btn.textContent = p.title ?? p.label ?? `Page ${index + 1}`;
      btn.addEventListener('click', () => {
        currentPage = index;
        if (!p._pageIndex) p._pageIndex = index;
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
  renderedExpressionElements = [];

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

  // Re-evaluate any expression-based title/text/button elements that depend on this variable
  for (const entry of renderedExpressionElements) {
    try {
      if (!entry || !entry.item || !entry.element) continue;
      
      const hasExpression = entry.item.expression !== undefined;
      const hasPlaceholders = (entry.item.label && entry.item.label.includes('{')) || 
                             (entry.item.text && entry.item.text.includes('{')) || 
                             (entry.item.content && entry.item.content.includes('{'));
      
      // Evaluate if: has expression/placeholders AND (element is empty OR this var might be needed)
      if (hasExpression || hasPlaceholders) {
        const resolvedVars = { ...globalVariables, ...(entry.page?._resolved || {}) };
        evaluateItemText(entry.item, resolvedVars)
          .then(res => { entry.element.textContent = res; })
          .catch(err => debugError('[UI] Error evaluating layout expression:', err));
      }
    } catch (err) {
      debugError('[UI] Error updating expression element:', err);
    }
  }
}

// ============================================
// RENDER HELPERS - String Evaluation
// ============================================

/**
 * Simple variable substitution for plain text with {variable} placeholders
 * Does NOT evaluate expressions - just replaces {variable} with resolved values
 */
function substituteVariablesSimple(text, variables) {
  return text.replace(/{([a-zA-Z_]\w*)}/g, (match, varName) => {
    return variables[varName] !== undefined ? String(variables[varName]) : match;
  });
}

/**
 * Evaluate item text - only evaluates expressions explicitly wrapped in {}
 * @param {Object} item - Layout item with expression, label, text, or content property
 * @param {Object} resolvedVars - Resolved variables for evaluation
 * @returns {Promise<string>} Evaluated text
 */
async function evaluateItemText(item, resolvedVars) {
  // Priority 1: Check if item.expression is explicitly wrapped in braces
  if (item.expression !== undefined && typeof item.expression === 'string') {
    if (item.expression.match(/^\{.+\}$/)) {
      const innerExpr = item.expression.slice(1, -1); // Remove outer braces
      
            // Check if innerExpr is a simple variable reference (just a word)
            if (/^\w+$/.test(innerExpr) && innerExpr in resolvedVars) {
              const value = resolvedVars[innerExpr];
              return (value === null || value === undefined) ? "" : String(value);
            }
      try {
        const res = await evaluateExpression(innerExpr, resolvedVars);
        return (res === null || res === undefined) ? "" : String(res);
      } catch (err) {
        // Fall back to simple substitution if evaluation fails
        return substituteVariablesSimple(item.expression, resolvedVars);
      }
    }
    // Not wrapped in braces - treat as plain text
    return item.expression;
  }
  
  // Priority 2: Get the text content to process
  let text = item.label ?? item.content ?? item.text ?? "";
  
  if (!text) return "";
  
  // Priority 3: If the entire text is wrapped in braces like {expression}, extract and evaluate
  if (typeof text === 'string' && text.match(/^\{.+\}$/)) {
    const innerExpr = text.slice(1, -1); // Remove outer braces
    
        // Check if innerExpr is a simple variable reference (just a word)
        if (/^\w+$/.test(innerExpr) && innerExpr in resolvedVars) {
          const value = resolvedVars[innerExpr];
          return (value === null || value === undefined) ? "" : String(value);
        }
    try {
      const res = await evaluateExpression(innerExpr, resolvedVars);
      return (res === null || res === undefined) ? "" : String(res);
    } catch (err) {
      // Fall back to simple substitution if expression evaluation fails
      return substituteVariablesSimple(text, resolvedVars);
    }
  }
  
  // Priority 4: If text contains {variable} placeholders, do simple substitution only
  if (typeof text === 'string' && text.includes('{')) {
    return substituteVariablesSimple(text, resolvedVars);
  }
  
  // Priority 5: Plain text without any special markers - return as-is
  return String(text);
}

/**
 * Check if an item's text should be dynamically evaluated
 * Only true if: expression is explicitly set for text, or label contains {placeholder}
 */
function shouldEvaluateDynamically(item) {
  // Only use item.expression if it was explicitly meant for rendering text
  // Check if label contains {variable} placeholders
  return item.label && item.label.includes('{');
}

/**
 * Evaluate item and set element text content, registering for dynamic updates if needed
 * @param {HTMLElement} element - DOM element to update
 * @param {Object} item - Layout item
 * @param {Object} page - Page object
 * @returns {boolean} True if element was registered for dynamic updates
 */
function evaluateAndSetElementText(element, item, page) {
  // Only register for dynamic updates if the item actually has dynamic content
  const hasExpression = item.expression !== undefined;
  const hasPlaceholders = (item.label && item.label.includes('{'));
  
  if (!hasExpression && !hasPlaceholders) {
    return false;
  }
  
  element.textContent = "";
  renderedExpressionElements.push({ element, item, page });
  const resolvedVars = { ...globalVariables, ...(page? (page._resolved || {}) : {}) };
  evaluateItemText(item, resolvedVars)
    .then(res => { element.textContent = res; })
    .catch(err => { debugError('[UI] Error evaluating element text:', err); });
  
  return true;
}

/**
 * Create a label element with optional dynamic evaluation
 * @param {Object} item - Layout item
 * @param {Object} page - Page object
 * @param {boolean} inStack - Whether to create span (true) or div (false)
 * @param {string} suffix - Optional suffix to append (e.g., ":" for stack labels)
 * @returns {HTMLElement} Label element
 */
function createDynamicLabel(item, page, inStack = false, suffix = "") {
  const labelEl = document.createElement(inStack ? "span" : "div");
  labelEl.className = inStack ? "mh-input-label" : "mh-value-label";
  
  if (shouldEvaluateDynamically(item)) {
    evaluateAndSetElementText(labelEl, item, page);
    // Add suffix after evaluation
    if (suffix) {
      const originalPush = renderedExpressionElements[renderedExpressionElements.length - 1];
      const originalCatch = originalPush;
    }
  } else {
    labelEl.textContent = (item.label ?? item.var ?? "") + suffix;
  }
  
  return labelEl;
}

// ============================================
// RENDER HELPERS - Layout Renderer
// ============================================

function renderLayout(container, layoutItems, page) {
  // Batch all layout elements before single append to container
  const frag = document.createDocumentFragment();
  layoutItems.forEach(layoutItem => {
    const element = renderLayoutElement(layoutItem, page);
    if (element) {
      frag.appendChild(element);
    }
  });
  container.appendChild(frag);
}

function renderLayoutElement(layoutItem, page) {
  switch (layoutItem.type) {
    case "title":
      return renderTitle(layoutItem, page);
    
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
      return renderText(layoutItem, page);
    
    case "divider":
      return renderDivider();
    
    default:
      debugWarn("Unknown layout type:", layoutItem.type);
      return null;
  }
}

// ============================================
// RENDER HELPERS - Layout Elements
// ============================================

function renderTitle(item, page) {
  const title = document.createElement("h3");
  title.className = "mh-layout-title";

  // Title uses item.expression or item.text; evaluate immediately if dynamic
  if (!evaluateAndSetElementText(title, item, page)) {
    title.textContent = item.text ?? "";
  }

  return title;
}

function renderRow(item, page) {
  const row = document.createElement("div");
  row.className = "mh-layout-row";

  if (item.children && Array.isArray(item.children)) {
    // Use a fragment to batch DOM updates for row children
    const frag = document.createDocumentFragment();
    item.children.forEach(child => {
      const element = renderLayoutElement(child, page);
      if (element) {
        frag.appendChild(element);
      }
    });
    row.appendChild(frag);
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

  // Button uses label with {variable} placeholders
  if (item.label && item.label.includes('{')) {
    btn.textContent = "";
    renderedExpressionElements.push({ element: btn, item, page });
    const resolvedVars = { ...globalVariables, ...(page? (page._resolved || {}) : {}) };
    evaluateItemText(item, resolvedVars)
      .then(res => { btn.textContent = res; })
      .catch(err => { debugError('[UI] Error evaluating button:', err); });
  } else {
    btn.textContent = item.label ?? "Button";
  }

  // Handle commands array
  if (item.commands && Array.isArray(item.commands) && item.commands.length > 0) {
    btn.onclick = async () => {
      btn.disabled = true;
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
        await saveConfig(config).catch(err => debugError("[UI] Error auto-saving config after button:", err));
        
        // No need to re-render the entire page - individual values were updated via callback
      } catch (error) {
        debugError("Button action error:", error);
      } finally {
        btn.disabled = false;
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
  
  const variable = page.variables?.[item.var];
  if (!variable) {
    valueDiv.innerHTML = `<div class="mh-value-label">${item.label ?? item.var}</div><div class="mh-value-error">Variable not found: ${item.var}</div>`;
    return valueDiv;
  }

  // Get resolved value and apply min/max constraints
  let resolvedValue = page._resolved?.[item.var];
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

  // Create label
  const isLoading = !(item.var in (page._resolved || {}));
  const displayValue = isLoading ? '' : (resolvedValue ?? 'N/A');

  const labelEl = document.createElement(inStack ? "span" : "div");
  labelEl.className = "mh-value-label";
  
  if (!evaluateAndSetElementText(labelEl, item, page)) {
    labelEl.textContent = (item.label ?? item.var) + (inStack ? ":" : "");
  } else if (inStack) {
    // For stack mode, we need to add the colon after the dynamic content
    const originalPush = renderedExpressionElements[renderedExpressionElements.length - 1];
    const originalElement = originalPush.element;
    const originalSetText = originalElement.textContent;
  }

  // Create content element
  const contentEl = document.createElement("span");
  contentEl.className = `mh-value-content ${isLoading ? 'mh-loading' : ''}`;
  contentEl.textContent = displayValue;

  // Assemble based on stack mode
  if (inStack) {
    valueDiv.appendChild(labelEl);
    const spacer = document.createElement("span");
    spacer.textContent = " ";
    valueDiv.appendChild(spacer);
    valueDiv.appendChild(contentEl);
    valueDiv.classList.add('mh-stack-horizontal-value');
  } else {
    valueDiv.appendChild(labelEl);
    valueDiv.appendChild(contentEl);
  }

  renderedValueElements[item.var] = valueDiv;
  return valueDiv;
}

function renderText(item, page) {
  const text = document.createElement("div");
  text.className = "mh-layout-text";

  // Text uses item.expression or item.content/text; evaluate immediately if dynamic
  if (!evaluateAndSetElementText(text, item, page)) {
    text.textContent = item.content ?? item.text ?? "";
  }

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
  
  if (!evaluateAndSetElementText(label, item, page)) {
    label.textContent = inStack ? `${item.label ?? item.var}:` : (item.label ?? item.var);
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "mh-input-field";
  input.placeholder = item.placeholder ?? "Enter value";
  input.value = (page._resolved && page._resolved[item.var] !== undefined)
    ? page._resolved[item.var]
    : (variable.expression ?? variable.default ?? "");

  renderedValueElements[item.var] = container;

  input.onblur = () => {
    variable.expression = input.value;
    page._resolved[item.var] = input.value;
    saveConfig(config).catch(err => debugError("[UI] Error auto-saving config:", err));
  };

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
  
  renderedCheckboxElements[item.var] = checkbox;
  
  const currentValue = page._resolved?.[item.var];
  checkbox.checked = Boolean(currentValue);
  
  checkbox.onchange = async () => {
    const newValue = checkbox.checked;
    variable.expression = String(newValue);
    page._resolved[item.var] = newValue;

    try {
      await saveConfig(config).catch(err => debugError("[UI] Error auto-saving config:", err));

      const dependentVars = getDependentVariables(page.variables, [item.var]);
      if (dependentVars.size > 0) {
        const onVariableResolved = (varName, value) => {
          page._resolved[varName] = value;
          updateRenderedValue(varName, value);
        };
        await resolveVariables(page.variables, globalVariables, onVariableResolved, dependentVars);
      }
    } catch (err) {
      debugError('[UI] Error handling checkbox change:', err);
    }
  };

  const text = document.createElement("span");
  if (!evaluateAndSetElementText(text, item, page)) {
    text.textContent = item.label ?? item.var;
  }

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

  const currentValue = page._resolved?.[item.var] ?? variable.expression ?? variable.default ?? 0;
  const numValue = Number(currentValue) || 0;

  // Label
  const label = document.createElement("div");
  label.className = "mh-counter-label";
  
  if (!evaluateAndSetElementText(label, item, page)) {
    label.textContent = item.label ?? item.var;
  }

  // Counter controls
  const controls = document.createElement("div");
  controls.className = "mh-counter-controls";

  const input = document.createElement("input");
  input.type = "number";
  input.className = "mh-counter-input";
  input.value = numValue;
  
  if (variable.min !== undefined) input.min = variable.min;
  if (variable.max !== undefined) input.max = variable.max;

  input.addEventListener('wheel', (e) => {
    e.preventDefault();
    const currentVal = Number(input.value) || 0;
    const step = item.step ?? 1;
    updateValue(currentVal + (e.deltaY < 0 ? step : -step));
  }, { passive: false });

  let updateTimer = null;

  const updateValue = async (newValue) => {
    const oldValue = Number(input.value) || 0;
    
    if (variable.min !== undefined && newValue < variable.min) newValue = variable.min;
    if (variable.max !== undefined && newValue > variable.max) newValue = variable.max;
    if (oldValue === newValue) return;
    
    input.value = newValue;
    variable.expression = String(newValue);
    page._resolved[item.var] = newValue;
    
    // Clear any pending timer to restart the debounce
    clearTimeout(updateTimer);
    
    // Schedule evaluation and saving after 300ms of inactivity
    updateTimer = setTimeout(async () => {
      try {
        await saveConfig(config).catch(err => debugError("[UI] Error auto-saving config:", err));
        
        const dependentVars = getDependentVariables(page.variables, [item.var]);
        if (dependentVars.size > 1) {
          const onVariableResolved = (varName, value) => {
            page._resolved[varName] = value;
            updateRenderedValue(varName, value);
          };
          await resolveVariables(page.variables, globalVariables, onVariableResolved, dependentVars);
        }
      } catch (err) {
        debugError("[UI] Error in counter update:", err);
      }
    }, 300);
  };

  const incrementBtn = document.createElement("button");
  incrementBtn.className = "mh-counter-btn";
  incrementBtn.textContent = "+";
  incrementBtn.onclick = () => updateValue(Number(input.value) + (item.step ?? 1));

  const decrementBtn = document.createElement("button");
  decrementBtn.className = "mh-counter-btn";
  decrementBtn.textContent = "-";
  decrementBtn.onclick = () => updateValue(Number(input.value) - (item.step ?? 1));

  const buttonContainer = document.createElement("div");
  buttonContainer.className = "mh-counter-buttons";
  buttonContainer.appendChild(incrementBtn);
  buttonContainer.appendChild(decrementBtn);

  controls.appendChild(input);
  controls.appendChild(buttonContainer);

  container.appendChild(label);
  container.appendChild(controls);

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

let renderScheduled = false;

export function renderConfigUI() {
  if (renderScheduled) return;
  renderScheduled = true;

  requestAnimationFrame(() => {
    renderScheduled = false;

    if (!config) {
      debugWarn("[UI] No config available");
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
  });
}

export async function updateConfig(newConfig) {
  debugLog("[UI] Config updated, refreshing UI");
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
        debugError('[UI] Error resolving current page variables during config update:', err);
        // leave page._resolved as {} to allow render-time resolution
      }
    }
  } catch (error) {
    debugError("[UI] Error re-resolving variables:", error);
  }

  renderConfigUI();
  // Hide overlay after render complete
  hideLoadingOverlay();
}
