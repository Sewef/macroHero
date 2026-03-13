/**
 * Base UI Component Class
 * Provides common functionality for all UI components
 */

const debugError = (...args) => console.error(...args);

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
    debugError(`[${context}] Error:`, error);
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
}
