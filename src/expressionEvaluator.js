/**
 * Expression Evaluator
 * Evaluates variable expressions with support for:
 * - GSheet.getValue(sheet, range)
 * - Local.value(key, default)
 * - Mathematical expressions
 * - Variable substitution with {varName} syntax
 */

import * as expressionHelpers from "./expressionHelpers.js";

/**
 * Evaluate a variable expression
 * @param {string} expression - Expression to evaluate (e.g., "GSheet.getValue('Sheet', 'A1')" or "floor({speedBonus} / 10)")
 * @param {Object} resolvedVars - Already resolved variables for substitution
 * @returns {Promise<any>} Evaluated result
 */
export async function evaluateExpression(expression, resolvedVars = {}) {
  try {
    // Step 1: Substitute variables with {varName} syntax
    let processed = expression;
    
    // Log available variables for debugging
    if (expression.includes('{')) {
      const missingVars = (expression.match(/\{(\w+)\}/g) || []).map(v => v.slice(1, -1)).filter(v => !(v in resolvedVars));
      if (missingVars.length > 0) {
        console.warn(`[EVAL] Missing variables for "${expression}":`, missingVars, "Available:", Object.keys(resolvedVars));
      }
    }
    
    for (const [varName, varValue] of Object.entries(resolvedVars)) {
      const pattern = new RegExp(`\\{${varName}\\}`, 'g');
      
      // Convert value to appropriate type for substitution
      let substitutedValue = varValue;
      if (varValue === null) {
        substitutedValue = 'null';
      } else if (varValue === undefined) {
        substitutedValue = 'undefined';
      } else if (typeof varValue === 'string') {
        // If it looks like a number, convert it
        if (!isNaN(varValue) && varValue.trim() !== '') {
          substitutedValue = Number(varValue);
        } else {
          // Keep as string literal
          substitutedValue = `'${varValue}'`;
        }
      }
      processed = processed.replace(pattern, substitutedValue);
    }
    
    // Step 2: Get execution context from integrations manager
    const contextObj = expressionHelpers.getExpressionContext();
    
    // Step 3: Evaluate the expression
    // Pass context as a single object to avoid parameter name issues
    const funcCode = `return (async () => { 
      const { GSheet, Local, ConditionsMarkers, OwlTrackers, Math: MathObj, floor, ceil, round, abs, min, max } = __context__;
      const Math = MathObj || { floor, ceil, round, abs, min, max };
      
      const result = (${processed});
      if (result instanceof Promise) {
        return await result;
      }
      return result;
    })()`;
    
    const asyncFunc = new Function('__context__', funcCode);
    const result = await asyncFunc(contextObj);
    return result;
  } catch (error) {
    console.error(`[EVAL] Error evaluating "${expression}":`, error.message);
    return null;
  }
}

/**
 * Analyze which variables could be affected by a set of commands
 * @param {Array<string>} commands - Commands that were executed
 * @param {Object} variablesConfig - Variables configuration object
 * @returns {Set<string>} Set of variable names that might have changed
 */
export function getAffectedVariables(commands, variablesConfig) {
  const affected = new Set();
  
  if (!variablesConfig) return affected;
  
  // Extract integration calls from commands (e.g., "OwlTrackers.addValue")
  const integrationCalls = new Set();
  for (const cmd of commands) {
    const matches = cmd.matchAll(/(\w+)\.\w+\(/g);
    for (const match of matches) {
      integrationCalls.add(match[1]); // e.g., "OwlTrackers", "ConditionsMarkers"
    }
  }
  
  // Build dependency graph to find all variables that depend on changed integrations
  const dependencies = new Map();
  const reverseDeps = new Map(); // varName -> Set of vars that depend on it
  
  for (const [varName, varConfig] of Object.entries(variablesConfig)) {
    const expr = varConfig.expression || '';
    const deps = [];
    
    // Check if this variable uses any of the affected integrations
    for (const integration of integrationCalls) {
      if (expr.includes(integration + '.')) {
        affected.add(varName);
      }
    }
    
    // Extract variable dependencies {varName}
    const matches = expr.matchAll(/\{(\w+)\}/g);
    for (const match of matches) {
      const depVar = match[1];
      if (depVar in variablesConfig && depVar !== varName) {
        deps.push(depVar);
        if (!reverseDeps.has(depVar)) {
          reverseDeps.set(depVar, new Set());
        }
        reverseDeps.get(depVar).add(varName);
      }
    }
    
    dependencies.set(varName, deps);
  }
  
  // Recursively add all variables that depend on affected variables
  const toProcess = Array.from(affected);
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

/**
 * Resolve all variables in a page or global config
 * @param {Object} variablesConfig - Variables configuration object
 * @param {Object} previouslyResolved - Variables resolved in previous step (for cascading)
 * @param {Function} onVariableResolved - Callback when a variable is resolved (varName, value)
 * @param {Set<string>} onlyVars - If provided, only resolve these specific variables
 * @returns {Promise<Object>} Resolved variables
 */
export async function resolveVariables(variablesConfig, previouslyResolved = {}, onVariableResolved = null, onlyVars = null) {
  if (!variablesConfig) {
    return previouslyResolved;
  }
  
  const resolved = { ...previouslyResolved };
  
  // Topological sort: resolve variables in dependency order
  const varEntries = Object.entries(variablesConfig);
  const dependencies = new Map();
  
  // Build dependency graph
  for (const [varName, varConfig] of varEntries) {
    const expr = varConfig.expression || '';
    const deps = [];
    
    // Extract all variable references {varName}
    const matches = expr.matchAll(/\{(\w+)\}/g);
    for (const match of matches) {
      const depVar = match[1];
      if (depVar in variablesConfig && depVar !== varName) {
        deps.push(depVar);
      }
    }
    
    dependencies.set(varName, deps);
  }
  
  // If filtering, expand to include all dependencies
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
    console.log("[RESOLVE] Expanded vars to resolve (including dependencies):", Array.from(varsToResolve));
  }
  
  // Topological sort using Kahn's algorithm
  const sorted = [];
  const inProgress = new Set();
  const completed = new Set();
  
  function visit(varName) {
    if (completed.has(varName)) return;
    if (inProgress.has(varName)) return; // Cycle detection
    
    inProgress.add(varName);
    
    const deps = dependencies.get(varName) || [];
    for (const dep of deps) {
      visit(dep);
    }
    
    inProgress.delete(varName);
    completed.add(varName);
    sorted.push(varName);
  }
  
  for (const [varName] of varEntries) {
    visit(varName);
  }
  
  for (const varName of sorted) {
    // Skip if we're filtering and this var is not in the filter set (after expansion)
    if (varsToResolve && !varsToResolve.has(varName)) {
      continue;
    }
    
    const varConfig = variablesConfig[varName];
    if (!varConfig.expression) {
      continue;
    }
    
    try {
      const value = await evaluateExpression(varConfig.expression, resolved);
      resolved[varName] = value;
      
      if (onVariableResolved) {
        onVariableResolved(varName, value);
      }
    } catch (error) {
      console.error(`Error resolving "${varName}":`, error.message);
      resolved[varName] = null;
      
      if (onVariableResolved) {
        onVariableResolved(varName, null);
      }
    }
  }
  
  return resolved;
}

export default {
  evaluateExpression,
  resolveVariables,
  getAffectedVariables,
};
