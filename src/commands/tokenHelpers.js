import OBR, { buildImage } from "@owlbear-rodeo/sdk";
import { isDebugEnabled } from "../debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('tokenHelpers') && console.log(...args);
const debugError = (...args) => console.error(...args);
const debugWarn = (...args) => console.warn(...args);

/**
 * Load an image and get its real dimensions
 * @param {string} url - Image URL
 * @returns {Promise<{width: number, height: number}>} Image dimensions
 */
async function getImageDimensions(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      reject(new Error(`Failed to load image: ${url}`));
    };
    img.src = url;
  });
}

/**
 * Detect MIME type from URL extension
 * @param {string} url - Image URL
 * @returns {string} MIME type
 */
function detectMimeType(url) {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.endsWith(".jpg") || lowerUrl.endsWith(".jpeg")) {
    return "image/jpeg";
  } else if (lowerUrl.endsWith(".gif")) {
    return "image/gif";
  } else if (lowerUrl.endsWith(".webp")) {
    return "image/webp";
  } else if (lowerUrl.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return "image/png";
}

/**
 * Create a token/image item on the scene
 * @param {Object} params - Token creation parameters
 * @param {string} params.url - Image URL
 * @param {string} [params.mime] - Image MIME type (e.g., "image/png", "image/jpeg") - auto-detected from URL if not provided
 * @param {number} [params.width] - Image width in pixels - auto-detected from image if not provided
 * @param {number} [params.height] - Image height in pixels - auto-detected from image if not provided
 * @param {number} [params.size] - Token size in grid cells (e.g., 1.0 = 1 cell, 2.0 = 2 cells) - overrides scale if provided
 * @param {number} [params.dpi] - DPI for grid alignment - auto-detected from scene grid if not provided
 * @param {Object} [params.offset] - Image offset {x, y} - auto-calculated as center if not provided
 * @param {Object} [params.position] - Token position {x, y} or {gridX, gridY} if gridPosition is true
 * @param {boolean} [params.gridPosition=false] - If true, position is interpreted as grid coordinates instead of scene coordinates
 * @param {number} [params.scale=1] - Token scale (ignored if size is specified)
 * @param {number} [params.rotation=0] - Token rotation in degrees
 * @param {string} [params.layer="CHARACTER"] - Layer: "CHARACTER", "MOUNT", "PROP", "ATTACHMENT", "MAP", "FOG", "DRAWING", "POINTER", "NOTE", "CONTROL", "RULER"
 * @param {string} [params.name] - Token name
 * @param {string} [params.label] - Token text label
 * @param {boolean} [params.visible=true] - Token visibility
 * @param {boolean} [params.locked=false] - Token locked state
 * @param {Object} [params.metadata] - Custom metadata object
 * @returns {Promise<string>} Created token ID
 */
export async function createToken(params) {
  try {
    let {
      url,
      mime,
      width,
      height,
      size,
      dpi,
      offset,
      position = { x: 0, y: 0 },
      gridPosition = false,
      scale = 1,
      rotation = 0,
      layer = "CHARACTER",
      name,
      label,
      visible = true,
      locked = false,
      metadata = {}
    } = params;

    // Validate required parameters
    if (!url) throw new Error("Token URL is required");

    // Auto-detect DPI from scene grid if not provided
    if (!dpi) {
      dpi = await OBR.scene.grid.getDpi();
      debugLog(`[tokenHelpers] Auto-detected grid DPI: ${dpi}`);
    }

    // Auto-detect MIME type if not provided
    if (!mime) {
      mime = detectMimeType(url);
      debugLog(`[tokenHelpers] Auto-detected MIME type: ${mime}`);
    }

    // Auto-detect dimensions if not provided
    if (!width || !height) {
      debugLog(`[tokenHelpers] Auto-detecting dimensions for: ${url}`);
      const dimensions = await getImageDimensions(url);
      width = dimensions.width;
      height = dimensions.height;
      debugLog(`[tokenHelpers] Auto-detected dimensions: ${width}x${height}`);
    }

    // Auto-calculate offset if not provided
    if (!offset) {
      offset = { x: width / 2, y: height / 2 };
    }

    // Calculate scale from size if provided
    if (size !== undefined) {
      const sizeInPixels = size * dpi;
      const maxDimension = Math.max(width, height);
      scale = sizeInPixels / maxDimension;
      debugLog(`[tokenHelpers] Size ${size} cells = ${sizeInPixels}px, calculated scale = ${scale}`);
    }

    // Convert grid position to scene position if gridPosition is true
    if (gridPosition && position) {
      const gridX = position.gridX ?? position.x;
      const gridY = position.gridY ?? position.y;
      position = {
        x: gridX * dpi + dpi / 2,
        y: gridY * dpi + dpi / 2
      };
      debugLog(`[tokenHelpers] Converted grid position (${gridX}, ${gridY}) to scene position:`, position);
    }

    debugLog(`[tokenHelpers] Creating token:`, { url, width, height, position, layer, scale });

    // Build the image item
    let builder = buildImage(
      { url, mime, width, height },
      { dpi, offset }
    );

    // Set position and transform
    if (position) {
      builder = builder.position(position);
    }
    if (scale !== 1) {
      builder = builder.scale({ x: scale, y: scale });
    }
    if (rotation !== 0) {
      builder = builder.rotation(rotation);
    }

    // Set layer
    builder = builder.layer(layer);

    // Set name
    if (name) {
      builder = builder.name(name);
    }

    // Set text label
    if (label) {
      builder = builder.plainText(label);
    }

    // Set visibility and locked state
    builder = builder.visible(visible);
    builder = builder.locked(locked);

    // Set metadata
    if (metadata && Object.keys(metadata).length > 0) {
      builder = builder.metadata(metadata);
    }

    // Build and add the item
    const item = builder.build();
    await OBR.scene.items.addItems([item]);

    debugLog(`[tokenHelpers] Token created successfully:`, item.id);
    return item.id;

  } catch (error) {
    debugError(`[tokenHelpers] Error creating token:`, error.message);
    throw error;
  }
}

