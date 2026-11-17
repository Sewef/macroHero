import OBR from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../debugMode.js";
import { isBroadcastWatchDescriptor } from "./metadataWatchDescriptor.js";

const logger = createDebugLogger("BroadcastObserver");

function cloneValue(value) {
  if (value === undefined || value === null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

class BroadcastObserver {
  constructor() {
    this.records = new Map();
  }

  observe(descriptor, callback) {
    if (!isBroadcastWatchDescriptor(descriptor)) throw new Error("Invalid broadcast watch descriptor");
    if (!descriptor.channel) throw new Error(`${descriptor.integration}.${descriptor.eventMethod} requires a broadcast channel`);
    if (typeof callback !== "function") throw new Error("Broadcast observer callback is required");

    let record = this.records.get(descriptor.channel);
    if (!record) {
      record = { callbacks: new Set(), unsubscribe: null };
      record.unsubscribe = OBR.broadcast.onMessage(descriptor.channel, event => {
        this._dispatch(descriptor.channel, event);
      });
      this.records.set(descriptor.channel, record);
    }
    const registration = { descriptor, callback };
    record.callbacks.add(registration);

    return () => {
      const current = this.records.get(descriptor.channel);
      if (!current) return;
      current.callbacks.delete(registration);
      if (current.callbacks.size === 0) {
        current.unsubscribe?.();
        this.records.delete(descriptor.channel);
      }
    };
  }

  clear() {
    for (const record of this.records.values()) record.unsubscribe?.();
    this.records.clear();
  }

  _dispatch(channel, rawEvent = {}) {
    const record = this.records.get(channel);
    if (!record) return;
    for (const { descriptor, callback } of [...record.callbacks]) {
      try {
        const data = cloneValue(rawEvent.data);
        const event = Object.freeze(descriptor.mapEvent(Object.freeze({
          type: `${descriptor.integration}.${descriptor.eventMethod}`,
          integration: descriptor.integration,
          scope: "broadcast",
          channel,
          data,
          connectionId: rawEvent.connectionId || null,
          timestamp: Date.now(),
        })));
        Promise.resolve().then(() => callback(event)).catch(error => {
          logger.error(`Broadcast callback failed for ${channel}:`, error);
        });
      } catch (error) {
        logger.error(`Broadcast mapping failed for ${channel}:`, error);
      }
    }
  }
}

export const broadcastObserver = new BroadcastObserver();
export default BroadcastObserver;
