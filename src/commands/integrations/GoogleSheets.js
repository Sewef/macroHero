/**
 * Google Sheets Integration
 * Handles reading and writing data to Google Sheets
 */

import { isDebugEnabled } from "../../debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('GoogleSheets') && console.log(...args);
const debugError = (...args) => isDebugEnabled('GoogleSheets') && console.error(...args);
const debugWarn = (...args) => isDebugEnabled('GoogleSheets') && console.warn(...args);

/**
 * Initialize Google Sheets integration
 * @param {Object} config - Configuration object
 * @param {string} config.apiKey - Google API key
 * @param {string} config.sheetId - Google Sheet ID
 * @returns {Object} Initialized client
 */
export function initializeGoogleSheets(config) {
  if (!config.apiKey || !config.sheetId) {
    debugWarn("Google Sheets not configured - missing API key or sheet ID");
    return null;
  }

  return {
    apiKey: config.apiKey,
    sheetId: config.sheetId,
    baseUrl: "https://sheets.googleapis.com/v4/spreadsheets"
  };
}

/**
 * Try to parse a localized numeric string into a Number
 * Supports French format (27,6), thousand separators (1 234 or 1.234) and mixed styles (1.234,56)
 * Returns the original value if it cannot be parsed deterministically
 * @param {*} raw
 */
function parseLocalizedNumberString(raw) {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== 'string') return raw;

  // Trim and normalize whitespace
  let s = raw.trim();
  if (s === '') return raw;
  // Replace NBSP or thin spaces, and remove common thousands separators (space groups later)
  s = s.replace(/\u00A0|\u202F/g, ' ');
  // Remove all spaces (could be thousand separators in some locales)
  s = s.replace(/\s/g, '');

  // If it's now a plain integer, keep it as number
  if (/^[+-]?\d+$/.test(s)) return Number(s);

  const hasComma = s.indexOf(',') !== -1;
  const hasDot = s.indexOf('.') !== -1;

  // If both separators exist, assume the last separator is the decimal marker
  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      // pattern like 1.234,56 -> remove dots (thousands), comma = decimal
      const normalized = s.replace(/\./g, '').replace(/,/g, '.');
      const n = Number(normalized);
      return Number.isNaN(n) ? raw : n;
    } else {
      // pattern like 1,234.56 -> remove commas (thousands)
      const normalized = s.replace(/,/g, '');
      const n = Number(normalized);
      return Number.isNaN(n) ? raw : n;
    }
  }

  // Only comma -> treat comma as decimal
  if (hasComma && !hasDot) {
    const normalized = s.replace(/,/g, '.');
    const n = Number(normalized);
    return Number.isNaN(n) ? raw : n;
  }

  // Only dot -> standard parse (also remove stray commas if any)
  if (hasDot && !hasComma) {
    const normalized = s.replace(/,/g, '');
    const n = Number(normalized);
    return Number.isNaN(n) ? raw : n;
  }

  return raw;
}

// Storage keys for persisted GSheets credentials
export const GSHEET_API_KEY_STORAGE = "macrohero.gsheet.apiKey";
export const GSHEET_SHEET_ID_STORAGE = "macrohero.gsheet.sheetId";

/**
 * Get Google Sheets credentials from localStorage
 * @returns {{apiKey: string|null, sheetId: string|null}}
 */
export function getGoogleSheetsCredentials() {
  return {
    apiKey: localStorage.getItem(GSHEET_API_KEY_STORAGE),
    sheetId: localStorage.getItem(GSHEET_SHEET_ID_STORAGE)
  };
}

/**
 * Save Google Sheets API key to localStorage
 * @param {string} apiKey - The API key to save (or empty to remove)
 */
export function saveGoogleSheetsApiKey(apiKey) {
  if (apiKey && apiKey.trim()) {
    localStorage.setItem(GSHEET_API_KEY_STORAGE, apiKey);
    debugLog("✓ API key saved to localStorage");
  } else {
    localStorage.removeItem(GSHEET_API_KEY_STORAGE);
  }
}

/**
 * Save Google Sheets Sheet ID to localStorage
 * @param {string} sheetId - The sheet ID to save (or empty to remove)
 */
export function saveGoogleSheetsSheetId(sheetId) {
  if (sheetId && sheetId.trim()) {
    localStorage.setItem(GSHEET_SHEET_ID_STORAGE, sheetId);
    debugLog("✓ Sheet ID saved to localStorage");
  } else {
    localStorage.removeItem(GSHEET_SHEET_ID_STORAGE);
  }
}

/**
 * Check if Google Sheets credentials are configured
 * @returns {boolean}
 */
export function hasGoogleSheetsCredentials() {
  const { apiKey, sheetId } = getGoogleSheetsCredentials();
  return !!(apiKey && sheetId);
}

/**
 * Read range from Google Sheet
 * @param {Object} client - Initialized client
 * @param {string} range - Sheet range (e.g., "Sheet1!A1:D10")
 * @returns {Promise<Array>} Array of rows
 */
