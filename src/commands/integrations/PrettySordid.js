import OBR from "@owlbear-rodeo/sdk";
import { isDebugEnabled } from "../../debugMode.js";

// Debug mode constants
const DEBUG_MODE_STATIC = false;
const debugLog = (...args) => isDebugEnabled('PrettySordid') && console.log(...args);
const debugError = (...args) => isDebugEnabled('PrettySordid') && console.error(...args);
const debugWarn = (...args) => isDebugEnabled('PrettySordid') && console.warn(...args);

const METADATA_KEY = "com.pretty-initiative/metadata";

/**
 * Normalize an input that may be an item object or a token id string
 * @param {Object|string} itemOrId
 * @returns {Promise<Object|null>} item object or null
 */
async function _ensureItem(itemOrId) {
  if (!itemOrId) return null;
  if (typeof itemOrId === 'string') {
    try {
      const items = await OBR.scene.items.getItems([itemOrId]);
      return items && items.length ? items[0] : null;
    } catch (err) {
      debugError('[PrettySordid] Error fetching item by id', itemOrId, err);
      return null;
    }
  }
  // assume item object
  return itemOrId;
}

export function hasInitiative(itemOrId) {
  const item = (typeof itemOrId === 'string') ? null : itemOrId;
  try {
    if (!item) return false; // for a sync check we need the object
    return item.metadata && item.metadata[METADATA_KEY] !== undefined;
  } catch (err) {
    debugWarn('[PrettySordid] hasInitiative error', err);
    return false;
  }
}

export async function getInitiativeCount(itemOrId) {
  const item = (await _ensureItem(itemOrId));
  if (!item) return 0;
  const meta = item.metadata?.[METADATA_KEY];
  if (!meta || !meta.count) return 0;
  const n = parseInt(String(meta.count), 10);
  return Number.isNaN(n) ? 0 : n;
}

export async function isActiveTurn(itemOrId) {
  const item = (await _ensureItem(itemOrId));
  if (!item) return false;
  const meta = item.metadata?.[METADATA_KEY];
  return !!meta?.active;
}

export async function setInitiativeCount(itemOrId, count) {
  // Accept item object or token ID. Use updateItems to mutate safely.
  let tokenId = null;
  if (typeof itemOrId === 'string') tokenId = itemOrId;
  else if (itemOrId && itemOrId.id) tokenId = itemOrId.id;

  if (!tokenId) {
    throw new Error('[PrettySordid] setInitiativeCount expects a token id or item object');
  }

  await OBR.scene.items.updateItems([tokenId], (items) => {
    const item = items.find(i => i.id === tokenId);
    if (!item) return;

    const meta = item.metadata[METADATA_KEY];
    if (meta) {
      meta.count = String(count);
    } else {
      item.metadata[METADATA_KEY] = { count: String(count), active: false, group: 1 };
    }
  });
}

export default {
  hasInitiative,
  getInitiativeCount,
  isActiveTurn,
  setInitiativeCount,
};
