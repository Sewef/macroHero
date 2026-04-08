﻿/**
 * Weather Integration for Owlbear Rodeo
 * Interfaces with the official Weather extension
 * https://github.com/owlbear-rodeo/weather
 */

import OBR, { isImage } from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../../debugMode.js";

// Debug mode constants
const logger = createDebugLogger("Weather");


// Plugin ID for the official Weather extension
const WEATHER_METADATA_KEY = "rodeo.owlbear.weather/weather";

/**
 * Set weather on a map (compatible with weather-extended)
 * @param {string} mapId - The ID of the map item
 * @param {Object} config - Weather configuration
 * @param {string} config.type - Weather type: "SNOW", "RAIN", "SAND", "FIRE", "CLOUD", "BLOOM", "ENERGYSTORM", "WATER", or "CURRENT"
 * @param {number} [config.speed=1] - Wind speed (1-4)
 * @param {number} [config.density=3] - Weather density/cover (1-4)
 * @param {Object} [config.direction={x: -1, y: -1}] - Wind direction vector
 * @param {string} [config.tint] - Color tint in hex format (e.g., "#88aaff")
 * @returns {Promise<void>}
 */
export async function setWeather(mapId, config) {
  try {
    if (!mapId) {
      logger.error("[Weather] setWeather: mapId is required");
      throw new Error("mapId is required");
    }

    if (!config || !config.type) {
      logger.error("[Weather] setWeather: config.type is required");
      throw new Error("config.type is required");
    }

    // Validate weather type (weather-extended includes 3 additional types)
    const validTypes = ["SNOW", "RAIN", "SAND", "FIRE", "CLOUD", "BLOOM", "ENERGYSTORM", "WATER", "CURRENT"];
    if (!validTypes.includes(config.type)) {
      logger.error(`[Weather] Invalid weather type: ${config.type}`);
      throw new Error(`Invalid weather type. Use: "SNOW", "RAIN", "SAND", "FIRE", "CLOUD", "BLOOM", "ENERGYSTORM", "WATER", or "CURRENT"`);
    }

    // Build weather config matching official extension format
    const weatherConfig = {
      type: config.type,
      speed: config.speed ?? 1,
      density: config.density ?? 3,
      direction: config.direction ?? { x: -1, y: -1 }
    };
    
    // Only add tint if explicitly provided and not white
    // The weather-extended fork expects tint to be omitted (not undefined) for default white
    if (config.tint && config.tint !== "#ffffff") {
      weatherConfig.tint = config.tint;
    }
    // If tint is omitted, WeatherActor will use "#ffffff" as fallback via ??

    logger.log(`[Weather] Setting weather on map ${mapId}:`, weatherConfig);

    await OBR.scene.items.updateItems([mapId], (items) => {
      for (const item of items) {
        if (isImage(item) && (item.layer === 'MAP' || item.layer === 'FOG')) {
          item.metadata[WEATHER_METADATA_KEY] = weatherConfig;
          logger.log(`[Weather] âœ“ Weather metadata set on map:`, item.name);
        }
      }
    });

    logger.log(`[Weather] âœ“ Weather set successfully`);
  } catch (error) {
    logger.error(`[Weather] Error setting weather:`, error.message);
    throw error;
  }
}

/**
 * Remove weather from a map (compatible with official Weather extension)
 * @param {string} mapId - The ID of the map item
 * @returns {Promise<void>}
 */
export async function removeWeather(mapId) {
  try {
    if (!mapId) {
      logger.error("[Weather] removeWeather: mapId is required");
      throw new Error("mapId is required");
    }

    logger.log(`[Weather] Removing weather from map ${mapId}`);

    await OBR.scene.items.updateItems([mapId], (items) => {
      for (const item of items) {
        if (isImage(item) && (item.layer === 'MAP' || item.layer === 'FOG')) {
          delete item.metadata[WEATHER_METADATA_KEY];
          logger.log(`[Weather] âœ“ Weather removed from map:`, item.name);
        }
      }
    });

    logger.log(`[Weather] âœ“ Weather removed successfully`);
  } catch (error) {
    logger.error(`[Weather] Error removing weather:`, error.message);
    throw error;
  }
}

