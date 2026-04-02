/**
 * DicePlus Integration
 * Handles communication with the DicePlus extension via broadcast API
 * Supports advanced dice notation (2d20kh1+5, 3d6!e, etc.)
 */

import OBR from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../../debugMode.js";
import * as BroadcastHelpers from "../shared/broadcastHelpers.js";

// Debug mode constants
const logger = createDebugLogger("DicePlus");


// Extension identifier for dedicated result/error channels
const EXTENSION_SOURCE = "macro-hero";

// DicePlus Broadcast channels
const CHANNELS = {
  READY_CHECK: "dice-plus/isReady",
  ROLL_REQUEST: "dice-plus/roll-request",
  ROLL_RESULT: `${EXTENSION_SOURCE}/roll-result`,
  ROLL_ERROR: `${EXTENSION_SOURCE}/roll-error`
};

let SELF_ID_PROMISE = null;
let PLAYER_NAME_PROMISE = null;

/**
 * Get current player ID (cached)
 * @returns {Promise<string>} Player ID
 */
async function getSelfId() {
  if (!SELF_ID_PROMISE) {
    SELF_ID_PROMISE = OBR.player.getId();
  }
  return SELF_ID_PROMISE;
}

/**
 * Get current player name (cached)
 * @returns {Promise<string>} Player name
 */
async function getPlayerName() {
  if (!PLAYER_NAME_PROMISE) {
    PLAYER_NAME_PROMISE = OBR.player.getName();
  }
  return PLAYER_NAME_PROMISE;
}

/**
 * Generate a unique roll ID for tracking
 * @returns {string} Unique roll ID
 */
