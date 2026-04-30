/**
 * Counter Component
 * Renders numeric counter inputs with +/- buttons and constraints
 */

import { UIComponent } from "./UIComponent.js";
import { createDebugLogger } from "../debugMode.js";
import { eventBus as EventBus } from "../events/EventBus.js";
import { variableStore } from "../stores/VariableStore.js";

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
    
    if (variable.min !== undefined) input.min = variable.min;
    if (variable.max !== undefined) input.max = variable.max;

    // Event listeners for input
    this.addEventListener(input, "input", (e) => {
      logger.log(`Input value: ${this.item.var} = ${e.target.value}`);
      this.updateCounterValue(input, variable, this.item.var);
    });

    this.addEventListener(input, "change", (e) => {
      logger.log(`Changed: ${this.item.var} = ${e.target.value}`);
      this.updateCounterValue(input, variable, this.item.var);
    });

    // Create buttons
    const buttonContainer = this.createElement("div", "mh-counter-buttons");
    
    const incrementBtn = this.createElement("button", "mh-counter-btn");
    incrementBtn.textContent = "+";
    this.addEventListener(incrementBtn, "click", () => {
      logger.log(`Increment: ${this.item.var}`);
      input.value = Number(input.value) + (this.item.step ?? 1);
      this.updateCounterValue(input, variable, this.item.var);
    });

    const decrementBtn = this.createElement("button", "mh-counter-btn");
    decrementBtn.textContent = "-";
    this.addEventListener(decrementBtn, "click", () => {
      logger.log(`Decrement: ${this.item.var}`);
      input.value = Number(input.value) - (this.item.step ?? 1);
      this.updateCounterValue(input, variable, this.item.var);
    });

    buttonContainer.appendChild(incrementBtn);
    buttonContainer.appendChild(decrementBtn);

    controls.appendChild(input);
    controls.appendChild(buttonContainer);

    container.appendChild(label);
    container.appendChild(controls);

    this.services.renderedValueElements[this.item.var] = container;

    // Listen for external changes
    this.setupExternalChangeListener();

    return container;
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
   */
  updateCounterValue(input, variable, varName) {
    const constrained = this.applyConstraints(input.value);
    
    // Always sync the input value to respect constraints
    input.value = constrained;
    
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
    
    // Notify VariableStore
    if (this.page._pageIndex !== undefined) {
      variableStore.setVariableResolved(varName, constrained, this.page._pageIndex);
      variableStore.markVariableModified(varName);
      logger.log(`Store notified: ${varName}`);
    }
    
    // Notify EventBus
    EventBus.emit('store:variableResolved', varName, constrained, this.page._pageIndex);
    
    // Clear pending save and reschedule
    clearTimeout(this.saveTimer);
    
    this.saveTimer = setTimeout(async () => {
      try {
        logger.log(`Saving: ${varName}`);
        
        await this.services.saveConfig(this.services.config)
          .catch(err => this.handleError("Counter", err));
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
            this.services.updateRenderedValue(resolvedVarName, value);
          };
          await this.services.resolveVariables(
            this.page.variables,
            this.services.globalVariables,
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
    this.unsubscribe = EventBus.on('store:variableResolved', (varName, value) => {
      if (varName === this.item.var && !this.isUpdatingCounter) {
        logger.log(`External change: ${varName} = ${value}`);
        const constrained = this.applyConstraints(value);
        const input = this.services.renderedValueElements[this.item.var]?.querySelector('.mh-counter-input');
        if (input) {
          input.value = constrained;
        }
        this.lastSavedValue = constrained;
        this.setResolvedValue(varName, constrained);
        const variable = this.getVariable(varName);
        if (variable) {
          variable.value = constrained;
        }
      }
    });

    // Clean up listener when element is removed from DOM
    this.observer = new MutationObserver(() => {
      const container = this.services.renderedValueElements[this.item.var];
      if (container && !document.contains(container)) {
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
    }
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    if (this.onUpdateDebounced) {
      this.onUpdateDebounced.cancel();
    }
  }
}


