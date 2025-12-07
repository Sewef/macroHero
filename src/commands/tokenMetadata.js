import OBR from "@owlbear-rodeo/sdk";

const OWL_TRACKERS_METADATA_KEY = "com.owl-trackers/trackers";

/**
 * Get all metadata for a token
 * @param {string} tokenId - Token ID
 * @returns {Promise<Object>} Full metadata object
 */
export async function getTokenMetadata(tokenId) {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (!items || items.length === 0) {
      console.warn(`[tokenMetadata] Token ${tokenId} not found`);
      return null;
    }
    return items[0].metadata;
  } catch (error) {
    console.error(`[tokenMetadata] Error getting metadata for token ${tokenId}:`, error.message);
    return null;
  }
}

/**
 * Get a specific metadata value by key from a token
 * @param {string} tokenId - Token ID
 * @param {string} key - The metadata key
 * @returns {Promise<any>} The metadata value
 */
export async function getTokenMetadataValue(tokenId, key) {
  const metadata = await getTokenMetadata(tokenId);
  if (!metadata) {
    return null;
  }
  return metadata[key];
}

/**
 * Set token metadata for a specific key
 * @param {string} tokenId - Token ID
 * @param {string} key - The metadata key
 * @param {any} value - The value to set
 * @returns {Promise<void>}
 */
export async function setTokenMetadata(tokenId, key, value) {
  await OBR.scene.items.updateItems(
    [tokenId],
    (items) => {
      const item = items.find(i => i.id === tokenId);
      if (item) {
        item.metadata[key] = value;
      }
    }
  );
}

/**
 * Update token metadata (merges with existing)
 * @param {string} tokenId - Token ID
 * @param {Object} updates - Object with key-value pairs to update
 * @returns {Promise<void>}
 */
export async function updateTokenMetadata(tokenId, updates) {
  try {
    // Get current item to merge metadata
    const items = await OBR.scene.items.getItems([tokenId]);
    if (!items || items.length === 0) {
      console.warn(`[tokenMetadata] Token ${tokenId} not found`);
      return;
    }
    
    const currentMetadata = items[0].metadata || {};
    const mergedMetadata = { ...currentMetadata, ...updates };
    
    console.log(`[tokenMetadata] Updating item ${tokenId} with merged metadata:`, mergedMetadata);
    
    // Use correct OBR signature: filter/items array + update function
    await OBR.scene.items.updateItems(
      [tokenId],
      (items) => {
        const item = items.find(i => i.id === tokenId);
        if (item) {
          item.metadata = mergedMetadata;
        }
      }
    );
  } catch (error) {
    console.error(`[tokenMetadata] Error updating metadata for token ${tokenId}:`, error);
    throw error;
  }
}

/**
 * Merge metadata with existing values
 * @param {string} tokenId - Token ID
 * @param {string} key - The metadata key
 * @param {Object} value - Object to merge (for nested updates)
 * @returns {Promise<void>}
 */
export async function mergeTokenMetadata(tokenId, key, value) {
  const current = await getTokenMetadataValue(tokenId, key);
  const merged = {
    ...current,
    ...value
  };
  await setTokenMetadata(tokenId, key, merged);
}

/**
 * Delete a token metadata key
 * @param {string} tokenId - Token ID
 * @param {string} key - The metadata key to delete
 * @returns {Promise<void>}
 */
export async function deleteTokenMetadata(tokenId, key) {
  await OBR.scene.items.updateItems(
    [tokenId],
    (items) => {
      const item = items.find(i => i.id === tokenId);
      if (item) {
        delete item.metadata[key];
      }
    }
  );
}

/**
 * Get a specific value by key from metadata (e.g., tracker value by name)
 * @param {string} tokenId - Token ID
 * @param {string} metadataKey - The metadata key (e.g., "com.owl-trackers/trackers")
 * @param {string} itemName - Name of the item to find (e.g., tracker name)
 * @returns {Promise<any|null>} The item value or null if not found
 */
export async function getValue(tokenId, metadataKey, itemName) {
  const items = await getTokenMetadataValue(tokenId, metadataKey);
  if (!Array.isArray(items)) return null;
  const item = items.find(i => i.name === itemName);
  return item ? item.value : null;
}

/**
 * Set a specific value by item name in metadata array
 * @param {string} tokenId - Token ID
 * @param {string} metadataKey - The metadata key (e.g., "com.owl-trackers/trackers")
 * @param {string} itemName - Name of the item to update
 * @param {any} value - The new value
 * @returns {Promise<void>}
 */
