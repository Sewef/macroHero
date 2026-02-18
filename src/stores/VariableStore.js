/**
 * VariableStore - Centralized state management for variables
 * Single source of truth for page variables, global variables, and their resolved values
 * 
 * Replaces scattered state (config, currentPage, globalVariables, etc.)
 */

import { eventBus } from "../events/EventBus.js";
import { isDebugEnabled } from "../debugMode.js";

const debugLog = (...args) => isDebugEnabled('VariableStore') && console.log(...args);
const debugWarn = (...args) => console.warn(...args);

class VariableStore {
  constructor() {
    // Configuration
    this.config = null;
    this.currentPageIndex = null;

    // Variables state
    this.globalVariablesConfig = {}; // Variable definitions (not resolved values)
    this.globalVariablesResolved = {}; // Resolved values
    
    this.pageVariablesConfigs = []; // Array of page variable definitions
    this.pageVariablesResolved = []; // Array of resolved page variables
    
    // Metadata
    this.modifiedVariables = new Set(); // Track which variables were modified
  }

  /**
   * Initialize store with configuration
   */
  setConfig(config) {
    this.config = config;
    this.globalVariablesConfig = config.global?.variables || {};
    debugLog('[VariableStore] Config set');
    eventBus.emit('store:configChanged', config);
  }

  /**
   * Set resolved global variables
   */
  setGlobalVariablesResolved(resolved) {
    this.globalVariablesResolved = { ...resolved };
    debugLog('[VariableStore] Global variables resolved:', Object.keys(resolved));
    eventBus.emit('store:globalVariablesResolved', resolved);
  }

  /**
   * Set current page index and initialize its resolved variables
   */
  setCurrentPage(pageIndex) {
    if (pageIndex < 0 || pageIndex >= (this.config?.pages || []).length) {
      debugWarn('[VariableStore] Invalid page index:', pageIndex);
      return;
    }

    this.currentPageIndex = pageIndex;
    const page = this.config.pages[pageIndex];
    
    // Initialize resolved page variables if not already done
    if (!this.pageVariablesResolved[pageIndex]) {
      this.pageVariablesResolved[pageIndex] = { ...this.globalVariablesResolved };
    }

    debugLog('[VariableStore] Current page set to:', pageIndex);
    eventBus.emit('store:pageChanged', pageIndex, page);
  }

  /**
   * Get current page
   */
  getCurrentPage() {
    if (this.currentPageIndex === null) return null;
    return this.config?.pages?.[this.currentPageIndex] || null;
  }

  /**
   * Get current page resolved variables
   */
  getCurrentPageVariablesResolved() {
    if (this.currentPageIndex === null) return {};
    return this.pageVariablesResolved[this.currentPageIndex] || {};
  }

  /**
   * Update a resolved variable value
   * Emits event for UI updates
   */
  setVariableResolved(varName, value, pageIndex = null) {
    const targetIndex = pageIndex !== null ? pageIndex : this.currentPageIndex;

    if (targetIndex === null) {
      // Global variable
      this.globalVariablesResolved[varName] = value;
      this.modifiedVariables.add(varName);
      debugLog('[VariableStore] Global variable resolved:', varName, '=', value);
      eventBus.emit('store:variableResolved', varName, value, 'global');
    } else {
      // Page variable
      if (!this.pageVariablesResolved[targetIndex]) {
        this.pageVariablesResolved[targetIndex] = {};
      }
      this.pageVariablesResolved[targetIndex][varName] = value;
      this.modifiedVariables.add(varName);
      debugLog('[VariableStore] Page variable resolved:', varName, '=', value, 'page:', targetIndex);
      eventBus.emit('store:variableResolved', varName, value, 'page', targetIndex);
    }
  }

  /**
   * Get a resolved variable value
   */
  getVariableResolved(varName, pageIndex = null) {
    const targetIndex = pageIndex !== null ? pageIndex : this.currentPageIndex;

    if (targetIndex === null) {
      return this.globalVariablesResolved[varName];
    } else {
      return this.pageVariablesResolved[targetIndex]?.[varName];
    }
  }

  /**
   * Get all resolved variables (merged: global + page)
   */
  getAllResolvedVariables(pageIndex = null) {
    const targetIndex = pageIndex !== null ? pageIndex : this.currentPageIndex;

    if (targetIndex === null) {
      return { ...this.globalVariablesResolved };
    } else {
      return {
        ...this.globalVariablesResolved,
        ...(this.pageVariablesResolved[targetIndex] || {}),
      };
    }
  }

  /**
   * Get variable configuration (definition, not resolved value)
   */
  getVariableConfig(varName, pageIndex = null) {
    const targetIndex = pageIndex !== null ? pageIndex : this.currentPageIndex;

    if (targetIndex === null) {
      return this.globalVariablesConfig[varName];
    } else {
      return this.config?.pages?.[targetIndex]?.variables?.[varName];
    }
  }

  /**
   * Update a variable definition (for setValue, addValue, etc)
   */
  setVariableConfig(varName, config, pageIndex = null) {
    const targetIndex = pageIndex !== null ? pageIndex : this.currentPageIndex;

    // If config is available, update it
    if (this.config) {
      if (targetIndex === null) {
        this.globalVariablesConfig[varName] = config;
      } else {
        if (this.config.pages && this.config.pages[targetIndex]) {
          if (!this.config.pages[targetIndex].variables) {
            this.config.pages[targetIndex].variables = {};
          }
          this.config.pages[targetIndex].variables[varName] = config;
        }
      }
    } else {
      // If config is not initialized yet, just update the in-memory config
      if (targetIndex === null) {
        this.globalVariablesConfig[varName] = config;
      }
      // For page variables without config, we can't do much - the page object itself maintains the source of truth
    }
  }

  /**
   * Track that a variable was modified
   */
  markVariableModified(varName) {
    this.modifiedVariables.add(varName);
    debugLog('[VariableStore] Variable marked as modified:', varName);
  }

  /**
   * Get all modified variables and clear the set
   */
  getAndClearModifiedVariables() {
    const modified = new Set(this.modifiedVariables);
    this.modifiedVariables.clear();
    return modified;
  }

  /**
   * Clear all state (for cleanup/reset)
   */
  clear() {
    this.config = null;
    this.currentPageIndex = null;
    this.globalVariablesConfig = {};
    this.globalVariablesResolved = {};
    this.pageVariablesConfigs = [];
    this.pageVariablesResolved = [];
    this.modifiedVariables.clear();
    debugLog('[VariableStore] Cleared');
  }
}

// Singleton instance
export const variableStore = new VariableStore();

export default VariableStore;
