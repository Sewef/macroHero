/**
 * Row Component
 * Renders horizontal row layouts with child elements
 */

import { UIComponent } from "./UIComponent.js";

export class RowComponent extends UIComponent {
  render() {
    const row = this.createElement("div", "mh-layout-row");

    if (this.item.children && Array.isArray(this.item.children)) {
      const frag = document.createDocumentFragment();
      this.item.children.forEach(child => {
        const element = this.services.renderLayoutElement(child, this.page);
        if (element) {
          frag.appendChild(element);
        }
      });
      row.appendChild(frag);
    }

    return row;
  }
}
