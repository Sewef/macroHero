/**
 * Aurora Integration for Owlbear Rodeo
 * Interfaces with the Aurora extension for time-of-day lighting effects
 * https://github.com/Several-Record7234/aurora
 */

import OBR, { isImage } from "@owlbear-rodeo/sdk";
import { isDebugEnabled } from "../../debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('Aurora') && console.log(...args);
const debugError = (...args) => console.error(...args);
const debugWarn = (...args) => console.warn(...args);

// Plugin ID for the Aurora extension
const AURORA_METADATA_KEY = "com.aurora-vtt.aurora/config";

/**
 * Aurora presets
 */
const AURORA_PRESETS = {
  MIDNIGHT: { n: "Midnight", s: 25, l: 30, h: 115, o: 40, b: 3, f: 0, fi: false },
  GOLDEN_HOUR: { n: "Golden Hour", s: 120, l: 80, h: 30, o: 20, b: 2, f: 0, fi: false },
  PRE_DAWN: { n: "Pre-Dawn", s: 80, l: 50, h: -150, o: 40, b: 3, f: 0, fi: false },
  BLOOD_MOON: { n: "Blood Moon", s: 35, l: 40, h: 0, o: 50, b: 0, f: 0, fi: false },
};

/**
 * Get preset configuration by name
 * @param {string} presetName - Name of the preset (case-insensitive)
 * @returns {Object|null} Preset configuration or null if not found
 */
function getPreset(presetName) {
  const normalizedName = presetName.toUpperCase().replace(/[\s-]/g, '_');
  return AURORA_PRESETS[normalizedName] || null;
}

/**
 * Convert full property names to short Aurora metadata keys
 * @param {Object} config - Configuration with full property names
 * @returns {Object} Configuration with short property names
 */
function toAuroraMetadata(config) {
  const metadata = {};
  
  if (config.saturation !== undefined) metadata.s = config.saturation;
  if (config.lightness !== undefined) metadata.l = config.lightness;
  if (config.hue !== undefined) metadata.h = config.hue;
  if (config.opacity !== undefined) metadata.o = config.opacity;
  if (config.enabled !== undefined) metadata.e = config.enabled;
  if (config.blendMode !== undefined) metadata.b = config.blendMode;
  if (config.feather !== undefined) metadata.f = config.feather;
  if (config.featherInvert !== undefined) metadata.fi = config.featherInvert;
  if (config.name !== undefined) metadata.n = config.name;
  
  return metadata;
}

/**
 * Convert short Aurora metadata keys to full property names
 * @param {Object} metadata - Metadata with short property names
 * @returns {Object} Configuration with full property names
 */
function fromAuroraMetadata(metadata) {
  if (!metadata) return null;
  
  const config = {};
  
  if (metadata.s !== undefined) config.saturation = metadata.s;
  if (metadata.l !== undefined) config.lightness = metadata.l;
  if (metadata.h !== undefined) config.hue = metadata.h;
  if (metadata.o !== undefined) config.opacity = metadata.o;
  if (metadata.e !== undefined) config.enabled = metadata.e;
  if (metadata.b !== undefined) config.blendMode = metadata.b;
  if (metadata.f !== undefined) config.feather = metadata.f;
  if (metadata.fi !== undefined) config.featherInvert = metadata.fi;
  if (metadata.n !== undefined) config.name = metadata.n;
  
  return config;
}

/**
 * Set Aurora lighting configuration on a map
 * @param {string} mapId - The ID of the map item
 * @param {Object|string} config - Aurora configuration object or preset name ("MIDNIGHT", "GOLDEN_HOUR", "PRE_DAWN", "BLOOD_MOON")
 * @param {number} [config.saturation=100] - Saturation (0-200, 100 = no change)
 * @param {number} [config.lightness=100] - Lightness (0-200, 100 = no change)
 * @param {number} [config.hue=0] - Hue (-180 to 180, degrees on the colour wheel)
 * @param {number} [config.opacity=40] - Opacity (0-100, tint overlay strength)
 * @param {boolean} [config.enabled=false] - Enabled (toggle without losing slider values)
 * @param {number} [config.blendMode=3] - Blend mode (0-3, index into BLEND_MODES)
 * @param {number} [config.feather=0] - Feather (0-100, edge-fade zone as % of shape half-size)
 * @param {boolean} [config.featherInvert=false] - Feather invert (false = fade edges, true = fade centre)
 * @param {string} [config.name] - Name (user-facing preset label)
 * @returns {Promise<void>}
 */
