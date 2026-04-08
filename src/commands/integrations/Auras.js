﻿/**
 * Auras Integration
 * Provides access to Auras auras on items/tokens
 * Communicates with Auras extension via broadcast messages
 */

import OBR from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../../debugMode.js";
import { buildImageBuildParams, validateImageBuildParams, broadcastLocal } from "../shared/sdkHelpers.js";

// Debug mode constants
const logger = createDebugLogger("Auras");


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
    logger.log(`[Auras.hasAura] Checking auras for item ${itemId}`);
    const items = await OBR.scene.items.getItems([itemId]);
    
    if (items.length === 0) {
      logger.warn(`[Auras.hasAura] Item not found: ${itemId}`);
      return false;
    }

    const item = items[0];
    const hasAuras = 
      item.metadata[AURAS_METADATA_KEY] && 
      Array.isArray(item.metadata[AURAS_METADATA_KEY].auras) &&
      item.metadata[AURAS_METADATA_KEY].auras.length > 0;

    logger.log(`[Auras.hasAura] Item ${itemId} has auras: ${hasAuras}`);
    return hasAuras;
  } catch (error) {
    logger.error(`[Auras.hasAura] Error checking auras for item ${itemId}:`, error);
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
    logger.log(`[Auras.getAuras] Getting auras for item ${itemId}`);
    const items = await OBR.scene.items.getItems([itemId]);
    
    if (items.length === 0) {
      logger.warn(`[Auras.getAuras] Item not found: ${itemId}`);
      return [];
    }

    const item = items[0];
    const auras = item.metadata[AURAS_METADATA_KEY]?.auras || [];
    
    logger.log(`[Auras.getAuras] Found ${auras.length} aura(s) on item ${itemId}`, auras);
    return auras;
  } catch (error) {
    logger.error(`[Auras.getAuras] Error getting auras for item ${itemId}:`, error);
    throw error;
  }
}

/**
 * Add an aura to an item via broadcast
 * @param {string|Array} itemId - Item ID or array of item IDs
 * @param {Object} config - Aura configuration object
 *   
 *   Required:
 *   - size: number â€” Aura radius in grid units
 *
 *   Optional (omitted = uses player defaults):
 *   - style: string â€” Glow|Bubble|Range|Solid|Simple|Distort|Spirits|Image|Custom
 *   - color: string â€” Hex color code (#FF0000, etc.). Required if style is not Image/Custom
 *   - opacity: number â€” 0-1, opacity value
 *   - blendMode: string â€” Blend mode (PLUS, DIFFERENCE, SATURATION, etc.)
 *   - layer: string â€” DRAWING, POST_PROCESS, etc.
 *   - visibleTo: string | null â€” Player ID for visibility (null = invisible to all)
 *   - sksl: string â€” Shader code for Custom style auras (required if style is Custom)
 *   
 *   For Image style auras, EITHER:
 *   - imageUrl: string â€” Image URL (automatically detects dimensions and MIME type)
 *   - imageBuildParams: object â€” Full {image: ImageContent, grid: ImageGrid} (overrides imageUrl)
 *
 * @returns {Promise<void>}
 */
export async function addAura(itemId, config) {
  try {
    if (!config || typeof config.size !== 'number') {
      throw new Error("[Auras.addAura] Invalid aura config: must have size (number)");
    }

    // Build the message with only provided parameters (let extension use player defaults for the rest)
    const message = {
      type: "CREATE_AURAS",
      sources: Array.isArray(itemId) ? itemId : [itemId],
      size: config.size,
    };

    // Add optional parameters if provided
    if (config.style !== undefined) {
      // Validate that if style is provided, required params are also provided
      if (config.style === 'Image' || config.style === 'image') {
        // For Image auras: either imageBuildParams (explicit) or imageUrl (auto-detect)
        if (config.imageBuildParams) {
          // Use explicit imageBuildParams if provided
          if (!validateImageBuildParams(config.imageBuildParams)) {
            throw new Error(
              "[Auras.addAura] Invalid imageBuildParams: must have {image: ImageContent, grid: ImageGrid}"
            );
          }
          message.style = config.style;
          message.imageBuildParams = config.imageBuildParams;
        } else if (config.imageUrl) {
          // Auto-detect dimensions and MIME type from URL
          logger.log(`[Auras.addAura] Auto-detecting parameters for image: ${config.imageUrl}`);
          const imageBuildParams = await buildImageBuildParams(config.imageUrl, {
            width: config.imageWidth,
            height: config.imageHeight,
            mime: config.imageMime,
            offset: config.imageOffset,
            dpi: config.imageDpi,
          });
          
          message.style = config.style;
          message.imageBuildParams = imageBuildParams;
          logger.log(`[Auras.addAura] âœ“ Auto-detected image parameters:`, imageBuildParams);
        } else {
          throw new Error(
            "[Auras.addAura] Image style requires either 'imageUrl' (auto-detect) or 'imageBuildParams' (explicit)"
          );
        }
      } else if (config.style === 'Custom' || config.style === 'custom') {
        if (!config.sksl) {
          throw new Error("[Auras.addAura] Custom style requires 'sksl' (shader code)");
        }
        message.style = config.style;
        message.sksl = config.sksl;
      } else {
        // Non-custom, non-image style provided - color is optional but recommended
        message.style = config.style;
        if (config.color !== undefined) {
          message.color = config.color;
        }
      }
    } else if (config.color !== undefined) {
      // Color provided without style - this is allowed, extension will use its default style
      message.color = config.color;
    }

    // Optional appearance parameters
    if (config.opacity !== undefined) {
      if (typeof config.opacity !== 'number' || config.opacity < 0 || config.opacity > 1) {
        throw new Error("[Auras.addAura] opacity must be a number between 0 and 1");
      }
      message.opacity = config.opacity;
    }
    if (config.blendMode !== undefined) {
      message.blendMode = config.blendMode;
    }

    // Optional advanced parameters
    if (config.visibleTo !== undefined) {
      message.visibleTo = config.visibleTo;
    }
    if (config.layer !== undefined) {
      message.layer = config.layer;
    }

    logger.log(`[Auras.addAura] Adding aura to ${message.sources.length} item(s)`, config);

    const result = await broadcastLocal(AURAS_CHANNEL, message);
    
    if (result.success) {
      logger.log(`[Auras.addAura] âœ“ Aura creation message sent`);
    } else {
      logger.error(`[Auras.addAura] Failed to broadcast: ${result.error}`);
    }
  } catch (error) {
    logger.error(`[Auras.addAura] Error adding aura:`, error);
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
    logger.log(`[Auras.removeAura] Removing all auras from ${sources.length} item(s)`);

    const result = await broadcastLocal(
      AURAS_CHANNEL,
      {
        type: "REMOVE_AURAS",
        sources: sources,
      }
    );

    if (result.success) {
      logger.log(`[Auras.removeAura] âœ“ Aura removal message sent`);
    } else {
      logger.error(`[Auras.removeAura] Failed to broadcast: ${result.error}`);
    }
  } catch (error) {
    logger.error(`[Auras.removeAura] Error removing auras:`, error);
    throw error;
  }
}

