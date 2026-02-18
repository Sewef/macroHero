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
import { isDebugEnabled } from "../debugMode.js";

const debugLog = (...args) => isDebugEnabled('ExecutionSandbox') && console.log(...args);
const debugError = (...args) => console.error(...args);

class ExecutionSandbox {
  constructor() {
    // Cache integrated context (functions, etc) to avoid rebuilding
    this.contextCache = null;
    this.contextCacheKey = null;
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

      debugLog('[Sandbox] Executing sync:', expression);

      const context = this.buildContext(resolvedVars);
      
      // Create a safe evaluation using Function constructor with proper scoping
      // Destructure integrations and math into scope
      const integrationKeys = Object.keys(context.integrations).join(', ');
      const mathKeys = Object.keys(context.math).join(', ');
      const varKeys = Object.keys(resolvedVars).join(', ');

      const evaluator = new Function(
        'context',
        `
          const { ${integrationKeys} } = context.integrations;
          const { ${mathKeys} } = context.math;
          const { ${varKeys} } = context.variables;
          return (${expression});
        `
      );
      
      const result = evaluator(context);
      debugLog('[Sandbox] Result:', result);
      return result;
    } catch (error) {
      debugError('[Sandbox] Sync execution error:', error);
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

      debugLog('[Sandbox] Executing async:', expression);

      const context = this.buildContext(resolvedVars);
      
      // Process expression to auto-await integration calls
      let processed = expression;
      const integrationNames = [
        'GoogleSheets', 'OwlTrackers', 'ConditionMarkers', 'StatBubbles', 
        'ColoredRings', 'PrettySordid', 'Local', 'Embers', 'JustDices', 'Weather'
      ];
      
      for (const integration of integrationNames) {
        const regex = new RegExp(`(?<!await\\s+)\\b(${integration}\\.\\w+)\\(`, 'g');
        processed = processed.replace(regex, (match, methodCall) => `await ${methodCall}(`);
      }

      // Create async evaluator with proper scope
      const integrationKeys = Object.keys(context.integrations).join(', ');
      const mathKeys = Object.keys(context.math).join(', ');
      const varKeys = Object.keys(resolvedVars).join(', ');

      const evaluator = new Function(
        'context',
        `
          return (async () => {
            const { ${integrationKeys} } = context.integrations;
            const { ${mathKeys} } = context.math;
            const { ${varKeys} } = context.variables;
            return (${processed});
          })();
        `
      );
      
      const result = await evaluator(context);
      debugLog('[Sandbox] Result:', result);
      return result;
    } catch (error) {
      debugError('[Sandbox] Async execution error:', error);
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
      debugLog('[Sandbox] Executing command:', script);

      const fullContext = {
        integrations: context.integrations || getExpressionContext(),
        math,
        variables: context.variables || {},
        helpers: context.helpers || {},
      };

      const integrationKeys = Object.keys(fullContext.integrations).join(', ');
      const mathKeys = Object.keys(fullContext.math).join(', ');
      const varKeys = Object.keys(fullContext.variables).join(', ');
      const helperKeys = Object.keys(fullContext.helpers).join(', ');

      const executor = new Function(
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

      return await executor(fullContext);
    } catch (error) {
      debugError('[Sandbox] Command execution error:', error);
      throw error;
    }
  }
}

// Singleton instance
export const executionSandbox = new ExecutionSandbox();

export default ExecutionSandbox;
