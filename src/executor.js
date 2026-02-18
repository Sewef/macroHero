/**
 * Command Executor - REFACTORED to use VariableEngine and ExecutionSandbox
 * 
 * Simplified execution flow:
 * 1. Resolve variables used in commands
 * 2. Execute commands in sandbox
 * 3. Re-resolve affected variables
 * 4. Done
 */

import { variableEngine } from "./engines/VariableEngine.js";
import { executionSandbox } from "./engines/ExecutionSandbox.js";
import { eventBus } from "./events/EventBus.js";
import { variableStore } from "./stores/VariableStore.js";
import { updateRenderedValue } from "./ui.js";
import { updateEvaluatedVariable } from "./storage.js";
import { getExpressionContext } from "./expressionHelpers.js";
import { isDebugEnabled } from "./debugMode.js";

const debugLog = (...args) => isDebugEnabled('executor') && console.log(...args);
const debugWarn = (...args) => console.warn(...args);
const debugError = (...args) => console.error(...args);

/**
 * Handle button click - simplified flow with new architecture
 */
export async function handleButtonClick(commands, page, globalVariables = {}, onVariableResolved = null) {
  if (!Array.isArray(commands) || commands.length === 0) {
    debugWarn("[EXECUTOR] No commands");
    return;
  }

  try {
    debugLog("[EXECUTOR] Button clicked, executing", commands.length, "command(s)");

    const pageIndex = page?._pageIndex ?? 0;
    if (!page._modifiedVars) page._modifiedVars = new Set();

    // Step 1: Find variables USED in commands
    const usedVars = variableEngine.getVariablesUsedInCommands(commands);
    debugLog("[EXECUTOR] Variables used in commands:", Array.from(usedVars));

    // Step 2: Resolve ONLY variables that are used and not yet resolved
    const varsToResolveBeforeCmd = new Set();
    for (const varName of usedVars) {
      if (varName in (page.variables || {}) && !(varName in (page._resolved || {}))) {
        varsToResolveBeforeCmd.add(varName);
      }
    }

    if (varsToResolveBeforeCmd.size > 0) {
      debugLog('[EXECUTOR] Pre-resolving', varsToResolveBeforeCmd.size, 'variables');
      const preResolved = await variableEngine.resolveVariables(
        page.variables,
        page._resolved || {},
        varsToResolveBeforeCmd
      );
      page._resolved = { ...page._resolved, ...preResolved };
    }

    // Step 3: Build execution context with helpers
    const executionContext = {
      integrations: getExpressionContext(),
      variables: page._resolved,
      helpers: createHelperFunctions(page, pageIndex),
    };

    // Step 4: Execute commands
    const script = Array.isArray(commands) ? commands.join('\n') : commands;
    debugLog('[EXECUTOR] Executing script');

    await executionSandbox.executeCommand(script, executionContext);

    // Step 5: Find variables AFFECTED by commands
    const affectedVars = variableEngine.getAffectedVariables(commands, page.variables);
    
    if (page._modifiedVars.size > 0) {
      for (const modVar of page._modifiedVars) {
        affectedVars.add(modVar);
      }
    }

    debugLog('[EXECUTOR] Affected variables:', Array.from(affectedVars));

    // Step 6: Re-resolve affected variables and their dependents
    if (affectedVars.size > 0) {
      const allAffected = variableEngine.getDependentVariables(page.variables, affectedVars);
      debugLog('[EXECUTOR] Re-resolving', allAffected.size, 'variables (including dependents)');

      const postResolved = await variableEngine.resolveVariables(
        page.variables,
        page._resolved,
        allAffected
      );

      // Update store and UI for each resolved variable
      for (const [varName, value] of Object.entries(postResolved)) {
        if (allAffected.has(varName)) {
          page._resolved[varName] = value;
          updateRenderedValue(varName, value);

          if (onVariableResolved) {
            onVariableResolved(varName, value);
          }
        }
      }
    }

    page._modifiedVars = new Set();
    eventBus.emit('executor:commandsCompleted', { commands, page, affected: affectedVars });
    debugLog('[EXECUTOR] Complete');
  } catch (error) {
    debugError('[EXECUTOR] Button action failed:', error);
    eventBus.emit('executor:commandsFailed', { error });
    throw error;
  }
}

/**
 * Create helper functions available in command context
 * Uses VariableStore and EventBus for centralized state management
 */
function createHelperFunctions(page, pageIndex) {
  return {
    setValue: async (varName, value) => {
      if (!page.variables || !(varName in page.variables)) {
        throw new Error(`Variable "${varName}" not found`);
      }

      const variable = page.variables[varName];
      let newValue = value;

      // Apply constraints
      if (variable.min !== undefined && newValue < variable.min) newValue = variable.min;
      if (variable.max !== undefined && newValue > variable.max) newValue = variable.max;

      // Update variable definition directly in page
      variable.value = newValue;
      delete variable.eval;

      // Update resolved value and emit event (ui.js listeners will handle UI updates)
      variableStore.setVariableResolved(varName, newValue, pageIndex);
      variableStore.markVariableModified(varName);

      // Persist to storage
      await updateEvaluatedVariable(pageIndex, varName, newValue);

      debugLog('[setValue]', varName, '=', newValue);
      return newValue;
    },

    addValue: async (varName, delta) => {
      if (!page.variables || !(varName in page.variables)) {
        throw new Error(`Variable "${varName}" not found`);
      }

      const variable = page.variables[varName];
      const currentValue = Number(variableStore.getVariableResolved(varName, pageIndex) ?? page._resolved[varName]) || 0;
      let newValue = currentValue + Number(delta);

      // Apply constraints
      if (variable.min !== undefined && newValue < variable.min) newValue = variable.min;
      if (variable.max !== undefined && newValue > variable.max) newValue = variable.max;

      // Update variable definition directly in page
      variable.value = newValue;
      delete variable.eval;

      // Update resolved value and emit event (ui.js listeners will handle UI updates)
      variableStore.setVariableResolved(varName, newValue, pageIndex);
      variableStore.markVariableModified(varName);

      // Persist to storage
      await updateEvaluatedVariable(pageIndex, varName, newValue);

      debugLog('[addValue]', varName, '+=', delta, '=>', newValue);
      return newValue;
    },
  };
}

/**
 * Legacy wrapper for backwards compatibility
 */
export async function executeCommand(command, page) {
  const script = Array.isArray(command) ? command.join('\n') : command;
  const context = {
    variables: page?._resolved || {},
    helpers: createHelperFunctions(page, page?._pageIndex ?? 0),
  };
  return executionSandbox.executeCommand(script, context);
}

/**
 * Legacy wrapper for backwards compatibility
 */
export async function executeCommands(commands, page) {
  try {
    await executeCommand(commands, page);
    return [{ ok: true }];
  } catch (error) {
    debugError('[EXECUTOR] Command failed:', error);
    return [{ ok: false, error: error.message }];
  }
}

export default {
  executeCommand,
  executeCommands,
  handleButtonClick,
};
