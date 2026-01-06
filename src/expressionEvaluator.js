import * as expressionHelpers from "./expressionHelpers.js";
import * as math from "mathjs";
import { isDebugEnabled } from "./debugMode.js";

// Debug mode constants
const debugError = (...args) => isDebugEnabled('expressionEvaluator') && console.error(...args);

// Regex patterns compiled once for reuse
const VAR_REFERENCE_PATTERN = /\{(\w+)(?:\[[^\]]+\])*\}/g;
const VAR_REFERENCE_PATTERN_FOR_EXTRACTION = /\{(\w+)(?:\[[^\]]+\])*\}/g;

/**
 * Evaluate a variable expression
 * @param {string} expression - Expression to evaluate (e.g., "GoogleSheets.getValue('Sheet', 'A1')" or "floor({speedBonus} / 10)")
 * @param {Object} resolvedVars - Already resolved variables for substitution
 * @returns {Promise<any>} Evaluated result
 */
export async function evaluateExpression(expression, resolvedVars = {}) {
  try {
    // If expression is explicitly null/undefined, return as-is
    if (expression === null || expression === undefined) return expression;
    // If expression is not a string (e.g., a numeric literal 0), return it unchanged
    if (typeof expression !== 'string') return expression;
    
    // Check if expression contains unresolved variables - if so, return null early
    // This happens when layout elements reference variables that haven't resolved yet
    const missingVars = (expression.match(/\{(\w+)(?:\[.*?\])?\}/g) || []).map(v => v.slice(1, -1).split('[')[0]).filter(v => !(v in resolvedVars));
    if (missingVars.length > 0) {
      // Expression contains unresolved variables - this is expected during initial render
      // Return null without logging an error, will be re-evaluated once variables resolve
      return null;
    }
    
    // Step 1: Substitute variables with {varName} syntax
    let processed = expression;
    
    // Match both {varName} and {varName[index]} or {varName[index][index2]} etc.
    const varPattern = /\{(\w+)((?:\[[^\]]+\])*)\}/g;
    processed = processed.replace(varPattern, (match, varName, accessors) => {
      if (!(varName in resolvedVars)) {
        return match; // Leave unchanged if variable not found
      }
      
      const varValue = resolvedVars[varName];
      
      // Convert value to appropriate type for substitution
      let substitutedValue;
      if (varValue === null) {
        substitutedValue = 'null';
      } else if (varValue === undefined) {
        substitutedValue = 'undefined';
      } else if (typeof varValue === 'string') {
        // Standardize strings: handle boolean-like and numeric-like strings, and escape quotes
        const trimmed = varValue.trim();
        if (/^(true|false)$/i.test(trimmed)) {
          substitutedValue = trimmed.toLowerCase() === 'true';
        } else if (!isNaN(trimmed) && trimmed !== '') {
          substitutedValue = Number(trimmed);
        } else {
          substitutedValue = `'${varValue.replace(/'/g, "\\'")}'`;
        }
      } else if (Array.isArray(varValue) || typeof varValue === 'object') {
        // For arrays and objects, use JSON representation
        substitutedValue = JSON.stringify(varValue);
      } else {
        substitutedValue = varValue;
      }
      
      // Append any accessors like [0] or [0][1]
      return substitutedValue + accessors;
    });
    
    // Step 2: Get execution context from integrations manager
    const contextObj = expressionHelpers.getExpressionContext();
    
    // Step 3: Transform the expression to properly await async function calls
    // Replace patterns like OwlTrackers.getValue(...) with (await OwlTrackers.getValue(...))
    // This ensures the promise is awaited before any arithmetic operations
    // Use centralized async method detection to avoid duplication
    const asyncMethods = expressionHelpers.getAsyncMethods();
    
    let transformed = processed;
    
    // Build a single regex pattern for all async methods to avoid multiple passes
    if (asyncMethods.length > 0) {
      // Escape and join all methods into single pattern: method1\s*\(|method2\s*\(|...
      const methodPatterns = asyncMethods.map(m => m.replace(/\./g, "\\.") + "\\s*\\(").join("|");
      const combinedRegex = new RegExp(`(${methodPatterns})`, "g");
      
      // Find all matches in a single pass
      const matches = [];
      let match;
      while ((match = combinedRegex.exec(transformed)) !== null) {
        matches.push(match.index);
      }
      
      // Process matches in reverse order to maintain indices
      for (let i = matches.length - 1; i >= 0; i--) {
        const index = matches[i];
        const matchedMethod = transformed.substring(index).match(/^[\w.]+/)[0];
    
        let parenCount = 0;
        let startIdx = index + matchedMethod.length;
        let endIdx = startIdx;
    
        // Find matching closing parenthesis
        for (let j = startIdx; j < transformed.length; j++) {
          if (transformed[j] === "(") parenCount++;
          if (transformed[j] === ")") {
            parenCount--;
            if (parenCount === 0) {
              endIdx = j + 1;
              break;
            }
          }
        }
    
        const fullCall = transformed.substring(index, endIdx);
        const beforeCall = transformed.substring(Math.max(0, index - 10), index).trim();
        if (!beforeCall.endsWith("await")) {
          const wrappedCall = `(await ${fullCall})`;
          transformed = transformed.substring(0, index) + wrappedCall + transformed.substring(endIdx);
        }
      }
    }
    
    // Step 4: Ensure mathjs functions are available in the execution context
    // This allows using functions like floor(), ceil(), sqrt(), etc. implicitly
    // (e.g. "floor({spdCS}/2)")
    Object.assign(contextObj, math);

    // Step 5: Evaluate the expression with proper async handling
    const funcCode = `return (async () => { 
      const { GoogleSheets, Local, ConditionsMarkers, OwlTrackers, StatBubbles, ColoredRings, JustDices, PrettySordid, playerMetadata, sceneMetadata, tokenMetadata, tokenAttachments, Math: MathObj, floor, ceil, round, abs, min, max } = __context__;
      const Math = MathObj || { floor, ceil, round, abs, min, max };
      
      const result = ${transformed};
      return result;
    })()`;
    
    const asyncFunc = new Function('__context__', funcCode);
    const result = await asyncFunc(contextObj);
    return result;
  } catch (error) {
    // Only log errors that aren't about undefined variables (those are expected when variables haven't resolved yet)
    if (!error.message.includes('is not defined')) {
      debugError(`[EVAL] Error evaluating "${expression}":`, error.message);
    }
    return null;
  }
}

