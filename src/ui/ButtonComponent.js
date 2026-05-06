/**
 * Button Component
 * Renders action buttons with command execution
 */

import { UIComponent } from "./UIComponent.js";


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
    const hasOnclick = this.item.onclick && Array.isArray(this.item.onclick) && this.item.onclick.length > 0;
    const hasOnrightclick = this.item.onrightclick && Array.isArray(this.item.onrightclick) && this.item.onrightclick.length > 0;
    if (hasOnclick) {
      this.addEventListener(btn, "click", async () => {
        await this.executeCommands(btn);
      });
    } else if (!hasOnrightclick) {
      btn.disabled = true;
    }

    // Set tooltip — plain text, ${vars}, or HTML (see UIComponent.applyTooltip)
    UIComponent.applyTooltip(
      btn,
      this.item.tooltip || this.item.label || (hasOnclick ? 'Button' : 'No commands defined'),
      () => ({ ...this.services.globalVariables, ...(this.page?._resolved || {}) })
    );

    // Add right-click handler if onrightclick commands exist
    if (this.item.onrightclick && Array.isArray(this.item.onrightclick) && this.item.onrightclick.length > 0) {
      this.addEventListener(btn, "contextmenu", async (event) => {
        event.preventDefault();
        await this.executeRightClickCommands(btn);
      });
    }

    return btn;
  }

  /**
   * Execute right-click commands
   * @param {HTMLElement} btn - Button element
   */
  async executeRightClickCommands(btn) {
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
        this.item.onrightclick,
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

