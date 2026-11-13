import { deepClone } from "./utils.js";
import { migrateConfigV2ToV3, repairConfigV3VariableCalls } from "./configMigration.js";

export const CONFIG_SCHEMA_VERSION = 3;
export const GLOBAL_STATE_ID = "__global";

const ROOT_KEY_ORDER = ["schemaVersion", "global", "pages"];
const GLOBAL_KEY_ORDER = ["title", "width", "height", "state", "computed"];
const PAGE_KEY_ORDER = ["label", "id", "state", "computed", "layout"];
const ELEMENT_KEY_ORDER = [
  "type",
  "label",
  "text",
  "var",
  "placeholder",
  "options",
  "icon",
  "tooltip",
  "columns",
  "buttonSize",
  "buttonShape",
  "gap",
  "step",
  "height",
  "margin",
  "style",
  "border",
  "color",
  "borderColor",
  "onclick",
  "onrightclick",
  "onupdate",
  "children",
];
const STATE_ENTRY_KEY_ORDER = ["default", "min", "max"];
const COMPUTED_ENTRY_KEY_ORDER = ["eval", "min", "max"];

function uniqueId(base, used) {
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

const RESERVED_PAGE_KEYS = new Set(["__proto__", "prototype", "constructor", "then"]);

export function normalizePageId(value, fallback = "page") {
  let key = String(value || fallback)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_$]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key) key = fallback;
  if (!/^[A-Za-z_$]/.test(key)) key = `page_${key}`;
  if (RESERVED_PAGE_KEYS.has(key)) key = `page_${key}`;
  return key;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function orderObjectByKeys(source, preferredKeys, valueMapper = value => value) {
  if (!isPlainObject(source)) return source;
  const ordered = {};
  const handled = new Set();

  for (const key of preferredKeys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      ordered[key] = valueMapper(source[key], key);
      handled.add(key);
    }
  }

  Object.keys(source)
    .filter(key => !handled.has(key))
    .sort()
    .forEach(key => {
      ordered[key] = valueMapper(source[key], key);
    });

  return ordered;
}

function orderGenericValue(value) {
  if (Array.isArray(value)) return value.map(orderGenericValue);
  if (!isPlainObject(value)) return value;
  return orderObjectByKeys(value, [], orderGenericValue);
}

function orderStateEntries(entries = {}) {
  return orderObjectByKeys(entries, [], entry => (
    isPlainObject(entry)
      ? orderObjectByKeys(entry, STATE_ENTRY_KEY_ORDER, orderGenericValue)
      : entry
  ));
}

function orderComputedEntries(entries = {}) {
  return orderObjectByKeys(entries, [], entry => (
    isPlainObject(entry)
      ? orderObjectByKeys(entry, COMPUTED_ENTRY_KEY_ORDER, orderGenericValue)
      : entry
  ));
}

function orderLayoutItem(item) {
  if (!isPlainObject(item)) return orderGenericValue(item);
  return orderObjectByKeys(item, ELEMENT_KEY_ORDER, (value, key) => {
    if (key === "children") return Array.isArray(value) ? value.map(orderLayoutItem) : [];
    return orderGenericValue(value);
  });
}

function orderGlobalForExport(global = {}) {
  return orderObjectByKeys(global, GLOBAL_KEY_ORDER, (value, key) => {
    if (key === "state") return orderStateEntries(value);
    if (key === "computed") return orderComputedEntries(value);
    return orderGenericValue(value);
  });
}

function orderPageForExport(page = {}) {
  return orderObjectByKeys(page, PAGE_KEY_ORDER, (value, key) => {
    if (key === "state") return orderStateEntries(value);
    if (key === "computed") return orderComputedEntries(value);
    if (key === "layout") return Array.isArray(value) ? value.map(orderLayoutItem) : [];
    return orderGenericValue(value);
  });
}

