/**
 * Broadcast Helpers for Owlbear Rodeo SDK
 * Provides utilities for sending and receiving broadcast messages
 * Handles retries, destination management, and message tracking
 */

import OBR from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../../debugMode.js";

// Debug mode constants
const logger = createDebugLogger("Broadcast");


// Message type constants
export const BROADCAST_DESTINATIONS = {
    LOCAL: "LOCAL",      // Only to local player
    ROOM: "ROOM",        // To all players in the room
    ALL: "ALL"           // To all (including observers)
};

// Retry configuration
const DEFAULT_RETRY_CONFIG = {
    maxAttempts: 3,
    destinations: ["LOCAL", "ROOM", "ALL"],  // Try in this order
    delayMs: 100
};

/**
 * Send a broadcast message with automatic retry fallback
 * Tries sending to preferred destination first, then falls back to others
 * 
 * @param {string} messageId - Unique identifier for the message (e.g., "myapp.event.name")
 * @param {*} data - Data payload to send
 * @param {Object} [options] - Send options
 * @param {string} [options.destination="LOCAL"] - Primary destination (LOCAL|ROOM|ALL)
 * @param {number} [options.maxAttempts] - Maximum retry attempts
 * @param {number} [options.delayMs] - Delay between retries in milliseconds
 * @param {boolean} [options.noRetry=false] - Disable automatic retry fallback
 * @returns {Promise<{success: boolean, destination: string, attempts: number, error?: string}>}
 */
export async function broadcastMessage(messageId, data, options = {}) {
    const {
        destination = BROADCAST_DESTINATIONS.LOCAL,
        maxAttempts = DEFAULT_RETRY_CONFIG.maxAttempts,
        delayMs = DEFAULT_RETRY_CONFIG.delayMs,
        noRetry = false
    } = options;

    if (!messageId || typeof messageId !== 'string') {
        const err = "Message ID is required and must be a string";
        logger.error("[Broadcast] sendMessage:", err);
        throw new Error(err);
    }

    // If no retry, try only the specified destination
    const destinations = noRetry ? [destination] : DEFAULT_RETRY_CONFIG.destinations;
    
    // Try preferred destination first
    if (destinations[0] !== destination) {
        destinations.unshift(destination);
        destinations.splice(destinations.lastIndexOf(destination), 1); // Remove duplicate
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        for (const dest of destinations) {
            try {
                await OBR.broadcast.sendMessage(messageId, data, { destination: dest });
                logger.log(`[Broadcast] Message sent to ${dest}`, { messageId, dataSize: JSON.stringify(data).length });
                return {
                    success: true,
                    destination: dest,
                    attempts: attempt + 1
                };
            } catch (error) {
                const errorMsg =  error && error.error ? error.error : String(error);
                logger.warn(`[Broadcast] Failed to send ${messageId} to ${dest} (attempt ${attempt + 1}/${maxAttempts}):`, errorMsg);

                if (attempt < maxAttempts - 1 && dest !== destinations[destinations.length - 1]) {
                    // Try next destination immediately or wait before retrying
                    continue;
                } else if (attempt < maxAttempts - 1) {
                    // Last destination in this attempt, wait before retrying all
                    await delay(delayMs);
                }
            }
        }
    }

    // All attempts failed
    const finalError = `Failed to broadcast message "${messageId}" after ${maxAttempts} attempts`;
    logger.error("[Broadcast]", finalError);
    return {
        success: false,
        destination: null,
        attempts: maxAttempts,
        error: finalError
    };
}

/**
 * Listen for broadcast messages
 * Returns an unsubscribe function to stop listening
 * 
 * @param {string} messageId - Message ID to listen for
 * @param {Function} callback - Callback function(event) where event.data contains the payload
 * @param {Object} [options] - Listen options
 * @param {boolean} [options.returnUnsub=true] - Return unsubscribe function
 * @returns {Function|void} Unsubscribe function (if returnUnsub=true)
 */
export function broadcastListener(messageId, callback, options = {}) {
    const { returnUnsub = true } = options;

    if (!messageId || typeof messageId !== 'string') {
        logger.error("[Broadcast] Listener: Message ID is required and must be a string");
        throw new Error("Message ID is required");
    }

    if (!callback || typeof callback !== 'function') {
        logger.error("[Broadcast] Listener: Callback must be a function");
        throw new Error("Callback must be a function");
    }

    try {
        const unsubscribe = OBR.broadcast.onMessage(messageId, (event) => {
            try {
                logger.log(`[Broadcast] Received message "${messageId}":`, event.data);
                callback(event);
            } catch (error) {
                logger.error(`[Broadcast] Error in callback for "${messageId}":`, error);
            }
        });

        logger.log(`[Broadcast] Listener registered for "${messageId}"`);
        return returnUnsub ? unsubscribe : undefined;
    } catch (error) {
        logger.error(`[Broadcast] Failed to register listener for "${messageId}":`, error);
        throw error;
    }
}

/**
 * Send a broadcast message and wait for a response
 * Useful for request-response patterns
 * 
 * @param {string} requestId - ID for the request message
 * @param {string} responseId - ID for the response message
 * @param {*} data - Data to send
 * @param {Object} [options] - Options
 * @param {number} [options.timeoutMs=5000] - Timeout waiting for response
 * @param {string} [options.destination="LOCAL"] - Broadcast destination
 * @param {boolean} [options.noRetry=false] - Disable retry
 * @returns {Promise<{success: boolean, data: *, error?: string, broadcastResult: Object}>}
 */
