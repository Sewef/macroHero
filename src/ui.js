/**
 * UI Manager
 * Handles rendering and updating the user interface
 */

import { isDebugEnabled } from "./debugMode.js";
import { eventBus as EventBus } from "./events/EventBus.js";
import { variableStore } from "./stores/VariableStore.js";
import { renderCounter } from "./ui/renderCounter.js";
import { renderInput } from "./ui/renderInput.js";
import { renderCheckbox } from "./ui/renderCheckbox.js";
import { renderButton } from "./ui/renderButton.js";
import { renderText } from "./ui/renderText.js";
import { renderTitle } from "./ui/renderTitle.js";
import { renderRow } from "./ui/renderRow.js";
import { renderStack } from "./ui/renderStack.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('ui') && console.log(...args);
const debugWarn = (...args) => console.warn(...args);
const debugError = (...args) => console.error(...args);

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
import { eventBus } from "./events/EventBus.js";

/**
 * Broadcast config update notification to refresh pages across the app
 */
async function broadcastConfigUpdated() {
  try {
    await OBR.broadcast.sendMessage("macrohero.config.updated", { savedFromUI: true }, { destination: "LOCAL" });
    debugLog("[UI] Config update broadcasted");
  } catch (err) {
    debugWarn("[UI] Warning: failed to broadcast config update:", err);
  }
}

/**
 * Initialize the UI with the given configuration
 * @param {Object} cfg - Configuration object
 */