function orderConfigForExport(cfg = {}) {
  return orderObjectByKeys(cfg, ROOT_KEY_ORDER, (value, key) => {
    if (key === "global") return orderGlobalForExport(value);
    if (key === "pages") return Array.isArray(value) ? value.map(orderPageForExport) : [];
    return orderGenericValue(value);
  });
}

function splitVariables(variables = {}) {
  const state = {};
  const computed = {};

  for (const [name, rawDef] of Object.entries(variables || {})) {
    const def = isPlainObject(rawDef) ? deepClone(rawDef) : { value: rawDef };

    if (def.eval !== undefined) {
      const evalExpression = def.eval;
      delete def.eval;
      delete def.value;
      computed[name] = Object.keys(def).length === 0
        ? evalExpression
        : { ...def, eval: evalExpression };
    } else {
      const defaultValue = def.value;
      delete def.value;
      state[name] = Object.keys(def).length === 0
        ? { default: defaultValue }
        : { ...def, default: defaultValue };
    }
  }

  return { state, computed };
}

function stateEntryToVariable(entry) {
  if (isPlainObject(entry)) {
    const variable = deepClone(entry);
    if ("default" in variable) {
      variable.value = variable.default;
      delete variable.default;
    } else if (!("value" in variable)) {
      variable.value = null;
    }
    return variable;
  }

  return { value: entry };
}

function computedEntryToVariable(entry) {
  if (isPlainObject(entry)) {
    return deepClone(entry);
  }

  return { eval: entry };
}

export function buildVariablesFromStateComputed(scope = {}) {
  const variables = {};

  for (const [name, entry] of Object.entries(scope.state || {})) {
    variables[name] = stateEntryToVariable(entry);
  }

  for (const [name, entry] of Object.entries(scope.computed || {})) {
    variables[name] = computedEntryToVariable(entry);
  }

  return variables;
}

function normalizeScope(scope, options = {}) {
  const { preferExistingCanonical = true } = options;
  const next = scope || {};
  const hasCanonical = isPlainObject(next.state) || isPlainObject(next.computed);
  const hasVariables = isPlainObject(next.variables);
  let migrated = false;

  if ((!hasCanonical || !preferExistingCanonical) && hasVariables) {
    const split = splitVariables(next.variables);
    next.state = split.state;
    next.computed = split.computed;
    migrated = true;
  } else {
    if (!isPlainObject(next.state)) next.state = {};
    if (!isPlainObject(next.computed)) next.computed = {};
  }

  next.variables = buildVariablesFromStateComputed(next);
  return migrated;
}

function rewritePageIdReferences(value, renames) {
  if (typeof value === "string") {
    let result = value;
    for (const [previousId, nextId] of Object.entries(renames)) {
      const escaped = previousId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(`\\bPages\\.${escaped}(?=\\.)`, "g"), `Pages.${nextId}`);
    }
    return result;
  }
  if (Array.isArray(value)) return value.map(entry => rewritePageIdReferences(entry, renames));
  if (isPlainObject(value)) {
    Object.keys(value).forEach(key => {
      value[key] = rewritePageIdReferences(value[key], renames);
    });
  }
  return value;
}

