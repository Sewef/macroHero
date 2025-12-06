/**
 * Command Executor
 * Handles parsing and executing commands from the config
 */

import * as math from "mathjs";
import * as parser from "./parser.js";
import { resolveVariables, getAffectedVariables, getVariablesUsedInCommands, getDependentVariables } from "./expressionEvaluator.js";
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
  
  // Track which variables were modified during command execution
  if (!page._modifiedVars) {
    page._modifiedVars = new Set();
  }

  return {
    // Integrations from Manager
    ...integrations,
    
    // Expose all mathjs functions directly (floor, ceil, sqrt, etc.)
    ...math,
    
    // Variable manipulation functions
    setValue: (varName, value) => {
      if (!page.variables || !(varName in page.variables)) {
        throw new Error(`Variable "${varName}" not found in current page`);
      }
      
      const variable = page.variables[varName];
      let newValue = value;
      
      // Apply min/max constraints
      if (variable.min !== undefined && newValue < variable.min) {
        newValue = variable.min;
      }
      if (variable.max !== undefined && newValue > variable.max) {
        newValue = variable.max;
      }
      
      // Update both expression and resolved value
      variable.expression = String(newValue);
      page._resolved[varName] = newValue;
      page._modifiedVars.add(varName);
      
      console.log(`[setValue] ${varName} = ${newValue}`);
      return newValue;
    },
    
    addValue: (varName, delta) => {
      if (!page.variables || !(varName in page.variables)) {
        throw new Error(`Variable "${varName}" not found in current page`);
      }
      
      const variable = page.variables[varName];
      const currentValue = Number(page._resolved[varName]) || 0;
      let newValue = currentValue + Number(delta);
      
      // Apply min/max constraints
      if (variable.min !== undefined && newValue < variable.min) {
        newValue = variable.min;
      }
      if (variable.max !== undefined && newValue > variable.max) {
        newValue = variable.max;
      }
      
      // Update both expression and resolved value
      variable.expression = String(newValue);
      page._resolved[varName] = newValue;
      page._modifiedVars.add(varName);
      
      console.log(`[addValue] ${varName} += ${delta} => ${newValue}`);
      return newValue;
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
 * @param {boolean} inStringLiteral - Whether substitution is happening inside a string literal
 * @returns {string} Expression with variables replaced by values
 */
function substituteVariables(expression, scope = {}, inStringLiteral = false) {
  let result = expression;
  
  // Check if this expression should be evaluated (in string literal with operators/braces)
  const shouldEvaluate = inStringLiteral && /[+\-*\/(){}]/.test(expression);

  // Process {expression} - substitute vars then evaluate if complex
  result = result.replace(/\{([^{}]+)\}/g, (match, inner) => {
    if (/^\w+$/.test(inner)) {
      // Simple {var}
      if (inner in scope) {
        const val = scope[inner];
        if (typeof val === 'boolean') return val ? '1' : '0';
        if (typeof val === 'number') return String(val);
        if (typeof val === 'string') return inStringLiteral ? val : `'${val.replace(/'/g, "\\'")}'`;
        return String(val);
      }
      return match;
    }
    
    // Complex {expr} - recursively substitute and evaluate
    const subst = substituteVariables(inner, scope, false);
    try {
      const evaluated = Function('"use strict"; return (' + subst + ')')();
      return String(evaluated);
    } catch (err) {
      console.error(`[EXECUTOR] Failed to eval {${inner}}: ${err.message}`);
      return match;
    }
  });

  // Plain variables
  const varRefs = parser.extractVariableReferences(result);
  varRefs.sort((a, b) => b.length - a.length);

  for (const varRef of varRefs) {
    if (varRef in scope) {
      const value = scope[varRef];
      let valueStr;
      if (typeof value === 'boolean') {
        valueStr = value ? '1' : '0';
      } else if (typeof value === 'string') {
        valueStr = inStringLiteral ? value : `'${value.replace(/'/g, "\\'")}'`;
      } else if (typeof value === 'number') {
        valueStr = String(value);
      } else {
        valueStr = String(value);
      }
      
      const regex = new RegExp(`\\b${varRef}\\b`, 'g');
      result = result.replace(regex, valueStr);
    }
  }
  
  // Evaluate if needed (expression in string literal with operators)
  if (shouldEvaluate) {
    try {
      const evaluated = Function('"use strict"; return (' + result + ')')();
      result = String(evaluated);
    } catch (err) {
      // Keep as-is if evaluation fails
    }
  }

  return result;
}

/**
 * Parse a command string and substitute variables
 * @param {string} command - Raw command string
 * @param {Object} page - Page config with resolved variables
 * @returns {string} Parsed command with substitutions
 */
function parseCommandString(command, page) {
  const parsed = parser.parseCommand(command);
  const scope = page?._resolved || {};
  
  let result = "";
  let accumulatedLiteral = "";
  
  for (const segment of parsed.segments) {
    if (segment.type === "literal") {
      accumulatedLiteral += segment.value;
      result += segment.value;
    } else if (segment.type === "expression") {
      // Check if we're inside a string literal by counting quotes
      const singleQuotes = (accumulatedLiteral.match(/'/g) || []).length;
      const inStringLiteral = singleQuotes % 2 === 1;
      
      const substituted = substituteVariables(segment.value, scope, inStringLiteral);
      result += substituted;
      accumulatedLiteral += substituted;
    }
  }
  
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
    console.log(`[EXECUTOR] Executing command: ${command}`);
    
    if (!page) {
      throw new Error("No page provided to executeCommand");
    }

    // Validate the command first
    const validation = parser.validateExpression(command);
    if (!validation.ok) {
      throw new Error(`Syntax error in command: ${validation.errors.join(", ")}`);
    }

    // Parse and substitute variables in the command
    let parsedCommand = parseCommandString(command, page);
    
    // Extract variable references to check what's needed
    const varRefs = parser.extractVariableReferences(command);
    
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
    
    // Build and execute the function
    // We use a function to safely evaluate the command with the context
    try {
      const functionCode = `return (async () => { return ${parsedCommand}; })()`;
      const func = new Function(...Object.keys(context), functionCode);
      const result = await func(...Object.values(context));
      return result;
    } catch (syntaxError) {
      console.error(`[EXECUTOR] Syntax error executing: ${parsedCommand}`);
      console.error(`[EXECUTOR] Error:`, syntaxError);
      throw syntaxError;
    }
  } catch (error) {
    console.error(`[EXECUTOR] Error executing command:`, error);
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
      console.error(`[EXECUTOR] Command execution failed:`, error);
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
    
    // Initialize tracking for modified variables
    page._modifiedVars = new Set();
    
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
    
      console.log(`[EXECUTOR] Variables resolved for commands (${usedVars.size} used)`);

    // Execute the commands
    const results = await executeCommands(commands, page);    // After commands execute, resolve variables that were affected by integrations or modified by setValue/addValue
    const affectedVars = getAffectedVariables(commands, page.variables);
    
    // Track variables that were directly modified by setValue/addValue
    const directlyModified = new Set();
    if (page._modifiedVars && page._modifiedVars.size > 0) {
      for (const modifiedVar of page._modifiedVars) {
        directlyModified.add(modifiedVar);
        affectedVars.add(modifiedVar);
      }
    }
    
    // Find all variables that depend on affected/modified variables
    const allAffected = getDependentVariables(page.variables, affectedVars);
    
    if (allAffected.size > 0) {
      console.log(`[EXECUTOR] Re-resolving ${allAffected.size} affected variables and their dependents`);
      // Update old values before re-resolving
      const currentResolved = { ...page._resolved };
      const updatedResolved = await resolveVariables(page.variables, globalVariables, (varName, value) => {
        const oldValue = currentResolved[varName];
        // Always call callback for directly modified variables, or if value changed
        if (directlyModified.has(varName) || (oldValue !== value && onVariableResolved)) {
          if (onVariableResolved) {
            onVariableResolved(varName, value);
          }
        }
      }, allAffected);
      page._resolved = updatedResolved;
    }
    
    // Clean up modified vars tracking
    page._modifiedVars = new Set();
    
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
