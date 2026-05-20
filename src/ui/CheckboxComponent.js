/**
 * Checkbox Component
 * Renders checkbox inputs with variable management
 */

import { UIComponent } from "./UIComponent.js";


export class CheckboxComponent extends UIComponent {
  render() {
    const container = this.createElement("div", "mh-layout-checkbox");
    this.applyColor(container);

    const variable = this.getVariable(this.item.var);
    if (!variable) {
      container.innerHTML = `<div class="mh-value-error">Variable not found: ${this.item.var}</div>`;
      return container;
    }

    // Create checkbox label wrapper
    const label = this.createElement("label", "mh-checkbox-label");

    // Create checkbox input
    const checkbox = this.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "mh-checkbox-field";
    
    this.registerCheckboxElement(this.item.var, checkbox);

    const currentValue = this.getResolvedValue(this.item.var, variable.value ?? false);
    checkbox.checked = Boolean(currentValue);
    
    // Handle checkbox changes
    this.addEventListener(checkbox, "change", async () => {
      await this.handleCheckboxChange(checkbox);
    });

    // Make the full element clickable (not only the checkbox/text)
    this.addEventListener(container, "click", e => {
      if (e.target.closest('input, label, button, a, textarea, select')) return;
      checkbox.click();
    });

    // Create label text
    const text = this.createElement("span");
    if (!this.services.evaluateAndSetElementText(text, this.item, this.page)) {
      text.textContent = this.item.label ?? this.item.var;
    }

    // Assemble label and container
    label.appendChild(checkbox);
    label.appendChild(text);
    container.appendChild(label);
    return container;
  }

  /**
   * Handle checkbox change
   * @param {HTMLElement} checkbox - Checkbox element
   */
  async handleCheckboxChange(checkbox) {
    const newValue = checkbox.checked;

    try {
      await this.commitVariableChange(this.item.var, newValue, {
        componentName: "Checkbox",
        onupdateCommands: this.item.onupdate,
      });
    } catch (err) {
      this.handleError('Checkbox', err);
    }
  }
}

