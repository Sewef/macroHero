import { 
  getValue as getMetadataValue,
  setValue as setMetadataValue,
  addValue as addMetadataValue,
  getTokenMetadataValue,
  setTokenMetadata
} from "../tokenMetadata.js";
import { isDebugEnabled } from "../../debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('OwlTrackers') && console.log(...args);
const debugError = (...args) => console.error(...args);
const debugWarn = (...args) => console.warn(...args);

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

/**
 * Create a unique ID for a tracker
 * @returns {string} Unique tracker ID
 */
function createTrackerId() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/**
 * Determine color for a new tracker based on existing trackers
 * @param {Array} trackers - Existing trackers array
 * @param {string} variant - Tracker variant type
 * @returns {number} Color number (0-8)
 */
function createTrackerColor(trackers, variant) {
  const count = trackers.filter(t => t.variant === variant).length;
  
  if (variant === "value") return (5 + count * 2) % 9;
  if (variant === "counter") return (6 + count * 2) % 9;
  if (variant === "value-max") return (2 + count * 4) % 9;
  return (2 + count * 2) % 9;
}

/**
 * Add a tracker to a token
 * @param {string} tokenId - Token ID
 * @param {Object} trackerConfig - Tracker configuration object
 * @param {string} trackerConfig.variant - Tracker type: "value", "value-max", "counter", or "checkbox"
 * @param {string} [trackerConfig.name] - Display name of the tracker
 * @param {number} [trackerConfig.color] - Color index (0-8), auto-assigned if not provided
 * @param {number} [trackerConfig.value] - Initial value (for value, value-max, counter)
 * @param {number} [trackerConfig.max] - Maximum value (for value-max only)
 * @param {boolean} [trackerConfig.checked] - Initial state (for checkbox only)
 * @param {boolean} [trackerConfig.showOnMap=true] - Whether to show on map
 * @param {boolean} [trackerConfig.inlineMath=false] - Whether to enable inline math
 * @returns {Promise<string|null>} The tracker ID if created, null on failure
 */
export async function addTracker(tokenId, trackerConfig) {
  try {
    const { variant, name, color, value, max, checked, showOnMap = true, inlineMath = false } = trackerConfig;
    
    if (!variant) {
      debugError(`[OwlTrackers.addTracker] Missing required "variant" field`);
      return null;
    }
    
    // Get existing trackers
    let trackers = await getTokenMetadataValue(tokenId, TRACKERS_METADATA_KEY);
    if (!Array.isArray(trackers)) {
      trackers = [];
    }
    
    // Create new tracker object
    const trackerId = createTrackerId();
    const newTracker = {
      id: trackerId,
      variant,
      color: color !== undefined ? color : createTrackerColor(trackers, variant),
      showOnMap,
      inlineMath
    };
    
    // Add name if provided
    if (name !== undefined) {
      newTracker.name = name;
    }
    
    // Add variant-specific fields
    if (variant === "value") {
      newTracker.value = value !== undefined ? value : 0;
    } else if (variant === "value-max") {
      newTracker.value = value !== undefined ? value : 0;
      newTracker.max = max !== undefined ? max : 0;
    } else if (variant === "counter") {
      newTracker.value = value !== undefined ? value : 0;
    } else if (variant === "checkbox") {
      newTracker.checked = checked !== undefined ? checked : false;
    } else {
      debugError(`[OwlTrackers.addTracker] Invalid variant "${variant}". Must be: value, value-max, counter, or checkbox`);
      return null;
    }
    
    // Add tracker to array
    trackers.push(newTracker);
    
    // Update token metadata
    await setTokenMetadata(tokenId, TRACKERS_METADATA_KEY, trackers);
    
    debugLog(`[OwlTrackers.addTracker] Added ${variant} tracker "${name || 'unnamed'}" with ID ${trackerId} to token ${tokenId}`);
    return trackerId;
    
  } catch (error) {
    debugError(`[OwlTrackers.addTracker] Failed to add tracker to token ${tokenId}:`, error.message);
    return null;
  }
}

/**
 * Remove a tracker from a token by name or ID
 * @param {string} tokenId - Token ID
 * @param {string} trackerIdentifier - Tracker name or ID to remove
 * @returns {Promise<boolean>} True if removed, false if not found or error
 */
export async function removeTracker(tokenId, trackerIdentifier) {
  try {
    const trackers = await getTokenMetadataValue(tokenId, TRACKERS_METADATA_KEY);
    
    if (!Array.isArray(trackers)) {
      debugWarn(`[OwlTrackers.removeTracker] No trackers found on token ${tokenId}`);
      return false;
    }
    
    // Find tracker by name or ID
    const initialLength = trackers.length;
    const updatedTrackers = trackers.filter(t => 
      t.name !== trackerIdentifier && t.id !== trackerIdentifier
    );
    
    if (updatedTrackers.length === initialLength) {
      debugWarn(`[OwlTrackers.removeTracker] Tracker "${trackerIdentifier}" not found on token ${tokenId}`);
      return false;
    }
    
    // Update token metadata
    await setTokenMetadata(tokenId, TRACKERS_METADATA_KEY, updatedTrackers);
    
    debugLog(`[OwlTrackers.removeTracker] Removed tracker "${trackerIdentifier}" from token ${tokenId}`);
    return true;
    
  } catch (error) {
    debugError(`[OwlTrackers.removeTracker] Failed to remove tracker from token ${tokenId}:`, error.message);
    return false;
  }
}

export default {
  getValue,
  getMax,
  setValue,
  addValue,
  addTracker,
  removeTracker
};
