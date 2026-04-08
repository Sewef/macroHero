/**
 * UI Manager
 * Handles rendering and updating the user interface
 */

import { createDebugLogger } from "./debugMode.js";
import { eventBus as EventBus } from "./events/EventBus.js";
import { variableStore } from "./stores/VariableStore.js";
import { ComponentRegistry } from "./ui/ComponentRegistry.js";

// Debug logger
const logger = createDebugLogger('ui');

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
    logger.log("[UI] Config update broadcasted");
  } catch (err) {
    logger.warn("[UI] Warning: failed to broadcast config update:", err);
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
    logger.log('[UI] Variable updated via EventBus:', varName, '=', value);
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
  } catch (e) { logger.warn('[UI] Failed to show loading overlay', e); }
}

// Update the header title from config.global.title
function updateHeaderTitle() {
  try {
    const headerTitle = document.querySelector('.mh-title');
    if (headerTitle) {
      headerTitle.textContent = config?.global?.title || 'Macro Hero';
    }
  } catch (e) { logger.warn('[UI] Failed to update header title', e); }
}

// Hide the loading overlay and show the main content
function hideLoadingOverlay() {
  try {
    const loader = document.getElementById('loadingOverlay');
    const content = document.getElementById('content');
    if (loader) loader.classList.add('hidden');
    if (content) content.classList.remove('hidden');
  } catch (e) { logger.warn('[UI] Failed to hide loading overlay', e); }
}

/**
 * Store global variables for use in button clicks
 * @param {Object} vars - Global variables object
 */
export function setGlobalVariables(vars) {
  globalVariables = vars;
  logger.log("[UI] Global variables stored:", globalVariables);
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
    renderPageContent(first).catch(err => logger.error('[UI] Error rendering first page:', err));
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
          logger.log('[UI] Background variable resolution complete for page');
        })
        .catch(err => {
          logger.error('[UI] Error during background variable resolution:', err);
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
          .catch(err => logger.error('[UI] Error evaluating layout expression:', err));
      }
    } catch (err) {
      logger.error('[UI] Error updating expression element:', err);
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
    .catch(err => { logger.error('[UI] Error evaluating element text:', err); });
  
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

/**
 * Find a page by index in the config
 * @param {number} pageIndex - Page index
 * @returns {Object|null} Page object or null
 */
function findPageByIndex(pageIndex) {
  return config.pages?.[pageIndex] || null;
}

/**
 * Render an element with optional inStack parameter
 * @param {string} type - Component type
 * @param {Object} item - Layout item
 * @param {Object} page - Current page
 * @param {boolean} inStack - Whether to render in stack mode
 * @returns {HTMLElement} Rendered element
 */
function renderElement(type, item, page, inStack = false) {
  // Build complete services object
  const services = {
    config,
    saveConfig,
    broadcastConfigUpdated,
    handleButtonClick,
    findPageByIndex,
    updateRenderedValue,
    evaluateItemText,
    evaluateAndSetElementText,
    globalVariables,
    renderedExpressionElements,
    renderedValueElements,
    renderedCheckboxElements,
    currentPage,
    getDependentVariables,
    resolveVariables,
    renderLayoutElement,
    renderElement  // Allow recursive calls with inStack
  };

  // Use ComponentRegistry
  return ComponentRegistry.render(type, item, page, services, inStack);
}

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
  // Special case for divider
  if (layoutItem.type === "divider") {
    const divider = document.createElement("div");
    divider.className = "mh-layout-divider";
    return divider;
  }

  // Render other elements
  const element = renderElement(layoutItem.type, layoutItem, page);
  if (element) {
    return element;
  }

  logger.warn("Unknown layout type:", layoutItem.type);
  return null;
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
      logger.warn("[UI] No config available");
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
  logger.log("[UI] Config updated, refreshing UI");
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
    logger.error("[UI] Error re-resolving global variables:", error);
  }

  // Re-render UI immediately - variables will resolve in background
  renderConfigUI();
}
