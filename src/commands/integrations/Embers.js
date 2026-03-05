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
 * Embers Integration - Complete rewrite with proper .then() support
 * Handles communication with the Embers extension for spell visual effects
 * Based on: https://github.com/ArmindoFlores/embers
 */

async function getPlayerId() {
  try {
    return await OBR.player.getId();
  } catch (error) {
    debugError(`[Embers] Failed to get player ID:`, error.message);
    return "unknown";
  }
}

function buildMessage(instructions, options, playerId) {
  return {
    instructions,
    interactions: {
      ids: options?.interactions?.ids ?? [],
      count: options?.interactions?.count ?? 0,
    },
    spellData: options?.spellData ?? 
      (options?.spellName ? { name: options.spellName, caster: playerId } : undefined),
  };
}

function applyOptionalFields(instruction, config) {
  if (!config) return;
  const optionalFields = [
    'type', 'delay', 'duration', 'loops', 'for', 
    'firstTargetIsCaster', 'metadata', 'layer', 'zIndex', 
    'forceVariant', 'arguments', 'instructions'
  ];
  optionalFields.forEach(field => {
    if (config[field] !== undefined) {
      instruction[field] = config[field];
    }
  });
}

function calculateRotation(source, destination) {
  const dx = destination.x - source.x;
  const dy = destination.y - source.y;
  return Math.atan2(dy, dx) * (180 / Math.PI);
}

/**
 * EmbersSequence - Fluent API for building complex spell sequences
 * 
 * Key difference: .then() works correctly by building the instruction tree
 * immediately while deferring async resolution until .cast()
 */
class EmbersSequence {
  constructor() {
    this.instructions = [];
    this.currentContext = this.instructions;
    this.options = {};
    this.asyncResolvers = []; // Functions that resolve positions just before broadcast
    this.pendingDelay = 0; // Delay to apply to the next instruction
  }

  /**
   * Add a projectile effect
   */
  projectile(effectId, casterId, targetIds, config = {}) {
    const targets = Array.isArray(targetIds) ? targetIds : [targetIds];
    
    // Create one instruction per target, immediately added to structure
    for (const targetId of targets) {
      const instruction = {
        type: 'effect',
        id: effectId,
        effectProperties: {
          source: null,
          destination: null,
          copies: config.copies ?? config.effectProperties?.copies ?? 1,
          ...(config.effectProperties || {}),
        },
      };
      applyOptionalFields(instruction, config);
      // Apply pending delay to this instruction
      if (this.pendingDelay > 0) {
        instruction.delay = this.pendingDelay;
        this.pendingDelay = 0;
      }
      this.currentContext.push(instruction);
      
      // Register async resolver to fill positions just before cast
      this.asyncResolvers.push(async () => {
        const casterPos = await getTokenPosition(casterId);
        const targetPos = await getTokenPosition(targetId);
        if (!casterPos) {
          debugWarn(`[Embers] Caster ${casterId} not found`);
          return false;
        }
        if (!targetPos) {
          debugWarn(`[Embers] Target ${targetId} not found`);
          return false;
        }
        instruction.effectProperties.source = casterPos;
        instruction.effectProperties.destination = targetPos;
        return true;
      });
    }
    return this;
  }

  /**
   * Add an AOE/Circle effect
   */
  aoe(effectId, tokenIds, config = {}) {
    const tokens = Array.isArray(tokenIds) ? tokenIds : [tokenIds];
    
    for (const tokenId of tokens) {
      const instruction = {
        type: 'effect',
        id: effectId,
        effectProperties: {
          source: null,
          size: config.size ?? config.effectProperties?.size ?? 5,
          ...(config.effectProperties || {}),
        },
      };
      applyOptionalFields(instruction, config);
      // Apply pending delay to this instruction
      if (this.pendingDelay > 0) {
        instruction.delay = this.pendingDelay;
        this.pendingDelay = 0;
      }
      this.currentContext.push(instruction);
      
      // Register async resolver
      this.asyncResolvers.push(async () => {
        const position = await getTokenPosition(tokenId);
        if (!position) {
          debugWarn(`[Embers] Token ${tokenId} not found`);
          return false;
        }
        instruction.effectProperties.source = position;
        return true;
      });
    }
    return this;
  }

