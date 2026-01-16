import OBR, { isImage } from "@owlbear-rodeo/sdk";
import { isDebugEnabled } from "../debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('sceneHelpers') && console.log(...args);
const debugError = (...args) => console.error(...args);
const debugWarn = (...args) => console.warn(...args);

/**
 * Get the map ID where a token is placed based on its position
 * @param {string} tokenId - Token ID
 * @returns {Promise<string|null>} Map ID or null if not found
 */
export async function getMapIdFromToken(tokenId) {
  try {
    // Get the specific token using filter
    const tokens = await OBR.scene.items.getItems([tokenId]);
    const token = tokens[0];
    
    if (!token) {
      debugWarn(`[sceneHelpers] Token ${tokenId} not found`);
      return null;
    }
    
    debugLog(`[sceneHelpers] Found token:`, { id: token.id, name: token.name, layer: token.layer, position: token.position });
    
    // Get token position (center point)
    const tokenPosition = token.position;
    if (!tokenPosition) {
      debugWarn(`[sceneHelpers] Token ${tokenId} has no position`);
      return null;
    }
    
    // Get only map items using filter (maps are images on the MAP layer)
    const maps = await OBR.scene.items.getItems((item) => isImage(item) && item.layer === 'MAP');
    debugLog(`[sceneHelpers] Found ${maps.length} maps in scene`);
    
    if (maps.length === 0) {
      debugWarn(`[sceneHelpers] No maps found in scene`);
      return null;
    }
    
    // Sort maps by zIndex (lower zIndex = below, higher = on top)
    // We want to find the topmost map under the token
    const sortedMaps = maps.sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
    
    // Check which map contains the token's position using OBR's getItemBounds
    for (const map of sortedMaps) {
      try {
        // Use OBR SDK to get the actual bounds of the map item
        const bounds = await OBR.scene.items.getItemBounds([map.id]);
        
        debugLog(`[sceneHelpers] Checking map:`, { 
          id: map.id, 
          name: map.name, 
          bounds: bounds,
          zIndex: map.zIndex
        });
        
        // Check if token position is within map bounds
        if (tokenPosition.x >= bounds.min.x && 
            tokenPosition.x <= bounds.max.x && 
            tokenPosition.y >= bounds.min.y && 
            tokenPosition.y <= bounds.max.y) {
          debugLog(`[sceneHelpers] Token ${tokenId} is on map ${map.id} (${map.name})`);
          return map.id;
        }
      } catch (error) {
        debugWarn(`[sceneHelpers] Error getting bounds for map ${map.id}:`, error);
        continue;
      }
    }
    
    debugLog(`[sceneHelpers] Token ${tokenId} (position: ${tokenPosition.x}, ${tokenPosition.y}) is not on any map`);
    return null;
  } catch (error) {
    debugError(`[sceneHelpers] Error getting map ID for token ${tokenId}:`, error.message);
    return null;
  }
}
