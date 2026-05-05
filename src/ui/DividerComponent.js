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

    // Apply custom height if specified
    if (this.item.height) {
      divider.style.height = this.item.height;
    }

    // Apply custom margin if specified
    if (this.item.margin) {
      divider.style.margin = this.item.margin;
    }

    // Apply custom color (overrides gradient)
    if (this.item.color) {
      divider.style.background = this.item.color;
      divider.style.removeProperty('background'); // Remove gradient
      divider.style.backgroundColor = this.item.color;
    }

    // Apply custom line style if specified
    if (this.item.style) {
      divider.style.borderTop = `${this.item.height || '1px'} ${this.item.style} ${this.item.color || 'var(--mh-accent)'}`;
      divider.style.background = 'none';
      divider.style.height = 'auto';
    }

    return divider;
  }
}
