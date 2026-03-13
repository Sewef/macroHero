/**
 * Title Component
 * Renders section titles
 */

import { UIComponent } from "./UIComponent.js";

export class TitleComponent extends UIComponent {
  render() {
    const title = this.createElement("h3", "mh-layout-title");
    this.applyColor(title);

    if (!this.services.evaluateAndSetElementText(title, this.item, this.page)) {
      title.textContent = this.item.text ?? "";
    }

    return title;
  }
}
