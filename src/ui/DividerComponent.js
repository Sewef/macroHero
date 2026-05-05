/**
 * Divider Component
 * Renders a visual separator line
 * 
 * Usage:
 * ```json
 * {
 *   "type": "divider",
 *   "color": "#c8adff",      // Optional: override color
 *   "height": "2px",         // Optional: line height (default 1px)
 *   "margin": "16px",        // Optional: spacing above/below (default 12px)
 *   "style": "solid|dashed|dotted"  // Optional: line style
 * }
 * ```
 */

import { UIComponent } from "./UIComponent.js";

export class DividerComponent extends UIComponent {
  render() {
    const divider = this.createElement("div", "mh-layout-divider");

    // If any customization is applied, remove the default CSS class
    const hasCustomization = this.item.color || this.item.height || this.item.margin || this.item.style;
    if (hasCustomization) {
      divider.classList.remove("mh-layout-divider");
      // Apply default margin if not customized
      divider.style.margin = this.item.margin || "var(--spacing-md) 0";
    }

    // Apply custom height if specified
    if (this.item.height) {
      divider.style.height = this.item.height;
    }

    // Apply custom margin if specified
    if (this.item.margin) {
      divider.style.margin = this.item.margin;
    }

    // Apply custom line style if specified (takes precedence over color)
    if (this.item.style) {
      divider.style.borderTop = `${this.item.height || '1px'} ${this.item.style} ${this.item.color || 'var(--mh-accent)'}`;
      divider.style.background = 'none';
      divider.style.height = 'auto';
    } else if (this.item.color) {
      // Apply custom color (only if no custom style)
      divider.style.background = this.item.color;
      divider.style.height = this.item.height || '1px';
    }

    return divider;
  }
}
