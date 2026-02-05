import OBR from "@owlbear-rodeo/sdk";
import { isDebugEnabled } from "../../debugMode.js";
import { getTokenPosition } from "../tokenHelpers.js";

// Debug mode constants
const debugLog = (...args) => isDebugEnabled('Embers') && console.log(...args);
const debugError = (...args) => console.error(...args);
const debugWarn = (...args) => console.warn(...args);

// Embers constants
const APP_KEY = "eu.armindo.embers";
const MESSAGE_CHANNEL = `${APP_KEY}/effects`;

/**
 * Embers Integration
 * Handles communication with the Embers extension for spell visual effects
 * Based on: https://github.com/ArmindoFlores/embers
 */

/**
 * Get current player ID
 * @returns {Promise<string>} Player ID
 */
async function getPlayerId() {
  try {
    return await OBR.player.getId();
  } catch (error) {
    debugError(`[Embers] Failed to get player ID:`, error.message);
    return "unknown";
  }
}

/**
 * Cast a spell to one or more targets (projectile effect)
 * @param {string|string[]} targets - Single target ID or array of target IDs
 * @param {Object} config - Spell configuration
 * @param {string} config.spellId - The effect ID (e.g., "magic_missile", "fireball")
 * @param {number} [config.duration] - Duration in milliseconds
 * @param {number} [config.loops] - Number of loops to play
 * @param {number} [config.delay] - Delay before playing in milliseconds
 * @param {string} [config.spellName] - Optional spell name for tracking
 * @returns {Promise<void>}
 */
export async function castSpellToTarget(targets, config) {
  if (!config?.spellId) {
    debugError("[Embers] castSpellToTarget requires config.spellId");
    return;
  }

  // Handle single target or array
  const targetArray = Array.isArray(targets) ? targets : [targets];
  
  if (targetArray.length === 0) {
    debugError("[Embers] castSpellToTarget requires at least one target");
    return;
  }

  try {
    const playerId = await getPlayerId();
    const instructions = [];

    // Create effect instruction for each target
    for (const targetId of targetArray) {
      const position = await getTokenPosition(targetId);
      
      if (position) {
        const instruction = {
          type: "effect",
          id: config.spellId,
          effectProperties: {
            source: position,
            size: config.size || 5,
          }
        };
        if (config.delay !== undefined) instruction.delay = config.delay;
        if (config.duration !== undefined) instruction.duration = config.duration;
        if (config.loops !== undefined) instruction.loops = config.loops;
        instructions.push(instruction);
      } else {
        debugWarn(`[Embers] Target token ${targetId} not found`);
      }
    }

    if (instructions.length === 0) {
      debugError("[Embers] No valid target positions found");
      return;
    }

    // Build the message according to Embers format
    const message = {
      instructions,
      interactions: {
        ids: [],
        count: 0,
      },
      spellData: config.spellName ? {
        name: config.spellName,
        caster: playerId,
      } : undefined,
    };

    // Send to Embers via broadcast
    debugLog(`[Embers] Sending message to channel ${MESSAGE_CHANNEL}:`, JSON.stringify(message, null, 2));
    await OBR.broadcast.sendMessage(MESSAGE_CHANNEL, message, { destination: "ALL" });
    
    debugLog(`[Embers] Cast ${config.spellId} (${instructions.length} instruction(s))`);
  } catch (error) {
    debugError("[Embers] Failed to cast spell to target:", error.message);
  }
}

/**
 * Cast a spell at a token position (AOE/CIRCLE effect)
 * @param {string} tokenId - Token ID for the spell origin
 * @param {Object} config - Spell configuration
 * @param {string} config.spellId - The effect ID (e.g., "cure_wounds", "bless")
 * @param {number} config.size - Size of the AOE in grid units
 * @param {number} [config.duration] - Duration in milliseconds
 * @param {number} [config.loops] - Number of loops to play
 * @param {number} [config.delay] - Delay before playing in milliseconds
 * @param {number} [config.rotation] - Rotation in radians (for directional effects)
 * @param {string} [config.spellName] - Optional spell name for tracking
 * @returns {Promise<void>}
 */
export async function castSpellAtToken(tokenId, config) {
  if (!config?.spellId) {
    debugError("[Embers] castSpellAtToken requires config.spellId");
    return;
  }

  if (typeof config.size !== 'number') {
    debugError("[Embers] castSpellAtToken requires config.size (number)");
    return;
  }

  try {
    // Get token position
    const position = await getTokenPosition(tokenId);
    if (!position) {
      debugError(`[Embers] Token ${tokenId} not found`);
      return;
    }

    const playerId = await getPlayerId();

    // Create instruction for AOE effect
    const effectProperties = {
      source: position,
      size: config.size,
    };
    if (config.rotation !== undefined) effectProperties.rotation = config.rotation;

    const instruction = {
      type: "effect",
      id: config.spellId,
      effectProperties
    };
    if (config.delay !== undefined) instruction.delay = config.delay;
    if (config.duration !== undefined) instruction.duration = config.duration;
    if (config.loops !== undefined) instruction.loops = config.loops;

    // Build the message
    const message = {
      instructions: [instruction],
      interactions: {
        ids: [],
        count: 0,
      },
      spellData: config.spellName ? {
        name: config.spellName,
        caster: playerId,
      } : undefined,
    };

    // Send to Embers via broadcast
    debugLog(`[Embers] Sending AOE message to channel ${MESSAGE_CHANNEL}:`, JSON.stringify(message, null, 2));
    await OBR.broadcast.sendMessage(MESSAGE_CHANNEL, message, { destination: "ALL" });
    
    debugLog(`[Embers] Cast ${config.spellId} at token ${tokenId} (size: ${config.size})`);
  } catch (error) {
    debugError("[Embers] Failed to cast spell at token:", error.message);
  }
}

