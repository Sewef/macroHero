/**
 * Google Sheets Integration
 * Provides access to Google Sheets data in variable expressions
 */

import * as GoogleSheets from "./GoogleSheets.js";

class GSheetIntegration {
  constructor(apiKey, sheetId) {
    this.client = null;
    this.apiKey = apiKey;
    this.sheetId = sheetId;
    this.initialized = false;
    
    if (apiKey && sheetId) {
      this.init();
    }
  }

  init() {
    try {
      this.client = GoogleSheets.initializeGoogleSheets({
        apiKey: this.apiKey,
        sheetId: this.sheetId
      });
      this.initialized = !!this.client;
      console.log(`[GSheetIntegration] ✓ Initialized with client:`, this.client);
    } catch (error) {
      console.error("[GSheetIntegration] Failed to initialize:", error);
      this.initialized = false;
    }
  }

  /**
   * Get a single value from a Google Sheet
   * @param {string} sheetName - Sheet name
   * @param {string} range - Cell range (e.g., "A1")
   * @returns {Promise<any>} Cell value
   */
  async getValue(sheetName, range) {
    console.log(`[GSheetIntegration.getValue] Reading "${sheetName}"!${range}`);
    
    if (!this.initialized || !this.client) {
      console.warn("[GSheetIntegration.getValue] Not initialized");
      return null;
    }
    
    try {
      const fullRange = `'${sheetName}'!${range}`;
      const rows = await GoogleSheets.readSheetRange(this.client, fullRange);
      
      if (!rows || rows.length === 0) {
        console.warn("[GSheetIntegration.getValue] No data found");
        return null;
      }
      
      const value = rows[0][0];
      console.log(`[GSheetIntegration.getValue] ✓ Got value:`, value);
      return value;
    } catch (error) {
      console.error("[GSheetIntegration.getValue] Error:", error.message);
      return null;
    }
  }

  /**
   * Get a range of values from a Google Sheet
   * @param {string} sheetName - Sheet name
   * @param {string} range - Range (e.g., "A1:C10")
   * @returns {Promise<Array>} 2D array of values
   */
  async getRange(sheetName, range) {
    console.log(`[GSheetIntegration.getRange] Reading "${sheetName}"!${range}`);
    
    if (!this.initialized || !this.client) {
      console.warn("[GSheetIntegration.getRange] Not initialized");
      return null;
    }
    
    try {
      const fullRange = `'${sheetName}'!${range}`;
      const rows = await GoogleSheets.readSheetRange(this.client, fullRange);
      console.log(`[GSheetIntegration.getRange] ✓ Got ${rows?.length ?? 0} rows`);
      return rows;
    } catch (error) {
      console.error("[GSheetIntegration.getRange] Error:", error.message);
      return null;
    }
  }
}

export default GSheetIntegration;
