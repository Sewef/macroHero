import OBR from "@owlbear-rodeo/sdk";

/**
 * Get all player metadata
 * @returns {Promise<Object>} Full metadata object
 */
export async function getAllPlayerMetadata() {
  return await OBR.player.getMetadata();
}

/**
 * Get a specific metadata value by key
 * @param {string} key - The metadata key (e.g., "com.sewef.macrohero/metadata")
 * @returns {Promise<any>} The metadata value
 */
export async function getPlayerMetadata(key) {
  const metadata = await OBR.player.getMetadata();
  return metadata[key];
}

/**
 * Set player metadata for a specific key
 * @param {string} key - The metadata key
 * @param {any} value - The value to set
 * @returns {Promise<void>}
 */
export async function setPlayerMetadata(key, value) {
  await OBR.player.setMetadata({ [key]: value });
}

/**
 * Update player metadata (merges with existing)
 * @param {Object} updates - Object with key-value pairs to update
 * @returns {Promise<void>}
 */
export async function updatePlayerMetadata(updates) {
  await OBR.player.setMetadata(updates);
}

/**
 * Merge metadata with existing values
 * @param {string} key - The metadata key
 * @param {Object} value - Object to merge (for nested updates)
 * @returns {Promise<void>}
 */
export async function mergePlayerMetadata(key, value) {
  const current = await getPlayerMetadata(key);
  const merged = {
    ...current,
    ...value
  };
  await setPlayerMetadata(key, merged);
}

/**
 * Delete a metadata key
 * @param {string} key - The metadata key to delete
 * @returns {Promise<void>}
 */
export async function deletePlayerMetadata(key) {
  await OBR.player.setMetadata({ [key]: undefined });
}

/**
 * Get player ID
 * @returns {Promise<string>} Player ID
 */
export async function getPlayerId() {
  return await OBR.player.getId();
}

/**
 * Get player name
 * @returns {Promise<string>} Player name
 */
export async function getPlayerName() {
  return await OBR.player.getName();
}

/**
 * Get player role (GM or PLAYER)
 * @returns {Promise<string>} Player role
 */
export async function getPlayerRole() {
  return await OBR.player.getRole();
}

/**
 * Check if player has a specific permission
 * @param {string} permission - Permission to check
 * @returns {Promise<boolean>} Whether player has permission
 */
export async function hasPlayerPermission(permission) {
  return await OBR.player.hasPermission(permission);
}