/**
 * Extract variable references from commands
 * @param {Array<string>} commands - Commands to analyze
 * @returns {Set<string>} Set of variable names used in commands
 */
export function getVariablesUsedInCommands(commands) {
  const usedVars = new Set();
  
  for (const cmd of commands) {
    // Extract {varName} references
      const matches = String(cmd).matchAll(/\{(\w+)\}/g);
    for (const match of matches) {
      usedVars.add(match[1]);
    }
  }
  
  return usedVars;
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
      const matches = String(cmd).matchAll(/(\w+)\.\w+\(/g);
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
      const matches = String(expr).matchAll(/\{(\w+)\}/g);
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
  
  // Start with previously resolved values (includes globals)
  // But if we're filtering to specific vars, we'll re-resolve those and their dependencies
  const resolved = { ...previouslyResolved };
  
  // Topological sort: resolve variables in dependency order
  const varEntries = Object.entries(variablesConfig);
  const dependencies = new Map();
  
  // Build dependency graph
  for (const [varName, varConfig] of varEntries) {
    const expr = varConfig.expression || '';
    const deps = [];
    
    // Extract all variable references {varName} and {varName[index]} etc.
    // Pattern matches {word} or {word[...]} where [...] can be nested
    // Using pre-compiled pattern for better performance
    VAR_REFERENCE_PATTERN_FOR_EXTRACTION.lastIndex = 0; // Reset regex state
    let match;
    while ((match = VAR_REFERENCE_PATTERN_FOR_EXTRACTION.exec(expr)) !== null) {
      const depVar = match[1]; // Extract just the variable name, ignore indexing
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
  }
  
  // Topological sort using Kahn's algorithm with memoization
  // Only sort variables we need to resolve
  const sorted = [];
  const inProgress = new Set();
  const completed = new Set();
  
  // Memoize visited nodes to avoid re-processing in complex dependency graphs
  function visit(varName, memo = new Set()) {
    if (completed.has(varName)) return; // Already processed
    if (memo.has(varName)) return; // Cycle detection in current path
    
    memo.add(varName);
    
    const deps = dependencies.get(varName) || [];
    for (const dep of deps) {
      visit(dep, memo);
    }
    
    memo.delete(varName);
    completed.add(varName);
    sorted.push(varName);
  }
  
  // Only visit variables we need to resolve (after expansion)
  if (varsToResolve) {
    for (const varName of varsToResolve) {
      if (varName in variablesConfig) {
        visit(varName);
      }
    }
  } else {
    // No filter - resolve all
    for (const [varName] of varEntries) {
      visit(varName);
    }
  }
  
  for (const varName of sorted) {
    // No need to filter here anymore - sorted only contains what we need
    const varConfig = variablesConfig[varName];
    // Treat undefined/null/empty as "no expression". Allow 0 or other falsy expressions.
    if (varConfig?.expression === undefined || varConfig?.expression === null || varConfig?.expression === '') {
      continue;
    }
    
    // When filtering, always re-resolve the vars in our filter set (even if they were in previouslyResolved)
    // This ensures we get fresh values for affected variables and their dependencies
    try {
      const value = await evaluateExpression(varConfig.expression, resolved);
      resolved[varName] = value;
      
      if (onVariableResolved) {
        onVariableResolved(varName, value);
      }
    } catch (error) {
      debugError(`[EVALUATOR] Error resolving "${varName}":`, error.message);
      resolved[varName] = null;
      
      if (onVariableResolved) {
        onVariableResolved(varName, null);
      }
    }
  }
  
  return resolved;
}

/**
 * Find all variables that depend on the specified variables
 * @param {Object} variablesConfig - Variables configuration
 * @param {Set<string>|Array<string>} changedVars - Variables that changed
 * @returns {Set<string>} All variables that depend on changedVars (including changedVars themselves)
 */
export function getDependentVariables(variablesConfig, changedVars) {
  if (!variablesConfig) return new Set();
  
  // Convert input to Set
  let changedSet;
  if (changedVars instanceof Set) {
    changedSet = changedVars;
  } else if (Array.isArray(changedVars)) {
    changedSet = new Set(changedVars);
  } else {
    changedSet = new Set([changedVars]);
  }
  
  // Build reverse dependency map (which vars depend on which)
  const reverseDeps = new Map(); // varName -> Set of vars that depend on it
  
  for (const [varName, varConfig] of Object.entries(variablesConfig)) {
    const expr = String(varConfig.expression || '');
    // Extract all variable references {varName} and {varName[index]} etc.
    const matches = expr.matchAll(/\{(\w+)(?:\[[^\]]+\])*\}/g);
    for (const match of matches) {
      const depVar = match[1]; // Extract just the variable name, ignore indexing
      if (depVar in variablesConfig && depVar !== varName) {
        if (!reverseDeps.has(depVar)) {
          reverseDeps.set(depVar, new Set());
        }
        reverseDeps.get(depVar).add(varName);
      }
    }
  }
  
  // Find all variables that depend on changed variables (transitively)
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
  getAffectedVariables,
  getVariablesUsedInCommands,
  getDependentVariables,
};
