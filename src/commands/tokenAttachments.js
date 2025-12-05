/**
 * Token Attachments Helper
 * Utilities for querying and managing token attachments in Owlbear Rodeo
 */

import OBR from "@owlbear-rodeo/sdk";
import * as ConditionsMarkers from "./integrations/ConditionsMarkers.js";

/**
 * Get all attachments for a token
 * @param {string} tokenId - Token ID
 * @param {Array} allItems - All scene items (optional, will fetch if not provided)
 * @returns {Promise<Array>} Array of attachment items
 */
export async function getTokenAttachments(tokenId, allItems = null) {
  try {
    const items = allItems || await OBR.scene.items.getItems();
    const attachments = items.filter(item => item.attachedTo === tokenId);
    console.log(`[TokenAttachments] Found ${attachments.length} attachments for token ${tokenId}`);
    return attachments;
  } catch (error) {
    console.error("[TokenAttachments] Error fetching attachments:", error);
    return [];
  }
}

/**
 * Get attachments of a specific type
 * @param {string} tokenId - Token ID
 * @param {string} type - Attachment type (e.g., "IMAGE", "SHAPE")
 * @param {Array} allItems - All scene items (optional)
 * @returns {Promise<Array>} Filtered attachments
 */
export async function getAttachmentsByType(tokenId, type, allItems = null) {
  const attachments = await getTokenAttachments(tokenId, allItems);
  return attachments.filter(att => att.type === type);
}

/**
 * Get attachments by name pattern
 * @param {string} tokenId - Token ID
 * @param {string|RegExp} pattern - Name pattern to match
 * @param {Array} allItems - All scene items (optional)
 * @returns {Promise<Array>} Matching attachments
 */
export async function getAttachmentsByName(tokenId, pattern, allItems = null) {
  const attachments = await getTokenAttachments(tokenId, allItems);
  const regex = typeof pattern === "string" ? new RegExp(pattern, "i") : pattern;
  return attachments.filter(att => regex.test(att.name));
}

/**
 * Get attachments with specific metadata
 * @param {string} tokenId - Token ID
 * @param {string} metadataKey - Metadata key to search for (e.g., "keegan.dev.condition-markers/metadata")
 * @param {Array} allItems - All scene items (optional)
 * @returns {Promise<Array>} Attachments with metadata
 */
export async function getAttachmentsWithMetadata(tokenId, metadataKey, allItems = null) {
  const attachments = await getTokenAttachments(tokenId, allItems);
  return attachments.filter(att => att.metadata && metadataKey in att.metadata);
}

/**
 * Find a specific attachment
 * @param {string} tokenId - Token ID
 * @param {string} attachmentName - Name of attachment to find
 * @param {Array} allItems - All scene items (optional)
 * @returns {Promise<Object|null>} Attachment item or null
 */
export async function findAttachment(tokenId, attachmentName, allItems = null) {
  const attachments = await getTokenAttachments(tokenId, allItems);
  return attachments.find(att => att.name === attachmentName) || null;
}

/**
 * Toggle attachment visibility
 * @param {string} attachmentId - Attachment ID
 * @param {boolean} visible - Visibility state
 */
export async function setAttachmentVisible(attachmentId, visible) {
  try {
    await OBR.scene.items.updateItems([attachmentId], (items) => {
      items.forEach(item => {
        item.visible = visible;
      });
    });
    console.log(`[TokenAttachments] Set attachment ${attachmentId} visible to ${visible}`);
  } catch (error) {
    console.error("[TokenAttachments] Error setting visibility:", error);
  }
}

/**
 * Toggle multiple attachments visibility
 * @param {Array<string>} attachmentIds - Array of attachment IDs
 * @param {boolean} visible - Visibility state
 */
export async function setAttachmentsVisible(attachmentIds, visible) {
  try {
    await OBR.scene.items.updateItems(attachmentIds, (items) => {
      items.forEach(item => {
        item.visible = visible;
      });
    });
    console.log(`[TokenAttachments] Set ${attachmentIds.length} attachments visible to ${visible}`);
  } catch (error) {
    console.error("[TokenAttachments] Error setting visibility:", error);
  }
}

