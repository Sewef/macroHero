/**
 * Conditions Markers Integration
 * Handles status conditions and markers on tokens (poison, stun, etc.)
 */

import OBR from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../../debugMode.js";
import { broadcastRequest } from "../shared/sdkHelpers.js";

// Debug mode constants
const logger = createDebugLogger("ConditionMarkers");

// API Channel constants
const API_REQUEST_CHANNEL = "conditionmarkers.api.request";
const API_RESPONSE_CHANNEL = "conditionmarkers.api.response";

// Metadata key constants
const MARKER_METADATA_KEY = "keegan.dev.condition-markers/metadata";
const LABEL_METADATA_KEY = "keegan.dev.condition-markers/label";

// Helper functions
/**
 * Extract condition name from condition object or string
 * @param {Object|string} condition - Condition object or string
 * @returns {string} Condition name
 */
function getConditionName(condition) {
  return condition.name ?? condition;
}

/**
 * Send an API request to condition markers service
 * @param {string} action - Action ('add' or 'remove')
 * @param {string} tokenId - Token ID
 * @param {string} conditionName - Condition name
 * @param {any} value - Optional value for add action
 * @returns {Promise<any>} API response data
 */
async function sendConditionAPIRequest(action, tokenId, conditionName, value = null) {
  const callId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = { callId, action, tokenId, condition: conditionName };
  
  if (value !== null && value !== undefined) {
    payload.value = value;
  }

  const requestResult = await broadcastRequest(
    API_REQUEST_CHANNEL,
    API_RESPONSE_CHANNEL,
    payload,
    { destination: "LOCAL", timeoutMs: 5000 }
  );

  if (!requestResult.success) {
    throw new Error(requestResult.error);
  }

  return requestResult.data;
}

/**
 * Validate token item exists
 * @param {string} tokenId - Token ID
 * @param {Array} allItems - Scene items (optional)
 * @returns {Promise<Object|null>} Token item or null
 */
async function getTokenItem(tokenId, allItems = null) {
  if (allItems) {
    return allItems.find(item => item.id === tokenId) || null;
  }
  const items = await OBR.scene.items.getItems([tokenId]);
  return items[0] || null;
}

/**
 * Get marker images attached to a token
 * @param {string} tokenId - Token ID
 * @param {Array} allSceneItems - All scene items
 * @returns {Array} Marker items
 */
function getTokenMarkers(tokenId, allSceneItems) {
  return allSceneItems.filter(item =>
    item.attachedTo === tokenId &&
    item.type === 'IMAGE' &&
    item.metadata &&
    MARKER_METADATA_KEY in item.metadata
  );
}

/**
 * Get TEXT labels for a condition from a marker
 * @param {string} markerId - Marker ID
 * @param {string} conditionName - Condition name
 * @param {Array} allSceneItems - All scene items
 * @returns {Array} Label items
 */
function getConditionLabels(markerId, conditionName, allSceneItems) {
  return allSceneItems.filter(item =>
    item.attachedTo === markerId &&
    item.type === 'TEXT' &&
    item.metadata &&
    LABEL_METADATA_KEY in item.metadata &&
    item.metadata[LABEL_METADATA_KEY]?.condition === conditionName
  );
}

/**
 * Parse numeric value from label text
 * @param {string} labelText - Label text
 * @returns {number|null} Parsed number or null
 */
function parseConditionValue(labelText) {
  if (!labelText) return null;
  const trimmed = labelText.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}


/**
 * Get conditions applied to an item
 * @param {string} itemId - Item ID
 * @returns {Promise<Array>} Array of condition objects
 */
export async function getConditions(itemId) {
  try {
    const items = await OBR.scene.items.getItems();
    const markers = items.filter(item => item.attachedTo === itemId && item.name && item.name.startsWith("Condition Marker - "));
    return markers.map(m => ({ name: m.name.replace("Condition Marker - ", "") }));
  } catch (error) {
    logger.error("Failed to get item conditions:", error);
    throw error;
  }
}

