import { createDebugLogger } from "../debugMode.js";
import { eventBus } from "../events/EventBus.js";
import { tokenMetadataObserver } from "../events/TokenMetadataObserver.js";
import { isTokenMetadataWatchDescriptor } from "../events/metadataWatchDescriptor.js";
import { variableStore } from "../stores/VariableStore.js";
import { executionSandbox } from "./ExecutionSandbox.js";
import { variableEngine } from "./VariableEngine.js";
import { handleButtonClick } from "../executor.js";

const logger = createDebugLogger("HookEngine");
const EXECUTION_WINDOW_MS = 2000;
const MAX_EXECUTIONS_PER_WINDOW = 20;

function cloneAndFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  let clone;
  try {
    clone = structuredClone(value);
  } catch {
    clone = JSON.parse(JSON.stringify(value));
  }
  const freeze = current => {
    if (!current || typeof current !== "object" || Object.isFrozen(current)) return current;
    Object.values(current).forEach(freeze);
    return Object.freeze(current);
  };
  return freeze(clone);
}

function collectWatchDependencies(source, page, pageIndex) {
  const dependencies = { global: new Set(), pages: new Map(), targets: new Set() };
  const pageKey = page?.id || `page_${pageIndex + 1}`;
  for (const match of String(source || "").matchAll(/\bGlobal\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    dependencies.global.add(match[1]);
  }
  for (const match of String(source || "").matchAll(/\bPage\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    if (!dependencies.pages.has(pageIndex)) dependencies.pages.set(pageIndex, new Set());
    dependencies.pages.get(pageIndex).add(match[1]);
    dependencies.targets.add(`${pageKey}.${match[1]}`);
  }
  for (const match of String(source || "").matchAll(
    /\bPages\.([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)/g
  )) {
    const targetIndex = variableStore.config?.pages?.findIndex(candidate => candidate.id === match[1]) ?? -1;
    if (targetIndex >= 0) {
      if (!dependencies.pages.has(targetIndex)) dependencies.pages.set(targetIndex, new Set());
      dependencies.pages.get(targetIndex).add(match[2]);
    }
    dependencies.targets.add(`${match[1]}.${match[2]}`);
  }
  return dependencies;
}

class HookEngine {
  constructor() {
    this.config = null;
    this.globalVariables = {};
    this.records = new Map();
    this.variableUnsubscribe = null;
  }

  async start(config, globalVariables = {}) {
    await this.stop();
    this.config = config;
    this.globalVariables = globalVariables;
    if (variableStore.config !== config) variableStore.setConfig(config);

    this.variableUnsubscribe = eventBus.on(
      "store:variableResolved",
      (name, _value, pageIndex) => this._handleVariableResolution(name, pageIndex),
    );

    const registrations = [];
    (config?.pages || []).forEach((page, pageIndex) => {
      (page.hooks || []).forEach((hook, hookIndex) => {
        if (hook?.enabled === false) return;
        registrations.push(this._registerHook(page, pageIndex, hook, hookIndex));
      });
    });
    await Promise.allSettled(registrations);
    logger.log(`Started ${this.records.size} hook(s)`);
  }

  async stop() {
    this.variableUnsubscribe?.();
    this.variableUnsubscribe = null;
    for (const record of this.records.values()) {
      record.generation += 1;
      record.unsubscribe?.();
      if (record.restartTimer) clearTimeout(record.restartTimer);
    }
    this.records.clear();
    tokenMetadataObserver.clear();
    this.config = null;
  }

  async _registerHook(page, pageIndex, hook, hookIndex) {
    const key = `${page.id || pageIndex}:${hook.id || "event"}:${hookIndex}`;
    const record = {
      key,
      page,
      pageIndex,
      hook,
      hookIndex,
      generation: 0,
      unsubscribe: null,
      restartTimer: null,
      queue: Promise.resolve(),
      executions: [],
      activating: false,
      dependencies: collectWatchDependencies(hook.watch, page, pageIndex),
    };
    this.records.set(key, record);
    await this._activateRecord(record);
  }

  async _activateRecord(record) {
    const generation = ++record.generation;
    record.activating = true;
    record.unsubscribe?.();
    record.unsubscribe = null;
    const watch = String(record.hook.watch || "").trim();
    if (!watch) {
      logger.warn(`Hook ${record.key} has no watch expression`);
      record.activating = false;
      return;
    }

    try {
      if (record.dependencies.targets.size > 0) {
        await variableEngine.resolveAllPages(
          this.config,
          { ...variableStore.globalVariablesResolved, ...this.globalVariables },
          record.dependencies.targets,
        );
      }
      if (generation !== record.generation) return;
      const scopes = this._buildScopes(record.page, record.pageIndex);
      const descriptor = executionSandbox.executeSync(watch, { ...scopes.Global, ...scopes.Page }, scopes);
      if (!isTokenMetadataWatchDescriptor(descriptor)) {
        throw new Error("Watch expression must return a TokenMetadata.onChange or OwlTrackers.onChange descriptor");
      }
      const unsubscribe = await tokenMetadataObserver.observe(
        descriptor,
        event => this._enqueue(record, event, generation),
      );
      if (generation !== record.generation) unsubscribe();
      else record.unsubscribe = unsubscribe;
    } catch (error) {
      logger.error(`Failed to activate hook ${record.key}:`, error);
    } finally {
      if (generation === record.generation) record.activating = false;
    }
  }

  _buildScopes(page, pageIndex, event = null) {
    return {
      Global: { ...variableStore.globalVariablesResolved, ...this.globalVariables },
      Page: variableStore.getPageVariablesResolved(pageIndex),
      Pages: variableStore.getPagesResolved(),
      Event: event,
    };
  }

  _enqueue(record, rawEvent, generation) {
    record.queue = record.queue
      .then(() => this._execute(record, rawEvent, generation))
      .catch(error => logger.error(`Hook ${record.key} execution failed:`, error));
    return record.queue;
  }

  async _execute(record, rawEvent, generation) {
    if (generation !== record.generation || this.records.get(record.key) !== record) return;
    const now = Date.now();
    record.executions = record.executions.filter(timestamp => now - timestamp < EXECUTION_WINDOW_MS);
    if (record.executions.length >= MAX_EXECUTIONS_PER_WINDOW) {
      logger.error(`Hook ${record.key} throttled: possible event loop detected`);
      return;
    }
    record.executions.push(now);

    const event = cloneAndFreeze({
      ...rawEvent,
      hookId: record.hook.id || record.key,
      pageId: record.page.id,
    });
    const condition = String(record.hook.condition || "").trim();
    if (condition) {
      const scopes = this._buildScopes(record.page, record.pageIndex, event);
      const allowed = await variableEngine.evaluateExpression(
        condition,
        { ...scopes.Global, ...scopes.Page },
        scopes,
      );
      if (!allowed) return;
    }

    const commands = Array.isArray(record.hook.commands) ? record.hook.commands : [];
    if (commands.length === 0) return;
    await handleButtonClick(
      commands,
      record.page,
      this.globalVariables,
      null,
      record.pageIndex,
      { Event: event },
    );
  }

  _handleVariableResolution(name, pageIndex) {
    for (const record of this.records.values()) {
      if (record.activating) continue;
      const dependsOnVariable = pageIndex === null
        ? record.dependencies.global.has(name)
        : record.dependencies.pages.get(pageIndex)?.has(name);
      if (!dependsOnVariable) continue;
      if (record.restartTimer) clearTimeout(record.restartTimer);
      record.restartTimer = setTimeout(() => {
        record.restartTimer = null;
        this._activateRecord(record);
      }, 0);
    }
  }
}

export const hookEngine = new HookEngine();
export default HookEngine;
