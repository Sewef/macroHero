/**
 * Value Component
 * Renders read-only variable values with label
 */

import { UIComponent } from "./UIComponent.js";

export class ValueComponent extends UIComponent {
  constructor(item, page, services, inStack = false) {
    super(item, page, services);
    this.inStack = inStack;
  }

  render() {
    const valueDiv = this.createElement("div", "mh-layout-value");
    
    const variable = this.getVariable(this.item.var);
    if (!variable) {
      valueDiv.innerHTML = `<div class="mh-value-label">${this.item.label ?? this.item.var}</div><div class="mh-value-error">Variable not found: ${this.item.var}</div>`;
      return valueDiv;
    }

    // Get resolved value and apply constraints
    let resolvedValue = this.getResolvedValue(this.item.var);
    if (typeof resolvedValue === 'number') {
      resolvedValue = this.applyConstraints(resolvedValue, variable);
      this.setResolvedValue(this.item.var, resolvedValue);
    }

    // Create label
    const isLoading = !(this.item.var in (this.page._resolved || {}));
    const displayValue = isLoading ? '' : (resolvedValue ?? 'N/A');

    const labelEl = this.createElement(this.inStack ? "span" : "div", "mh-value-label");
    
    if (!this.services.evaluateAndSetElementText(labelEl, this.item, this.page)) {
      labelEl.textContent = (this.item.label ?? this.item.var) + (this.inStack ? ":" : "");
    }

    // Create content element
    const contentEl = this.createElement("span", `mh-value-content ${isLoading ? 'mh-loading' : ''}`);
    contentEl.textContent = displayValue;

    // Assemble based on stack mode
    if (this.inStack) {
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

    this.services.renderedValueElements[this.item.var] = valueDiv;
    return valueDiv;
  }

  /**
   * Apply min/max constraints to a value
   * @param {number} value - Value to constrain
   * @param {Object} variable - Variable object
   * @returns {number} Constrained value
   */
  applyConstraints(value, variable) {
    let constrained = value;
    if (variable.min !== undefined && constrained < variable.min) {
      constrained = variable.min;
    }
    if (variable.max !== undefined && constrained > variable.max) {
      constrained = variable.max;
    }
    return constrained;
  }
}
