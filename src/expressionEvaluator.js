/**
 * Expression Evaluator - REFACTORED to use VariableEngine
 * 
 * This module is now a thin wrapper around VariableEngine for backwards compatibility.
 * All logic has been moved to the centralized engine.
 * 
 * New code should use VariableEngine directly.
 */

import { variableEngine } from "./engines/VariableEngine.js";
import { isDebugEnabled } from "./debugMode.js";

const debugLog = (...args) => isDebugEnabled('expressionEvaluator') && console.log(...args);

/**
 * Evaluate a single variable expression
 * Delegated to VariableEngine
 */
export async function evaluateExpression(expression, resolvedVars = {}) {
  debugLog('[EVALUATOR] Delegating to VariableEngine');
  return variableEngine.evaluateExpression(expression, resolvedVars);
}

/**
 * Resolve all variables in dependency order
 * Delegated to VariableEngine
 */
export async function resolveVariables(variablesConfig, globalVars = {}, onVariableResolved = null, onlyVars = null) {
  debugLog('[EVALUATOR] Delegating to VariableEngine');
  const resolved = await variableEngine.resolveVariables(variablesConfig, globalVars, onlyVars);
  
  // Call the callback for each variable if provided (backwards compatibility)
  if (onVariableResolved) {
    for (const [varName, value] of Object.entries(resolved)) {
      if (onVariableResolved) {
        onVariableResolved(varName, value);
      }
    }
  }
  
  return resolved;
}

/**
 * Get variables used in commands
 * Delegated to VariableEngine
 */
export function getVariablesUsedInCommands(commands) {
  return variableEngine.getVariablesUsedInCommands(commands);
}

/**
 * Get variables affected by commands
 * Delegated to VariableEngine
 */
export function getAffectedVariables(commands, variablesConfig) {
  return variableEngine.getAffectedVariables(commands, variablesConfig);
}

/**
 * Get dependent variables
 * Delegated to VariableEngine
 */
export function getDependentVariables(variablesConfig, changedVars) {
  return variableEngine.getDependentVariables(variablesConfig, changedVars);
}

export default {
  evaluateExpression,
  resolveVariables,
  getVariablesUsedInCommands,
  getAffectedVariables,
  getDependentVariables,
};
