/**
 * Expression Evaluator - Pure JavaScript Edition
 * 
 * Simple rules:
 * - Variables with "value": literal values (no evaluation)
 * - Variables with "eval": JavaScript expressions (sync or async, auto-detected)
 * - Use `this.varName` to reference other variables
 * - Template literals with backticks for string formatting
 * - Async functions automatically awaited
 */

import * as math from "mathjs";
import { getExpressionContext } from "./expressionHelpers.js";
import { isDebugEnabled } from "./debugMode.js";

const debugLog = (...args) => isDebugEnabled('expressionEvaluator') && console.log(...args);
const debugError = (...args) => isDebugEnabled('expressionEvaluator') && console.error(...args);

/**
 * Evaluate a single variable expression
 * @param {string|number|boolean} expression - The expression to evaluate
 * @param {Object} resolvedVars - Already resolved variables (for this.varName references)
 * @returns {Promise<any>} Evaluated result
 */
export async function evaluateExpression(expression, resolvedVars = {}) {
  try {
    // Literal values pass through unchanged
    if (expression === null || expression === undefined) return expression;
    if (typeof expression !== 'string') return expression;
    if (!expression.trim()) return expression;

    debugLog('[EVALUATOR] Evaluating:', expression);

    // Build execution context
    const integrations = getExpressionContext(); // Integrations (GoogleSheets, OwlTrackers, etc.)
    
    // Check if expression contains async calls
    const hasAsync = /\b(await\s+|GoogleSheets\.|OwlTrackers\.|ConditionsMarkers\.|StatBubbles\.|ColoredRings\.|PrettySordid\.|Local\.)/.test(expression);

    // Build function code
    let code;
    if (hasAsync) {
      // Wrap in async function, auto-await integration calls
      let processed = expression;
      
      // Auto-add await to integration method calls if not already present
      const integrationNames = ['GoogleSheets', 'OwlTrackers', 'ConditionsMarkers', 'StatBubbles', 'ColoredRings', 'PrettySordid', 'Local'];
      for (const integration of integrationNames) {
        const regex = new RegExp(`(?<!await\\s+)\\b(${integration}\\.\\w+)\\(`, 'g');
        processed = processed.replace(regex, (match, methodCall) => `await ${methodCall}(`);
      }
      
      code = `return (async () => { return ${processed}; })()`;
    } else {
      code = `return (${expression})`;
    }

    debugLog('[EVALUATOR] Executing:', code);

    // Execute with context (integrations, math, and variables)
    const func = new Function('context', 'resolvedVars', `
      const { ${Object.keys(integrations).join(', ')} } = context;
      const { ${Object.keys(math).join(', ')} } = context.math;
      ${Object.keys(resolvedVars).map(key => `const ${key} = resolvedVars['${key}'];`).join('\n      ')}
      const _this = resolvedVars; // Access to other variables via _this.varName
      ${code}
    `);
    const result = await func({ ...integrations, math }, resolvedVars);

    debugLog('[EVALUATOR] Result:', result);
    return result;
  } catch (error) {
    debugError('[EVALUATOR] Error evaluating:', expression, error);
    return null;
  }
}

/**
 * Resolve all variables in dependency order
 * @param {Object} variablesConfig - Variable definitions
 * @param {Object} globalVars - Global variables
 * @param {Function} onVariableResolved - Callback when a variable is resolved
 * @param {Set} onlyVars - Only resolve these variables (optional)
 * @returns {Promise<Object>} Resolved variables
 */
