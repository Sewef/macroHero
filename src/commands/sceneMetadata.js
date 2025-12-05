import OBR from "@owlbear-rodeo/sdk";

/**
 * Get all scene metadata
 * @returns {Promise<Object>} Full metadata object
 */
export async function getSceneMetadata() {
  const scene = await OBR.scene.getMetadata();
  return scene;
}

/**
 * Get a specific scene metadata value by key
 * @param {string} key - The metadata key
 * @returns {Promise<any>} The metadata value
 */
export async function getSceneMetadataValue(key) {
  const metadata = await OBR.scene.getMetadata();
  return metadata[key];
}

/**
 * Set scene metadata for a specific key
 * @param {string} key - The metadata key
 * @param {any} value - The value to set
 * @returns {Promise<void>}
 */
export async function setSceneMetadata(key, value) {
  await OBR.scene.setMetadata({ [key]: value });
}

/**
 * Update scene metadata (merges with existing)
 * @param {Object} updates - Object with key-value pairs to update
 * @returns {Promise<void>}
 */
export async function updateSceneMetadata(updates) {
  await OBR.scene.setMetadata(updates);
}

/**
 * Merge scene metadata with existing values
 * @param {string} key - The metadata key
 * @param {Object} value - Object to merge (for nested updates)
 * @returns {Promise<void>}
 */
export async function mergeSceneMetadata(key, value) {
  const current = await getSceneMetadataValue(key);
  const merged = {
    ...current,
    ...value
  };
  await setSceneMetadata(key, merged);
}

/**
 * Delete a scene metadata key
 * @param {string} key - The metadata key to delete
 * @returns {Promise<void>}
 */
export async function deleteSceneMetadata(key) {
  await OBR.scene.setMetadata({ [key]: undefined });
}

/**
 * Listen for scene metadata changes
 * @param {Function} callback - Called when scene metadata changes
 * @returns {Function} Unsubscribe function
 */
export function onSceneMetadataChange(callback) {
  return OBR.scene.onMetadataChange(callback);
}

/**
 * Get the current active scene ID
 * @returns {Promise<string>} Scene ID
 */
export async function getSceneId() {
  const scene = await OBR.scene.getMetadata();
  return scene?.id;
}

/**
 * Get tokens in the current scene
 * @returns {Promise<Array>} Array of token items
 */
export async function getSceneTokens() {
  const items = await OBR.scene.getItems();
  return items.filter(item => item.type === "token");
}

/**
 * Get a specific item by ID
 * @param {string} itemId - The item ID
 * @returns {Promise<Object|null>} The item or null
 */
export async function getSceneItem(itemId) {
  const items = await OBR.scene.getItems([itemId]);
  return items[0] || null;
}

/**
 * Update an item in the scene
 * @param {string} itemId - The item ID
 * @param {Object} updates - Properties to update
 * @returns {Promise<void>}
 */
export async function updateSceneItem(itemId, updates) {
  await OBR.scene.updateItems([{ id: itemId, ...updates }]);
}
