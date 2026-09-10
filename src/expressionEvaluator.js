/**
 * Expression Evaluator - REFACTORED to use VariableEngine
 * 
 * This module is now a thin wrapper around VariableEngine for backwards compatibility.
 * All logic has been moved to the centralized engine.
 * 
 * New code should use VariableEngine directly.
 */

import { variableEngine } from "./engines/VariableEngine.js";
import { createDebugLogger } from "./debugMode.js";

const logger = createDebugLogger('expressionEvaluator');

/**
 * Evaluate a single variable expression
 * Delegated to VariableEngine
 */
export async function evaluateExpression(expression, resolvedVars = {}) {
  logger.log("Delegating to VariableEngine");
  return variableEngine.evaluateExpression(expression, resolvedVars);
}

/**
 * Resolve all variables in dependency order
 * Delegated to VariableEngine
 */
export async function resolveVariables(variablesConfig, globalVars = {}, onVariableResolved = null, onlyVars = null) {
  logger.log("Delegating to VariableEngine");
  const resolved = await variableEngine.resolveVariables(variablesConfig, globalVars, onlyVars);
  
  // Call the callback for requested config variables only (backwards compatibility).
  // The resolved object also contains base/global values; those should not be reported
  // as freshly resolved page variables.
  if (onVariableResolved) {
    const callbackVars = onlyVars
      ? Array.from(onlyVars)
      : Object.keys(variablesConfig || {});

    for (const varName of callbackVars) {
      if (varName in resolved) {
        onVariableResolved(varName, resolved[varName]);
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

