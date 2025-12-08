/**
 * Integrations Manager
 * Centralized management of all integrations (GSheets, Local, etc.)
 */

import LocalIntegration from "./Local.js";
import * as ConditionsMarkers from "./ConditionsMarkers.js";
import * as OwlTrackers from "./OwlTrackers.js";
import * as StatBubbles from "./StatBubbles.js";
import * as ColoredRings from "./ColoredRings.js";
import * as JustDices from "./JustDices.js";
import * as playerMetadata from "../playerMetadata.js";
import * as sceneMetadata from "../sceneMetadata.js";
import * as tokenMetadata from "../tokenMetadata.js";
import * as tokenAttachments from "../tokenAttachments.js";
import * as GoogleSheets from "./GoogleSheets.js";

class IntegrationsManager {
  constructor() {
    this.googleSheetsClient = null;
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
    
    this.googleSheetsClient = GoogleSheets.initializeGoogleSheets({
      apiKey: config.apiKey,
      sheetId: config.sheetId
    });
    console.log("[IntegrationsManager] ✓ Google Sheets client initialized");
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
      // Google Sheets integration (read-only - API keys don't support writes)
      GoogleSheets: {
        getValue: this.wrapAsync(async (sheetName, range) => {
          if (!self.googleSheetsClient) return null;
          const fullRange = `'${sheetName}'!${range}`;
          const result = await GoogleSheets.readSheetRange(self.googleSheetsClient, fullRange);
          // readSheetRange returns flattened array for single columns, or 2D array otherwise
          // For single cell, handle both cases
          if (Array.isArray(result)) {
            if (result.length === 0) return null;
            // If first element is an array, it's 2D (not flattened)
            if (Array.isArray(result[0])) {
              return result[0][0] ?? null;
            }
            // Otherwise it's flattened 1D array
            return result[0] ?? null;
          }
          return result ?? null;
        }),
        getRange: this.wrapAsync(async (sheetName, range) => {
          if (!self.googleSheetsClient) return null;
          const fullRange = `'${sheetName}'!${range}`;
          return await GoogleSheets.readSheetRange(self.googleSheetsClient, fullRange);
        }),
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
        getConditions: this.wrapAsync((tokenId) => ConditionsMarkers.getConditions(tokenId)),
        getValue: this.wrapAsync((tokenId, conditionName) => ConditionsMarkers.getValue(tokenId, conditionName)),
        hasCondition: this.wrapAsync((tokenId, conditionName) => ConditionsMarkers.hasCondition(tokenId, conditionName)),
        addCondition: this.wrapAsync((tokenId, conditionName, options) => ConditionsMarkers.addCondition(tokenId, conditionName, options)),
        removeCondition: this.wrapAsync((tokenId, conditionName) => ConditionsMarkers.removeCondition(tokenId, conditionName)),
        toggleCondition: this.wrapAsync((tokenId, conditionName) => ConditionsMarkers.toggleCondition(tokenId, conditionName)),
        clearAllConditions: this.wrapAsync((tokenId) => ConditionsMarkers.clearAllConditions(tokenId)),
      },
      // Owl Trackers integration (all async)
      OwlTrackers: {
        getValue: this.wrapAsync((tokenId, trackerName) => OwlTrackers.getValue(tokenId, trackerName)),
        getMax: this.wrapAsync((tokenId, trackerName) => OwlTrackers.getMax(tokenId, trackerName)),
        setValue: this.wrapAsync((tokenId, trackerName, value) => OwlTrackers.setValue(tokenId, trackerName, value)),
        addValue: this.wrapAsync((tokenId, trackerName, delta) => OwlTrackers.addValue(tokenId, trackerName, delta)),
      },
      // StatBubbles integration (all async)
      StatBubbles: {
        getValue: this.wrapAsync((tokenId, statName) => StatBubbles.getValue(tokenId, statName)),
        setValue: this.wrapAsync((tokenId, statName, value) => StatBubbles.setValue(tokenId, statName, value)),
        addValue: this.wrapAsync((tokenId, statName, amount) => StatBubbles.addValue(tokenId, statName, amount)),
        getAllStats: this.wrapAsync((tokenId) => StatBubbles.getAllStats(tokenId)),
        getHealthPercentage: this.wrapAsync((tokenId) => StatBubbles.getHealthPercentage(tokenId)),
        heal: this.wrapAsync((tokenId, amount) => StatBubbles.heal(tokenId, amount)),
        damage: this.wrapAsync((tokenId, amount) => StatBubbles.damage(tokenId, amount)),
      },
      // ColoredRings integration (all async)
      ColoredRings: {
        getRings: this.wrapAsync((tokenId) => ColoredRings.getRings(tokenId)),
        hasRing: this.wrapAsync((tokenId, color) => ColoredRings.hasRing(tokenId, color)),
        addRing: this.wrapAsync((tokenId, color) => ColoredRings.addRing(tokenId, color)),
        removeRing: this.wrapAsync((tokenId, color) => ColoredRings.removeRing(tokenId, color)),
      },
      // JustDices integration (all async)
      JustDices: {
        roll: this.wrapAsync((expression, hiddenOrOptions) => JustDices.roll(expression, hiddenOrOptions)),
        getRollObject: this.wrapAsync((expression, hiddenOrOptions) => JustDices.getRollObject(expression, hiddenOrOptions)),
        rollSilent: this.wrapAsync((expression, hidden) => JustDices.rollSilent(expression, hidden)),
        getRollObjectSilent: this.wrapAsync((expression, hidden) => JustDices.getRollObjectSilent(expression, hidden)),
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
