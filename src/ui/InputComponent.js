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

    this.registerElement(this.item.var, container);

    // Handle value changes
    this.addEventListener(input, "blur", () => {
      this.handleInputChange(input, true);
    });

    // For onupdate, listen to input/change events with debounce
    if (this.item.onupdate && Array.isArray(this.item.onupdate)) {
      this.addEventListener(input, "input", () => {
        this.handleInputChange(input, false);
      });
      this.addEventListener(input, "change", () => {
        this.handleInputChange(input, false);
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
   * @param {boolean} isBlur - Whether this was called from blur event
   */
  async handleInputChange(input, isBlur = true) {
    const newValue = input.value;

    if (isBlur) {
      // On blur, commit immediately without debounce
      try {
        await this.commitVariableChange(this.item.var, newValue, {
          componentName: "Input",
          onupdateCommands: this.item.onupdate,
        });
      } catch (err) {
        this.handleError('Input', err);
      }
    } else if (this.item.onupdate && Array.isArray(this.item.onupdate)) {
      // On input/change, debounce the onupdate execution
      clearTimeout(this.updateTimer);
      this.updateTimer = setTimeout(async () => {
        try {
          await this.commitVariableChange(this.item.var, newValue, {
            componentName: "Input",
            onupdateCommands: this.item.onupdate,
          });
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

