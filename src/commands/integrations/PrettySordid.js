import OBR from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../../debugMode.js";
import {
  createBroadcastWatchDescriptor,
  createSceneItemsWatchDescriptor,
} from "../../events/metadataWatchDescriptor.js";

// Debug mode constants
const logger = createDebugLogger("PrettySordid");


const PRETTYSORDID_METADATA_KEY = "com.pretty-initiative/metadata";
const PRETTYSORDID_ROUND_CHANNEL = "general.initiative.roundChange";

function _tokenId(itemOrId) {
  if (typeof itemOrId === "string") return itemOrId;
  return itemOrId?.id ? String(itemOrId.id) : "";
}

function _activeTurn(items, tokenId = "") {
  const item = (items || []).find(candidate => {
    const metadata = candidate?.metadata?.[PRETTYSORDID_METADATA_KEY];
    return metadata?.active === true && (!tokenId || candidate.id === tokenId);
  });
  if (!item) return null;

  const metadata = item.metadata[PRETTYSORDID_METADATA_KEY];
  const initiative = Number(metadata.count);
  return {
    tokenId: item.id,
    tokenName: item.text?.plainText || item.name || "",
    token: item,
    initiative: Number.isFinite(initiative) ? initiative : null,
    metadata: { ...metadata },
  };
}

function _sameTurn(left, right) {
  return (left?.tokenId || null) === (right?.tokenId || null);
}

function _turnEvent(event) {
  return {
    ...event,
    previousTokenId: event.previousValue?.tokenId || null,
    tokenId: event.value?.tokenId || null,
    previousTokenName: event.previousValue?.tokenName || "",
    tokenName: event.value?.tokenName || "",
    previousToken: event.previousValue?.token || null,
    token: event.value?.token || null,
    previousInitiative: event.previousValue?.initiative ?? null,
    initiative: event.value?.initiative ?? null,
  };
}

/** Create a hook source that fires when the selected token becomes active. */
export function onTurn(itemOrId) {
  const tokenId = _tokenId(itemOrId);
  if (!tokenId) throw new Error("[PrettySordid] onTurn expects a token id or item object");

  return createSceneItemsWatchDescriptor({
    integration: "PrettySordid",
    eventMethod: "onTurn",
    selectorKey: `turn:${tokenId}`,
    select: items => _activeTurn(items, tokenId),
    isEqual: _sameTurn,
    shouldEmit: event => event.value !== null,
    mapEvent: _turnEvent,
  });
}

/** Create a hook source that fires whenever the active token changes. */
export function onTurnChange() {
  return createSceneItemsWatchDescriptor({
    integration: "PrettySordid",
    eventMethod: "onTurnChange",
    selectorKey: "active-turn",
    select: items => _activeTurn(items),
    isEqual: _sameTurn,
    mapEvent: _turnEvent,
  });
}

/** Create a hook source for Pretty Sordid's official round-change broadcast. */
export function onRoundChange() {
  return createBroadcastWatchDescriptor({
    integration: "PrettySordid",
    eventMethod: "onRoundChange",
    channel: PRETTYSORDID_ROUND_CHANNEL,
    mapEvent: event => {
      const roundNumber = Number.isFinite(event.data?.roundNumber)
        ? event.data.roundNumber
        : null;
      return {
        ...event,
        roundNumber,
        enabled: roundNumber !== null,
      };
    },
  });
}

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
      logger.error('[PrettySordid] Error fetching item by id', itemOrId, err);
      return null;
    }
  }
  // assume item object
  return itemOrId;
}

export async function hasInitiative(itemOrId) {
  const item = (await _ensureItem(itemOrId));
  try {
    if (!item) return false;
    return item.metadata && item.metadata[PRETTYSORDID_METADATA_KEY] !== undefined;
  } catch (err) {
    logger.warn('[PrettySordid] hasInitiative error', err);
    return false;
  }
}

export async function getInitiative(itemOrId) {
  const item = (await _ensureItem(itemOrId));
  if (!item) return 0;
  const meta = item.metadata?.[PRETTYSORDID_METADATA_KEY];
  if (!meta || !meta.count) return 0;
  const n = parseInt(String(meta.count), 10);
  return Number.isNaN(n) ? 0 : n;
}

export async function isActiveTurn(itemOrId) {
  const item = (await _ensureItem(itemOrId));
  if (!item) return false;
  const meta = item.metadata?.[PRETTYSORDID_METADATA_KEY];
  return !!meta?.active;
}

export async function setInitiative(itemOrId, count) {
  // Accept item object or token ID. Use updateItems to mutate safely.
  let tokenId = null;
  if (typeof itemOrId === 'string') tokenId = itemOrId;
  else if (itemOrId && itemOrId.id) tokenId = itemOrId.id;

  if (!tokenId) {
    throw new Error('[PrettySordid] setInitiative expects a token id or item object');
  }

  await OBR.scene.items.updateItems([tokenId], (items) => {
    const item = items.find(i => i.id === tokenId);
    if (!item) return;

    const meta = item.metadata[PRETTYSORDID_METADATA_KEY];
    if (meta) {
      meta.count = String(count);
    } else {
      item.metadata[PRETTYSORDID_METADATA_KEY] = { count: String(count), active: false, group: 1 };
    }
  });
}

export async function removeInitiative(itemOrId) {
  // Accept item object or token ID. Use updateItems to mutate safely.
  let tokenId = null;
  if (typeof itemOrId === 'string') tokenId = itemOrId;
  else if (itemOrId && itemOrId.id) tokenId = itemOrId.id;

  if (!tokenId) {
    throw new Error('[PrettySordid] removeInitiative expects a token id or item object');
  }

  await OBR.scene.items.updateItems([tokenId], (items) => {
    const item = items.find(i => i.id === tokenId);
    if (!item) return;

    delete item.metadata[PRETTYSORDID_METADATA_KEY];
  });
}

export default {
  onTurn,
  onTurnChange,
  onRoundChange,
  hasInitiative,
  getInitiativeCount: getInitiative,
  isActiveTurn,
  setInitiativeCount: setInitiative,
  removeInitiative,
};

