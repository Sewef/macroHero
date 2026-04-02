/**
 * Conditions Markers Integration
 * Handles status conditions and markers on tokens (poison, stun, etc.)
 */

import OBR from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../../debugMode.js";
import * as BroadcastHelpers from "../shared/broadcastHelpers.js";

// Debug mode constants
const logger = createDebugLogger("ConditionMarkers");


/**
 * Get conditions applied to an item
 * @param {string} itemId - Item ID
 * @returns {Promise<Array>} Array of condition objects
 */
export async function getConditions(itemId) {
  try {
    if (typeof Ext !== 'undefined' && Ext.ConditionMarkers) {
      const ext = Ext.ConditionMarkers;
      if (typeof ext.getItemConditions === 'function') {
        return await ext.getItemConditions(itemId);
      }
      if (typeof ext.getConditions === 'function') {
        return await ext.getConditions(itemId);
      }
      logger.log("[ConditionMarkers] Native extension present but no getItemConditions/getConditions method");
    } else {
      logger.log("[ConditionMarkers] Native extension not present, using fallback");
    }

    // Fallback: scan scene attachments for condition markers
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
 * @returns {Promise<void>}
 */

export async function addCondition(itemId, conditionName, value = null) {
  try {
    if (typeof Ext !== 'undefined' && Ext.ConditionMarkers && typeof Ext.ConditionMarkers.addCondition === 'function') {
      logger.log(`[ConditionMarkers] Using native Ext.ConditionMarkers.addCondition for token ${itemId}, condition '${conditionName}', value=`, value);
      return await Ext.ConditionMarkers.addCondition(itemId, conditionName, value);
    }
    // Fallback: attempt to use the Condition Markers API (request/response pattern)
    const API_REQUEST_CHANNEL = "conditionmarkers.api.request";
    const API_RESPONSE_CHANNEL = "conditionmarkers.api.response";

    const callId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const payload = { callId, action: 'add', tokenId: itemId, condition: conditionName };
    if (value !== null && value !== undefined) {
      payload.value = value;
    }

    logger.log(`[ConditionMarkers] Native API missing, sending API request for token ${itemId}, condition '${conditionName}', value ${value}`);

    const requestResult = await BroadcastHelpers.broadcastRequest(
      API_REQUEST_CHANNEL,
      API_RESPONSE_CHANNEL,
      payload,
      { destination: "LOCAL", timeoutMs: 5000 }
    );

    if (requestResult.success) {
      logger.log(`[ConditionMarkers] API response for add '${conditionName}':`, requestResult.data);
      return requestResult.data;
    } else {
      throw new Error(requestResult.error);
    }
  } catch (error) {
    logger.error("Failed to add condition:", error);
    throw error;
  }
}


/**
 * Remove a condition from an item
 * @param {string} itemId - Item ID
 * @param {string} conditionName - Condition name
 * @returns {Promise<void>}
 */
export async function removeCondition(itemId, conditionName) {
  try {
    if (typeof Ext !== 'undefined' && Ext.ConditionMarkers && typeof Ext.ConditionMarkers.removeCondition === 'function') {
      return await Ext.ConditionMarkers.removeCondition(itemId, conditionName);
    }
    // Fallback: use Condition Markers API request/response
    const API_REQUEST_CHANNEL = "conditionmarkers.api.request";
    const API_RESPONSE_CHANNEL = "conditionmarkers.api.response";

    const callId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const payload = { callId, action: 'remove', tokenId: itemId, condition: conditionName };

    const res = await new Promise((resolve, reject) => {
      let timeoutId = null;
      const handler = (evt) => {
        const data = evt.data;
        if (!data) return;
        if (data.callId !== callId) return;
        if (timeoutId) clearTimeout(timeoutId);
        try { OBR.broadcast.offMessage(API_RESPONSE_CHANNEL, handler); } catch (e) {}
        resolve(data);
      };

      OBR.broadcast.onMessage(API_RESPONSE_CHANNEL, handler);

      OBR.broadcast.sendMessage(API_REQUEST_CHANNEL, payload, { destination: "LOCAL" }).catch(err => {
        try { OBR.broadcast.offMessage(API_RESPONSE_CHANNEL, handler); } catch (e) {}
        reject(err);
      });

      timeoutId = setTimeout(() => {
        try { OBR.broadcast.offMessage(API_RESPONSE_CHANNEL, handler); } catch (e) {}
        reject(new Error('ConditionMarkers API timeout'));
      }, 5000);
    });

    logger.log(`[ConditionMarkers] API response for remove '${conditionName}':`, res);
    return res;
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
    // Prefer native toggle if available
    if (typeof Ext !== 'undefined' && Ext.ConditionMarkers && typeof Ext.ConditionMarkers.toggleCondition === 'function') {
      return await Ext.ConditionMarkers.toggleCondition(itemId, conditionName);
    }

    const conditions = await getConditions(itemId);
    const hasCondition = conditions.some(c => c.name === conditionName || c === conditionName);

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
    if (typeof Ext !== 'undefined' && Ext.ConditionMarkers && typeof Ext.ConditionMarkers.clearAllConditions === 'function') {
      return await Ext.ConditionMarkers.clearAllConditions(itemId);
    }

    const conditions = await getConditions(itemId);
    for (const condition of conditions) {
      const name = condition.name ?? condition;
      await removeCondition(itemId, name);
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
    if (typeof Ext !== 'undefined' && Ext.ConditionMarkers && typeof Ext.ConditionMarkers.hasCondition === 'function') {
      return await Ext.ConditionMarkers.hasCondition(itemId, conditionName);
    }

    const conditions = await getConditions(itemId);
    return conditions.some(c => (c.name ? c.name === conditionName : c === conditionName));
  } catch (error) {
    logger.error("Failed to check condition:", error);
    throw error;
  }
}

/**
 * Get available condition types
 * @returns {Promise<Array>} Array of available condition names
 */
/* Removed helper functions to simplify API surface per request */

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
    logger.log(`[ConditionMarkers.getValue] Called with tokenId: ${tokenId}, conditionName: ${conditionName}`);
    
    let tokenItem = null;
    if (allItems) {
      tokenItem = allItems.find(item => item.id === tokenId);
    } else {
      const items = await OBR.scene.items.getItems([tokenId]);
      tokenItem = items[0];
    }
    
    if (!tokenItem) {
      logger.log(`[ConditionMarkers.getValue] Token not found`);
      return null;
    }
    
    const allSceneItems = allItems || await OBR.scene.items.getItems();
    
    // Find marker images attached to the token
    const markers = allSceneItems.filter(item =>
      item.attachedTo === tokenId &&
      item.type === 'IMAGE' &&
      item.metadata &&
      "keegan.dev.condition-markers/metadata" in item.metadata
    );
    
    logger.log(`[ConditionMarkers.getValue] Found ${markers.length} condition marker(s) on token`);
    
    // For each marker, find TEXT labels attached to it
    for (const marker of markers) {
      logger.log(`[ConditionMarkers.getValue] Checking marker: ${marker.name} (id: ${marker.id})`);
      
      const labels = allSceneItems.filter(item =>
        item.attachedTo === marker.id &&
        item.type === 'TEXT' &&
        item.metadata &&
        "keegan.dev.condition-markers/label" in item.metadata &&
        item.metadata["keegan.dev.condition-markers/label"]?.condition === conditionName
      );
      
      logger.log(`[ConditionMarkers.getValue] Found ${labels.length} label(s) for condition "${conditionName}"`);
      
      if (labels.length > 0) {
        const labelText = labels[0].text?.plainText;
        logger.log(`[ConditionMarkers.getValue] Label text: "${labelText}"`);
        const trimmed = labelText && labelText.trim() ? labelText.trim() : null;
        if (!trimmed) {
          logger.log(`[ConditionMarkers.getValue] Returning: null (empty)`);
          return null;
        }

        // Simpler numeric parsing: use Number() and ensure it's finite.
        const n = Number(trimmed);
        if (Number.isFinite(n)) {
          logger.log(`[ConditionMarkers.getValue] Parsed number: ${n}`);
          return n;
        }

        logger.log(`[ConditionMarkers.getValue] Label not numeric, returning null`);
        return null;
      }
    }
    
    logger.log(`[ConditionMarkers.getValue] No matching label found, returning null`);
    return null;
  } catch (error) {
    logger.error(`[ConditionMarkers.getValue] Error:`, error);
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