export async function resolveVariables(variablesConfig, globalVars = {}, onVariableResolved = null, onlyVars = null) {
  if (!variablesConfig) return globalVars;

  const resolved = { ...globalVars };
  const dependencies = new Map();

  // Build dependency graph
  for (const [varName, varConfig] of Object.entries(variablesConfig)) {
    const deps = [];
    
    // Only check eval expressions for dependencies
    if (varConfig.eval) {
      const expr = String(varConfig.eval);
      
      // Find this.varName references
      const thisRefs = expr.match(/\bthis\.(\w+)/g) || [];
      for (const ref of thisRefs) {
        const depVar = ref.replace('this.', '');
        if (depVar in variablesConfig && depVar !== varName) {
          deps.push(depVar);
        }
      }
      
      // Find direct variable references (assuming they're in scope)
      for (const otherVar of Object.keys(variablesConfig)) {
        if (otherVar !== varName && new RegExp(`\\b${otherVar}\\b`).test(expr)) {
          if (!deps.includes(otherVar)) {
            deps.push(otherVar);
          }
        }
      }
    }
    
    dependencies.set(varName, deps);
  }

  // Filter if needed
  let varsToResolve = onlyVars;
  if (onlyVars) {
    varsToResolve = new Set(onlyVars);
    const toExpand = Array.from(onlyVars);
    while (toExpand.length > 0) {
      const varName = toExpand.pop();
      const deps = dependencies.get(varName) || [];
      for (const dep of deps) {
        if (!varsToResolve.has(dep)) {
          varsToResolve.add(dep);
          toExpand.push(dep);
        }
      }
    }
  }

  // Topological sort
  const sorted = [];
  const completed = new Set();

  function visit(varName) {
    if (completed.has(varName)) return;
    const deps = dependencies.get(varName) || [];
    for (const dep of deps) visit(dep);
    completed.add(varName);
    sorted.push(varName);
  }

  if (varsToResolve) {
    for (const varName of varsToResolve) {
      if (varName in variablesConfig) visit(varName);
    }
  } else {
    for (const varName of Object.keys(variablesConfig)) visit(varName);
  }

  // Resolve in order
  for (const varName of sorted) {
    const varConfig = variablesConfig[varName];
    
    try {
      let value;
      
      if (varConfig.value !== undefined) {
        // Literal value
        value = varConfig.value;
      } else if (varConfig.eval !== undefined) {
        // Evaluate expression
        value = await evaluateExpression(varConfig.eval, resolved);
      } else if (varConfig.expression !== undefined) {
        // Legacy support - treat as eval
        value = await evaluateExpression(varConfig.expression, resolved);
      } else {
        value = null;
      }

      resolved[varName] = value;

      if (onVariableResolved) {
        onVariableResolved(varName, value);
      }
    } catch (error) {
      debugError('[EVALUATOR] Error resolving variable:', varName, error);
      resolved[varName] = null;
      if (onVariableResolved) {
        onVariableResolved(varName, null);
      }
    }
  }

  return resolved;
}

/**
 * Get variables used in commands
 */
export function getVariablesUsedInCommands(commands) {
  const usedVars = new Set();
  
  for (const cmd of commands) {
    const cmdStr = String(cmd);
    // Find variable references (word boundaries)
    const matches = cmdStr.matchAll(/\b([a-z_][a-zA-Z0-9_]*)\b/g);
    for (const match of matches) {
      usedVars.add(match[1]);
    }
  }
  
  return usedVars;
}

/**
 * Get variables affected by commands (those using integrations)
 */
export function getAffectedVariables(commands, variablesConfig) {
  const affected = new Set();
  if (!variablesConfig) return affected;

  // Find integration calls in commands
  const integrationCalls = new Set();
  for (const cmd of commands) {
    const matches = String(cmd).matchAll(/\b(GoogleSheets|OwlTrackers|ConditionsMarkers|StatBubbles|ColoredRings|PrettySordid|Local)\.\w+/g);
    for (const match of matches) {
      integrationCalls.add(match[1]);
    }
  }

  // Find variables that use these integrations
  for (const [varName, varConfig] of Object.entries(variablesConfig)) {
    const expr = String(varConfig.eval || varConfig.expression || '');
    for (const integration of integrationCalls) {
      if (expr.includes(integration + '.')) {
        affected.add(varName);
        break;
      }
    }
  }

  return affected;
}

/**
 * Get dependent variables (variables that depend on the changed ones)
 */
export function getDependentVariables(variablesConfig, changedVars) {
  if (!variablesConfig) return new Set();

  const changedSet = changedVars instanceof Set ? changedVars : new Set(Array.isArray(changedVars) ? changedVars : [changedVars]);
  const reverseDeps = new Map();

  // Build reverse dependency map
  for (const [varName, varConfig] of Object.entries(variablesConfig)) {
    const expr = String(varConfig.eval || varConfig.expression || '');
    
    // Find dependencies
    const thisRefs = expr.match(/\bthis\.(\w+)/g) || [];
    for (const ref of thisRefs) {
      const depVar = ref.replace('this.', '');
      if (depVar in variablesConfig && depVar !== varName) {
        if (!reverseDeps.has(depVar)) reverseDeps.set(depVar, new Set());
        reverseDeps.get(depVar).add(varName);
      }
    }
    
    // Also check direct references
    for (const otherVar of Object.keys(variablesConfig)) {
      if (otherVar !== varName && new RegExp(`\\b${otherVar}\\b`).test(expr)) {
        if (!reverseDeps.has(otherVar)) reverseDeps.set(otherVar, new Set());
        reverseDeps.get(otherVar).add(varName);
      }
    }
  }

  // Find all affected
  const affected = new Set(changedSet);
  const toProcess = Array.from(changedSet);

  while (toProcess.length > 0) {
    const varName = toProcess.pop();
    const dependents = reverseDeps.get(varName);
    if (dependents) {
      for (const dependent of dependents) {
        if (!affected.has(dependent)) {
          affected.add(dependent);
          toProcess.push(dependent);
        }
      }
    }
  }

  return affected;
}

export default {
  evaluateExpression,
  resolveVariables,
  getVariablesUsedInCommands,
  getAffectedVariables,
  getDependentVariables,
};