/**
 * Add a condition to an item
 * @param {string} itemId - Item ID
 * @param {string} conditionName - Condition name (e.g., "poisoned", "stunned")
 * @param {any} value - Optional plain value for the condition (number|string|boolean|null)
 * @returns {Promise<any>} API response data
 */
export async function addCondition(itemId, conditionName, value = null) {
  try {
    logger.log(`Adding condition '${conditionName}' to token ${itemId}, value: ${value}`);
    const result = await sendConditionAPIRequest('add', itemId, conditionName, value);
    logger.log(`Condition '${conditionName}' added successfully`);
    return result;
  } catch (error) {
    logger.error("Failed to add condition:", error);
    throw error;
  }
}

/**
 * Remove a condition from an item
 * @param {string} itemId - Item ID
 * @param {string} conditionName - Condition name
 * @returns {Promise<any>} API response data
 */
export async function removeCondition(itemId, conditionName) {
  try {
    logger.log(`Removing condition '${conditionName}' from token ${itemId}`);
    const result = await sendConditionAPIRequest('remove', itemId, conditionName);
    logger.log(`Condition '${conditionName}' removed successfully`);
    return result;
  } catch (error) {
    logger.error("Failed to remove condition:", error);
    throw error;
  }
}

/**
 * Toggle a condition on an item
 * @param {string} itemId - Item ID
 * @param {string} conditionName - Condition name
 * @returns {Promise<void>}
 */
export async function toggleCondition(itemId, conditionName) {
  try {
    const conditions = await getConditions(itemId);
    const hasCondition = conditions.some(c => getConditionName(c) === conditionName);

    if (hasCondition) {
      await removeCondition(itemId, conditionName);
    } else {
      await addCondition(itemId, conditionName);
    }
  } catch (error) {
    logger.error("Failed to toggle condition:", error);
    throw error;
  }
}

/**
 * Clear all conditions from an item
 * @param {string} itemId - Item ID
 * @returns {Promise<void>}
 */
export async function clearAllConditions(itemId) {
  try {
    const conditions = await getConditions(itemId);
    for (const condition of conditions) {
      await removeCondition(itemId, getConditionName(condition));
    }
  } catch (error) {
    logger.error("Failed to clear conditions:", error);
    throw error;
  }
}

/**
 * Check if an item has a specific condition
 * @param {string} itemId - Item ID
 * @param {string} conditionName - Condition name
 * @returns {Promise<boolean>} Whether item has condition
 */
export async function hasCondition(itemId, conditionName) {
  try {
    const conditions = await getConditions(itemId);
    return conditions.some(c => getConditionName(c) === conditionName);
  } catch (error) {
    logger.error("Failed to check condition:", error);
    throw error;
  }
}

/**
 * Get the value (text) of a condition label
 * Finds the TEXT attachment on a condition marker and returns its plainText
 * @param {string} tokenId - Token ID
 * @param {string} conditionName - Name of the condition (e.g., "Bandaged")
 * @param {Array} allItems - All scene items (optional, will fetch if not provided)
 * @returns {Promise<number|null>} Numeric value of the label, or null if not found or non-numeric
 */
export async function getValue(tokenId, conditionName, allItems = null) {
  try {
    const tokenItem = await getTokenItem(tokenId, allItems);
    if (!tokenItem) return null;

    const allSceneItems = allItems || await OBR.scene.items.getItems();
    const markers = getTokenMarkers(tokenId, allSceneItems);

    // Check each marker for labels matching the condition
    for (const marker of markers) {
      const labels = getConditionLabels(marker.id, conditionName, allSceneItems);
      if (labels.length > 0) {
        const labelText = labels[0].text?.plainText;
        return parseConditionValue(labelText);
      }
    }

    return null;
  } catch (error) {
    logger.error(`Failed to get condition value:`, error);
    return null;
  }
}

export default {
  getConditions,
  addCondition,
  removeCondition,
  toggleCondition,
  clearAllConditions,
  hasCondition,
  getValue
};

