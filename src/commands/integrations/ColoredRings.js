import OBR, { buildShape } from "@owlbear-rodeo/sdk";
import { getAttachmentsWithMetadata } from "../tokenAttachments.js";
import { isDebugEnabled } from "../../debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('ColoredRings') && console.log(...args);
const debugError = (...args) => console.error(...args);
const debugWarn = (...args) => console.warn(...args);

const COLORED_RINGS_METADATA_KEY = "rodeo.owlbear.colored-rings/metadata";

/**
 * ColoredRings Integration
 * Handles communication with the Colored Rings extension
 * Manages status rings attached to tokens
 */

/**
 * Get all colored rings attached to a token
 * @param {string} tokenId - Token ID to get rings from
 * @returns {Promise<Array<string>>} Array of ring colors
 */
export async function getRings(tokenId) {
  try {
    const rings = await getAttachmentsWithMetadata(tokenId, COLORED_RINGS_METADATA_KEY);
    const colors = rings.map(ring => ring.style?.strokeColor).filter(Boolean);
    debugLog(`[ColoredRings] Found ${colors.length} colored rings on token ${tokenId}`);
    return colors;
  } catch (error) {
    debugError(`[ColoredRings] Failed to get rings from token ${tokenId}:`, error.message);
    return [];
  }
}

/**
 * Check if a token has any rings, or a specific colored ring
 * @param {string} tokenId - Token ID
 * @param {string} [color] - Optional: stroke color to check (e.g., "#1a6aff")
 * @returns {Promise<boolean>} True if ring(s) exist
 */
export async function hasRing(tokenId, color = null) {
  try {
    const colors = await getRings(tokenId);
    if (color === null) {
      return colors.length > 0;
    }
    const normalizedColor = color.toLowerCase();
    return colors.some(c => c.toLowerCase() === normalizedColor);
  } catch (error) {
    debugError(`[ColoredRings] Failed to check ring on token ${tokenId}:`, error.message);
    return false;
  }
}

/**
 * Add a colored ring to a token
 * @param {string} tokenId - Token ID
 * @param {string} color - Stroke color (e.g., "#1a6aff")
 * @returns {Promise<boolean>} True if successful
 */
export async function addRing(tokenId, color) {
  try {
    debugLog(`[ColoredRings] Attempting to add ring with color "${color}" to token ${tokenId}`);
    
    // Check if ring already exists
    if (await hasRing(tokenId, color)) {
      debugWarn(`[ColoredRings] Ring with color "${color}" already exists on token ${tokenId}`);
      return false;
    }

    // Get the token to attach the ring to
    const items = await OBR.scene.items.getItems([tokenId]);
    
    if (!items || items.length === 0) {
      debugError(`[ColoredRings] Token ${tokenId} not found`);
      return false;
    }

    const targetToken = items[0];
    const dpi = await OBR.scene.grid.getDpi();
    
    // Get all existing rings attached to this token
    const existingRings = await getAttachmentsWithMetadata(tokenId, COLORED_RINGS_METADATA_KEY);
    
    // Calculate dimensions based on token's image size
    const dpiScale = dpi / targetToken.grid.dpi;
    const width = targetToken.image.width * dpiScale;
    const height = targetToken.image.height * dpiScale;
    const diameter = Math.min(width, height);
    const offsetX = (targetToken.grid.offset.x / targetToken.image.width) * width;
    const offsetY = (targetToken.grid.offset.y / targetToken.image.height) * height;
    
    // Apply image offset and offset circle position so the origin is the center
    const position = {
      x: targetToken.position.x - offsetX + width / 2,
      y: targetToken.position.y - offsetY + height / 2,
    };
    
    // Calculate scale based on number of existing rings (each ring is 10% smaller)
    const scale = targetToken.scale.x * (1 - existingRings.length * 0.1);
    
    // Build the ring using OBR's buildShape helper
    const ring = buildShape()
      .width(diameter)
      .height(diameter)
      .scale({ x: scale, y: scale })
      .position(position)
      .fillOpacity(0)
      .strokeColor(color)
      .strokeOpacity(1)
      .strokeWidth(5)
      .shapeType("CIRCLE")
      .attachedTo(targetToken.id)
      .locked(true)
      .name("Status Ring")
      .metadata({ [COLORED_RINGS_METADATA_KEY]: {} })
      .layer("ATTACHMENT")
      .disableHit(true)
      .visible(targetToken.visible)
      .build();

    await OBR.scene.items.addItems([ring]);
    debugLog(`[ColoredRings] ✓ Added ring with color "${color}" to token ${tokenId} (scale: ${scale})`);
    return true;
  } catch (error) {
    debugError(`[ColoredRings] Failed to add ring to token ${tokenId}:`, error.message, error);
    return false;
  }
}

/**
 * Update the scale of all rings attached to a token to remove gaps
 * @param {string} tokenId - Token ID
 * @returns {Promise<boolean>} True if successful
 */
async function updateRingScales(tokenId) {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (!items || items.length === 0) {
      return false;
    }
    
    const targetToken = items[0];
    const rings = await getAttachmentsWithMetadata(tokenId, COLORED_RINGS_METADATA_KEY);
    
    if (rings.length === 0) {
      return true;
    }
    
    // Update each ring's scale to prevent gaps
    await OBR.scene.items.updateItems(
      rings.map(r => r.id),
      (items) => {
        items.forEach((ring, index) => {
          const scale = targetToken.scale.x * (1 - index * 0.1);
          ring.scale = { x: scale, y: scale };
        });
      }
    );
    
    debugLog(`[ColoredRings] Updated scales for ${rings.length} rings on token ${tokenId}`);
    return true;
  } catch (error) {
    debugError(`[ColoredRings] Failed to update ring scales for token ${tokenId}:`, error.message);
    return false;
  }
}

/**
 * Remove a colored ring from a token
 * @param {string} tokenId - Token ID
 * @param {string} color - Stroke color to identify the ring (e.g., "#1a6aff")
 * @returns {Promise<boolean>} True if successful
 */
export async function removeRing(tokenId, color) {
  try {
    const rings = await getAttachmentsWithMetadata(tokenId, COLORED_RINGS_METADATA_KEY);
    const normalizedColor = color.toLowerCase();
    const ring = rings.find(r => r.style?.strokeColor?.toLowerCase() === normalizedColor);
    
    if (!ring) {
      debugWarn(`[ColoredRings] Ring with color "${color}" not found on token ${tokenId}`);
      return false;
    }

    await OBR.scene.items.deleteItems([ring.id]);
    debugLog(`[ColoredRings] Removed ring with color "${color}" from token ${tokenId}`);
    
    // Update remaining ring scales to remove gaps
    await updateRingScales(tokenId);
    
    return true;
  } catch (error) {
    debugError(`[ColoredRings] Failed to remove ring from token ${tokenId}:`, error.message);
    return false;
  }
}
