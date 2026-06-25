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
const API_REQUEST_CHANNEL = "keegan.dev.condition-markers/api.request";
const API_RESPONSE_CHANNEL = "keegan.dev.condition-markers/api.response";

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
 * @param {string} action - Action ('addCondition', 'removeCondition', 'removeAllConditions', 'getTokenConditions', 'getAvailableConditions')
 * @param {string} tokenId - Token ID
 * @param {string} conditionName - Condition name
 * @returns {Promise<any>} API response data
 */
async function sendAPIRequest(action, tokenId, conditionName, value = null) {
  const normalizedAction = {
    add: "addCondition",
    remove: "removeCondition",
  }[action] || action;

  const payload = { action: normalizedAction };

  if (normalizedAction !== "getAvailableConditions") {
    payload.data = { tokenId };
    if (conditionName !== null && conditionName !== undefined) {
      payload.data.condition = conditionName;
    }
    if (value !== null && value !== undefined) {
      payload.data.value = value;
    }
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

  const response = requestResult.data;

  if (response?.action !== normalizedAction) {
    throw new Error(`Unexpected ConditionMarkers API response: ${response?.action ?? "unknown"}`);
  }

  if (!response.success) {
    throw new Error(response.message || "ConditionMarkers API request failed");
  }

  return response.data ?? response;
}

/**
 * Get conditions applied to an item
 * @param {string} itemId - Item ID
 * @returns {Promise<Array>} Array of condition objects
 */
export async function getConditions(itemId) {
  try {
    const result = await sendAPIRequest("getTokenConditions", itemId);
    return (result.conditions || []).map(condition => ({ name: condition }));
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
    const result = await sendAPIRequest('addCondition', itemId, conditionName, value);
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
    const result = await sendAPIRequest('removeCondition', itemId, conditionName);
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
    await sendAPIRequest("removeAllConditions", itemId);
  } catch (error) {
    if (error.message === "No conditions found on token") {
      return;
    }
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
    const result = await sendAPIRequest("getValue", tokenId, conditionName);
    return result.value;
  } catch (error) {
    logger.error("Failed to get condition value:", error);
    throw error;
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

