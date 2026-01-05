// config.js
import OBR from "@owlbear-rodeo/sdk";
import { loadAllEvaluatedVariables, loadEvaluatedVariablesForPage } from "./storage.js";
import { isDebugEnabled } from "./debugMode.js";

export const STORAGE_KEY = "com.sewef.macrohero/playerConfigs";
export const LOCAL_STORAGE_CONFIG_KEY = "com.sewef.macrohero/fullConfig";
export const MODAL_LABEL = "macrohero.config";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('config') && console.log(...args);
const debugError = (...args) => isDebugEnabled('config') && console.error(...args);
const debugWarn = (...args) => isDebugEnabled('config') && console.warn(...args);

let isOBRReady = false;
let currentPlayerId = null;

OBR.onReady(async () => {
    isOBRReady = true;
    debugLog("[OBR] SDK Ready");
    try {
        currentPlayerId = await OBR.player.getId();
        debugLog("[OBR] Current player ID:", currentPlayerId);
    } catch (error) {
        debugError("[OBR] Error getting player ID:", error);
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
            debugWarn("[OBR] Timeout waiting for OBR ready");
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
        debugWarn('[CONFIG] Could not determine room id for localStorage key, using fallback', e);
        return `${LOCAL_STORAGE_CONFIG_KEY}/unknown`;
    }
}

// Clean runtime-only fields from a config object before serializing/saving.
// Removes `_resolvedGlobal` and any `page._resolved` entries to avoid
// persisting runtime caches/state.
export function cleanConfigForSave(cfg) {
    if (!cfg) return cfg;
    try {
        const clone = JSON.parse(JSON.stringify(cfg));
        if (clone._resolvedGlobal) delete clone._resolvedGlobal;
        if (clone._modifiedVars) delete clone._modifiedVars;
        if (Array.isArray(clone.pages)) {
            clone.pages.forEach(p => {
                if (p && p._resolved) delete p._resolved;
                if (p && p._modifiedVars) delete p._modifiedVars;
            });
        }
        return clone;
    } catch (e) {
        debugWarn('[CONFIG] cleanConfigForSave failed, falling back to shallow clone', e);
        const clone = Object.assign({}, cfg);
        delete clone._resolvedGlobal;
        delete clone._modifiedVars;
        if (Array.isArray(clone.pages)) {
            clone.pages = clone.pages.map(p => {
                const cp = Object.assign({}, p);
                delete cp._resolved;
                delete cp._modifiedVars;
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
        debugLog("[CONFIG] Full config saved to localStorage (", sizeKB, "KB )", "key=", key);
        return true;
    } catch (error) {
        debugError("[CONFIG] Error saving to localStorage:", error);
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
            debugLog("[CONFIG] Full config loaded from localStorage", "key=", key);
            return cfg;
        }
    } catch (error) {
        debugError("[CONFIG] Error loading from localStorage:", error);
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
        debugLog("[CONFIG] Loading config for player:", playerId);
        
        // Get room metadata (persists across page reloads)
        const roomMetadata = await OBR.room.getMetadata();
        debugLog("[CONFIG] Room metadata keys:", Object.keys(roomMetadata));
        
        // Start with full config from room-scoped localStorage.
        // If not found, try to load the bundled `src/default.json` shipped with the extension.
        // Fallback to the in-code `defaultConfig` if that fails.
        const localStorageConfig = await loadConfigFromLocalStorage();
        let config;
        if (localStorageConfig) {
            config = JSON.parse(JSON.stringify(localStorageConfig));
        } else {
            const tryPaths = ['/src/default.json', '/default.json', '/assets/default.json'];
            let packaged = null;
            for (const p of tryPaths) {
                try {
                    const resp = await fetch(p);
                    if (resp.ok) {
                        packaged = await resp.json();
                        debugLog('[CONFIG] Loaded packaged default config from', p);
                        break;
                    }
                } catch (e) {
                    // ignore and try next path
                }
            }

            if (packaged) {
                config = JSON.parse(JSON.stringify(packaged));
                try {
                    await saveConfigToLocalStorage(config);
                    debugLog('[CONFIG] Packaged default persisted to room-scoped localStorage');
                } catch (e) {
                    debugWarn('[CONFIG] Failed to persist packaged default to localStorage', e);
                }
            } else {
                debugWarn('[CONFIG] Could not load packaged default config, using in-code defaultConfig');
                config = JSON.parse(JSON.stringify(defaultConfig));
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
        debugError("✗ [CONFIG] Error loading config:", error);
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
        debugLog("[CONFIG] Saving config for player:", playerId);
        
        // Save full config to room-scoped localStorage (clean runtime fields first)
        await saveConfigToLocalStorage(cfg);
        
        // No longer saving evaluated variable values to room metadata
        return true;
    } catch (error) {
        debugError("✗ [CONFIG] Error saving config:", error);
        debugError("[CONFIG] Error stack:", error.stack);
        throw error;
    }
}

// --------------------------------------
// OUVRIR LA MODALE DE CONFIGURATION
// Opens the config editor modal
// Flow: Modal edits config → sends broadcast → main app saves → main app re-renders
// --------------------------------------
export async function openConfigModal() {
    debugLog("[MODAL] Opening config modal...");
    const current = await loadConfig();
    debugLog("[MODAL] Current config loaded:", current);

    // Listen for the result from the modal
    const unsubscribe = OBR.broadcast.onMessage("macrohero.config.result", async (event) => {
        debugLog("[MODAL] Received broadcast 'macrohero.config.result':", event.data);
        try {
            if (event.data?.updatedConfig) {
                debugLog("[MODAL] Updated config found; persisting via saveConfig...", event.data.updatedConfig);
                try {
                    await saveConfig(event.data.updatedConfig);
                    debugLog("[MODAL] Config persisted via updatedConfig path");
                } catch (error) {
                    debugError("✗ [MODAL] Failed to save config (updatedConfig path):", error);
                }
            } else if (event.data?.savedFromModal) {
                debugLog("[MODAL] Received savedFromModal flag — loading full config from room-scoped localStorage");
                try {
                    const cfg = await loadConfigFromLocalStorage();
                    if (cfg) {
                        debugLog("[MODAL] Full config loaded from localStorage; persisting via saveConfig...");
                        await saveConfig(cfg);
                    } else {
                        debugWarn("[MODAL] No full config found in localStorage to persist");
                    }
                } catch (error) {
                    debugError("✗ [MODAL] Error loading/saving config from localStorage:", error);
                }
            } else {
                debugLog("[MODAL] Modal closed without config update");
            }

            // Notify main app to reload UI — send a small flag to avoid size limits
            try {
                await OBR.broadcast.sendMessage("macrohero.config.updated", { savedFromModal: true }, { destination: "LOCAL" });
                debugLog("[MODAL] Broadcasted small config.updated flag to LOCAL");
            } catch (err) {
                debugWarn("[MODAL] Warning: failed to broadcast small config.updated flag:", err);
            }
        } finally {
            unsubscribe();
        }
    });

    debugLog("[MODAL] Opening modal window...");
    await OBR.modal.open({
        id: "macrohero.config",
        url: "/configModal.html",
        width: 900,
        height: 700
    });
}
