/**
 * Integrations Manager
 * Centralized management of all integrations (GSheets, Local, etc.)
 */

import GSheetIntegration from "./GSheet.js";
import LocalIntegration from "./Local.js";
import * as ConditionsMarkers from "./ConditionsMarkers.js";
import * as OwlTrackers from "./OwlTrackers.js";
import * as playerMetadata from "../playerMetadata.js";
import * as sceneMetadata from "../sceneMetadata.js";
import * as tokenMetadata from "../tokenMetadata.js";
import * as tokenAttachments from "../tokenAttachments.js";
import * as GoogleSheets from "./GoogleSheets.js";

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
   * Wrap an async function to ensure it's properly awaitable
   * @param {Function} fn - The function to wrap
   * @returns {Function} Wrapped function that always returns a promise
   */
  wrapAsync(fn) {
    return async (...args) => {
      try {
        let result = fn(...args);
        result = result instanceof Promise ? await result : result;
        
        // Fix floating-point precision issues for numeric results
        if (typeof result === 'number' && !Number.isInteger(result)) {
          // Round to 10 decimal places to eliminate floating-point errors
          // while preserving intentional decimal values
          result = Math.round(result * 1e10) / 1e10;
        }
        
        return result;
      } catch (error) {
        console.error('[IntegrationsManager] Error in async function:', error);
        return null;
      }
    };
  }

  /**
   * Get all integrations as context for expression evaluation
   * All async methods are wrapped to ensure proper promise handling
   * @returns {Object} Context object with all integrations
   */
  getContext() {
    const self = this;
    return {
      // Google Sheets integration
      GoogleSheets: {
        getValue: this.wrapAsync((sheetName, range) => self.gsheet?.getValue(sheetName, range) ?? Promise.resolve(null)),
        getRange: this.wrapAsync((sheetName, range) => self.gsheet?.getRange(sheetName, range) ?? Promise.resolve(null)),
      },
      // Local storage integration
      Local: {
        value: (key, defaultValue) => self.local.value(key, defaultValue),
        set: (key, value) => self.local.set(key, value),
        clear: () => self.local.clear(),
        keys: () => self.local.keys(),
      },
      // Conditions Markers integration (all async)
      ConditionsMarkers: {
        getValue: this.wrapAsync((tokenId, conditionName) => ConditionsMarkers.getValue(tokenId, conditionName)),
        isCondition: this.wrapAsync((tokenId, conditionName) => ConditionsMarkers.isCondition(tokenId, conditionName)),
      },
      // Owl Trackers integration (all async)
      OwlTrackers: {
        getValue: this.wrapAsync((tokenId, trackerName) => OwlTrackers.getValue(tokenId, trackerName)),
        setValue: this.wrapAsync((tokenId, trackerName, value) => OwlTrackers.setValue(tokenId, trackerName, value)),
        addValue: this.wrapAsync((tokenId, trackerName, delta) => OwlTrackers.addValue(tokenId, trackerName, delta)),
      },
      // Metadata modules
      playerMetadata,
      sceneMetadata,
      tokenMetadata,
      tokenAttachments,
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
