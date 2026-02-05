/**
 * Integrations Manager
 * Centralized management of all integrations (GSheets, Local, etc.)
 */

import LocalIntegration from "./Local.js";
import * as ConditionMarkers from "./ConditionMarkers.js";
import * as OwlTrackers from "./OwlTrackers.js";
import * as StatBubbles from "./StatBubbles.js";
import * as ColoredRings from "./ColoredRings.js";
import * as JustDices from "./JustDices.js";
import * as PrettySordid from "./PrettySordid.js";
import * as playerMetadata from "../playerMetadata.js";
import * as sceneMetadata from "../sceneMetadata.js";
import * as tokenMetadata from "../tokenMetadata.js";
import * as tokenAttachments from "../tokenAttachments.js";
import * as sceneHelpers from "../sceneHelpers.js";
import * as tokenHelpers from "../tokenHelpers.js";
import * as GoogleSheets from "./GoogleSheets.js";
import * as Weather from "./Weather.js";
import * as Embers from "./Embers.js";
import { isDebugEnabled } from "../../debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('Manager') && console.log(...args);
const debugError = (...args) => console.error(...args);
const debugWarn = (...args) => console.warn(...args);

class IntegrationsManager {
  constructor() {
    this.googleSheetsClient = null;
    this.local = new LocalIntegration();
    debugLog("[IntegrationsManager] ✓ Initialized");
  }

  /**
   * Initialize Google Sheets integration
   * @param {Object} config - { apiKey, sheetId }
   */
  initializeGSheets(config) {
    if (!config?.apiKey || !config?.sheetId) {
      debugWarn("[IntegrationsManager] GSheets config missing apiKey or sheetId");
      return;
    }
    
    this.googleSheetsClient = GoogleSheets.initializeGoogleSheets({
      apiKey: config.apiKey,
      sheetId: config.sheetId
    });
    debugLog("[IntegrationsManager] ✓ Google Sheets client initialized");
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
        debugError('[IntegrationsManager] Error in async function:', error);
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
          return await GoogleSheets.getValue(self.googleSheetsClient, sheetName, range);
        }),
        getRange: this.wrapAsync(async (sheetName, range) => {
          if (!self.googleSheetsClient) return null;
          return await GoogleSheets.getRange(self.googleSheetsClient, sheetName, range);
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
      ConditionMarkers: {
        getConditions: this.wrapAsync((tokenId) => ConditionMarkers.getConditions(tokenId)),
        getValue: this.wrapAsync((tokenId, conditionName) => ConditionMarkers.getValue(tokenId, conditionName)),
        hasCondition: this.wrapAsync((tokenId, conditionName) => ConditionMarkers.hasCondition(tokenId, conditionName)),
        addCondition: this.wrapAsync((tokenId, conditionName, options) => ConditionMarkers.addCondition(tokenId, conditionName, options)),
        removeCondition: this.wrapAsync((tokenId, conditionName) => ConditionMarkers.removeCondition(tokenId, conditionName)),
        toggleCondition: this.wrapAsync((tokenId, conditionName) => ConditionMarkers.toggleCondition(tokenId, conditionName)),
        clearAllConditions: this.wrapAsync((tokenId) => ConditionMarkers.clearAllConditions(tokenId)),
      },
      // Owl Trackers integration (all async)
      OwlTrackers: {
        getValue: this.wrapAsync((tokenId, trackerName) => OwlTrackers.getValue(tokenId, trackerName)),
        getMax: this.wrapAsync((tokenId, trackerName) => OwlTrackers.getMax(tokenId, trackerName)),
        setValue: this.wrapAsync((tokenId, trackerName, value) => OwlTrackers.setValue(tokenId, trackerName, value)),
        addValue: this.wrapAsync((tokenId, trackerName, delta) => OwlTrackers.addValue(tokenId, trackerName, delta)),
        addTracker: this.wrapAsync((tokenId, trackerConfig) => OwlTrackers.addTracker(tokenId, trackerConfig)),
        removeTracker: this.wrapAsync((tokenId, trackerIdentifier) => OwlTrackers.removeTracker(tokenId, trackerIdentifier)),
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
      // PrettySordid (initiative helper)
      PrettySordid: {
        hasInitiative: this.wrapAsync((itemOrId) => PrettySordid.hasInitiative(itemOrId)),
        getInitiativeCount: this.wrapAsync((itemOrId) => PrettySordid.getInitiativeCount(itemOrId)),
        isActiveTurn: this.wrapAsync((itemOrId) => PrettySordid.isActiveTurn(itemOrId)),
        setInitiativeCount: this.wrapAsync((itemOrId, count) => PrettySordid.setInitiativeCount(itemOrId, count)),
      },
      // Weather integration (all async)
      Weather: {
        setWeather: this.wrapAsync((mapId, config) => Weather.setWeather(mapId, config)),
        removeWeather: this.wrapAsync((mapId) => Weather.removeWeather(mapId)),
        getWeather: this.wrapAsync((mapId) => Weather.getWeather(mapId)),
        hasWeather: this.wrapAsync((mapId) => Weather.hasWeather(mapId)),
        updateWeather: this.wrapAsync((mapId, updates) => Weather.updateWeather(mapId, updates)),
      },
      // Embers integration (spell visual effects - all async)
      Embers: {
        castSpellToTarget: this.wrapAsync((targets, config) => Embers.castSpellToTarget(targets, config)),
        castSpellAtToken: this.wrapAsync((tokenId, config) => Embers.castSpellAtToken(tokenId, config)),
        castProjectileSpell: this.wrapAsync((casterId, targetId, config) => Embers.castProjectileSpell(casterId, targetId, config)),
        castConeSpell: this.wrapAsync((casterId, targetId, config) => Embers.castConeSpell(casterId, targetId, config)),
      },
      // Metadata modules
      playerMetadata,
      sceneMetadata,
      tokenMetadata,
      tokenAttachments,
      sceneHelpers,
      // Token helpers - exposed directly
      createToken: this.wrapAsync((params) => tokenHelpers.createToken(params)),
      createTokens: this.wrapAsync((tokensParams) => tokenHelpers.createTokens(tokensParams)),
      getSelectedTokenId: this.wrapAsync(() => tokenHelpers.getSelectedTokenId()),
      getSelectedTokensIds: this.wrapAsync(() => tokenHelpers.getSelectedTokensIds()),
      getTokenPosition: this.wrapAsync((tokenId) => tokenHelpers.getTokenPosition(tokenId)),
      // Scene helpers - exposed directly
      getMapIdFromToken: this.wrapAsync((tokenId) => sceneHelpers.getMapIdFromToken(tokenId)),
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
    manager.initializeGSheets(gsheetConfig);
  } else if (config) {
    // Only warn if config was actually provided but incomplete
    debugWarn("[IntegrationsManager] GSheets config incomplete or missing");
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
