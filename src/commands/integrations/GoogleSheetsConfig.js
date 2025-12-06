/**
 * Google Sheets Configuration Management
 * Handles localStorage for API keys and sheet IDs
 */

const GSHEET_API_KEY_STORAGE = "macrohero.gsheet.apiKey";
const GSHEET_SHEET_ID_STORAGE = "macrohero.gsheet.sheetId";

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
        console.log("✓ API key saved to localStorage");
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
        console.log("✓ Sheet ID saved to localStorage");
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

// Export storage key constants for backward compatibility
export { GSHEET_API_KEY_STORAGE, GSHEET_SHEET_ID_STORAGE };