/**
 * Cast a projectile spell from one token to another
 * @param {string} casterId - Caster token ID (source of projectile)
 * @param {string} targetId - Target token ID (destination of projectile)
 * @param {Object} config - Spell configuration
 * @param {string} config.spellId - The effect ID (e.g., "magic_missile", "fireball")
 * @param {number} [config.copies=1] - Number of projectile copies
 * @param {number} [config.duration] - Duration in milliseconds
 * @param {number} [config.loops] - Number of loops to play
 * @param {number} [config.delay] - Delay before playing in milliseconds
 * @param {string} [config.spellName] - Optional spell name for tracking
 * @returns {Promise<void>}
 */
export async function castProjectileSpell(casterId, targetId, config) {
  if (!config?.spellId) {
    debugError("[Embers] castProjectileSpell requires config.spellId");
    return;
  }

  try {
    // Get both positions
    const [casterPosition, targetPosition] = await Promise.all([
      getTokenPosition(casterId),
      getTokenPosition(targetId),
    ]);

    if (!casterPosition || !targetPosition) {
      debugError("[Embers] Caster or target token not found");
      return;
    }

    const playerId = await getPlayerId();

    // Create projectile instruction
    const instruction = {
      type: "effect",
      id: config.spellId,
      effectProperties: {
        source: casterPosition,
        destination: targetPosition,
        copies: config.copies || 1,
      }
    };
    if (config.delay !== undefined) instruction.delay = config.delay;
    if (config.duration !== undefined) instruction.duration = config.duration;
    if (config.loops !== undefined) instruction.loops = config.loops;

    // Build the message
    const message = {
      instructions: [instruction],
      interactions: {
        ids: [],
        count: 0,
      },
      spellData: config.spellName ? {
        name: config.spellName,
        caster: playerId,
      } : undefined,
    };

    // Send to Embers via broadcast
    debugLog(`[Embers] Sending projectile message to channel ${MESSAGE_CHANNEL}:`, JSON.stringify(message, null, 2));
    await OBR.broadcast.sendMessage(MESSAGE_CHANNEL, message, { destination: "ALL" });
    
    debugLog(`[Embers] Cast projectile ${config.spellId} from ${casterId} to ${targetId}`);
  } catch (error) {
    debugError("[Embers] Failed to cast projectile spell:", error.message);
  }
}

/**
 * Cast a cone spell from caster in direction of target
 * @param {string} casterId - Caster token ID
 * @param {string} targetId - Target token ID (defines direction)
 * @param {Object} config - Spell configuration
 * @param {string} config.spellId - The effect ID (e.g., "burning_hands", "cone_of_cold")
 * @param {number} config.size - Size/length of the cone
 * @param {number} [config.duration] - Duration in milliseconds
 * @param {number} [config.loops] - Number of loops to play
 * @param {number} [config.delay] - Delay before playing in milliseconds
 * @param {string} [config.spellName] - Optional spell name for tracking
 * @returns {Promise<void>}
 */
export async function castConeSpell(casterId, targetId, config) {
  if (!config?.spellId) {
    debugError("[Embers] castConeSpell requires config.spellId");
    return;
  }

  if (typeof config.size !== 'number') {
    debugError("[Embers] castConeSpell requires config.size (number)");
    return;
  }

  try {
    // Get both positions
    const [casterPosition, targetPosition] = await Promise.all([
      getTokenPosition(casterId),
      getTokenPosition(targetId),
    ]);

    if (!casterPosition || !targetPosition) {
      debugError("[Embers] Caster or target token not found");
      return;
    }

    // Calculate rotation angle from caster to target (in degrees)
    const dx = targetPosition.x - casterPosition.x;
    const dy = targetPosition.y - casterPosition.y;
    const angleRadians = Math.atan2(dy, dx);
    const rotation = angleRadians * (180 / Math.PI);

    const playerId = await getPlayerId();

    // Create cone instruction
    const instruction = {
      type: "effect",
      id: config.spellId,
      effectProperties: {
        source: casterPosition,
        size: config.size,
        rotation: rotation,
      }
    };
    if (config.delay !== undefined) instruction.delay = config.delay;
    if (config.duration !== undefined) instruction.duration = config.duration;
    if (config.loops !== undefined) instruction.loops = config.loops;

    // Build the message
    const message = {
      instructions: [instruction],
      interactions: {
        ids: [],
        count: 0,
      },
      spellData: config.spellName ? {
        name: config.spellName,
        caster: playerId,
      } : undefined,
    };

    // Send to Embers via broadcast
    debugLog(`[Embers] Sending cone message to channel ${MESSAGE_CHANNEL}:`, JSON.stringify(message, null, 2));
    await OBR.broadcast.sendMessage(MESSAGE_CHANNEL, message, { destination: "ALL" });
    
    debugLog(`[Embers] Cast cone ${config.spellId} from ${casterId} toward ${targetId}`);
  } catch (error) {
    debugError("[Embers] Failed to cast cone spell:", error.message);
  }
}
