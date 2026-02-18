/**
 * Text Element Renderer
 * Handles rendering text/content blocks
 */

/**
 * Render a text/content block
 */
export function renderText(item, page, {
  evaluateAndSetElementText
}) {
  const text = document.createElement("div");
  text.className = "mh-layout-text";

  if (!evaluateAndSetElementText(text, item, page)) {
    text.textContent = item.content ?? item.text ?? "";
  }

  return text;
}
