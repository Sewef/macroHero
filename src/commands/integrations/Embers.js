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

function normalizeInteractions(interactions) {
  return {
    ids: interactions?.ids ?? [],
    count: interactions?.count ?? 0,
  };
}

function buildSpellData(config, playerId) {
  if (config?.spellData) return config.spellData;
  if (config?.spellName) return { name: config.spellName, caster: playerId };
  return undefined;
}

function applyInstructionFields(instruction, config) {
  if (!config) return;
  if (config.type !== undefined) instruction.type = config.type;
  if (config.delay !== undefined) instruction.delay = config.delay;
  if (config.duration !== undefined) instruction.duration = config.duration;
  if (config.loops !== undefined) instruction.loops = config.loops;
  if (config.for !== undefined) instruction.for = config.for;
  if (config.firstTargetIsCaster !== undefined) instruction.firstTargetIsCaster = config.firstTargetIsCaster;
  if (config.metadata !== undefined) instruction.metadata = config.metadata;
  if (config.layer !== undefined) instruction.layer = config.layer;
  if (config.zIndex !== undefined) instruction.zIndex = config.zIndex;
  if (config.forceVariant !== undefined) instruction.forceVariant = config.forceVariant;
  if (config.arguments !== undefined) instruction.arguments = config.arguments;
  if (config.instructions !== undefined) instruction.instructions = config.instructions;
}

function buildMessage(instructions, config, playerId) {
  return {
    instructions,
    interactions: normalizeInteractions(config?.interactions),
    spellData: buildSpellData(config, playerId),
  };
}

/**
 * Cast a spell to one or more targets (projectile effect)
 * @param {string|string[]} targets - Single target ID or array of target IDs
 * @param {Object} config - Spell configuration
 * @param {string} config.id - The effect ID (e.g., "magic_missile", "fireball")
 * @param {number} [config.duration] - Duration in milliseconds
 * @param {number} [config.loops] - Number of loops to play
 * @param {number} [config.delay] - Delay before playing in milliseconds
 * @param {number|Object} [config.forceVariant] - Force a specific variant
 * @param {Object} [config.effectProperties] - Extra/override effectProperties
 * @param {Object} [config.interactions] - Interaction data { ids, count }
 * @param {Object} [config.spellData] - Override spellData { name, caster }
 * @param {string} [config.destination] - Broadcast destination (ALL/REMOTE/LOCAL)
 * @param {Object} [config.metadata] - Custom metadata for the instruction
 * @param {string} [config.layer] - Layer for the effect
 * @param {number} [config.zIndex] - z-index for the effect
 * @param {string|Object} [config.for] - Target filter
 * @param {boolean} [config.firstTargetIsCaster] - Treat first target as caster
 * @param {string} [config.spellName] - Optional spell name for tracking
 * @returns {Promise<void>}
 */
export async function castSpellToTarget(targets, config) {
  if (!config?.id) {
    debugError("[Embers] castSpellToTarget requires config.id");
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
        const effectProperties = {
          source: position,
          size: config.size || 5,
          ...(config.effectProperties || {}),
        };
        const instruction = {
          type: "effect",
          id: config.id,
          effectProperties,
        };
        applyInstructionFields(instruction, config);
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
    const message = buildMessage(instructions, config, playerId);

    // Send to Embers via broadcast
    debugLog(`[Embers] Sending message to channel ${MESSAGE_CHANNEL}:`, JSON.stringify(message, null, 2));
    await OBR.broadcast.sendMessage(MESSAGE_CHANNEL, message, { destination: config?.destination || "ALL" });
    
    debugLog(`[Embers] Cast ${config.id} (${instructions.length} instruction(s))`);
  } catch (error) {
    debugError("[Embers] Failed to cast spell to target:", error.message);
  }
}