/**
 * Create multiple tokens at once
 * @param {Array<Object>} tokensParams - Array of token creation parameters
 * Each param can have:
 * - url (required)
 * - mime (optional - auto-detected)
 * - width (optional - auto-detected)
 * - height (optional - auto-detected)  
 * - size (optional - in grid cells, used for scaling if width/height auto-detected)
 * - position, scale, rotation, layer, name, label, visible, locked, metadata
 * @returns {Promise<string[]>} Array of created token IDs
 */
export async function createTokens(tokensParams) {
  try {
    debugLog(`[tokenHelpers] Creating ${tokensParams.length} tokens`);

    // Get grid DPI once for all tokens
    const gridDpi = await OBR.scene.grid.getDpi();
    debugLog(`[tokenHelpers] Grid DPI: ${gridDpi}`);

    // Process each token parameter - detect dimensions if needed
    const processedParams = await Promise.all(tokensParams.map(async (params) => {
      let { url, mime, width, height, size } = params;
      
      // Auto-detect MIME type if not provided
      if (!mime) {
        mime = detectMimeType(url);
      }

      // Auto-detect dimensions if not provided
      if (!width || !height) {
        debugLog(`[tokenHelpers] Auto-detecting dimensions for: ${url}`);
        const dimensions = await getImageDimensions(url);
        width = dimensions.width;
        height = dimensions.height;
        
        // If size is specified (in grid cells), calculate scale to fit
        if (size && !params.scale) {
          const sizeInPixels = size * gridDpi;
          const maxDimension = Math.max(width, height);
          params.scale = sizeInPixels / maxDimension;
          debugLog(`[tokenHelpers] Size ${size} cells = ${sizeInPixels}px, scale = ${params.scale}`);
        }
      }

      return {
        ...params,
        url,
        mime,
        width,
        height,
        dpi: gridDpi,
        offset: params.offset || { x: width / 2, y: height / 2 }
      };
    }));

    // Build all items
    const items = processedParams.map(params => {
      const {
        url,
        mime,
        width,
        height,
        dpi,
        offset,
        position = { x: 0, y: 0 },
        scale = 1,
        rotation = 0,
        layer = "CHARACTER",
        name,
        label,
        visible = true,
        locked = false,
        metadata = {}
      } = params;

      // Build the image item
      let builder = buildImage(
        { url, mime, width, height },
        { dpi, offset }
      );

      // Set position and transform
      if (position) {
        builder = builder.position(position);
      }
      if (scale !== 1) {
        builder = builder.scale({ x: scale, y: scale });
      }
      if (rotation !== 0) {
        builder = builder.rotation(rotation);
      }

      // Set layer
      builder = builder.layer(layer);

      // Set name
      if (name) {
        builder = builder.name(name);
      }

      // Set text label
      if (label) {
        builder = builder.plainText(label);
      }

      // Set visibility and locked state
      builder = builder.visible(visible);
      builder = builder.locked(locked);

      // Set metadata
      if (metadata && Object.keys(metadata).length > 0) {
        builder = builder.metadata(metadata);
      }

      return builder.build();
    });

    // Add all items at once
    await OBR.scene.items.addItems(items);

    const ids = items.map(item => item.id);
    debugLog(`[tokenHelpers] ${ids.length} tokens created successfully`);
    return ids;

  } catch (error) {
    debugError(`[tokenHelpers] Error creating tokens:`, error.message);
    throw error;
  }
}
