import { 
  getFlatValue,
  setFlatValue,
  getFlatMetadata
} from "../tokenMetadata.js";
import { isDebugEnabled } from "../../debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('StatBubbles') && console.log(...args);
const debugError = (...args) => console.error(...args);
const debugWarn = (...args) => console.warn(...args);

const STAT_BUBBLES_METADATA_KEY = "com.owlbear-rodeo-bubbles-extension/metadata";

/**
 * StatBubbles Integration
 * Handles communication with the Owlbear Rodeo Stat Bubbles extension
 * Supports: health, max health, temporary health, armor class
 */

/**
 * Get a stat value from a token
 * @param {string} tokenId - Token ID to get stat from
 * @param {string} statName - Name of the stat (e.g., "health", "max health", "armor class", "temporary health")
 * @returns {Promise<number|null>} Stat value or null if not found
 */
export async function getValue(tokenId, statName) {
  try {
    return await getFlatValue(tokenId, STAT_BUBBLES_METADATA_KEY, statName);
  } catch (error) {
    debugError(`[StatBubbles] Failed to get stat "${statName}" value from token ${tokenId}:`, error.message);
    return null;
  }
}

/**
 * Set a stat value on a token
 * @param {string} tokenId - Token ID to set stat on
 * @param {string} statName - Name of the stat (e.g., "health", "max health", "armor class", "temporary health")
 * @param {number} value - Value to set
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
export async function setValue(tokenId, statName, value) {
  try {
    const success = await setFlatValue(tokenId, STAT_BUBBLES_METADATA_KEY, statName, value);
    if (success) {
      debugLog(`[StatBubbles] Set stat "${statName}" to ${value} on token ${tokenId}`);
    }
    return success;
  } catch (error) {
    debugError(`[StatBubbles] Failed to set stat "${statName}" on token ${tokenId}:`, error.message);
    return false;
  }
}

/**
 * Add to a stat value on a token (useful for health changes)
 * @param {string} tokenId - Token ID to modify stat on
 * @param {string} statName - Name of the stat (e.g., "health", "temporary health")
 * @param {number} amount - Amount to add (negative to subtract)
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
export async function addValue(tokenId, statName, amount) {
  try {
    const currentValue = await getValue(tokenId, statName);
    if (currentValue === null) {
      debugWarn(`[StatBubbles] Cannot add to stat "${statName}" - not found on token ${tokenId}`);
      return false;
    }
    
    const newValue = currentValue + amount;
    await setValue(tokenId, statName, newValue);
    debugLog(`[StatBubbles] Added ${amount} to stat "${statName}" on token ${tokenId} (${currentValue} → ${newValue})`);
    return true;
  } catch (error) {
    debugError(`[StatBubbles] Failed to add to stat "${statName}" on token ${tokenId}:`, error.message);
    return false;
  }
}

/**
 * Get all stat values from a token
 * @param {string} tokenId - Token ID to get stats from
 * @returns {Promise<Object|null>} Object with stat names as keys, or null if not found
 */
export async function getAllStats(tokenId) {
  try {
    return await getFlatMetadata(tokenId, STAT_BUBBLES_METADATA_KEY);
  } catch (error) {
    debugError(`[StatBubbles] Failed to get all stats from token ${tokenId}:`, error.message);
    return null;
  }
}

/**
 * Get current and max health as a percentage
 * @param {string} tokenId - Token ID to get health from
 * @returns {Promise<number|null>} Health percentage (0-100) or null if not found
 */
export async function getHealthPercentage(tokenId) {
  try {
    const health = await getValue(tokenId, "health");
    const maxHealth = await getValue(tokenId, "max health");
    
    if (health === null || maxHealth === null || maxHealth === 0) {
      debugWarn(`[StatBubbles] Cannot calculate health percentage for token ${tokenId}`);
      return null;
    }
    
    return Math.round((health / maxHealth) * 100);
  } catch (error) {
    debugError(`[StatBubbles] Failed to get health percentage from token ${tokenId}:`, error.message);
    return null;
  }
}

/**
 * Heal a token (add to health, capped at max health)
 * @param {string} tokenId - Token ID to heal
 * @param {number} amount - Amount to heal
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
export async function heal(tokenId, amount) {
  try {
    const health = await getValue(tokenId, "health");
    const maxHealth = await getValue(tokenId, "max health");
    
    if (health === null || maxHealth === null) {
      debugWarn(`[StatBubbles] Cannot heal token ${tokenId} - health stats not found`);
      return false;
    }
    
    const newHealth = Math.min(health + amount, maxHealth);
    await setValue(tokenId, "health", newHealth);
    debugLog(`[StatBubbles] Healed token ${tokenId} by ${amount} (${health} → ${newHealth})`);
    return true;
  } catch (error) {
    debugError(`[StatBubbles] Failed to heal token ${tokenId}:`, error.message);
    return false;
  }
}

/**
 * Damage a token (subtract from health, can go below 0)
 * @param {string} tokenId - Token ID to damage
 * @param {number} amount - Amount of damage
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
export async function damage(tokenId, amount) {
  try {
    const health = await getValue(tokenId, "health");
    
    if (health === null) {
      debugWarn(`[StatBubbles] Cannot damage token ${tokenId} - health not found`);
      return false;
    }
    
    const newHealth = health - amount;
    await setValue(tokenId, "health", newHealth);
    debugLog(`[StatBubbles] Damaged token ${tokenId} by ${amount} (${health} → ${newHealth})`);
    return true;
  } catch (error) {
    debugError(`[StatBubbles] Failed to damage token ${tokenId}:`, error.message);
    return false;
  }
}
