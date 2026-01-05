/**
 * JustDices Integration
 * Handles communication with the JustDices extension via broadcast API
 */

import OBR from "@owlbear-rodeo/sdk";
import { isDebugEnabled } from "../../debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('JustDices') && console.log(...args);
const debugError = (...args) => isDebugEnabled('JustDices') && console.error(...args);
const debugWarn = (...args) => isDebugEnabled('JustDices') && console.warn(...args);

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

  let timeoutId;
  let unsubscribe;
  
  const waitResponse = new Promise((resolve, reject) => {
    const handler = (evt) => {
      const res = evt.data;
      if (!res) return;
      
      // Check if this response matches our request
      if (res.callId !== callId || res.requesterId !== requesterId) {
        return;
      }

      clearTimeout(timeoutId);
      if (unsubscribe) unsubscribe();
      
      if (res.ok) {
        resolve(res);
      } else {
        reject(new Error(res.error || "Unknown JustDices error"));
      }
    };

    unsubscribe = OBR.broadcast.onMessage("justdices.api.response", handler);
    
    // Setup timeout
    timeoutId = setTimeout(() => {
      if (unsubscribe) unsubscribe();
      reject(new Error(`JustDices API timeout (${timeoutMs}ms) for expression: ${finalExpression}`));
    }, timeoutMs);
  });

  try {
    // Send request
    await OBR.broadcast.sendMessage(
      "justdices.api.request",
      { callId, expression: finalExpression, showInLogs, requesterId },
      { destination: "LOCAL" }
    );

    const response = await waitResponse;
    return response.data?.total;
  } catch (error) {
    debugError("[JustDices] Roll failed:", error.message);
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

  let timeoutId;
  let unsubscribe;
  
  const waitResponse = new Promise((resolve, reject) => {
    const handler = (evt) => {
      const res = evt.data;
      if (!res) return;
      
      // Check if this response matches our request
      if (res.callId !== callId || res.requesterId !== requesterId) {
        return;
      }

      clearTimeout(timeoutId);
      if (unsubscribe) unsubscribe();
      
      if (res.ok) {
        resolve(res);
      } else {
        reject(new Error(res.error || "Unknown JustDices error"));
      }
    };

    unsubscribe = OBR.broadcast.onMessage("justdices.api.response", handler);
    
    // Setup timeout
    timeoutId = setTimeout(() => {
      if (unsubscribe) unsubscribe();
      reject(new Error(`JustDices API timeout (${timeoutMs}ms) for expression: ${finalExpression}`));
    }, timeoutMs);
  });

  try {
    // Send request
    await OBR.broadcast.sendMessage(
      "justdices.api.request",
      { callId, expression: finalExpression, showInLogs, requesterId },
      { destination: "LOCAL" }
    );

    return await waitResponse;
  } catch (error) {
    debugError("[JustDices] getRollObject failed:", error.message);
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

/**
 * Generate a unique call ID for API requests
 * @returns {string} Unique call ID
 */
function generateCallId() {
  return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export default {
  roll,
  getRollObject,
  rollSilent,
  getRollObjectSilent,
};
