/**
 * Checkbox Component
 * Renders checkbox inputs with variable management
 */

import { UIComponent } from "./UIComponent.js";

const debugError = (...args) => console.error(...args);

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
    
    this.services.renderedCheckboxElements[this.item.var] = checkbox;
    
    const currentValue = this.getResolvedValue(this.item.var, variable.value ?? false);
    checkbox.checked = Boolean(currentValue);
    
    // Handle checkbox changes
    this.addEventListener(checkbox, "change", async () => {
      await this.handleCheckboxChange(checkbox, variable);
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
   * @param {Object} variable - Variable object
   */
  async handleCheckboxChange(checkbox, variable) {
    const newValue = checkbox.checked;
    variable.value = newValue;
    delete variable.eval;
    this.setResolvedValue(this.item.var, newValue);

    try {
      await this.services.saveConfig(this.services.config)
        .catch(err => this.handleError("Checkbox", err));
      await this.services.broadcastConfigUpdated();

      // Execute onupdate commands if defined
      if (this.item.onupdate && Array.isArray(this.item.onupdate)) {
        await this.executeOnUpdate(this.item.onupdate, "CheckboxOnUpdate");
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
      this.handleError('Checkbox', err);
    }
  }
}
