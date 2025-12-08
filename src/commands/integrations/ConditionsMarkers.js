/**
 * Conditions Markers Integration
 * Handles status conditions and markers on tokens (poison, stun, etc.)
 */

import OBR from "@owlbear-rodeo/sdk";

/**
 * Get conditions applied to an item
 * @param {string} itemId - Item ID
 * @returns {Promise<Array>} Array of condition objects
 */
export async function getItemConditions(itemId) {
  try {
    if (typeof Ext !== 'undefined' && Ext.ConditionsMarkers) {
      const ext = Ext.ConditionsMarkers;
      if (typeof ext.getItemConditions === 'function') {
        return await ext.getItemConditions(itemId);
      }
      if (typeof ext.getConditions === 'function') {
        return await ext.getConditions(itemId);
      }
      console.log("[ConditionsMarkers] Native extension present but no getItemConditions/getConditions method");
    } else {
      console.log("[ConditionsMarkers] Native extension not present, using fallback");
    }

    // Fallback: scan scene attachments for condition markers
    const items = await OBR.scene.items.getItems();
    const markers = items.filter(item => item.attachedTo === itemId && item.name && item.name.startsWith("Condition Marker - "));
    return markers.map(m => ({ name: m.name.replace("Condition Marker - ", "") }));
  } catch (error) {
    console.error("Failed to get item conditions:", error);
    throw error;
  }
}

/**
 * Add a condition to an item
 * @param {string} itemId - Item ID
 * @param {string} conditionName - Condition name (e.g., "poisoned", "stunned")
 * @param {Object} options - Additional options
 * @returns {Promise<void>}
 */

export async function addCondition(itemId, conditionName, options = {}) {
  try {
    if (typeof Ext !== 'undefined' && Ext.ConditionsMarkers && typeof Ext.ConditionsMarkers.addCondition === 'function') {
      console.log(`[ConditionsMarkers] Using native Ext.ConditionsMarkers.addCondition for token ${itemId}, condition '${conditionName}'`);
      return await Ext.ConditionsMarkers.addCondition(itemId, conditionName, options);
    }

    console.log(`[ConditionsMarkers] Native API missing, sending addCondition broadcast for token ${itemId}, condition '${conditionName}'`);
    await OBR.broadcast.sendMessage(
      "conditionmarkers.api.addCondition",
      { tokenId: itemId, condition: conditionName },
      { destination: "ALL" }
    );
    console.log(`[ConditionsMarkers] Broadcast sent successfully for condition '${conditionName}'`);
  } catch (error) {
    console.error("Failed to add condition:", error);
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
    if (typeof Ext !== 'undefined' && Ext.ConditionsMarkers && typeof Ext.ConditionsMarkers.removeCondition === 'function') {
      return await Ext.ConditionsMarkers.removeCondition(itemId, conditionName);
    }

    // Fallback: find and delete marker items
    const items = await OBR.scene.items.getItems();
    const markers = items.filter(item => item.attachedTo === itemId && item.name === `Condition Marker - ${conditionName}`);
    const markerIds = markers.map(m => m.id);
    if (markerIds.length > 0) {
      await OBR.scene.items.deleteItems(markerIds);
    }
  } catch (error) {
    console.error("Failed to remove condition:", error);
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
    if (typeof Ext !== 'undefined' && Ext.ConditionsMarkers && typeof Ext.ConditionsMarkers.toggleCondition === 'function') {
      return await Ext.ConditionsMarkers.toggleCondition(itemId, conditionName);
    }

    const conditions = await getItemConditions(itemId);
    const hasCondition = conditions.some(c => c.name === conditionName || c === conditionName);

    if (hasCondition) {
      await removeCondition(itemId, conditionName);
    } else {
      await addCondition(itemId, conditionName);
    }
  } catch (error) {
    console.error("Failed to toggle condition:", error);
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
    if (typeof Ext !== 'undefined' && Ext.ConditionsMarkers && typeof Ext.ConditionsMarkers.clearAllConditions === 'function') {
      return await Ext.ConditionsMarkers.clearAllConditions(itemId);
    }

    const conditions = await getItemConditions(itemId);
    for (const condition of conditions) {
      const name = condition.name ?? condition;
      await removeCondition(itemId, name);
    }
  } catch (error) {
    console.error("Failed to clear conditions:", error);
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
    if (typeof Ext !== 'undefined' && Ext.ConditionsMarkers && typeof Ext.ConditionsMarkers.hasCondition === 'function') {
      return await Ext.ConditionsMarkers.hasCondition(itemId, conditionName);
    }

    const conditions = await getItemConditions(itemId);
    return conditions.some(c => (c.name ? c.name === conditionName : c === conditionName));
  } catch (error) {
    console.error("Failed to check condition:", error);
    throw error;
  }
}

