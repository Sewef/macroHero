import OBR from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../debugMode.js";
import { isSceneItemsWatchDescriptor } from "./metadataWatchDescriptor.js";

const logger = createDebugLogger("SceneItemsObserver");

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
  if (previousValue == null && value != null) return "created";
  if (previousValue != null && value == null) return "removed";
  return "updated";
}

class SceneItemsObserver {
  constructor() {
    this.records = new Map();
    this.itemsUnsubscribe = null;
    this.readyUnsubscribe = null;
  }

  async observe(descriptor, callback) {
    if (!isSceneItemsWatchDescriptor(descriptor)) throw new Error("Invalid scene items watch descriptor");
    if (typeof callback !== "function") throw new Error("Scene items observer callback is required");

    this._ensureOwlbearListeners();
    const key = this._recordKey(descriptor);
    let record = this.records.get(key);
    if (!record) {
      record = {
        descriptor,
        callbacks: new Set([callback]),
        initialized: false,
        snapshot: undefined,
        queue: Promise.resolve(),
      };
      this.records.set(key, record);
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
    return [descriptor.integration, descriptor.eventMethod, descriptor.selectorKey].join("\u0000");
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
      const items = await OBR.scene.items.getItems();
      if (!record.initialized) this._setInitialSnapshot(record, items);
    } catch (error) {
      logger.error("Failed to initialize scene items observer:", error);
    }
  }

  async _refreshAll() {
    if (this.records.size === 0) return;
    try {
      const items = await OBR.scene.items.getItems();
      for (const record of this.records.values()) this._setInitialSnapshot(record, items);
    } catch (error) {
      logger.error("Failed to refresh scene items observers:", error);
    }
  }

  _setInitialSnapshot(record, items) {
    try {
      record.snapshot = cloneValue(record.descriptor.select(items || []));
      record.initialized = true;
    } catch (error) {
      logger.error(`Selector failed for ${record.descriptor.integration}:`, error);
    }
  }

  _handleItemsChange(items) {
    if (this.records.size === 0) return;
    for (const record of this.records.values()) {
      let nextValue;
      try {
        nextValue = cloneValue(record.descriptor.select(items || []));
      } catch (error) {
        logger.error(`Selector failed for ${record.descriptor.integration}:`, error);
        continue;
      }

      if (!record.initialized) {
        record.snapshot = nextValue;
        record.initialized = true;
        continue;
      }

      const equal = record.descriptor.isEqual
        ? record.descriptor.isEqual(record.snapshot, nextValue)
        : sameValue(record.snapshot, nextValue);
      if (equal) continue;

      const previousValue = cloneValue(record.snapshot);
      record.snapshot = cloneValue(nextValue);
      const baseEvent = Object.freeze({
        type: `${record.descriptor.integration}.${record.descriptor.eventMethod}`,
        integration: record.descriptor.integration,
        scope: "scene-items",
        change: changeKind(previousValue, nextValue),
        previousValue,
        value: cloneValue(nextValue),
        timestamp: Date.now(),
      });

      if (!record.descriptor.shouldEmit(baseEvent)) continue;

      record.queue = record.queue
        .then(async () => {
          const event = Object.freeze(record.descriptor.mapEvent(baseEvent));
          await Promise.allSettled([...record.callbacks].map(callback => Promise.resolve().then(() => callback(event))));
        })
        .catch(error => logger.error("Scene items observer callback failed:", error));
    }
  }
}

export const sceneItemsObserver = new SceneItemsObserver();
export default SceneItemsObserver;