  /**
   * Add a cone effect
   */
  cone(effectId, casterId, targetId, config = {}) {
    const instruction = {
      type: 'effect',
      id: effectId,
      effectProperties: {
        source: null,
        size: config.size ?? config.effectProperties?.size ?? 5,
        rotation: 0,
        ...(config.effectProperties || {}),
      },
    };
    applyOptionalFields(instruction, config);
    // Apply pending delay to this instruction
    if (this.pendingDelay > 0) {
      instruction.delay = this.pendingDelay;
      this.pendingDelay = 0;
    }
    this.currentContext.push(instruction);
    
    // Register async resolver
    this.asyncResolvers.push(async () => {
      const casterPos = await getTokenPosition(casterId);
      const targetPos = await getTokenPosition(targetId);
      if (!casterPos || !targetPos) {
        debugWarn(`[Embers] Caster or target not found`);
        return false;
      }
      instruction.effectProperties.source = casterPos;
      instruction.effectProperties.rotation = calculateRotation(casterPos, targetPos);
      return true;
    });
    return this;
  }

  /**
   * Add an action (move, create token, slide, etc.)
   */
  action(actionId, args, config = {}) {
    const instruction = {
      type: 'action',
      id: actionId,
      arguments: args,
    };
    applyOptionalFields(instruction, config);
    // Apply pending delay to this instruction
    if (this.pendingDelay > 0) {
      instruction.delay = this.pendingDelay;
      this.pendingDelay = 0;
    }
    this.currentContext.push(instruction);
    return this;
  }

  /**
   * Add a delay before the next instruction
   */
  delay(ms) {
    this.pendingDelay = (this.pendingDelay ?? 0) + ms;
    return this;
  }

  /**
   * Create nested sequence - next effects execute AFTER previous completes
   * This works by nesting instructions in the last instruction's .instructions array
   */
  then() {
    if (this.currentContext.length === 0) {
      debugWarn('[Embers] then() called with no previous instruction');
      return this;
    }
    
    const lastInstruction = this.currentContext[this.currentContext.length - 1];
    if (!lastInstruction.instructions) {
      lastInstruction.instructions = [];
    }
    
    // Change context to the nested instructions array
    this.currentContext = lastInstruction.instructions;
    return this;
  }

  /**
   * Set options for the entire sequence
   */
  withOptions(options) {
    this.options = { ...this.options, ...options };
    return this;
  }

  /**
   * Set the spell name
   */
  named(name) {
    return this.withOptions({ spellName: name });
  }

  /**
   * Set broadcast destination
   */
  broadcast(destination) {
    return this.withOptions({ destination });
  }

  /**
   * Send the sequence to Embers
   */
  async cast(options = {}) {
    try {
      // Execute all async resolvers to fill in positions
      for (const resolver of this.asyncResolvers) {
        await resolver();
      }

      if (this.instructions.length === 0) {
        debugError('[Embers] No instructions to cast');
        return;
      }

      const finalOptions = { ...this.options, ...options };
      const playerId = await getPlayerId();
      const message = buildMessage(this.instructions, finalOptions, playerId);

      debugLog(`[Embers] Broadcasting to ${finalOptions.destination ?? 'ALL'}:`, 
        JSON.stringify(message, null, 2));

      await OBR.broadcast.sendMessage(MESSAGE_CHANNEL, message, { 
        destination: finalOptions.destination ?? 'ALL' 
      });
      
      debugLog(`[Embers] ✓ Message sent (${this.instructions.length} instruction(s))`);
    } catch (error) {
      debugError('[Embers] Failed to cast:', error.message);
    }
  }
}

export async function sendInstructions(instructions, options = {}) {
  if (!Array.isArray(instructions) || instructions.length === 0) {
    debugError('[Embers] sendInstructions requires a non-empty array');
    return;
  }

  try {
    const playerId = await getPlayerId();
    const message = buildMessage(instructions, options, playerId);
    debugLog(`[Embers] Broadcasting ${instructions.length} raw instruction(s):`, 
      JSON.stringify(message, null, 2));
    
    await OBR.broadcast.sendMessage(MESSAGE_CHANNEL, message, { 
      destination: options.destination ?? 'ALL' 
    });
    
    debugLog(`[Embers] ✓ Message sent`);
  } catch (error) {
    debugError('[Embers] Failed to send instructions:', error.message);
  }
}

export { EmbersSequence };

export async function castProjectile(effectId, casterId, targetIds, config) {
  await new EmbersSequence()
    .projectile(effectId, casterId, targetIds, config)
    .cast();
}

export async function castAOE(effectId, tokenIds, config) {
  await new EmbersSequence()
    .aoe(effectId, tokenIds, config)
    .cast();
}

export async function castCone(effectId, casterId, targetId, config) {
  await new EmbersSequence()
    .cone(effectId, casterId, targetId, config)
    .cast();
}
