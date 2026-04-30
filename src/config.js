// config.js
import OBR from "@owlbear-rodeo/sdk";
import { loadAllEvaluatedVariables, loadEvaluatedVariablesForPage } from "./storage.js";
import { createDebugLogger } from "./debugMode.js";
import { loadConfigFile } from "./yamlLoader.js";
import { deepClone } from "./utils.js";

export const STORAGE_KEY = "com.sewef.macrohero/playerConfigs";
export const LOCAL_STORAGE_CONFIG_KEY = "com.sewef.macrohero/fullConfig";
export const MODAL_LABEL = "macrohero.config";

// Debug logger
const logger = createDebugLogger('config');

// Track broadcast subscriptions for cleanup
let broadcastSubscriptions = [];

/**
 * Register a broadcast subscription for cleanup
 */
function registerBroadcastSub(unsubscribeFunc) {
  broadcastSubscriptions.push(unsubscribeFunc);
}

/**
 * Clean up all broadcast subscriptions
 */
function cleanupBroadcastSubscriptions() {
  broadcastSubscriptions.forEach(unsub => {
    try { unsub?.(); } catch (e) { /* ignore */ }
  });
  broadcastSubscriptions = [];
  logger.log("Cleaned up broadcast subscriptions");
}

let isOBRReady = false;
let currentPlayerId = null;

OBR.onReady(async () => {
    isOBRReady = true;
    logger.log("SDK ready");
    try {
        currentPlayerId = await OBR.player.getId();
        logger.log(`Player ID: ${currentPlayerId}`);
    } catch (error) {
        logger.error('Failed to get player ID:', error);
    }
});

// Helper to ensure OBR is ready before accessing APIs
async function ensureOBRReady() {
    if (isOBRReady) return;
    return new Promise(resolve => {
        const check = setInterval(() => {
            if (isOBRReady) {
                clearInterval(check);
                resolve();
            }
        }, 100);
        // Safety timeout after 5 seconds
        setTimeout(() => {
            clearInterval(check);
            logger.warn("Timeout waiting for SDK");
            resolve();
        }, 5000);
    });
}

// Helper to get current player ID
async function getPlayerId() {
    if (!currentPlayerId) {
        currentPlayerId = await OBR.player.getId();
    }
    return currentPlayerId;
}

// Export for use in other modules
export { ensureOBRReady };

// Helper to build a room-scoped localStorage key.
// Uses `OBR.room.id` when available so configs are stored per-room
async function getRoomScopedLocalStorageKey() {
    try {
        // Ensure SDK is ready so OBR.room.id is populated
        await ensureOBRReady();
        const roomId = (OBR.room && OBR.room.id) ? OBR.room.id : (OBR.room && typeof OBR.room.getId === 'function' ? await OBR.room.getId() : 'unknown');
        return `${LOCAL_STORAGE_CONFIG_KEY}/${roomId}`;
    } catch (e) {
        logger.warn("Could not determine room ID, using fallback");
        return `${LOCAL_STORAGE_CONFIG_KEY}/unknown`;
    }
}

// Clean runtime-only fields from a config object before serializing/saving.
// Removes `_resolvedGlobal` and any `page._resolved` entries to avoid
// persisting runtime caches/state.
export function cleanConfigForSave(cfg) {
    if (!cfg) return cfg;
    try {
        const clone = deepClone(cfg);
        if (clone._resolvedGlobal) delete clone._resolvedGlobal;
        if (clone._modifiedVars) delete clone._modifiedVars;
        if (Array.isArray(clone.pages)) {
            clone.pages.forEach(p => {
                if (p && p._resolved) delete p._resolved;
                if (p && p._modifiedVars) delete p._modifiedVars;
                if (p && p._pageIndex) delete p._pageIndex;
            });
        }
        return clone;
    } catch (e) {
        logger.warn('Failed to clean config for save, using fallback', e);
        const clone = Object.assign({}, cfg);
        delete clone._resolvedGlobal;
        delete clone._modifiedVars;
        if (Array.isArray(clone.pages)) {
            clone.pages = clone.pages.map(p => {
                const cp = Object.assign({}, p);
                delete cp._resolved;
                delete cp._modifiedVars;
                delete cp._pageIndex;
                return cp;
            });
        }
        return clone;
    }
}

// Helper to save full config to localStorage (room-scoped)
// This preserves the entire config including external/calculated variable definitions
export async function saveConfigToLocalStorage(cfg) {
    try {
        // Clean runtime-only fields before serializing to localStorage
        const cleaned = cleanConfigForSave(cfg);
        const configJson = JSON.stringify(cleaned);
        const key = await getRoomScopedLocalStorageKey();
        localStorage.setItem(key, configJson);
        const sizeKB = (new Blob([configJson]).size / 1024).toFixed(2);
        logger.log(`Saved to storage (${sizeKB} KB)`);
        return true;
    } catch (error) {
        logger.error('Error saving to storage:', error);
        return false;
    }
}

// Helper to load full config from localStorage
export async function loadConfigFromLocalStorage() {
    try {
        const key = await getRoomScopedLocalStorageKey();
        const configJson = localStorage.getItem(key);
        if (configJson) {
            const cfg = JSON.parse(configJson);
            logger.log("Loaded from storage");
            return cfg;
        }
    } catch (error) {
        logger.error('Error loading from storage:', error);
    }
    return null;
}

// --------------------------------------
// CONFIG PAR DÉFAUT
// --------------------------------------
export const defaultConfig = {
    global: {
        title: "Macro Hero",
        theme: "default",
        variables: {}
    },
    pages: []
};

