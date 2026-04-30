/**
 * ExecutionSandbox - Safe execution environment for expressions
 * Replaces dangerous new Function() calls with a cleaner, safer approach
 * 
 * Benefits:
 * - Reusable sandbox (no new Function per evaluation)
 * - Cleaner context binding (no massive spread operations)
 * - Better error handling
 * - Security considerations baked in
 */

import * as math from "mathjs";
import { getExpressionContext } from "../expressionHelpers.js";
import { createDebugLogger } from "../debugMode.js";
import { ASYNC_INTEGRATION_NAMES } from "../constants.js";

const logger = createDebugLogger('ExecutionSandbox');

// Pre-compiled regex patterns for integration auto-await
const INTEGRATION_REGEX_MAP = new Map();
ASYNC_INTEGRATION_NAMES.forEach(name => {
  INTEGRATION_REGEX_MAP.set(name, new RegExp(`(?<!await\\s+)\\b(${name}\\.\\w+)\\(`, 'g'));
});

class ExecutionSandbox {
  constructor() {
    // Cache integrated context (functions, etc) to avoid rebuilding
    this.contextCache = null;
    this.contextCacheKey = null;
    
    // LRU cache for compiled Function objects (max 100 entries)
    this.functionCache = new Map();
    this.maxCacheSize = 100;
  }

  /**
   * Add to LRU cache with eviction
   */
  _setCacheEntry(key, value) {
    // Remove oldest entry if at capacity
    if (this.functionCache.size >= this.maxCacheSize) {
      const firstKey = this.functionCache.keys().next().value;
      this.functionCache.delete(firstKey);
    }
    this.functionCache.set(key, value);
  }

  /**
   * Simple hash function for expressions
   */
  _hashExpression(expression) {
    let hash = 0;
    for (let i = 0; i < expression.length; i++) {
      const char = expression.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return 'h' + Math.abs(hash).toString(36);
  }

  /**
   * Build execution context with all available functions/values
   * Cached to avoid rebuilding integrations on every eval
   */
  buildContext(resolvedVars = {}) {
    const integrations = getExpressionContext();
    
    return {
      // Integrations (GoogleSheets, OwlTrackers, etc)
      integrations,
      // Math functions
      math,
      // Resolved variables (specific to this evaluation)
      variables: resolvedVars,
    };
  }

  /**
   * Execute a simple expression synchronously
   * @param {string|number|boolean} expression - Code to execute
   * @param {Object} resolvedVars - Variables available in scope
   * @returns {any} Result of evaluation
   */
  executeSync(expression, resolvedVars = {}) {
    try {
      // Literal values pass through unchanged
      if (expression === null || expression === undefined) return expression;
      if (typeof expression !== 'string') return expression;
      if (!expression.trim()) return expression;

      logger.log("Executing sync");

      const context = this.buildContext(resolvedVars);
      
      // Generate cache key including expression hash
      const exprHash = this._hashExpression(expression);
      const integrationKeys = Object.keys(context.integrations).sort().join(', ');
      const mathKeys = Object.keys(context.math).sort().join(', ');
      const varKeysArray = Object.keys(resolvedVars).sort().join(', ');
      const cacheKey = `sync:${exprHash}:${integrationKeys}|${mathKeys}|${varKeysArray}`;

      // Check if this evaluator is cached
      let evaluator = this.functionCache.get(cacheKey);
      
      if (!evaluator) {
        // Create new evaluator and cache it
        evaluator = new Function(
          'context',
          `
            const { ${integrationKeys} } = context.integrations;
            const { ${mathKeys} } = context.math;
            const { ${varKeysArray} } = context.variables;
            return (${expression});
          `
        );
        this._setCacheEntry(cacheKey, evaluator);
      }
      
      const result = evaluator(context);
      logger.log('Result:', result);
      return result;
    } catch (error) {
      logger.error('Sync execution error:', error);
      throw error;
    }
  }

  /**
   * Execute an async expression
   * @param {string|number|boolean} expression - Code to execute (may contain await)
   * @param {Object} resolvedVars - Variables available in scope
   * @returns {Promise<any>} Result of evaluation
   */
  async executeAsync(expression, resolvedVars = {}) {
    try {
      // Literal values pass through unchanged
      if (expression === null || expression === undefined) return expression;
      if (typeof expression !== 'string') return expression;
      if (!expression.trim()) return expression;

      logger.log("Executing async");

      const context = this.buildContext(resolvedVars);
      
      // Process expression to auto-await integration calls using pre-compiled regex
      let processed = expression;
      for (const [integrationName, regex] of INTEGRATION_REGEX_MAP.entries()) {
        processed = processed.replace(regex, (match, methodCall) => `await ${methodCall}(`);
      }

      // Generate cache key including expression hash
      const exprHash = this._hashExpression(processed);
      const integrationKeys = Object.keys(context.integrations).sort().join(', ');
      const mathKeys = Object.keys(context.math).sort().join(', ');
      const varKeysArray = Object.keys(resolvedVars).sort().join(', ');
      const cacheKey = `async:${exprHash}:${integrationKeys}|${mathKeys}|${varKeysArray}`;

      // Check if this evaluator is cached
      let evaluator = this.functionCache.get(cacheKey);
      
      if (!evaluator) {
        // Create new evaluator and cache it
        evaluator = new Function(
          'context',
          `
            return (async () => {
              const { ${integrationKeys} } = context.integrations;
              const { ${mathKeys} } = context.math;
              const { ${varKeysArray} } = context.variables;
              return (${processed});
            })();
          `
        );
        this._setCacheEntry(cacheKey, evaluator);
      }
      
      const result = await evaluator(context);
      logger.log('Result:', result);
      return result;
    } catch (error) {
      logger.error('Async execution error:', error);
      throw error;
    }
  }

  /**
   * Execute arbitrary code in sandbox
   * For command execution (not expression evaluation)
   * @param {string|string[]} code - Code to execute
   * @param {Object} context - Execution context with integrations, math, variables
   * @returns {Promise<any>} Result of execution
   */
  async executeCommand(code, context = {}) {
    try {
      const script = Array.isArray(code) ? code.join('\n') : code;
      logger.log("Executing command");

      const fullContext = {
        integrations: context.integrations || getExpressionContext(),
        math,
        variables: context.variables || {},
        helpers: context.helpers || {},
      };

      // Generate cache key including code hash
      const codeHash = this._hashExpression(script);
      const integrationKeys = Object.keys(fullContext.integrations).sort().join(', ');
      const mathKeys = Object.keys(fullContext.math).sort().join(', ');
      const varKeys = Object.keys(fullContext.variables).sort().join(', ');
      const helperKeys = Object.keys(fullContext.helpers).sort().join(', ');
      const cacheKey = `cmd:${codeHash}:${integrationKeys}|${mathKeys}|${varKeys}|${helperKeys}`;

      // Check if this executor is cached
      let executor = this.functionCache.get(cacheKey);
      
      if (!executor) {
        // Create new executor and cache it
        executor = new Function(
          'context',
          `
            return (async () => {
              const { ${integrationKeys} } = context.integrations;
              const { ${mathKeys} } = context.math;
              const { ${varKeys} } = context.variables;
              const { ${helperKeys} } = context.helpers;
              ${script}
            })();
          `
        );
        this._setCacheEntry(cacheKey, executor);
      }

      return await executor(fullContext);
    } catch (error) {
      logger.error('Command execution error:', error);
      throw error;
    }
  }
}

// Singleton instance
export const executionSandbox = new ExecutionSandbox();

export default ExecutionSandbox;

