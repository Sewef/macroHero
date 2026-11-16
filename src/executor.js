/**
 * Command Executor - REFACTORED to use VariableEngine and ExecutionSandbox
 * 
 * Simplified execution flow:
 * 1. Resolve variables used in commands
 * 2. Execute commands in sandbox
 * 3. Re-resolve affected variables
 * 4. Done
 */

import { variableEngine } from "./engines/VariableEngine.js";
import { executionSandbox } from "./engines/ExecutionSandbox.js";
import { eventBus } from "./events/EventBus.js";
import { variableStore } from "./stores/VariableStore.js";
import { updateRenderedValue } from "./ui.js";
import { updateEvaluatedVariable } from "./storage.js";
import { GLOBAL_STATE_ID } from "./configSchema.js";
import { getExpressionContext } from "./expressionHelpers.js";
import { createDebugLogger } from "./debugMode.js";

const logger = createDebugLogger('executor');

function buildResolvedContext(page, pageIndex = 0, globalVariables = {}) {
  const storeResolved = variableStore.getAllResolvedVariables(pageIndex) || {};
  return {
    ...globalVariables,
    ...storeResolved,
    ...(page?._resolved || {}),
  };
}

function getVariableScope(page, varName, requestedScope = null) {
  if (requestedScope !== 'global' && page?.variables && varName in page.variables) {
    return { scope: 'page', variable: page.variables[varName] };
  }
  if (requestedScope !== 'page' && variableStore.globalVariablesConfig && varName in variableStore.globalVariablesConfig) {
    return { scope: 'global', variable: variableStore.globalVariablesConfig[varName] };
  }
  return { scope: null, variable: null };
}

function createVariableNamespace(config, values, label) {
  const target = Object.fromEntries(
    Object.keys(config || {}).map(name => [name, cloneVariableValue(values[name])])
  );
  const mutable = new Set(
    Object.entries(config || {}).filter(([, variable]) => variable?.eval === undefined).map(([name]) => name)
  );

  return {
    mutable,
    proxy: new Proxy(target, {
      set(object, property, value) {
        if (typeof property !== 'string' || !Object.prototype.hasOwnProperty.call(config || {}, property)) {
          throw new Error(`${label}.${String(property)} is not a declared variable`);
        }
        if (!mutable.has(property)) {
          throw new Error(`${label}.${property} is computed and read-only`);
        }
        object[property] = value;
        return true;
      },
      deleteProperty(_object, property) {
        throw new Error(`${label}.${String(property)} cannot be deleted`);
      },
      defineProperty() {
        throw new Error(`${label} variables must be changed with a direct assignment`);
      },
    }),
  };
}

