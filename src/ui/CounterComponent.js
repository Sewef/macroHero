/**
 * Counter Component
 * Renders numeric counter inputs with +/- buttons and constraints
 */

import { UIComponent } from "./UIComponent.js";
import { createDebugLogger } from "../debugMode.js";
import { eventBus as EventBus } from "../events/EventBus.js";
import { variableStore } from "../stores/VariableStore.js";
import { updateEvaluatedVariable } from "../storage.js";
import { variableEngine } from "../engines/VariableEngine.js";

const logger = createDebugLogger('ui');

export class CounterComponent extends UIComponent {
  constructor(item, page, services, inStack = false) {
    super(item, page, services);
    this.inStack = inStack;
    this.saveTimer = null;
    this.isUpdatingCounter = false;
    this.lastSavedValue = null;
    this.unsubscribe = null;
    this.observer = null;
    this.onUpdateDebounced = null;
  }

  render() {
    const container = this.createElement("div", "mh-layout-counter");
    if (this.inStack) {
      container.classList.add("mh-stack-counter");
    }
    this.applyColor(container);

    const variable = this.getVariable(this.item.var);
    if (!variable) {
      container.innerHTML = `<div class="mh-value-error">Variable not found: ${this.item.var}</div>`;
      return container;
    }

    // Get initial value
    const isComputed = variable.eval !== undefined;
    const initialValue = this.getResolvedValue(this.item.var, this.item.min ?? 0);
    const numValue = Number(initialValue) || 0;
    this.lastSavedValue = numValue;

    // Create label
    const label = this.createElement(this.inStack ? "span" : "div", "mh-counter-label");
    if (!this.services.evaluateAndSetElementText(label, this.item, this.page)) {
      label.textContent = this.item.label ?? this.item.var;
    }

    // Create counter controls
    const controls = this.createElement("div", "mh-counter-controls");
    
    const input = this.createElement("input");
    input.type = "number";
    input.className = "mh-counter-input";
    input.value = numValue;
    input.disabled = isComputed;
    input.title = isComputed ? "Calculated value" : "";
    input.inputMode = "decimal";
    input.step = this.getCounterStep(variable);
    
    if (this.item.min !== undefined || variable.min !== undefined) input.min = this.item.min ?? variable.min;
    if (this.item.max !== undefined || variable.max !== undefined) input.max = this.item.max ?? variable.max;

    // Event listeners for input
    this.addEventListener(input, "input", (e) => {
      logger.log(`Input value: ${this.item.var} = ${e.target.value}`);
      this.handleCounterTextInput(input, variable, this.item.var);
    });

    this.addEventListener(input, "change", (e) => {
      logger.log(`Changed: ${this.item.var} = ${e.target.value}`);
      this.commitCounterInput(input, variable, this.item.var);
    });

    this.addEventListener(input, "blur", (e) => {
      logger.log(`Blurred: ${this.item.var} = ${e.target.value}`);
      this.commitCounterInput(input, variable, this.item.var);
    });

    // Create buttons
    const buttonContainer = this.createElement("div", "mh-counter-buttons");
    
    const incrementBtn = this.createElement("button", "mh-counter-btn");
    incrementBtn.type = "button";
    incrementBtn.textContent = "+";
    incrementBtn.setAttribute("aria-label", `Increase ${this.item.label ?? this.item.var}`);
    incrementBtn.disabled = isComputed;
    this.addEventListener(incrementBtn, "click", () => {
      if (isComputed) return;
      logger.log(`Increment: ${this.item.var}`);
      this.nudgeCounter(input, variable, this.item.var, 1);
    });

    const decrementBtn = this.createElement("button", "mh-counter-btn");
    decrementBtn.type = "button";
    decrementBtn.textContent = "-";
    decrementBtn.setAttribute("aria-label", `Decrease ${this.item.label ?? this.item.var}`);
    decrementBtn.disabled = isComputed;
    this.addEventListener(decrementBtn, "click", () => {
      if (isComputed) return;
      logger.log(`Decrement: ${this.item.var}`);
      this.nudgeCounter(input, variable, this.item.var, -1);
    });

    buttonContainer.appendChild(decrementBtn);
    buttonContainer.appendChild(incrementBtn);

    controls.appendChild(input);
    controls.appendChild(buttonContainer);

    container.appendChild(label);
    container.appendChild(controls);

    this.container = container;
    this.registerElement(this.item.var, container);

    // Listen for external changes
    this.setupExternalChangeListener();

    return container;
  }

