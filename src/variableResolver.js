/**
 * Variable Resolver (DEPRECATED - Use expressionEvaluator.js instead)
 * This file is kept for reference but is no longer used.
 * All variable resolution now happens in expressionEvaluator.js using expression-based syntax.
 */

import * as math from "mathjs";
import * as playerMetadata from "./commands/playerMetadata.js";
import * as sceneMetadata from "./commands/sceneMetadata.js";
import * as googleSheets from "./commands/integrations/GoogleSheets.js";
import * as parser from "./parser.js";

/**
 * Cache for resolved variables
 * @type {Map<string, any>}
 */
const variableCache = new Map();

/**
 * Google Sheets client (initialized with API key)
 * @type {Object}
 */
let googleSheetsClient = null;

/**
 * Initialize Google Sheets client
 * @param {string} apiKey - Google API key
 * @param {string} sheetId - Google Sheet ID
 */
export function initializeGoogleSheets(apiKey, sheetId) {
  console.log("[GSHEET] initializeGoogleSheets() called");
  console.log("[GSHEET]   apiKey length:", apiKey?.length ?? 0);
  console.log("[GSHEET]   sheetId:", sheetId);
  
  if (apiKey && sheetId) {
    try {
      googleSheetsClient = googleSheets.initializeGoogleSheets({ apiKey, sheetId });
      console.log("[GSHEET] ✓ Client initialized successfully");
      console.log("[GSHEET] Client object:", googleSheetsClient);
    } catch (error) {
      console.error("[GSHEET] ✗ Error initializing client:", error);
    }
  } else {
    console.warn("[GSHEET] ✗ Not configured - missing API key or sheet ID");
    console.warn("[GSHEET]   apiKey present:", !!apiKey);
    console.warn("[GSHEET]   sheetId present:", !!sheetId);
  }
}

/**
 * Resolve a variable from Google Sheets
 * @param {string} varName - Variable name
 * @param {Object} varConfig - Variable configuration
 * @returns {Promise<any>} Resolved value
 */
async function resolveGoogleSheetsVariable(varName, varConfig) {
  console.log(`[GSHEET] Resolving variable "${varName}"...`);
  console.log(`[GSHEET]   varConfig:`, varConfig);
  
  try {
    if (!googleSheetsClient) {
      console.warn(`[GSHEET] ✗ Not configured for variable "${varName}"`);
      console.warn(`[GSHEET]   googleSheetsClient is:`, googleSheetsClient);
      return varConfig.default ?? 0;
    }

    const sheetName = varConfig.sheetName;
    const range = varConfig.range;

    console.log(`[GSHEET]   sheetName: "${sheetName}"`);
    console.log(`[GSHEET]   range: "${range}"`);

    if (!sheetName || !range) {
      console.error(`[GSHEET] ✗ Missing sheetName or range for "${varName}"`);
      return varConfig.default ?? 0;
    }

    // Build the full range reference
    const fullRange = `'${sheetName}'!${range}`;
    console.log(`[GSHEET] Reading "${varName}" from ${fullRange}`);

    // Read from sheet
    console.log(`[GSHEET] Calling googleSheets.readSheetRange()...`);
    const rows = await googleSheets.readSheetRange(googleSheetsClient, fullRange);
    console.log(`[GSHEET] Response:`, rows);
    
    if (!rows || rows.length === 0) {
      console.warn(`[GSHEET] ✗ No data found at ${fullRange}`);
      console.warn(`[GSHEET]   Returning default:`, varConfig.default ?? 0);
      return varConfig.default ?? 0;
    }

    // Get the first cell value
    const cellValue = rows[0][0];
    console.log(`[GSHEET] ✓ "${varName}" raw value from sheet:`, cellValue);

    // Convert to appropriate type
    let value = cellValue;
    if (varConfig.type === "number") {
      value = parseFloat(cellValue);
      console.log(`[GSHEET]   Parsed as number:`, value);
      if (isNaN(value)) {
        console.warn(`[GSHEET] ✗ Could not parse "${cellValue}" as number for "${varName}"`);
        return varConfig.default ?? 0;
      }
    }

    console.log(`[GSHEET] ✓ Variable "${varName}" resolved to:`, value);
    return value;
  } catch (error) {
    console.error(`[GSHEET] ✗ Error resolving "${varName}":`, error);
    console.error(`[GSHEET]   Stack:`, error.stack);
    return varConfig.default ?? 0;
  }
}

/**
 * Resolve a single variable based on its configuration
 * @param {string} varName - Variable name
 * @param {Object} varConfig - Variable configuration
 * @param {Object} globalVariables - Global variables (for reference)
 * @param {Object} resolvedVariables - Already resolved variables
 * @returns {Promise<any>} Resolved variable value
 */
