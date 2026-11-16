/**
 * UI Manager
 * Handles rendering and updating the user interface
 */

import { createDebugLogger } from "./debugMode.js";
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
let renderCycle = 0; // Incremented for each page render to ignore stale async work

import OBR from "@owlbear-rodeo/sdk";
import { saveConfig } from "./config.js";
import { handleButtonClick } from "./executor.js";
import { resolveAllPageVariables, resolveVariables, getDependentVariables, evaluateExpression } from "./expressionEvaluator.js";
import { eventBus } from "./events/EventBus.js";
import { variableEngine } from "./engines/VariableEngine.js";

/**
 * Broadcast config update notification to refresh pages across the app
 */
async function broadcastConfigUpdated() {
  try {
    await OBR.broadcast.sendMessage("macrohero.config.updated", { savedFromUI: true }, { destination: "LOCAL" });
    logger.log("Config update broadcasted");
  } catch (err) {
    logger.warn('Failed to broadcast config update:', err);
  }
}

/**
 * Initialize the UI with the given configuration
 * @param {Object} cfg - Configuration object
 */
export function initUI(cfg) {
  config = cfg;
  variableStore.setConfig(cfg);
  updateHeaderTitle();
  renderPageButtons();
  selectFirstPage();
  // Once initial UI is rendered, remove the loading overlay
  hideLoadingOverlay();
  
  // Listen for variable updates from VariableStore and update UI
  eventBus.on('store:variableResolved', (varName, value, pageIndex) => {
    logger.log('Variable updated:', varName, '=', value);
    updateRenderedValue(varName, value, pageIndex);
  });
}

// Show a loading overlay and hide content while config is loading
function showLoadingOverlay() {
  try {
    const loader = document.getElementById('loadingOverlay');
    const content = document.getElementById('content');
    if (loader) loader.classList.remove('hidden');
    if (content) content.classList.add('hidden');
    } catch (e) { logger.warn('Error showing loading overlay', e); }
}

// Update the header title from config.global.title
function updateHeaderTitle() {
  try {
    const headerTitle = document.querySelector('.mh-title');
    if (headerTitle) {
      headerTitle.textContent = config?.global?.title || 'Macro Hero';
    }
    } catch (e) { logger.warn('Error updating header title', e); }
}

// Hide the loading overlay and show the main content
function hideLoadingOverlay() {
  try {
    const loader = document.getElementById('loadingOverlay');
    const content = document.getElementById('content');
    if (loader) loader.classList.add('hidden');
    if (content) content.classList.remove('hidden');
    } catch (e) { logger.warn('Error hiding loading overlay', e); }
}

/**
 * Store global variables for use in button clicks
 * @param {Object} vars - Global variables object
 */
