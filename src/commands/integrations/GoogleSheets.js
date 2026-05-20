/**
 * Google Sheets Integration
 * Handles reading data from Google Sheets via the Sheets REST API (read-only, API key auth).
 */

import { createDebugLogger } from "../../debugMode.js";

const logger = createDebugLogger("GoogleSheets");

const CACHE_TTL_MS = 1000;

function normalizeRangeKey(range) {
  if (!range || typeof range !== "string") return "";
  const trimmed = range.trim();
  const bangIndex = trimmed.indexOf("!");
  if (bangIndex === -1) return trimmed;
  const sheet = trimmed.slice(0, bangIndex).replace(/^'+|'+$/g, "");
  const a1 = trimmed.slice(bangIndex + 1);
  return `${sheet}!${a1}`;
}

function getOrCreateClientState(client) {
  if (!client.__mhState) {
    client.__mhState = {
      cache: new Map(),
      inFlight: new Map(),
      pendingBySheet: new Map(),
    };
  }
  return client.__mhState;
}

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
    __mhState: {
      cache: new Map(),
      inFlight: new Map(),
      pendingBySheet: new Map(),
    },
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
  const state = getOrCreateClientState(client);
  const cacheKey = `${sheetId}|${range}`;
  const now = Date.now();

  const cached = state.cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    logger.log(`Cache hit: ${range}`);
    return cached.value;
  }

  if (state.inFlight.has(cacheKey)) {
    logger.log(`In-flight reuse: ${range}`);
    return state.inFlight.get(cacheKey);
  }

  const promise = enqueueRangeRead(client, sheetId, range, cacheKey);
  state.inFlight.set(cacheKey, promise);
  promise.finally(() => {
    state.inFlight.delete(cacheKey);
  });
  return promise;
}

function enqueueRangeRead(client, sheetId, range, cacheKey) {
  const state = getOrCreateClientState(client);
  let batch = state.pendingBySheet.get(sheetId);

  if (!batch) {
    batch = {
      ranges: new Set(),
      waiters: new Map(),
      timer: null,
    };
    state.pendingBySheet.set(sheetId, batch);
  }

  return new Promise((resolve, reject) => {
    batch.ranges.add(range);
    if (!batch.waiters.has(range)) batch.waiters.set(range, []);
    batch.waiters.get(range).push({ resolve, reject, cacheKey });

    if (!batch.timer) {
      batch.timer = setTimeout(() => flushBatch(client, sheetId), 0);
    }
  });
}

async function flushBatch(client, sheetId) {
  const state = getOrCreateClientState(client);
  const batch = state.pendingBySheet.get(sheetId);
  if (!batch) return;

  batch.timer = null;
  const requestedRanges = Array.from(batch.ranges);
  if (requestedRanges.length === 0) {
    state.pendingBySheet.delete(sheetId);
    return;
  }

  try {
    const params = requestedRanges
      .map(r => `ranges=${encodeURIComponent(r)}`)
      .join("&");
    const url = `${client.baseUrl}/${sheetId}/values:batchGet?${params}&key=${client.apiKey}`;

    logger.log(`Batch fetching ${requestedRanges.length} range(s)`);
    const response = await fetch(url);
    logger.log(`Batch response: ${response.status}`);

    if (!response.ok) {
      const text = await response.text();
      let detail = text;
      try { detail = JSON.parse(text).error?.message ?? text; } catch { /* not JSON */ }
      const msg = `Failed to read sheet (${response.status} ${response.statusText}): ${detail}`;
      throw new Error(msg);
    }

    const payload = await response.json();
    const rangeValues = new Map();
    for (const vr of payload.valueRanges || []) {
      rangeValues.set(normalizeRangeKey(vr.range), vr.values ?? []);
    }

    for (const requestedRange of requestedRanges) {
      // API usually echoes exact A1 with sheet name; fallback to empty when missing
      const rows = rangeValues.get(normalizeRangeKey(requestedRange)) ?? [];

      let conversions = 0;
      const parsed = rows.map(row =>
        row.map(cell => {
          const v = parseLocalizedNumber(cell);
          if (v !== cell) conversions++;
          return v;
        })
      );

      let value = parsed;
      if (parsed.length > 0 && parsed.every(r => r.length === 1)) {
        value = parsed.map(r => r[0]);
      }

      if (conversions > 0) {
        logger.log(`Converted ${conversions} numeric strings for ${requestedRange}`);
      }

      const waiters = batch.waiters.get(requestedRange) || [];
      const expiresAt = Date.now() + CACHE_TTL_MS;
      for (const waiter of waiters) {
        state.cache.set(waiter.cacheKey, { value, expiresAt });
        waiter.resolve(value);
      }
    }
  } catch (error) {
    logger.error("Batch fetch failed:", error);
    for (const waiters of batch.waiters.values()) {
      for (const waiter of waiters) {
        waiter.reject(error);
      }
    }
  } finally {
    state.pendingBySheet.delete(sheetId);
  }
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

/**
 * Get multiple ranges from a named sheet in one call and return first-cell values.
 * Returned object keeps the same keys as the requested ranges.
 *
 * Example:
 *   await GoogleSheets.getValues(client, sheetId, "Sheet1", ["A1", "B2:C3"])
 *   => { A1: 12, "B2:C3": [[...], [...]] }
 *
 * @param {{ apiKey: string, baseUrl: string }} client
 * @param {string} sheetId
 * @param {string} sheetName
 * @param {string[]} ranges
 * @returns {Promise<Record<string, any>>}
 */
export async function getValues(client, sheetId, sheetName, ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return {};
  }

  const qualifiedRanges = ranges.map(range => `'${sheetName}'!${range}`);
  const rangeResults = await Promise.all(
    qualifiedRanges.map(range => readSheetRange(client, sheetId, range))
  );

  const result = {};
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const value = rangeResults[i];
    if (!Array.isArray(value) || value.length === 0) {
      result[range] = value ?? null;
    } else {
      result[range] = Array.isArray(value[0]) ? (value[0][0] ?? null) : (value[0] ?? null);
    }
  }

  return result;
}
