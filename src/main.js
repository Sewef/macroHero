import OBR from "@owlbear-rodeo/sdk";
import { openConfigModal, loadConfig } from "./config.js";
import { initUI, updateConfig, setGlobalVariables, reloadCurrentPage } from "./ui.js";
import { resolveVariables } from "./expressionEvaluator.js";
import { initializeExpressions } from "./expressionHelpers.js";

const GSHEET_API_KEY_STORAGE = "macrohero.gsheet.apiKey";
const GSHEET_SHEET_ID_STORAGE = "macrohero.gsheet.sheetId";

document.getElementById("configBtn").onclick = openConfigModal;
document.getElementById("reloadBtn").onclick = reloadCurrentPage;

// Chargement initial
OBR.onReady(async () => {
  try {
    console.log("=== App Loading ===");

    const cfg = await loadConfig();
    console.log("Config loaded:", cfg);

    // Initialize expression system with Google Sheets from localStorage
    const apiKey = localStorage.getItem(GSHEET_API_KEY_STORAGE);
    const sheetId = localStorage.getItem(GSHEET_SHEET_ID_STORAGE);
    
    if (apiKey && sheetId) {
      console.log("[MAIN] Initializing expressions with Google Sheets from localStorage...");
      initializeExpressions({ apiKey, sheetId });
    } else {
      console.log("[MAIN] Google Sheets credentials not found in localStorage");
    }

    // Check if config is empty or has pages
    if (!cfg.pages || cfg.pages.length === 0) {
      console.warn("⚠️ Config has no pages!");
    }

    // Resolve global variables (these are needed immediately for page variable expressions)
    const globalVars = await resolveVariables(cfg.global?.variables);
    console.log("Global variables resolved:", globalVars);

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
      console.log("[MAIN] Scene is already ready, initializing UI");
      initUI(cfg);
      logOBRImageItems();
    } else {
      // If not ready yet, wait for it to be ready
      OBR.scene.onReadyChange((isReady) => {
        if (isReady) {
          console.log("[MAIN] Scene is now ready, initializing UI");
          initUI(cfg);
          logOBRImageItems();
        }
      });
    }

    // Listen for config changes from the modal
    OBR.broadcast.onMessage("macrohero.config.updated", async (event) => {
      console.log("✓ Config updated, refreshing UI");
      
      // Re-initialize Google Sheets from localStorage (modal saves credentials there)
      const apiKey = localStorage.getItem(GSHEET_API_KEY_STORAGE);
      const sheetId = localStorage.getItem(GSHEET_SHEET_ID_STORAGE);
      
      if (apiKey && sheetId) {
        console.log("[MAIN] Re-initializing expressions with Google Sheets from localStorage...");
        initializeExpressions({ apiKey, sheetId });
      }
      
      updateConfig(event.data);
    });
  } catch (error) {
    console.error("Error during initialization:", error);
  }
});

async function logOBRImageItems() {
  try {
    // Get all items from the scene
    const items = await OBR.scene.items.getItems();
    console.log("[OBR SCENE] All items:", items);

    // Filter for image items
    const imageItems = items.filter(item => item.type === "IMAGE");
    console.log("[OBR SCENE] Image items:", imageItems);

    // You can also filter by other types if needed
    const curveItems = items.filter(item => item.type === "CURVE");
    console.log("[OBR SCENE] Curve items:", curveItems);

  } catch (err) {
    console.error("[OBR SCENE] Error fetching scene items:", err);
  }
}

