/**
 * Command Executor
 * Handles parsing and executing commands from the config
 */

import * as JustDices from "./commands/integrations/JustDices.js";
import * as OwlTrackers from "./commands/integrations/OwlTrackers.js";
import * as ConditionsMarkers from "./commands/integrations/ConditionsMarkers.js";
import * as GoogleSheets from "./commands/integrations/GoogleSheets.js";
import * as playerMetadata from "./commands/playerMetadata.js";
import * as sceneMetadata from "./commands/sceneMetadata.js";
import * as parser from "./parser.js";
import { resolveVariables } from "./expressionEvaluator.js";

/**
 * Create a context object for command execution
 * @param {Object} page - The current page config
 * @returns {Object} Context object with all available functions
 */
function createExecutionContext(page) {
  if (!page) {
    console.warn("No page provided to execution context");
    page = { variables: {} };
  }

  return {
    // Integrations
    JustDices: {
      roll: JustDices.roll,
      rollDice: JustDices.rollDice,
      rollDiceTotal: JustDices.rollDiceTotal,
      rollDiceSilent: JustDices.rollDiceSilent,
    },
    OwlTrackers,
    ConditionsMarkers,
    GoogleSheets,
    playerMetadata,
    sceneMetadata,
    
    // Helper to get variable values
    getVar: (varName) => {
      const variable = page.variables?.[varName];
      if (!variable) {
        console.warn(`Variable not found: ${varName}`);
        return undefined;
      }
      
      // For calculated variables, we'd need to evaluate the expression
      if (variable.type === "calc") {
        return evaluateExpression(variable.expression, page);
      }
      
      return variable.default ?? variable.expression ?? undefined;
    },
    
    // Helper to set variable values
    setVar: (varName, value) => {
      if (page.variables?.[varName]) {
        page.variables[varName].expression = value;
      } else {
        console.warn(`Variable not found: ${varName}`);
      }
    },
  };
}

/**
 * Evaluate an expression with access to pre-resolved page variables
 * @param {string} expression - The expression to evaluate
 * @param {Object} page - The page config with resolved variables
 * @returns {any} Result of evaluation (or original expression if it can't be evaluated)
 */
function evaluateExpression(expression, page) {
  try {
    // Use pre-resolved variables from page
    const scope = page?._resolved || {};

    console.log(`Evaluating "${expression}" with scope:`, scope);

    // Try to evaluate with mathjs, but silently return the original if it fails
    try {
      const result = math.evaluate(expression, scope);
      console.log(`Expression "${expression}" evaluated to:`, result);
      return result;
    } catch (mathError) {
      // If mathjs fails, just return the expression as-is (could be dice notation or other)
      console.log(`Math evaluation failed for "${expression}" (likely dice notation or special syntax), returning as string`);
      return expression;
    }
  } catch (error) {
    console.error(`Error in evaluateExpression for "${expression}":`, error);
    // Return the expression as-is if anything fails
    return expression;
  }
}

/**
 * Substitute variables in an expression with their resolved values
 * @param {string} expression - Expression with variable names
 * @param {Object} scope - Resolved variables scope
 * @returns {string} Expression with variables replaced by values
 */
function substituteVariables(expression, scope = {}) {
  console.log(`[SUBST] Substituting variables in: "${expression}"`);
  console.log(`[SUBST] Available scope:`, scope);
  
  let result = expression;

  // Extract all variable references
  const varRefs = parser.extractVariableReferences(expression);
  console.log(`[SUBST] Found variable references:`, varRefs);
  
  // Sort by length descending to replace longer names first (avoid partial replacements)
  varRefs.sort((a, b) => b.length - a.length);

  // Replace each variable with its value
  for (const varRef of varRefs) {
    if (varRef in scope) {
      const value = scope[varRef];
      console.log(`[SUBST]   ${varRef} = ${value}`);
      // Use word boundaries to avoid partial replacements
      const regex = new RegExp(`\\b${varRef}\\b`, 'g');
      result = result.replace(regex, value);
    } else {
      console.warn(`[SUBST]   ✗ ${varRef} not found in scope`);
    }
  }

  console.log(`[SUBST] Result: "${result}"`);
  return result;
}

