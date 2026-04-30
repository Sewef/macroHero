/**
 * Local Storage Integration
 * Provides access to local storage in variable expressions
 * Persists to browser localStorage for cross-session access
 */

import { createDebugLogger } from "../../debugMode.js";

// Debug mode constants
const logger = createDebugLogger("Local");


class LocalIntegration {
  constructor() {
    this.storage = {};
    this.localStorageKey = "macroHero_localStorage";
    this.loadFromLocalStorage();
    logger.log("Initialized with localStorage persistence");
  }

  /**
   * Load values from browser localStorage
   */
  loadFromLocalStorage() {
    try {
      const json = localStorage.getItem(this.localStorageKey);
      if (json) {
        this.storage = JSON.parse(json);
        logger.log("Loaded from browser localStorage:", this.storage);
      }
    } catch (error) {
      logger.warn("Error loading from localStorage:", error);
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
      logger.warn("Error saving to localStorage:", error);
    }
  }

  /**
   * Get a local value with optional default
   * @param {string} key - Key name
   * @param {any} defaultValue - Default value if not set
   * @returns {any} Stored value or default
   */
  value(key, defaultValue = null) {
    logger.log(`Getting "${key}"`);
    const result = this.storage[key] ?? defaultValue;
    logger.log(`Got:`, result);
    return result;
  }

  /**
   * Set a local value and persist to localStorage
   * @param {string} key - Key name
   * @param {any} value - Value to store
   */
  set(key, value) {
    logger.log(`Setting "${key}" =`, value);
    this.storage[key] = value;
    this.saveToLocalStorage();
    return value;
  }

  /**
   * Clear all local storage
   */
  clear() {
    logger.log("Clearing all storage");
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

