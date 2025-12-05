/**
 * Expression and Command Parser
 * Handles parsing, tokenizing, and validating expressions and commands
 */

/**
 * Tokenize an expression into meaningful parts
 * @param {string} expression - Expression to tokenize
 * @returns {Array<Object>} Array of tokens with type and value
 */
export function tokenize(expression) {
  const tokens = [];
  let current = 0;
  const length = expression.length;

  while (current < length) {
    const char = expression[current];

    // Skip whitespace
    if (/\s/.test(char)) {
      current++;
      continue;
    }

    // Numbers
    if (/\d/.test(char)) {
      let value = "";
      while (current < length && (/\d/.test(expression[current]) || expression[current] === ".")) {
        value += expression[current];
        current++;
      }
      tokens.push({ type: "NUMBER", value: parseFloat(value) });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_$]/.test(char)) {
      let value = "";
      while (current < length && /[a-zA-Z0-9_$]/.test(expression[current])) {
        value += expression[current];
        current++;
      }
      tokens.push({ type: "IDENTIFIER", value });
      continue;
    }

    // Operators
    if ("+-*/%".includes(char)) {
      tokens.push({ type: "OPERATOR", value: char });
      current++;
      continue;
    }

    // Comparison operators
    if ("=<>!".includes(char)) {
      let value = char;
      if (current + 1 < length && "=<>".includes(expression[current + 1])) {
        value += expression[current + 1];
        current += 2;
      } else {
        current++;
      }
      tokens.push({ type: "COMPARISON", value });
      continue;
    }

    // Parentheses
    if ("()".includes(char)) {
      tokens.push({ type: char === "(" ? "LPAREN" : "RPAREN", value: char });
      current++;
      continue;
    }

    // Brackets
    if ("[]".includes(char)) {
      tokens.push({ type: char === "[" ? "LBRACKET" : "RBRACKET", value: char });
      current++;
      continue;
    }

    // Comma
    if (char === ",") {
      tokens.push({ type: "COMMA", value: char });
      current++;
      continue;
    }

    // Unknown character
    current++;
  }

  return tokens;
}

/**
 * Parse a command string with variable substitution
 * @param {string} command - Raw command string
 * @returns {Object} Parsed command with segments
 */
export function parseCommand(command) {
  const segments = [];
  let current = 0;
  let stringPart = "";

  while (current < command.length) {
    const char = command[current];

    // Look for {expression} blocks
    if (char === "{") {
      if (stringPart) {
        segments.push({ type: "literal", value: stringPart });
        stringPart = "";
      }

      // Find matching }
      let depth = 1;
      let expr = "";
      current++;
      while (current < command.length && depth > 0) {
        if (command[current] === "{") depth++;
        if (command[current] === "}") depth--;
        if (depth > 0) expr += command[current];
        current++;
      }

      if (depth === 0) {
        segments.push({ type: "expression", value: expr.trim() });
      } else {
        console.warn("Unmatched { in command");
        stringPart += "{" + expr;
      }
    } else {
      stringPart += char;
      current++;
    }
  }

  if (stringPart) {
    segments.push({ type: "literal", value: stringPart });
  }

  return {
    raw: command,
    segments,
    hasExpressions: segments.some(s => s.type === "expression"),
  };
}

/**
 * Extract function calls from a command
 * @param {string} command - Command string
 * @returns {Array<Object>} Array of function calls
 */
export function extractFunctionCalls(command) {
  const calls = [];
  const functionRegex = /([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*\(/g;
  let match;

  while ((match = functionRegex.exec(command)) !== null) {
    const functionName = match[1];
    const startPos = match.index;
    
    // Find matching closing parenthesis
    let depth = 0;
    let endPos = match.index + match[0].length - 1;
    
    for (let i = endPos; i < command.length; i++) {
      if (command[i] === "(") depth++;
      if (command[i] === ")") {
        depth--;
        if (depth === 0) {
          endPos = i;
          break;
        }
      }
    }

    const fullCall = command.substring(startPos, endPos + 1);
    const args = command.substring(startPos + functionName.length + 1, endPos);

    calls.push({
      name: functionName,
      fullCall,
      args: args.trim(),
      startPos,
      endPos,
    });
  }

  return calls;
}

/**
 * Parse function arguments into an array
 * @param {string} argsString - Arguments string (e.g., "1d20 + 5, true, 'name'")
 * @returns {Array} Parsed arguments
 */
export function parseFunctionArgs(argsString) {
  if (!argsString.trim()) return [];

  const args = [];
  let current = "";
  let depth = 0;
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];

    // Handle string boundaries
    if ((char === '"' || char === "'") && argsString[i - 1] !== "\\") {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
    }

    // Track nesting depth
    if (!inString) {
      if ("([{".includes(char)) depth++;
      if (")]}".includes(char)) depth--;

      // Split on comma at depth 0
      if (char === "," && depth === 0) {
        args.push(current.trim());
        current = "";
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}

/**
 * Validate an expression for basic syntax errors
 * @param {string} expression - Expression to validate
 * @returns {Object} Validation result with ok flag and errors
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

  // Check for consecutive operators
  if (/([\+\-\*\/%])\s*([\+\-\*\/%])/.test(expression)) {
    errors.push("Consecutive operators detected");
  }

  return {
    ok: errors.length === 0,
    errors,
    valid: errors.length === 0,
  };
}

/**
 * Sanitize a variable name
 * @param {string} varName - Variable name
 * @returns {string} Sanitized name
 */
export function sanitizeVariableName(varName) {
  return varName.replace(/[^a-zA-Z0-9_$]/g, "_");
}

/**
 * Check if a string is a valid variable reference
 * @param {string} str - String to check
 * @returns {boolean} Whether it's a valid variable reference
 */
export function isValidVariableName(str) {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(str);
}

/**
 * Extract variable references from an expression
 * @param {string} expression - Expression string
 * @returns {Array<string>} Array of variable names
 */
export function extractVariableReferences(expression) {
  const varRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
  const matches = new Set();
  let match;

  // Filter out JavaScript keywords
  const keywords = new Set([
    "if", "else", "for", "while", "do", "switch", "case", "break",
    "continue", "return", "function", "const", "let", "var", "true",
    "false", "null", "undefined", "new", "this", "super", "class",
    "extends", "static", "async", "await", "import", "export"
  ]);

  while ((match = varRegex.exec(expression)) !== null) {
    const varName = match[1];
    if (!keywords.has(varName)) {
      matches.add(varName);
    }
  }

  return Array.from(matches);
}

export default {
  tokenize,
  parseCommand,
  extractFunctionCalls,
  parseFunctionArgs,
  validateExpression,
  sanitizeVariableName,
  isValidVariableName,
  extractVariableReferences,
};