// --------------------------------------
// LOAD CONFIG
// Loads config from ROOM metadata (persists across page reloads)
// Stores config per-player using player ID as the key
// MUST be called after OBR.onReady()
// --------------------------------------
export async function loadConfig() {
    try {
        // Ensure OBR is ready before accessing metadata
        await ensureOBRReady();
        
        const playerId = await getPlayerId();
        logger.log(`Loading for player: ${playerId}`);
        
        // Get room metadata (persists across page reloads)
        const roomMetadata = await OBR.room.getMetadata();
        logger.log(`Room metadata keys: ${Object.keys(roomMetadata).join(", ")}`);
        
        // Start with full config from room-scoped localStorage.
        // If not found, try to load the bundled config (YAML or JSON) shipped with the extension.
        // Fallback to the in-code `defaultConfig` if that fails.
        const localStorageConfig = await loadConfigFromLocalStorage();
        let config;
        if (localStorageConfig) {
            config = deepClone(localStorageConfig);
        } else {
            // Try to load packaged config files - first YAML (modern format), then JSON (legacy)
            const tryPaths = [
                { base: '/src/default', format: 'YAML' },
                { base: '/default', format: 'YAML' },
                { base: '/assets/default', format: 'YAML' }
            ];
            let packaged = null;
            
            for (const { base, format } of tryPaths) {
                try {
                    packaged = await loadConfigFile(base);
                    logger.log(`Loaded packaged config from ${base}`);
                    break;
                } catch (e) {
                    // Silently try next path
                    logger.warn(`Could not load config from ${base}`);
                }
            }

            if (packaged) {
                config = deepClone(packaged);
                try {
                    await saveConfigToLocalStorage(config);
                    logger.log("Persisted packaged config to storage");
                } catch (e) {
                    logger.warn('Failed to persist packaged config to storage', e);
                }
            } else {
                logger.warn("Using built-in default config");
                config = deepClone(defaultConfig);
            }
        }
        
// Instead of merging from room metadata, merge evaluated values from localStorage only
        // Load all variables once at startup (more efficient than loading per-page)
        await loadAllEvaluatedVariables();
        
        for (let i = 0; i < (config.pages?.length || 0); i++) {
            const evalVars = await loadEvaluatedVariablesForPage(i);
            if (config.pages[i]?.variables && evalVars) {
                Object.entries(evalVars).forEach(([varName, value]) => {
                    if (config.pages[i].variables[varName]) {
                        config.pages[i].variables[varName].expression = value;
                    }
                });
            }
        }
        
        return config;
    } catch (error) {
        logger.error('Error loading config:', error);
        return defaultConfig;
    }
}

// --------------------------------------
// SAVE CONFIG
// Saves ONLY local variable values to ROOM metadata (persists across page reloads)
// This dramatically reduces storage size by skipping external/calculated variables
// Stores per-player using player ID as the key
// MUST be called after OBR.onReady()
// NOTE: Room metadata is shared, so we namespace by player ID to avoid conflicts
// Also supports multiple extensions by using reverse domain notation
// WARNING: This modifies the room's shared metadata - other extensions may also store data here
// See: https://docs.owlbear.rodeo/extensions/reference/sdk for metadata best practices
// --------------------------------------
export async function saveConfig(cfg) {
    try {
        // Ensure OBR is ready before accessing metadata
        await ensureOBRReady();
        
        const playerId = await getPlayerId();
        logger.log(`Saving for player: ${playerId}`);
        
        // Save full config to room-scoped localStorage (clean runtime fields first)
        await saveConfigToLocalStorage(cfg);
        
        // No longer saving evaluated variable values to room metadata
        return true;
    } catch (error) {
        logger.error('Error saving config:', error);
        logger.error('Stack trace:', error.stack);
        throw error;
    }
}

// --------------------------------------
// OUVRIR LA MODALE DE CONFIGURATION
// Opens the config editor modal
// Flow: Modal edits config → sends broadcast → main app saves → main app re-renders
// --------------------------------------
export async function openConfigModal() {
    logger.log("Opening config modal");
    const current = await loadConfig();
    logger.log("Config loaded");

    // Listen for the result from the modal
    const unsubscribe = OBR.broadcast.onMessage("macrohero.config.result", async (event) => {
        logger.log("Received config update from modal");
        try {
            if (event.data?.updatedConfig) {
                logger.log("Persisting updated config");
                try {
                    await saveConfig(event.data.updatedConfig);
                    logger.log("Config persisted");
                } catch (error) {
                    logger.error('Failed to save config:', error);
                }
            } else if (event.data?.savedFromModal) {
                logger.log("Loading config from storage");
                try {
                    const cfg = await loadConfigFromLocalStorage();
                    if (cfg) {
                        logger.log("Config loaded and persisted");
                        await saveConfig(cfg);
                    } else {
                        logger.warn("No config found in storage");
                    }
                } catch (error) {
                    logger.error('Error loading config from storage:', error);
                }
            } else {
                logger.log("Closed without changes");
            }

            // Notify main app to reload UI — send a small flag to avoid size limits
            try {
                await OBR.broadcast.sendMessage("macrohero.config.updated", { savedFromModal: true }, { destination: "LOCAL" });
                logger.log("Notified main app of update");
            } catch (err) {
                logger.warn('Failed to notify main app:', err);
            }
        } finally {
            unsubscribe();
        }
    });
    
    // Register for cleanup
    registerBroadcastSub(unsubscribe);

    logger.log("Opening modal window");
    await OBR.modal.open({
        id: "macrohero.config",
        url: "/configModal.html",
        width: 1000,
        height: 800
    });
}
