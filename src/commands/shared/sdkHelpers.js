/**
 * SDK Helpers - Full Owlbear Rodeo SDK Proxy
 *
 * Exposes the complete OBR SDK under the `Owlbear` namespace via a JS Proxy.
 * Every OBR sub-API is accessible as-is; a few namespaces are augmented with
 * convenience methods, and a custom `Owlbear.image` namespace replaces the old
 * imageHelper.js utilities.
 *
 * Usage in macros (no imports needed — injected via integration context):
 *   Owlbear.notification.show("Hello!", "SUCCESS")
 *   Owlbear.broadcast.sendMessage("my.event", data, { destination: "ROOM" })
 *   Owlbear.scene.items.getItems()
 *   Owlbear.player.getName()
 *   Owlbear.image.getDimensions(url)
 *   Owlbear.image.buildParams(url, { dpi: 72 })
 */

import OBR from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../../debugMode.js";

const logger = createDebugLogger("sdkHelpers");

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Notification variant constants (maps to OBR notification variants)
 */
export const NOTIFICATION_VARIANT = {
  DEFAULT: "DEFAULT",
  ERROR: "ERROR",
  INFO: "INFO",
  SUCCESS: "SUCCESS",
  WARNING: "WARNING",
};

// ============================================================================
// IMAGE UTILITIES  (formerly imageHelper.js — now exposed as Owlbear.image.*)
// ============================================================================

/**
 * Detect MIME type from a URL's file extension
 * @param {string} url
 * @returns {string}
 */
function detectMimeType(url) {
  if (!url || typeof url !== "string") return "image/png";
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".bmp")) return "image/bmp";
  return "image/png";
}

/**
 * Get image dimensions by loading the image in a temporary <img> element
 * @param {string} url
 * @returns {Promise<{width: number, height: number}>}
 */
function getDimensions(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () =>
      resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => {
      logger.warn(`[sdkHelpers] Failed to load image: ${url}, using 256×256`);
      resolve({ width: 256, height: 256 });
    };
    img.src = url;
  });
}

/**
 * Build an ImageContent object with auto-detected dimensions and MIME type
 * @param {string} url
 * @param {{ width?: number, height?: number, mime?: string }} [options]
 * @returns {Promise<{url: string, width: number, height: number, mime: string}>}
 */
async function buildContent(url, options = {}) {
  if (!url || typeof url !== "string")
    throw new Error("[sdkHelpers] image.buildContent: url must be a non-empty string");
  let dims = { width: 256, height: 256 };
  try { dims = await getDimensions(url); } catch {}
  return {
    url,
    width: options.width ?? dims.width,
    height: options.height ?? dims.height,
    mime: options.mime ?? detectMimeType(url),
  };
}

/**
 * Build an ImageGrid object
 * @param {{ offset?: {x: number, y: number}, dpi?: number }} [options]
 * @returns {{offset: {x: number, y: number}, dpi: number}}
 */
function buildGrid(options = {}) {
  return {
    offset: options.offset ?? { x: 0, y: 0 },
    dpi: options.dpi ?? 72,
  };
}

/**
 * Build a complete imageBuildParams object (image + grid) ready for the Auras API
 * @param {string} url
 * @param {{ width?: number, height?: number, mime?: string, offset?: object, dpi?: number }} [options]
 * @returns {Promise<{image: object, grid: object}>}
 */
async function buildParams(url, options = {}) {
  return {
    image: await buildContent(url, { width: options.width, height: options.height, mime: options.mime }),
    grid: buildGrid({ offset: options.offset, dpi: options.dpi }),
  };
}

/**
 * Validate an ImageContent object
 * @param {object} img
 * @returns {boolean}
 */
export function validateImageContent(img) {
  return (
    img && typeof img === "object" &&
    typeof img.url === "string" &&
    typeof img.width === "number" && img.width > 0 &&
    typeof img.height === "number" && img.height > 0 &&
    typeof img.mime === "string"
  );
}

/**
 * Validate an ImageGrid object
 * @param {object} grid
 * @returns {boolean}
 */
