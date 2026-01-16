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
 * @param {string} params.mime - Image MIME type (e.g., "image/png", "image/jpeg")
 * @param {number} params.width - Image width in pixels
 * @param {number} params.height - Image height in pixels
 * @param {number} [params.dpi=150] - DPI for grid alignment
 * @param {Object} [params.offset] - Image offset {x, y}
 * @param {Object} [params.position] - Token position {x, y}
 * @param {number} [params.scale=1] - Token scale
 * @param {number} [params.rotation=0] - Token rotation in degrees
 * @param {string} [params.layer="CHARACTER"] - Layer: "CHARACTER", "MOUNT", "PROP", "ATTACHMENT", "MAP", "FOG", "DRAWING", "POINTER", "NOTE", "CONTROL", "RULER"
 * @param {string} [params.name] - Token name/label
 * @param {string} [params.plainText] - Plain text label
 * @param {boolean} [params.visible=true] - Token visibility
 * @param {boolean} [params.locked=false] - Token locked state
 * @param {Object} [params.metadata] - Custom metadata object
 * @returns {Promise<string>} Created token ID
 */
export async function createToken(params) {
  try {
    const {
      url,
      mime,
      width,
      height,
      dpi = 150,
      offset = { x: width / 2, y: height / 2 },
      position = { x: 0, y: 0 },
      scale = 1,
      rotation = 0,
      layer = "CHARACTER",
      name,
      plainText,
      visible = true,
      locked = false,
      metadata = {}
    } = params;

    // Validate required parameters
    if (!url) throw new Error("Token URL is required");
    if (!mime) throw new Error("Token MIME type is required");
    if (!width || !height) throw new Error("Token width and height are required");

    debugLog(`[tokenHelpers] Creating token:`, { url, width, height, position, layer });

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
    if (plainText) {
      builder = builder.plainText(plainText);
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
 * - position, scale, rotation, layer, name, plainText, visible, locked, metadata
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
        plainText,
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
      if (plainText) {
        builder = builder.plainText(plainText);
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

/**
 * Create a token from a template with default values
 * @param {Object} params - Token parameters
 * @param {string} params.url - Image URL
 * @param {string} [params.name] - Token name
 * @param {Object} [params.position] - Token position {x, y}
 * @param {number} [params.size=1.0] - Token size in grid cells (1.0 = 1 cell, 2.0 = 2 cells, etc.)
 * @param {string} [params.layer="CHARACTER"] - Layer
 * @returns {Promise<string>} Created token ID
 */
export async function createSimpleToken(params) {
  const {
    url,
    name,
    position = { x: 0, y: 0 },
    size = 1.0,
    layer = "CHARACTER"
  } = params;

  try {
    // Get grid DPI from the scene
    const gridDpi = await OBR.scene.grid.getDpi();
    debugLog(`[tokenHelpers] Grid DPI: ${gridDpi}`);

    // Detect MIME type from URL extension
    const mime = detectMimeType(url);

    // Get real image dimensions
    debugLog(`[tokenHelpers] Loading image to detect dimensions: ${url}`);
    const dimensions = await getImageDimensions(url);
    debugLog(`[tokenHelpers] Image dimensions: ${dimensions.width}x${dimensions.height}`);

    // Convert size in grid cells to pixels
    const sizeInPixels = size * gridDpi;
    debugLog(`[tokenHelpers] Size: ${size} cells = ${sizeInPixels} pixels (grid: ${gridDpi}px)`);

    // Calculate scale to fit the desired size (use the larger dimension as reference)
    const maxDimension = Math.max(dimensions.width, dimensions.height);
    const scale = sizeInPixels / maxDimension;

    return createToken({
      url,
      mime,
      width: dimensions.width,
      height: dimensions.height,
      position,
      scale,
      layer,
      name: name || "Token",
      plainText: name || "Token",
      dpi: gridDpi,
      offset: { x: dimensions.width / 2, y: dimensions.height / 2 }
    });
  } catch (error) {
    debugError(`[tokenHelpers] Error in createSimpleToken:`, error.message);
    throw error;
  }
}

/**
 * Create a token at a specific grid position
 * @param {Object} params - Token parameters
 * @param {string} params.url - Image URL
 * @param {number} params.gridX - Grid X coordinate
 * @param {number} params.gridY - Grid Y coordinate
 * @param {string} [params.name] - Token name
 * @param {number} [params.size=1.0] - Token size in grid cells (1.0 = 1 cell, 2.0 = 2 cells, etc.)
 * @returns {Promise<string>} Created token ID
 */
export async function createTokenAtGrid(params) {
  const {
    url,
    gridX,
    gridY,
    name,
    size = 1.0
  } = params;

  // Get grid DPI from the scene
  const gridDpi = await OBR.scene.grid.getDpi();

  // Convert grid coordinates to scene coordinates
  const position = {
    x: gridX * gridDpi + gridDpi / 2,
    y: gridY * gridDpi + gridDpi / 2
  };

  return createSimpleToken({
    url,
    name,
    position,
    size
  });
}

export default {
  createToken,
  createTokens,
  createSimpleToken,
  createTokenAtGrid
};
