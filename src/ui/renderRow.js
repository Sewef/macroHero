/**
 * Row Element Renderer
 * Handles rendering horizontal row layouts
 */

/**
 * Render a row with child elements
 */
export function renderRow(item, page, {
  renderLayoutElement
}) {
  const row = document.createElement("div");
  row.className = "mh-layout-row";

  if (item.children && Array.isArray(item.children)) {
    const frag = document.createDocumentFragment();
    item.children.forEach(child => {
      const element = renderLayoutElement(child, page);
      if (element) {
        frag.appendChild(element);
      }
    });
    row.appendChild(frag);
  }

  return row;
}
