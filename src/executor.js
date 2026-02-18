/**
 * Command Executor - Pure JavaScript Edition
 * 
 * Commands are pure JavaScript executed with all variables and integrations in scope.
 * No special syntax, no parsing - just evaluate and run.
 */

import * as math from "mathjs";
import { resolveVariables, getAffectedVariables, getVariablesUsedInCommands, getDependentVariables } from "./expressionEvaluator.js";
import { updateRenderedValue } from "./ui.js";
import { updateEvaluatedVariable } from "./storage.js";
import { getExpressionContext } from "./expressionHelpers.js";
import { isDebugEnabled } from "./debugMode.js";

const debugLog = (...args) => isDebugEnabled('executor') && console.log(...args);
const debugWarn = (...args) => console.warn(...args);
const debugError = (...args) => console.error(...args);

/**
 * Create execution context with all variables, integrations, and helpers
 */
function createExecutionContext(page) {
  if (!page) {
    debugWarn("[EXECUTOR] No page provided");
    page = { variables: {} };
  }

  const integrations = getExpressionContext();
  
  if (!page._modifiedVars) {
    page._modifiedVars = new Set();
  }

  const pageIndex = page?._pageIndex ?? 0;
  const resolvedVars = page?._resolved ?? {};

  return {
    // Integrations
    ...integrations,
    
    // Math functions
    ...math,
    
    // All resolved variables directly in scope
    ...resolvedVars,
    
    // Helper functions
    setValue: async (varName, value) => {
      if (!page.variables || !(varName in page.variables)) {
        throw new Error(`Variable "${varName}" not found`);
      }
      
      const variable = page.variables[varName];
      let newValue = value;
      
      // Apply constraints
      if (variable.min !== undefined && newValue < variable.min) newValue = variable.min;
      if (variable.max !== undefined && newValue > variable.max) newValue = variable.max;
      
      // Update variable definition - always use value for user-modified values
      variable.value = newValue;
      delete variable.eval; // Remove eval if present
      
      page._resolved[varName] = newValue;
      page._modifiedVars.add(varName);
      
      await updateEvaluatedVariable(pageIndex, varName, newValue);
      
      if (typeof updateRenderedValue === 'function') {
        updateRenderedValue(varName, newValue);
      }
      
      debugLog('[setValue]', varName, '=', newValue);
      return newValue;
    },
    
    addValue: async (varName, delta) => {
      if (!page.variables || !(varName in page.variables)) {
        throw new Error(`Variable "${varName}" not found`);
      }
      
      const variable = page.variables[varName];
      const currentValue = Number(page._resolved[varName]) || 0;
      let newValue = currentValue + Number(delta);
      
      // Apply constraints
      if (variable.min !== undefined && newValue < variable.min) newValue = variable.min;
      if (variable.max !== undefined && newValue > variable.max) newValue = variable.max;
      
      // Update variable definition - always use value for user-modified values
      variable.value = newValue;
      delete variable.eval; // Remove eval if present
      
      page._resolved[varName] = newValue;
      page._modifiedVars.add(varName);
      
      await updateEvaluatedVariable(pageIndex, varName, newValue);
      
      if (typeof updateRenderedValue === 'function') {
        updateRenderedValue(varName, newValue);
      }
      
      debugLog('[addValue]', varName, '+=', delta, '=>', newValue);
      return newValue;
    },
  };
}

/**
 * Execute a command as pure JavaScript
 * Commands can be:
 * - A single string (one line of code)
 * - An array of strings (multiline script, joined with \n)
 */
export async function executeCommand(command, page) {
  try {
    // Convert array of lines to single script
    const script = Array.isArray(command) ? command.join('\n') : command;
    
    debugLog('[EXECUTOR] Executing:', script);
    
    if (!page) {
      throw new Error("No page provided");
    }

    // Create execution context
    const context = createExecutionContext(page);
    
    // Execute as async function with proper context binding
    const contextKeys = Object.keys(context);
    const func = new Function('context', `
      const { ${contextKeys.join(', ')} } = context;
      return (async () => { ${script} })();
    `);
    const result = await func(context);
    
    debugLog('[EXECUTOR] Result:', result);
    return result;
  } catch (error) {
    debugError('[EXECUTOR] Error:', error);
    throw error;
  }
}

/**
 * Execute multiple commands
 * If commands is an array, it's treated as a single multiline script
 */
export async function executeCommands(commands, page) {
  // Treat the entire commands array as a single script
  try {
    const result = await executeCommand(commands, page);
    return [{ ok: true, result }];
  } catch (error) {
    debugError('[EXECUTOR] Command failed:', error);
    return [{ ok: false, error: error.message }];
  }
}

/**
 * Handle button click
 */
export async function handleButtonClick(commands, page, globalVariables = {}, onVariableResolved = null) {
  if (!Array.isArray(commands) || commands.length === 0) {
    debugWarn("[EXECUTOR] No commands");
    return;
  }
  
  try {
    debugLog("[EXECUTOR] Button clicked");
    
    page._modifiedVars = new Set();
    const oldResolved = { ...page._resolved };
    
    // OPTIMIZATION: Only resolve variables that are USED in the commands
    // This is much faster than resolving ALL variables
    const usedVars = getVariablesUsedInCommands(commands);
    
    // Filter to only variables that exist in the page config
    const varsToResolveBeforeCmd = new Set();
    for (const varName of usedVars) {
      if (varName in page.variables && !(varName in page._resolved)) {
        varsToResolveBeforeCmd.add(varName);
      }
    }
    
    // Resolve only the needed variables before command execution
    if (varsToResolveBeforeCmd.size > 0) {
      debugLog('[EXECUTOR] Pre-resolving', varsToResolveBeforeCmd.size, 'variables used in commands');
      const preResolved = await resolveVariables(page.variables, page._resolved, (varName, value) => {
        page._resolved[varName] = value;
        if (onVariableResolved) {
          onVariableResolved(varName, value);
        }
      }, varsToResolveBeforeCmd);
      page._resolved = { ...page._resolved, ...preResolved };
    }
    
    // Execute commands
    await executeCommands(commands, page);
    
    // Re-resolve ONLY affected variables (those that might have changed due to commands)
    const affectedVars = getAffectedVariables(commands, page.variables);
    const directlyModified = new Set();
    
    if (page._modifiedVars?.size > 0) {
      for (const modifiedVar of page._modifiedVars) {
        directlyModified.add(modifiedVar);
        affectedVars.add(modifiedVar);
      }
    }
    
    const allAffected = getDependentVariables(page.variables, affectedVars);
    
    if (allAffected.size > 0) {
      debugLog('[EXECUTOR] Post-resolving', allAffected.size, 'affected variables');
      const currentResolved = { ...page._resolved };
      const updatedResolved = await resolveVariables(page.variables, currentResolved, (varName, value) => {
        const oldValue = currentResolved[varName];
        if (directlyModified.has(varName) || (oldValue !== value && onVariableResolved)) {
          if (onVariableResolved) {
            onVariableResolved(varName, value);
          }
        }
      }, allAffected);
      
      page._resolved = updatedResolved;
    }
    
    page._modifiedVars = new Set();
    debugLog('[EXECUTOR] Complete');
  } catch (error) {
    debugError('[EXECUTOR] Button action failed:', error);
    throw error;
  }
}

export default {
  executeCommand,
  executeCommands,
  handleButtonClick,
};