export function validateImageGrid(grid) {
  return (
    grid && typeof grid === "object" &&
    grid.offset &&
    typeof grid.offset.x === "number" && typeof grid.offset.y === "number" &&
    typeof grid.dpi === "number" && grid.dpi > 0
  );
}

/**
 * Validate a complete imageBuildParams object { image, grid }
 * @param {object} params
 * @returns {boolean}
 */
export function validateImageBuildParams(params) {
  return params && typeof params === "object" &&
    validateImageContent(params.image) && validateImageGrid(params.grid);
}

// Convenience alias kept for internal callers (Auras.js etc.)
export const buildImageBuildParams = buildParams;

const imageNamespace = {
  detectMimeType,
  getDimensions,
  buildContent,
  buildGrid,
  buildParams,
};

// ============================================================================
// BROADCAST UTILITIES  (formerly broadcastHelpers.js — now Owlbear.broadcast.* + named exports)
// ============================================================================

/**
 * Broadcast destination constants
 */
export const BROADCAST_DESTINATIONS = {
  LOCAL: "LOCAL",
  ROOM: "ROOM",
  ALL: "ALL",
};

const DEFAULT_RETRY = { maxAttempts: 3, delayMs: 100 };

function _delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Send a broadcast message with automatic destination-fallback retry
 * @param {string} messageId
 * @param {*} data
 * @param {{ destination?: string, maxAttempts?: number, delayMs?: number, noRetry?: boolean }} [options]
 * @returns {Promise<{success: boolean, destination: string|null, attempts: number, error?: string}>}
 */
export async function broadcastMessage(messageId, data, options = {}) {
  const {
    destination = BROADCAST_DESTINATIONS.LOCAL,
    maxAttempts = DEFAULT_RETRY.maxAttempts,
    delayMs = DEFAULT_RETRY.delayMs,
    noRetry = false,
  } = options;

  if (!messageId || typeof messageId !== "string")
    throw new Error("[sdkHelpers] broadcastMessage: messageId must be a non-empty string");

  const destinations = noRetry
    ? [destination]
    : [destination, ...Object.values(BROADCAST_DESTINATIONS).filter((d) => d !== destination)];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    for (const dest of destinations) {
      try {
        await OBR.broadcast.sendMessage(messageId, data, { destination: dest });
        logger.log(`[sdkHelpers] Broadcast sent to ${dest}`, { messageId });
        return { success: true, destination: dest, attempts: attempt + 1 };
      } catch (err) {
        const msg = err?.error ?? String(err);
        logger.warn(`[sdkHelpers] Broadcast failed → ${dest} (attempt ${attempt + 1}/${maxAttempts}):`, msg);
        if (attempt < maxAttempts - 1 && dest !== destinations[destinations.length - 1]) continue;
        if (attempt < maxAttempts - 1) await _delay(delayMs);
      }
    }
  }

  const finalError = `[sdkHelpers] broadcastMessage "${messageId}" failed after ${maxAttempts} attempts`;
  logger.error(finalError);
  return { success: false, destination: null, attempts: maxAttempts, error: finalError };
}

/**
 * Send to LOCAL only (no retry to other destinations)
 */
export function broadcastLocal(messageId, data, options = {}) {
  return broadcastMessage(messageId, data, { ...options, destination: BROADCAST_DESTINATIONS.LOCAL, noRetry: true });
}

/**
 * Send to ROOM (all players)
 */
export function broadcastToRoom(messageId, data, options = {}) {
  return broadcastMessage(messageId, data, { ...options, destination: BROADCAST_DESTINATIONS.ROOM });
}

/**
 * Send to ALL (including observers)
 */
export function broadcastAll(messageId, data, options = {}) {
  return broadcastMessage(messageId, data, { ...options, destination: BROADCAST_DESTINATIONS.ALL });
}

/**
 * Register a broadcast listener — returns an unsubscribe function
 * @param {string} messageId
 * @param {Function} callback  (event) => void
 * @returns {Function} unsubscribe
 */
