/**
 * Stack Element Renderer
 * Handles rendering vertical stack layouts with compact children
 */

/**
 * Render a vertical stack with child elements
 */
export function renderStack(item, page, {
  renderValue,
  renderInputElement,
  renderCounterElement,
  renderLayoutElement
}) {
  const container = document.createElement("div");
  container.className = "mh-layout-stack";
  container.style.margin = '12px 0';

  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '8px';

  container.style.flex = item.flex || '1 1 0';
  container.style.minWidth = '0';
  container.style.alignItems = 'stretch';

  if (item.children && Array.isArray(item.children)) {
    item.children.forEach((child) => {
        let element;
        
        if (child.type === 'value') {
          element = renderValue(child, page, true);
        } else if (child.type === 'input') {
          element = renderInputElement(child, page, true);
        } else if (child.type === 'counter') {
          element = renderCounterElement(child, page, true);
        } else {
          element = renderLayoutElement(child, page);
        }
        
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
