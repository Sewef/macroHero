/**
 * Base UI Component Class
 * Provides common functionality for all UI components
 */

import { createDebugLogger } from "../debugMode.js";
import { parseMd, sanitizeHtml, MD_PATTERN } from "./markdownUtils.js";
const logger = createDebugLogger("UIComponent");

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
   * Apply a tooltip to an element.
   * - Plain text / ${expr} → native title attribute (lazy-evaluated on mouseenter)
   * - HTML (contains '<') → custom #mh-tooltip div positioned near the cursor
   *
   * @param {HTMLElement} element - Target element
   * @param {string} rawTooltip - Tooltip string (may contain ${vars} or HTML tags)
   * @param {Function} getResolved - () => resolved vars object, called at hover time
   */
  static applyTooltip(element, rawTooltip, getResolved) {
    if (!rawTooltip) return;

    // MD first — marked handles inline HTML natively (mixed MD+HTML works)
    const isMd   = MD_PATTERN.test(rawTooltip);
    const isHtml = !isMd && rawTooltip.includes('<');

    const evaluate = () => {
      if (!rawTooltip.includes('${')) return rawTooltip;
      const resolved = getResolved();
      return rawTooltip.replace(/\$\{([a-zA-Z_]\w*)\}/g, (m, v) => {
        const val = resolved[v];
        return val !== undefined ? String(val) : m;
      });
    };

    if (!isHtml && !isMd) {
      // Plain text — use native title, evaluated lazily
      element.title = rawTooltip;
      if (rawTooltip.includes('${')) {
        element.addEventListener('mouseenter', () => { element.title = evaluate(); });
      }
      return;
    }

    // Markdown or HTML tooltip — use shared #mh-tooltip div
    let tooltipEl = document.getElementById('mh-tooltip');
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'mh-tooltip';
      tooltipEl.style.cssText = [
        'position:fixed',
        'z-index:99999',
        'max-width:280px',
        'padding:6px 10px',
        'border-radius:6px',
        'font-size:12px',
        'line-height:1.5',
        'pointer-events:none',
        'display:none',
        'background:var(--mh-bg-secondary,#1e1e2e)',
        'color:var(--mh-text,#cdd6f4)',
        'border:1px solid var(--mh-accent,#89b4fa)',
        'box-shadow:0 4px 12px rgba(0,0,0,0.5)',
      ].join(';');
      document.body.appendChild(tooltipEl);
    }

    element.addEventListener('mouseenter', (e) => {
      const raw = evaluate();
      tooltipEl.innerHTML = isMd ? parseMd(raw) : sanitizeHtml(raw);
      tooltipEl.style.display = 'block';
      UIComponent._positionTooltip(tooltipEl, e);
    });
    element.addEventListener('mousemove', (e) => {
      UIComponent._positionTooltip(tooltipEl, e);
    });
    element.addEventListener('mouseleave', () => {
      tooltipEl.style.display = 'none';
    });
  }

  static _positionTooltip(el, e) {
    const margin = 10;
    const tw = el.offsetWidth  || 200;
    const th = el.offsetHeight || 60;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = e.clientX + margin;
    let y = e.clientY + margin;
    if (x + tw > vw - margin) x = e.clientX - tw - margin;
    if (y + th > vh - margin) y = e.clientY - th - margin;
    el.style.left = `${Math.max(margin, x)}px`;
    el.style.top  = `${Math.max(margin, y)}px`;
  }

  /**
   * Register a container element for a variable in the shared renderedValueElements map.
   * Supports multiple elements per variable (array) so that duplicate vars on the same
   * page all receive external updates correctly.
   * @param {string} varName - Variable name
   * @param {HTMLElement} container - The container element to register
   */
  registerElement(varName, container) {
    const map = this.services.renderedValueElements;
    if (!Array.isArray(map[varName])) map[varName] = [];
    map[varName].push(container);
  }

  /**
   * Register a checkbox input element for a variable in the shared renderedCheckboxElements map.
   * Supports multiple checkboxes per variable (array).
   * @param {string} varName - Variable name
   * @param {HTMLElement} checkboxInput - The <input type="checkbox"> element to register
   */
  registerCheckboxElement(varName, checkboxInput) {
    const map = this.services.renderedCheckboxElements;
    if (!Array.isArray(map[varName])) map[varName] = [];
    map[varName].push(checkboxInput);
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

