/**
 * Input Component
 * Renders text input fields
 */

import { UIComponent } from "./UIComponent.js";


export class InputComponent extends UIComponent {
  constructor(item, page, services, inStack = false) {
    super(item, page, services);
    this.inStack = inStack;
    this.onUpdateDebounced = null;
    this.updateTimer = null;
  }

  render() {
    const container = this.createElement("div", "mh-layout-input");

    const variable = this.getVariable(this.item.var);
    if (!variable) {
      container.innerHTML = `<div class="mh-value-error">Variable not found: ${this.item.var}</div>`;
      return container;
    }

    // Create label
    const label = this.createElement(this.inStack ? "span" : "label", "mh-input-label");
    
    if (!this.services.evaluateAndSetElementText(label, this.item, this.page)) {
      label.textContent = this.inStack 
        ? `${this.item.label ?? this.item.var}:` 
        : (this.item.label ?? this.item.var);
    }

    // Create input field
    const input = this.createElement("input");
    input.type = "text";
    input.className = "mh-input-field";
    input.placeholder = this.item.placeholder ?? "Enter value";
    
    const currentValue = this.getResolvedValue(this.item.var, variable.value ?? variable.eval ?? "");
    input.value = currentValue;

    this.services.renderedValueElements[this.item.var] = container;

    // Handle value changes
    this.addEventListener(input, "blur", () => {
      this.handleInputChange(input, variable, true);
    });

    // For onupdate, listen to input/change events with debounce
    if (this.item.onupdate && Array.isArray(this.item.onupdate)) {
      this.addEventListener(input, "input", () => {
        this.handleInputChange(input, variable, false);
      });
      this.addEventListener(input, "change", () => {
        this.handleInputChange(input, variable, false);
      });
    }

    // Assemble container
    if (this.inStack) {
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

  /**
   * Handle input value change
   * @param {HTMLElement} input - Input element
   * @param {Object} variable - Variable object
   * @param {boolean} isBlur - Whether this was called from blur event
   */
  async handleInputChange(input, variable, isBlur = true) {
    const newValue = input.value;
    variable.value = newValue;
    delete variable.eval;
    this.setResolvedValue(this.item.var, newValue);

    if (isBlur) {
      // On blur, save immediately without debounce
      try {
        await this.services.saveConfig(this.services.config)
          .catch(err => this.handleError("Input", err));
        await this.services.broadcastConfigUpdated();

        // Execute onupdate commands if defined
        if (this.item.onupdate && Array.isArray(this.item.onupdate)) {
          await this.executeOnUpdate(this.item.onupdate, "InputOnUpdate");
        }

        // Resolve dependent variables
        const dependentVars = this.services.getDependentVariables(this.page.variables, [this.item.var]);
        if (dependentVars.size > 0) {
          const onVariableResolved = (varName, value) => {
            this.page._resolved[varName] = value;
            this.services.updateRenderedValue(varName, value);
          };
          await this.services.resolveVariables(
            this.page.variables,
            this.services.globalVariables,
            onVariableResolved,
            dependentVars
          );
        }
      } catch (err) {
        this.handleError('Input', err);
      }
    } else if (this.item.onupdate && Array.isArray(this.item.onupdate)) {
      // On input/change, debounce the onupdate execution
      clearTimeout(this.updateTimer);
      this.updateTimer = setTimeout(async () => {
        try {
          await this.services.saveConfig(this.services.config)
            .catch(err => this.handleError("Input", err));
          await this.services.broadcastConfigUpdated();

          // Execute onupdate commands
          await this.executeOnUpdate(this.item.onupdate, "InputOnUpdate");

          // Resolve dependent variables
          const dependentVars = this.services.getDependentVariables(this.page.variables, [this.item.var]);
          if (dependentVars.size > 0) {
            const onVariableResolved = (varName, value) => {
              this.page._resolved[varName] = value;
              this.services.updateRenderedValue(varName, value);
            };
            await this.services.resolveVariables(
              this.page.variables,
              this.services.globalVariables,
              onVariableResolved,
              dependentVars
            );
          }
        } catch (err) {
          this.handleError('Input', err);
        }
      }, 500);
    }
  }

  /**
   * Clean up timers
   */
  cleanup() {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    if (this.onUpdateDebounced) {
      this.onUpdateDebounced.cancel();
    }
  }
}

