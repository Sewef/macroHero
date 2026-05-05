/**
 * Google Sheets Integration
 * Handles reading data from Google Sheets via the Sheets REST API (read-only, API key auth).
 */

import { createDebugLogger } from "../../debugMode.js";

const logger = createDebugLogger("GoogleSheets");

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Create a Sheets API client from an API key.
 * @param {Object} config
 * @param {string} config.apiKey
 * @returns {{ apiKey: string, baseUrl: string } | null}
 */
export function initializeGoogleSheets(config) {
  if (!config.apiKey) {
    logger.warn("Not configured: missing API key");
    return null;
  }
  return {
    apiKey: config.apiKey,
    baseUrl: "https://sheets.googleapis.com/v4/spreadsheets",
  };
}

// ── Number parsing ────────────────────────────────────────────────────────────

/**
 * Parse a localized numeric string to Number.
 * Supports: French "27,6", thousand-separated "1 234" / "1.234", mixed "1.234,56".
 * Returns the original value when parsing is ambiguous or impossible.
 * @param {*} raw
 * @returns {number | *}
 */
function parseLocalizedNumber(raw) {
  if (raw === null || raw === undefined || typeof raw !== "string") return raw;

  // Normalize whitespace (NBSP, thin space → regular space), then strip spaces
  let s = raw.trim().replace(/[\u00A0\u202F]/g, " ").replace(/\s/g, "");
  if (s === "") return raw;

  if (/^[+-]?\d+$/.test(s)) return Number(s);

  const hasComma = s.includes(",");
  const hasDot   = s.includes(".");

  if (hasComma && hasDot) {
    // Last separator is the decimal marker
    const n = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? Number(s.replace(/\./g, "").replace(",", "."))   // 1.234,56
      : Number(s.replace(/,/g, ""));                      // 1,234.56
    return Number.isNaN(n) ? raw : n;
  }

  if (hasComma) {
    const n = Number(s.replace(",", "."));
    return Number.isNaN(n) ? raw : n;
  }

  if (hasDot) {
    const n = Number(s);
    return Number.isNaN(n) ? raw : n;
  }

  return raw;
}

// ── Credentials ───────────────────────────────────────────────────────────────

export const GSHEET_API_KEY_STORAGE = "macrohero.gsheet.apiKey";

/** @returns {{ apiKey: string | null }} */
export function getGoogleSheetsCredentials() {
  return { apiKey: localStorage.getItem(GSHEET_API_KEY_STORAGE) };
}

/** @param {string} apiKey */
export function saveGoogleSheetsApiKey(apiKey) {
  if (apiKey?.trim()) {
    localStorage.setItem(GSHEET_API_KEY_STORAGE, apiKey);
    logger.log("API key saved");
  } else {
    localStorage.removeItem(GSHEET_API_KEY_STORAGE);
  }
}

/** @returns {boolean} */
export function hasGoogleSheetsCredentials() {
  return !!getGoogleSheetsCredentials().apiKey;
}

// ── Core fetch ────────────────────────────────────────────────────────────────

/**
 * Fetch a named range from a spreadsheet and return rows with localized numbers parsed.
 * Single-column results are flattened to a 1-D array.
 * @param {{ apiKey: string, baseUrl: string }} client
 * @param {string} sheetId  - Spreadsheet ID
 * @param {string} range    - A1 notation, already quoted if needed (e.g. "'Sheet1'!A1:D10")
 * @returns {Promise<Array>}
 */
async function readSheetRange(client, sheetId, range) {
  const url = `${client.baseUrl}/${sheetId}/values/${encodeURIComponent(range)}?key=${client.apiKey}`;
  logger.log(`Fetching: ${range}`);

  const response = await fetch(url);
  logger.log(`Response: ${response.status}`);

  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try { detail = JSON.parse(text).error?.message ?? text; } catch { /* not JSON */ }
    const msg = `Failed to read sheet (${response.status} ${response.statusText}): ${detail}`;
    logger.error(msg);
    throw new Error(msg);
  }

  const rows = (await response.json()).values ?? [];
  logger.log(`Read ${rows.length} rows`);

  let conversions = 0;
  const parsed = rows.map(row =>
    row.map(cell => {
      const v = parseLocalizedNumber(cell);
      if (v !== cell) conversions++;
      return v;
    })
  );
  if (conversions > 0) logger.log(`Converted ${conversions} numeric strings`);

  // Flatten single-column result
  if (parsed.length > 0 && parsed.every(r => r.length === 1)) {
    logger.log("Flattened to 1D array");
    return parsed.map(r => r[0]);
  }
  return parsed;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get a range from a named sheet.
 * @param {{ apiKey: string, baseUrl: string }} client
 * @param {string} sheetId
 * @param {string} sheetName - Tab name (e.g. "Sheet1")
 * @param {string} range     - Range string (e.g. "A1:D10")
 * @returns {Promise<Array>}
 */
export async function getRange(client, sheetId, sheetName, range) {
  return readSheetRange(client, sheetId, `'${sheetName}'!${range}`);
}

/**
 * Get the first cell value from a range (or the whole range for multi-cell).
 * @param {{ apiKey: string, baseUrl: string }} client
 * @param {string} sheetId
 * @param {string} sheetName
 * @param {string} range
 * @returns {Promise<any>}
 */
export async function getValue(client, sheetId, sheetName, range) {
  const result = await getRange(client, sheetId, sheetName, range);
  if (!Array.isArray(result) || result.length === 0) return result ?? null;
  return Array.isArray(result[0]) ? (result[0][0] ?? null) : (result[0] ?? null);
}
