/**
 * Stack Component
 * Renders vertical stack layouts with compact children
 */

import { UIComponent } from "./UIComponent.js";

export class StackComponent extends UIComponent {
  render() {
    const container = this.createElement("div", "mh-layout-stack");

    // Only override flex when explicitly specified in config
    if (this.item.flex) container.style.flex = this.item.flex;

    if (this.item.border) {
      container.classList.add('mh-layout-stack--bordered');
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
