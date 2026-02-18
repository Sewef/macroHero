/**
 * VariableEngine - Centralized variable resolution and evaluation
 * 
 * Consolidates:
 * - Expression evaluation (was in expressionEvaluator.js)
 * - Variable resolution (was in expressionEvaluator.js)
 * - Dependency tracking (was scattered)
 * - Command variable detection (was in executor.js)
 * 
 * Single place for ALL variable operations
 */

import * as math from "mathjs";
import { executionSandbox } from "./ExecutionSandbox.js";
import { eventBus } from "../events/EventBus.js";
import { variableStore } from "../stores/VariableStore.js";
import { isDebugEnabled } from "../debugMode.js";

const debugLog = (...args) => isDebugEnabled('VariableEngine') && console.log(...args);
const debugError = (...args) => console.error(...args);

// Cache for dependency graphs
const dependencyCache = new WeakMap();

// Integration names for detection
const INTEGRATION_NAMES = [
  'GoogleSheets', 'OwlTrackers', 'ConditionMarkers', 'StatBubbles',
  'ColoredRings', 'PrettySordid', 'Local', 'Embers', 'JustDices', 'Weather'
];

class VariableEngine {
  /**
   * Evaluate a single expression
   * @param {string|number|boolean} expression - Expression to evaluate
   * @param {Object} resolvedVars - Variables available in scope
   * @returns {Promise<any>} Result
   */
  async evaluateExpression(expression, resolvedVars = {}) {
    try {
      // Literal values pass through unchanged
      if (expression === null || expression === undefined) return expression;
      if (typeof expression !== 'string') return expression;
      if (!expression.trim()) return expression;

      debugLog('[Engine] Evaluating expression:', expression);

      // Detect if async is needed
      const hasAsync = this._hasAsyncCall(expression);

      // Execute through sandbox
      const result = hasAsync
        ? await executionSandbox.executeAsync(expression, resolvedVars)
        : executionSandbox.executeSync(expression, resolvedVars);

      return result;
    } catch (error) {
      debugError('[Engine] Evaluation error:', error);
      return null;
    }
  }

  /**
   * Check if expression has async calls
   */
  _hasAsyncCall(expression) {
    const hasAwait = /\bawait\s+/.test(expression);
    const hasIntegration = INTEGRATION_NAMES.some(
      intName => new RegExp(`\\b${intName}\\.`).test(expression)
    );
    return hasAwait || hasIntegration;
  }

  /**
   * Build and cache dependency graph
   */
  _buildDependencyGraph(variablesConfig) {
    // Check cache first
    if (dependencyCache.has(variablesConfig)) {
      return dependencyCache.get(variablesConfig);
    }

    const dependencies = new Map();

    for (const [varName, varConfig] of Object.entries(variablesConfig || {})) {
      const deps = [];

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

        // Find direct variable references
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

    dependencyCache.set(variablesConfig, dependencies);
    return dependencies;
  }

  /**
   * Resolve variables in dependency order
   * @param {Object} variablesConfig - Variable definitions
   * @param {Object} resolvedVars - Already-resolved variables
   * @param {Set} varsToResolve - Only resolve these (optional)
   * @returns {Promise<Object>} All resolved variables
   */
  async resolveVariables(variablesConfig, resolvedVars = {}, varsToResolve = null) {
    if (!variablesConfig) return resolvedVars;

    const resolved = { ...resolvedVars };
    const dependencies = this._buildDependencyGraph(variablesConfig);

    // Determine which variables to resolve
    let toResolve = varsToResolve;
    if (varsToResolve) {
      toResolve = new Set(varsToResolve);
      const toExpand = Array.from(varsToResolve);
      
      // Expand to include all dependencies
      while (toExpand.length > 0) {
        const varName = toExpand.pop();
        const deps = dependencies.get(varName) || [];
        for (const dep of deps) {
          if (!toResolve.has(dep)) {
            toResolve.add(dep);
            toExpand.push(dep);
          }
        }
      }
    }

    // Topological sort
    const sorted = this._topologicalSort(dependencies, toResolve, variablesConfig);

    // Resolve in order
    for (const varName of sorted) {
      const varConfig = variablesConfig[varName];

      try {
        let value;

        if (varConfig.value !== undefined) {
          value = varConfig.value;
        } else if (varConfig.eval !== undefined) {
          value = await this.evaluateExpression(varConfig.eval, resolved);
        } else {
          value = null;
        }

        resolved[varName] = value;

        // Emit event for this variable resolution
        eventBus.emit('engine:variableResolved', varName, value);
      } catch (error) {
        debugError('[Engine] Error resolving', varName, error);
        resolved[varName] = null;
      }
    }

    return resolved;
  }

  /**
   * Topological sort of variables
   */
  _topologicalSort(dependencies, varsToResolve, variablesConfig) {
    const sorted = [];
    const completed = new Set();

    const visit = (varName) => {
      if (completed.has(varName)) return;
      const deps = dependencies.get(varName) || [];
      for (const dep of deps) visit(dep);
      completed.add(varName);
      sorted.push(varName);
    };

    if (varsToResolve) {
      for (const varName of varsToResolve) {
        if (varName in variablesConfig) visit(varName);
      }
    } else {
      for (const varName of Object.keys(variablesConfig)) visit(varName);
    }

    return sorted;
  }

  /**
   * Get variables used in commands
   */
  getVariablesUsedInCommands(commands) {
    const usedVars = new Set();

    for (const cmd of commands) {
      const cmdStr = String(cmd);
      // Match variable identifiers
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
  getAffectedVariables(commands, variablesConfig) {
    const affected = new Set();
    if (!variablesConfig) return affected;

    // Find integration calls in commands
    const integrationCalls = new Set();
    for (const cmd of commands) {
      for (const integration of INTEGRATION_NAMES) {
        const regex = new RegExp(`\\b${integration}\\.\\w+`, 'g');
        const matches = String(cmd).matchAll(regex);
        for (const match of matches) {
          integrationCalls.add(integration);
        }
      }
    }

    // Find variables that use these integrations
    for (const [varName, varConfig] of Object.entries(variablesConfig)) {
      const expr = String(varConfig.eval || '');
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
   * Get dependent variables (variables that depend on changed ones)
   */
  getDependentVariables(variablesConfig, changedVars) {
    if (!variablesConfig) return new Set();

    const changedSet = changedVars instanceof Set ? changedVars : new Set(Array.isArray(changedVars) ? changedVars : [changedVars]);
    const dependencies = this._buildDependencyGraph(variablesConfig);

    // Build reverse dependency map
    const reverseDeps = new Map();
    for (const [varName, deps] of dependencies.entries()) {
      for (const dep of deps) {
        if (!reverseDeps.has(dep)) reverseDeps.set(dep, new Set());
        reverseDeps.get(dep).add(varName);
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
}

// Singleton instance
export const variableEngine = new VariableEngine();

export default VariableEngine;
