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
      await this.handleCheckboxChange(toggleInput);
    });

    // Make the full element clickable (not only the switch/text)
    this.addEventListener(container, "click", e => {
      if (e.target.closest('input, label, button, a, textarea, select')) return;
      toggleInput.click();
    });

    wrapper.appendChild(switchEl);
    wrapper.appendChild(labelText);
    container.appendChild(wrapper);

    return container;
  }

  /**
   * Handle checkbox change event (reused from CheckboxComponent logic)
   */
  async handleCheckboxChange(checkboxElement) {
    try {
      const newValue = checkboxElement.checked;
      await this.commitVariableChange(this.item.var, newValue, {
        componentName: "Toggle",
        onupdateCommands: this.item.onupdate,
      });
    } catch (error) {
      this.handleError('ToggleComponent.handleCheckboxChange', error);
    }
  }
}
