/**
 * Dropdown Component
 * Renders dropdown/select inputs
 */

import { UIComponent } from "./UIComponent.js";


export class DropdownComponent extends UIComponent {
  render() {
    const container = this.createElement("div", "mh-layout-dropdown");

    const variable = this.getVariable(this.item.var);
    if (!variable) {
      container.innerHTML = `<div class="mh-value-error">Variable not found: ${this.item.var}</div>`;
      return container;
    }

    // Create label
    const label = this.createElement("label", "mh-dropdown-label");
    
    if (!this.services.evaluateAndSetElementText(label, this.item, this.page)) {
      label.textContent = this.item.label ?? this.item.var;
    }

    // Create select element
    const select = this.createElement("select");
    select.className = "mh-dropdown-select";

    // Get options from item.options or optionsVar
    let options = this.getOptions();
    
    if (options.length === 0) {
      const defaultOption = document.createElement("option");
      defaultOption.textContent = "No options available";
      defaultOption.disabled = true;
      select.appendChild(defaultOption);
    } else {
      options.forEach(opt => {
        const option = document.createElement("option");
        if (typeof opt === 'string') {
          option.value = opt;
          option.textContent = opt;
        } else {
          option.value = opt.value ?? opt.label ?? '';
          option.textContent = opt.label ?? opt.value ?? '';
        }
        select.appendChild(option);
      });
    }

    // Set current value
    const currentValue = this.getResolvedValue(this.item.var, variable.value ?? '');
    select.value = currentValue;

    this.registerElement(this.item.var, container);

    // Handle changes
    this.addEventListener(select, "change", async () => {
      await this.handleSelectChange(select);
    });

    container.appendChild(label);
    container.appendChild(select);
    return container;
  }

  /**
   * Get options for dropdown
   * @returns {Array} Options array
   */
  getOptions() {
    let options = this.item.options ?? [];
    
    // If optionsVar is specified, use variable containing array
    if (this.item.optionsVar) {
      const optionsVariable = this.getVariable(this.item.optionsVar);
      if (optionsVariable) {
        const optionsValue = this.getResolvedValue(this.item.optionsVar);
        if (Array.isArray(optionsValue)) {
          options = optionsValue;
        } else {
          logger.warn(`[UI] optionsVar "${this.item.optionsVar}" is not an array`);
          options = [];
        }
      } else {
        logger.warn(`[UI] optionsVar "${this.item.optionsVar}" not found`);
        options = [];
      }
    }
    
    return options;
  }

  /**
   * Handle select value change
   * @param {HTMLElement} select - Select element
   */
  async handleSelectChange(select) {
    const newValue = select.value;

    try {
      await this.commitVariableChange(this.item.var, newValue, {
        componentName: "Dropdown",
        onupdateCommands: this.item.onupdate,
      });
    } catch (err) {
      this.handleError('Dropdown', err);
    }
  }
}