export async function setAurora(mapId, config) {
  try {
    if (!mapId) {
      debugError("[Aurora] setAurora: mapId is required");
      throw new Error("mapId is required");
    }

    if (!config) {
      debugError("[Aurora] setAurora: config is required");
      throw new Error("config is required");
    }

    // If config is a string, try to get the preset
    let configToUse = config;
    if (typeof config === 'string') {
      const preset = getPreset(config);
      if (!preset) {
        debugError(`[Aurora] Unknown preset: ${config}`);
        throw new Error(`Unknown preset: ${config}. Available presets: ${Object.keys(AURORA_PRESETS).join(', ')}`);
      }
      // Convert preset (short format) to full format
      configToUse = fromAuroraMetadata(preset);
      debugLog(`[Aurora] Using preset "${preset.n}":`, configToUse);
    }

    // Build Aurora config with defaults
    const fullConfig = {
      saturation: configToUse.saturation ?? 100,
      lightness: configToUse.lightness ?? 100,
      hue: configToUse.hue ?? 0,
      opacity: configToUse.opacity ?? 40,
      enabled: configToUse.enabled ?? true,
      blendMode: configToUse.blendMode ?? 3,
      feather: configToUse.feather ?? 0,
      featherInvert: configToUse.featherInvert ?? false
    };

    // Add name if provided
    if (configToUse.name !== undefined) {
      fullConfig.name = configToUse.name;
    }

    // Validate numeric ranges
    if (fullConfig.saturation < 0 || fullConfig.saturation > 200) {
      throw new Error("Saturation must be between 0 and 200");
    }
    if (fullConfig.lightness < 0 || fullConfig.lightness > 200) {
      throw new Error("Lightness must be between 0 and 200");
    }
    if (fullConfig.hue < -180 || fullConfig.hue > 180) {
      throw new Error("Hue must be between -180 and 180");
    }
    if (fullConfig.opacity < 0 || fullConfig.opacity > 100) {
      throw new Error("Opacity must be between 0 and 100");
    }
    if (fullConfig.blendMode < 0 || fullConfig.blendMode > 3) {
      throw new Error("Blend mode must be between 0 and 3");
    }
    if (fullConfig.feather < 0 || fullConfig.feather > 100) {
      throw new Error("Feather must be between 0 and 100");
    }

    // Convert to Aurora metadata format
    const auroraMetadata = toAuroraMetadata(fullConfig);

    debugLog(`[Aurora] Setting Aurora on map ${mapId}:`, auroraMetadata);

    await OBR.scene.items.updateItems([mapId], (items) => {
      for (const item of items) {
        if (isImage(item) && (item.layer === 'MAP' || item.layer === 'FOG')) {
          item.metadata[AURORA_METADATA_KEY] = auroraMetadata;
          debugLog(`[Aurora] ✓ Aurora metadata set on map:`, item.name);
        }
      }
    });

    debugLog(`[Aurora] ✓ Aurora set successfully`);
  } catch (error) {
    debugError(`[Aurora] Error setting Aurora:`, error.message);
    throw error;
  }
}

/**
 * Remove Aurora lighting from a map
 * @param {string} mapId - The ID of the map item
 * @returns {Promise<void>}
 */
export async function removeAurora(mapId) {
  try {
    if (!mapId) {
      debugError("[Aurora] removeAurora: mapId is required");
      throw new Error("mapId is required");
    }

    debugLog(`[Aurora] Removing Aurora from map ${mapId}`);

    await OBR.scene.items.updateItems([mapId], (items) => {
      for (const item of items) {
        if (isImage(item) && (item.layer === 'MAP' || item.layer === 'FOG')) {
          delete item.metadata[AURORA_METADATA_KEY];
          debugLog(`[Aurora] ✓ Aurora removed from map:`, item.name);
        }
      }
    });

    debugLog(`[Aurora] ✓ Aurora removed successfully`);
  } catch (error) {
    debugError(`[Aurora] Error removing Aurora:`, error.message);
    throw error;
  }
}

/**
 * Get Aurora configuration from a map
 * @param {string} mapId - The ID of the map item
 * @returns {Promise<Object|null>} Aurora config or null if no Aurora
 */
