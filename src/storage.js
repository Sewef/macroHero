/**
 * Centralized Storage Manager
 * Handles all localStorage operations with batching and debouncing
 * Ensures a single source of truth for persisted data
 */

import OBR from "@owlbear-rodeo/sdk";
import { ensureOBRReady } from "./config.js";
import { isDebugEnabled } from "./debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('storage') && console.log(...args);
const debugError = (...args) => console.error(...args);

// Cache for room ID to avoid repeated lookups
let roomIdCache = null;

// In-memory cache for evaluated variables (maps pageIndex -> varName -> value)
let evaluatedVariablesCache = {};

// Batching system - accumulate changes before writing
let pendingChanges = {};
let saveBatchTimer = null;
const BATCH_DEBOUNCE_MS = 150; // Wait 150ms to batch multiple changes

/**
 * Get room-scoped key for storing evaluated variables
 */
async function getRoomScopedEvaluatedVarsKey() {
  if (!roomIdCache) {
    await ensureOBRReady();
    const roomId = (window.OBR && OBR.room && OBR.room.id)
      ? OBR.room.id
      : (OBR.room && typeof OBR.room.getId === 'function' 
        ? await OBR.room.getId() 
        : 'unknown');
    roomIdCache = `macroHero_evaluatedVariables_${roomId}`;
  }
  return roomIdCache;
}

/**
 * Load all evaluated variables from localStorage (with caching)
 * Called once at startup to prime the cache
 */
export async function loadAllEvaluatedVariables() {
  const key = await getRoomScopedEvaluatedVarsKey();
  try {
    const json = localStorage.getItem(key);
    evaluatedVariablesCache = json ? JSON.parse(json) : {};
    debugLog("[STORAGE] Evaluated variables loaded from localStorage", evaluatedVariablesCache);
    return evaluatedVariablesCache;
  } catch (error) {
    debugError("[STORAGE] Error loading evaluated variables:", error);
    evaluatedVariablesCache = {};
    return evaluatedVariablesCache;
  }
}

/**
 * Load evaluated variables for a specific page
 */
export async function loadEvaluatedVariablesForPage(pageIndex) {
  // Ensure cache is primed
  if (!Object.keys(evaluatedVariablesCache).length) {
    await loadAllEvaluatedVariables();
  }
  return evaluatedVariablesCache[pageIndex] || {};
}

/**
 * Get evaluated variable value directly from cache
 */
export function getEvaluatedVariable(pageIndex, varName) {
  return evaluatedVariablesCache[pageIndex]?.[varName];
}

/**
 * Update a variable and queue it for saving
 * This batches multiple updates into a single localStorage write
 */
export async function updateEvaluatedVariable(pageIndex, varName, value) {
  // Update in-memory cache immediately
  if (!evaluatedVariablesCache[pageIndex]) {
    evaluatedVariablesCache[pageIndex] = {};
  }
  evaluatedVariablesCache[pageIndex][varName] = value;
  
  // Track the change for batching
  if (!pendingChanges[pageIndex]) {
    pendingChanges[pageIndex] = {};
  }
  pendingChanges[pageIndex][varName] = value;
  
  // Schedule a batched write
  await scheduleBatchSave();
  
  debugLog(`[STORAGE] Variable queued: page${pageIndex}.${varName} = ${value}`);
}

/**
 * Schedule a batched save operation
 * Multiple variable updates get coalesced into a single localStorage write
 */
async function scheduleBatchSave() {
  // Clear existing timer if any
  if (saveBatchTimer) {
    clearTimeout(saveBatchTimer);
  }
  
  // Schedule new timer
  saveBatchTimer = setTimeout(async () => {
    if (Object.keys(pendingChanges).length === 0) {
      return;
    }
    
    try {
      const key = await getRoomScopedEvaluatedVarsKey();
      const json = JSON.stringify(evaluatedVariablesCache);
      localStorage.setItem(key, json);
      const sizeKB = (new Blob([json]).size / 1024).toFixed(2);
      debugLog(`[STORAGE] Batch saved evaluated variables (${sizeKB}KB)`);
      
      // Clear pending changes after successful save
      pendingChanges = {};
    } catch (error) {
      debugError("[STORAGE] Error during batch save:", error);
      // Keep pending changes for retry
    }
    
    saveBatchTimer = null;
  }, BATCH_DEBOUNCE_MS);
}

/**
 * Force immediate save of all pending changes
 * Called when page is unloading or config is being saved
 */
export async function flushPendingChanges() {
  if (saveBatchTimer) {
    clearTimeout(saveBatchTimer);
    saveBatchTimer = null;
  }
  
  if (Object.keys(pendingChanges).length === 0) {
    debugLog("[STORAGE] No pending changes to flush");
    return;
  }
  
  try {
    const key = await getRoomScopedEvaluatedVarsKey();
    const json = JSON.stringify(evaluatedVariablesCache);
    localStorage.setItem(key, json);
    const sizeKB = (new Blob([json]).size / 1024).toFixed(2);
    debugLog(`[STORAGE] Flushed evaluated variables (${sizeKB}KB)`);
    pendingChanges = {};
  } catch (error) {
    debugError("[STORAGE] Error flushing changes:", error);
  }
}

/**
 * Clear all evaluated variables (resets to defaults)
 */
export async function clearAllEvaluatedVariables() {
  evaluatedVariablesCache = {};
  pendingChanges = {};
  
  try {
    const key = await getRoomScopedEvaluatedVarsKey();
    localStorage.removeItem(key);
    debugLog("[STORAGE] All evaluated variables cleared");
  } catch (error) {
    debugError("[STORAGE] Error clearing variables:", error);
  }
}

/**
 * Get cache statistics for debugging
 */
export function getStorageStats() {
  const totalVars = Object.values(evaluatedVariablesCache).reduce((sum, page) => sum + Object.keys(page).length, 0);
  const pendingCount = Object.values(pendingChanges).reduce((sum, page) => sum + Object.keys(page).length, 0);
  
  return {
    totalVariables: totalVars,
    pageCount: Object.keys(evaluatedVariablesCache).length,
    pendingChanges: pendingCount,
    isSaving: saveBatchTimer !== null
  };
}
