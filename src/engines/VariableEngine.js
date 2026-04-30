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
import { createDebugLogger } from "../debugMode.js";
import { ASYNC_INTEGRATION_NAMES } from "../constants.js";

const logger = createDebugLogger('VariableEngine');

// Cache for dependency graphs
const dependencyCache = new WeakMap();

// Pre-compiled regex patterns
const REGEX_PATTERNS = {
  awaitKeyword: /\bawait\s+/,
  thisReference: /\bthis\.(\w+)/g,
  variableIdentifier: /\b([a-z_][a-zA-Z0-9_]*)\b/g,
};

// Build integration detection regex map
const INTEGRATION_REGEX_MAP = new Map();
ASYNC_INTEGRATION_NAMES.forEach(name => {
  INTEGRATION_REGEX_MAP.set(name, new RegExp(`\\b${name}\\.\\w+`, 'g'));
});

class VariableEngine {
  constructor() {
    // Event listeners for variable changes
    this.variableListeners = new Map();
  }

  /**
   * Register a listener for variable changes
   * @param {string} varName - Variable name
   * @param {Function} callback - Called when variable changes: (oldValue, newValue) => {}
   * @returns {Function} Unsubscribe function
   */
  onVariableChange(varName, callback) {
    if (!this.variableListeners.has(varName)) {
      this.variableListeners.set(varName, []);
    }
    
    const listeners = this.variableListeners.get(varName);
    listeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }

  /**
   * Notify listeners about variable change
   */
  _notifyVariableChange(varName, oldValue, newValue) {
    if (this.variableListeners.has(varName)) {
      const listeners = this.variableListeners.get(varName);
      for (const callback of listeners) {
        try {
          callback(oldValue, newValue);
        } catch (error) {
          logger.error(`Error in listener for ${varName}:`, error);
        }
      }
    }
  }

  /**
   * Track variable dependencies by executing with a tracking Proxy
   * More reliable than regex-based detection
   * @param {string} expression - Expression to analyze
   * @param {Object} variablesConfig - Variable definitions (needed for structure)
   * @returns {Set} Set of variable names actually used
   */
  _trackDependencies(expression, variablesConfig = {}) {
    const trackedVars = new Set();
    const varNames = Object.keys(variablesConfig || {});

    // Create a proxy that tracks property access
    const trackingProxy = new Proxy({}, {
      get: (target, prop) => {
        const propStr = String(prop);
        // Only track if it's a known variable
        if (varNames.includes(propStr)) {
          trackedVars.add(propStr);
        }
        // Return undefined or a nested proxy for chaining
        return new Proxy({}, {
          get: () => undefined,
          has: () => false,
        });
      },
      has: (target, prop) => {
        const propStr = String(prop);
        if (varNames.includes(propStr)) {
          trackedVars.add(propStr);
        }
        return false;
      },
    });

    try {
      // Try to parse and track variable access
      // Create a minimal context
      const context = {
        variables: trackingProxy,
      };

      // Execute the expression in a try-catch to handle errors gracefully
      new Function('variables', `return (${expression});`)(trackingProxy);
    } catch (error) {
      // If execution fails, fall back to regex-based detection
      logger.log("Tracking failed, falling back to regex detection", error.message);
      
      // Fallback: use simple substring matching for known variables
      for (const varName of varNames) {
        if (expression.includes(varName)) {
          trackedVars.add(varName);
        }
      }
    }

    return trackedVars;
  }

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

      logger.log("Evaluating expression");

      // Detect if async is needed
      const hasAsync = this._hasAsyncCall(expression);

      // Execute through sandbox
      const result = hasAsync
        ? await executionSandbox.executeAsync(expression, resolvedVars)
        : executionSandbox.executeSync(expression, resolvedVars);

      return result;
    } catch (error) {
      logger.error('Evaluation error:', error);
      return null;
    }
  }

  /**
   * Check if expression has async calls
   */
  _hasAsyncCall(expression) {
    if (REGEX_PATTERNS.awaitKeyword.test(expression)) return true;
    
    // Check if any integration is used
    for (const [integrationName, regex] of INTEGRATION_REGEX_MAP.entries()) {
      if (regex.test(expression)) {
        // Reset regex state for next test
        regex.lastIndex = 0;
        return true;
      }
    }
    
    return false;
  }

  /**
   * Build and cache dependency graph using execution tracking
   * More reliable than static regex analysis
   */
  _buildDependencyGraph(variablesConfig) {
    // Check cache first
    if (dependencyCache.has(variablesConfig)) {
      return dependencyCache.get(variablesConfig);
    }

    const dependencies = new Map();
    const varNames = Object.keys(variablesConfig || {});

    for (const [varName, varConfig] of Object.entries(variablesConfig || {})) {
      const deps = [];

      if (varConfig.eval) {
        const expr = String(varConfig.eval);

        // Use tracking to detect actual dependencies
        let trackedDeps = this._trackDependencies(expr, variablesConfig);

        // Filter out self-references
        for (const depVar of trackedDeps) {
          if (depVar !== varName && !deps.includes(depVar)) {
            deps.push(depVar);
          }
        }

        // Fallback: if tracking found nothing, use this.varName references as backup
        if (deps.length === 0) {
          const thisRefs = expr.match(REGEX_PATTERNS.thisReference) || [];
          for (const ref of thisRefs) {
            const depVar = ref.replace('this.', '');
            if (depVar in variablesConfig && depVar !== varName) {
              deps.push(depVar);
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
        const oldValue = resolved[varName];

        if (varConfig.value !== undefined) {
          value = varConfig.value;
        } else if (varConfig.eval !== undefined) {
          value = await this.evaluateExpression(varConfig.eval, resolved);
        } else {
          value = null;
        }

        resolved[varName] = value;

        // Notify listeners and emit event for variable resolution
        if (oldValue !== value) {
          this._notifyVariableChange(varName, oldValue, value);
        }
        eventBus.emit('engine:variableResolved', varName, value);
      } catch (error) {
        logger.error('Error resolving variable:', varName, error);
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
      // Match variable identifiers using pre-compiled regex
      const matches = cmdStr.matchAll(REGEX_PATTERNS.variableIdentifier);
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
      const cmdStr = String(cmd);
      for (const [integration, regex] of INTEGRATION_REGEX_MAP.entries()) {
        if (regex.test(cmdStr)) {
          integrationCalls.add(integration);
          regex.lastIndex = 0; // Reset regex state
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

