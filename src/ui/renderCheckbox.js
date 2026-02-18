/**
 * Checkbox Element Renderer
 * Handles rendering checkbox inputs
 */

const debugError = (...args) => console.error(...args);

/**
 * Render a checkbox input
 */
export function renderCheckbox(item, page, {
  saveConfig,
  broadcastConfigUpdated,
  getDependentVariables,
  resolveVariables,
  updateRenderedValue,
  globalVariables,
  evaluateAndSetElementText,
  renderedCheckboxElements
}) {
  const container = document.createElement("div");
  container.className = "mh-layout-checkbox";

  const variable = page.variables?.[item.var];
  if (!variable) {
    container.innerHTML = `<div class="mh-value-error">Variable not found: ${item.var}</div>`;
    return container;
  }

  const label = document.createElement("label");
  label.className = "mh-checkbox-label";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "mh-checkbox-field";
  
  renderedCheckboxElements[item.var] = checkbox;
  
  const currentValue = page._resolved?.[item.var] ?? variable.value ?? false;
  checkbox.checked = Boolean(currentValue);
  
  checkbox.onchange = async () => {
    const newValue = checkbox.checked;
    variable.value = newValue;
    delete variable.eval;
    page._resolved[item.var] = newValue;

    try {
      await saveConfig(page.config ?? {}).catch(err => debugError("[Checkbox] Error auto-saving config:", err));
      await broadcastConfigUpdated();

      const dependentVars = getDependentVariables(page.variables, [item.var]);
      if (dependentVars.size > 0) {
        const onVariableResolved = (varName, value) => {
          page._resolved[varName] = value;
          updateRenderedValue(varName, value);
        };
        await resolveVariables(page.variables, globalVariables, onVariableResolved, dependentVars);
      }
    } catch (err) {
      debugError('[Checkbox] Error handling change:', err);
    }
  };

  const text = document.createElement("span");
  if (!evaluateAndSetElementText(text, item, page)) {
    text.textContent = item.label ?? item.var;
  }

  label.appendChild(checkbox);
  label.appendChild(text);
  container.appendChild(label);
  return container;
}