export function broadcastListener(messageId, callback) {
  if (!messageId || typeof messageId !== "string")
    throw new Error("[sdkHelpers] broadcastListener: messageId must be a non-empty string");
  if (typeof callback !== "function")
    throw new Error("[sdkHelpers] broadcastListener: callback must be a function");
  return OBR.broadcast.onMessage(messageId, (event) => {
    try { callback(event); } catch (err) { logger.error(`[sdkHelpers] broadcastListener error for "${messageId}":`, err); }
  });
}

/**
 * Listen for one message then unsubscribe (returns a Promise)
 * @param {string} messageId
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<*>} message data
 */
export function broadcastOnce(messageId, options = {}) {
  const { timeoutMs = 5000 } = options;
  return new Promise((resolve, reject) => {
    let unsub, timer;
    unsub = OBR.broadcast.onMessage(messageId, (event) => {
      clearTimeout(timer);
      unsub();
      resolve(event.data);
    });
    timer = setTimeout(() => {
      unsub();
      reject(new Error(`[sdkHelpers] broadcastOnce timeout for "${messageId}" after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

/**
 * Request–response pattern: send a message and wait for a reply on a different channel
 * @param {string} requestId   - channel to send on
 * @param {string} responseId  - channel to listen on
 * @param {*} data
 * @param {{ destination?: string, timeoutMs?: number, noRetry?: boolean }} [options]
 * @returns {Promise<{success: boolean, data?: *, broadcastResult?: object, error?: string}>}
 */
export async function broadcastRequest(requestId, responseId, data, options = {}) {
  const { destination = BROADCAST_DESTINATIONS.LOCAL, timeoutMs = 5000, noRetry = false } = options;
  let unsub, timer;

  const responsePromise = new Promise((resolve, reject) => {
    unsub = OBR.broadcast.onMessage(responseId, (event) => {
      clearTimeout(timer);
      resolve(event.data);
    });
    timer = setTimeout(() => reject(new Error(`[sdkHelpers] broadcastRequest timeout on "${responseId}" after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    const broadcastResult = await broadcastMessage(requestId, data, { destination, noRetry });
    if (!broadcastResult.success) throw new Error(broadcastResult.error);
    const responseData = await responsePromise;
    return { success: true, data: responseData, broadcastResult };
  } catch (err) {
    logger.error(`[sdkHelpers] broadcastRequest "${requestId}" failed:`, err.message);
    return { success: false, error: err.message, broadcastResult: null };
  } finally {
    if (unsub) unsub();
    clearTimeout(timer);
  }
}

// Internal broadcast namespace — used by Owlbear.broadcast.*
const broadcastNamespace = {
  // Standard SDK pass-throughs
  sendMessage: (...args) => OBR.broadcast.sendMessage(...args),
  onMessage: (...args) => OBR.broadcast.onMessage(...args),
  // Convenience helpers (subset of the named exports above)
  send: broadcastMessage,
  sendLocal: broadcastLocal,
  sendToRoom: broadcastToRoom,
  sendAll: broadcastAll,
  listen: broadcastListener,
  once: broadcastOnce,
  request: broadcastRequest,
};

// ============================================================================
// NAMESPACE OVERRIDES
// Augment specific OBR namespaces with convenience methods.
// All original OBR methods are preserved; extras are added alongside them.
// ============================================================================

const OVERRIDES = {
  broadcast: broadcastNamespace,
  image: imageNamespace,
};

// ============================================================================
// OWLBEAR PROXY — full OBR SDK pass-through
// ============================================================================

/**
 * Owlbear — a transparent Proxy over the OBR SDK object.
 * - Any `Owlbear.xyz` that is NOT in OVERRIDES delegates directly to `OBR.xyz`.
 * - Overridden namespaces (notification, image) replace the OBR equivalent.
 *
 * @type {typeof OBR & { broadcast: typeof broadcastNamespace, image: typeof imageNamespace }}
 */
export const Owlbear = new Proxy(OBR, {
  get(target, prop) {
    if (Object.prototype.hasOwnProperty.call(OVERRIDES, prop)) return OVERRIDES[prop];
    const value = target[prop];
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export default { Owlbear, NOTIFICATION_VARIANT };

