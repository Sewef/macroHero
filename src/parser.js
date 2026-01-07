/**
 * Parser - Minimal version for Pure JavaScript edition
 * 
 * No complex parsing needed - commands are pure JavaScript.
 * Just keep utility functions for compatibility.
 */

import { isDebugEnabled } from "./debugMode.js";

const debugLog = (...args) => isDebugEnabled('parser') && console.log(...args);
const debugWarn = (...args) => console.warn(...args);

/**
 * Validate an expression for basic syntax errors
 */
export function validateExpression(expression) {
  const errors = [];

  // Check for unmatched parentheses
  let parenDepth = 0;
  for (const char of expression) {
    if (char === "(") parenDepth++;
    if (char === ")") parenDepth--;
    if (parenDepth < 0) {
      errors.push("Unmatched closing parenthesis");
      break;
    }
  }
  if (parenDepth > 0) {
    errors.push("Unmatched opening parenthesis");
  }

  // Check for unmatched braces
  let braceDepth = 0;
  for (const char of expression) {
    if (char === "{") braceDepth++;
    if (char === "}") braceDepth--;
    if (braceDepth < 0) {
      errors.push("Unmatched closing brace");
      break;
    }
  }
  if (braceDepth > 0) {
    errors.push("Unmatched opening brace");
  }

  // Check for unmatched brackets
  let bracketDepth = 0;
  for (const char of expression) {
    if (char === "[") bracketDepth++;
    if (char === "]") bracketDepth--;
    if (bracketDepth < 0) {
      errors.push("Unmatched closing bracket");
      break;
    }
  }
  if (bracketDepth > 0) {
    errors.push("Unmatched opening bracket");
  }

  return {
    ok: errors.length === 0,
    errors,
    valid: errors.length === 0,
  };
}

/**
 * Simple command parser - just returns the command as-is
 * Kept for compatibility
 */
export function parseCommand(command) {
  return {
    raw: command,
    segments: [{ type: "code", value: command }],
    hasExpressions: true,
  };
}

/**
 * Extract variable references from code
 */
export function extractVariableReferences(code) {
  const matches = new Set();
  
  // Match variable names (excluding keywords)
  const keywords = new Set([
    "if", "else", "for", "while", "do", "switch", "case", "break",
    "continue", "return", "function", "const", "let", "var", "true",
    "false", "null", "undefined", "new", "this", "super", "class",
    "extends", "static", "async", "await", "import", "export", "typeof",
    "instanceof", "in", "of", "delete", "void", "yield"
  ]);
  
  const varRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
  let match;
  
  while ((match = varRegex.exec(code)) !== null) {
    const varName = match[1];
    if (!keywords.has(varName)) {
      matches.add(varName);
    }
  }
  
  return Array.from(matches);
}

/**
 * Check if a string is a valid variable name
 */
export function isValidVariableName(str) {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(str);
}

/**
 * Sanitize a variable name
 */
export function sanitizeVariableName(varName) {
  return varName.replace(/[^a-zA-Z0-9_$]/g, "_");
}

export default {
  parseCommand,
  validateExpression,
  extractVariableReferences,
  isValidVariableName,
  sanitizeVariableName,
};
