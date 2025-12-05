/**
 * Expression Helpers
 * Provides integrations context for variable expressions
 */

import { initializeIntegrations, getIntegrationsContext } from "./commands/integrations/IntegrationsManager.js";

/**
 * Initialize expression helpers with configuration
 * @param {Object} config - Configuration object with gsheet settings
 */
export function initializeExpressions(config) {
  console.log("[expressionHelpers] Initializing integrations...");
  initializeIntegrations(config);
}

/**
 * Get context for expression evaluation
 * @returns {Object} Context with all integrations
 */
export function getExpressionContext() {
  return getIntegrationsContext();
}

export default {
  initializeExpressions,
  getExpressionContext,
};

