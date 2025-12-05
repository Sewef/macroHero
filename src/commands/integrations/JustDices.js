/**
 * JustDices Integration
 * Handles communication with the JustDices extension via broadcast API
 */

import OBR from "@owlbear-rodeo/sdk";

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
 * Get sender information
 * @returns {Promise<Object>} Sender object with id, name, color, role
 */
async function getSender() {
  const sender = {
    id: await OBR.player.getId(),
    name: await OBR.player.getName(),
    color: await OBR.player.getColor(),
    role: await OBR.player.getRole(),
  };
  return sender;
}

/**
 * Send a roll to the JustDices log
 * @param {Object} sender - Sender information
 * @param {Object} text - Text object with roll details
 * @returns {Promise<void>}
 */
async function sendToLog(sender, text) {
  await OBR.broadcast.sendMessage(
    "justdices.dice-roll",
    { sender, user: sender.name, text },
    { destination: "ALL" }
  );
}

/**
 * Roll dice using JustDices API
 * @param {string} expression - Dice formula (e.g., "1d20+5", "3d6")
 * @param {boolean|Object} hiddenOrOptions - Whether roll is hidden, or options object
 * @param {boolean} hiddenOrOptions.hidden - Whether roll is hidden
 * @param {boolean} hiddenOrOptions.showInLogs - Whether to show in JustDices logs (default: true)
 * @param {number} hiddenOrOptions.timeoutMs - Response timeout in milliseconds (default: 5000)
 * @returns {Promise<Object>} Roll result with expression, rolls, total, data
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
  const waitResponse = new Promise((resolve, reject) => {
    const handler = (evt) => {
      const res = evt.data;
      if (!res) return;
      
      // Check if this response matches our request
      if (res.callId !== callId || res.requesterId !== requesterId) {
        return;
      }

      clearTimeout(timeoutId);
      if (res.ok) {
        resolve(res);
      } else {
        reject(new Error(res.error || "Unknown JustDices error"));
      }
    };

    const unsubscribe = OBR.broadcast.onMessage("justdices.api.response", handler);
    
    // Setup timeout
    timeoutId = setTimeout(() => {
      unsubscribe();
      reject(new Error("JustDices API timeout"));
    }, timeoutMs);
  });

  // Send request
  await OBR.broadcast.sendMessage(
    "justdices.api.request",
    { callId, expression: finalExpression, showInLogs, requesterId },
    { destination: "ALL" }
  );

  return waitResponse;
}

/**
 * Roll dice and get full result data
 * @param {string} expression - Dice formula
 * @param {boolean} hidden - Whether roll is hidden
 * @returns {Promise<Object>} Full roll result data
 */
export async function rollDice(expression, hidden = false) {
  const result = await roll(expression, hidden);
  return result.data;
}

/**
 * Roll dice and get just the total
 * @param {string} expression - Dice formula
 * @param {boolean} hidden - Whether roll is hidden
 * @returns {Promise<number>} Roll total
 */
export async function rollDiceTotal(expression, hidden = false) {
  const result = await roll(expression, hidden);
  return result.data?.total;
}

/**
 * Roll dice silently (without showing in logs)
 * @param {string} expression - Dice formula
 * @param {boolean} hidden - Whether roll is hidden
 * @returns {Promise<Object>} Roll result
 */
export async function rollDiceSilent(expression, hidden = false) {
  return roll(expression, { hidden, showInLogs: false });
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
  rollDice,
  rollDiceTotal,
  rollDiceSilent,
};
