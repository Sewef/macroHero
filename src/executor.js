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
import { createDebugLogger } from "./debugMode.js";

const logger = createDebugLogger('executor');

function buildResolvedContext(page, pageIndex = 0, globalVariables = {}) {
  const storeResolved = variableStore.getAllResolvedVariables(pageIndex) || {};
  return {
    ...globalVariables,
    ...storeResolved,
    ...(page?._resolved || {}),
  };
}

/**
 * Handle button click - simplified flow with new architecture
 */
export async function handleButtonClick(commands, page, globalVariables = {}, onVariableResolved = null, pageIndex = 0) {
  if (!Array.isArray(commands) || commands.length === 0) {
    logger.warn("No commands provided");
    return;
  }

  try {
    logger.log("Button clicked, executing commands");

    if (pageIndex === undefined || pageIndex === null) pageIndex = 0;
    if (!page._modifiedVars) page._modifiedVars = new Set();

    // Step 1: Find variables USED in commands
    const usedVars = variableEngine.getVariablesUsedInCommands(commands);
    logger.log("Variables used in commands");

    // Step 2: Resolve ONLY variables that are used and not yet resolved
    const varsToResolveBeforeCmd = new Set();
    for (const varName of usedVars) {
      if (varName in (page.variables || {}) && !(varName in (page._resolved || {}))) {
        varsToResolveBeforeCmd.add(varName);
      }
    }

    if (varsToResolveBeforeCmd.size > 0) {
      logger.log("Pre-resolving variables");
      const baseResolved = buildResolvedContext(page, pageIndex, globalVariables);
      const preResolved = await variableEngine.resolveVariables(
        page.variables,
        baseResolved,
        varsToResolveBeforeCmd
      );
      page._resolved = { ...page._resolved, ...preResolved };
    }

    // Step 3: Build execution context with helpers
    const executionContext = {
      integrations: getExpressionContext(),
      variables: buildResolvedContext(page, pageIndex, globalVariables),
      helpers: createHelperFunctions(page, pageIndex, globalVariables),
    };

    // Step 4: Execute commands
    const script = Array.isArray(commands) ? commands.join('\n') : commands;
    logger.log("Executing script");

    await executionSandbox.executeCommand(script, executionContext);

    // Step 5: Find variables AFFECTED by commands
    const affectedVars = variableEngine.getAffectedVariables(commands, page.variables);
    
    if (page._modifiedVars.size > 0) {
      for (const modVar of page._modifiedVars) {
        affectedVars.add(modVar);
      }
    }

    logger.log("Affected variables detected");

    // Step 6: Re-resolve affected variables and their dependents
    if (affectedVars.size > 0) {
      const allAffected = variableEngine.getDependentVariables(page.variables, affectedVars);
      logger.log("Re-resolving affected variables");

      const postBaseResolved = buildResolvedContext(page, pageIndex, globalVariables);
      const postResolved = await variableEngine.resolveVariables(
        page.variables,
        postBaseResolved,
        allAffected
      );

      // Update store and UI for each resolved variable
      for (const [varName, value] of Object.entries(postResolved)) {
        if (allAffected.has(varName)) {
          page._resolved[varName] = value;
          variableStore.setVariableResolved(varName, value, pageIndex);
          updateRenderedValue(varName, value);

          if (onVariableResolved) {
            onVariableResolved(varName, value);
          }
        }
      }
    }

    page._modifiedVars = new Set();
    eventBus.emit('executor:commandsCompleted', { commands, page, affected: affectedVars });
    logger.log("Execution complete");
  } catch (error) {
    logger.error('Button action failed:', error);
    eventBus.emit('executor:commandsFailed', { error });
    throw error;
  }
}

/**
 * Create helper functions available in command context
 * Uses VariableStore for centralized state management
 */
function createHelperFunctions(page, pageIndex = 0, globalVariables = {}) {
  const applyResolvedUpdate = (varName, value) => {
    page._resolved[varName] = value;
    variableStore.setVariableResolved(varName, value, pageIndex);
    updateRenderedValue(varName, value);
  };

  const resolveDependents = async (changedVarName) => {
    const dependentVars = variableEngine.getDependentVariables(page.variables, [changedVarName]);
    dependentVars.delete(changedVarName);

    if (dependentVars.size === 0) {
      return;
    }

    logger.log("Re-resolving dependent variables");
    const baseResolved = buildResolvedContext(page, pageIndex, globalVariables);
    const resolvedDeps = await variableEngine.resolveVariables(page.variables, baseResolved, dependentVars);

    for (const depVarName of dependentVars) {
      const depValue = resolvedDeps[depVarName];
      applyResolvedUpdate(depVarName, depValue);
      logger.log('Updated dependent variable:', depVarName, '=', depValue);
    }
  };

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
      
      // Update resolved value and notify all listeners (Counter, EventBus, ui.js)
      applyResolvedUpdate(varName, newValue);
      variableStore.markVariableModified(varName);

      // Persist to storage
      await updateEvaluatedVariable(pageIndex, varName, newValue);

      logger.log('Set value:', varName, '=', newValue);

      await resolveDependents(varName);
      
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
      
      // Update resolved value and notify all listeners (Counter, EventBus, ui.js)
      applyResolvedUpdate(varName, newValue);
      variableStore.markVariableModified(varName);

      // Persist to storage
      await updateEvaluatedVariable(pageIndex, varName, newValue);

      logger.log('Add value:', varName, '+=', delta, '=>', newValue);

      await resolveDependents(varName);
      
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
    helpers: createHelperFunctions(page, page?._pageIndex ?? 0, {}),
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
      logger.error('Command failed:', error);
    return [{ ok: false, error: error.message }];
  }
}

export default {
  executeCommand,
  executeCommands,
  handleButtonClick,
};
