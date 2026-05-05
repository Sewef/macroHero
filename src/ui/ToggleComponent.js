/**
 * Toggle Component
 * Renders a modern toggle switch for boolean values
 * 
 * Usage:
 * ```json
 * {
 *   "type": "toggle",
 *   "var": "isEnabled",
 *   "label": "Enable Feature",
 *   "onupdate": ["console.log('toggled')"]  // optional
 * }
 * ```
 */

import { UIComponent } from "./UIComponent.js";

export class ToggleComponent extends UIComponent {
  render() {
    const container = this.createElement("div", "mh-layout-toggle");
    this.applyColor(container);

    const variable = this.getVariable(this.item.var);
    if (!variable) {
      container.innerHTML = `<div class="mh-value-error">Variable not found: ${this.item.var}</div>`;
      return container;
    }

    // Create toggle wrapper
    const wrapper = this.createElement("label", "mh-toggle-wrapper");

    // Create switch element
    const switchEl = this.createElement("div", "mh-toggle-switch");
    const toggleInput = this.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.className = "mh-toggle-input";

    this.registerCheckboxElement(this.item.var, toggleInput);

    const currentValue = this.getResolvedValue(this.item.var, variable.value ?? false);
    toggleInput.checked = Boolean(currentValue);

    // Create slider
    const slider = this.createElement("span", "mh-toggle-slider");

    switchEl.appendChild(toggleInput);
    switchEl.appendChild(slider);

    // Create label text
    const labelText = this.createElement("span", "mh-toggle-label");
    if (!this.services.evaluateAndSetElementText(labelText, this.item, this.page)) {
      labelText.textContent = this.item.label ?? this.item.var;
    }

    // Handle toggle changes
    this.addEventListener(toggleInput, "change", async () => {
      await this.handleCheckboxChange(toggleInput, variable);
    });

    wrapper.appendChild(switchEl);
    wrapper.appendChild(labelText);
    container.appendChild(wrapper);

    return container;
  }

  /**
   * Handle checkbox change event (reused from CheckboxComponent logic)
   */
  async handleCheckboxChange(checkboxElement, variable) {
    try {
      const newValue = checkboxElement.checked;
      this.setResolvedValue(this.item.var, newValue);

      // Execute onupdate commands if any
      if (this.item.onupdate && Array.isArray(this.item.onupdate)) {
        await this.executeOnUpdate(this.item.onupdate, 'ToggleComponent');
      }
    } catch (error) {
      this.handleError('ToggleComponent.handleCheckboxChange', error);
    }
  }
}