/**
 * Cast a spell at a token position (AOE/CIRCLE effect)
 * @param {string} tokenId - Token ID for the spell origin
 * @param {Object} config - Spell configuration
 * @param {string} config.id - The effect ID (e.g., "cure_wounds", "bless")
 * @param {number} config.size - Size of the AOE in grid units
 * @param {number} [config.duration] - Duration in milliseconds
 * @param {number} [config.loops] - Number of loops to play
 * @param {number} [config.delay] - Delay before playing in milliseconds
 * @param {number} [config.rotation] - Rotation in degrees (for directional effects)
 * @param {number|Object} [config.forceVariant] - Force a specific variant
 * @param {Object} [config.effectProperties] - Extra/override effectProperties
 * @param {Object} [config.interactions] - Interaction data { ids, count }
 * @param {Object} [config.spellData] - Override spellData { name, caster }
 * @param {string} [config.destination] - Broadcast destination (ALL/REMOTE/LOCAL)
 * @param {Object} [config.metadata] - Custom metadata for the instruction
 * @param {string} [config.layer] - Layer for the effect
 * @param {number} [config.zIndex] - z-index for the effect
 * @param {string|Object} [config.for] - Target filter
 * @param {boolean} [config.firstTargetIsCaster] - Treat first target as caster
 * @param {string} [config.spellName] - Optional spell name for tracking
 * @returns {Promise<void>}
 */
export async function castSpellAtToken(tokenId, config) {
  if (!config?.id) {
    debugError("[Embers] castSpellAtToken requires config.id");
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
      size: config.size ?? 5,
      ...(config.effectProperties || {}),
    };
    if (config.rotation !== undefined && effectProperties.rotation === undefined) {
      effectProperties.rotation = config.rotation;
    }

    const instruction = {
      type: "effect",
      id: config.id,
      effectProperties,
    };
    applyInstructionFields(instruction, config);

    // Build the message
    const message = buildMessage([instruction], config, playerId);

    // Send to Embers via broadcast
    debugLog(`[Embers] Sending AOE message to channel ${MESSAGE_CHANNEL}:`, JSON.stringify(message, null, 2));
    await OBR.broadcast.sendMessage(MESSAGE_CHANNEL, message, { destination: config?.destination || "ALL" });
    
    debugLog(`[Embers] Cast ${config.id} at token ${tokenId} (size: ${config.size})`);
  } catch (error) {
    debugError("[Embers] Failed to cast spell at token:", error.message);
  }
}

/**
 * Cast a projectile spell from one token to another
 * @param {string} casterId - Caster token ID (source of projectile)
 * @param {string} targetId - Target token ID (destination of projectile)
 * @param {Object} config - Spell configuration
 * @param {string} config.id - The effect ID (e.g., "magic_missile", "fireball")
 * @param {number} [config.copies=1] - Number of projectile copies
 * @param {number} [config.duration] - Duration in milliseconds
 * @param {number} [config.loops] - Number of loops to play
 * @param {number} [config.delay] - Delay before playing in milliseconds
 * @param {number|Object} [config.forceVariant] - Force a specific variant
 * @param {Object} [config.effectProperties] - Extra/override effectProperties
 * @param {Object} [config.interactions] - Interaction data { ids, count }
 * @param {Object} [config.spellData] - Override spellData { name, caster }
 * @param {string} [config.destination] - Broadcast destination (ALL/REMOTE/LOCAL)
 * @param {Object} [config.metadata] - Custom metadata for the instruction
 * @param {string} [config.layer] - Layer for the effect
 * @param {number} [config.zIndex] - z-index for the effect
 * @param {string|Object} [config.for] - Target filter
 * @param {boolean} [config.firstTargetIsCaster] - Treat first target as caster
 * @param {string} [config.spellName] - Optional spell name for tracking
 * @returns {Promise<void>}
 */
export async function castProjectileSpell(casterId, targetId, config) {
  if (!config?.id) {
    debugError("[Embers] castProjectileSpell requires config.id");
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
    const copies = config.copies ?? config.effectProperties?.copies ?? 1;
    const effectProperties = {
      source: casterPosition,
      destination: targetPosition,
      copies,
      ...(config.effectProperties || {}),
    };
    const instruction = {
      type: "effect",
      id: config.id,
      effectProperties,
    };
    applyInstructionFields(instruction, config);

    // Build the message
    const message = buildMessage([instruction], config, playerId);

    // Send to Embers via broadcast
    debugLog(`[Embers] Sending projectile message to channel ${MESSAGE_CHANNEL}:`, JSON.stringify(message, null, 2));
    await OBR.broadcast.sendMessage(MESSAGE_CHANNEL, message, { destination: config?.destination || "ALL" });
    
    debugLog(`[Embers] Cast projectile ${config.id} from ${casterId} to ${targetId}`);
  } catch (error) {
    debugError("[Embers] Failed to cast projectile spell:", error.message);
  }
}

