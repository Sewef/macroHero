import OBR from "@owlbear-rodeo/sdk";
import { STORAGE_KEY, MODAL_LABEL, loadConfig, saveConfig } from "./config.js";

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
  console.log("Save clicked, validating JSON...");

  try {
    const parsed = JSON.parse(text);
    console.log("✓ JSON parsed successfully:", parsed);
    
    // Validate structure
    if (!parsed.global || !Array.isArray(parsed.pages)) {
      throw new Error("Config must have 'global' object and 'pages' array");
    }
    
    console.log("✓ Config structure valid, sending to main app...");
    closeModal({ updatedConfig: parsed });
  } catch (e) {
    console.error("✗ JSON parse error:", e);
    alert("Invalid JSON: " + e.message);
  }
};

OBR.onReady(() => {
  console.log("=== Config Modal Ready ===");
  // Load current config
  loadConfig().then(cfg => {
    console.log("Modal loaded current config:", cfg);
    document.getElementById("cfgArea").value = JSON.stringify(cfg, null, 2);
  }).catch(error => {
    console.error("Error loading config in modal:", error);
  });
});
