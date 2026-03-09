/**
 * Auras Integration
 * Provides access to Auras auras on items/tokens
 * Communicates with Auras extension via broadcast messages
 */

import OBR from "@owlbear-rodeo/sdk";
import { isDebugEnabled } from "../../debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('Auras') && console.log(...args);
const debugError = (...args) => console.error(...args);
const debugWarn = (...args) => console.warn(...args);

// Auras broadcast channel
const AURAS_CHANNEL = "com.desain.emanation/message";
const AURAS_METADATA_KEY = "com.desain.emanation/metadata";

/**
 * Check if an item has any auras
 * @param {string} itemId - Item ID
 * @returns {Promise<boolean>} True if item has at least one aura
 */
export async function hasAura(itemId) {
  try {
    debugLog(`[Auras.hasAura] Checking auras for item ${itemId}`);
    const items = await OBR.scene.items.getItems([itemId]);
    
    if (items.length === 0) {
      debugWarn(`[Auras.hasAura] Item not found: ${itemId}`);
      return false;
    }

    const item = items[0];
    const hasAuras = 
      item.metadata[AURAS_METADATA_KEY] && 
      Array.isArray(item.metadata[AURAS_METADATA_KEY].auras) &&
      item.metadata[AURAS_METADATA_KEY].auras.length > 0;

    debugLog(`[Auras.hasAura] Item ${itemId} has auras: ${hasAuras}`);
    return hasAuras;
  } catch (error) {
    debugError(`[Auras.hasAura] Error checking auras for item ${itemId}:`, error);
    throw error;
  }
}

/**
 * Get all auras on an item
 * @param {string} itemId - Item ID
 * @returns {Promise<Array>} Array of aura entries
 */
export async function getAuras(itemId) {
  try {
    debugLog(`[Auras.getAuras] Getting auras for item ${itemId}`);
    const items = await OBR.scene.items.getItems([itemId]);
    
    if (items.length === 0) {
      debugWarn(`[Auras.getAuras] Item not found: ${itemId}`);
      return [];
    }

    const item = items[0];
    const auras = item.metadata[AURAS_METADATA_KEY]?.auras || [];
    
    debugLog(`[Auras.getAuras] Found ${auras.length} aura(s) on item ${itemId}`, auras);
    return auras;
  } catch (error) {
    debugError(`[Auras.getAuras] Error getting auras for item ${itemId}:`, error);
    throw error;
  }
}

/**
 * Add an aura to an item via broadcast
 * @param {string|Array} itemId - Item ID or array of item IDs
 * @param {Object} config - Aura configuration object
 *   
 *   For color-based auras (Glow, Bubble, Range, Solid, Simple, Distort, Spirits, Custom):
 *   - style: string (Glow|Bubble|Range|Solid|Simple|Distort|Spirits|Custom)
 *   - color: string (hex color like #FF0000)
 *   - size: number (radius in cells)
 *   - opacity: number (optional, 0-1)
 *   - blendMode: string (optional)
 *   - sksl: string (optional, only for Custom style)
 *
 *   For image auras via broadcast:
 *   NOT DIRECTLY SUPPORTED - Use addAuraPreset() instead, or set image auras
 *   through the Emanation extension UI.
 *   Image auras created via broadcast API require ImageContent and ImageGrid
 *   objects that are not easily created in JavaScript.
 * 
 * @returns {Promise<void>}
 */
export async function addAura(itemId, config) {
  try {
    if (!config || !config.style || typeof config.size !== 'number') {
      throw new Error("[Auras.addAura] Invalid aura config: must have style and size");
    }

    if (config.style === 'Image' || config.style === 'image') {
      throw new Error(
        "[Auras.addAura] Image auras are not directly supported via broadcast API. " +
        "Use addAuraPreset() instead, or create image auras through the Emanation extension UI."
      );
    }

    // Validate color is provided for non-Image styles
    if (!config.color) {
      throw new Error("[Auras.addAura] Non-image auras require 'color' (hex like #FF0000)");
    }

    const sources = Array.isArray(itemId) ? itemId : [itemId];
    debugLog(`[Auras.addAura] Adding ${config.style} aura to ${sources.length} item(s)`, config);

    const message = {
      type: "CREATE_AURAS",
      sources: sources,
      size: config.size,
      style: config.style,
      color: config.color,
    };

    // Add optional parameters if provided
    if (config.opacity !== undefined) {
      message.opacity = config.opacity;
    }
    if (config.blendMode !== undefined) {
      message.blendMode = config.blendMode;
    }
    if (config.visibleTo !== undefined) {
      message.visibleTo = config.visibleTo;
    }
    if (config.layer !== undefined) {
      message.layer = config.layer;
    }
    if (config.style === 'Custom' && config.sksl) {
      message.sksl = config.sksl;
    }

    await OBR.broadcast.sendMessage(
      AURAS_CHANNEL,
      message,
      { destination: "LOCAL" }
    );

    debugLog(`[Auras.addAura] ✓ Aura creation message sent`);
  } catch (error) {
    debugError(`[Auras.addAura] Error adding aura:`, error);
    throw error;
  }
}

/**
 * Remove all auras from an item
 * @param {string|Array} itemId - Item ID or array of item IDs
 * @returns {Promise<void>}
 */
export async function removeAura(itemId) {
  try {
    const sources = Array.isArray(itemId) ? itemId : [itemId];
    debugLog(`[Auras.removeAura] Removing all auras from ${sources.length} item(s)`);

    await OBR.broadcast.sendMessage(
      AURAS_CHANNEL,
      {
        type: "REMOVE_AURAS",
        sources: sources,
      },
      { destination: "LOCAL" }
    );

    debugLog(`[Auras.removeAura] ✓ Aura removal message sent`);
  } catch (error) {
    debugError(`[Auras.removeAura] Error removing auras:`, error);
    throw error;
  }
}