async function resolveVariable(varName, varConfig, globalVariables = {}, resolvedVariables = {}) {
  try {
    console.log(`\n[VAR] Resolving "${varName}"...`);
    console.log(`[VAR]   Type: ${varConfig.type}`);
    console.log(`[VAR]   Config:`, varConfig);
    
    // ⚠️ NO CACHING - Always re-resolve to get fresh data from Google Sheets, metadata, etc.
    
    let value;

    switch (varConfig.type) {
      case "string":
      case "number":
        // Check if this should load from Google Sheets
        if (varConfig.sheetName && varConfig.range) {
          console.log(`[VAR] → Google Sheets detected (sheetName="${varConfig.sheetName}", range="${varConfig.range}")`);
          value = await resolveGoogleSheetsVariable(varName, varConfig);
        } else {
          // Simple types - use default or expression
          console.log(`[VAR] → Simple type (no sheetName)`);
          value = varConfig.default ?? varConfig.expression ?? 0;
          console.log(`[VAR]   value = ${value}`);
        }
        break;

      case "input":
        // Input type - use current expression value
        console.log(`[VAR] → Input type`);
        value = varConfig.expression ?? varConfig.default ?? "";
        console.log(`[VAR]   value = ${value}`);
        break;

      case "checkbox":
        // Checkbox type - use default (usually false) or expression
        console.log(`[VAR] → Checkbox type`);
        value = varConfig.default ?? varConfig.expression ?? false;
        console.log(`[VAR]   value = ${value}`);
        break;

      case "calc":
        // Calculated field - evaluate expression with resolved variables
        console.log(`[VAR] → Calculated type`);
        if (varConfig.expression) {
          value = evaluateExpression(varConfig.expression, resolvedVariables);
          console.log(`[VAR]   expression="${varConfig.expression}" → ${value}`);
        } else {
          value = 0;
        }
        break;

      case "metadata":
        // Load from player metadata
        console.log(`[VAR] → Metadata type`);
        if (varConfig.key) {
          const metadata = await playerMetadata.getPlayerMetadata(varConfig.key);
          value = metadata ?? varConfig.default ?? 0;
        } else {
          value = varConfig.default ?? 0;
        }
        console.log(`[VAR]   value = ${value}`);
        break;

      case "scene_metadata":
        // Load from scene metadata
        console.log(`[VAR] → Scene metadata type`);
        if (varConfig.key) {
          const metadata = await sceneMetadata.getSceneMetadataValue(varConfig.key);
          value = metadata ?? varConfig.default ?? 0;
        } else {
          value = varConfig.default ?? 0;
        }
        console.log(`[VAR]   value = ${value}`);
        break;

      case "token_property":
        // Load from selected token property (future enhancement)
        console.log(`[VAR] → Token property type (not implemented)`);
        value = varConfig.default ?? 0;
        break;

      case "gsheet":
        // Load from Google Sheets
        console.log(`[VAR] → Explicit gsheet type`);
        value = await resolveGoogleSheetsVariable(varName, varConfig);
        break;

      default:
        console.warn(`[VAR] ✗ Unknown variable type for "${varName}": ${varConfig.type}`);
        value = varConfig.default ?? 0;
    }

    // ⚠️ NO CACHING - Always return fresh values
    console.log(`[VAR] ✓ "${varName}" → ${value}`);
    return value;
  } catch (error) {
    console.error(`Error resolving variable "${varName}":`, error);
    return varConfig.default ?? 0;
  }
}

/**
 * Resolve all global variables
 * @param {Object} globalConfig - Global configuration from config
 * @returns {Promise<Object>} Resolved global variables
 */
export async function resolveGlobalVariables(globalConfig) {
  console.log("\n[GLOBAL] Resolving global variables...");
  console.log("[GLOBAL] globalConfig:", globalConfig);
  
  if (!globalConfig?.variables) {
    console.log("[GLOBAL] No variables found");
    return {};
  }

  const resolved = {};

  // Process all global variables
  for (const [varName, varConfig] of Object.entries(globalConfig.variables)) {
    console.log(`[GLOBAL] Processing variable: ${varName}`);
    resolved[varName] = await resolveVariable(varName, varConfig, {}, resolved);
  }

  console.log("[GLOBAL] ✓ All global variables resolved:", resolved);
  return resolved;
}

/**
 * Resolve all variables for a specific page
 * @param {Object} pageConfig - Page configuration
 * @param {Object} globalVariables - Resolved global variables
 * @returns {Promise<Object>} Resolved page variables
 */
export async function resolvePageVariables(pageConfig, globalVariables = {}) {
  console.log(`\n[PAGE] Resolving page variables for "${pageConfig.id}"...`);
  console.log("[PAGE] pageConfig.variables:", pageConfig?.variables);
  
  if (!pageConfig?.variables) {
    console.log("[PAGE] No variables found, returning global variables only");
    return { ...globalVariables };
  }

  const resolved = { ...globalVariables };

  // Process all page variables
  for (const [varName, varConfig] of Object.entries(pageConfig.variables)) {
    console.log(`[PAGE] Processing variable: ${varName}`);
    resolved[varName] = await resolveVariable(varName, varConfig, globalVariables, resolved);
  }

  console.log(`[PAGE] ✓ Page "${pageConfig.id}" variables resolved:`, resolved);
  return resolved;
}

/**
 * Evaluate an expression with given variable scope
 * @param {string} expression - Expression to evaluate
 * @param {Object} scope - Variable scope
 * @returns {any} Evaluated result
 */
export function evaluateExpression(expression, scope = {}) {
  try {
    const result = math.evaluate(expression, scope);
    console.log(`Evaluated "${expression}" → ${result}`);
    return result;
  } catch (error) {
    console.error(`Error evaluating expression "${expression}":`, error);
    return expression; // Return as string if can't evaluate
  }
}

/**
 * Clear the variable cache
 */
export function clearVariableCache() {
  variableCache.clear();
  console.log("Variable cache cleared");
}

/**
 * Get current cache state
 * @returns {Object} Current cache contents
 */
export function getCacheState() {
  return Object.fromEntries(variableCache);
}

/**
 * Update a variable value in cache
 * @param {string} varName - Variable name
 * @param {any} value - New value
 */
export function updateVariableCache(varName, value) {
  variableCache.set(varName, value);
  console.log(`Variable "${varName}" cache updated to:`, value);
}

export default {
  resolveGlobalVariables,
  resolvePageVariables,
  evaluateExpression,
  clearVariableCache,
  getCacheState,
  updateVariableCache,
};
