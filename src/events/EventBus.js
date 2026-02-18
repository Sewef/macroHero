/**
 * EventBus - Simple pub/sub system for variable changes
 * Replaces scattered callbacks with a cleaner event-based architecture
 */

import { isDebugEnabled } from "../debugMode.js";

const debugLog = (...args) => isDebugEnabled('EventBus') && console.log(...args);

class EventBus {
  constructor() {
    this.listeners = new Map(); // eventName -> Set(callbacks)
  }

  /**
   * Subscribe to an event
   * @param {string} eventName - Event to listen for
   * @param {Function} callback - Called when event fires
   * @returns {Function} Unsubscribe function
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(callback);
    debugLog(`[EventBus] Subscribed to ${eventName}`);

    // Return unsubscribe function
    return () => this.off(eventName, callback);
  }

  /**
   * Subscribe to event, fire callback only once
   */
  once(eventName, callback) {
    const unsubscribe = this.on(eventName, (...args) => {
      callback(...args);
      unsubscribe();
    });
    return unsubscribe;
  }

  /**
   * Unsubscribe from event
   */
  off(eventName, callback) {
    const listeners = this.listeners.get(eventName);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this.listeners.delete(eventName);
      }
      debugLog(`[EventBus] Unsubscribed from ${eventName}`);
    }
  }

  /**
   * Emit an event
   * @param {string} eventName - Event to fire
   * @param {...any} args - Arguments to pass to listeners
   */
  emit(eventName, ...args) {
    const listeners = this.listeners.get(eventName);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(...args);
        } catch (error) {
          console.error(`[EventBus] Error in listener for ${eventName}:`, error);
        }
      }
    }
  }

  /**
   * Emit event asynchronously and wait for all listeners
   */
  async emitAsync(eventName, ...args) {
    const listeners = this.listeners.get(eventName);
    if (listeners) {
      const promises = Array.from(listeners).map(callback => {
        try {
          return Promise.resolve(callback(...args));
        } catch (error) {
          console.error(`[EventBus] Error in listener for ${eventName}:`, error);
          return Promise.reject(error);
        }
      });
      await Promise.all(promises);
    }
  }

  /**
   * Clear all listeners (useful for cleanup)
   */
  clear() {
    this.listeners.clear();
    debugLog('[EventBus] All listeners cleared');
  }
}

// Singleton instance
export const eventBus = new EventBus();

export default EventBus;
