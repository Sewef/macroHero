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

function getVariableScope(page, varName) {
  if (page?.variables && varName in page.variables) {
    return { scope: 'page', variable: page.variables[varName] };
  }
  if (variableStore.globalVariablesConfig && varName in variableStore.globalVariablesConfig) {
    return { scope: 'global', variable: variableStore.globalVariablesConfig[varName] };
  }
  return { scope: null, variable: null };
}

function getCommandMutableVariables(page) {
  return new Set([
    ...Object.keys(variableStore.globalVariablesConfig || {}),
    ...Object.keys(page?.variables || {}),
  ]);
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
    const executionVariables = buildResolvedContext(page, pageIndex, globalVariables);
    const executionContext = {
      integrations: getExpressionContext(),
      variables: executionVariables,
      helpers: createHelperFunctions(page, pageIndex, globalVariables, executionVariables),
    };

    // Step 4: Execute commands
    const script = Array.isArray(commands) ? commands.join('\n') : commands;
    logger.log("Executing script");

    const mutableVars = getCommandMutableVariables(page);
    const beforeCommandValues = new Map();
    for (const varName of mutableVars) {
      beforeCommandValues.set(varName, executionContext.variables[varName]);
    }

    await executionSandbox.executeCommand(script, executionContext);

    const directlyMutatedVars = new Set();
    for (const varName of mutableVars) {
      const beforeValue = beforeCommandValues.get(varName);
      const afterValue = executionContext.variables[varName];
      if (!Object.is(beforeValue, afterValue)) {
        await applyVariableChange(page, pageIndex, globalVariables, varName, afterValue, {
          persist: false,
          resolveDependents: false,
        });
        directlyMutatedVars.add(varName);
      }
    }

    // Step 5: Find variables AFFECTED by commands
    const affectedVars = variableEngine.getAffectedVariables(commands, page.variables);
    for (const varName of directlyMutatedVars) {
      if (page.variables && varName in page.variables) {
        affectedVars.add(varName);
      }
    }
    
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
          updateRenderedValue(varName, value, pageIndex);

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
async function applyVariableChange(page, pageIndex = 0, globalVariables = {}, varName, value, options = {}) {
  const {
    persist = true,
    resolveDependents: shouldResolveDependents = true,
    runtimeVariables = null,
  } = options;
  const { scope, variable } = getVariableScope(page, varName);

  if (!variable) {
    throw new Error(`Variable "${varName}" not found`);
  }

  let newValue = value;

  // Apply constraints
  if (variable.min !== undefined && newValue < variable.min) newValue = variable.min;
  if (variable.max !== undefined && newValue > variable.max) newValue = variable.max;

  variable.value = newValue;
  delete variable.eval;
  if (runtimeVariables) {
    runtimeVariables[varName] = newValue;
  }

  if (scope === 'global') {
    globalVariables[varName] = newValue;
    if (!page._resolved) page._resolved = {};
    page._resolved[varName] = newValue;
    variableEngine.invalidateDependencyGraph(variableStore.globalVariablesConfig);
    variableStore.setGlobalVariableResolved(varName, newValue);
    updateRenderedValue(varName, newValue, null);
  } else {
    page._variablesVersion = (page._variablesVersion || 0) + 1;
    variableEngine.invalidateDependencyGraph(page.variables);
    page._resolved[varName] = newValue;
    variableStore.setVariableResolved(varName, newValue, pageIndex);
    updateRenderedValue(varName, newValue, pageIndex);

    if (persist) {
      await updateEvaluatedVariable(pageIndex, varName, newValue);
    }
  }

  variableStore.markVariableModified(varName);

  if (shouldResolveDependents && scope === 'page') {
    await resolvePageDependents(page, pageIndex, globalVariables, varName);
  }

  return newValue;
}

async function resolvePageDependents(page, pageIndex = 0, globalVariables = {}, changedVarName) {
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
    page._resolved[depVarName] = depValue;
    variableStore.setVariableResolved(depVarName, depValue, pageIndex);
    updateRenderedValue(depVarName, depValue, pageIndex);
    logger.log('Updated dependent variable:', depVarName, '=', depValue);
  }
}

function createHelperFunctions(page, pageIndex = 0, globalVariables = {}, runtimeVariables = null) {
  return {
    setValue: async (varName, value) => {
      const newValue = await applyVariableChange(page, pageIndex, globalVariables, varName, value, { runtimeVariables });
      logger.log('Set value:', varName, '=', newValue);
      return newValue;
    },

    addValue: async (varName, delta) => {
      const { scope } = getVariableScope(page, varName);
      if (!scope) {
        throw new Error(`Variable "${varName}" not found`);
      }
      const currentValue = scope === 'global'
        ? Number(globalVariables[varName] ?? variableStore.globalVariablesResolved[varName] ?? page._resolved[varName]) || 0
        : Number(variableStore.getVariableResolved(varName, pageIndex) ?? page._resolved[varName]) || 0;
      const newValue = await applyVariableChange(page, pageIndex, globalVariables, varName, currentValue + Number(delta), { runtimeVariables });
      logger.log('Add value:', varName, '+=', delta, '=>', newValue);
      return newValue;
    },
  };
}

/**
 * Legacy wrapper for backwards compatibility
 */
export async function executeCommand(command, page) {
  const script = Array.isArray(command) ? command.join('\n') : command;
  const variables = page?._resolved || {};
  const context = {
    variables,
    helpers: createHelperFunctions(page, page?._pageIndex ?? 0, {}, variables),
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