/**
 * Get available condition types
 * @returns {Promise<Array>} Array of available condition names
 */
export async function getAvailableConditions() {
  try {
    if (typeof Ext !== 'undefined' && Ext.ConditionsMarkers) {
      const ext = Ext.ConditionsMarkers;
      if (typeof ext.getAvailableConditions === 'function') {
        return await ext.getAvailableConditions();
      }
      if (typeof ext.getConditions === 'function') {
        return await ext.getConditions();
      }
    }
    console.log("[ConditionsMarkers] getAvailableConditions fallback: returning []");
    return [];
  } catch (error) {
    console.error("Failed to get available conditions:", error);
    return [];
  }
}

/**
 * Get condition marker attachments on a token
 * Condition markers are attachments with metadata key "keegan.dev.condition-markers/metadata"
 * @param {string} tokenId - Token ID
 * @param {Array} allItems - All scene items (optional, will fetch if not provided)
 * @returns {Promise<Array>} Array of condition marker attachments
 */
export async function getConditionMarkerAttachments(tokenId, allItems = null) {
  try {
    // Use efficient selector pattern: getItems([tokenId]) to fetch only the target token
    let tokenItem = null;
    if (allItems) {
      tokenItem = allItems.find(item => item.id === tokenId);
    } else {
      const items = await OBR.scene.items.getItems([tokenId]);
      tokenItem = items[0];
    }
    
    if (!tokenItem) {
      console.log(`[ConditionsMarkers] Token ${tokenId} not found in scene`);
      return [];
    }
    
    // Get all items to find those attached to this token
    const allSceneItems = allItems || await OBR.scene.items.getItems();
    const markers = allSceneItems.filter(item => 
      item.attachedTo === tokenId && 
      item.metadata && 
      "keegan.dev.condition-markers/metadata" in item.metadata
    );
    return markers;
  } catch (error) {
    console.error("[ConditionsMarkers] Error fetching condition markers:", error);
    return [];
  }
}

/**
 * Find a specific condition marker by name
 * @param {string} tokenId - Token ID
 * @param {string} markerName - Name of condition marker
 * @param {Array} allItems - All scene items (optional)
 * @returns {Promise<Object|null>} Condition marker item or null
 */
export async function findConditionMarker(tokenId, markerName, allItems = null) {
  try {
    const markers = await getConditionMarkerAttachments(tokenId, allItems);
    return markers.find(m => m.name === markerName) || null;
  } catch (error) {
    console.error("Error finding marker:", error);
    return null;
  }
}

/**
 * Check if a condition is applied to a token
 * @param {string} tokenId - Token ID
 * @param {string} conditionName - Name of the condition (e.g., "Bandaged")
 * @param {Array} allItems - All scene items (optional)
 * @returns {Promise<boolean>} True if condition is present, false otherwise
 */
