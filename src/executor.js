/**
 * Command Executor
 * Handles parsing and executing commands from the config
 */

import * as math from "mathjs";
import * as parser from "./parser.js";
import { resolveVariables, getAffectedVariables, getVariablesUsedInCommands } from "./expressionEvaluator.js";
import { getIntegrationsContext } from "./commands/integrations/Manager.js";

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

  // Get integrations from Manager (includes OwlTrackers, ConditionsMarkers, GoogleSheets, etc.)
  const integrations = getIntegrationsContext();

  return {
    // Integrations from Manager
    ...integrations,
    
    // Expose all mathjs functions directly (floor, ceil, sqrt, etc.)
    ...math,
    
    // Helper to get variable values
    getVar: (varName) => {
      const variable = page.variables?.[varName];
      if (!variable) {
        console.warn(`Variable not found: ${varName}`);
        return undefined;
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
      let value = scope[varRef];
      console.log(`[SUBST]   ${varRef} = ${value}`);
      
      // Convert to string representation for substitution into expression
      let valueStr;
      if (typeof value === 'string') {
        valueStr = value; // Keep as plain string for now
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        valueStr = String(value);
      } else if (value === null) {
        valueStr = 'null';
      } else if (value === undefined) {
        valueStr = 'undefined';
      } else {
        valueStr = JSON.stringify(value);
      }
      
      // Use word boundaries to avoid partial replacements
      const regex = new RegExp(`\\b${varRef}\\b`, 'g');
      result = result.replace(regex, valueStr);
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
      
      // Then try to evaluate (for mathematical expressions like 1+1, floor, etc)
      // Use the substituted value so math can work on it
      const value = evaluateExpression(substituted, page);
      console.log(`[PARSE] After evaluation: "${value}"`);
      
      // Convert value to string representation for insertion
      let valueStr;
      if (typeof value === 'string') {
        // If it's already a string literal with quotes, use as-is
        // Otherwise, wrap in quotes
        if ((value.startsWith("'") && value.endsWith("'")) || 
            (value.startsWith('"') && value.endsWith('"'))) {
          valueStr = value;
        } else {
          valueStr = `'${value}'`;
        }
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        // Numbers and booleans can be inserted directly
        valueStr = String(value);
      } else if (value === null || value === undefined) {
        valueStr = String(value);
      } else {
        // For objects/arrays, use JSON representation
        valueStr = JSON.stringify(value);
      }
      
      result += valueStr;
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
    let parsedCommand = parseCommandString(command, page);
    console.log("[EXEC] Parsed command:", parsedCommand);
    
    // Extract variable references to check what's needed
    const varRefs = parser.extractVariableReferences(command);
    console.log("Variable references:", varRefs);
    
    // Create execution context with resolved variables
    const context = createExecutionContext(page);
    
    // Transform the command to properly await async function calls
    // This is critical for expressions like: OwlTrackers.setValue(token, 'HP', OwlTrackers.getValue(token, 'HP')*1.1)
    // We need to ensure OwlTrackers.getValue is awaited before the multiplication
    
    // Dynamically discover async methods from the context
    const asyncMethods = [];
    for (const [objectName, objectValue] of Object.entries(context)) {
      if (typeof objectValue === 'object' && objectValue !== null) {
        for (const [methodName, methodValue] of Object.entries(objectValue)) {
          if (typeof methodValue === 'function') {
            // Check if it's an async function or returns a promise
            const methodStr = methodValue.toString();
            if (methodStr.startsWith('async ') || methodStr.includes('Promise')) {
              asyncMethods.push(`${objectName}.${methodName}`);
            }
          }
        }
      }
    }
    
    console.log('[EXEC] Detected async methods:', asyncMethods);
    
    // For each async method, find all calls and wrap them with (await ...)
    for (const method of asyncMethods) {
      const escapedMethod = method.replace(/\./g, '\\.');
      const regex = new RegExp(`${escapedMethod}\\s*\\(`, 'g');
      
      let match;
      const matches = [];
      
      // Find all occurrences
      while ((match = regex.exec(parsedCommand)) !== null) {
        matches.push({ index: match.index, method: method });
      }
      
      // Process matches in reverse order to maintain indices
      for (let i = matches.length - 1; i >= 0; i--) {
        const { index, method: methodName } = matches[i];
        
        // Find the matching closing parenthesis
        let parenCount = 0;
        let startIdx = index + methodName.length;
        let endIdx = startIdx;
        
        for (let j = startIdx; j < parsedCommand.length; j++) {
          if (parsedCommand[j] === '(') parenCount++;
          if (parsedCommand[j] === ')') {
            parenCount--;
            if (parenCount === 0) {
              endIdx = j + 1;
              break;
            }
          }
        }
        
        // Extract the full function call
        const fullCall = parsedCommand.substring(index, endIdx);
        
        // Check if it's already wrapped with await
        const beforeCall = parsedCommand.substring(Math.max(0, index - 10), index).trim();
        if (!beforeCall.endsWith('await')) {
          // Wrap with (await ...)
          const wrappedCall = `(await ${fullCall})`;
          parsedCommand = parsedCommand.substring(0, index) + wrappedCall + parsedCommand.substring(endIdx);
        }
      }
    }
    
    console.log("[EXEC] Transformed command:", parsedCommand);
    
    // Build and execute the function
    // We use a function to safely evaluate the command with the context
    try {
      const functionCode = `return (async () => { return ${parsedCommand}; })()`;
      console.log("[EXEC] Function code:", functionCode);
      console.log("[EXEC] Context keys:", Object.keys(context));
      
      const func = new Function(...Object.keys(context), functionCode);
      const result = await func(...Object.values(context));
      
      console.log("Command result:", result);
      return result;
    } catch (syntaxError) {
      console.error("[EXEC] Syntax error in function code. Parsed command:", parsedCommand);
      console.error("[EXEC] Error details:", syntaxError);
      throw syntaxError;
    }
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
    console.log("[EXECUTOR] Button clicked, analyzing command requirements...");
    
    // Store old values to detect changes
    const oldResolved = { ...page._resolved };
    
    // Find which variables are used in the commands
    const usedVars = getVariablesUsedInCommands(commands);
    console.log("[EXECUTOR] Variables used in commands:", Array.from(usedVars));
    
    // Only resolve variables that are actually needed for command execution
    // Pass the callback so UI updates for these variables too
    if (usedVars.size > 0) {
      console.log("[EXECUTOR] Resolving only required variables for command execution...");
      const freshResolved = await resolveVariables(page.variables, globalVariables, (varName, value) => {
        const oldValue = oldResolved[varName];
        if (oldValue !== value && onVariableResolved) {
          onVariableResolved(varName, value);
        }
      }, usedVars);
      page._resolved = { ...page._resolved, ...freshResolved };
    }
    
    console.log("[EXECUTOR] Variables resolved for commands:", page._resolved);
    
    // Execute the commands
    const results = await executeCommands(commands, page);
    console.log("Button action completed:", results);
    
    // After commands execute, only re-resolve variables that could have been affected
    console.log("[EXECUTOR] Analyzing affected variables...");
    const affectedVars = getAffectedVariables(commands, page.variables);
    console.log("[EXECUTOR] Affected variables:", Array.from(affectedVars));
    
    if (affectedVars.size > 0) {
      console.log("[EXECUTOR] Re-resolving affected variables...");
      // Update old values before re-resolving
      const currentResolved = { ...page._resolved };
      const updatedResolved = await resolveVariables(page.variables, globalVariables, (varName, value) => {
        const oldValue = currentResolved[varName];
        if (oldValue !== value && onVariableResolved) {
          onVariableResolved(varName, value);
        }
      }, affectedVars);
      page._resolved = updatedResolved;
    } else {
      console.log("[EXECUTOR] No variables affected, skipping re-resolution");
    }
    
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
