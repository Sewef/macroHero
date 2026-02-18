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

/**
 * Apply OBR theme to the extension UI
 * Respects the user's theme preference and updates colors dynamically
 */
function applyTheme(theme) {
  const root = document.documentElement;
  
  if (theme.mode === "LIGHT") {
    debugLog("[THEME] Applying LIGHT mode");
    // Light theme colors - optimized for readability
    root.style.setProperty('--mh-bg', 'rgba(245, 245, 250, 0.95)');
    root.style.setProperty('--mh-surface', 'rgba(255, 255, 255, 0.95)');
    root.style.setProperty('--mh-panel', 'rgba(240, 240, 248, 0.9)');
    root.style.setProperty('--mh-panel-hover', 'rgba(235, 235, 245, 0.95)');
    root.style.setProperty('--mh-border', '#d0d0e0');
    root.style.setProperty('--mh-border-light', '#e0e0f0');
    root.style.setProperty('--mh-text', '#1a1a2e');
    root.style.setProperty('--mh-text-secondary', '#505070');
    root.style.setProperty('--mh-text-label', '#707090');
    
    // Use theme primary color for accent in light mode
    if (theme.primary) {
      root.style.setProperty('--mh-accent', theme.primary.main || '#3366ff');
      root.style.setProperty('--mh-accent-hover', theme.primary.light || '#5580ff');
    }
  } else {
    debugLog("[THEME] Applying DARK mode");
    // Dark theme colors - carefully crafted for the dark UI
    root.style.setProperty('--mh-bg', 'rgba(10, 10, 15, 0.8)');
    root.style.setProperty('--mh-surface', 'rgba(20, 20, 30, 0.9)');
    root.style.setProperty('--mh-panel', 'rgba(30, 30, 45, 0.85)');
    root.style.setProperty('--mh-panel-hover', 'rgba(40, 40, 60, 0.9)');
    root.style.setProperty('--mh-border', '#3d4a5f');
    root.style.setProperty('--mh-border-light', '#4a5570');
    root.style.setProperty('--mh-text', '#e8e8f0');
    root.style.setProperty('--mh-text-secondary', '#9a9aaa');
    root.style.setProperty('--mh-text-label', '#8a8a9a');
    
    // Use theme primary color for accent in dark mode
    if (theme.primary) {
      root.style.setProperty('--mh-accent', theme.primary.light || '#5a9fff');
      root.style.setProperty('--mh-accent-hover', theme.primary.main || '#7ab3ff');
    }
  }
}

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

    // Get and apply current theme
    try {
      const theme = await OBR.theme.getTheme();
      applyTheme(theme);
      
      // Listen for theme changes
      OBR.theme.onChange((newTheme) => {
        debugLog("[THEME] Theme changed to:", newTheme.mode);
        applyTheme(newTheme);
      });
    } catch (err) {
      debugWarn("[MAIN] Theme API not available, using dark theme defaults");
    }

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

    // Listen for debug mode changes from the config modal
    OBR.broadcast.onMessage("macrohero.debug.modes", async (event) => {
      debugLog("[MAIN] Debug modes updated via broadcast:", event.data);
      // localStorage is already updated by the modal, this is just a trigger
      // to let other modules know the debug modes have changed
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
