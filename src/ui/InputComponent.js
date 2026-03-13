/**
 * Input Component
 * Renders text input fields
 */

import { UIComponent } from "./UIComponent.js";

const debugError = (...args) => console.error(...args);

export class InputComponent extends UIComponent {
  constructor(item, page, services, inStack = false) {
    super(item, page, services);
    this.inStack = inStack;
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
      this.handleInputChange(input, variable);
    });

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
   */
  handleInputChange(input, variable) {
    const newValue = input.value;
    variable.value = newValue;
    delete variable.eval;
    this.setResolvedValue(this.item.var, newValue);
    
    this.services.saveConfig(this.services.config)
      .catch(err => this.handleError("Input", err));
  }
}