  /**
   * Return the configured numeric step.
   * @param {Object} variable - Variable object
   * @returns {number} Step value
   */
  getCounterStep(variable) {
    const step = Number(this.item.step ?? variable?.step ?? 1);
    return Number.isFinite(step) && step !== 0 ? step : 1;
  }

  /**
   * Format a number without floating-point noise from decimal steps.
   * @param {number} value - Number to format
   * @returns {string} Display string
   */
  formatCounterValue(value) {
    if (!Number.isFinite(value)) return "0";
    const rounded = Number(value.toFixed(10));
    return String(rounded);
  }

  /**
   * Let users type temporary number states like "-" or "." without snapping to 0.
   * @param {string} value - Raw input value
   * @returns {boolean} True for incomplete input
   */
  isIncompleteNumberInput(value) {
    return value === "" || value === "-" || value === "+" || value === "." || value === "-." || value === "+.";
  }

  /**
   * Update while the user types, but avoid rewriting incomplete numeric text.
   * @param {HTMLElement} input - Input element
   * @param {Object} variable - Variable object
   * @param {string} varName - Variable name
   */
  handleCounterTextInput(input, variable, varName) {
    if (variable.eval !== undefined) {
      input.value = Number(this.getResolvedValue(varName, this.item.min ?? 0)) || 0;
      return;
    }

    if (this.isIncompleteNumberInput(input.value) || !Number.isFinite(Number(input.value))) {
      return;
    }

    this.updateCounterValue(input, variable, varName, { clamp: true, syncInput: false });
  }

  /**
   * Commit an input edit and normalize the displayed value.
   * @param {HTMLElement} input - Input element
   * @param {Object} variable - Variable object
   * @param {string} varName - Variable name
   */
  commitCounterInput(input, variable, varName) {
    if (this.isIncompleteNumberInput(input.value) || !Number.isFinite(Number(input.value))) {
      input.value = this.formatCounterValue(this.lastSavedValue ?? this.item.min ?? variable.min ?? 0);
    }

    this.updateCounterValue(input, variable, varName, { clamp: true, syncInput: true });
  }

  /**
   * Apply a +/- step from the current committed or typed value.
   * @param {HTMLElement} input - Input element
   * @param {Object} variable - Variable object
   * @param {string} varName - Variable name
   * @param {number} direction - 1 to increment, -1 to decrement
   */
  nudgeCounter(input, variable, varName, direction) {
    const typedValue = Number(input.value);
    const resolvedValue = Number(this.getResolvedValue(varName, this.item.min ?? variable.min ?? 0));
    const fallbackValue = this.lastSavedValue ?? (Number.isFinite(resolvedValue) ? resolvedValue : 0);
    const current = Number.isFinite(typedValue) ? typedValue : fallbackValue;

    input.value = this.formatCounterValue(current + direction * this.getCounterStep(variable));
    this.updateCounterValue(input, variable, varName, { clamp: true, syncInput: true });
  }

  /**
   * Apply min/max constraints to a value
   * @param {number} value - Value to constrain
   * @returns {number} Constrained value
   */
  applyConstraints(value) {
    let constrained = Number(value) || 0;
    if (this.item.min !== undefined && constrained < this.item.min) constrained = this.item.min;
    if (this.item.max !== undefined && constrained > this.item.max) constrained = this.item.max;
    
    const variable = this.getVariable(this.item.var);
    if (variable) {
      if (variable.min !== undefined && constrained < variable.min) constrained = variable.min;
      if (variable.max !== undefined && constrained > variable.max) constrained = variable.max;
    }
    return constrained;
  }