export function normalizeConfig(rawConfig, options = {}) {
  const cfg = deepClone(rawConfig || {});
  const messages = Array.isArray(cfg._migration?.messages) ? [...cfg._migration.messages] : [];
  let variableRenames = cfg._migration?.variableRenames || null;
  const pageIdRenames = { ...(cfg._migration?.pageIdRenames || {}) };
  let migrated = Boolean(cfg._migration?.migrated);
  const sourceVersion = Number(cfg.schemaVersion) || 1;

  if (sourceVersion !== CONFIG_SCHEMA_VERSION) {
    migrated = true;
    messages.push(`Config schema migrated to v${CONFIG_SCHEMA_VERSION}.`);
  }

  if (!cfg.global) cfg.global = {};
  if (normalizeScope(cfg.global, options)) {
    migrated = true;
    messages.push("Global variables split into state/computed.");
  }

  if (!Array.isArray(cfg.pages)) cfg.pages = [];
  const usedPageIds = new Set();
  cfg.pages.forEach((page, index) => {
    if (!page || typeof page !== "object") {
      cfg.pages[index] = { label: `Page ${index + 1}`, layout: [] };
    }

    const currentPage = cfg.pages[index];
    if (!currentPage.label) {
      currentPage.label = currentPage.title || `Page ${index + 1}`;
      migrated = true;
      messages.push(`Page ${index + 1} received label "${currentPage.label}".`);
    }

    const previousId = currentPage.id;
    if (!currentPage.id) {
      currentPage.id = uniqueId(normalizePageId(currentPage.label || currentPage.title, `page_${index + 1}`), usedPageIds);
      migrated = true;
      messages.push(`Page "${currentPage.label || currentPage.title || index + 1}" received id "${currentPage.id}".`);
    } else {
      const nextId = uniqueId(normalizePageId(currentPage.id, `page_${index + 1}`), usedPageIds);
      if (nextId !== currentPage.id) {
        currentPage.id = nextId;
        migrated = true;
        messages.push(`Page id "${previousId}" normalized to "${currentPage.id}" for Pages.${currentPage.id}.`);
      }
    }
    if (previousId && normalizePageId(previousId) !== previousId && previousId !== currentPage.id
      && !Object.prototype.hasOwnProperty.call(pageIdRenames, previousId)) {
      pageIdRenames[previousId] = currentPage.id;
    }

    if (!Array.isArray(currentPage.layout)) currentPage.layout = [];
    if (normalizeScope(currentPage, options)) {
      migrated = true;
      messages.push(`Page "${currentPage.label || currentPage.id}" variables split into state/computed.`);
    }
  });

  if (Object.keys(pageIdRenames).length) {
    rewritePageIdReferences(cfg.global?.computed, pageIdRenames);
    cfg.pages.forEach(page => {
      rewritePageIdReferences(page.computed, pageIdRenames);
      rewritePageIdReferences(page.layout, pageIdRenames);
    });
  }

  if (sourceVersion < 3) {
    const v3Migration = migrateConfigV2ToV3(cfg);
    migrated = migrated || v3Migration.migrated;
    messages.push(...v3Migration.messages);
    variableRenames = v3Migration.variableRenames;

    cfg.global.variables = buildVariablesFromStateComputed(cfg.global);
    cfg.pages.forEach(page => {
      page.variables = buildVariablesFromStateComputed(page);
    });
  }

  const v3Repair = repairConfigV3VariableCalls(cfg);
  if (v3Repair.migrated) migrated = true;
  messages.push(...v3Repair.messages);

  cfg.schemaVersion = CONFIG_SCHEMA_VERSION;

  cfg._migration = {
    migrated,
    messages,
    ...(variableRenames ? { variableRenames } : {}),
    ...(Object.keys(pageIdRenames).length ? { pageIdRenames } : {}),
  };

  return cfg;
}

function stripRuntimeFields(scope) {
  delete scope.variables;
  delete scope._resolved;
  delete scope._modifiedVars;
  delete scope._pageIndex;
  delete scope._variablesVersion;
}

export function prepareConfigForSave(rawConfig) {
  const cfg = normalizeConfig(rawConfig, { preferExistingCanonical: true });

  delete cfg._resolvedGlobal;
  delete cfg._modifiedVars;
  delete cfg._migration;

  if (cfg.global) {
    stripRuntimeFields(cfg.global);
  }

  if (Array.isArray(cfg.pages)) {
    cfg.pages.forEach(page => stripRuntimeFields(page));
  }

  return orderConfigForExport(cfg);
}

export function getMutableVariableNames(scope = {}) {
  return new Set(Object.keys(scope.state || {}));
}
