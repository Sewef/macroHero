/**
 * SDK Helpers
 * Extended Owlbear Rodeo SDK wrapper that maintains SDK syntax
 * Usage: Owlbear.notification.show(...) instead of OBR.notification.show(...)
 */

import OBR from "@owlbear-rodeo/sdk";
import { createDebugLogger } from "../../debugMode.js";

// Debug mode constants
const logger = createDebugLogger("sdkHelpers");


// ============================================================================
// NOTIFICATION TYPES
// ============================================================================

/**
 * Notification variant constants (shows as icons/colors in UI)
 */
export const NOTIFICATION_VARIANT = {
  DEFAULT: "DEFAULT",
  ERROR: "ERROR",
  INFO: "INFO",
  SUCCESS: "SUCCESS",
  WARNING: "WARNING"
};

// ============================================================================
// NOTIFICATION CONVENIENCE METHODS
// ============================================================================

/**
 * Show a success notification
 * @param {string} message - Notification message
 * @returns {Promise<string>} Notification ID
 */
async function success(message) {
  if (!message || typeof message !== 'string') {
    logger.error('[sdkHelpers] notification.success: message must be a non-empty string');
    throw new Error('Notification message is required');
  }
  
  try {
    logger.log(`[sdkHelpers] Showing success notification:`, message);
    const id = await OBR.notification.show(message, NOTIFICATION_VARIANT.SUCCESS);
    return id;
  } catch (error) {
    logger.error('[sdkHelpers] Error showing success notification:', error.message);
    throw error;
  }
}

/**
 * Show a warning notification
 * @param {string} message - Notification message
 * @returns {Promise<string>} Notification ID
 */
async function warning(message) {
  if (!message || typeof message !== 'string') {
    logger.error('[sdkHelpers] notification.warning: message must be a non-empty string');
    throw new Error('Notification message is required');
  }
  
  try {
    logger.log(`[sdkHelpers] Showing warning notification:`, message);
    const id = await OBR.notification.show(message, NOTIFICATION_VARIANT.WARNING);
    return id;
  } catch (error) {
    logger.error('[sdkHelpers] Error showing warning notification:', error.message);
    throw error;
  }
}

/**
 * Show an error notification
 * @param {string} message - Notification message
 * @returns {Promise<string>} Notification ID
 */
async function error(message) {
  if (!message || typeof message !== 'string') {
    logger.error('[sdkHelpers] notification.error: message must be a non-empty string');
    throw new Error('Notification message is required');
  }
  
  try {
    logger.log(`[sdkHelpers] Showing error notification:`, message);
    const id = await OBR.notification.show(message, NOTIFICATION_VARIANT.ERROR);
    return id;
  } catch (error) {
    logger.error('[sdkHelpers] Error showing error notification:', error.message);
    throw error;
  }
}

// ============================================================================
// OWLBEAR SDK WRAPPER
// ============================================================================

/**
 * Enhanced Owlbear SDK interface
 * Maintains same syntax as OBR while adding convenience methods
 * 
 * Usage:
 *   import { Owlbear } from "../shared/sdkHelpers.js";
 *   
 *   // Standard SDK syntax
 *   const id = await Owlbear.notification.show("Hello!");
 *   const id2 = await Owlbear.notification.show("Success!", "SUCCESS");
 *   
 *   // Convenience methods
 *   const id3 = await Owlbear.notification.success("OpÃ©ration rÃ©ussie!");
 *   const id4 = await Owlbear.notification.warning("Attention!");
 *   const id5 = await Owlbear.notification.error("Erreur!");
 */
export const Owlbear = {
  ...OBR,
  notification: {
    // Standard SDK method
    show: (message, variant) => OBR.notification.show(message, variant),
    // Convenience methods
    success,
    warning,
    error
  }
};

export default {
  Owlbear,
  NOTIFICATION_VARIANT
};

