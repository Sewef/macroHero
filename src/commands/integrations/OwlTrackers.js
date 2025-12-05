/**
 * Owl-Trackers Integration
 * Handles communication with the Owl-Trackers extension for status/condition tracking
 */

/**
 * Get tracked status from Owl-Trackers
 * @param {string} itemId - Item ID to get status for
 * @param {string} statusKey - Status key to retrieve
 * @returns {Promise<any>} Status value
 */
export async function getTrackerStatus(itemId, statusKey) {
  try {
    if (typeof Ext !== 'undefined' && Ext.OwlTrackers) {
      return await Ext.OwlTrackers.getStatus(itemId, statusKey);
    } else {
      console.warn("Owl-Trackers extension not available");
      return null;
    }
  } catch (error) {
    console.error("Failed to get tracker status:", error);
    throw error;
  }
}

/**
 * Set tracked status in Owl-Trackers
 * @param {string} itemId - Item ID
 * @param {string} statusKey - Status key
 * @param {any} value - Value to set
 * @returns {Promise<void>}
 */
export async function setTrackerStatus(itemId, statusKey, value) {
  try {
    if (typeof Ext !== 'undefined' && Ext.OwlTrackers) {
      await Ext.OwlTrackers.setStatus(itemId, statusKey, value);
    } else {
      console.warn("Owl-Trackers extension not available");
    }
  } catch (error) {
    console.error("Failed to set tracker status:", error);
    throw error;
  }
}

/**
 * Update tracker status (increment/decrement)
 * @param {string} itemId - Item ID
 * @param {string} statusKey - Status key
 * @param {number} delta - Amount to change (can be negative)
 * @returns {Promise<void>}
 */
export async function updateTrackerStatus(itemId, statusKey, delta = 1) {
  try {
    const current = await getTrackerStatus(itemId, statusKey);
    const newValue = (current || 0) + delta;
    await setTrackerStatus(itemId, statusKey, newValue);
  } catch (error) {
    console.error("Failed to update tracker status:", error);
    throw error;
  }
}

/**
 * Get all trackers for an item
 * @param {string} itemId - Item ID
 * @returns {Promise<Object>} All tracker statuses
 */
export async function getAllTrackerStatuses(itemId) {
  try {
    if (typeof Ext !== 'undefined' && Ext.OwlTrackers) {
      return await Ext.OwlTrackers.getAllStatus(itemId);
    } else {
      console.warn("Owl-Trackers extension not available");
      return {};
    }
  } catch (error) {
    console.error("Failed to get all tracker statuses:", error);
    throw error;
  }
}

export default {
  getTrackerStatus,
  setTrackerStatus,
  updateTrackerStatus,
  getAllTrackerStatuses
};
