import { parse, parseExpressionAt } from "acorn";

const JS_PARSE_OPTIONS = {
  ecmaVersion: "latest",
  sourceType: "script",
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
};

const RESERVED_IDENTIFIERS = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "export", "extends", "false", "finally",
  "for", "function", "if", "import", "in", "instanceof", "let", "new", "null",
  "return", "static", "super", "switch", "this", "throw", "true", "try",
  "typeof", "var", "void", "while", "with", "yield",
]);

export function migrateMatrixSettings(config) {
  let count = 0;
  for (const page of config.pages || []) {
    walkLayout(page.layout, item => {
      if (typeof item.type !== "string" || item.type.toLowerCase() !== "matrix") return;
      let changed = false;
      for (const property of ["buttonSize", "gap"]) {
        if (!Object.prototype.hasOwnProperty.call(item, property)) continue;
        delete item[property];
        changed = true;
      }
      if (changed) count++;
    });
  }
  return {
    migrated: count > 0,
    messages: count ? [`Removed obsolete size and gap settings from ${count} ${count === 1 ? "matrix" : "matrices"}.`] : [],
  };
}

export function migrateConfigV2ToV3(config) {
  const messages = [];
  const writableComputed = prepareWritableComputedOverrides(config, messages);
  const globalRename = normalizeVariableNames(config.global, "global", messages);
  const variableRenames = {
    global: changedRenames(globalRename),
    pages: {},
  };

  (config.pages || []).forEach((page, pageIndex) => {
    const pageLabel = page.label || page.id || `Page ${pageIndex + 1}`;
    const pageRename = normalizeVariableNames(page, pageLabel, messages);
    variableRenames.pages[page.id || String(pageIndex)] = changedRenames(pageRename);
    const scope = createMigrationScope(
      config.global,
      page,
      globalRename,
      pageRename,
      writableComputed.global,
      writableComputed.pages.get(page) || new Map(),
    );

    migrateComputedExpressions(page.computed, scope, `${pageLabel} computed`, messages);
    walkLayout(page.layout, item => {
      if (typeof item.var === "string") {
        item.var = pageRename.get(item.var) || globalRename.get(item.var) || item.var;
      }
      for (const property of ["label", "text", "content", "tooltip", "placeholder"]) {
        if (typeof item[property] === "string" && item[property].includes("${")) {
          item[property] = migrateTemplateExpressions(item[property], scope, `${pageLabel} ${property}`, messages);
        }
      }
      for (const property of ["onclick", "onrightclick", "onupdate"]) {
        if (!Array.isArray(item[property])) continue;
        const migratedScript = migrateJavaScript(
          item[property].map(String).join("\n"),
          scope,
          false,
          `${pageLabel} ${property}`,
          messages,
        );
        item[property] = migratedScript.split("\n");
      }
    });
  });

  const globalScope = createMigrationScope(
    config.global,
    null,
    globalRename,
    new Map(),
    writableComputed.global,
    new Map(),
  );
  migrateComputedExpressions(config.global?.computed, globalScope, "Global computed", messages);

  return { migrated: true, messages, variableRenames };
}

function prepareWritableComputedOverrides(config, messages) {
  const globalWrites = new Set();
  const pageWrites = new Map();

  (config.pages || []).forEach(page => {
    const writes = collectLegacyHelperTargets(page.layout);
    pageWrites.set(page, writes);
    for (const name of writes) {
      if (Object.prototype.hasOwnProperty.call(page.state || {}, name)) continue;
      if (Object.prototype.hasOwnProperty.call(page.computed || {}, name)) continue;
      if (Object.prototype.hasOwnProperty.call(config.global?.computed || {}, name)
        && !Object.prototype.hasOwnProperty.call(config.global?.state || {}, name)) {
        globalWrites.add(name);
      }
    }
  });

  const global = createComputedOverrides(config.global, globalWrites, "Global", messages);
  const pages = new Map();
  for (const page of config.pages || []) {
    const pageComputedWrites = new Set(
      [...(pageWrites.get(page) || [])].filter(name => (
        Object.prototype.hasOwnProperty.call(page.computed || {}, name)
        && !Object.prototype.hasOwnProperty.call(page.state || {}, name)
      )),
    );
    pages.set(page, createComputedOverrides(page, pageComputedWrites, page.label || page.id || "Page", messages));
  }
  return { global, pages };
}

