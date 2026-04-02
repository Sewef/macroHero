/**
 * Button Component
 * Renders action buttons with command execution
 */

import { UIComponent } from "./UIComponent.js";

const debugError = (...args) => console.error(...args);

export class ButtonComponent extends UIComponent {
  render() {
    const btn = this.createElement("button", "mh-layout-button");
    this.applyColor(btn);

    // Handle label with possible expressions
    if (this.item.label && this.item.label.includes('{')) {
      btn.textContent = "";
      this.services.renderedExpressionElements.push({ element: btn, item: this.item, page: this.page });
      const resolvedVars = { ...this.services.globalVariables, ...(this.page?._resolved || {}) };
      this.services.evaluateItemText(this.item, resolvedVars)
        .then(res => { btn.textContent = res; })
        .catch(err => { this.handleError("Button", err); });
    } else {
      btn.textContent = this.item.label ?? "Button";
    }

    // Add command handler if onclick commands exist
    if (this.item.onclick && Array.isArray(this.item.onclick) && this.item.onclick.length > 0) {
      this.addEventListener(btn, "click", async () => {
        await this.executeCommands(btn);
      });
      btn.title = this.item.tooltip || this.item.label || "Button";
    } else {
      btn.disabled = true;
      btn.title = this.item.tooltip || this.item.label || "No commands defined";
    }

    return btn;
  }

  /**
   * Execute button commands
   * @param {HTMLElement} btn - Button element
   */
  async executeCommands(btn) {
    btn.disabled = true;
    try {
      const pageObj = (this.services.currentPage !== null && this.services.currentPage !== undefined) 
        ? this.services.findPageByIndex(this.services.currentPage) 
        : this.page;

      const oldResolved = { ...pageObj._resolved };

      const onVariableResolved = (varName, value) => {
        const oldValue = oldResolved[varName];
        if (oldValue !== value) {
          pageObj._resolved[varName] = value;
          this.services.updateRenderedValue(varName, value);
        }
      };

      await this.services.handleButtonClick(
        this.item.onclick,
        pageObj,
        this.services.globalVariables,
        onVariableResolved,
        this.services.currentPage ?? 0
      );

      await this.services.saveConfig(this.services.config)
        .catch(err => this.handleError("Button", err));
      await this.services.broadcastConfigUpdated();
    } catch (error) {
      this.handleError("Button", error);
    } finally {
      btn.disabled = false;
    }
  }
}