/**
 * Cast a cone spell from caster in direction of target
 * @param {string} casterId - Caster token ID
 * @param {string} targetId - Target token ID (defines direction)
 * @param {Object} config - Spell configuration
 * @param {string} config.id - The effect ID (e.g., "burning_hands", "cone_of_cold")
 * @param {number} config.size - Size/length of the cone
 * @param {number} [config.duration] - Duration in milliseconds
 * @param {number} [config.loops] - Number of loops to play
 * @param {number} [config.delay] - Delay before playing in milliseconds
 * @param {number|Object} [config.forceVariant] - Force a specific variant
 * @param {Object} [config.effectProperties] - Extra/override effectProperties
 * @param {Object} [config.interactions] - Interaction data { ids, count }
 * @param {Object} [config.spellData] - Override spellData { name, caster }
 * @param {string} [config.destination] - Broadcast destination (ALL/REMOTE/LOCAL)
 * @param {Object} [config.metadata] - Custom metadata for the instruction
 * @param {string} [config.layer] - Layer for the effect
 * @param {number} [config.zIndex] - z-index for the effect
 * @param {string|Object} [config.for] - Target filter
 * @param {boolean} [config.firstTargetIsCaster] - Treat first target as caster
 * @param {string} [config.spellName] - Optional spell name for tracking
 * @returns {Promise<void>}
 */
export async function castConeSpell(casterId, targetId, config) {
  if (!config?.id) {
    debugError("[Embers] castConeSpell requires config.id");
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
    const effectProperties = {
      source: casterPosition,
      size: config.size ?? 5,
      rotation,
      ...(config.effectProperties || {}),
    };
    const instruction = {
      type: "effect",
      id: config.id,
      effectProperties,
    };
    applyInstructionFields(instruction, config);

    // Build the message
    const message = buildMessage([instruction], config, playerId);

    // Send to Embers via broadcast
    debugLog(`[Embers] Sending cone message to channel ${MESSAGE_CHANNEL}:`, JSON.stringify(message, null, 2));
    await OBR.broadcast.sendMessage(MESSAGE_CHANNEL, message, { destination: config?.destination || "ALL" });
    
    debugLog(`[Embers] Cast cone ${config.id} from ${casterId} toward ${targetId}`);
  } catch (error) {
    debugError("[Embers] Failed to cast cone spell:", error.message);
  }
}

/**
 * Send raw instructions to Embers
 * @param {Object[]} instructions - EffectInstruction[]
 * @param {Object} [options] - Message options
 * @param {Object} [options.interactions] - Interaction data { ids, count }
 * @param {Object} [options.spellData] - spellData { name, caster }
 * @param {string} [options.spellName] - Convenience spell name
 * @param {string} [options.destination] - Broadcast destination (ALL/REMOTE/LOCAL)
 * @returns {Promise<void>}
 */
export async function sendInstructions(instructions, options = {}) {
  if (!Array.isArray(instructions) || instructions.length === 0) {
    debugError("[Embers] sendInstructions requires a non-empty instructions array");
    return;
  }

  try {
    const playerId = await getPlayerId();
    const message = buildMessage(instructions, options, playerId);
    debugLog(`[Embers] Sending raw instructions to channel ${MESSAGE_CHANNEL}:`, JSON.stringify(message, null, 2));
    await OBR.broadcast.sendMessage(MESSAGE_CHANNEL, message, { destination: options?.destination || "ALL" });
  } catch (error) {
    debugError("[Embers] Failed to send raw instructions:", error.message);
  }
}

/**
 * Build and send a sequence of effects
 * @param {Array} steps - Sequence steps (projectile/aoe/cone/action/instruction)
 * @param {Object} [options] - Message options (interactions, spellName, destination)
 * @returns {Promise<void>}
 */