async function readSheetRange(client, range) {
  if (!client) {
    throw new Error("Google Sheets not initialized");
  }

  try {
    const url = `${client.baseUrl}/${client.sheetId}/values/${encodeURIComponent(range)}?key=${client.apiKey}`;
    debugLog("[GSHEET-API] Fetching URL:", url.replace(client.apiKey, "***"));
    debugLog("[GSHEET-API] Sheet ID:", client.sheetId);
    debugLog("[GSHEET-API] Range:", range);

    const response = await fetch(url);

    debugLog("[GSHEET-API] Response status:", response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      debugError("[GSHEET-API] Error response body:", errorText);

      // Parse error details if it's JSON
      let errorDetails = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = errorJson.error?.message || errorText;
      } catch (e) {
        // Not JSON, use as-is
      }

      const errorMsg = `Failed to read sheet (${response.status} ${response.statusText}): ${errorDetails}`;
      debugError("[GSHEET-API]", errorMsg);
      throw new Error(errorMsg);
    }

    const data = await response.json();
    debugLog("[GSHEET-API] ✓ Successfully read sheet range, rows:", data.values?.length ?? 0);

    const values = data.values || [];

    // Use exported helper parseLocalizedNumberString

    // Convert values in place (preserve non-numeric strings)
    let conversionCount = 0;
    const convertedValues = values.map(row => row.map(cell => {
      const parsed = parseLocalizedNumberString(cell);
      if (parsed !== cell && typeof parsed === 'number' && !Number.isNaN(parsed)) conversionCount += 1;
      return parsed;
    }));

    // Log conversions if any
    if (conversionCount > 0) {
      debugLog(`[GSHEET-API] ✓ Converted ${conversionCount} localized numeric strings to numbers`);
    }

    // Flatten single-column ranges for convenience
    // If all rows have exactly 1 column, return a 1D array instead of 2D
    if (convertedValues.length > 0 && convertedValues.every(row => row.length === 1)) {
      const flattened = convertedValues.map(row => row[0]);
      debugLog("[GSHEET-API] ✓ Flattened single-column range to 1D array");
      return flattened;
    }

    return convertedValues;
  } catch (error) {
    debugError("[GSHEET-API] Exception:", error);
    throw error;
  }
}

/**
 * Convenience: Get a range for a given sheet name and range string
 * @param {Object} client - Initialized client
 * @param {string} sheetName - Sheet name (e.g., "Sheet1")
 * @param {string} range - Range string (e.g., "A1:B2")
 * @returns {Promise<Array>} Array of rows or flattened single-column array
 */
export async function getRange(client, sheetName, range) {
  const fullRange = `'${sheetName}'!${range}`;
  return await readSheetRange(client, fullRange);
}

/**
 * Convenience: Get single-cell value or first value from a range
 * @param {Object} client - Initialized client
 * @param {string} sheetName - Sheet name (e.g., "Sheet1")
 * @param {string} range - Range string (e.g., "A1")
 * @returns {Promise<any>} Single cell value or null
 */
export async function getValue(client, sheetName, range) {
  const result = await getRange(client, sheetName, range);
  if (Array.isArray(result)) {
    if (result.length === 0) return null;
    if (Array.isArray(result[0])) return result[0][0] ?? null;
    return result[0] ?? null;
  }
  return result ?? null;
}

/**
 * Write to Google Sheet
 * @param {Object} client - Initialized client
 * @param {string} range - Sheet range
 * @param {Array} values - 2D array of values
 * @returns {Promise<Object>} Write result
 */
async function writeSheetRange(client, range, values) {
  if (!client) {
    throw new Error("Google Sheets not initialized");
  }

  try {
    const url = `${client.baseUrl}/${client.sheetId}/values/${encodeURIComponent(range)}?key=${client.apiKey}&valueInputOption=USER_ENTERED`;
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ values })
    });

    if (!response.ok) {
      const errorText = await response.text();
      debugError("Failed to write sheet range:", response.status, errorText);
      throw new Error(`Failed to write sheet: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    debugError("Failed to write sheet range:", error);
    throw error;
  }
}

/**
 * Append to Google Sheet
 * @param {Object} client - Initialized client
 * @param {string} range - Sheet range
 * @param {Array} values - Row to append
 * @returns {Promise<Object>} Append result
 */
async function appendToSheet(client, range, values) {
  if (!client) {
    throw new Error("Google Sheets not initialized");
  }

  try {
    const url = `${client.baseUrl}/${client.sheetId}/values/${encodeURIComponent(range)}:append?key=${client.apiKey}&valueInputOption=USER_ENTERED`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ values: [values] })
    });

    if (!response.ok) {
      throw new Error(`Failed to append to sheet: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    debugError("Failed to append to sheet:", error);
    throw error;
  }
}

/**
 * Get sheet metadata
 * @param {Object} client - Initialized client
 * @returns {Promise<Object>} Sheet metadata
 */
async function getSheetMetadata(client) {
  if (!client) {
    throw new Error("Google Sheets not initialized");
  }

  try {
    const url = `${client.baseUrl}/${client.sheetId}?key=${client.apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to get sheet metadata: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    debugError("Failed to get sheet metadata:", error);
    throw error;
  }
}

export default {
  initializeGoogleSheets,
  getRange,
  getValue,
  getGoogleSheetsCredentials,
  saveGoogleSheetsApiKey,
  saveGoogleSheetsSheetId,
  hasGoogleSheetsCredentials,
  GSHEET_API_KEY_STORAGE,
  GSHEET_SHEET_ID_STORAGE
};

