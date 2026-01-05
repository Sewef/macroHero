import { 
  getValue as getMetadataValue,
  setValue as setMetadataValue,
  addValue as addMetadataValue,
  getTokenMetadataValue
} from "../tokenMetadata.js";
import { isDebugEnabled } from "../../debugMode.js";

// Debug mode constants
const DEBUG_MODE_STATIC = false;
const debugLog = (...args) => isDebugEnabled('OwlTrackers') && console.log(...args);
const debugError = (...args) => isDebugEnabled('OwlTrackers') && console.error(...args);
const debugWarn = (...args) => isDebugEnabled('OwlTrackers') && console.warn(...args);

const TRACKERS_METADATA_KEY = "com.owl-trackers/trackers";

/**
 * Owl-Trackers Integration
 * Handles communication with the Owl-Trackers extension for status/condition tracking
 */

/**
 * Get a tracker value from a token
 * @param {string} tokenId - Token ID to get tracker from
 * @param {string} trackerName - Name of the tracker (e.g., "HP")
 * @returns {Promise<number|null>} Tracker value or null if not found
 */
export async function getValue(tokenId, trackerName) {
  try {
    const value = await getMetadataValue(tokenId, TRACKERS_METADATA_KEY, trackerName);
    if (value === null) {
      debugWarn(`[OwlTrackers] Tracker "${trackerName}" not found on token ${tokenId}`);
    }
    return value;
  } catch (error) {
    debugError(`[OwlTrackers] Failed to get tracker "${trackerName}" value from token ${tokenId}:`, error.message);
    return null;
  }
}

/**
 * Get a tracker's maximum value from a token
 * @param {string} tokenId - Token ID to get tracker from
 * @param {string} trackerName - Name of the tracker (e.g., "HP")
 * @returns {Promise<number|null>} Tracker max value or null if not found
 */
export async function getMax(tokenId, trackerName) {
  try {
    const trackers = await getTokenMetadataValue(tokenId, TRACKERS_METADATA_KEY);
    if (!Array.isArray(trackers)) {
      debugWarn(`[OwlTrackers] No trackers found on token ${tokenId}`);
      return null;
    }
    
    const tracker = trackers.find(t => t.name === trackerName);
    if (!tracker) {
      debugWarn(`[OwlTrackers] Tracker "${trackerName}" not found on token ${tokenId}`);
      return null;
    }
    
    return tracker.max ?? null;
  } catch (error) {
    debugError(`[OwlTrackers] Failed to get tracker "${trackerName}" max from token ${tokenId}:`, error.message);
    return null;
  }
}

/**
 * Set a tracker value on a token
 * @param {string} tokenId - Token ID
 * @param {string} trackerName - Tracker name
 * @param {number} value - Value to set
 * @returns {Promise<void>}
 */
export async function setValue(tokenId, trackerName, value) {
  return await setMetadataValue(tokenId, TRACKERS_METADATA_KEY, trackerName, value);
}

/**
 * Add/increment a tracker value (can be negative to subtract)
 * @param {string} tokenId - Token ID
 * @param {string} trackerName - Tracker name
 * @param {number} delta - Amount to add (can be negative)
 * @returns {Promise<void>}
 */
export async function addValue(tokenId, trackerName, delta = 1) {
  debugLog(`[OwlTrackers.addValue] Called with tokenId=${tokenId}, trackerName=${trackerName}, delta=${delta}`);
  const currentValue = await getValue(tokenId, trackerName);
  debugLog(`[OwlTrackers.addValue] Current value for ${trackerName}: ${currentValue}`);
  
  if (currentValue === null) {
    debugWarn(`[OwlTrackers] Tracker "${trackerName}" not found on token ${tokenId}. Cannot add to non-existent tracker.`);
    return;
  }
  
  const newValue = currentValue + Number(delta);
  debugLog(`[OwlTrackers.addValue] Setting ${trackerName} to ${newValue} (was ${currentValue})`);
  await setValue(tokenId, trackerName, newValue);
  debugLog(`[OwlTrackers.addValue] Complete`);
}

export default {
  getValue,
  getMax,
  setValue,
  addValue
};
