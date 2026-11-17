import OBR from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../debugMode.js";
import { isTokenMetadataWatchDescriptor } from "./metadataWatchDescriptor.js";

const logger = createDebugLogger("TokenMetadataObserver");

function cloneValue(value) {
  if (value === undefined || value === null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function sameValue(left, right) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || left === undefined || right === undefined) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function changeKind(previousValue, value) {
  if (previousValue === undefined && value !== undefined) return "created";
  if (previousValue !== undefined && value === undefined) return "removed";
  return "updated";
}

class TokenMetadataObserver {
  constructor() {
    this.records = new Map();
    this.itemsUnsubscribe = null;
    this.readyUnsubscribe = null;
  }

  async observe(descriptor, callback) {
    if (!isTokenMetadataWatchDescriptor(descriptor)) {
      throw new Error("Invalid token metadata watch descriptor");
    }
    if (!descriptor.tokenId) throw new Error(`${descriptor.integration}.${descriptor.eventMethod} requires a token ID`);
    if (!descriptor.metadataKey) throw new Error(`${descriptor.integration}.${descriptor.eventMethod} requires a metadata key`);
    if (typeof callback !== "function") throw new Error("Token metadata observer callback is required");

    this._ensureOwlbearListeners();
    const key = this._recordKey(descriptor);
    let record = this.records.get(key);
    if (!record) {
      record = {
        descriptor,
        callbacks: new Set(),
        initialized: false,
        snapshot: undefined,
        queue: Promise.resolve(),
      };
      this.records.set(key, record);
      record.callbacks.add(callback);
      await this._initializeRecord(record);
    } else {
      record.callbacks.add(callback);
    }

    return () => {
      const current = this.records.get(key);
      if (!current) return;
      current.callbacks.delete(callback);
      if (current.callbacks.size === 0) this.records.delete(key);
      this._releaseOwlbearListenersIfIdle();
    };
  }

  clear() {
    this.records.clear();
    this.itemsUnsubscribe?.();
    this.readyUnsubscribe?.();
    this.itemsUnsubscribe = null;
    this.readyUnsubscribe = null;
  }

  _recordKey(descriptor) {
    return [descriptor.integration, descriptor.tokenId, descriptor.metadataKey, descriptor.selectorKey].join("\u0000");
  }

  _ensureOwlbearListeners() {
    if (!this.itemsUnsubscribe) {
      this.itemsUnsubscribe = OBR.scene.items.onChange(items => this._handleItemsChange(items));
    }
    if (!this.readyUnsubscribe) {
      this.readyUnsubscribe = OBR.scene.onReadyChange(ready => {
        if (ready) this._refreshAll();
        else {
          for (const record of this.records.values()) {
            record.initialized = false;
            record.snapshot = undefined;
          }
        }
      });
    }
  }

  _releaseOwlbearListenersIfIdle() {
    if (this.records.size > 0) return;
    this.itemsUnsubscribe?.();
    this.readyUnsubscribe?.();
    this.itemsUnsubscribe = null;
    this.readyUnsubscribe = null;
  }

  async _initializeRecord(record) {
    try {
      if (!await OBR.scene.isReady()) return;
      const items = await OBR.scene.items.getItems([record.descriptor.tokenId]);
      if (!record.initialized) this._setInitialSnapshot(record, items[0]);
    } catch (error) {
      logger.error("Failed to initialize metadata observer:", error);
    }
  }

  async _refreshAll() {
    if (this.records.size === 0) return;
    try {
      const tokenIds = [...new Set([...this.records.values()].map(record => record.descriptor.tokenId))];
      const items = await OBR.scene.items.getItems(tokenIds);
      const itemsById = new Map(items.map(item => [item.id, item]));
      for (const record of this.records.values()) {
        this._setInitialSnapshot(record, itemsById.get(record.descriptor.tokenId));
      }
    } catch (error) {
      logger.error("Failed to refresh metadata observers:", error);
    }
  }

  _setInitialSnapshot(record, item) {
    const rawValue = item?.metadata?.[record.descriptor.metadataKey];
    record.snapshot = cloneValue(record.descriptor.select(rawValue, item));
    record.initialized = true;
  }

  _handleItemsChange(items) {
    if (this.records.size === 0) return;
    const itemsById = new Map((items || []).map(item => [item.id, item]));
    for (const record of this.records.values()) {
      const item = itemsById.get(record.descriptor.tokenId);
      const rawValue = item?.metadata?.[record.descriptor.metadataKey];
      let nextValue;
      try {
        nextValue = cloneValue(record.descriptor.select(rawValue, item));
      } catch (error) {
        logger.error(`Selector failed for ${record.descriptor.integration}:`, error);
        continue;
      }
      if (!record.initialized) {
        record.snapshot = nextValue;
        record.initialized = true;
        continue;
      }
      if (sameValue(record.snapshot, nextValue)) continue;

      const previousValue = cloneValue(record.snapshot);
      record.snapshot = cloneValue(nextValue);
      const baseEvent = Object.freeze({
        type: `${record.descriptor.integration}.${record.descriptor.eventMethod}`,
        integration: record.descriptor.integration,
        scope: "token",
        tokenId: record.descriptor.tokenId,
        token: item ? cloneValue(item) : null,
        metadataKey: record.descriptor.metadataKey,
        change: changeKind(previousValue, nextValue),
        previousValue,
        value: cloneValue(nextValue),
        timestamp: Date.now(),
      });

      if (!record.descriptor.shouldEmit(baseEvent)) continue;

      record.queue = record.queue
        .then(async () => {
          const event = Object.freeze(record.descriptor.mapEvent(baseEvent));
          const callbacks = [...record.callbacks];
          await Promise.allSettled(callbacks.map(callback => Promise.resolve().then(() => callback(event))));
        })
        .catch(error => logger.error("Metadata observer callback failed:", error));
    }
  }
}

export const tokenMetadataObserver = new TokenMetadataObserver();
export default TokenMetadataObserver;
