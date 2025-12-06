let config = null;
let currentPage = null;
let globalVariables = {}; // Store global variables for use in button clicks
let renderedValueElements = {}; // Map of varName -> DOM element for live updates

import OBR from "@owlbear-rodeo/sdk";
import { STORAGE_KEY, MODAL_LABEL, loadConfig, saveConfig } from "./config.js";
import { handleButtonClick } from "./executor.js";
import { resolveVariables } from "./expressionEvaluator.js";

export function initUI(cfg) {
  config = cfg;
  renderPageButtons();
  selectFirstPage();
}

// Store global variables for later use
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

  if (!config.pages?.length) {
    bar.innerHTML = "<i>Aucune page</i>";
    return;
  }

  config.pages.forEach((p, index) => {
    const btn = document.createElement("button");
    btn.textContent = p.label || `Page ${index + 1}`;

    btn.onclick = () => {
      currentPage = index;
      renderPageButtons();
      renderPageContent(p);
    };

    if (currentPage === index) btn.classList.add("active");

    bar.appendChild(btn);
  });
}

function selectFirstPage() {
  if (config.pages?.length) {
    const first = config.pages[0];
    currentPage = 0;
    renderPageContent(first);
  } else {
    document.getElementById("content").innerHTML = "<div class='mh-empty'>Aucune page définie</div>";
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
  
  // Clear previous element map
  renderedValueElements = {};

  // Render layout if defined
  if (page.layout && Array.isArray(page.layout)) {
    renderLayout(container, page.layout, page);
  } else {
    const emptyMsg = document.createElement("i");
    emptyMsg.textContent = "Aucun layout défini pour cette page";
    container.appendChild(emptyMsg);
  }
  
  // Now resolve variables with callback to update UI as they resolve
  const onVariableResolved = (varName, value) => {
    page._resolved[varName] = value;
    updateRenderedValue(varName, value);
  };
  
  // Start resolving variables (don't await - let it happen in background)
  resolveVariables(page.variables, globalVariables, onVariableResolved).then((allResolved) => {
    page._resolved = allResolved;
  });
}

/**
 * Update a rendered value element when its variable resolves
 */
function updateRenderedValue(varName, value) {
  const element = renderedValueElements[varName];
  if (element) {
    const contentDiv = element.querySelector(".mh-value-content");
    if (contentDiv) {
      contentDiv.textContent = value ?? "N/A";
      contentDiv.classList.remove("mh-loading");
    }
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
    
    case "button":
      return renderButton(layoutItem, page);
    
    case "value":
      return renderValue(layoutItem, page);
    
    case "input":
      return renderInput(layoutItem, page);
    
    case "checkbox":
      return renderCheckbox(layoutItem, page);
    
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

function renderValue(item, page) {
  const valueDiv = document.createElement("div");
  valueDiv.className = "mh-layout-value";

  console.log(`[RENDER_VALUE] Rendering item:`, item);
  console.log(`[RENDER_VALUE] Looking for variable: "${item.var}"`);
  console.log(`[RENDER_VALUE] Available variables:`, Object.keys(page.variables || {}));
  console.log(`[RENDER_VALUE] Resolved values:`, page._resolved);

  // Get variable definition from page.variables
  const variable = page.variables?.[item.var];

  if (!variable) {
    valueDiv.innerHTML = `<div class="mh-value-label">${item.label ?? item.var}</div><div class="mh-value-error">Variable not found: ${item.var}</div>`;
    return valueDiv;
  }

  // Get resolved value from page._resolved (from expression evaluation)
  const resolvedValue = page._resolved?.[item.var];

  // Create the value element structure
  // Only treat as loading if the variable hasn't been resolved yet (undefined, not in _resolved)
  const isLoading = !(item.var in (page._resolved || {}));
  const displayValue = isLoading ? '' : (resolvedValue ?? 'N/A');
  valueDiv.innerHTML = `<div class="mh-value-label">${item.label ?? item.var}</div>
                        <div class="mh-value-content ${isLoading ? 'mh-loading' : ''}">${displayValue}</div>`;

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

function renderInput(item, page) {
  const container = document.createElement("div");
  container.className = "mh-layout-input";

  const variable = page.variables?.[item.var];

  if (!variable) {
    container.innerHTML = `<div class="mh-value-error">Variable not found: ${item.var}</div>`;
    return container;
  }

  const label = document.createElement("label");
  label.className = "mh-input-label";
  label.textContent = item.label ?? item.var;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "mh-input-field";
  input.placeholder = item.placeholder ?? "Enter value";
  input.value = variable.expression ?? variable.default ?? "";

  container.appendChild(label);
  container.appendChild(input);
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

// ============================================
// ACTION HANDLERS
// ============================================

// Command execution is handled by executor.js

// ============================================
// RENDER HELPERS - Utilities
// ============================================

export function renderConfigUI() {
  console.log("[UI.renderConfigUI] Starting render...");
  console.log("[UI.renderConfigUI] Current config:", config);
  console.log("[UI.renderConfigUI] Current page index:", currentPage);
  
  if (!config) {
    console.warn("[UI.renderConfigUI] No config available");
    return;
  }
  
  renderPageButtons();
  
  // If we have a current page index, re-render it; otherwise select first
  if (currentPage !== null && currentPage !== undefined) {
    const page = config.pages?.[currentPage];
    if (page) {
      console.log("[UI.renderConfigUI] Re-rendering current page at index:", currentPage);
      renderPageContent(page);
    } else {
      console.log("[UI.renderConfigUI] Current page not found, selecting first");
      selectFirstPage();
    }
  } else {
    console.log("[UI.renderConfigUI] No current page, selecting first");
    selectFirstPage();
  }
  
  console.log("[UI.renderConfigUI] Render complete");
}

export async function updateConfig(newConfig) {
  console.log("[UI.updateConfig] Received new config:", newConfig);
  console.log("[UI.updateConfig] Previous config pages:", config?.pages?.length);
  
  config = newConfig;
  
  console.log("[UI.updateConfig] New config pages:", config?.pages?.length);
  
  // Re-resolve variables when config updates
  try {
    // Resolve global variables
    console.log("[UI.updateConfig] Re-resolving global variables...");
    const globalVars = await resolveVariables(config.global?.variables);
    setGlobalVariables(globalVars);
    config._resolvedGlobal = globalVars;
    console.log("[UI.updateConfig] Global variables resolved:", globalVars);

    // Resolve variables for each page
    console.log("[UI.updateConfig] Re-resolving page variables...");
    for (const page of config.pages || []) {
      page._resolved = await resolveVariables(page.variables, globalVars);
      console.log(`[UI.updateConfig] Page ${page.id} variables resolved:`, page._resolved);
    }
  } catch (error) {
    console.error("[UI.updateConfig] Error re-resolving variables:", error);
  }

  console.log("[UI.updateConfig] Calling renderConfigUI()...");
  renderConfigUI();
  console.log("[UI.updateConfig] UI render complete");
}