export function initUI(cfg) {
  config = cfg;
  updateHeaderTitle();
  renderPageButtons();
  selectFirstPage();
  // Once initial UI is rendered, remove the loading overlay
  hideLoadingOverlay();
  
  // Listen for variable updates from VariableStore and update UI
  eventBus.on('store:variableResolved', (varName, value, pageIndex) => {
    debugLog('[UI] Variable updated via EventBus:', varName, '=', value);
    updateRenderedValue(varName, value);
  });
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

// Update the header title from config.global.title
function updateHeaderTitle() {
  try {
    const headerTitle = document.querySelector('.mh-title');
    if (headerTitle) {
      headerTitle.textContent = config?.global?.title || 'Macro Hero';
    }
  } catch (e) { debugWarn('[UI] Failed to update header title', e); }
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
      btn.addEventListener('click', async () => {
        currentPage = index;
        if (!p._pageIndex) p._pageIndex = index;
        renderPageButtons();
        await renderPageContent(p);
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
    renderPageContent(first).catch(err => debugError('[UI] Error rendering first page:', err));
  } else {
      // No pages configured
      currentPage = null;
  }
}

// ============================================
// RENDER HELPERS - Page Content
// ============================================

export async function reloadCurrentPage() {
  if (currentPage !== null && config?.pages?.[currentPage]) {
    const page = config.pages[currentPage];
    // Force reset resolved variables so they get re-evaluated on reload
    page._resolved = {};
    await renderPageContent(page);
  }
}

async function renderPageContent(page) {
  const container = document.getElementById("content");
  
  // Clear previous element maps
  renderedValueElements = {};
  renderedCheckboxElements = {};
  renderedExpressionElements = [];

  // Initialize _resolved with global variables
  if (!page._resolved) {
    page._resolved = { ...globalVariables };
  } else {
    // Merge in any new global variables
    page._resolved = { ...globalVariables, ...page._resolved };
  }

  // IMMEDIATE RENDER: Build and display content right away with default/loading values
  // This allows the page to be visible instantly, even if variables are still resolving
  const tempContainer = document.createElement('div');
  
  if (page.layout && Array.isArray(page.layout)) {
    renderLayout(tempContainer, page.layout, page);
  } else {
    const emptyMsg = document.createElement("i");
    emptyMsg.textContent = "No layout defined for this page";
    tempContainer.appendChild(emptyMsg);
  }
  
  // Replace content in one atomic operation to minimize visual disruption
  container.innerHTML = "";
  // Transfer all children from temp to container
  while (tempContainer.firstChild) {
    container.appendChild(tempContainer.firstChild);
  }

  // BACKGROUND RESOLUTION: Resolve variables asynchronously after page is rendered
  // This allows the UI to be immediately visible while variables are being computed
  if (page.variables && Object.keys(page.variables).length > 0) {
    // Find which variables need resolution (not already in _resolved)
    const varsToResolve = new Set();
    for (const varName in page.variables) {
      if (!(varName in page._resolved)) {
        varsToResolve.add(varName);
      }
    }
    
    // Only resolve if there are unresolved variables
    if (varsToResolve.size > 0) {
      const onVariableResolved = (varName, value) => {
        page._resolved[varName] = value;
        // Update UI immediately as each variable resolves
        updateRenderedValue(varName, value);
      };
      
      // Resolve the needed variables in the background, not blocking the initial render
      // Pass existing _resolved as base to avoid re-evaluating already-resolved vars
      resolveVariables(page.variables, page._resolved, onVariableResolved, varsToResolve)
        .then(allResolved => {
          page._resolved = allResolved;
          debugLog('[UI] Background variable resolution complete for page');
        })
        .catch(err => {
          debugError('[UI] Error during background variable resolution:', err);
        });
    }
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
      // Update the displayed value
      counterInput.value = value ?? 0;
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
      
      const hasPlaceholders = (entry.item.label && entry.item.label.includes('{')) || 
                             (entry.item.text && entry.item.text.includes('{')) || 
                             (entry.item.content && entry.item.content.includes('{'));
      
      // Evaluate if: has placeholders AND (element is empty OR this var might be needed)
      if (hasPlaceholders) {
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
 * @param {Object} item - Layout item with label, text, or content property
 * @param {Object} resolvedVars - Resolved variables for evaluation
 * @returns {Promise<string>} Evaluated text
 */
async function evaluateItemText(item, resolvedVars) {
  // Get the text content to process
  let text = item.label ?? item.content ?? item.text ?? "";
  
  if (!text) return "";
  
  // If the entire text is wrapped in braces like {expression}, extract and evaluate
  if (typeof text === 'string' && text.match(/^\{.+\}$/)) {
    const innerExpr = text.slice(1, -1); // Remove outer braces
    
    // Check if innerExpr is a simple variable reference (just a word)
    if (/^\w+$/.test(innerExpr)) {
      const value = resolvedVars[innerExpr];
      if (value !== undefined) {
        return (value === null) ? "" : String(value);
      }
      // If variable is not yet resolved, return placeholder instead of trying to evaluate
      return `{${innerExpr}}`;
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
 * Only true if: label, text, or content contains {placeholder}
 */
function shouldEvaluateDynamically(item) {
  // Check if label, text, or content contains {variable} placeholders
  const textToCheck = item.label || item.text || item.content || '';
  return textToCheck.includes('{');
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
  const textToCheck = item.label || item.text || item.content || '';
  const hasPlaceholders = textToCheck.includes('{');
  
  if (!hasPlaceholders) {
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
      return renderTitleElement(layoutItem, page);
    
    case "row":
      return renderRowElement(layoutItem, page);

    case "stack":
      return renderStackElement(layoutItem, page);
    
    case "button":
      return renderButtonElement(layoutItem, page);
    
    case "value":
      return renderValue(layoutItem, page);
    
    case "input":
      return renderInputElement(layoutItem, page);
    
    case "checkbox":
      return renderCheckboxElement(layoutItem, page);
    
    case "counter":
      return renderCounterElement(layoutItem, page);
    
    case "dropdown":
      return renderDropdown(layoutItem, page);
    
    case "text":
      return renderTextElement(layoutItem, page);
    
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

function renderTitleElement(item, page) {
  return renderTitle(item, page, {
    evaluateAndSetElementText
  });
}

function renderRowElement(item, page) {
  return renderRow(item, page, {
    renderLayoutElement
  });
}

function renderStackElement(item, page) {
  return renderStack(item, page, {
    renderValue,
    renderInputElement,
    renderCounterElement,
    renderLayoutElement
  });
}

function renderButtonElement(item, page) {
  return renderButton(item, page, {
    saveConfig,
    broadcastConfigUpdated,
    handleButtonClick,
    findPageByIndex,
    updateRenderedValue,
    evaluateItemText,
    globalVariables,
    renderedExpressionElements,
    currentPage,
    config
  });
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

function renderTextElement(item, page) {
  return renderText(item, page, {
    evaluateAndSetElementText
  });
}

function renderInputElement(item, page, inStack = false) {
  return renderInput(item, page, {
    config,
    saveConfig,
    evaluateAndSetElementText,
    renderedValueElements
  }, inStack);
}

function renderCheckboxElement(item, page) {
  return renderCheckbox(item, page, {
    config,
    saveConfig,
    broadcastConfigUpdated,
    getDependentVariables,
    resolveVariables,
    updateRenderedValue,
    globalVariables,
    evaluateAndSetElementText,
    renderedCheckboxElements
  });
}

function renderDivider() {
  const divider = document.createElement("div");
  divider.className = "mh-layout-divider";
  return divider;
}

function renderCounterElement(item, page, inStack = false) {
  return renderCounter(item, page, {
    config,
    saveConfig,
    broadcastConfigUpdated,
    getDependentVariables,
    resolveVariables,
    updateRenderedValue,
    globalVariables,
    evaluateAndSetElementText,
    renderedValueElements
  }, inStack);
}

function renderDropdown(item, page) {
  const container = document.createElement("div");
  container.className = "mh-layout-dropdown";

  const variable = page.variables?.[item.var];
  if (!variable) {
    container.innerHTML = `<div class="mh-value-error">Variable not found: ${item.var}</div>`;
    return container;
  }

  // Label
  const label = document.createElement("label");
  label.className = "mh-dropdown-label";
  
  if (!evaluateAndSetElementText(label, item, page)) {
    label.textContent = item.label ?? item.var;
  }

  // Select element
  const select = document.createElement("select");
  select.className = "mh-dropdown-select";

  // Get options from item.options array or from a variable
  let options = item.options ?? [];
  
  // If optionsVar is specified, use variable containing array
  if (item.optionsVar) {
    const optionsVariable = page.variables?.[item.optionsVar];
    if (optionsVariable) {
      const optionsValue = page._resolved?.[item.optionsVar] ?? optionsVariable.value;
      if (Array.isArray(optionsValue)) {
        options = optionsValue;
      } else {
        debugWarn(`[UI] optionsVar "${item.optionsVar}" for dropdown "${item.var}" is not an array`);
        options = [];
      }
    } else {
      debugWarn(`[UI] optionsVar "${item.optionsVar}" not found for dropdown "${item.var}"`);
      options = [];
    }
  }
  
  if (options.length === 0) {
    const defaultOption = document.createElement("option");
    defaultOption.textContent = "No options available";
    defaultOption.disabled = true;
    select.appendChild(defaultOption);
  } else {
    options.forEach(opt => {
      const option = document.createElement("option");
      // Options can be strings or {label, value} objects
      if (typeof opt === 'string') {
        option.value = opt;
        option.textContent = opt;
      } else {
        option.value = opt.value ?? opt.label ?? '';
        option.textContent = opt.label ?? opt.value ?? '';
      }
      select.appendChild(option);
    });
  }

  // Get current value from resolved variables or variable.value
  const currentValue = page._resolved?.[item.var] ?? variable.value ?? '';
  select.value = currentValue;

  renderedValueElements[item.var] = container;

  select.onchange = async () => {
    const newValue = select.value;
    // Update the variable definition with the new value
    variable.value = newValue;
    delete variable.eval; // Remove eval if it exists, we're storing a static value
    page._resolved[item.var] = newValue;

    try {
      await saveConfig(config).catch(err => debugError("[UI] Error auto-saving config:", err));
      await broadcastConfigUpdated();

      // Re-evaluate dependent variables
      const dependentVars = getDependentVariables(page.variables, [item.var]);
      if (dependentVars.size > 0) {
        const onVariableResolved = (varName, value) => {
          page._resolved[varName] = value;
          updateRenderedValue(varName, value);
        };
        await resolveVariables(page.variables, globalVariables, onVariableResolved, dependentVars);
      }
    } catch (err) {
      debugError('[UI] Error handling dropdown change:', err);
    }
  };

  container.appendChild(label);
  container.appendChild(select);
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
  // Don't show loading overlay - let the UI update progressively
  config = newConfig;
  updateHeaderTitle();
  
  // Re-resolve variables when config updates
  try {
    // Resolve global variables
    const globalVars = await resolveVariables(config.global?.variables);
    setGlobalVariables(globalVars);
    config._resolvedGlobal = globalVars;

    // Reset page resolved sets - they will resolve progressively when rendered
    for (const page of config.pages || []) {
      page._resolved = { ...globalVars }; // Start with global vars
    }
  } catch (error) {
    debugError("[UI] Error re-resolving global variables:", error);
  }

  // Re-render UI immediately - variables will resolve in background
  renderConfigUI();
}
