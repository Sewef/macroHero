/**
 * Counter Element Renderer
 * Handles rendering and state management for numeric counter inputs
 */

import { isDebugEnabled } from "../debugMode.js";
import { eventBus as EventBus } from "../events/EventBus.js";
import { variableStore } from "../stores/VariableStore.js";

const debugLog = (...args) => isDebugEnabled('ui') && console.log(...args);
const debugError = (...args) => console.error(...args);

/**
 * Render a numeric counter with +/- buttons
 * @param {object} item - Layout item configuration
 * @param {object} page - Current page object
 * @param {function} saveConfig - Function to save configuration
 * @param {function} broadcastConfigUpdated - Function to broadcast updates
 * @param {function} getDependentVariables - Function to find dependent variables
 * @param {function} resolveVariables - Function to resolve variables
 * @param {function} updateRenderedValue - Function to update rendered values
 * @param {object} globalVariables - Global variables
 * @param {boolean} inStack - Whether in a stack layout
 * @returns {HTMLElement} Container element
 */
export function renderCounter(item, page, {
  saveConfig,
  broadcastConfigUpdated,
  getDependentVariables,
  resolveVariables,
  updateRenderedValue,
  globalVariables,
  evaluateAndSetElementText,
  renderedValueElements
}, inStack = false) {
  const container = document.createElement("div");
  container.className = "mh-layout-counter";
  if (inStack) {
    container.classList.add("mh-stack-counter");
  }

  const variable = page.variables?.[item.var];
  if (!variable) {
    container.innerHTML = `<div class="mh-value-error">Variable not found: ${item.var}</div>`;
    return container;
  }

  // Get initial value
  const initialValue = page._resolved?.[item.var] ?? variable.value ?? item.min ?? 0;
  const numValue = Number(initialValue) || 0;

  // Label
  const label = document.createElement(inStack ? "span" : "div");
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

  // Helper to apply constraints
  const applyConstraints = (value) => {
    let constrained = Number(value) || 0;
    if (item.min !== undefined && constrained < item.min) constrained = item.min;
    if (item.max !== undefined && constrained > item.max) constrained = item.max;
    if (variable.min !== undefined && constrained < variable.min) constrained = variable.min;
    if (variable.max !== undefined && constrained > variable.max) constrained = variable.max;
    return constrained;
  };

  let saveTimer = null;
  let isUpdatingCounter = false;
  let lastSavedValue = numValue;

  // Unified counter update with debounced persistence
  const updateCounterValue = (newValue) => {
    const constrained = applyConstraints(newValue);
    
    // Only update if value actually changed from what we last saved
    if (constrained === lastSavedValue) {
      return;
    }
    
    debugLog("[Counter] Value changed:", item.var, "=>", constrained);
    
    // Update DOM immediately
    input.value = constrained;
    lastSavedValue = constrained;
    
    // Update resolved value IMMEDIATELY - this is the single source of truth
    page._resolved[item.var] = constrained;
    variable.value = constrained;
    delete variable.eval;
    
    // Notify VariableStore so integrations know about the change
    if (page._pageIndex !== undefined) {
      variableStore.setVariableResolved(item.var, constrained, page._pageIndex);
      variableStore.markVariableModified(item.var);
      debugLog("[Counter] VariableStore notified for:", item.var);
    }
    
    // Notify EventBus locally
    EventBus.emit('store:variableResolved', item.var, constrained, page._pageIndex);
    
    isUpdatingCounter = true;
    
    // Clear any pending save
    clearTimeout(saveTimer);
    
    // Debounce the actual persistence to avoid too many file writes
    saveTimer = setTimeout(async () => {
      try {
        debugLog("[Counter] Debounce triggered for:", item.var);
        
        await saveConfig(page.config ?? {}).catch(err => debugError("[Counter] Error auto-saving config:", err));
        await broadcastConfigUpdated();
        
        // Clear cached values for dependent variables so they get re-evaluated
        const dependentVars = getDependentVariables(page.variables, [item.var]);
        debugLog("[Counter] Dependent variables:", Array.from(dependentVars));
        
        for (const depVar of dependentVars) {
          if (depVar !== item.var) {
            delete page._resolved[depVar];
          }
        }
        
        // Re-resolve all dependent variables
        if (dependentVars.size > 1) {
          debugLog("[Counter] Resolving", dependentVars.size, "dependent variables...");
          const onVariableResolved = (varName, value) => {
            debugLog("[Counter] Resolved dependent:", varName, "=>", value);
            page._resolved[varName] = value;
            updateRenderedValue(varName, value);
          };
          await resolveVariables(page.variables, globalVariables, onVariableResolved, dependentVars);
        }
      } catch (err) {
        debugError("[Counter] Error saving counter:", err);
      } finally {
        isUpdatingCounter = false;
      }
    }, 150);
  };

  // Input change/input events - save on any keystroke
  input.addEventListener('input', (e) => {
    debugLog("[Counter DEBUG] Input event fired on", item.var, "new value:", e.target.value);
    updateCounterValue(e.target.value);
  });

  input.addEventListener('change', (e) => {
    debugLog("[Counter DEBUG] Change event fired on", item.var, "new value:", e.target.value);
    updateCounterValue(e.target.value);
  });

  // Wheel event - with debounce
  input.addEventListener('wheel', (e) => {
    debugLog("[Counter DEBUG] Wheel event fired on", item.var);
    e.preventDefault();
    const step = item.step ?? 1;
    const newValue = Number(input.value) + (e.deltaY < 0 ? step : -step);
    updateCounterValue(newValue);
  }, { passive: false });

  // Increment button
  const incrementBtn = document.createElement("button");
  incrementBtn.className = "mh-counter-btn";
  incrementBtn.textContent = "+";
  incrementBtn.onclick = () => {
    debugLog("[Counter DEBUG] Increment button clicked on", item.var);
    updateCounterValue(Number(input.value) + (item.step ?? 1));
  };

  // Decrement button
  const decrementBtn = document.createElement("button");
  decrementBtn.className = "mh-counter-btn";
  decrementBtn.textContent = "-";
  decrementBtn.onclick = () => {
    debugLog("[Counter DEBUG] Decrement button clicked on", item.var);
    updateCounterValue(Number(input.value) - (item.step ?? 1));
  };

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
