/**
 * Debug Mode Manager
 * Provides a centralized way for modules to check and listen to debug mode states
 * Debug states are stored in localStorage and can be updated via broadcasts
 */

/**
 * Check if a module has debug mode enabled
 * @param {string} moduleName - The name of the module (e.g., 'executor', 'expressionEvaluator')
 * @returns {boolean} True if debug mode is enabled for this module
 */
export function isDebugEnabled(moduleName) {
  try {
    const stored = localStorage.getItem('macroHero_debugMode');
    if (stored) {
      const debugModes = JSON.parse(stored);
      return debugModes[moduleName] || false;
    }
  } catch (e) {
    console.error('Failed to check debug mode for', moduleName, ':', e);
  }
  return false;
}

/**
 * Get all current debug mode states
 * @returns {Object} Object mapping module names to boolean debug states
 */
export function getAllDebugModes() {
  try {
    const stored = localStorage.getItem('macroHero_debugMode');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load debug modes from localStorage:', e);
  }
  return {};
}

/**
 * Listen for debug mode changes (when config modal broadcasts updates)
 * @param {Function} callback - Function called with updated debug modes object
 * @returns {Function} Unsubscribe function to stop listening
 */
export function onDebugModesChanged(callback) {
  // Listen to storage changes from other tabs/windows or config modal
  function handleStorageChange(event) {
    if (event.key === 'macroHero_debugMode' || event.key === null) {
      const debugModes = getAllDebugModes();
      callback(debugModes);
    }
  }

  window.addEventListener('storage', handleStorageChange);
  
  // Return unsubscribe function
  return () => {
    window.removeEventListener('storage', handleStorageChange);
  };
}

/**
 * Create a debug logger for a specific module
 * @param {string} moduleName - The name of the module
 * @returns {Object} Object with log, warn, and error functions that respect debug mode
 */
export function createDebugLogger(moduleName) {
  return {
    log: (...args) => isDebugEnabled(moduleName) && console.log(`[${moduleName}]`, ...args),
    warn: (...args) => isDebugEnabled(moduleName) && console.warn(`[${moduleName}]`, ...args),
    error: (...args) => isDebugEnabled(moduleName) && console.error(`[${moduleName}]`, ...args),
  };
}
