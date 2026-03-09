/**
 * Image Helper
 * Provides utilities for detecting and building image objects
 * Automatically detects dimensions, MIME type, and constructs ImageContent/ImageGrid objects
 */

/**
 * Detect MIME type from URL or file extension
 * @param {string} url - Image URL
 * @returns {string} MIME type (e.g., 'image/png', 'image/jpeg')
 */
export function detectMimeType(url) {
  if (!url || typeof url !== 'string') return 'image/png'; // Default fallback

  // Extract extension from URL (before query parameters)
  const urlPath = url.split('?')[0].toLowerCase();
  
  if (urlPath.endsWith('.jpg') || urlPath.endsWith('.jpeg')) return 'image/jpeg';
  if (urlPath.endsWith('.png')) return 'image/png';
  if (urlPath.endsWith('.gif')) return 'image/gif';
  if (urlPath.endsWith('.webp')) return 'image/webp';
  if (urlPath.endsWith('.svg')) return 'image/svg+xml';
  if (urlPath.endsWith('.bmp')) return 'image/bmp';
  
  // Default to PNG if we can't determine
  return 'image/png';
}

/**
 * Get image dimensions from URL
 * Works with CORS-enabled images and data URLs
 * @param {string} url - Image URL
 * @returns {Promise<{width: number, height: number}>} Image dimensions
 */
export async function getImageDimensions(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    // Set CORS attribute for cross-origin images
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      });
    };
    
    img.onerror = () => {
      // Default dimensions if image fails to load
      console.warn(`[ImageHelper] Failed to load image: ${url}, using default dimensions 256x256`);
      resolve({ width: 256, height: 256 });
    };
    
    img.src = url;
  });
}

/**
 * Build ImageContent object with automatic dimension detection
 * @param {string} url - Image URL
 * @param {object} options - Optional overrides {width, height, mime}
 * @returns {Promise<{width: number, height: number, mime: string, url: string}>} ImageContent object
 */
export async function buildImageContent(url, options = {}) {
  if (!url || typeof url !== 'string') {
    throw new Error('[ImageHelper] Invalid URL: must be a non-empty string');
  }

  // Try to detect dimensions automatically, fall back to options or defaults
  let dimensions;
  try {
    dimensions = await getImageDimensions(url);
  } catch (error) {
    console.warn('[ImageHelper] Error detecting dimensions:', error);
    dimensions = { width: 256, height: 256 };
  }

  const mime = options.mime || detectMimeType(url);
  const width = options.width ?? dimensions.width;
  const height = options.height ?? dimensions.height;

  return {
    url,
    width,
    height,
    mime,
  };
}

/**
 * Build ImageGrid object with optional customization
 * @param {object} options - Optional {offset: {x, y}, dpi}
 * @returns {{offset: {x: number, y: number}, dpi: number}} ImageGrid object
 */
export function buildImageGrid(options = {}) {
  return {
    offset: options.offset || { x: 0, y: 0 },
    dpi: options.dpi ?? 72, // Common default for web images
  };
}

/**
 * Complete helper: Build full imageBuildParams object
 * Automatically detects image dimensions and MIME type
 * @param {string} url - Image URL
 * @param {object} options - Optional {width, height, mime, offset, dpi}
 * @returns {Promise<{image: ImageContent, grid: ImageGrid}>} Complete imageBuildParams
 */
export async function buildImageBuildParams(url, options = {}) {
  const image = await buildImageContent(url, {
    width: options.width,
    height: options.height,
    mime: options.mime,
  });

  const grid = buildImageGrid({
    offset: options.offset,
    dpi: options.dpi,
  });

  return { image, grid };
}

/**
 * Validate ImageContent structure
 * @param {object} imageContent - ImageContent object to validate
 * @returns {boolean} True if valid
 */
export function validateImageContent(imageContent) {
  if (!imageContent || typeof imageContent !== 'object') return false;
  return (
    typeof imageContent.url === 'string' &&
    typeof imageContent.width === 'number' &&
    typeof imageContent.height === 'number' &&
    typeof imageContent.mime === 'string' &&
    imageContent.width > 0 &&
    imageContent.height > 0
  );
}

/**
 * Validate ImageGrid structure
 * @param {object} imageGrid - ImageGrid object to validate
 * @returns {boolean} True if valid
 */
export function validateImageGrid(imageGrid) {
  if (!imageGrid || typeof imageGrid !== 'object') return false;
  return (
    imageGrid.offset &&
    typeof imageGrid.offset.x === 'number' &&
    typeof imageGrid.offset.y === 'number' &&
    typeof imageGrid.dpi === 'number' &&
    imageGrid.dpi > 0
  );
}

/**
 * Validate complete imageBuildParams
 * @param {object} params - imageBuildParams object to validate
 * @returns {boolean} True if valid
 */
export function validateImageBuildParams(params) {
  if (!params || typeof params !== 'object') return false;
  return validateImageContent(params.image) && validateImageGrid(params.grid);
}
