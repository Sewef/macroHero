import OBR from "@owlbear-rodeo/sdk";
import { isDebugEnabled } from "../../debugMode.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('Announcement') && console.log(...args);
const debugError = (...args) => console.error(...args);
const debugWarn = (...args) => console.warn(...args);

/**
 * Announcement Integration
 * Based on dev.sharkbrain.announcement extension
 * Displays visual announcement banners with Markdown support
 */

// Using the same metadata key as the original extension for compatibility
const ANNOUNCEMENT_KEY = "dev.sharkbrain.announcement/bar-1";

/**
 * Set announcement content and visibility
 * @param {string} content - Markdown content to display
 * @param {boolean} active - Whether announcement is visible
 * @returns {Promise<void>}
 */
export async function setAnnouncement(content, active = true) {
    debugLog("Setting announcement", { content, active });
    
    const metadata = await OBR.room.getMetadata();
    
    const announcement = {
        active: active,
        content: content
    };
    
    await OBR.room.setMetadata({
        ...metadata,
        [ANNOUNCEMENT_KEY]: announcement
    });
}

/**
 * Get current announcement configuration
 * @returns {Promise<{active: boolean, content: string} | null>}
 */
export async function getAnnouncement() {
    debugLog("Getting announcement");
    
    const metadata = await OBR.room.getMetadata();
    const announcement = metadata[ANNOUNCEMENT_KEY];
    
    if (!announcement) {
        return null;
    }
    
    return {
        active: announcement.active,
        content: announcement.content
    };
}

/**
 * Remove announcement
 * @returns {Promise<void>}
 */
export async function removeAnnouncementMetadata() {
    debugLog("Removing announcement");
    
    const metadata = await OBR.room.getMetadata();
    delete metadata[ANNOUNCEMENT_KEY];
    
    await OBR.room.setMetadata(metadata);
}

/**
 * Update announcement properties
 * @param {Object} updates - Properties to update
 * @param {string} [updates.content] - New content
 * @param {boolean} [updates.active] - New active state
 * @returns {Promise<void>}
 */
export async function updateAnnouncement(updates) {
    debugLog("Updating announcement", updates);
    
    const current = await getAnnouncement();
    
    if (!current) {
        throw new Error("No announcement to update");
    }
    
    const updated = {
        active: updates.active !== undefined ? updates.active : current.active,
        content: updates.content !== undefined ? updates.content : current.content
    };
    
    await setAnnouncement(updated.content, updated.active);
}

/**
 * Toggle announcement visibility
 * @returns {Promise<boolean>} New active state
 */
export async function toggleAnnouncement() {
    debugLog("Toggling announcement");
    
    const current = await getAnnouncement();
    
    if (!current) {
        throw new Error("No announcement to toggle");
    }
    
    const newActive = !current.active;
    await updateAnnouncement({ active: newActive });
    
    return newActive;
}

/**
 * Show announcement (set active to true)
 * @returns {Promise<void>}
 */
export async function showAnnouncement() {
    await updateAnnouncement({ active: true });
}

/**
 * Hide announcement (set active to false)
 * @returns {Promise<void>}
 */
export async function hideAnnouncement() {
    await updateAnnouncement({ active: false });
}

/**
 * Update only the content
 * @param {string} content - New Markdown content
 * @returns {Promise<void>}
 */
export async function updateContent(content) {
    await updateAnnouncement({ content });
}