export function setGlobalVariables(vars) {
  globalVariables = vars;
  variableStore.setGlobalVariablesResolved(vars);
  logger.log("Global variables stored");
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
    renderPageContent(first).catch(err => logger.error('Error rendering first page:', err));
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

function collectLayoutVariableTargets(page, pageIndex) {
  const targets = new Set();
  const localVariables = new Set();
  const pageKey = page.id || `page_${pageIndex + 1}`;
  const displayFields = ['label', 'text', 'content', 'tooltip'];

  const addExpressionReferences = value => {
    if (typeof value !== 'string') return;
    for (const match of value.matchAll(/\bPage\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
      if (!(match[1] in (page.variables || {}))) continue;
      localVariables.add(match[1]);
      targets.add(`${pageKey}.${match[1]}`);
    }
    for (const match of value.matchAll(
      /\bPages\.([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)/g
    )) {
      targets.add(`${match[1]}.${match[2]}`);
    }
  };

  const visit = item => {
    if (!item || typeof item !== 'object') return;
    if (typeof item.var === 'string' && item.var in (page.variables || {})) {
      localVariables.add(item.var);
      targets.add(`${pageKey}.${item.var}`);
    }
    displayFields.forEach(field => addExpressionReferences(item[field]));
    if (Array.isArray(item.children)) item.children.forEach(visit);
  };

  (page.layout || []).forEach(visit);
  return { targets, localVariables };
}

async function renderPageContent(page) {
  const container = document.getElementById("content");
  const pageIndex = config.pages?.indexOf(page) ?? -1;
  const cycle = ++renderCycle;

  if (pageIndex >= 0) {
    page._pageIndex = pageIndex;
    variableStore.setCurrentPage(pageIndex);
  }
  
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

  // BACKGROUND RESOLUTION: only resolve variables used by the visible layout.
  // Commands remain lazy and resolve their own references when invoked.
  if (page.variables && Object.keys(page.variables).length > 0) {
    const { targets, localVariables: varsToResolve } = collectLayoutVariableTargets(page, pageIndex);
    
    // Resolve local bindings and direct Pages references used by visible text.
    if (targets.size > 0) {
      const resolutionVersion = page._variablesVersion || 0;

      // The targeted cross-page graph also handles local Page dependencies.
      resolveAllPageVariables(config, globalVariables, targets)
        .then(pages => {
          if ((page._variablesVersion || 0) !== resolutionVersion) return;
          const pageKey = page.id || `page_${pageIndex + 1}`;
          const allResolved = pages[pageKey] || {};
          for (const varName of varsToResolve) {
            if (varName in allResolved) {
              page._resolved[varName] = allResolved[varName];
              if (isCurrentRender(page, pageIndex, cycle)) {
                updateRenderedValue(varName, allResolved[varName], pageIndex);
              }
            }
          }
          logger.log("Visible variable resolution complete");
        })
        .catch(err => {
          logger.error('Error during variable resolution:', err);
        });
    }
  }
}

function isCurrentRender(page, pageIndex, cycle) {
  return cycle === renderCycle
    && pageIndex === currentPage
    && config?.pages?.[pageIndex] === page;
}

/**
 * Update a rendered value element when its variable resolves
 */
export function updateRenderedValue(varName, value, pageIndex = null) {
  if (pageIndex !== null && pageIndex !== undefined && pageIndex !== currentPage) {
    return;
  }

  const entry = renderedValueElements[varName];
  // Support both single element (legacy) and array (for multiple counters sharing a variable)
  const elements = Array.isArray(entry) ? entry : (entry ? [entry] : []);

  for (const element of elements) {
    // Update value display
    const contentDiv = element.querySelector(".mh-value-content");
    if (contentDiv) {
      contentDiv.textContent = value ?? "N/A";
      contentDiv.classList.remove("mh-loading");
    }

    // Update counter input if this is a counter
    const counterInput = element.querySelector(".mh-counter-input");
    if (counterInput) {
      counterInput.value = value ?? 0;
    }

    // Update input field if this is an input
    const inputField = element.querySelector(".mh-input-field");
    if (inputField) {
      inputField.value = value ?? "";
    }

    // Update dropdown select if this is a dropdown
    const selectField = element.querySelector(".mh-dropdown-select");
    if (selectField) {
      selectField.value = value ?? "";
    }
  }

  // Update checkboxes for this variable (supports multiple sharing the same variable)
  const checkboxEntry = renderedCheckboxElements[varName];
  const checkboxes = Array.isArray(checkboxEntry) ? checkboxEntry : (checkboxEntry ? [checkboxEntry] : []);
  for (const checkbox of checkboxes) {
    checkbox.checked = Boolean(value);
  }

  // Re-evaluate any expression-based title/text/button elements that depend on this variable
  for (const entry of renderedExpressionElements) {
    try {
      if (!entry || !entry.item || !entry.element) continue;
      
      const hasPlaceholders = (entry.item.label && entry.item.label.includes('{')) || 
                             (entry.item.text && entry.item.text.includes('{')) || 
                             (entry.item.content && entry.item.content.includes('{'));
      
      if (hasPlaceholders) {
        const resolvedVars = { ...globalVariables, ...(entry.page?._resolved || {}) };
        if (typeof entry.updateFn === 'function') {
          // Custom updater (e.g. HTML text with ${vars})
          entry.updateFn(resolvedVars);
        } else {
          evaluateItemText(entry.item, resolvedVars, entry.page)
            .then(res => { entry.element.textContent = res; })
            .catch(err => logger.error('Error evaluating layout expression:', err));
        }
      }
    } catch (err) {
      logger.error('Error updating expression element:', err);
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
/**
 * Evaluate item text - supports ${variable} and ${expression} syntax
 * @param {Object} item - Layout item with label, text, or content property
 * @param {Object} resolvedVars - Resolved variables for evaluation
 * @returns {Promise<string>} Evaluated text
 */
function buildVariableScopes(page, resolvedVars = {}) {
  const globalNames = Object.keys(config?.global?.variables || {});
  const pageNames = Object.keys(page?.variables || {});
  return {
    Global: Object.fromEntries(globalNames.map(name => [name, globalVariables[name] ?? resolvedVars[name]])),
    Page: Object.fromEntries(pageNames.map(name => [name, page?._resolved?.[name] ?? resolvedVars[name]])),
    Pages: variableStore.getPagesResolved(),
  };
}

async function evaluateItemText(item, resolvedVars, page = null) {
  let text = item.label ?? item.content ?? item.text ?? "";
  
  if (!text) return "";
  
  // If entire text is ${expression}, try to evaluate as expression
  const match = text.match(/^\$\{(.+)\}$/);
  if (match) {
    try {
      const scopes = buildVariableScopes(page, resolvedVars);
      const res = await evaluateExpression(match[1], resolvedVars, scopes);
      return (res === null || res === undefined) ? "" : String(res);
    } catch (err) {
      // Fall through to variable substitution if expression fails
    }
  }
  
  const scopes = buildVariableScopes(page, resolvedVars);
  return text.replace(/\$\{([^{}]+)\}/g, (placeholder, expression) => {
    try {
      const result = new Function('Page', 'Global', 'Pages', `return (${expression})`)(scopes.Page, scopes.Global, scopes.Pages);
      return result === null || result === undefined ? '' : String(result);
    } catch {
      return placeholder;
    }
  });
}

/**
 * Evaluate item and set element text content, registering for dynamic updates if needed
 * @param {HTMLElement} element - DOM element to update
 * @param {Object} item - Layout item
 * @param {Object} page - Page object
 * @returns {boolean} True if element was registered for dynamic updates
 */
function evaluateAndSetElementText(element, item, page) {
  const text = item.label || item.text || item.content || '';
  if (!text.includes('${')) return false;
  
  element.textContent = "";
  renderedExpressionElements.push({ element, item, page });
  const resolvedVars = { ...globalVariables, ...(page?._resolved || {}) };
  evaluateItemText(item, resolvedVars, page)
    .then(res => { element.textContent = res; })
    .catch(err => { logger.error('Error evaluating element text:', err); });
  
  return true;
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
    getVariableScopes: page => buildVariableScopes(page, {
      ...globalVariables,
      ...(page?._resolved || {}),
    }),
    globalVariables,
    renderedExpressionElements,
    renderedValueElements,
    renderedCheckboxElements,
    currentPage,
    getDependentVariables,
    resolveVariables,
    resolveCrossPageVariables: async (pageId, varName) => {
      const affected = variableEngine.getCrossPageDependents(
        config,
        new Set([`${pageId}.${varName}`]),
      );
      if (affected.size === 0) return;
      const pages = await resolveAllPageVariables(config, globalVariables, affected);
      const activePage = config.pages?.[currentPage];
      const activeValues = activePage ? pages[activePage.id] : null;
      const activePrefix = `${activePage?.id}.`;
      for (const nodeId of affected) {
        if (!activePage || !nodeId.startsWith(activePrefix)) continue;
        const name = nodeId.slice(activePrefix.length);
        const value = activeValues?.[name];
        updateRenderedValue(name, value, currentPage);
      }
    },
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
  // Render all elements through ComponentRegistry (including divider)
  const element = renderElement(layoutItem.type, layoutItem, page);
  if (element) {
    return element;
  }

  logger.warn('Unknown layout type:', layoutItem.type);
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
      logger.warn("No config available");
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
  logger.log("Config updated, refreshing");
  // Don't show loading overlay - let the UI update progressively
  config = newConfig;
  variableStore.setConfig(config);
  updateHeaderTitle();
  
  // Re-resolve variables when config updates
  try {
    // Resolve global variables
    const globalVars = await resolveVariables(config.global?.variables, {}, null, null, { scope: "global" });
    setGlobalVariables(globalVars);
    config._resolvedGlobal = globalVars;

    // Reset page scopes. The active page resolves only its visible variables
    // when renderConfigUI renders it below.
    for (let i = 0; i < (config.pages || []).length; i++) {
      const page = config.pages[i];
      page._resolved = {};
      page._pageIndex = i;
      page._variablesVersion = 0;
    }
  } catch (error) {
    logger.error("Error re-resolving global variables:", error);
  }

  // Re-render UI immediately - variables will resolve in background
  renderConfigUI();
}