export async function setValue(tokenId, metadataKey, itemName, value) {
  try {
    const items = await getTokenMetadataValue(tokenId, metadataKey);
    console.log(`[tokenMetadata.setValue] Current items for ${itemName}:`, items);
    
    if (!Array.isArray(items)) {
      console.error(`[tokenMetadata.setValue] Metadata at ${metadataKey} is not an array on token ${tokenId}`);
      return;
    }
    
    const item = items.find(i => i.name === itemName);
    if (!item) {
      console.error(`[tokenMetadata.setValue] Item "${itemName}" not found in ${metadataKey} on token ${tokenId}`);
      return;
    }
    
    console.log(`[tokenMetadata.setValue] Setting ${itemName} from ${item.value} to ${value}`);
    item.value = value;
    
    const updateObj = { [metadataKey]: items };
    console.log(`[tokenMetadata.setValue] Updating with:`, updateObj);
    
    await updateTokenMetadata(tokenId, updateObj);
    console.log(`[tokenMetadata.setValue] Update complete for ${itemName}`);
  } catch (error) {
    console.error(`[tokenMetadata.setValue] Error setting ${itemName}:`, error);
  }
}

/**
 * Add/increment a value in metadata array (can be negative to subtract)
 * @param {string} tokenId - Token ID
 * @param {string} metadataKey - The metadata key (e.g., "com.owl-trackers/trackers")
 * @param {string} itemName - Name of the item to update
 * @param {number} delta - Amount to add (can be negative)
 * @returns {Promise<void>}
 */
export async function addValue(tokenId, metadataKey, itemName, delta) {
  const currentValue = await getValue(tokenId, metadataKey, itemName);
  if (currentValue === null) {
    console.warn(`Item "${itemName}" not found in ${metadataKey} on token ${tokenId}`);
    return;
  }
  const newValue = currentValue + delta;
  await setValue(tokenId, metadataKey, itemName, newValue);
}

/**
 * Get a flat metadata property value (for metadata stored as objects, not arrays)
 * @param {string} tokenId - Token ID
 * @param {string} metadataKey - The metadata key (e.g., "com.owlbear-rodeo-bubbles-extension/metadata")
 * @param {string} propertyName - Name of the property (e.g., "health", "armor class")
 * @returns {Promise<any|null>} Property value or null if not found
 */
export async function getFlatValue(tokenId, metadataKey, propertyName) {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (!items || items.length === 0) {
      console.warn(`[tokenMetadata.getFlatValue] Token ${tokenId} not found`);
      return null;
    }
    
    const metadata = items[0].metadata?.[metadataKey];
    if (!metadata) {
      console.warn(`[tokenMetadata.getFlatValue] No metadata found at key "${metadataKey}" on token ${tokenId}`);
      return null;
    }
    
    const value = metadata[propertyName];
    if (value === undefined || value === null) {
      console.warn(`[tokenMetadata.getFlatValue] Property "${propertyName}" not found in "${metadataKey}" on token ${tokenId}`);
      return null;
    }
    
    return value;
  } catch (error) {
    console.error(`[tokenMetadata.getFlatValue] Failed to get property "${propertyName}" from token ${tokenId}:`, error.message);
    return null;
  }
}

/**
 * Set a flat metadata property value (for metadata stored as objects, not arrays)
 * @param {string} tokenId - Token ID
 * @param {string} metadataKey - The metadata key
 * @param {string} propertyName - Name of the property
 * @param {any} value - Value to set
 * @returns {Promise<boolean>} True if successful
 */
export async function setFlatValue(tokenId, metadataKey, propertyName, value) {
  try {
    await OBR.scene.items.updateItems([tokenId], (items) => {
      items.forEach(item => {
        if (!item.metadata[metadataKey]) {
          item.metadata[metadataKey] = {};
        }
        item.metadata[metadataKey][propertyName] = value;
      });
    });
    console.log(`[tokenMetadata.setFlatValue] Set "${propertyName}" to ${value} in "${metadataKey}" on token ${tokenId}`);
    return true;
  } catch (error) {
    console.error(`[tokenMetadata.setFlatValue] Failed to set property "${propertyName}" on token ${tokenId}:`, error.message);
    return false;
  }
}

/**
 * Get all flat metadata properties (for metadata stored as objects)
 * @param {string} tokenId - Token ID
 * @param {string} metadataKey - The metadata key
 * @returns {Promise<Object|null>} Object with all properties or null if not found
 */
export async function getFlatMetadata(tokenId, metadataKey) {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (!items || items.length === 0) {
      console.warn(`[tokenMetadata.getFlatMetadata] Token ${tokenId} not found`);
      return null;
    }
    
    const metadata = items[0].metadata?.[metadataKey];
    if (!metadata) {
      console.warn(`[tokenMetadata.getFlatMetadata] No metadata found at key "${metadataKey}" on token ${tokenId}`);
      return null;
    }
    return metadata;
  } catch (error) {
    console.error(`[tokenMetadata.getFlatMetadata] Failed to get metadata from token ${tokenId}:`, error.message);
    return null;
  }
}


export default {
  getTokenMetadata,
  getTokenMetadataValue,
  setTokenMetadata,
  updateTokenMetadata,
  mergeTokenMetadata,
  deleteTokenMetadata,
  getValue,
  setValue,
  addValue,
  getFlatValue,
  setFlatValue,
  getFlatMetadata
};
