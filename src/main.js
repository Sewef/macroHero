import OBR from "@owlbear-rodeo/sdk";
import { openConfigModal, loadConfig, loadConfigFromLocalStorage } from "./config.js";
import { initUI, updateConfig, setGlobalVariables, reloadCurrentPage } from "./ui.js";
import { resolveVariables } from "./expressionEvaluator.js";
import { initializeExpressions } from "./expressionHelpers.js";
import { getGoogleSheetsCredentials } from "./commands/integrations/GoogleSheets.js";
import { flushPendingChanges } from "./storage.js";
import { createDebugLogger } from "./debugMode.js";

// Debug logger
const logger = createDebugLogger('main');

// Track broadcast subscriptions for cleanup
const broadcastUnsubs = [];

/**
 * Apply OBR theme to the extension UI
 * Respects the user's theme preference and updates colors dynamically
 */
function applyTheme(theme) {
  
  logger.log(`Applied: ${isLight ? "light" : "dark"} theme`);
  
  // Toggle light mode class (handles all color variables via CSS)
  root.classList.toggle('light-mode', isLight);
  
  // Apply custom theme primary colors if available
  if (theme.primary) {
    root.style.setProperty('--mh-accent', isLight ? (theme.primary.main || '#9966ff') : (theme.primary.light || '#c8adff'));
    root.style.setProperty('--mh-accent-hover', isLight ? (theme.primary.light || '#bb99ff') : (theme.primary.main || '#bb99ff'));
  }
}

document.getElementById("configBtn").onclick = openConfigModal;
document.getElementById("reloadBtn").onclick = reloadCurrentPage;

// Ensure pending localStorage changes are saved before page unloads
window.addEventListener('beforeunload', async () => {
  await flushPendingChanges();
  // Also clean up broadcast subscriptions
  broadcastUnsubs.forEach(unsub => { try { unsub?.(); } catch (e) { /* ignore */ } });
});

// Chargement initial
OBR.onReady(async () => {
  try {
    logger.log("Loading application");

    // Get and apply current theme
    try {
      const theme = await OBR.theme.getTheme();
      applyTheme(theme);
      
      // Listen for theme changes
      OBR.theme.onChange((newTheme) => {
        logger.log("hanged to:", newTheme.mode);
        applyTheme(newTheme);
      });
    } catch (err) {
      logger.warn("Theme API not available, using default theme");
    }

    const cfg = await loadConfig();

    // Initialize expression system with Google Sheets from localStorage
    const { apiKey, sheetId } = getGoogleSheetsCredentials();

    if (apiKey && sheetId) {
      initializeExpressions({ apiKey, sheetId });
    } else {
      logger.warn("Google Sheets not configured: missing credentials");
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
        logger.warn('Scene logging skipped or failed:', err);
      }
    })();

    // Listen for config changes from the modal
    const configUpdatedUnsub = OBR.broadcast.onMessage("macrohero.config.updated", async (event) => {
      logger.log("Config updated via broadcast");

      // If this is just an UI update (button click, counter change, etc.), skip re-resolution
      if (event.data && event.data.savedFromUI && !event.data.savedFromModal) {
        logger.log("Skipping re-resolution for UI update");
        return;
      }

      // If config was saved from modal, reload the page to ensure everything is fresh
      if (event.data && event.data.savedFromModal) {
        logger.log("Config saved from modal, reloading page");
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
            logger.warn("Config not found in localStorage after save");
            return;
          }
        } catch (err) {
          logger.error('Failed to load config from localStorage:', err);
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
    if (configUpdatedUnsub) broadcastUnsubs.push(configUpdatedUnsub);

    // Listen for debug mode changes from the config modal
    const debugModesUnsub = OBR.broadcast.onMessage("macrohero.debug.modes", async (event) => {
      logger.log("Debug modes updated via broadcast");
      // localStorage is already updated by the modal, this is just a trigger
      // to let other modules know the debug modes have changed
    });
    if (debugModesUnsub) broadcastUnsubs.push(debugModesUnsub);
  } catch (error) {
    logger.error("Error during initialization:", error);
  }
});

// Clean up broadcast subscriptions on page unload
window.addEventListener('beforeunload', () => {
  broadcastUnsubs.forEach(unsub => { try { unsub?.(); } catch (e) { /* ignore */ } });
  logger.log("Cleaned up broadcast subscriptions");
});

async function logOBRImageItems() {
  // Optional: Log scene items for debugging
  // Uncomment if needed for troubleshooting

  try {
    const items = await OBR.scene.items.getItems();
    logger.log("Scene items loaded");
  } catch (err) {
    logger.error("Error fetching scene items:", err);
  }

}

async function logOBRSceneMetadata() {
  try {
    const metadata = await OBR.scene.getMetadata();
    logger.log("Scene metadata loaded");
  } catch (err) {
    logger.error("Error fetching scene metadata:", err);
  }
}
