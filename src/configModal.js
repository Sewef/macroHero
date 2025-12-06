import OBR from "@owlbear-rodeo/sdk";
import { STORAGE_KEY, MODAL_LABEL, loadConfig, saveConfig } from "./config.js";

const GSHEET_API_KEY_STORAGE = "macrohero.gsheet.apiKey";
const GSHEET_SHEET_ID_STORAGE = "macrohero.gsheet.sheetId";

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
  const apiKey = document.getElementById("apiKeyInput").value.trim();
  const sheetId = document.getElementById("sheetIdInput").value.trim();
  
  console.log("Save clicked, validating JSON...");

  try {
    const parsed = JSON.parse(text);
    console.log("✓ JSON parsed successfully:", parsed);
    
    // Validate structure
    if (!parsed.global || !Array.isArray(parsed.pages)) {
      throw new Error("Config must have 'global' object and 'pages' array");
    }
    
    // Save Google Sheets credentials to localStorage
    if (apiKey) {
      localStorage.setItem(GSHEET_API_KEY_STORAGE, apiKey);
      console.log("✓ API key saved to localStorage");
    } else {
      localStorage.removeItem(GSHEET_API_KEY_STORAGE);
    }
    
    if (sheetId) {
      localStorage.setItem(GSHEET_SHEET_ID_STORAGE, sheetId);
      console.log("✓ Sheet ID saved to localStorage");
    } else {
      localStorage.removeItem(GSHEET_SHEET_ID_STORAGE);
    }
    
    console.log("✓ Config structure valid, sending to main app...");
    closeModal({ updatedConfig: parsed, gsheetUpdated: true });
  } catch (e) {
    console.error("✗ JSON parse error:", e);
    alert("Invalid JSON: " + e.message);
  }
};

OBR.onReady(() => {
  console.log("=== Config Modal Ready ===");
  
  // Load Google Sheets credentials from localStorage
  const apiKey = localStorage.getItem(GSHEET_API_KEY_STORAGE) || "";
  const sheetId = localStorage.getItem(GSHEET_SHEET_ID_STORAGE) || "";
  
  document.getElementById("apiKeyInput").value = apiKey;
  document.getElementById("sheetIdInput").value = sheetId;
  
  // Load current config
  loadConfig().then(cfg => {
    console.log("Modal loaded current config:", cfg);
    document.getElementById("cfgArea").value = JSON.stringify(cfg, null, 2);
  }).catch(error => {
    console.error("Error loading config in modal:", error);
  });
});
