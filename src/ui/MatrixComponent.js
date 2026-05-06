/**
 * Matrix Component
 * Renders a grid of small square buttons (like an MMO spell bar)
 * Each button can display text, icons, or tooltips
 */

import { UIComponent } from "./UIComponent.js";

export class MatrixComponent extends UIComponent {
  render() {
    const matrix = this.createElement("div", "mh-layout-matrix");
    
    // Apply grid styling (dynamic values stay inline)
    const cols = this.item.columns || 4;
    const buttonSize = this.item.buttonSize || "40px";
    const gap = this.item.gap || "4px";
    const isRect = this.item.buttonShape === 'rectangle';
    
    matrix.style.display = 'grid';
    // Rectangle: columns fill available space equally; square: fixed size per column
    matrix.style.gridTemplateColumns = isRect ? `repeat(${cols}, 1fr)` : `repeat(${cols}, ${buttonSize})`;
    if (isRect) matrix.style.gridAutoRows = buttonSize;
    matrix.style.gap = gap;
    if (this.item.flex) matrix.style.flex = this.item.flex;
    this._isRect = isRect;

    if (this.item.border) {
      matrix.classList.add('mh-bordered');
    }

    this.applyColor(matrix);

    // Render buttons
    if (this.item.children && Array.isArray(this.item.children)) {
      this.item.children.forEach((buttonConfig, index) => {
        const btn = this.createMatrixButton(buttonConfig, index);
        if (btn) {
          matrix.appendChild(btn);
        }
      });
    }

    return matrix;
  }

  /**
   * Create a single matrix button
   * @param {Object} buttonConfig - Button configuration
   * @param {number} index - Button index in the matrix
   * @returns {HTMLElement} The button element
   */
  createMatrixButton(buttonConfig, index) {
    const btn = this.createElement("button", "mh-matrix-button");
    if (this._isRect) btn.classList.add('mh-matrix-button--rect');

    // Apply custom color if provided (dynamic — stays inline)
    if (buttonConfig.color) {
      btn.style.backgroundColor = buttonConfig.color;
      btn.style.color = this.getContrastColor(buttonConfig.color);
    }

    // Apply custom border color if provided (dynamic — stays inline)
    if (buttonConfig.borderColor) {
      btn.style.borderColor = buttonConfig.borderColor;
      btn.style.borderWidth = '2px';
    } else if (buttonConfig.color) {
      btn.style.borderColor = buttonConfig.color;
      btn.style.borderWidth = '2px';
    }

    // Handle icon if provided
    if (buttonConfig.icon) {
      // Check if icon is a URL or text/emoji
      if (buttonConfig.icon.startsWith('http') || buttonConfig.icon.includes('.')) {
        const iconImg = this.createElement("img", "mh-matrix-icon-img");
        iconImg.src = buttonConfig.icon;
        btn.appendChild(iconImg);
      } else {
        const icon = this.createElement("span", "mh-matrix-icon");
        icon.textContent = buttonConfig.icon;
        btn.appendChild(icon);
      }
    }

    // Handle label with possible expressions
    if (buttonConfig.label) {
      const labelEl = this.createElement("span", "mh-matrix-label");
      
      if (buttonConfig.label.includes('{')) {
        labelEl.textContent = "";
        this.services.renderedExpressionElements.push({ element: labelEl, item: buttonConfig, page: this.page });
        const resolvedVars = { ...this.services.globalVariables, ...(this.page?._resolved || {}) };
        this.services.evaluateItemText(buttonConfig, resolvedVars)
          .then(res => { labelEl.textContent = res; })
          .catch(err => { this.handleError("MatrixButton", err); });
      } else {
        labelEl.textContent = buttonConfig.label;
      }
      
      btn.appendChild(labelEl);
    }

    // Set tooltip — plain text, ${vars}, or HTML (see UIComponent.applyTooltip)
    UIComponent.applyTooltip(
      btn,
      buttonConfig.tooltip || buttonConfig.label || `Button ${index + 1}`,
      () => ({ ...this.services.globalVariables, ...(this.page?._resolved || {}) })
    );

    // Add click handler if commands exist
    if (buttonConfig.onclick && Array.isArray(buttonConfig.onclick) && buttonConfig.onclick.length > 0) {
      this.addEventListener(btn, "click", async () => {
        await this.executeButtonCommands(btn, buttonConfig);
      });
    } else if (!buttonConfig.onrightclick?.length) {
      btn.disabled = true;
    }

    // Add right-click handler if onrightclick commands exist
    if (buttonConfig.onrightclick && Array.isArray(buttonConfig.onrightclick) && buttonConfig.onrightclick.length > 0) {
      this.addEventListener(btn, "contextmenu", async (event) => {
        event.preventDefault();
        await this.executeButtonCommands(btn, buttonConfig, true);
      });
    }

    return btn;
  }

  /**
   * Execute matrix button commands
   * @param {HTMLElement} btn - Button element
   * @param {Object} buttonConfig - Button configuration
   * @param {boolean} isRightClick - Whether this is a right-click event
   */
  async executeButtonCommands(btn, buttonConfig, isRightClick = false) {
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

      // Choose commands based on click type
      const commands = isRightClick ? buttonConfig.onrightclick : buttonConfig.onclick;

      await this.services.handleButtonClick(
        commands,
        pageObj,
        this.services.globalVariables,
        onVariableResolved,
        this.services.currentPage ?? 0
      );

      await this.services.saveConfig(this.services.config)
        .catch(err => this.handleError("MatrixButton", err));
      await this.services.broadcastConfigUpdated();
    } catch (error) {
      this.handleError("MatrixButton", error);
    } finally {
      btn.disabled = false;
    }
  }

  /**
   * Determine if text should be white or black based on background brightness
   * Uses relative luminance calculation (WCAG)
   * @param {string} hexColor - Hex color string (e.g., '#ff0000' or 'rgb(255,0,0)')
   * @returns {string} 'white' or 'black' for best contrast
   */
  getContrastColor(hexColor) {
    // Parse hex or rgb color to RGB values
    let r, g, b;
    
    if (hexColor.startsWith('#')) {
      // Parse hex color
      const hex = hexColor.replace('#', '');
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    } else if (hexColor.startsWith('rgb')) {
      // Parse rgb/rgba color
      const rgbMatch = hexColor.match(/\d+/g);
      if (rgbMatch && rgbMatch.length >= 3) {
        r = parseInt(rgbMatch[0]);
        g = parseInt(rgbMatch[1]);
        b = parseInt(rgbMatch[2]);
      } else {
        return 'black'; // fallback
      }
    } else {
      return 'black'; // fallback
    }

    // Calculate relative luminance (WCAG formula)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // Return white text for dark backgrounds, black text for light backgrounds
    return luminance > 0.5 ? 'black' : 'white';
  }
}