export async function castSpellSequence(steps, options = {}) {
  if (!Array.isArray(steps) || steps.length === 0) {
    debugError("[Embers] castSpellSequence requires a non-empty steps array");
    return;
  }

  try {
    const instructions = [];

    for (const step of steps) {
      if (step?.instructions && Array.isArray(step.instructions)) {
        instructions.push(...step.instructions);
        continue;
      }

      if (step?.instruction) {
        instructions.push(step.instruction);
        continue;
      }

      if (step?.type === "projectile") {
        const targets = Array.isArray(step.targets) ? step.targets : [step.targets];
        for (const targetId of targets) {
          if (!targetId) continue;
          const [casterPosition, targetPosition] = await Promise.all([
            getTokenPosition(step.casterId),
            getTokenPosition(targetId),
          ]);
          if (!casterPosition || !targetPosition) {
            debugWarn("[Embers] Projectile step skipped (missing caster/target)");
            continue;
          }
          const copies = step.config?.copies ?? step.config?.effectProperties?.copies ?? 1;
          const effectProperties = {
            source: casterPosition,
            destination: targetPosition,
            copies,
            ...(step.config?.effectProperties || {}),
          };
          const instruction = {
            type: "effect",
            id: step.config?.id,
            effectProperties,
          };
          applyInstructionFields(instruction, step.config);
          instructions.push(instruction);
        }
        continue;
      }

      if (step?.type === "aoe") {
        const targets = Array.isArray(step.targets) ? step.targets : [step.targets];
        for (const targetId of targets) {
          if (!targetId) continue;
          const position = await getTokenPosition(targetId);
          if (!position) {
            debugWarn("[Embers] AOE step skipped (missing target)");
            continue;
          }
          const size = step.config?.size ?? step.config?.effectProperties?.size ?? 5;
          const effectProperties = {
            source: position,
            size,
            ...(step.config?.effectProperties || {}),
          };
          if (step.config?.rotation !== undefined && effectProperties.rotation === undefined) {
            effectProperties.rotation = step.config.rotation;
          }
          const instruction = {
            type: "effect",
            id: step.config?.id,
            effectProperties,
          };
          applyInstructionFields(instruction, step.config);
          instructions.push(instruction);
        }
        continue;
      }

      if (step?.type === "cone") {
        const [casterPosition, targetPosition] = await Promise.all([
          getTokenPosition(step.casterId),
          getTokenPosition(step.targetId),
        ]);
        if (!casterPosition || !targetPosition) {
          debugWarn("[Embers] Cone step skipped (missing caster/target)");
          continue;
        }
        const size = step.config?.size ?? step.config?.effectProperties?.size ?? 5;
        const dx = targetPosition.x - casterPosition.x;
        const dy = targetPosition.y - casterPosition.y;
        const rotation = Math.atan2(dy, dx) * (180 / Math.PI);
        const effectProperties = {
          source: casterPosition,
          size,
          rotation,
          ...(step.config?.effectProperties || {}),
        };
        const instruction = {
          type: "effect",
          id: step.config?.id,
          effectProperties,
        };
        applyInstructionFields(instruction, step.config);
        instructions.push(instruction);
        continue;
      }

      if (step?.type === "action") {
        const instruction = {
          type: "action",
          id: step.id ?? step.config?.id,
          arguments: step.arguments ?? step.config?.arguments,
        };
        applyInstructionFields(instruction, step.config);
        instructions.push(instruction);
        continue;
      }

      if (step?.type === "effect") {
        const instruction = {
          type: "effect",
          id: step.id ?? step.config?.id,
          effectProperties: step.effectProperties ?? step.config?.effectProperties,
        };
        applyInstructionFields(instruction, step.config);
        instructions.push(instruction);
        continue;
      }
    }

    if (instructions.length === 0) {
      debugError("[Embers] castSpellSequence produced no instructions");
      return;
    }

    await sendInstructions(instructions, options);
  } catch (error) {
    debugError("[Embers] Failed to cast spell sequence:", error.message);
  }
}
