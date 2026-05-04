/**
 * googleSheets.js — Google Sheets credentials UI and validation
 */
import { saveGoogleSheetsApiKey, saveGoogleSheetsSheetId, getGoogleSheetsCredentials } from '../commands/integrations/GoogleSheets.js';
import { maskSensitiveData } from './utils.js';

export function initGoogleSheetsUI() {
  const { apiKey, sheetId } = getGoogleSheetsCredentials();
  const apiKeyInput  = document.getElementById('apiKeyInput');
  const sheetIdInput = document.getElementById('sheetIdInput');
  if (!apiKeyInput || !sheetIdInput) return;
  if (apiKey)  apiKeyInput.placeholder  = maskSensitiveData(apiKey);
  if (sheetId) sheetIdInput.placeholder = maskSensitiveData(sheetId);
  apiKeyInput.dataset.original  = apiKey  || '';
  sheetIdInput.dataset.original = sheetId || '';
}

export function saveGoogleSheetsInputs() {
  const { apiKey, sheetId } = getGoogleSheetsInputValues();
  saveGoogleSheetsApiKey(apiKey);
  saveGoogleSheetsSheetId(sheetId);
}

export function getGoogleSheetsInputValues() {
  const apiKeyInput  = document.getElementById('apiKeyInput');
  const sheetIdInput = document.getElementById('sheetIdInput');
  return {
    apiKey:  (apiKeyInput?.value.trim()  || apiKeyInput?.dataset.original  || ''),
    sheetId: (sheetIdInput?.value.trim() || sheetIdInput?.dataset.original || ''),
  };
}

export function scanForGoogleSheets(obj) {
  if (!obj) return false;
  if (typeof obj === 'string') return obj.includes('GoogleSheets.');
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) { if (scanForGoogleSheets(obj[k])) return true; }
  }
  return false;
}

/**
 * Validates GSheets credentials if the config references GoogleSheets.
 * Returns an error message string, or null if valid.
 */
export function validateGoogleSheets(config) {
  const { apiKey, sheetId } = getGoogleSheetsInputValues();
  if (scanForGoogleSheets(config) && (apiKey.length < 10 || sheetId.length < 10)) {
    return 'Google Sheets is referenced in the config but API Key or Sheet ID is missing/invalid.';
  }
  return null;
}