  /**
   * Update counter value with debounced persistence
   * @param {HTMLElement} input - Input element
   * @param {Object} variable - Variable object
   * @param {string} varName - Variable name
   * @param {Object} options - Update options
   */
  updateCounterValue(input, variable, varName, options = {}) {
    const { clamp = true, syncInput = true } = options;

    if (variable.eval !== undefined) {
      input.value = Number(this.getResolvedValue(varName, this.item.min ?? 0)) || 0;
      return;
    }

    const parsed = Number(input.value);
    if (!Number.isFinite(parsed)) {
      return;
    }

    const constrained = clamp ? this.applyConstraints(parsed) : parsed;
    
    if (syncInput) {
      input.value = this.formatCounterValue(constrained);
    }
    
    if (constrained === this.lastSavedValue) {
      return;
    }
    
    logger.log(`Updated: ${varName} = ${constrained}`);
    
    this.lastSavedValue = constrained;
    
    // Set flag BEFORE any async operations or events
    this.isUpdatingCounter = true;
    
    // Update resolved value immediately
    this.setResolvedValue(varName, constrained);
    variable.value = constrained;
    delete variable.eval;
    this.page._variablesVersion = (this.page._variablesVersion || 0) + 1;
    variableEngine.invalidateDependencyGraph(this.page.variables);
    
    // Notify VariableStore
    if (this.page._pageIndex !== undefined) {
      variableStore.setVariableResolved(varName, constrained, this.page._pageIndex);
      variableStore.markVariableModified(varName);
      logger.log(`Store notified: ${varName}`);
      updateEvaluatedVariable(this.page._pageIndex, varName, constrained)
        .catch(err => this.handleError("Counter", err));
    }
    
    // Clear pending save and reschedule
    clearTimeout(this.saveTimer);
    
    this.saveTimer = setTimeout(async () => {
      try {
        logger.log(`Saving: ${varName}`);

        await this.services.broadcastConfigUpdated();
        
        // Execute onupdate commands if defined
        if (this.item.onupdate && Array.isArray(this.item.onupdate)) {
          await this.executeOnUpdate(this.item.onupdate, "CounterOnUpdate");
        }
        
        // Re-resolve dependent variables (excluding the counter variable itself)
        const dependentVars = this.services.getDependentVariables(
          this.page.variables,
          [varName]
        );
        logger.log(`Found ${dependentVars.size} dependent variables`);
        
        // Create set of variables to resolve, excluding the counter itself
        const dependentVarsToResolve = new Set(dependentVars);
        dependentVarsToResolve.delete(varName);
        
        for (const depVar of dependentVars) {
          if (depVar !== varName) {
            delete this.page._resolved[depVar];
          }
        }
        
        if (dependentVarsToResolve.size > 0) {
          logger.log(`Resolving ${dependentVarsToResolve.size} dependent variables`);
          const onVariableResolved = (resolvedVarName, value) => {
            logger.log(`Resolved: ${resolvedVarName} = ${value}`);
            this.page._resolved[resolvedVarName] = value;
            this.services.updateRenderedValue(resolvedVarName, value, this.page._pageIndex);
          };
          const baseResolved = {
            ...(this.services.globalVariables || {}),
            ...(this.page?._resolved || {}),
          };

          await this.services.resolveVariables(
            this.page.variables,
            baseResolved,
            onVariableResolved,
            dependentVarsToResolve
          );
        }
      } catch (err) {
        this.handleError("Counter", err);
      } finally {
        this.isUpdatingCounter = false;
      }
    }, 150);
  }

  /**
   * Setup listener for external changes to this variable
   */
  setupExternalChangeListener() {
    const myContainer = this.container; // capture own container — not the shared map entry

    this.unsubscribe = EventBus.on('store:variableResolved', (varName, value, pageIndex) => {
      if (pageIndex !== null && pageIndex !== undefined && pageIndex !== this.page._pageIndex) {
        return;
      }

      if (varName === this.item.var && !this.isUpdatingCounter) {
        logger.log(`External change: ${varName} = ${value}`);
        const constrained = this.applyConstraints(value);
        const input = myContainer.querySelector('.mh-counter-input');
        if (input) {
          input.value = constrained;
        }
        this.lastSavedValue = constrained;
        this.setResolvedValue(varName, constrained);
        const variable = this.getVariable(varName);
        if (variable && variable.eval === undefined) {
          variable.value = constrained;
        }
      }
    });

    // Clean up listener when OUR container is removed from DOM
    this.observer = new MutationObserver(() => {
      if (!document.contains(myContainer)) {
        this.cleanup();
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Clean up listeners and timers
   */
  cleanup() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.onUpdateDebounced) {
      this.onUpdateDebounced.cancel();
    }
    // Remove own container from the shared array
    if (this.container) {
      const elements = this.services.renderedValueElements[this.item.var];
      if (Array.isArray(elements)) {
        const idx = elements.indexOf(this.container);
        if (idx !== -1) elements.splice(idx, 1);
      }
    }
  }
}


