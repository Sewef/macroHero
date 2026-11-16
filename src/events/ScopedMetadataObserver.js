import OBR from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../debugMode.js";
import { isScopedMetadataWatchDescriptor } from "./metadataWatchDescriptor.js";

const logger = createDebugLogger("ScopedMetadataObserver");

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

const SCOPE_ADAPTERS = {
  scene: {
    getMetadata: () => OBR.scene.getMetadata(),
    subscribe: callback => OBR.scene.onMetadataChange(metadata => callback(metadata, {})),
    context: () => ({}),
  },
  room: {
    getMetadata: () => OBR.room.getMetadata(),
    subscribe: callback => OBR.room.onMetadataChange(metadata => callback(metadata, { roomId: OBR.room.id })),
    context: () => ({ roomId: OBR.room.id }),
  },
  player: {
    getMetadata: () => OBR.player.getMetadata(),
    subscribe: callback => OBR.player.onChange(player => callback(player?.metadata || {}, {
      playerId: player?.id || OBR.player.id,
      player: cloneValue(player),
    })),
    context: () => ({ playerId: OBR.player.id }),
  },
};

class ScopedMetadataObserver {
  constructor() {
    this.records = new Map();
    this.scopeUnsubscribes = new Map();
    this.readyUnsubscribe = null;
  }

  async observe(descriptor, callback) {
    if (!isScopedMetadataWatchDescriptor(descriptor)) throw new Error("Invalid scoped metadata watch descriptor");
    if (!descriptor.metadataKey) throw new Error(`${descriptor.integration}.${descriptor.eventMethod} requires a metadata key`);
    if (typeof callback !== "function") throw new Error("Metadata observer callback is required");

    this._ensureScopeListener(descriptor.scope);
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
      this._releaseScopeIfIdle(descriptor.scope);
    };
  }

  clear() {
    this.records.clear();
    for (const unsubscribe of this.scopeUnsubscribes.values()) unsubscribe?.();
    this.scopeUnsubscribes.clear();
    this.readyUnsubscribe?.();
    this.readyUnsubscribe = null;
  }

  _recordKey(descriptor) {
    return [descriptor.integration, descriptor.scope, descriptor.metadataKey, descriptor.selectorKey].join("\u0000");
  }

  _ensureScopeListener(scope) {
    if (!this.scopeUnsubscribes.has(scope)) {
      const adapter = SCOPE_ADAPTERS[scope];
      this.scopeUnsubscribes.set(scope, adapter.subscribe((metadata, context) => {
        this._handleMetadataChange(scope, metadata, context);
      }));
    }
    if (scope === "scene" && !this.readyUnsubscribe) {
      this.readyUnsubscribe = OBR.scene.onReadyChange(ready => {
        if (ready) this._refreshScope("scene");
        else {
          for (const record of this.records.values()) {
            if (record.descriptor.scope !== "scene") continue;
            record.initialized = false;
            record.snapshot = undefined;
          }
        }
      });
    }
  }

  _releaseScopeIfIdle(scope) {
    if ([...this.records.values()].some(record => record.descriptor.scope === scope)) return;
    this.scopeUnsubscribes.get(scope)?.();
    this.scopeUnsubscribes.delete(scope);
    if (scope === "scene") {
      this.readyUnsubscribe?.();
      this.readyUnsubscribe = null;
    }
  }

  async _initializeRecord(record) {
    try {
      if (record.descriptor.scope === "scene" && !await OBR.scene.isReady()) return;
      const adapter = SCOPE_ADAPTERS[record.descriptor.scope];
      const metadata = await adapter.getMetadata();
      if (!record.initialized) this._setInitialSnapshot(record, metadata);
    } catch (error) {
      logger.error(`Failed to initialize ${record.descriptor.scope} metadata observer:`, error);
    }
  }

  async _refreshScope(scope) {
    try {
      const adapter = SCOPE_ADAPTERS[scope];
      const metadata = await adapter.getMetadata();
      for (const record of this.records.values()) {
        if (record.descriptor.scope === scope) this._setInitialSnapshot(record, metadata);
      }
    } catch (error) {
      logger.error(`Failed to refresh ${scope} metadata observers:`, error);
    }
  }

  _setInitialSnapshot(record, metadata) {
    const rawValue = metadata?.[record.descriptor.metadataKey];
    record.snapshot = cloneValue(record.descriptor.select(rawValue, metadata));
    record.initialized = true;
  }

  _handleMetadataChange(scope, metadata, context = {}) {
    for (const record of this.records.values()) {
      if (record.descriptor.scope !== scope) continue;
      const rawValue = metadata?.[record.descriptor.metadataKey];
      let nextValue;
      try {
        nextValue = cloneValue(record.descriptor.select(rawValue, metadata));
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
        scope,
        metadataKey: record.descriptor.metadataKey,
        change: changeKind(previousValue, nextValue),
        previousValue,
        value: cloneValue(nextValue),
        timestamp: Date.now(),
        ...SCOPE_ADAPTERS[scope].context(),
        ...context,
      });

      record.queue = record.queue
        .then(async () => {
          const event = Object.freeze(record.descriptor.mapEvent(baseEvent));
          await Promise.allSettled([...record.callbacks].map(callback => Promise.resolve().then(() => callback(event))));
        })
        .catch(error => logger.error(`${scope} metadata observer callback failed:`, error));
    }
  }
}

export const scopedMetadataObserver = new ScopedMetadataObserver();
export default ScopedMetadataObserver;
