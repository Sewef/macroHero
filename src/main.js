import OBR from "@owlbear-rodeo/sdk";
import { openConfigModal, loadConfig, loadConfigFromLocalStorage } from "./config.js";
import { initUI, updateConfig, setGlobalVariables, reloadCurrentPage } from "./ui.js";
import { resolveVariables } from "./expressionEvaluator.js";
import { initializeExpressions } from "./expressionHelpers.js";
import { getGoogleSheetsCredentials } from "./commands/integrations/GoogleSheets.js";
import { flushPendingChanges } from "./storage.js";
import { isDebugEnabled } from "./debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('main') && console.log(...args);
const debugWarn = (...args) => console.warn(...args);
const debugError = (...args) => console.error(...args);

document.getElementById("configBtn").onclick = openConfigModal;
document.getElementById("reloadBtn").onclick = reloadCurrentPage;

// Ensure pending localStorage changes are saved before page unloads
window.addEventListener('beforeunload', async () => {
  await flushPendingChanges();
});

// Chargement initial
OBR.onReady(async () => {
  try {
    debugLog("[MAIN] App loading...");

    const cfg = await loadConfig();

    // Initialize expression system with Google Sheets from localStorage
    const { apiKey, sheetId } = getGoogleSheetsCredentials();

    if (apiKey && sheetId) {
      initializeExpressions({ apiKey, sheetId });
    } else {
      debugWarn("[MAIN] Google Sheets not configured - missing credentials");
    }

    // Resolve global variables (these are needed immediately for page variable expressions)
    const globalVars = await resolveVariables(cfg.global?.variables);

    // Apply width/height settings if specified
    if (cfg.global?.width || cfg.global?.height) {
      const width = cfg.global.width || 400;
      const height = cfg.global.height || 600;
      await OBR.action.setWidth(width);
      await OBR.action.setHeight(height);
    }

    // Store global variables for use in button clicks
    setGlobalVariables(globalVars);
    cfg._resolvedGlobal = globalVars;

    // Don't pre-resolve page variables here - let renderPageContent do it
    // This allows live updates as variables resolve
    for (let i = 0; i < (cfg.pages || []).length; i++) {
      const page = cfg.pages[i];
      page._resolved = {}; // Start with empty resolved set
      page._pageIndex = i; // Store page index for later use
    }

    // Initialize UI immediately so it's visible even if the scene isn't ready yet.
    initUI(cfg);

    // Handle optional scene-dependent logging asynchronously; don't block UI init.
    (async () => {
      try {
        const isSceneReady = await OBR.scene.isReady();
        if (isSceneReady) {
          await logOBRImageItems();
          await logOBRSceneMetadata();
        } else {
          // Poll for scene readiness briefly as a fallback
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 300));
            if (await OBR.scene.isReady()) {
              await logOBRImageItems();
              await logOBRSceneMetadata();
              break;
            }
          }
        }
      } catch (err) {
        debugWarn('[MAIN] Scene logging skipped or failed:', err);
      }
    })();

    // Listen for config changes from the modal
    OBR.broadcast.onMessage("macrohero.config.updated", async (event) => {
      debugLog("[MAIN] Config updated via broadcast");

      // If this is just an UI update (button click, counter change, etc.), skip re-resolution
      if (event.data && event.data.savedFromUI && !event.data.savedFromModal) {
        debugLog("[MAIN] Skipping re-resolution for UI-only update");
        return;
      }

      // If config was saved from modal, reload the page to ensure everything is fresh
      if (event.data && event.data.savedFromModal) {
        debugLog("[MAIN] Config saved from modal - reloading page");
        window.location.reload();
        return;
      }

      // Re-initialize Google Sheets from localStorage (modal saves credentials there)
      const { apiKey, sheetId } = getGoogleSheetsCredentials();

      if (apiKey && sheetId) {
        initializeExpressions({ apiKey, sheetId });
      }

      // If the modal sent a small flag, load full config from room-scoped localStorage
      let newConfig = event.data;
      if (event.data && (event.data.savedFromModal || event.data.savedFromUI)) {
        try {
          const cfg = await loadConfigFromLocalStorage();
          if (cfg) {
            newConfig = cfg;
          } else {
            debugWarn('[MAIN] No config found in localStorage after config saved');
            return;
          }
        } catch (err) {
          debugError('[MAIN] Failed to load config from localStorage after config saved:', err);
          return;
        }
      }

      // Apply width/height if specified in the new config
      if (newConfig.global?.width || newConfig.global?.height) {
        const width = newConfig.global.width || 500;
        const height = newConfig.global.height || 500;
        await OBR.action.setWidth(width);
        await OBR.action.setHeight(height);
      }

      updateConfig(newConfig);
    });
  } catch (error) {
    debugError("Error during initialization:", error);
  }
});

async function logOBRImageItems() {
  // Optional: Log scene items for debugging
  // Uncomment if needed for troubleshooting

  try {
    const items = await OBR.scene.items.getItems();
    debugLog("[MAIN] Scene items:", items);
  } catch (err) {
    debugError("[MAIN] Error fetching scene items:", err);
  }

}

async function logOBRSceneMetadata() {
  try {
    const metadata = await OBR.scene.getMetadata();
    debugLog("[MAIN] Scene metadata:", metadata);
  } catch (err) {
    debugError("[MAIN] Error fetching scene metadata:", err);
  }
}
