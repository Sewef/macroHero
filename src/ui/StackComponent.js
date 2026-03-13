/**
 * Stack Component
 * Renders vertical stack layouts with compact children
 */

import { UIComponent } from "./UIComponent.js";

export class StackComponent extends UIComponent {
  render() {
    const container = this.createElement("div", "mh-layout-stack");

    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';
    container.style.flex = this.item.flex || '1 1 0';
    container.style.minWidth = '0';
    container.style.alignItems = 'stretch';

    if (this.item.border) {
      container.style.border = '1px solid var(--mh-accent)';
      container.style.borderRadius = '4px';
      container.style.padding = '8px';
    }

    this.applyColor(container);

    if (this.item.children && Array.isArray(this.item.children)) {
      this.item.children.forEach((child) => {
        // Use renderElement from services with inStack flag for value/input/counter types
        const inStackMode = ['value', 'input', 'counter'].includes(child.type);
        const element = this.services.renderElement(child.type, child, this.page, inStackMode);
        
        if (element) {
          element.style.width = '100%';
          element.style.boxSizing = 'border-box';
          element.classList.add('mh-stack-compact');
          
          if (child.type === 'value') {
            element.classList.add('mh-stack-horizontal-value');
          }
          
          container.appendChild(element);
        }
      });
    }

    return container;
  }
}
