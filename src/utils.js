/**
 * Utility functions for the macroHero extension
 */

/**
 * Deep clone an object recursively
 * Faster than JSON.parse(JSON.stringify()) and handles Date objects
 * @param {*} obj - Object to clone
 * @returns {*} Deeply cloned object
 */
export function deepClone(obj) {
  // Handle primitives and null
  if (obj === null || typeof obj !== 'object') return obj;
  
  // Handle Date objects
  if (obj instanceof Date) return new Date(obj.getTime());
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item));
  }
  
  // Handle plain objects
  const cloned = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

/**
 * Clean runtime state from a config object before saving
 * @param {Object} cfg - Configuration object
 * @returns {Object} Cleaned config
 */
export function cleanConfigForRuntime(cfg) {
  if (!cfg) return cfg;
  const cleaned = deepClone(cfg);
  
  // Remove runtime-only fields
  delete cleaned._resolvedGlobal;
  delete cleaned._modifiedVars;
  
  if (Array.isArray(cleaned.pages)) {
    cleaned.pages.forEach(page => {
      if (page) {
        delete page._resolved;
        delete page._modifiedVars;
        delete page._pageIndex;
      }
    });
  }
  
  return cleaned;
}
