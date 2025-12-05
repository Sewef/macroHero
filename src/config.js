// config.js
import OBR from "@owlbear-rodeo/sdk";
import { initUI } from "./ui.js";

// IMPORTANT: Using ROOM metadata instead of PLAYER metadata
// Reason: Player metadata is session-scoped and lost on page refresh
// Room metadata persists across the entire room session (for all players)
// We store player-specific config in room metadata with player ID as the key
export const STORAGE_KEY = "com.sewef.macrohero/playerConfigs";
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
        
        // Get the player configs object
        const playerConfigs = roomMetadata[STORAGE_KEY] || {};
        console.log("[CONFIG] Player configs:", playerConfigs);
        
        const playerConfig = playerConfigs[playerId];
        
        if (playerConfig) {
            console.log("✓ [CONFIG] Configuration loaded from room metadata:", playerConfig);
            return playerConfig;
        } else {
            console.log("✗ [CONFIG] No stored config found for this player, using default");
            return defaultConfig;
        }
    } catch (error) {
        console.error("✗ [CONFIG] Error loading config:", error);
        return defaultConfig;
    }
}

// --------------------------------------
// SAVE CONFIG
// Saves config to ROOM metadata (persists across page reloads)
// Stores config per-player using player ID as the key
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
        
        // Get current room metadata
        const roomMetadata = await OBR.room.getMetadata();
        
        // Get existing player configs
        const playerConfigs = roomMetadata[STORAGE_KEY] || {};
        
        // Update this player's config
        playerConfigs[playerId] = cfg;
        
        console.log("[CONFIG] Config to save:", cfg);
        console.log("[CONFIG] Room metadata object being saved:", { [STORAGE_KEY]: playerConfigs });
        
        // Save to room metadata (using spread operator to preserve other extensions' data)
        console.log("[CONFIG] Calling OBR.room.setMetadata()...");
        await OBR.room.setMetadata({
            [STORAGE_KEY]: playerConfigs
        });
        console.log("✓ [CONFIG] OBR.room.setMetadata() completed");
        
        // Verify it was saved - wait a moment for the save to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        console.log("[CONFIG] Verifying save...");
        const updatedMetadata = await OBR.room.getMetadata();
        const savedConfigs = updatedMetadata[STORAGE_KEY] || {};
        const saved = savedConfigs[playerId];
        
        if (saved) {
            console.log("✓ [CONFIG] Config successfully verified in room metadata!");
            return true;
        } else {
            console.error("✗ [CONFIG] ERROR: Config was saved but not found in room metadata!");
            console.error("[CONFIG] Expected key:", STORAGE_KEY);
            console.error("[CONFIG] Expected player:", playerId);
            console.error("[CONFIG] Saved configs:", savedConfigs);
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
