/**
 * JustDices Integration
 * Handles communication with the JustDices extension via broadcast API
 */

import OBR from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../../debugMode.js";
import { broadcastRequest } from "../shared/sdkHelpers.js";

// Debug mode constants
const logger = createDebugLogger("JustDices");


let SELF_ID_PROMISE = null;

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
 * Generate a unique call ID for API requests
 * @returns {string} Unique call ID
 */
function generateCallId() {
  return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Roll dice using JustDices API and return the total
 * @param {string} expression - Dice formula (e.g., "1d20+5", "3d6")
 * @param {boolean|Object} hiddenOrOptions - Whether roll is hidden, or options object
 * @param {boolean} hiddenOrOptions.hidden - Whether roll is hidden
 * @param {boolean} hiddenOrOptions.showInLogs - Whether to show in JustDices logs (default: true)
 * @param {number} hiddenOrOptions.timeoutMs - Response timeout in milliseconds (default: 5000)
 * @returns {Promise<number>} Roll total
 */
export async function roll(expression, hiddenOrOptions = {}) {
  // Normalize options
  let options = {};
  if (typeof hiddenOrOptions === "boolean") {
    options.hidden = hiddenOrOptions;
  } else if (typeof hiddenOrOptions === "object") {
    options = hiddenOrOptions;
  }

  const { hidden = false, showInLogs = true, timeoutMs = 5000 } = options;
  const callId = generateCallId();
  const requesterId = await getSelfId();

  // Adjust expression for hidden rolls
  let finalExpression = expression;
  if (hidden && !expression.startsWith("/")) {
    finalExpression = `/${expression}`;
  }

  try {
    const payload = { callId, expression: finalExpression, showInLogs, requesterId };
    
    const result = await broadcastRequest(
      "justdices.api.request",
      "justdices.api.response",
      payload,
      { destination: "LOCAL", timeoutMs }
    );

    if (result.success && result.data?.ok) {
      return result.data.data?.total;
    } else {
      const error = result.data?.error || result.error || "Unknown JustDices error";
      throw new Error(error);
    }
  } catch (error) {
    logger.error("[JustDices] Roll failed:", error.message);
    throw error;
  }
}

/**
 * Roll dice and get full result object
 * @param {string} expression - Dice formula
 * @param {boolean|Object} hiddenOrOptions - Whether roll is hidden, or options object
 * @returns {Promise<Object>} Full roll result with expression, rolls, total, data
 */
export async function getRollObject(expression, hiddenOrOptions = {}) {
  // Normalize options
  let options = {};
  if (typeof hiddenOrOptions === "boolean") {
    options.hidden = hiddenOrOptions;
  } else if (typeof hiddenOrOptions === "object") {
    options = hiddenOrOptions;
  }

  const { hidden = false, showInLogs = true, timeoutMs = 5000 } = options;
  const callId = generateCallId();
  const requesterId = await getSelfId();

  // Adjust expression for hidden rolls
  let finalExpression = expression;
  if (hidden && !expression.startsWith("/")) {
    finalExpression = `/${expression}`;
  }

  try {
    const payload = { callId, expression: finalExpression, showInLogs, requesterId };
    
    const result = await broadcastRequest(
      "justdices.api.request",
      "justdices.api.response",
      payload,
      { destination: "LOCAL", timeoutMs }
    );

    if (result.success && result.data?.ok) {
      return result.data;
    } else {
      const error = result.data?.error || result.error || "Unknown JustDices error";
      throw new Error(error);
    }
  } catch (error) {
    logger.error("[JustDices] getRollObject failed:", error.message);
    throw error;
  }
}

/**
 * Roll dice silently (without showing in logs) and return total
 * @param {string} expression - Dice formula
 * @param {boolean} hidden - Whether roll is hidden
 * @returns {Promise<number>} Roll total
 */
export async function rollSilent(expression, hidden = false) {
  return roll(expression, { hidden, showInLogs: false });
}

/**
 * Roll dice silently and get full result object
 * @param {string} expression - Dice formula
 * @param {boolean} hidden - Whether roll is hidden
 * @returns {Promise<Object>} Full roll result object
 */
export async function getRollObjectSilent(expression, hidden = false) {
  return getRollObject(expression, { hidden, showInLogs: false });
}

export default {
  roll,
  getRollObject,
  rollSilent,
  getRollObjectSilent,
};

