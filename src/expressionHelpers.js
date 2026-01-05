/**
 * Expression Helpers
 * Provides integrations context for variable expressions
 */

import { initializeIntegrations, getIntegrationsContext } from "./commands/integrations/Manager.js";
import { isDebugEnabled } from "./debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('expressionHelpers') && console.log(...args);

/**
 * Initialize expression helpers with configuration
 * @param {Object} config - Configuration object with gsheet settings
 */
export function initializeExpressions(config) {
  debugLog("[expressionHelpers] Initializing integrations...");
  initializeIntegrations(config);
  // Cache the context on init; reset async methods so they can be recomputed
  cachedContext = null;
  invalidateAsyncMethodsCache();
}

// Add lightweight caching to avoid recomputing context and async method list on every evaluation
let cachedContext = null;
let cachedAsyncMethods = null;
let contextInitCounter = 0; // Track context resets to invalidate cache

export function getExpressionContext() {
  // Return cached context if available; integrations Manager returns a stable object per init
  if (!cachedContext) {
    cachedContext = getIntegrationsContext();
  }
  return cachedContext;
}

/**
 * Invalidate async methods cache when context is reinitialized
 * Called from initializeExpressions
 */
export function invalidateAsyncMethodsCache() {
  cachedAsyncMethods = null;
  contextInitCounter++;
}

/**
 * Get a cached list of async method paths (e.g., "OwlTrackers.getValue") derived from integrations context.
 * This avoids scanning the context objects on every expression evaluation.
 */
export function getAsyncMethods() {
  if (cachedAsyncMethods) return cachedAsyncMethods;

  const contextObj = getExpressionContext();
  const methods = [];

  for (const [objectName, objectValue] of Object.entries(contextObj)) {
    if (typeof objectValue === "object" && objectValue !== null) {
      for (const [methodName, methodValue] of Object.entries(objectValue)) {
        if (typeof methodValue === "function") {
          const methodStr = methodValue.toString();
          if (methodStr.startsWith("async ") || methodStr.includes("Promise")) {
            methods.push(`${objectName}.${methodName}`);
          }
        }
      }
    }
  }

  cachedAsyncMethods = methods;
  return cachedAsyncMethods;
}

export default {
  initializeExpressions,
  getExpressionContext,
  getAsyncMethods,
};

