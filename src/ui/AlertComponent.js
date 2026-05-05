/**
 * Alert Component
 * Renders alert/notification messages with different types (info, warning, success, error)
 */

import { UIComponent } from "./UIComponent.js";

export class AlertComponent extends UIComponent {
  render() {
    const type = (this.item.type || 'alert').toLowerCase();
    const alertType = ['info', 'warning', 'success', 'error'].includes(this.item.alert?.toLowerCase())
      ? this.item.alert.toLowerCase()
      : 'info';

    const container = this.createElement("div", `mh-layout-alert mh-alert-${alertType}`);

    // Icon based on alert type
    const iconMap = {
      info: 'ℹ️',
      warning: '⚠️',
      success: '✓',
      error: '❌'
    };

    // Create icon
    const icon = this.createElement("span", "mh-alert-icon");
    icon.textContent = iconMap[alertType] || 'ℹ️';
    container.appendChild(icon);

    // Create content area
    const content = this.createElement("div", "mh-alert-content");

    // Create title if provided
    if (this.item.title) {
      const title = this.createElement("div", "mh-alert-title");
      if (!this.services.evaluateAndSetElementText(title, { text: this.item.title }, this.page)) {
        title.textContent = this.item.title;
      }
      content.appendChild(title);
    }

    // Create message
    const message = this.createElement("div", "mh-alert-message");
    if (!this.services.evaluateAndSetElementText(message, this.item, this.page)) {
      message.textContent = this.item.text || this.item.message || 'Alert message';
    }
    content.appendChild(message);

    container.appendChild(content);
    return container;
  }
}
