import OBR, { isImage } from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../../debugMode.js";

// Debug mode constants
const logger = createDebugLogger("sceneHelpers");


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
      logger.warn(`Token ${tokenId} not found`);
      return null;
    }
    
    logger.log(`Found token:`, { id: token.id, name: token.name, layer: token.layer, position: token.position });
    
    // Get token position (center point)
    const tokenPosition = token.position;
    if (!tokenPosition) {
      logger.warn(`Token ${tokenId} has no position`);
      return null;
    }
    
    // Get only map items using filter (maps are images on the MAP layer)
    const maps = await OBR.scene.items.getItems((item) => isImage(item) && item.layer === 'MAP');
    logger.log(`Found ${maps.length} maps in scene`);
    
    if (maps.length === 0) {
      logger.warn(`No maps found in scene`);
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
        
        logger.log(`Checking map:`, { 
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
          logger.log(`Token ${tokenId} is on map ${map.id} (${map.name})`);
          return map.id;
        }
      } catch (error) {
        logger.warn(`Error getting bounds for map ${map.id}:`, error);
        continue;
      }
    }
    
    logger.log(`Token ${tokenId} (position: ${tokenPosition.x}, ${tokenPosition.y}) is not on any map`);
    return null;
  } catch (error) {
    logger.error(`Error getting map ID for token ${tokenId}:`, error.message);
    return null;
  }
}

