/**
 * Google Sheets Integration
 * Handles reading and writing data to Google Sheets
 */

/**
 * Initialize Google Sheets integration
 * @param {Object} config - Configuration object
 * @param {string} config.apiKey - Google API key
 * @param {string} config.sheetId - Google Sheet ID
 * @returns {Object} Initialized client
 */
export function initializeGoogleSheets(config) {
  if (!config.apiKey || !config.sheetId) {
    console.warn("Google Sheets not configured - missing API key or sheet ID");
    return null;
  }

  return {
    apiKey: config.apiKey,
    sheetId: config.sheetId,
    baseUrl: "https://sheets.googleapis.com/v4/spreadsheets"
  };
}

/**
 * Read range from Google Sheet
 * @param {Object} client - Initialized client
 * @param {string} range - Sheet range (e.g., "Sheet1!A1:D10")
 * @returns {Promise<Array>} Array of rows
 */
export async function readSheetRange(client, range) {
  if (!client) {
    throw new Error("Google Sheets not initialized");
  }

  try {
    const url = `${client.baseUrl}/${client.sheetId}/values/${encodeURIComponent(range)}?key=${client.apiKey}`;
    console.log("[GSHEET-API] Fetching URL:", url.replace(client.apiKey, "***"));
    console.log("[GSHEET-API] Sheet ID:", client.sheetId);
    console.log("[GSHEET-API] Range:", range);
    
    const response = await fetch(url);
    
    console.log("[GSHEET-API] Response status:", response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[GSHEET-API] Error response body:", errorText);
      
      // Parse error details if it's JSON
      let errorDetails = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = errorJson.error?.message || errorText;
      } catch (e) {
        // Not JSON, use as-is
      }
      
      const errorMsg = `Failed to read sheet (${response.status} ${response.statusText}): ${errorDetails}`;
      console.error("[GSHEET-API]", errorMsg);
      throw new Error(errorMsg);
    }

    const data = await response.json();
    console.log("[GSHEET-API] ✓ Successfully read sheet range, rows:", data.values?.length ?? 0);
    return data.values || [];
  } catch (error) {
    console.error("[GSHEET-API] Exception:", error);
    throw error;
  }
}

/**
 * Write to Google Sheet
 * @param {Object} client - Initialized client
 * @param {string} range - Sheet range
 * @param {Array} values - 2D array of values
 * @returns {Promise<Object>} Write result
 */
export async function writeSheetRange(client, range, values) {
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
      console.error("Failed to write sheet range:", response.status, errorText);
      throw new Error(`Failed to write sheet: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to write sheet range:", error);
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
export async function appendToSheet(client, range, values) {
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
    console.error("Failed to append to sheet:", error);
    throw error;
  }
}

/**
 * Get sheet metadata
 * @param {Object} client - Initialized client
 * @returns {Promise<Object>} Sheet metadata
 */
export async function getSheetMetadata(client) {
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
    console.error("Failed to get sheet metadata:", error);
    throw error;
  }
}

export default {
  initializeGoogleSheets,
  readSheetRange,
  writeSheetRange,
  appendToSheet,
  getSheetMetadata
};