/**
 * Get condition markers on a token
 * Delegates to ConditionsMarkers integration
 * @param {string} tokenId - Token ID
 * @param {Array} allItems - All scene items (optional)
 * @returns {Promise<Array>} Array of condition marker attachments
 */
export async function getConditionMarkers(tokenId, allItems = null) {
  return ConditionsMarkers.getConditionMarkerAttachments(tokenId, allItems);
}

/**
 * Get owl-trackers on a token
 * @param {string} tokenId - Token ID
 * @param {Array} allItems - All scene items (optional)
 * @returns {Promise<Array>} Array of tracker attachments
 */
export async function getTrackers(tokenId, allItems = null) {
  return getAttachmentsWithMetadata(tokenId, "com.owl-trackers/trackers", allItems);
}

/**
 * Get tracker values from a token
 * @param {string} tokenId - Token ID
 * @param {string} trackerName - Name of tracker (e.g., "HP")
 * @param {Array} allItems - All scene items (optional)
 * @returns {Promise<Object|null>} Tracker object with metadata or null
 */
export async function getTrackerValue(tokenId, trackerName, allItems = null) {
  const items = allItems || await OBR.scene.items.getItems();
  const token = items.find(item => item.id === tokenId);
  
  if (!token || !token.metadata) {
    return null;
  }
  
  const trackers = token.metadata["com.owl-trackers/trackers"];
  if (!Array.isArray(trackers)) {
    return null;
  }
  
  return trackers.find(t => t.name === trackerName) || null;
}

/**
 * Get all tracker values from a token
 * @param {string} tokenId - Token ID
 * @param {Array} allItems - All scene items (optional)
 * @returns {Promise<Object>} Object mapping tracker names to values
 */
export async function getAllTrackerValues(tokenId, allItems = null) {
  const items = allItems || await OBR.scene.items.getItems();
  const token = items.find(item => item.id === tokenId);
  
  if (!token || !token.metadata) {
    return {};
  }
  
  const trackers = token.metadata["com.owl-trackers/trackers"];
  if (!Array.isArray(trackers)) {
    return {};
  }
  
  const result = {};
  trackers.forEach(tracker => {
    result[tracker.name] = tracker.value;
  });
  
  return result;
}

/**
 * Get token label/name
 * @param {string} tokenId - Token ID
 * @param {Array} allItems - All scene items (optional)
 * @returns {Promise<string|null>} Token label/name or null
 */
export async function getTokenLabel(tokenId, allItems = null) {
  const items = allItems || await OBR.scene.items.getItems();
  const token = items.find(item => item.id === tokenId);
  
  if (!token) {
    return null;
  }
  
  // Try to get label from text
  if (token.text && token.text.plainText) {
    return token.text.plainText;
  }
  
  return token.name || null;
}

/**
 * Get all attachments grouped by type
 * @param {string} tokenId - Token ID
 * @param {Array} allItems - All scene items (optional)
 * @returns {Promise<Object>} Object with types as keys and arrays of attachments as values
 */
export async function getAttachmentsGroupedByType(tokenId, allItems = null) {
  const attachments = await getTokenAttachments(tokenId, allItems);
  const grouped = {};
  
  attachments.forEach(att => {
    if (!grouped[att.type]) {
      grouped[att.type] = [];
    }
    grouped[att.type].push(att);
  });
  
  return grouped;
}

export default {
  getTokenAttachments,
  getAttachmentsByType,
  getAttachmentsByName,
  getAttachmentsWithMetadata,
  findAttachment,
  setAttachmentVisible,
  setAttachmentsVisible,
  getConditionMarkers,
  getTrackers,
  getTrackerValue,
  getAllTrackerValues,
  getTokenLabel,
  getAttachmentsGroupedByType,
};