function cloneVariableValue(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function sameVariableValue(left, right) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function getStaticPagesReferences(script) {
  const references = new Set();
  for (const match of String(script || '').matchAll(
    /\bPages\.([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)/g
  )) {
    references.add(`${match[1]}.${match[2]}`);
  }
  return references;
}

function createExecutionScopes(page, pageIndex, globalVariables) {
  const globalValues = {
    ...variableStore.globalVariablesResolved,
    ...globalVariables,
  };
  const config = variableStore.config || { pages: [page] };
  const pageNamespaces = new Map();
  const pagesTarget = {};
  (config.pages || []).forEach((candidate, candidateIndex) => {
    const key = candidate.id || `page_${candidateIndex + 1}`;
    const values = variableStore.getPageVariablesResolved(candidateIndex);
    if (candidate === page) Object.assign(values, buildResolvedContext(page, pageIndex, globalVariables));
    const namespace = createVariableNamespace(candidate.variables || {}, values, `Pages.${key}`);
    pageNamespaces.set(key, { ...namespace, page: candidate, pageIndex: candidateIndex });
    pagesTarget[key] = namespace.proxy;
  });
  const currentKey = page?.id || `page_${pageIndex + 1}`;
  const currentNamespace = pageNamespaces.get(currentKey)
    || createVariableNamespace(page?.variables || {}, buildResolvedContext(page, pageIndex, globalVariables), 'Page');
  const Pages = new Proxy(pagesTarget, {
    set(_object, property) {
      throw new Error(`Pages.${String(property)} cannot be replaced; assign a declared variable instead`);
    },
    deleteProperty(_object, property) {
      throw new Error(`Pages.${String(property)} cannot be deleted`);
    },
    defineProperty() {
      throw new Error('Pages entries cannot be redefined');
    },
  });
  return {
    Page: currentNamespace,
    Pages: { proxy: Pages, namespaces: pageNamespaces },
    Global: createVariableNamespace(variableStore.globalVariablesConfig || {}, globalValues, 'Global'),
  };
}

/**
 * Handle button click - simplified flow with new architecture
 */
export async function handleButtonClick(commands, page, globalVariables = {}, onVariableResolved = null, pageIndex = 0, extraScopes = {}) {
  if (!Array.isArray(commands) || commands.length === 0) {
    logger.warn("No commands provided");
    return;
  }

  try {
    logger.log("Button clicked, executing commands");

    if (pageIndex === undefined || pageIndex === null) pageIndex = 0;
    if (!page._modifiedVars) page._modifiedVars = new Set();

    const script = Array.isArray(commands) ? commands.join('\n') : commands;
    const scriptUsesPages = /\bPages\./.test(script);
    if (scriptUsesPages) {
      const referencedPageVariables = getStaticPagesReferences(script);
      await variableEngine.resolveAllPages(
        variableStore.config,
        globalVariables,
        referencedPageVariables.size > 0 ? referencedPageVariables : null,
      );
    }

    // Step 1: Find variables USED in commands
    const usedVars = variableEngine.getVariablesUsedInCommands(commands);
    logger.log("Variables used in commands");

    // Step 2: Resolve ONLY variables that are used and not yet resolved
    const varsToResolveBeforeCmd = new Set();
    for (const varName of usedVars) {
      if (varName in (page.variables || {}) && !(varName in (page._resolved || {}))) {
        varsToResolveBeforeCmd.add(varName);
      }
    }

    if (varsToResolveBeforeCmd.size > 0) {
      logger.log("Pre-resolving variables");
      const baseResolved = buildResolvedContext(page, pageIndex, globalVariables);
      const preResolved = await variableEngine.resolveVariables(
        page.variables,
        baseResolved,
        varsToResolveBeforeCmd
      );
      page._resolved = { ...page._resolved, ...preResolved };
    }

    // Step 3: Build explicit Page / Global namespaces.
    const namespaces = createExecutionScopes(page, pageIndex, globalVariables);
    const executionContext = {
      integrations: getExpressionContext(),
      scopes: {
        Page: namespaces.Page.proxy,
        Global: namespaces.Global.proxy,
        Pages: namespaces.Pages.proxy,
        Event: extraScopes.Event || null,
      },
    };

    // Step 4: Execute commands
    logger.log("Executing script");

    const beforePagesValues = new Map([...namespaces.Pages.namespaces].map(([key, namespace]) => [
      key,
      new Map([...namespace.mutable].map(name => [name, cloneVariableValue(namespace.proxy[name])])),
    ]));
    const beforeGlobalValues = new Map([...namespaces.Global.mutable].map(name => [name, cloneVariableValue(namespaces.Global.proxy[name])]));

    await executionSandbox.executeCommand(script, executionContext);

    const directlyMutatedPageVars = new Set();
    const mutatedPages = new Map();
    const directlyMutatedGlobalVars = new Set();
    for (const [key, namespace] of namespaces.Pages.namespaces) {
      const beforeValues = beforePagesValues.get(key);
      for (const varName of namespace.mutable) {
        const beforeValue = beforeValues.get(varName);
        const afterValue = namespace.proxy[varName];
        if (sameVariableValue(beforeValue, afterValue)) continue;
        await applyVariableChange(namespace.page, namespace.pageIndex, globalVariables, varName, afterValue, {
          scope: 'page',
          persist: true,
          resolveDependents: false,
        });
        if (!mutatedPages.has(namespace.pageIndex)) mutatedPages.set(namespace.pageIndex, new Set());
        mutatedPages.get(namespace.pageIndex).add(varName);
        if (namespace.pageIndex === pageIndex) directlyMutatedPageVars.add(varName);
      }
    }
    for (const varName of namespaces.Global.mutable) {
      const beforeValue = beforeGlobalValues.get(varName);
      const afterValue = namespaces.Global.proxy[varName];
      if (!sameVariableValue(beforeValue, afterValue)) {
        await applyVariableChange(page, pageIndex, globalVariables, varName, afterValue, {
          scope: 'global',
          persist: true,
          resolveDependents: false,
        });
        directlyMutatedGlobalVars.add(varName);
      }
    }

    await resolveGlobalDependents(page, globalVariables, directlyMutatedGlobalVars);
    const crossPageResolvedCurrentVars = new Set();
    if (mutatedPages.size > 0 || directlyMutatedGlobalVars.size > 0) {
      const changedNodes = new Set(
        [...directlyMutatedGlobalVars].map(name => `Global.${name}`)
      );
      for (const [mutatedPageIndex, names] of mutatedPages) {
        const mutatedPage = variableStore.config?.pages?.[mutatedPageIndex];
        const pageKey = mutatedPage?.id || `page_${mutatedPageIndex + 1}`;
        for (const name of names) changedNodes.add(`${pageKey}.${name}`);
      }
      const affectedPageVariables = variableEngine.getCrossPageDependents(
        variableStore.config,
        changedNodes,
      );
      const resolvedPages = affectedPageVariables.size > 0
        ? await variableEngine.resolveAllPages(
          variableStore.config,
          globalVariables,
          affectedPageVariables,
        )
        : null;
      const currentKey = page?.id || `page_${pageIndex + 1}`;
      const currentPrefix = `${currentKey}.`;
      for (const nodeId of affectedPageVariables) {
        if (!nodeId.startsWith(currentPrefix)) continue;
        const name = nodeId.slice(currentPrefix.length);
        const value = resolvedPages?.[currentKey]?.[name];
        crossPageResolvedCurrentVars.add(name);
        updateRenderedValue(name, value, pageIndex);
        if (onVariableResolved) onVariableResolved(name, value);
      }
    }

    // Step 5: Find variables AFFECTED by commands
    const affectedVars = variableEngine.getAffectedVariables(commands, page.variables);
    directlyMutatedPageVars.forEach(varName => affectedVars.add(varName));
    
    if (page._modifiedVars.size > 0) {
      for (const modVar of page._modifiedVars) {
        affectedVars.add(modVar);
      }
    }

    logger.log("Affected variables detected");

    // Step 6: Re-resolve affected variables and their dependents
    if (affectedVars.size > 0) {
      const allAffected = variableEngine.getDependentVariables(page.variables, affectedVars);
      // Cross-page resolution already included these local computed variables.
      // Do not execute their expressions a second time in the local pass.
      crossPageResolvedCurrentVars.forEach(name => allAffected.delete(name));
      logger.log("Re-resolving affected variables");

      const postBaseResolved = buildResolvedContext(page, pageIndex, globalVariables);
      const postResolved = await variableEngine.resolveVariables(
        page.variables,
        postBaseResolved,
        allAffected
      );

      // Update store and UI for each resolved variable
      for (const [varName, value] of Object.entries(postResolved)) {
        if (allAffected.has(varName)) {
          page._resolved[varName] = value;
          variableStore.setVariableResolved(varName, value, pageIndex);
          updateRenderedValue(varName, value, pageIndex);

          if (onVariableResolved) {
            onVariableResolved(varName, value);
          }
        }
      }
    }

    page._modifiedVars = new Set();
    eventBus.emit('executor:commandsCompleted', { commands, page, affected: affectedVars });
    logger.log("Execution complete");
  } catch (error) {
    logger.error('Button action failed:', error);
    eventBus.emit('executor:commandsFailed', { error });
    throw error;
  }
}

/**
 * Create helper functions available in command context
 * Uses VariableStore for centralized state management
 */
async function applyVariableChange(page, pageIndex = 0, globalVariables = {}, varName, value, options = {}) {
  const {
    scope: requestedScope = null,
    persist = true,
    resolveDependents: shouldResolveDependents = true,
  } = options;
  const { scope, variable } = getVariableScope(page, varName, requestedScope);

  if (!variable) {
    throw new Error(`${requestedScope === 'global' ? 'Global' : 'Page'}.${varName} not found`);
  }
  if (variable.eval !== undefined) {
    throw new Error(`${scope === 'global' ? 'Global' : 'Page'}.${varName} is computed and read-only`);
  }

  let newValue = value;

  // Apply constraints
  if (variable.min !== undefined && newValue < variable.min) newValue = variable.min;
  if (variable.max !== undefined && newValue > variable.max) newValue = variable.max;

  variable.value = newValue;

  if (scope === 'global') {
    globalVariables[varName] = newValue;
    if (!page._resolved) page._resolved = {};
    if (!(varName in (page.variables || {}))) page._resolved[varName] = newValue;
    variableEngine.invalidateDependencyGraph(variableStore.globalVariablesConfig);
    variableStore.setGlobalVariableResolved(varName, newValue);
    updateRenderedValue(varName, newValue, null);
    if (persist) {
      await updateEvaluatedVariable(GLOBAL_STATE_ID, varName, newValue);
    }
  } else {
    page._variablesVersion = (page._variablesVersion || 0) + 1;
    variableEngine.invalidateDependencyGraph(page.variables);
    page._resolved[varName] = newValue;
    variableStore.setVariableResolved(varName, newValue, pageIndex);
    updateRenderedValue(varName, newValue, pageIndex);

    if (persist) {
      await updateEvaluatedVariable(pageIndex, varName, newValue);
    }
  }

  variableStore.markVariableModified(varName);

  if (shouldResolveDependents && scope === 'page') {
    await resolvePageDependents(page, pageIndex, globalVariables, varName);
  }

  return newValue;
}

async function resolvePageDependents(page, pageIndex = 0, globalVariables = {}, changedVarName) {
  const dependentVars = variableEngine.getDependentVariables(page.variables, [changedVarName]);
  dependentVars.delete(changedVarName);

  if (dependentVars.size === 0) {
    return;
  }

  logger.log("Re-resolving dependent variables");
  const baseResolved = buildResolvedContext(page, pageIndex, globalVariables);
  const resolvedDeps = await variableEngine.resolveVariables(page.variables, baseResolved, dependentVars);

  for (const depVarName of dependentVars) {
    const depValue = resolvedDeps[depVarName];
    page._resolved[depVarName] = depValue;
    variableStore.setVariableResolved(depVarName, depValue, pageIndex);
    updateRenderedValue(depVarName, depValue, pageIndex);
    logger.log('Updated dependent variable:', depVarName, '=', depValue);
  }
}

async function resolveGlobalDependents(page, globalVariables, changedNames) {
  if (!changedNames.size) return;
  const globalConfig = variableStore.globalVariablesConfig || {};
  const dependentVars = variableEngine.getDependentVariables(globalConfig, changedNames, { scope: 'global' });
  changedNames.forEach(name => dependentVars.delete(name));
  if (!dependentVars.size) return;

  const resolved = await variableEngine.resolveVariables(
    globalConfig,
    { ...variableStore.globalVariablesResolved, ...globalVariables },
    dependentVars,
    { scope: 'global' },
  );
  for (const name of dependentVars) {
    const value = resolved[name];
    globalVariables[name] = value;
    variableStore.setGlobalVariableResolved(name, value);
    if (!page._resolved) page._resolved = {};
    if (!(name in (page.variables || {}))) page._resolved[name] = value;
    updateRenderedValue(name, value, null);
  }
}

export async function executeCommand(command, page) {
  const script = Array.isArray(command) ? command.join('\n') : command;
  const pageIndex = page?._pageIndex ?? 0;
  return handleButtonClick([script], page, variableStore.globalVariablesResolved || {}, null, pageIndex);
}

/**
 * Legacy wrapper for backwards compatibility
 */
export async function executeCommands(commands, page) {
  try {
    await executeCommand(commands, page);
    return [{ ok: true }];
  } catch (error) {
      logger.error('Command failed:', error);
    return [{ ok: false, error: error.message }];
  }
}

export default {
  executeCommand,
  executeCommands,
  handleButtonClick,
};
