/**
 * googleSheets.js — Google Sheets credentials UI and validation
 */
import { saveGoogleSheetsApiKey, getGoogleSheetsCredentials } from '../commands/integrations/GoogleSheets.js';
import { maskSensitiveData } from './utils.js';

export function initGoogleSheetsUI() {
  const { apiKey } = getGoogleSheetsCredentials();
  const apiKeyInput  = document.getElementById('apiKeyInput');
  if (!apiKeyInput) return;
  if (apiKey)  apiKeyInput.placeholder  = maskSensitiveData(apiKey);
  apiKeyInput.dataset.original  = apiKey  || '';
}

export function saveGoogleSheetsInputs() {
  const { apiKey } = getGoogleSheetsInputValues();
  saveGoogleSheetsApiKey(apiKey);
}

export function getGoogleSheetsInputValues() {
  const apiKeyInput  = document.getElementById('apiKeyInput');
  return {
    apiKey:  (apiKeyInput?.value.trim()  || apiKeyInput?.dataset.original  || ''),
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
  const { apiKey } = getGoogleSheetsInputValues();
  if (scanForGoogleSheets(config) && apiKey.length < 10) {
    return 'Google Sheets is referenced in the config but API Key is missing or invalid.';
  }
  return null;
}
