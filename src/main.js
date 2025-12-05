import OBR from "@owlbear-rodeo/sdk";
import { openConfigModal, loadConfig } from "./config.js";
import { initUI, updateConfig, setGlobalVariables } from "./ui.js";
import { resolveVariables } from "./expressionEvaluator.js";
import { initializeExpressions } from "./expressionHelpers.js";

document.getElementById("configBtn").onclick = openConfigModal;

// Chargement initial
OBR.onReady(async () => {
  try {
    console.log("=== App Loading ===");

    const cfg = await loadConfig();
    console.log("Config loaded:", cfg);

    // Initialize expression system with Google Sheets if configured
    if (cfg.global?.gsheet) {
      console.log("[MAIN] Initializing expressions with Google Sheets...");
      initializeExpressions(cfg.global.gsheet);
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


    // Delay logging until scene is fully ready
    OBR.scene.onReadyChange((isReady) => {
      if (isReady) {
        initUI(cfg);
        logOBRImageItems();
      }
    });

    // Listen for config changes from the modal
    OBR.broadcast.onMessage("macrohero.config.updated", async (event) => {
      console.log("✓ Config updated, refreshing UI");
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

