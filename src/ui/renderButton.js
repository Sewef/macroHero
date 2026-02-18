/**
 * Button Element Renderer
 * Handles rendering action buttons
 */

const debugError = (...args) => console.error(...args);

/**
 * Render an action button with commands
 */
export function renderButton(item, page, {
  saveConfig,
  broadcastConfigUpdated,
  handleButtonClick,
  findPageByIndex,
  updateRenderedValue,
  evaluateItemText,
  globalVariables,
  renderedExpressionElements,
  currentPage,
  config
}) {
  const btn = document.createElement("button");
  btn.className = "mh-layout-button";

  if (item.label && item.label.includes('{')) {
    btn.textContent = "";
    renderedExpressionElements.push({ element: btn, item, page });
    const resolvedVars = { ...globalVariables, ...(page? (page._resolved || {}) : {}) };
    evaluateItemText(item, resolvedVars)
      .then(res => { btn.textContent = res; })
      .catch(err => { debugError('[Button] Error evaluating:', err); });
  } else {
    btn.textContent = item.label ?? "Button";
  }

  if (item.commands && Array.isArray(item.commands) && item.commands.length > 0) {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const pageObj = (currentPage !== null && currentPage !== undefined) ? findPageByIndex(currentPage) : page;
        
        const oldResolved = { ...pageObj._resolved };
        
        const onVariableResolved = (varName, value) => {
          const oldValue = oldResolved[varName];
          if (oldValue !== value) {
            pageObj._resolved[varName] = value;
            updateRenderedValue(varName, value);
          }
        };
        
        await handleButtonClick(item.commands, pageObj, globalVariables, onVariableResolved);
        
        await saveConfig(config).catch(err => debugError("[Button] Error auto-saving config:", err));
        await broadcastConfigUpdated();
      } catch (error) {
        debugError("[Button] Action error:", error);
      } finally {
        btn.disabled = false;
      }
    };
    btn.title = `${item.commands.length} command(s)`;
  } else {
    btn.disabled = true;
    btn.title = "No commands defined";
  }

  return btn;
}
