// config.js
import OBR from "@owlbear-rodeo/sdk";
import { initUI } from "./ui.js";

// IMPORTANT: Using ROOM metadata instead of PLAYER metadata
// Reason: Player metadata is session-scoped and lost on page refresh
// Room metadata persists across the entire room session (for all players)
// We store player-specific config in room metadata with player ID as the key
export const STORAGE_KEY = "com.sewef.macrohero/playerConfigs";
export const LOCAL_STORAGE_CONFIG_KEY = "com.sewef.macrohero/fullConfig";
export const MODAL_LABEL = "macrohero.config";

let isOBRReady = false;
let currentPlayerId = null;

OBR.onReady(async () => {
    isOBRReady = true;
    console.log("[OBR] SDK Ready");
    try {
        currentPlayerId = await OBR.player.getId();
        console.log("[OBR] Current player ID:", currentPlayerId);
    } catch (error) {
        console.error("[OBR] Error getting player ID:", error);
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
            console.warn("[OBR] Timeout waiting for OBR ready");
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

// Helper to save full config to localStorage
// This preserves the entire config including external/calculated variable definitions
export function saveConfigToLocalStorage(cfg) {
    try {
        const configJson = JSON.stringify(cfg);
        localStorage.setItem(LOCAL_STORAGE_CONFIG_KEY, configJson);
        const sizeKB = (new Blob([configJson]).size / 1024).toFixed(2);
        console.log("[CONFIG] Full config saved to localStorage (", sizeKB, "KB )");
        return true;
    } catch (error) {
        console.error("[CONFIG] Error saving to localStorage:", error);
        return false;
    }
}

// Helper to load full config from localStorage
export function loadConfigFromLocalStorage() {
    try {
        const configJson = localStorage.getItem(LOCAL_STORAGE_CONFIG_KEY);
        if (configJson) {
            const cfg = JSON.parse(configJson);
            console.log("[CONFIG] Full config loaded from localStorage");
            return cfg;
        }
    } catch (error) {
        console.error("[CONFIG] Error loading from localStorage:", error);
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
        console.log("[CONFIG] Loading config for player:", playerId);
        
        // Get room metadata (persists across page reloads)
        const roomMetadata = await OBR.room.getMetadata();
        console.log("[CONFIG] Room metadata keys:", Object.keys(roomMetadata));
        
        // Get the player configs object from Room Metadata
        const playerConfigs = roomMetadata[STORAGE_KEY] || {};
        console.log("[CONFIG] Player configs from Room Metadata:", playerConfigs);
        
        // Get saved local variables for this player from Room Metadata
        const savedLocalVars = playerConfigs[playerId];
        
        // Start with full config from localStorage, or default config if not found
        const localStorageConfig = loadConfigFromLocalStorage();
        const config = localStorageConfig 
            ? JSON.parse(JSON.stringify(localStorageConfig))
            : JSON.parse(JSON.stringify(defaultConfig));
        
        if (savedLocalVars) {
            console.log("✓ [CONFIG] Saved local variables found:", savedLocalVars);
            
            // Merge saved local variables into config
            // Structure: { pageIndex: { varName: value, ... }, ... }
            Object.entries(savedLocalVars).forEach(([pageIndex, vars]) => {
                const pageIdx = parseInt(pageIndex);
                if (config.pages[pageIdx]?.variables) {
                    Object.entries(vars).forEach(([varName, value]) => {
                        if (config.pages[pageIdx].variables[varName]) {
                            // Update the expression with the saved value
                            config.pages[pageIdx].variables[varName].expression = value;
                        }
                    });
                }
            });
            
            console.log("✓ [CONFIG] Merged saved values into config");
        } else {
            console.log("✗ [CONFIG] No saved variables found for this player");
        }
        
        return config;
    } catch (error) {
        console.error("✗ [CONFIG] Error loading config:", error);
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
        console.log("[CONFIG] Saving config for player:", playerId);
        
        // Save full config to localStorage
        saveConfigToLocalStorage(cfg);
        
        // Extract only local variables from config for Room Metadata
        // Structure: { pageIndex: { varName: value, ... }, ... }
        // Local variables are those that users can modify via UI controls
        const localVarsToSave = {};
        
        cfg.pages?.forEach((page, pageIndex) => {
            if (!page.variables || !page.layout) return;
            
            // Find all variables that are editable via UI controls
            const editableVars = new Set();
            const findEditableVars = (items) => {
                items?.forEach(item => {
                    if (item.type === 'counter' || item.type === 'checkbox' || item.type === 'input') {
                        if (item.var) {
                            editableVars.add(item.var);
                        }
                    }
                    if (item.type === 'row' && item.children) {
                        findEditableVars(item.children);
                    }
                });
            };
            findEditableVars(page.layout);
            
            const localVarsInPage = {};
            Object.entries(page.variables).forEach(([varName, varDef]) => {
                // Save if it's an editable variable (has a UI control)
                if (editableVars.has(varName)) {
                    localVarsInPage[varName] = varDef.expression;
                }
            });
            
            // Only include page if it has local variables
            if (Object.keys(localVarsInPage).length > 0) {
                localVarsToSave[pageIndex] = localVarsInPage;
            }
        });
        
        console.log("[CONFIG] Local variables to save:", localVarsToSave);
        
        // Get current room metadata
        const roomMetadata = await OBR.room.getMetadata();
        
        // Get existing player configs
        const playerConfigs = roomMetadata[STORAGE_KEY] || {};
        
        // Update this player's local variables
        playerConfigs[playerId] = localVarsToSave;
        
        // Calculate size of the local variables
        const localVarsJson = JSON.stringify(localVarsToSave);
        const localVarsSizeBytes = new Blob([localVarsJson]).size;
        const localVarsSizeKB = (localVarsSizeBytes / 1024).toFixed(2);
        
        // Calculate what the full config size would have been
        const fullConfigJson = JSON.stringify(cfg);
        const fullConfigSizeBytes = new Blob([fullConfigJson]).size;
        const fullConfigSizeKB = (fullConfigSizeBytes / 1024).toFixed(2);
        const savedPercent = ((1 - localVarsSizeBytes / fullConfigSizeBytes) * 100).toFixed(1);
        
        console.log("[CONFIG] Local variables size:", localVarsSizeBytes, "bytes (", localVarsSizeKB, "KB )");
        console.log("[CONFIG] Full config would be:", fullConfigSizeBytes, "bytes (", fullConfigSizeKB, "KB )");
        console.log("[CONFIG] Storage saved:", savedPercent + "%");
        console.log("[CONFIG] Room metadata object being saved:", { [STORAGE_KEY]: playerConfigs });
        
        // Save to room metadata (using spread operator to preserve other extensions' data)
        console.log("[CONFIG] Calling OBR.room.setMetadata()...");
        await OBR.room.setMetadata({
            [STORAGE_KEY]: playerConfigs
        });
        console.log("✓ [CONFIG] OBR.room.setMetadata() completed");
        
        // Verify it was saved - wait a moment for the save to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const updatedMetadata = await OBR.room.getMetadata();
        const savedConfigs = updatedMetadata[STORAGE_KEY] || {};
        const saved = savedConfigs[playerId];
        
        if (saved) {
            console.log("✓ [CONFIG] Local variables successfully saved to room metadata");
            return true;
        } else {
            console.error("✗ [CONFIG] ERROR: Local variables were not saved to room metadata!");
            return false;
        }
    } catch (error) {
        console.error("✗ [CONFIG] Error saving config:", error);
        console.error("[CONFIG] Error stack:", error.stack);
        throw error;
    }
}

// --------------------------------------
// OUVRIR LA MODALE DE CONFIGURATION
// Opens the config editor modal
// Flow: Modal edits config → sends broadcast → main app saves → main app re-renders
// --------------------------------------
export async function openConfigModal() {
    console.log("[MODAL] Opening config modal...");
    const current = await loadConfig();
    console.log("[MODAL] Current config loaded:", current);

    // Listen for the result from the modal
    const unsubscribe = OBR.broadcast.onMessage("macrohero.config.result", async (event) => {
        console.log("[MODAL] Received broadcast 'macrohero.config.result':", event.data);
        if (event.data?.updatedConfig) {
            console.log("[MODAL] Updated config found, saving to metadata...", event.data.updatedConfig);
            try {
                await saveConfig(event.data.updatedConfig);
                // Notify main app to reload UI
                console.log("[MODAL] Broadcasting config.updated to LOCAL");
                OBR.broadcast.sendMessage("macrohero.config.updated", event.data.updatedConfig, { destination: "LOCAL" });
                console.log("✓ [MODAL] Config saved and UI update broadcast sent");
            } catch (error) {
                console.error("✗ [MODAL] Failed to save config:", error);
            }
        } else {
            console.log("[MODAL] Modal closed without config update");
        }
        unsubscribe();
    });

    console.log("[MODAL] Opening modal window...");
    await OBR.modal.open({
        id: "macrohero.config",
        url: "/configModal.html",
        width: 500,
        height: 500
    });
}