function collectLegacyHelperTargets(layout) {
  const targets = new Set();
  walkLayout(layout, item => {
    for (const property of ["onclick", "onrightclick", "onupdate"]) {
      const source = Array.isArray(item[property]) ? item[property].join("\n") : "";
      for (const match of source.matchAll(/(?:^|[^.\w$])(?:setValue|addValue)\s*\(\s*(['"])([A-Za-z_$][A-Za-z0-9_$]*)\1/g)) {
        targets.add(match[2]);
      }
    }
  });
  return targets;
}

function createComputedOverrides(scope, writtenNames, scopeLabel, messages) {
  const overrides = new Map();
  if (!scope) return overrides;
  if (!scope.state) scope.state = {};
  const used = new Set([...Object.keys(scope.state), ...Object.keys(scope.computed || {})]);

  for (const name of writtenNames) {
    const entry = scope.computed?.[name];
    if (entry === undefined) continue;
    let overrideName = `${name}Override`;
    let suffix = 2;
    while (used.has(overrideName)) {
      overrideName = `${name}Override${suffix}`;
      suffix += 1;
    }
    used.add(overrideName);

    const expression = typeof entry === "string" ? entry : entry?.eval;
    const constraints = typeof entry === "object" && entry
      ? Object.fromEntries(["min", "max"].filter(key => entry[key] !== undefined).map(key => [key, entry[key]]))
      : {};
    scope.state[overrideName] = { default: null, ...constraints };
    if (typeof entry === "string") {
      scope.computed[name] = `${overrideName} ?? (${expression})`;
    } else {
      scope.computed[name] = { ...entry, eval: `${overrideName} ?? (${expression})` };
    }
    overrides.set(name, overrideName);
    messages.push(`${scopeLabel}.${name} remains computed; legacy writes now use ${overrideName}.`);
  }

  return overrides;
}

export function repairConfigV3VariableCalls(config) {
  const messages = [];
  let repairedCount = 0;
  const globalState = new Set(Object.keys(config.global?.state || {}));

  (config.pages || []).forEach((page, pageIndex) => {
    const pageState = new Set(Object.keys(page.state || {}));
    const repairCommands = (commands, label, assign) => {
      if (!Array.isArray(commands) || commands.length === 0) return;
      const source = commands.map(String).join("\n");
      try {
        const terminated = terminateMigratedAssignmentLines(source);
        const repaired = rewriteStateVariableCalls(terminated.source, pageState, globalState);
        if (repaired.source !== source) {
          assign(repaired.source.split("\n"));
          repairedCount += repaired.count + terminated.count;
        }
      } catch (error) {
        const pageLabel = page.label || page.id || `Page ${pageIndex + 1}`;
        messages.push(`${pageLabel} ${label} could not be checked for v3 variable calls: ${error.message}`);
      }
    };
    walkLayout(page.layout, item => {
      for (const property of ["onclick", "onrightclick", "onupdate"]) {
        repairCommands(item[property], property, value => { item[property] = value; });
      }
    });
    (page.hooks || []).forEach((hook, hookIndex) => {
      repairCommands(hook?.commands, `event ${hook?.id || hookIndex + 1}`, value => { hook.commands = value; });
    });
  });

  if (repairedCount > 0) {
    messages.unshift(`${repairedCount} function-style variable update${repairedCount === 1 ? "" : "s"} repaired for v3.`);
  }
  return { migrated: repairedCount > 0, messages };
}

const HOOK_API_RENAMES = [
  [/\bTokenMetadata\.onChange(?=\s*\()/g, "Token.onMetadataChange"],
  [/\bSceneMetadata\.onChange(?=\s*\()/g, "Scene.onMetadataChange"],
  [/\bRoomMetadata\.onChange(?=\s*\()/g, "Room.onMetadataChange"],
  [/\bPlayerMetadata\.onChange(?=\s*\()/g, "Player.onMetadataChange"],
];

export function repairConfigV3HookApis(config) {
  let repairedCount = 0;
  for (const page of config.pages || []) {
    for (const hook of page.hooks || []) {
      if (typeof hook?.watch !== "string") continue;
      let watch = hook.watch;
      for (const [pattern, replacement] of HOOK_API_RENAMES) {
        watch = watch.replace(pattern, () => {
          repairedCount += 1;
          return replacement;
        });
      }
      hook.watch = watch;
    }
  }
  return {
    migrated: repairedCount > 0,
    messages: repairedCount > 0
      ? [`${repairedCount} metadata event API reference${repairedCount === 1 ? "" : "s"} updated.`]
      : [],
  };
}

function terminateMigratedAssignmentLines(source) {
  let count = 0;
  const repaired = source.split("\n").map(line => {
    const match = line.match(/^(\s*)\(((?:Page|Global)\.[A-Za-z_$][A-Za-z0-9_$]*\s*[+\-*/%]?=[\s\S]*)\)\s*;*\s*$/);
    if (match) {
      count += 1;
      return `${match[1]}${match[2]};`;
    }
    return line;
  }).join("\n");
  return { source: repaired, count };
}

function rewriteStateVariableCalls(source, pageState, globalState) {
  const ast = parseJavaScript(source, false);
  const replacements = [];
  walkAst(ast, null, (node, parent, ancestors) => {
    if (node.type !== "CallExpression" || node.arguments.length !== 1) return true;
    const callee = node.callee;
    if (callee?.type !== "MemberExpression" || callee.computed) return true;
    if (callee.object?.type !== "Identifier" || callee.property?.type !== "Identifier") return true;

    const namespace = callee.object.name;
    const variableName = callee.property.name;
    const isState = namespace === "Page"
      ? pageState.has(variableName)
      : namespace === "Global" && globalState.has(variableName);
    if (!isState) return true;

    const argument = source.slice(node.arguments[0].start, node.arguments[0].end);
    const grandparent = ancestors.at(-2);
    const statementNode = parent?.type === "ExpressionStatement"
      ? parent
      : (parent?.type === "AwaitExpression" && grandparent?.type === "ExpressionStatement" ? grandparent : null);
    const targetNode = statementNode || (parent?.type === "AwaitExpression" && parent.argument === node ? parent : node);
    replacements.push({
      from: targetNode.start,
      to: targetNode.end,
      text: statementNode
        ? `${namespace}.${variableName} += Number(${argument});`
        : `(${namespace}.${variableName} += Number(${argument}))`,
    });
    return false;
  });
  return { source: applyReplacements(source, replacements), count: replacements.length };
}

function changedRenames(renameMap) {
  return Object.fromEntries([...renameMap].filter(([previous, next]) => previous !== next));
}

function migrateTemplateExpressions(template, scope, label, messages) {
  return template.replace(/\$\{([^{}]+)\}/g, (match, expression) => {
    const migrated = migrateJavaScript(expression, scope, true, label, messages);
    return `\${${migrated}}`;
  });
}

function normalizeVariableNames(scope, scopeLabel, messages) {
  const rename = new Map();
  const used = new Set();

  for (const kind of ["state", "computed"]) {
    const entries = scope?.[kind] || {};
    const normalized = {};
    for (const [name, entry] of Object.entries(entries)) {
      const nextName = uniqueIdentifier(name, used);
      rename.set(name, nextName);
      normalized[nextName] = entry;
      if (nextName !== name) {
        messages.push(`${scopeLabel}: variable "${name}" renamed to "${nextName}" for v3 JavaScript access.`);
      }
    }
    if (scope) scope[kind] = normalized;
  }

  return rename;
}

function uniqueIdentifier(name, used) {
  let base = String(name || "variable")
    .trim()
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/^([^A-Za-z_$])/, "_$1")
    .replace(/^_+$/, "variable");
  if (!base) base = "variable";
  if (RESERVED_IDENTIFIERS.has(base)) base = `${base}_value`;

  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function createMigrationScope(global, page, globalRename, pageRename, globalOverrides = new Map(), pageOverrides = new Map()) {
  const resolution = new Map();
  const writeResolution = new Map();
  for (const name of [...Object.keys(global?.state || {}), ...Object.keys(global?.computed || {})]) {
    resolution.set(name, `Global.${name}`);
  }
  for (const [oldName, newName] of globalRename) resolution.set(oldName, `Global.${newName}`);
  for (const name of Object.keys(global?.state || {})) {
    writeResolution.set(name, { target: `Global.${name}` });
  }
  for (const [oldName, newName] of globalRename) {
    if (Object.prototype.hasOwnProperty.call(global?.state || {}, newName)) {
      writeResolution.set(oldName, { target: `Global.${newName}` });
    }
  }
  for (const [computedName, overrideName] of globalOverrides) {
    const nextComputed = globalRename.get(computedName) || computedName;
    const nextOverride = globalRename.get(overrideName) || overrideName;
    const target = { target: `Global.${nextOverride}`, fallback: `Global.${nextComputed}` };
    writeResolution.set(computedName, target);
    writeResolution.set(nextComputed, target);
  }

  if (page) {
    for (const name of [...Object.keys(page.state || {}), ...Object.keys(page.computed || {})]) {
      resolution.set(name, `Page.${name}`);
    }
    for (const [oldName, newName] of pageRename) resolution.set(oldName, `Page.${newName}`);
    for (const name of Object.keys(page.state || {})) {
      writeResolution.set(name, { target: `Page.${name}` });
    }
    for (const [oldName, newName] of pageRename) {
      if (Object.prototype.hasOwnProperty.call(page.state || {}, newName)) {
        writeResolution.set(oldName, { target: `Page.${newName}` });
      }
    }
    for (const [computedName, overrideName] of pageOverrides) {
      const nextComputed = pageRename.get(computedName) || computedName;
      const nextOverride = pageRename.get(overrideName) || overrideName;
      const target = { target: `Page.${nextOverride}`, fallback: `Page.${nextComputed}` };
      writeResolution.set(computedName, target);
      writeResolution.set(nextComputed, target);
    }
  }

  return { resolution, writeResolution };
}

function migrateComputedExpressions(computed = {}, scope, label, messages) {
  for (const [name, entry] of Object.entries(computed || {})) {
    if (typeof entry === "string") {
      computed[name] = migrateJavaScript(entry, scope, true, `${label}.${name}`, messages);
    } else if (entry && typeof entry.eval === "string") {
      entry.eval = migrateJavaScript(entry.eval, scope, true, `${label}.${name}`, messages);
    }
  }
}

function migrateJavaScript(source, scope, expression, label, messages) {
  if (!source.trim()) return source;
  try {
    const withoutHelpers = rewriteLegacyHelpers(source, scope, expression);
    return rewriteVariableReferences(withoutHelpers, scope, expression);
  } catch (error) {
    messages.push(`${label} could not be migrated automatically: ${error.message}`);
    return source;
  }
}

function rewriteLegacyHelpers(source, scope, expression) {
  const ast = parseJavaScript(source, expression);
  const replacements = [];

  walkAst(ast, null, (node, parent, ancestors) => {
    if (node.type !== "CallExpression" || node.callee?.type !== "Identifier") return true;
    if (node.callee.name !== "setValue" && node.callee.name !== "addValue") return true;
    if (node.arguments.length < 2) throw new Error(`${node.callee.name} requires a variable and a value`);

    const firstArg = node.arguments[0];
    const secondArg = node.arguments[1];
    const migratedValue = rewriteVariableReferences(
      source.slice(secondArg.start, secondArg.end),
      scope,
      true,
    );
    const grandparent = ancestors.at(-2);
    const statementNode = parent?.type === "ExpressionStatement"
      ? parent
      : (parent?.type === "AwaitExpression" && grandparent?.type === "ExpressionStatement" ? grandparent : null);
    const targetNode = statementNode || (parent?.type === "AwaitExpression" && parent.argument === node ? parent : node);
    const replacement = legacyHelperReplacement(
      node.callee.name,
      firstArg,
      migratedValue,
      source,
      scope,
      Boolean(statementNode),
    );
    replacements.push({ from: targetNode.start, to: targetNode.end, text: replacement });
    return false;
  });

  return applyReplacements(source, replacements);
}

function legacyHelperReplacement(helper, firstArg, migratedValue, source, scope, asStatement = false) {
  const literalName = firstArg.type === "Literal" && typeof firstArg.value === "string"
    ? firstArg.value
    : null;
  const writeTarget = literalName === null ? null : scope.writeResolution.get(literalName);

  if (writeTarget) {
    let expression;
    if (helper === "setValue") {
      expression = `${writeTarget.target} = ${migratedValue}`;
    } else if (writeTarget.fallback) {
      expression = `${writeTarget.target} = Number(${writeTarget.target} ?? ${writeTarget.fallback}) + Number(${migratedValue})`;
    } else {
      expression = `${writeTarget.target} += Number(${migratedValue})`;
    }
    return asStatement ? `${expression};` : `(${expression})`;
  }

  const nameExpression = rewriteVariableReferences(
    source.slice(firstArg.start, firstArg.end),
    scope,
    true,
  );
  if (helper === "setValue") {
    const expression = `((__name, __value) => Object.prototype.hasOwnProperty.call(Page, __name) ? (Page[__name] = __value) : (Global[__name] = __value))(${nameExpression}, ${migratedValue})`;
    return asStatement ? `${expression};` : expression;
  }
  const expression = `((__name, __delta) => Object.prototype.hasOwnProperty.call(Page, __name) ? (Page[__name] += Number(__delta)) : (Global[__name] += Number(__delta)))(${nameExpression}, ${migratedValue})`;
  return asStatement ? `${expression};` : expression;
}

function rewriteVariableReferences(source, scope, expression) {
  const ast = parseJavaScript(source, expression);
  const localNames = collectLocalNames(ast);
  const replacements = [];

  walkAst(ast, null, (node, parent) => {
    if (node.type !== "Identifier") return true;
    const qualified = scope.resolution.get(node.name);
    if (!qualified || localNames.has(node.name) || !isReferenceIdentifier(node, parent)) return true;

    if (parent?.type === "Property" && parent.shorthand && parent.value === node) {
      replacements.push({ from: node.start, to: node.end, text: `${node.name}: ${qualified}` });
    } else {
      replacements.push({ from: node.start, to: node.end, text: qualified });
    }
    return true;
  });

  return applyReplacements(source, replacements);
}

function parseJavaScript(source, expression) {
  if (expression) {
    const node = parseExpressionAt(source, 0, JS_PARSE_OPTIONS);
    if (!/^;*$/.test(source.slice(node.end).trim())) throw new Error("unexpected text after expression");
    return node;
  }
  return parse(source, JS_PARSE_OPTIONS);
}

function collectLocalNames(ast) {
  const names = new Set();
  walkAst(ast, null, node => {
    if (node.type === "VariableDeclarator") collectPatternNames(node.id, names);
    if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
      if (node.id) collectPatternNames(node.id, names);
      node.params.forEach(param => collectPatternNames(param, names));
    }
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      if (node.id) names.add(node.id.name);
    }
    if (node.type === "CatchClause" && node.param) collectPatternNames(node.param, names);
    return true;
  });
  return names;
}

function collectPatternNames(pattern, names) {
  if (!pattern) return;
  if (pattern.type === "Identifier") names.add(pattern.name);
  else if (pattern.type === "RestElement") collectPatternNames(pattern.argument, names);
  else if (pattern.type === "AssignmentPattern") collectPatternNames(pattern.left, names);
  else if (pattern.type === "ArrayPattern") pattern.elements.forEach(item => collectPatternNames(item, names));
  else if (pattern.type === "ObjectPattern") pattern.properties.forEach(property => {
    collectPatternNames(property.type === "RestElement" ? property.argument : property.value, names);
  });
}

function isReferenceIdentifier(node, parent) {
  if (!parent) return true;
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return false;
  if (parent.type === "Property" && parent.key === node && !parent.computed && !parent.shorthand) return false;
  if ((parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") && parent.key === node && !parent.computed) return false;
  if (parent.type === "VariableDeclarator" && parent.id === node) return false;
  if ((parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression" || parent.type === "ArrowFunctionExpression") && (parent.id === node || parent.params.includes(node))) return false;
  if ((parent.type === "ClassDeclaration" || parent.type === "ClassExpression") && parent.id === node) return false;
  if (parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") return false;
  return true;
}

function walkAst(node, parent, visitor, ancestors = []) {
  if (!node || typeof node !== "object" || typeof node.type !== "string") return;
  if (visitor(node, parent, ancestors) === false) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end" || key === "loc") continue;
    if (Array.isArray(value)) {
      value.forEach(child => walkAst(child, node, visitor, [...ancestors, node]));
    } else if (value && typeof value === "object" && typeof value.type === "string") {
      walkAst(value, node, visitor, [...ancestors, node]);
    }
  }
}

function applyReplacements(source, replacements) {
  const ordered = replacements
    .filter((replacement, index, all) => all.findIndex(other => other.from === replacement.from && other.to === replacement.to) === index)
    .sort((a, b) => b.from - a.from || b.to - a.to);
  let result = source;
  for (const { from, to, text } of ordered) {
    result = result.slice(0, from) + text + result.slice(to);
  }
  return result;
}

function walkLayout(items, visitor) {
  (items || []).forEach(item => {
    visitor(item);
    walkLayout(item.children, visitor);
  });
}