/**
 * Get weather configuration from a map (compatible with official Weather extension)
 * @param {string} mapId - The ID of the map item
 * @returns {Promise<Object|null>} Weather config or null if no weather
 */
export async function getWeather(mapId) {
  try {
    if (!mapId) {
      logger.error("[Weather] getWeather: mapId is required");
      throw new Error("mapId is required");
    }

    const items = await OBR.scene.items.getItems([mapId]);
    const map = items[0];

    if (!map || !isImage(map) || (map.layer !== 'MAP' && map.layer !== 'FOG')) {
      logger.warn(`[Weather] Item ${mapId} is not a valid map`);
      return null;
    }

    const config = map.metadata[WEATHER_METADATA_KEY];
    
    if (!config) {
      logger.log(`[Weather] No weather on map ${mapId}`);
      return null;
    }

    logger.log(`[Weather] Weather config for map ${mapId}:`, config);
    return config;
  } catch (error) {
    logger.error(`[Weather] Error getting weather:`, error.message);
    throw error;
  }
}

/**
 * Check if a map has weather
 * @param {string} mapId - The ID of the map item
 * @returns {Promise<boolean>}
 */
export async function hasWeather(mapId) {
  try {
    const config = await getWeather(mapId);
    return config !== null;
  } catch (error) {
    logger.error(`[Weather] Error checking weather:`, error.message);
    return false;
  }
}

/**
 * Update weather properties on a map (uses official extension's update method)
 * @param {string} mapId - The ID of the map item
 * @param {Object} updates - Properties to update
 * @returns {Promise<void>}
 */
export async function updateWeather(mapId, updates) {
  try {
    if (!mapId) {
      logger.error("[Weather] updateWeather: mapId is required");
      throw new Error("mapId is required");
    }

    if (!updates || Object.keys(updates).length === 0) {
      logger.warn("[Weather] No updates provided");
      return;
    }

    // Validate type if provided (weather-extended includes 3 additional types)
    if (updates.type) {
      const validTypes = ["SNOW", "RAIN", "SAND", "FIRE", "CLOUD", "BLOOM", "ENERGYSTORM", "WATER", "CURRENT"];
      if (!validTypes.includes(updates.type)) {
        logger.error(`[Weather] Invalid weather type: ${updates.type}`);
        throw new Error(`Invalid weather type. Use: "SNOW", "RAIN", "SAND", "FIRE", "CLOUD", "BLOOM", "ENERGYSTORM", "WATER", or "CURRENT"`);
      }
    }

    logger.log(`[Weather] Updating weather on map ${mapId} with:`, updates);

    // Use the official extension's method: directly modify metadata object
    await OBR.scene.items.updateItems([mapId], (items) => {
      for (const item of items) {
        if (isImage(item) && (item.layer === 'MAP' || item.layer === 'FOG')) {
          const config = item.metadata[WEATHER_METADATA_KEY];
          if (config && typeof config === 'object') {
            // Update properties directly on the config object
            Object.assign(config, updates);
            
            // Handle tint: undefined if white, otherwise hex value
            if ('tint' in updates) {
              config.tint = updates.tint === "#ffffff" ? undefined : updates.tint;
            }
            
            logger.log(`[Weather] âœ“ Weather updated on map:`, item.name, config);
          } else {
            logger.warn(`[Weather] No weather on map:`, item.name);
          }
        }
      }
    });

    logger.log(`[Weather] âœ“ Weather update completed`);
  } catch (error) {
    logger.error(`[Weather] Error updating weather:`, error.message);
    throw error;
  }
}

export default {
  setWeather,
  removeWeather,
  getWeather,
  hasWeather,
  updateWeather
};

