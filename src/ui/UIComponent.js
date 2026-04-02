/**
 * Base UI Component Class
 * Provides common functionality for all UI components
 */


export class UIComponent {
  /**
   * @param {Object} item - Layout item configuration
   * @param {Object} page - Current page object
   * @param {Object} services - Services and callbacks provided by UI manager
   */
  constructor(item, page, services) {
    this.item = item;
    this.page = page;
    this.services = services;
    this.element = null;
  }

  /**
   * Render the component - must be overridden
   * @returns {HTMLElement} The rendered element
   */
  render() {
    throw new Error('render() must be implemented by subclass');
  }

  /**
   * Apply color styling to element
   * @param {HTMLElement} element - Element to style
   */
  applyColor(element) {
    if (this.item.color) {
      element.style.setProperty('--mh-accent', this.item.color);
    }
  }

  /**
   * Add an event listener to element
   * @param {HTMLElement} element - Element to attach listener to
   * @param {string} event - Event name (e.g., 'click', 'change')
   * @param {Function} handler - Event handler function
   */
  addEventListener(element, event, handler) {
    element.addEventListener(event, handler);
  }

  /**
   * Handle an error and log it
   * @param {string} context - Context for the error (e.g., component name)
   * @param {Error} error - The error object
   */
  handleError(context, error) {
    logger.error(`[${context}] Error:`, error);
  }

  /**
   * Get variable from page
   * @param {string} varName - Variable name
   * @returns {Object|null} Variable object or null if not found
   */
  getVariable(varName) {
    return this.page.variables?.[varName] || null;
  }

  /**
   * Get current resolved value for a variable
   * @param {string} varName - Variable name
   * @param {*} defaultValue - Value to return if not found
   * @returns {*} The resolved value or default
   */
  getResolvedValue(varName, defaultValue = undefined) {
    if (this.page._resolved && this.page._resolved[varName] !== undefined) {
      return this.page._resolved[varName];
    }
    const variable = this.getVariable(varName);
    if (variable) {
      if (variable.value !== undefined) return variable.value;
      if (variable.eval !== undefined) return variable.eval;
    }
    return defaultValue;
  }

  /**
   * Set resolved value for a variable
   * @param {string} varName - Variable name
   * @param {*} value - Value to set
   */
  setResolvedValue(varName, value) {
    if (!this.page._resolved) {
      this.page._resolved = {};
    }
    this.page._resolved[varName] = value;
  }

  /**
   * Create a container element with specified class
   * @param {string} elementType - Element type (div, span, etc.)
   * @param {string} className - CSS class name(s)
   * @returns {HTMLElement} The created element
   */
  createElement(elementType = "div", className = "") {
    const element = document.createElement(elementType);
    if (className) {
      element.className = className;
    }
    return element;
  }

  /**
   * Create a debounced version of a function
   * @param {Function} func - Function to debounce
   * @param {number} delayMs - Delay in milliseconds (default 500ms for UI updates)
   * @returns {Function} Debounced function and a cancel method
   */
  createDebouncedFunction(func, delayMs = 500) {
    let timeoutId = null;
    const debouncedFunc = (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        func.apply(this, args);
      }, delayMs);
    };
    debouncedFunc.cancel = () => clearTimeout(timeoutId);
    return debouncedFunc;
  }

  /**
   * Execute onupdate commands
   * @param {Array} commands - Array of command strings
   * @param {string} componentName - Name of the component (for debugging)
   */
  async executeOnUpdate(commands, componentName) {
    if (!Array.isArray(commands) || commands.length === 0) {
      return;
    }

    try {
      const pageObj = (this.services.currentPage !== null && this.services.currentPage !== undefined) 
        ? this.services.findPageByIndex(this.services.currentPage) 
        : this.page;

      const onVariableResolved = (varName, value) => {
        pageObj._resolved[varName] = value;
        this.services.updateRenderedValue(varName, value);
      };

      await this.services.handleButtonClick(
        commands,
        pageObj,
        this.services.globalVariables,
        onVariableResolved,
        this.services.currentPage ?? 0
      );

      await this.services.saveConfig(this.services.config)
        .catch(err => this.handleError(componentName, err));
      await this.services.broadcastConfigUpdated();
    } catch (error) {
      this.handleError(componentName, error);
    }
  }
}

