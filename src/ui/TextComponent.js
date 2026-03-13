/**
 * Text Component
 * Renders text/content blocks
 */

import { UIComponent } from "./UIComponent.js";

export class TextComponent extends UIComponent {
  render() {
    const text = this.createElement("div", "mh-layout-text");

    if (!this.services.evaluateAndSetElementText(text, this.item, this.page)) {
      text.textContent = this.item.content ?? this.item.text ?? "";
    }

    return text;
  }
}
