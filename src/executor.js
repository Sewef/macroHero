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
const debugWarn = (...args) => isDebugEnabled('executor') && console.warn(...args);
const debugError = (...args) => isDebugEnabled('executor') && console.error(...args);

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
      
      // Update
      if (variable.value !== undefined) {
        variable.value = newValue;
      } else {
        variable.eval = String(newValue);
      }
      
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
      
      // Update
      if (variable.value !== undefined) {
        variable.value = newValue;
      } else {
        variable.eval = String(newValue);
      }
      
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
 * Execute a single command as pure JavaScript
 */
export async function executeCommand(command, page) {
  try {
    debugLog('[EXECUTOR] Executing:', command);
    
    if (!page) {
      throw new Error("No page provided");
    }

    // Create execution context
    const context = createExecutionContext(page);
    
    // Auto-detect and wrap async calls
    let processed = command;
    
    // Collect all positions to add 'await' in a single pass to avoid double-awaiting
    const awaitsToAdd = [];
    
    // Find integration method calls (e.g., OwlTrackers.getValue)
    const integrationsWithMethods = ['GoogleSheets', 'OwlTrackers', 'ConditionsMarkers', 'StatBubbles', 'ColoredRings', 'PrettySordid', 'Local'];
    for (const integration of integrationsWithMethods) {
      const regex = new RegExp(`(?<!await\\s+)\\b(${integration}\\.\\w+)\\(`, 'g');
      let match;
      while ((match = regex.exec(command)) !== null) {
        awaitsToAdd.push({ index: match.index, length: 0, text: 'await ' });
      }
    }
    
    // Find standalone helper function calls (e.g., setValue, addValue) 
    // but only if not preceded by a dot (to avoid matching OwlTrackers.addValue)
    const helperFunctions = ['setValue', 'addValue'];
    for (const helper of helperFunctions) {
      const regex = new RegExp(`(?<!await\\s+)(?<!\\.)\\b(${helper})\\(`, 'g');
      let match;
      while ((match = regex.exec(command)) !== null) {
        awaitsToAdd.push({ index: match.index, length: 0, text: 'await ' });
      }
    }
    
    // Sort by position (descending) and apply insertions from end to start
    awaitsToAdd.sort((a, b) => b.index - a.index);
    for (const insertion of awaitsToAdd) {
      processed = processed.slice(0, insertion.index) + insertion.text + processed.slice(insertion.index);
    }
    
    debugLog('[EXECUTOR] Processed:', processed);
    
    // Execute as async function with proper context binding
    const code = `return (async () => { return ${processed}; })()`;
    const contextKeys = Object.keys(context);
    const func = new Function('context', `
      const { ${contextKeys.join(', ')} } = context;
      ${code}
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
 */
export async function executeCommands(commands, page) {
  const results = [];

  for (const command of commands) {
    try {
      const result = await executeCommand(command, page);
      results.push({ ok: true, result });
    } catch (error) {
      debugError('[EXECUTOR] Command failed:', error);
      results.push({ ok: false, error: error.message });
    }
  }
  
  return results;
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
    
    // Resolve all variables
    const freshResolved = await resolveVariables(page.variables, globalVariables, (varName, value) => {
      const oldValue = oldResolved[varName];
      if (oldValue !== value && onVariableResolved) {
        onVariableResolved(varName, value);
      }
    });
    
    page._resolved = { ...page._resolved, ...freshResolved };
    
    // Execute commands
    await executeCommands(commands, page);
    
    // Re-resolve affected variables
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
      debugLog('[EXECUTOR] Re-resolving', allAffected.size, 'variables');
      const currentResolved = { ...page._resolved };
      const updatedResolved = await resolveVariables(page.variables, globalVariables, (varName, value) => {
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
