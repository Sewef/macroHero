import OBR, { buildImage } from "@owlbear-rodeo/sdk";
import { isDebugEnabled } from "../debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('tokenHelpers') && console.log(...args);
const debugError = (...args) => console.error(...args);
const debugWarn = (...args) => console.warn(...args);

// Placeholder image for invalid or empty URLs
const PLACEHOLDER_IMAGE = "https://macrohero.onrender.com/logo.png";

/**
 * Get the ID of the currently selected token
 * @returns {Promise<string|null>} The ID of the first selected token, or null if none selected
 */
export async function getSelectedTokenId() {
  try {
    const selection = await OBR.player.getSelection();
    if (!selection || selection.length === 0) {
      debugLog(`[tokenHelpers] No token selected`);
      return null;
    }
    const selectedId = selection[0];
    debugLog(`[tokenHelpers] Selected token ID:`, selectedId);
    return selectedId;
  } catch (error) {
    debugError(`[tokenHelpers] Error getting selected token ID:`, error);
    throw error;
  }
}

/**
 * Get the IDs of all currently selected tokens
 * @returns {Promise<string[]>} Array of selected token IDs (empty array if none selected)
 */
export async function getSelectedTokensIds() {
  try {
    const selection = await OBR.player.getSelection();
    if (!selection || selection.length === 0) {
      debugLog(`[tokenHelpers] No tokens selected`);
      return [];
    }
    debugLog(`[tokenHelpers] Selected ${selection.length} token(s):`, selection);
    return selection;
  } catch (error) {
    debugError(`[tokenHelpers] Error getting selected tokens IDs:`, error);
    throw error;
  }
}

/**
 * Get a token's position by ID
 * @param {string} tokenId - Token ID
 * @returns {Promise<{x: number, y: number}|null>} Token position or null if not found
 */
export async function getTokenPosition(tokenId) {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (items.length === 0) {
      debugWarn(`[tokenHelpers] Token ${tokenId} not found`);
      return null;
    }
    debugLog(`[tokenHelpers] Token ${tokenId} position:`, items[0].position);
    return items[0].position;
  } catch (error) {
    debugError(`[tokenHelpers] Failed to get token position:`, error.message);
    return null;
  }
}

/**
 * Get a token's size in grid cells by ID
 * @param {string} tokenId - Token ID
 * @returns {Promise<number|null>} Token size (grid units) or null if not found
 */
export async function getTokenSize(tokenId) {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (items.length === 0) {
      debugWarn(`[tokenHelpers] Token ${tokenId} not found`);
      return null;
    }
    const size = typeof items[0].size === "number" ? items[0].size : null;
    debugLog(`[tokenHelpers] Token ${tokenId} size:`, size);
    return size;
  } catch (error) {
    debugError(`[tokenHelpers] Failed to get token size:`, error.message);
    return null;
  }
}

/**
 * Get the ID of the closest token to a given token
 * @param {string} tokenId - Reference token ID
 * @param {string|string[]|null} [filter] - Optional layer filter (e.g., "CHARACTER", "MOUNT", or array like ["CHARACTER", "MOUNT"]) - null or undefined to include all layers
 * @returns {Promise<string|null>} ID of the closest token, or null if no other tokens found or token not found
 */
