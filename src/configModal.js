import OBR from "@owlbear-rodeo/sdk";
import { STORAGE_KEY, MODAL_LABEL, loadConfig, saveConfig } from "./config.js";
import { saveGoogleSheetsApiKey, saveGoogleSheetsSheetId, getGoogleSheetsCredentials } from "./commands/integrations/GoogleSheetsConfig.js";

function closeModal(data) {
  if (data) {
    console.log("Modal sending result broadcast:", data);
    OBR.broadcast.sendMessage("macrohero.config.result", data, { destination: "LOCAL" });
  } else {
    console.log("Modal closed without saving");
  }
  OBR.modal.close(MODAL_LABEL);
}

// Cancel
document.getElementById("cancelBtn").onclick = () => {
  console.log("Cancel clicked");
  closeModal()
};

// Save
document.getElementById("saveBtn").onclick = () => {
  const text = document.getElementById("cfgArea").value;
  const apiKeyInput = document.getElementById("apiKeyInput");
  const sheetIdInput = document.getElementById("sheetIdInput");
  
  // Use new value if provided, otherwise keep original
  const apiKey = apiKeyInput.value.trim() || apiKeyInput.dataset.original || "";
  const sheetId = sheetIdInput.value.trim() || sheetIdInput.dataset.original || "";
  
  console.log("Save clicked, validating JSON...");

  try {
    const parsed = JSON.parse(text);
    console.log("✓ JSON parsed successfully:", parsed);
    
    // Validate structure
    if (!parsed.global || !Array.isArray(parsed.pages)) {
      throw new Error("Config must have 'global' object and 'pages' array");
    }
    
    // Save Google Sheets credentials to localStorage
    const apiKey = document.getElementById("apiKeyInput").value;
    saveGoogleSheetsApiKey(apiKey);
    
    const sheetId = document.getElementById("sheetIdInput").value;
    saveGoogleSheetsSheetId(sheetId);
    
    console.log("✓ Config structure valid, sending to main app...");
    closeModal({ updatedConfig: parsed, gsheetUpdated: true });
  } catch (e) {
    console.error("✗ JSON parse error:", e);
    alert("Invalid JSON: " + e.message);
  }
};

/**
 * Mask sensitive string showing only first and last few characters
 * @param {string} str - String to mask
 * @param {number} visibleChars - Number of characters to show at start and end
 * @returns {string} Masked string
 */
function maskSensitiveData(str, visibleChars = 4) {
  if (!str || str.length <= visibleChars * 2) {
    return str;
  }
  const start = str.substring(0, visibleChars);
  const end = str.substring(str.length - visibleChars);
  const masked = '•'.repeat(Math.min(12, str.length - visibleChars * 2));
  return `${start}${masked}${end}`;
}

OBR.onReady(() => {
  console.log("=== Config Modal Ready ===");
  
  // Load Google Sheets credentials from localStorage
  const { apiKey, sheetId } = getGoogleSheetsCredentials();
  
  // Store original values for saving later
  const apiKeyInput = document.getElementById("apiKeyInput");
  const sheetIdInput = document.getElementById("sheetIdInput");
  
  // Display masked values as placeholders, leave inputs empty
  if (apiKey) {
    apiKeyInput.placeholder = maskSensitiveData(apiKey);
  }
  if (sheetId) {
    sheetIdInput.placeholder = maskSensitiveData(sheetId);
  }
  
  // Store original values in data attributes
  apiKeyInput.dataset.original = apiKey;
  sheetIdInput.dataset.original = sheetId;
  
  // Load current config
  loadConfig().then(cfg => {
    console.log("Modal loaded current config:", cfg);
    document.getElementById("cfgArea").value = JSON.stringify(cfg, null, 2);
  }).catch(error => {
    console.error("Error loading config in modal:", error);
  });
});
