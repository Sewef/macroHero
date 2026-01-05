/**
 * Local Storage Integration
 * Provides access to local storage in variable expressions
 * Persists to browser localStorage for cross-session access
 */

import { isDebugEnabled } from "../../debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('Local') && console.log(...args);
const debugError = (...args) => isDebugEnabled('Local') && console.error(...args);
const debugWarn = (...args) => isDebugEnabled('Local') && console.warn(...args);

class LocalIntegration {
  constructor() {
    this.storage = {};
    this.localStorageKey = "macroHero_localStorage";
    this.loadFromLocalStorage();
    debugLog("[LocalIntegration] ✓ Initialized with localStorage persistence");
  }

  /**
   * Load values from browser localStorage
   */
  loadFromLocalStorage() {
    try {
      const json = localStorage.getItem(this.localStorageKey);
      if (json) {
        this.storage = JSON.parse(json);
        debugLog("[LocalIntegration] Loaded from browser localStorage:", this.storage);
      }
    } catch (error) {
      debugWarn("[LocalIntegration] Error loading from localStorage:", error);
      this.storage = {};
    }
  }

  /**
   * Save values to browser localStorage
   */
  saveToLocalStorage() {
    try {
      localStorage.setItem(this.localStorageKey, JSON.stringify(this.storage));
    } catch (error) {
      debugWarn("[LocalIntegration] Error saving to localStorage:", error);
    }
  }

  /**
   * Get a local value with optional default
   * @param {string} key - Key name
   * @param {any} defaultValue - Default value if not set
   * @returns {any} Stored value or default
   */
  value(key, defaultValue = null) {
    debugLog(`[LocalIntegration.value] Getting "${key}"`);
    const result = this.storage[key] ?? defaultValue;
    debugLog(`[LocalIntegration.value] ✓ Got:`, result);
    return result;
  }

  /**
   * Set a local value and persist to localStorage
   * @param {string} key - Key name
   * @param {any} value - Value to store
   */
  set(key, value) {
    debugLog(`[LocalIntegration.set] Setting "${key}" =`, value);
    this.storage[key] = value;
    this.saveToLocalStorage();
    return value;
  }

  /**
   * Clear all local storage
   */
  clear() {
    debugLog("[LocalIntegration.clear] Clearing all storage");
    this.storage = {};
    localStorage.removeItem(this.localStorageKey);
  }

  /**
   * Get all stored keys
   * @returns {Array} Array of keys
   */
  keys() {
    return Object.keys(this.storage);
  }
}

export default LocalIntegration;
