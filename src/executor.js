/**
 * Command Executor
 * Handles parsing and executing commands from the config
 */

import * as math from "mathjs";
import * as parser from "./parser.js";
import { resolveVariables, getAffectedVariables, getVariablesUsedInCommands, getDependentVariables } from "./expressionEvaluator.js";
import { updateRenderedValue } from "./ui.js";
import OBR from "@owlbear-rodeo/sdk";
import { ensureOBRReady } from "./config.js";
// --- LocalStorage helpers for evaluated variables ---
async function getRoomScopedEvaluatedVarsKey() {
  await ensureOBRReady();
  const roomId = (window.OBR && OBR.room && OBR.room.id) ? OBR.room.id : (OBR.room && typeof OBR.room.getId === 'function' ? await OBR.room.getId() : 'unknown');
  return `macroHero_evaluatedVariables_${roomId}`;
}

async function loadEvaluatedVariables() {
  const key = await getRoomScopedEvaluatedVarsKey();
  try {
    const json = localStorage.getItem(key);
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

async function saveEvaluatedVariable(pageIndex, varName, value) {
  const key = await getRoomScopedEvaluatedVarsKey();
  let allVars = {};
  try {
    allVars = localStorage.getItem(key) ? JSON.parse(localStorage.getItem(key)) : {};
  } catch {}
  if (!allVars[pageIndex]) allVars[pageIndex] = {};
  allVars[pageIndex][varName] = value;
  localStorage.setItem(key, JSON.stringify(allVars));
}

async function loadEvaluatedVariablesForPage(pageIndex) {
  const allVars = await loadEvaluatedVariables();
  return allVars[pageIndex] || {};
}
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

  // Find the page index if available (for localStorage keying)
  const pageIndex = page && typeof page._pageIndex !== 'undefined' ? page._pageIndex : 0;

  return {
    // Integrations from Manager
    ...integrations,
    
    // Expose all mathjs functions directly (floor, ceil, sqrt, etc.)
    ...math,
      // Include resolved page variables so commands can reference them directly
      // e.g., a command using `skillModifier` will find it in the function context
      ...(page && page._resolved ? { ...page._resolved } : {}),
    // Variable manipulation functions
    setValue: async (varName, value) => {
      if (!page.variables || !(varName in page.variables)) {
        throw new Error(`Variable "${varName}" not found in current page`);
      }
      const variable = page.variables[varName];
      let newValue = value;
      if (variable.min !== undefined && newValue < variable.min) {
        newValue = variable.min;
      }
      if (variable.max !== undefined && newValue > variable.max) {
        newValue = variable.max;
      }
      // Only update resolved value, not the config/JSON
      variable.expression = newValue; // Keep variable.expression in sync
      page._resolved[varName] = newValue;
      page._modifiedVars.add(varName);
      await saveEvaluatedVariable(pageIndex, varName, newValue);
      // Trigger UI update for Input/Value items
      if (typeof updateRenderedValue === 'function') {
        updateRenderedValue(varName, newValue);
      }
      console.log(`[setValue] ${varName} = ${newValue} (persisted in localStorage)`);
      return newValue;
    },
    addValue: async (varName, delta) => {
      if (!page.variables || !(varName in page.variables)) {
        throw new Error(`Variable "${varName}" not found in current page`);
      }
      const variable = page.variables[varName];
      const currentValue = Number(page._resolved[varName]) || 0;
      let newValue = currentValue + Number(delta);
      if (variable.min !== undefined && newValue < variable.min) {
        newValue = variable.min;
      }
      if (variable.max !== undefined && newValue > variable.max) {
        newValue = variable.max;
      }
      variable.expression = newValue; // Keep variable.expression in sync
      page._resolved[varName] = newValue;
      page._modifiedVars.add(varName);
      await saveEvaluatedVariable(pageIndex, varName, newValue);
      // Trigger UI update for Input/Value items
      if (typeof updateRenderedValue === 'function') {
        updateRenderedValue(varName, newValue);
      }
      console.log(`[addValue] ${varName} += ${delta} => ${newValue} (persisted in localStorage)`);
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
        if (val === null || val === undefined || val === "") {
          // If not in string literal, treat as 0 for math
          return inStringLiteral ? "" : "0";
        }
        if (typeof val === 'boolean') return val ? '1' : '0';
        if (typeof val === 'number') return String(val);
        if (typeof val === 'string') return inStringLiteral ? val : `'${val.replace(/'/g, "\\'")}'`;
        return String(val);
      }
      // If variable is missing, treat as 0 in math context
      return inStringLiteral ? "" : "0";
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

    // Extra pass: rewrite specific patterns where an awaited string is added to a number/var
    // e.g. (await GoogleSheets.getValue(...)) + 1  =>  String((await GoogleSheets.getValue(...))) + ' + ' + String(1)
    const awaitedAddPattern = /(\(await\s+[^\)]+\))\s*\+\s*(String\([^\)]+\)|Number\([^\)]+\)|'[^']*'|"[^"]*"|\d+|\w+)/g;
    let m;
    let replacedAny = false;
    parsedCommand = parsedCommand.replace(awaitedAddPattern, (match, left, right) => {
      replacedAny = true;
      const replacement = `String(${left}) + ' + ' + String(${right})`;
      console.log('[EXECUTOR] awaitedAddPattern match:', match, '=>', replacement);
      return replacement;
    });
    console.log('[EXECUTOR] awaitedAddPattern replacedAny=', replacedAny, 'parsedCommand now:', parsedCommand);

    // Robust rewrite: transform JustDices.roll(args_with_top_level_plus) to force string 'left + right'
    function rewriteJustDicesRollArgs(str) {
      console.log('[EXECUTOR] rewriteJustDicesRollArgs start');
      let i = 0;
      let found = false;

      while ((i = str.indexOf('JustDices.roll', i)) !== -1) {
        const open = str.indexOf('(', i + 'JustDices.roll'.length);
        if (open === -1) break;
        // find matching closing paren for this call
        let depth = 0;
        let inS = false;
        let inD = false;
        let close = -1;
        for (let j = open; j < str.length; j++) {
          const ch = str[j];
          if (ch === "'" && !inD) inS = !inS;
          else if (ch === '"' && !inS) inD = !inD;
          if (inS || inD) continue;
          if (ch === '(') depth++;
          else if (ch === ')') {
            depth--;
            if (depth === 0) { close = j; break; }
          }
        }
        if (close === -1) break;

        const args = str.slice(open + 1, close);
        // find top-level + inside args
        let plusIdx = -1;
        depth = 0;
        inS = false;
        inD = false;
        for (let k = 0; k < args.length; k++) {
          const ch = args[k];
          if (ch === "'" && !inD) inS = !inS;
          else if (ch === '"' && !inS) inD = !inD;
          if (inS || inD) continue;
          if (ch === '(') depth++;
          else if (ch === ')') depth--;
          else if (ch === '+' && depth === 0) { plusIdx = k; break; }
        }

        if (plusIdx !== -1) {
          const left = args.slice(0, plusIdx).trim();
          const right = args.slice(plusIdx + 1).trim();
          console.log('[EXECUTOR] JustDices.roll arg top-level + found; left:', left, 'right:', right);

          // Heuristic: perform rewrite for common cases (await, String(), Number(), numeric literal, quoted string, identifier)
          const should = (/\bawait\b/.test(left) || /\bawait\b/.test(right) || /\bString\s*\(/.test(left) || /\bString\s*\(/.test(right) || /\bNumber\s*\(/.test(left) || /\bNumber\s*\(/.test(right) || /^\d+$/.test(right) || /^\d+d\d+/i.test(left) || /^['"]/.test(left) || /^[a-zA-Z_$][a-zA-Z0-9_$]*/.test(left));

          console.log('[EXECUTOR] rewrite heuristic:', should);
          if (should) {
            const newArgs = `String(${left}) + ' + ' + String(${right})`;
            str = str.slice(0, open + 1) + newArgs + str.slice(close);
            found = true;
            console.log('[EXECUTOR] Rewrote JustDices.roll args to:', newArgs);
            // advance index past this call
            i = open + 1 + newArgs.length + 1;
            continue;
          }
        }

        i = close + 1;
      }

      console.log('[EXECUTOR] rewriteJustDicesRollArgs end, found=', found);
      return str;
    }

    // Apply this rewrite before final execution
    parsedCommand = rewriteJustDicesRollArgs(parsedCommand);
    console.log('[EXECUTOR] parsedCommand after JustDices.roll arg rewrite:', parsedCommand);

    // Debug: show the parsed command after async wrapping
    console.log('[EXECUTOR] Parsed command after async wrapping:', parsedCommand);
    console.log('[EXECUTOR] Detected async methods:', asyncMethods);

    // Build and execute the function
    // We use a function to safely evaluate the command with the context
    try {
      // If the command contains multiple statements, execute them and return the last expression's value
      let finalCommand = parsedCommand;
      if (/;|\\n/.test(parsedCommand)) {
        const parts = parsedCommand.split(';').map(p => p.trim()).filter(p => p.length > 0);
        if (parts.length > 1) {
          const last = parts.pop();
          const body = parts.join(';') + (parts.length ? ';' : '');
          finalCommand = `(async () => { ${body} return (${last}); })()`;
        }
      }

      // Debug: show the final command that will be executed
      console.log('[EXECUTOR] Final command to execute:', finalCommand);

      const functionCode = `return (async () => { return ${finalCommand}; })()`;
      const func = new Function(...Object.keys(context), functionCode);
      console.log('[EXECUTOR] Invoking command function...');
      const result = await func(...Object.values(context));
      console.log('[EXECUTOR] Command invocation result:', result);
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
export async function executeCommands(commands, page, onVariableResolved = null) {
  const results = [];

  // If there are multiple commands, join them into a single semicolon-separated command
  // so variables assigned in earlier statements are visible to later statements.
  if (commands.length > 1) {
    try {
      const combined = commands.join('; ');
      console.log('[EXECUTOR] Executing combined commands:', combined);
      const result = await executeCommand(combined, page);
      results.push({ ok: true, result });
    } catch (error) {
      console.error('[EXECUTOR] Combined command execution failed:', error);
      results.push({ ok: false, error: error.message });
    }
    return results;
  }

  for (const command of commands) {
    try {
      const result = await executeCommand(command, page, onVariableResolved);
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
    
    // Resolve all page variables to ensure they are available for command execution
    // Pass the callback so UI updates for these variables too
    console.log("[EXECUTOR] Resolving all page variables for command execution...");
    console.log('[EXECUTOR] page.variables keys:', Object.keys(page.variables || {}));
    console.log('[EXECUTOR] oldResolved before resolving:', oldResolved);
    console.log('[EXECUTOR] usedVars detected:', Array.from(usedVars));
    const freshResolved = await resolveVariables(page.variables, globalVariables, (varName, value) => {
      const oldValue = oldResolved[varName];
      if (oldValue !== value && onVariableResolved) {
        onVariableResolved(varName, value);
      }
    });
    console.log('[EXECUTOR] freshResolved from resolveVariables:', freshResolved);
    page._resolved = { ...page._resolved, ...freshResolved };
    console.log('[EXECUTOR] page._resolved after merge:', page._resolved);
    
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