export async function getClosestTokenId(tokenId, filter = null) {
  try {
    // Get the reference token's position
    const referenceItems = await OBR.scene.items.getItems([tokenId]);
    if (referenceItems.length === 0) {
      debugWarn(`[tokenHelpers] Reference token ${tokenId} not found`);
      return null;
    }
    const referencePos = referenceItems[0].position;
    debugLog(`[tokenHelpers] Reference token ${tokenId} position:`, referencePos);

    // Get all items in the scene
    const allItems = await OBR.scene.items.getItems();
    
    // Normalize filter to array
    let layerFilter = null;
    if (filter) {
      layerFilter = Array.isArray(filter) ? filter : [filter];
      debugLog(`[tokenHelpers] Filtering by layers:`, layerFilter);
    }

    // Filter items: exclude reference token and optionally filter by layer
    const candidateItems = allItems.filter(item => {
      if (item.id === tokenId) return false; // Exclude reference token
      if (layerFilter && !layerFilter.includes(item.layer)) return false; // Filter by layer if specified
      return true;
    });

    if (candidateItems.length === 0) {
      debugLog(`[tokenHelpers] No candidate tokens found matching filter`);
      return null;
    }

    // Calculate distances and find closest
    let closestToken = null;
    let minDistance = Infinity;

    for (const item of candidateItems) {
      const dx = item.position.x - referencePos.x;
      const dy = item.position.y - referencePos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < minDistance) {
        minDistance = distance;
        closestToken = item;
      }
    }

    if (closestToken) {
      debugLog(`[tokenHelpers] Closest token:`, closestToken.id, `at distance ${minDistance.toFixed(2)}`);
      return closestToken.id;
    }

    return null;
  } catch (error) {
    debugError(`[tokenHelpers] Error finding closest token:`, error.message);
    throw error;
  }
}

/**
 * Get the center position of the user's viewport
 * @returns {Promise<{x: number, y: number}>} Center position in scene coordinates
 */
async function getViewportCenter() {
  try {
    const viewportWidth = await OBR.viewport.getWidth();
    const viewportHeight = await OBR.viewport.getHeight();
    
    // Transform the center point of the viewport to scene coordinates
    const viewportCenterPoint = { x: viewportWidth / 2, y: viewportHeight / 2 };
    const scenePosition = await OBR.viewport.inverseTransformPoint(viewportCenterPoint);
    
    debugLog(`[tokenHelpers] Viewport center:`, scenePosition);
    return scenePosition;
  } catch (error) {
    debugError(`[tokenHelpers] Error getting viewport center:`, error);
    return { x: 0, y: 0 }; // Fallback to origin
  }
}

/**
 * Load an image and get its real dimensions
 * @param {string} url - Image URL
 * @param {boolean} usePlaceholderOnError - If true, returns placeholder URL on error
 * @returns {Promise<{width: number, height: number, url: string}>} Image dimensions and final URL
 */
async function getImageDimensions(url, usePlaceholderOnError = true) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight, url });
    };
    img.onerror = () => {
      if (usePlaceholderOnError && url !== PLACEHOLDER_IMAGE) {
        debugWarn(`[tokenHelpers] Failed to load image: ${url}, using placeholder`);
        // Try with placeholder
        getImageDimensions(PLACEHOLDER_IMAGE, false)
          .then(resolve)
          .catch(() => reject(new Error(`Failed to load image and placeholder: ${url}`)));
      } else {
        reject(new Error(`Failed to load image: ${url}`));
      }
    };
    img.src = url;
  });
}

/**
 * Select an asset from the user's library
 * @param {string} layer - Layer hint for asset type
 * @returns {Promise<Object>} Selected asset properties
 */
