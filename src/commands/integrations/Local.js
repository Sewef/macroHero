/**
 * Local Storage Integration
 * Provides access to local storage in variable expressions
 */

class LocalIntegration {
  constructor() {
    this.storage = {};
    console.log("[LocalIntegration] ✓ Initialized");
  }

  /**
   * Get a local value with optional default
   * @param {string} key - Key name
   * @param {any} defaultValue - Default value if not set
   * @returns {any} Stored value or default
   */
  value(key, defaultValue = null) {
    console.log(`[LocalIntegration.value] Getting "${key}"`);
    const result = this.storage[key] ?? defaultValue;
    console.log(`[LocalIntegration.value] ✓ Got:`, result);
    return result;
  }

  /**
   * Set a local value
   * @param {string} key - Key name
   * @param {any} value - Value to store
   */
  set(key, value) {
    console.log(`[LocalIntegration.set] Setting "${key}" =`, value);
    this.storage[key] = value;
    return value;
  }

  /**
   * Clear all local storage
   */
  clear() {
    console.log("[LocalIntegration.clear] Clearing all storage");
    this.storage = {};
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