export async function broadcastRequest(requestId, responseId, data, options = {}) {
    const { timeoutMs = 5000, destination = BROADCAST_DESTINATIONS.LOCAL, noRetry = false } = options;

    let unsubscribe;
    let timeoutHandle;
    
    const responsePromise = new Promise((resolve, reject) => {
        // Listen for response
        unsubscribe = OBR.broadcast.onMessage(responseId, (event) => {
            logger.log(`[Broadcast] Received response to "${requestId}":`, event.data);
            if (timeoutHandle) clearTimeout(timeoutHandle);
            resolve(event.data);
        });

        // Timeout
        timeoutHandle = setTimeout(() => {
            reject(new Error(`Response timeout for "${responseId}" after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    try {
        // Send request
        const broadcastResult = await broadcastMessage(requestId, data, { destination, noRetry });

        if (!broadcastResult.success) {
            throw new Error(broadcastResult.error);
        }

        // Wait for response
        const responseData = await responsePromise;
        logger.log(`[Broadcast] Request "${requestId}" completed successfully`);

        return {
            success: true,
            data: responseData,
            broadcastResult
        };
    } catch (error) {
        logger.error(`[Broadcast] Request "${requestId}" failed:`, error.message);
        return {
            success: false,
            error: error.message,
            broadcastResult: null
        };
    } finally {
        // Cleanup listener and timeout
        if (unsubscribe) {
            unsubscribe();
        }
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}

/**
 * Broadcast to room (all connected players)
 * Convenience wrapper for room-wide broadcasts
 * 
 * @param {string} messageId - Message ID
 * @param {*} data - Data to broadcast
 * @param {Object} [options] - Options
 * @returns {Promise<{success: boolean, destination: string, attempts: number, error?: string}>}
 */
export async function broadcastToRoom(messageId, data, options = {}) {
    return broadcastMessage(messageId, data, {
        ...options,
        destination: BROADCAST_DESTINATIONS.ROOM
    });
}

/**
 * Broadcast to current player only
 * Convenience wrapper for local-only broadcasts
 * 
 * @param {string} messageId - Message ID
 * @param {*} data - Data to broadcast
 * @param {Object} [options] - Options
 * @returns {Promise<{success: boolean, destination: string, attempts: number, error?: string}>}
 */
export async function broadcastLocal(messageId, data, options = {}) {
    return broadcastMessage(messageId, data, {
        ...options,
        destination: BROADCAST_DESTINATIONS.LOCAL,
        noRetry: true  // Local should not retry to other destinations
    });
}

/**
 * Broadcast to all (including observers)
 * Convenience wrapper for broadcasting to everyone
 * 
 * @param {string} messageId - Message ID
 * @param {*} data - Data to broadcast
 * @param {Object} [options] - Options
 * @returns {Promise<{success: boolean, destination: string, attempts: number, error?: string}>}
 */
export async function broadcastAll(messageId, data, options = {}) {
    return broadcastMessage(messageId, data, {
        ...options,
        destination: BROADCAST_DESTINATIONS.ALL
    });
}

/**
 * Setup a message listener that unsubscribes after first message
 * Useful for one-time responses
 * 
 * @param {string} messageId - Message ID to listen for
 * @param {Object} [options] - Options
 * @param {number} [options.timeoutMs=5000] - Timeout in milliseconds
 * @returns {Promise<*>} The message data
 */
export async function broadcastOnce(messageId, options = {}) {
    const { timeoutMs = 5000 } = options;

    return new Promise((resolve, reject) => {
        let unsubscribe;
        let timeoutHandle;

        try {
            unsubscribe = OBR.broadcast.onMessage(messageId, (event) => {
                logger.log(`[Broadcast] One-time listener triggered for "${messageId}"`);
                clearTimeout(timeoutHandle);
                unsubscribe();
                resolve(event.data);
            });

            timeoutHandle = setTimeout(() => {
                logger.warn(`[Broadcast] Timeout waiting for "${messageId}"`);
                unsubscribe();
                reject(new Error(`Timeout waiting for "${messageId}" after ${timeoutMs}ms`));
            }, timeoutMs);
        } catch (error) {
            logger.error(`[Broadcast] Error setting up one-time listener for "${messageId}":`, error);
            reject(error);
        }
    });
}

/**
 * Batch send multiple messages (useful for bulk operations)
 * Attempts to send all messages efficiently
 * 
 * @param {Array<{messageId: string, data: *, options?: Object}>} messages - Array of messages to send
 * @param {Object} [options] - Batch options
 * @param {boolean} [options.stopOnError=false] - Stop if any message fails
 * @returns {Promise<Array>} Array of send results
 */
export async function broadcastBatch(messages, options = {}) {
    const { stopOnError = false } = options;

    if (!Array.isArray(messages)) {
        throw new Error("Messages must be an array");
    }

    const results = [];

    for (const msg of messages) {
        try {
            const result = await broadcastMessage(msg.messageId, msg.data, msg.options);
            results.push(result);

            if (!result.success && stopOnError) {
                logger.warn("[Broadcast] Batch stopped due to error:", result.error);
                break;
            }
        } catch (error) {
            const errorResult = { success: false, error: error.message };
            results.push(errorResult);

            if (stopOnError) {
                break;
            }
        }
    }

    logger.log(`[Broadcast] Batch completed:`, { total: messages.length, successful: results.filter(r => r.success).length });
    return results;
}

/**
 * Utility: Delay function using Promise
 * @private
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