async function selectAsset(layer = "CHARACTER") {
  try {
    debugLog(`[tokenHelpers] Opening asset picker...`);
    const images = await OBR.assets.downloadImages(false, undefined, layer);
    
    if (!images || images.length === 0) {
      throw new Error("No image selected");
    }
    
    const selectedImage = images[0];
    debugLog(`[tokenHelpers] Selected image:`, selectedImage);
    
    return {
      url: selectedImage.image.url,
      mime: selectedImage.image.mime,
      width: selectedImage.image.width,
      height: selectedImage.image.height,
      rotation: selectedImage.rotation,
      scale: selectedImage.scale,
      name: selectedImage.name,
      label: selectedImage.text?.plainText,
      visible: selectedImage.visible,
      locked: selectedImage.locked
    };
  } catch (error) {
    debugError(`[tokenHelpers] Error selecting asset:`, error);
    throw new Error(`Failed to select asset: ${error.message || JSON.stringify(error)}`);
  }
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

    // Handle empty or placeholder URL
    if (!url || url === "EMPTY") {
      url = PLACEHOLDER_IMAGE;
      debugLog(`[tokenHelpers] Using placeholder image`);
    }

    // Special case: if url is "SELECT", open asset picker
    if (url === "SELECT") {
      const asset = await selectAsset(layer);
      
      // Use properties from selected asset
      url = asset.url;
      mime = asset.mime;
      width = asset.width;
      height = asset.height;
      
      // Override with asset defaults if not explicitly provided
      if (rotation === 0 && asset.rotation) rotation = asset.rotation;
      if (scale === 1 && asset.scale) scale = asset.scale;
      if (!name && asset.name) name = asset.name;
      if (!label && asset.label) label = asset.label;
      if (visible === true && asset.visible !== undefined) visible = asset.visible;
      if (locked === false && asset.locked !== undefined) locked = asset.locked;
    }

    // Special case: if position is "HERE", use viewport center
    if (position === "HERE") {
      position = await getViewportCenter();
      debugLog(`[tokenHelpers] Using viewport center for position:`, position);
    }

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
      const result = await getImageDimensions(url);
      width = result.width;
      height = result.height;
      url = result.url; // Use final URL (may be placeholder if original failed)
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

    // Check if any token uses "SELECT" for URL
    const needsAssetSelection = tokensParams.some(p => p.url === "SELECT");
    let selectedAsset = null;
    
    if (needsAssetSelection) {
      // Use layer from first token with SELECT, or default to CHARACTER
      const firstSelectToken = tokensParams.find(p => p.url === "SELECT");
      selectedAsset = await selectAsset(firstSelectToken?.layer || "CHARACTER");
    }

    // Check if any token uses "HERE" for position
    const needsViewportCenter = tokensParams.some(p => p.position === "HERE");
    let viewportCenter = null;
    
    if (needsViewportCenter) {
      viewportCenter = await getViewportCenter();
    }

    // Get grid DPI once for all tokens
    const gridDpi = await OBR.scene.grid.getDpi();
    debugLog(`[tokenHelpers] Grid DPI: ${gridDpi}`);

    // Process each token parameter - detect dimensions if needed
    const processedParams = await Promise.all(tokensParams.map(async (params) => {
      let { url, mime, width, height, size } = params;
      
      // Handle empty or placeholder URL
      if (!url || url === "EMPTY") {
        url = PLACEHOLDER_IMAGE;
      }
      
      // Replace SELECT with selected asset
      if (url === "SELECT" && selectedAsset) {
        url = selectedAsset.url;
        if (!mime) mime = selectedAsset.mime;
        if (!width) width = selectedAsset.width;
        if (!height) height = selectedAsset.height;
        if (!params.name && selectedAsset.name) params.name = selectedAsset.name;
        if (!params.label && selectedAsset.label) params.label = selectedAsset.label;
        if (params.rotation === undefined && selectedAsset.rotation) params.rotation = selectedAsset.rotation;
        if (params.visible === undefined && selectedAsset.visible !== undefined) params.visible = selectedAsset.visible;
        if (params.locked === undefined && selectedAsset.locked !== undefined) params.locked = selectedAsset.locked;
      }
      
      // Auto-detect MIME type if not provided
      if (!mime) {
        mime = detectMimeType(url);
      }

      // Auto-detect dimensions if not provided
      if (!width || !height) {
        debugLog(`[tokenHelpers] Auto-detecting dimensions for: ${url}`);
        const result = await getImageDimensions(url);
        width = result.width;
        height = result.height;
        url = result.url; // Use final URL (may be placeholder if original failed)
        
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
      let {
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

      // Replace HERE with viewport center
      if (position === "HERE" && viewportCenter) {
        position = viewportCenter;
      }

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

/**
 * Set the visibility of one or more items
 * @param {string|string[]} itemIds - Single item ID or array of item IDs
 * @param {boolean} visible - Visibility state
 * @returns {Promise<void>}
 */
export async function setItemsVisible(itemIds, visible) {
  try {
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    debugLog(`[tokenHelpers] Setting ${ids.length} item(s) visible to ${visible}`);
    
    await OBR.scene.items.updateItems(ids, (draft) => {
      draft.forEach(item => {
        item.visible = visible;
      });
    });
    
    debugLog(`[tokenHelpers] Items visibility updated successfully`);
  } catch (error) {
    debugError(`[tokenHelpers] Error setting items visible:`, error.message);
    throw error;
  }
}

/**
 * Set the locked state of one or more items
 * @param {string|string[]} itemIds - Single item ID or array of item IDs
 * @param {boolean} locked - Locked state
 * @returns {Promise<void>}
 */
export async function setItemsLocked(itemIds, locked) {
  try {
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    debugLog(`[tokenHelpers] Setting ${ids.length} item(s) locked to ${locked}`);
    
    await OBR.scene.items.updateItems(ids, (draft) => {
      draft.forEach(item => {
        item.locked = locked;
      });
    });
    
    debugLog(`[tokenHelpers] Items locked state updated successfully`);
  } catch (error) {
    debugError(`[tokenHelpers] Error setting items locked:`, error.message);
    throw error;
  }
}

/**
 * Set the image/source of one or more items
 * @param {string|string[]} itemIds - Single item ID or array of item IDs
 * @param {string} url - Image URL
 * @param {string} [mime] - Image MIME type (auto-detected if not provided)
 * @returns {Promise<void>}
 */
export async function setItemsImage(itemIds, url, mime) {
  try {
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    debugLog(`[tokenHelpers] Setting ${ids.length} item(s) image to ${url}`);
    
    // Auto-detect MIME type if not provided
    const detectedMime = mime || detectMimeType(url);
    
    await OBR.scene.items.updateItems(ids, (draft) => {
      draft.forEach(item => {
        item.image = {
          url,
          mime: detectedMime
        };
      });
    });
    
    debugLog(`[tokenHelpers] Items image updated successfully`);
  } catch (error) {
    debugError(`[tokenHelpers] Error setting items image:`, error.message);
    throw error;
  }
}

/**
 * Set the name of one or more items
 * @param {string|string[]} itemIds - Single item ID or array of item IDs
 * @param {string} name - Item name
 * @returns {Promise<void>}
 */
export async function setItemsName(itemIds, name) {
  try {
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    debugLog(`[tokenHelpers] Setting ${ids.length} item(s) name to "${name}"`);
    
    await OBR.scene.items.updateItems(ids, (draft) => {
      draft.forEach(item => {
        item.name = name;
      });
    });
    
    debugLog(`[tokenHelpers] Items name updated successfully`);
  } catch (error) {
    debugError(`[tokenHelpers] Error setting items name:`, error.message);
    throw error;
  }
}

/**
 * Set the text label of one or more items
 * @param {string|string[]} itemIds - Single item ID or array of item IDs
 * @param {string} label - Text label
 * @returns {Promise<void>}
 */
export async function setItemsLabel(itemIds, label) {
  try {
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    debugLog(`[tokenHelpers] Setting ${ids.length} item(s) label to "${label}"`);
    
    await OBR.scene.items.updateItems(ids, (draft) => {
      draft.forEach(item => {
        if (item.text !== undefined) {
          item.text.plainText = label;
        }
      });
    });
    
    debugLog(`[tokenHelpers] Items label updated successfully`);
  } catch (error) {
    debugError(`[tokenHelpers] Error setting items label:`, error.message);
    throw error;
  }
}

/**
 * Set the layer of one or more items
 * @param {string|string[]} itemIds - Single item ID or array of item IDs
 * @param {string} layer - Layer name (e.g., "CHARACTER", "MOUNT", "PROP", "ATTACHMENT", etc.)
 * @returns {Promise<void>}
 */
export async function setItemsLayer(itemIds, layer) {
  try {
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    debugLog(`[tokenHelpers] Setting ${ids.length} item(s) layer to "${layer}"`);
    
    await OBR.scene.items.updateItems(ids, (draft) => {
      draft.forEach(item => {
        item.layer = layer;
      });
    });
    
    debugLog(`[tokenHelpers] Items layer updated successfully`);
  } catch (error) {
    debugError(`[tokenHelpers] Error setting items layer:`, error.message);
    throw error;
  }
}

/**
 * Set the position of one or more items
 * @param {string|string[]} itemIds - Single item ID or array of item IDs
 * @param {Object} position - Position object {x, y}
 * @param {boolean} [gridPosition=false] - If true, position is interpreted as grid coordinates instead of scene coordinates
 * @returns {Promise<void>}
 */
export async function setItemsPosition(itemIds, position, gridPosition = false) {
  try {
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    debugLog(`[tokenHelpers] Setting ${ids.length} item(s) position to`, position);
    
    let targetPosition = position;
    if (gridPosition) {
      const dpi = await OBR.scene.grid.getDpi();
      const gridX = position.gridX ?? position.x;
      const gridY = position.gridY ?? position.y;
      targetPosition = {
        x: gridX * dpi + dpi / 2,
        y: gridY * dpi + dpi / 2
      };
      debugLog(`[tokenHelpers] Converted grid position (${gridX}, ${gridY}) to scene position:`, targetPosition);
    }
    
    await OBR.scene.items.updateItems(ids, (draft) => {
      draft.forEach(item => {
        item.position = targetPosition;
      });
    });
    
    debugLog(`[tokenHelpers] Items position updated successfully`);
  } catch (error) {
    debugError(`[tokenHelpers] Error setting items position:`, error.message);
    throw error;
  }
}

/**
 * Set the scale of one or more items
 * @param {string|string[]} itemIds - Single item ID or array of item IDs
 * @param {Object} scale - Scale object {x, y} or single number for uniform scaling
 * @returns {Promise<void>}
 */
export async function setItemsScale(itemIds, scale) {
  try {
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    const scaleObj = typeof scale === 'number' ? { x: scale, y: scale } : scale;
    debugLog(`[tokenHelpers] Setting ${ids.length} item(s) scale to`, scaleObj);
    
    await OBR.scene.items.updateItems(ids, (draft) => {
      draft.forEach(item => {
        item.scale = scaleObj;
      });
    });
    
    debugLog(`[tokenHelpers] Items scale updated successfully`);
  } catch (error) {
    debugError(`[tokenHelpers] Error setting items scale:`, error.message);
    throw error;
  }
}

/**
 * Set the rotation of one or more items
 * @param {string|string[]} itemIds - Single item ID or array of item IDs
 * @param {number} rotation - Rotation in degrees
 * @returns {Promise<void>}
 */
export async function setItemsRotation(itemIds, rotation) {
  try {
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    debugLog(`[tokenHelpers] Setting ${ids.length} item(s) rotation to ${rotation}°`);
    
    await OBR.scene.items.updateItems(ids, (draft) => {
      draft.forEach(item => {
        item.rotation = rotation;
      });
    });
    
    debugLog(`[tokenHelpers] Items rotation updated successfully`);
  } catch (error) {
    debugError(`[tokenHelpers] Error setting items rotation:`, error.message);
    throw error;
  }
}

/**
 * Set the metadata of one or more items
 * @param {string|string[]} itemIds - Single item ID or array of item IDs
 * @param {Object} metadata - Metadata object or a function to update existing metadata
 * @returns {Promise<void>}
 */
export async function setItemsMetadata(itemIds, metadata) {
  try {
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    const isFunction = typeof metadata === 'function';
    debugLog(`[tokenHelpers] Setting metadata for ${ids.length} item(s)`, isFunction ? '[function]' : metadata);
    
    await OBR.scene.items.updateItems(ids, (draft) => {
      draft.forEach(item => {
        if (isFunction) {
          item.metadata = metadata(item.metadata || {});
        } else {
          item.metadata = { ...(item.metadata || {}), ...metadata };
        }
      });
    });
    
    debugLog(`[tokenHelpers] Items metadata updated successfully`);
  } catch (error) {
    debugError(`[tokenHelpers] Error setting items metadata:`, error.message);
    throw error;
  }
}
