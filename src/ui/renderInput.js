/**
 * Input Element Renderer
 * Handles rendering text input fields
 */

const debugError = (...args) => console.error(...args);

/**
 * Render a text input field
 */
export function renderInput(item, page, {
  saveConfig,
  evaluateAndSetElementText,
  renderedValueElements
}, inStack = false) {
  const container = document.createElement("div");
  container.className = "mh-layout-input";

  const variable = page.variables?.[item.var];
  if (!variable) {
    container.innerHTML = `<div class="mh-value-error">Variable not found: ${item.var}</div>`;
    return container;
  }

  const label = document.createElement(inStack ? "span" : "label");
  label.className = "mh-input-label";
  
  if (!evaluateAndSetElementText(label, item, page)) {
    label.textContent = inStack ? `${item.label ?? item.var}:` : (item.label ?? item.var);
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "mh-input-field";
  input.placeholder = item.placeholder ?? "Enter value";
  
  const currentValue = (page._resolved && page._resolved[item.var] !== undefined)
    ? page._resolved[item.var]
    : (variable.value ?? variable.eval ?? "");
  input.value = currentValue;

  renderedValueElements[item.var] = container;

  input.onblur = () => {
    const newValue = input.value;
    variable.value = newValue;
    delete variable.eval;
    page._resolved[item.var] = newValue;
    saveConfig(page.config ?? {}).catch(err => debugError("[Input] Error auto-saving config:", err));
  };

  if (inStack) {
    container.style.display = 'flex';
    container.style.flexDirection = 'row';
    container.style.alignItems = 'center';
    container.style.gap = '8px';
    container.appendChild(label);
    container.appendChild(input);
  } else {
    container.appendChild(label);
    container.appendChild(input);
  }
  
  return container;
}