export async function isCondition(tokenId, conditionName, allItems = null) {
  try {
    let tokenItem = null;
    if (allItems) {
      tokenItem = allItems.find(item => item.id === tokenId);
    } else {
      const items = await OBR.scene.items.getItems([tokenId]);
      tokenItem = items[0];
    }
    
    if (!tokenItem) {
      console.warn(`[ConditionsMarkers.isCondition] Token ${tokenId} not found`);
      return false;
    }
    
    const allSceneItems = allItems || await OBR.scene.items.getItems();
    
    // Find marker images attached to the token with the condition name
    // Condition markers are named like "Condition Marker - Bandaged"
    const conditionMarkerName = `Condition Marker - ${conditionName}`;
    
    const markers = allSceneItems.filter(item =>
      item.attachedTo === tokenId &&
      item.type === 'IMAGE' &&
      item.metadata &&
      "keegan.dev.condition-markers/metadata" in item.metadata &&
      item.name === conditionMarkerName
    );
    
    console.log(`[ConditionsMarkers.isCondition] Checking for "${conditionName}" on token ${tokenId}`);
    console.log(`[ConditionsMarkers.isCondition] Looking for marker named: "${conditionMarkerName}"`);
    console.log(`[ConditionsMarkers.isCondition] Found ${markers.length} matching marker(s)`);
    
    return markers.length > 0;
  } catch (error) {
    console.error("[ConditionsMarkers.isCondition] Error checking condition:", error);
    return false;
  }
}

/**
 * Set condition marker visibility
 * @param {string|Array<string>} markerIds - Single marker ID or array of marker IDs
 * @param {boolean} visible - Visibility state
 */
export async function setMarkerVisibility(markerIds, visible) {
  try {
    const ids = Array.isArray(markerIds) ? markerIds : [markerIds];
    await OBR.scene.items.updateItems(ids, (items) => {
      items.forEach(item => {
        item.visible = visible;
      });
    });
    console.log(`[ConditionsMarkers] Set ${ids.length} marker(s) visible to ${visible}`);
  } catch (error) {
    console.error("[ConditionsMarkers] Error setting marker visibility:", error);
  }
}

/**
 * Get the value (text) of a condition label
 * Finds the TEXT attachment on a condition marker and returns its plainText
 * @param {string} tokenId - Token ID
 * @param {string} conditionName - Name of the condition (e.g., "Bandaged")
 * @param {Array} allItems - All scene items (optional, will fetch if not provided)
 * @returns {Promise<string|null>} Text value of the label, or null if not found
 */
export async function getValue(tokenId, conditionName, allItems = null) {
  try {
    console.log(`[ConditionsMarkers.getValue] Called with tokenId: ${tokenId}, conditionName: ${conditionName}`);
    
    let tokenItem = null;
    if (allItems) {
      tokenItem = allItems.find(item => item.id === tokenId);
    } else {
      const items = await OBR.scene.items.getItems([tokenId]);
      tokenItem = items[0];
    }
    
    if (!tokenItem) {
      console.log(`[ConditionsMarkers.getValue] Token not found`);
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
    
    console.log(`[ConditionsMarkers.getValue] Found ${markers.length} condition marker(s) on token`);
    
    // For each marker, find TEXT labels attached to it
    for (const marker of markers) {
      console.log(`[ConditionsMarkers.getValue] Checking marker: ${marker.name} (id: ${marker.id})`);
      
      const labels = allSceneItems.filter(item =>
        item.attachedTo === marker.id &&
        item.type === 'TEXT' &&
        item.metadata &&
        "keegan.dev.condition-markers/label" in item.metadata &&
        item.metadata["keegan.dev.condition-markers/label"]?.condition === conditionName
      );
      
      console.log(`[ConditionsMarkers.getValue] Found ${labels.length} label(s) for condition "${conditionName}"`);
      
      if (labels.length > 0) {
        const labelText = labels[0].text?.plainText;
        console.log(`[ConditionsMarkers.getValue] Label text: "${labelText}"`);
        const result = labelText && labelText.trim() ? labelText : null;
        console.log(`[ConditionsMarkers.getValue] Returning: ${result}`);
        return result;
      }
    }
    
    console.log(`[ConditionsMarkers.getValue] No matching label found, returning null`);
    return null;
  } catch (error) {
    console.error(`[ConditionsMarkers.getValue] Error:`, error);
    return null;
  }
}

export default {
  getItemConditions,
  addCondition,
  removeCondition,
  toggleCondition,
  clearAllConditions,
  hasCondition,
  getAvailableConditions,
  getConditionMarkerAttachments,
  findConditionMarker,
  isCondition,
  setMarkerVisibility,
  getValue
};