function generateRollId() {
  return `roll_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Check if DicePlus extension is available and ready
 * @param {number} timeoutMs - Timeout in milliseconds (default: 3000)
 * @returns {Promise<boolean>} True if DicePlus is ready, false otherwise
 */
export async function isReady(timeoutMs = 1000) {
  const requestId = crypto.randomUUID ? crypto.randomUUID() : generateRollId();

  return new Promise((resolve) => {
    let unsubscribe;
    let timeoutHandle;

    try {
      // Listen for ready response
      unsubscribe = OBR.broadcast.onMessage(CHANNELS.READY_CHECK, (event) => {
        const data = event.data;

        // Check if this is a response (has 'ready' field) and matches our request
        if (data.ready === true && data.requestId === requestId) {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (unsubscribe) unsubscribe();
          logger.log("[DicePlus] Ready check confirmed");
          resolve(true);
        }
      });

      // Send ready check request
      OBR.broadcast.sendMessage(CHANNELS.READY_CHECK, {
        requestId,
        timestamp: Date.now()
      }, { destination: 'ALL' });

      // Timeout after specified time
      timeoutHandle = setTimeout(() => {
        if (unsubscribe) unsubscribe();
        logger.warn("[DicePlus] Ready check timeout - DicePlus may not be installed");
        resolve(false);
      }, timeoutMs);
    } catch (error) {
      logger.error("[DicePlus] Error checking ready status:", error);
      if (unsubscribe) unsubscribe();
      resolve(false);
    }
  });
}

/**
 * Send a roll request to DicePlus and wait for result
 * @param {string} diceNotation - Dice notation (e.g., "2d20kh1+5", "4d6dl1", "3d6!e")
 * @param {Object} options - Roll options
 * @param {string} options.rollTarget - Who sees the roll: 'everyone' | 'self' | 'dm' | 'gm_only' (default: 'everyone')
 * @param {boolean} options.showResults - Show default DicePlus popup (default: true)
 * @param {number} options.timeoutMs - Response timeout in milliseconds (default: 15000)
 * @returns {Promise<Object>} Roll result object with totalValue and groups
 */
export async function roll(diceNotation, options = {}) {
  const {
    rollTarget = 'everyone',
    showResults = true,
    timeoutMs = 15000
  } = options;

  const rollId = generateRollId();
  const playerId = await getSelfId();
  const playerName = await getPlayerName();

  return new Promise((resolve, reject) => {
    let resultUnsubscribe;
    let errorUnsubscribe;
    let timeoutHandle;

    try {
      // Listen for roll result
      resultUnsubscribe = OBR.broadcast.onMessage(CHANNELS.ROLL_RESULT, (event) => {
        const data = event.data;

        if (data.rollId === rollId) {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (resultUnsubscribe) resultUnsubscribe();
          if (errorUnsubscribe) errorUnsubscribe();

          logger.log("[DicePlus] Roll result received:", {
            notation: diceNotation,
            totalValue: data.result?.totalValue,
            groups: data.result?.groups?.length || 0
          });

          resolve(data.result);
        }
      });

      // Listen for roll error
      errorUnsubscribe = OBR.broadcast.onMessage(CHANNELS.ROLL_ERROR, (event) => {
        const data = event.data;

        if (data.rollId === rollId) {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (resultUnsubscribe) resultUnsubscribe();
          if (errorUnsubscribe) errorUnsubscribe();

          const errorMsg = data.error || "Unknown DicePlus error";
          logger.error("[DicePlus] Roll error:", errorMsg);
          reject(new Error(`DicePlus error: ${errorMsg}`));
        }
      });

      // Send roll request
      const payload = {
        rollId,
        playerId,
        playerName,
        rollTarget,
        diceNotation,
        showResults,
        timestamp: Date.now(),
        source: EXTENSION_SOURCE
      };

      logger.log("[DicePlus] Sending roll request:", {
        notation: diceNotation,
        rollTarget,
        showResults
      });

      OBR.broadcast.sendMessage(CHANNELS.ROLL_REQUEST, payload, { destination: 'ALL' });

      // Timeout
      timeoutHandle = setTimeout(() => {
        if (resultUnsubscribe) resultUnsubscribe();
        if (errorUnsubscribe) errorUnsubscribe();
        const timeoutMsg = `DicePlus roll timeout after ${timeoutMs}ms - extension may not be responding`;
        logger.error("[DicePlus]", timeoutMsg);
        reject(new Error(timeoutMsg));
      }, timeoutMs);
    } catch (error) {
      if (resultUnsubscribe) resultUnsubscribe();
      if (errorUnsubscribe) errorUnsubscribe();
      if (timeoutHandle) clearTimeout(timeoutHandle);
      logger.error("[DicePlus] Failed to send roll request:", error);
      reject(error);
    }
  });
}

/**
 * Roll dice and return only the total value
 * @param {string} diceNotation - Dice notation (e.g., "2d20kh1+5")
 * @param {Object} options - Roll options (see roll() for details)
 * @returns {Promise<number>} Roll total value
 */
export async function rollTotal(diceNotation, options = {}) {
  try {
    const result = await roll(diceNotation, options);
    return result.totalValue;
  } catch (error) {
    logger.error("[DicePlus] rollTotal failed:", error.message);
    throw error;
  }
}

/**
 * Roll dice for a specific player who can see results
 * @param {string} diceNotation - Dice notation
 * @param {'everyone' | 'self' | 'dm' | 'gm_only'} visibility - Who sees the roll
 * @param {Object} options - Additional roll options
 * @returns {Promise<Object>} Roll result object
 */
export async function rollSecret(diceNotation, visibility = 'self', options = {}) {
  return roll(diceNotation, {
    ...options,
    rollTarget: visibility,
    showResults: false
  });
}

/**
 * Roll dice and get full result with groups and details
 * @param {string} diceNotation - Dice notation
 * @param {Object} options - Roll options
 * @returns {Promise<Object>} Full roll result with groups array
 */
export async function getRollObject(diceNotation, options = {}) {
  return roll(diceNotation, options);
}

/**
 * Parse a roll result and extract information by description or dice model
 * @param {Object} rollResult - Roll result object from roll()
 * @param {string} searchTerm - Description or dice model name to find
 * @returns {Object|null} Matching group or null
 */
export function getGroupByDescription(rollResult, searchTerm) {
  if (!rollResult?.groups) {
    logger.warn("[DicePlus] Invalid roll result - no groups");
    return null;
  }

  return rollResult.groups.find(group =>
    group.description === searchTerm || group.diceModel === searchTerm
  ) || null;
}

/**
 * Get all dice values from a result group
 * @param {Object} group - Result group from rollResult.groups
 * @returns {number[]} Array of dice values (kept and dropped)
 */
export function getDiceValues(group) {
  if (!group?.dice) {
    return [];
  }
  return group.dice.map(d => d.value);
}

/**
 * Get only kept dice values from a result group
 * @param {Object} group - Result group from rollResult.groups
 * @returns {number[]} Array of kept dice values
 */
export function getKeptDiceValues(group) {
  if (!group?.dice) {
    return [];
  }
  return group.dice.filter(d => d.kept).map(d => d.value);
}

/**
 * Format a roll result for display
 * @param {Object} rollResult - Roll result object
 * @returns {string} Human-readable roll result
 */
export function formatResult(rollResult) {
  if (!rollResult) {
    return "No result";
  }

  if (rollResult.rollSummary) {
    return rollResult.rollSummary;
  }

  if (rollResult.totalValue !== undefined) {
    return `Total: ${rollResult.totalValue}`;
  }

  return "Unknown result";
}

/**
 * Listen for all DicePlus roll results from this extension
 * Useful for logging or tracking rolls
 * @param {Function} callback - Callback function(result) called for each roll
 * @returns {Function} Unsubscribe function
 */
export function onRollResult(callback) {
  if (typeof callback !== 'function') {
    logger.error("[DicePlus] onRollResult: callback must be a function");
    throw new Error("Callback must be a function");
  }

  try {
    const unsubscribe = OBR.broadcast.onMessage(CHANNELS.ROLL_RESULT, (event) => {
      try {
        callback(event.data);
      } catch (error) {
        logger.error("[DicePlus] Error in onRollResult callback:", error);
      }
    });

    logger.log("[DicePlus] Roll result listener registered");
    return unsubscribe;
  } catch (error) {
    logger.error("[DicePlus] Failed to register roll result listener:", error);
    throw error;
  }
}

/**
 * Listen for all DicePlus roll errors
 * @param {Function} callback - Callback function(error) called for each error
 * @returns {Function} Unsubscribe function
 */
export function onRollError(callback) {
  if (typeof callback !== 'function') {
    logger.error("[DicePlus] onRollError: callback must be a function");
    throw new Error("Callback must be a function");
  }

  try {
    const unsubscribe = OBR.broadcast.onMessage(CHANNELS.ROLL_ERROR, (event) => {
      try {
        callback(event.data);
      } catch (error) {
        logger.error("[DicePlus] Error in onRollError callback:", error);
      }
    });

    logger.log("[DicePlus] Roll error listener registered");
    return unsubscribe;
  } catch (error) {
    logger.error("[DicePlus] Failed to register roll error listener:", error);
    throw error;
  }
}

