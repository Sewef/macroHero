/**
 * Title Element Renderer
 * Handles rendering section titles
 */

/**
 * Render a section title
 */
export function renderTitle(item, page, {
  evaluateAndSetElementText
}) {
  const title = document.createElement("h3");
  title.className = "mh-layout-title";

  if (!evaluateAndSetElementText(title, item, page)) {
    title.textContent = item.text ?? "";
  }

  return title;
}