export async function getAurora(mapId) {
  try {
    if (!mapId) {
      debugError("[Aurora] getAurora: mapId is required");
      throw new Error("mapId is required");
    }

    const items = await OBR.scene.items.getItems([mapId]);
    const map = items[0];

    if (!map || !isImage(map) || (map.layer !== 'MAP' && map.layer !== 'FOG')) {
      debugWarn(`[Aurora] Item ${mapId} is not a valid map`);
      return null;
    }

    const metadata = map.metadata[AURORA_METADATA_KEY];
    
    if (!metadata) {
      debugLog(`[Aurora] No Aurora on map ${mapId}`);
      return null;
    }

    // Convert from Aurora metadata format to full property names
    const config = fromAuroraMetadata(metadata);
    
    debugLog(`[Aurora] Aurora config for map ${mapId}:`, config);
    return config;
  } catch (error) {
    debugError(`[Aurora] Error getting Aurora:`, error.message);
    throw error;
  }
}

/**
 * Check if a map has Aurora lighting
 * @param {string} mapId - The ID of the map item
 * @returns {Promise<boolean>}
 */
export async function hasAurora(mapId) {
  try {
    const config = await getAurora(mapId);
    return config !== null;
  } catch (error) {
    debugError(`[Aurora] Error checking Aurora:`, error.message);
    return false;
  }
}

/**
 * Get available Aurora presets
 * @returns {Object} Object with preset names as keys and configurations as values
 */
export function getPresets() {
  const presets = {};
  for (const [key, value] of Object.entries(AURORA_PRESETS)) {
    presets[key] = fromAuroraMetadata(value);
  }
  return presets;
}

/**
 * Update Aurora properties on a map
 * @param {string} mapId - The ID of the map item
 * @param {Object} updates - Properties to update
 * @returns {Promise<void>}
 */
export async function updateAurora(mapId, updates) {
  try {
    if (!mapId) {
      debugError("[Aurora] updateAurora: mapId is required");
      throw new Error("mapId is required");
    }

    if (!updates || Object.keys(updates).length === 0) {
      debugWarn("[Aurora] No updates provided");
      return;
    }

    // Validate numeric ranges if provided
    if ('saturation' in updates && (updates.saturation < 0 || updates.saturation > 200)) {
      throw new Error("Saturation must be between 0 and 200");
    }
    if ('lightness' in updates && (updates.lightness < 0 || updates.lightness > 200)) {
      throw new Error("Lightness must be between 0 and 200");
    }
    if ('hue' in updates && (updates.hue < -180 || updates.hue > 180)) {
      throw new Error("Hue must be between -180 and 180");
    }
    if ('opacity' in updates && (updates.opacity < 0 || updates.opacity > 100)) {
      throw new Error("Opacity must be between 0 and 100");
    }
    if ('blendMode' in updates && (updates.blendMode < 0 || updates.blendMode > 3)) {
      throw new Error("Blend mode must be between 0 and 3");
    }
    if ('feather' in updates && (updates.feather < 0 || updates.feather > 100)) {
      throw new Error("Feather must be between 0 and 100");
    }

    // Convert updates to Aurora metadata format
    const metadataUpdates = toAuroraMetadata(updates);

    debugLog(`[Aurora] Updating Aurora on map ${mapId} with:`, metadataUpdates);

    await OBR.scene.items.updateItems([mapId], (items) => {
      for (const item of items) {
        if (isImage(item) && (item.layer === 'MAP' || item.layer === 'FOG')) {
          const metadata = item.metadata[AURORA_METADATA_KEY];
          if (metadata && typeof metadata === 'object') {
            // Update properties directly on the metadata object
            Object.assign(metadata, metadataUpdates);
            debugLog(`[Aurora] ✓ Aurora updated on map:`, item.name, metadata);
          } else {
            debugWarn(`[Aurora] No Aurora on map:`, item.name);
          }
        }
      }
    });

    debugLog(`[Aurora] ✓ Aurora update completed`);
  } catch (error) {
    debugError(`[Aurora] Error updating Aurora:`, error.message);
    throw error;
  }
}

export default {
  setAurora,
  removeAurora,
  getAurora,
  hasAurora,
  updateAurora,
  getPresets,
  // Expose preset constants for direct access
  PRESETS: AURORA_PRESETS
};
