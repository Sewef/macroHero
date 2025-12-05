/**
 * Integrations Manager
 * Centralized management of all integrations (GSheets, Local, etc.)
 */

import GSheetIntegration from "./GSheetIntegration.js";
import LocalIntegration from "./LocalIntegration.js";
import * as ConditionsMarkers from "./ConditionsMarkers.js";

class IntegrationsManager {
  constructor() {
    this.gsheet = null;
    this.local = new LocalIntegration();
    console.log("[IntegrationsManager] ✓ Initialized");
  }

  /**
   * Initialize Google Sheets integration
   * @param {Object} config - { apiKey, sheetId }
   */
  initializeGSheets(config) {
    if (!config?.apiKey || !config?.sheetId) {
      console.warn("[IntegrationsManager] GSheets config missing apiKey or sheetId");
      return;
    }
    
    this.gsheet = new GSheetIntegration(config.apiKey, config.sheetId);
  }

  /**
   * Get all integrations as context for expression evaluation
   * @returns {Object} Context object with all integrations
   */
  getContext() {
    const self = this;
    return {
      // Google Sheets integration
      GSheet: {
        getValue: (sheetName, range) => self.gsheet?.getValue(sheetName, range) ?? Promise.resolve(null),
        getRange: (sheetName, range) => self.gsheet?.getRange(sheetName, range) ?? Promise.resolve(null),
      },
      // Local storage integration
      Local: {
        value: (key, defaultValue) => self.local.value(key, defaultValue),
        set: (key, value) => self.local.set(key, value),
        clear: () => self.local.clear(),
        keys: () => self.local.keys(),
      },
      // Conditions Markers integration
      ConditionsMarkers: {
        getValue: (tokenId, conditionName) => ConditionsMarkers.getValue(tokenId, conditionName),
        isCondition: (tokenId, conditionName) => ConditionsMarkers.isCondition(tokenId, conditionName),
      },
      // Math functions - exposed both under Math object and directly
      Math: {
        floor: Math.floor,
        ceil: Math.ceil,
        round: Math.round,
        abs: Math.abs,
        min: Math.min,
        max: Math.max,
      },
      // Direct math functions for convenience
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      abs: Math.abs,
      min: Math.min,
      max: Math.max,
    };
  }
}

// Create singleton instance
const manager = new IntegrationsManager();

/**
 * Initialize integrations with configuration
 * @param {Object} config - Configuration object with gsheet settings (apiKey, sheetId)
 */
export function initializeIntegrations(config) {
  // config can be the gsheet config directly (apiKey, sheetId) or wrapped in {gsheet: {...}}
  const gsheetConfig = config?.gsheet || config;
  
  if (gsheetConfig?.apiKey && gsheetConfig?.sheetId) {
    console.log("[IntegrationsManager] Initializing GSheets with config");
    manager.initializeGSheets(gsheetConfig);
  } else {
    console.warn("[IntegrationsManager] GSheets config incomplete or missing");
  }
}

/**
 * Get the integrations context for expressions
 * @returns {Object} Context object
 */
export function getIntegrationsContext() {
  return manager.getContext();
}

/**
 * Get a specific integration
 * @param {string} name - Integration name (gsheet, local)
 * @returns {Object} Integration instance
 */
export function getIntegration(name) {
  return manager[name];
}

export default manager;
