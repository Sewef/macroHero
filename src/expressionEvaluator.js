/**
 * Expression Evaluator - REFACTORED to use VariableEngine
 * 
 * This module is now a thin wrapper around VariableEngine for backwards compatibility.
 * All logic has been moved to the centralized engine.
 * 
 * New code should use VariableEngine directly.
 */

import { variableEngine } from "./engines/VariableEngine.js";
import { variableStore } from "./stores/VariableStore.js";
import { createDebugLogger } from "./debugMode.js";

const logger = createDebugLogger('expressionEvaluator');

/**
 * Evaluate a single variable expression
 * Delegated to VariableEngine
 */
export async function evaluateExpression(expression, resolvedVars = {}, scopes = {}) {
  logger.log("Delegating to VariableEngine");
  return variableEngine.evaluateExpression(expression, resolvedVars, scopes);
}

/**
 * Resolve all variables in dependency order
 * Delegated to VariableEngine
 */
export async function resolveVariables(variablesConfig, globalVars = {}, onVariableResolved = null, onlyVars = null, options = {}) {
  logger.log("Delegating to VariableEngine");
  const resolved = await variableEngine.resolveVariables(variablesConfig, globalVars, onlyVars, options);
  
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

export async function resolveAllPageVariables(config, globalVars = {}, targetNodeIds = null) {
  logger.log("Resolving cross-page variables");
  let pages = await variableEngine.resolveAllPages(config, globalVars, targetNodeIds);
  const globalUsesPages = Object.values(config?.global?.variables || {}).some(definition => (
    definition?.eval !== undefined && /\bPages\./.test(String(definition.eval))
  ));
  if (globalUsesPages) {
    const resolvedGlobal = await variableEngine.resolveVariables(
      config.global.variables,
      { ...globalVars },
      null,
      { scope: "global", pages },
    );
    Object.keys(config.global.variables || {}).forEach(name => {
      globalVars[name] = resolvedGlobal[name];
    });
    variableStore.setGlobalVariablesResolved(globalVars);
    config._resolvedGlobal = { ...globalVars };
    pages = await variableEngine.resolveAllPages(config, globalVars, targetNodeIds);
  }
  return pages;
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
  resolveAllPageVariables,
  getVariablesUsedInCommands,
  getAffectedVariables,
  getDependentVariables,
};