/**
 * Parse a command string and substitute variables
 * @param {string} command - Raw command string
 * @param {Object} page - Page config with resolved variables
 * @returns {string} Parsed command with substitutions
 */
function parseCommandString(command, page) {
  console.log(`[PARSE] Parsing command: "${command}"`);
  
  const parsed = parser.parseCommand(command);
  console.log(`[PARSE] Parsed segments:`, parsed.segments);
  
  const scope = page?._resolved || {};
  console.log(`[PARSE] Scope available:`, scope);
  
  let result = "";
  for (const segment of parsed.segments) {
    console.log(`[PARSE] Processing segment:`, segment);
    
    if (segment.type === "literal") {
      result += segment.value;
    } else if (segment.type === "expression") {
      // First substitute variables with their values
      const substituted = substituteVariables(segment.value, scope);
      console.log(`[PARSE] After substitution: "${substituted}"`);
      
      // Then try to evaluate (for mathematical expressions like floor, etc)
      const value = evaluateExpression(substituted, page);
      console.log(`[PARSE] After evaluation: "${value}"`);
      result += value;
    }
  }
  
  console.log(`[PARSE] Final result: "${result}"`);
  return result;
}

/**
 * Execute a single command
 * @param {string} command - Raw command string
 * @param {Object} page - Page config with resolved variables
 * @returns {Promise<any>} Command result
 */
export async function executeCommand(command, page) {
  try {
    console.log("\n[EXEC] executeCommand called");
    console.log("[EXEC]   command:", command);
    console.log("[EXEC]   page.id:", page?.id);
    console.log("[EXEC]   page._resolved:", page?._resolved);
    
    if (!page) {
      throw new Error("No page provided to executeCommand");
    }

    // Validate the command first
    const validation = parser.validateExpression(command);
    if (!validation.ok) {
      throw new Error(`Syntax error in command: ${validation.errors.join(", ")}`);
    }

    // Parse and substitute variables in the command
    console.log("[EXEC] Parsing command string...");
    const parsedCommand = parseCommandString(command, page);
    console.log("[EXEC] Parsed command:", parsedCommand);
    
    // Extract variable references to check what's needed
    const varRefs = parser.extractVariableReferences(command);
    console.log("Variable references:", varRefs);
    
    // Create execution context with resolved variables
    const context = createExecutionContext(page);
    
    // Build and execute the function
    // We use a function to safely evaluate the command with the context
    const func = new Function(...Object.keys(context), `return (async () => { return ${parsedCommand}; })()`);
    const result = await func(...Object.values(context));
    
    console.log("Command result:", result);
    return result;
  } catch (error) {
    console.error("Error executing command:", error);
    throw error;
  }
}

/**
 * Execute multiple commands
 * @param {Array<string>} commands - Array of command strings
 * @param {Object} page - Page config
 * @returns {Promise<Array>} Array of results
 */
export async function executeCommands(commands, page) {
  const results = [];
  for (const command of commands) {
    try {
      const result = await executeCommand(command, page);
      results.push({ ok: true, result });
    } catch (error) {
      console.error("Command execution failed:", error);
      results.push({ ok: false, error: error.message });
    }
  }
  return results;
}

/**
 * Handle a button click with commands
 * @param {Array<string>} commands - Commands to execute
 * @param {Object} page - Page config
 * @param {Object} globalVariables - Global variables
 * @param {Function} onVariableResolved - Callback when variables resolve
 * @returns {Promise<void>}
 */
export async function handleButtonClick(commands, page, globalVariables = {}, onVariableResolved = null) {
  if (!Array.isArray(commands) || commands.length === 0) {
    console.warn("No commands to execute");
    return;
  }
  
  try {
    console.log("[EXECUTOR] Button clicked, re-resolving variables...");
    
    // Re-resolve all variables before executing commands (no caching)
    // Pass the callback so UI gets updated as variables resolve
    const freshResolved = await resolveVariables(page.variables, globalVariables, onVariableResolved);
    page._resolved = freshResolved;
    
    console.log("[EXECUTOR] Variables refreshed:", freshResolved);
    
    const results = await executeCommands(commands, page);
    console.log("Button action completed:", results);
  } catch (error) {
    console.error("Button action failed:", error);
  }
}

export default {
  executeCommand,
  executeCommands,
  handleButtonClick,
  evaluateExpression,
};
