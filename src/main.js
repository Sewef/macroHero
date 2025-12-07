import OBR from "@owlbear-rodeo/sdk";
import { openConfigModal, loadConfig } from "./config.js";
import { initUI, updateConfig, setGlobalVariables, reloadCurrentPage } from "./ui.js";
import { resolveVariables } from "./expressionEvaluator.js";
import { initializeExpressions } from "./expressionHelpers.js";
import { getGoogleSheetsCredentials } from "./commands/integrations/GoogleSheetsConfig.js";

document.getElementById("configBtn").onclick = openConfigModal;
document.getElementById("reloadBtn").onclick = reloadCurrentPage;

// Chargement initial
OBR.onReady(async () => {
  try {
    console.log("[MAIN] App loading...");

    const cfg = await loadConfig();

    // Initialize expression system with Google Sheets from localStorage
    const { apiKey, sheetId } = getGoogleSheetsCredentials();
    
    if (apiKey && sheetId) {
      initializeExpressions({ apiKey, sheetId });
    } else {
      console.warn("[MAIN] Google Sheets not configured - missing credentials");
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
    for (const page of cfg.pages || []) {
      page._resolved = {}; // Start with empty resolved set
    }

    // Initialize UI when scene is ready (handles both already-ready and future-ready cases)
    const isSceneReady = await OBR.scene.isReady();
    if (isSceneReady) {
      initUI(cfg);
      logOBRImageItems();
    } else {
      // If not ready yet, wait for it to be ready
      OBR.scene.onReadyChange((isReady) => {
        if (isReady) {
          initUI(cfg);
          logOBRImageItems();
        }
      });
    }

    // Listen for config changes from the modal
    OBR.broadcast.onMessage("macrohero.config.updated", async (event) => {
      console.log("[MAIN] Config updated via modal");
      
      // Re-initialize Google Sheets from localStorage (modal saves credentials there)
      const { apiKey, sheetId } = getGoogleSheetsCredentials();
      
      if (apiKey && sheetId) {
        initializeExpressions({ apiKey, sheetId });
      }
      
      // Apply width/height if specified in the new config
      const newConfig = event.data;
      if (newConfig.global?.width || newConfig.global?.height) {
        const width = newConfig.global.width || 500;
        const height = newConfig.global.height || 500;
        await OBR.action.setWidth(width);
        await OBR.action.setHeight(height);
      }
      
      updateConfig(newConfig);
    });
  } catch (error) {
    console.error("Error during initialization:", error);
  }
});

async function logOBRImageItems() {
  // Optional: Log scene items for debugging
  // Uncomment if needed for troubleshooting
  
  try {
    const items = await OBR.scene.items.getItems();
    console.log("[MAIN] Scene items:", items);
  } catch (err) {
    console.error("[MAIN] Error fetching scene items:", err);
  }
  
}

