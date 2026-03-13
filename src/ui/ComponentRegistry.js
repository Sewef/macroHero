/**
 * Component Registry
 * Maps component types to component classes
 */

import { ButtonComponent } from "./ButtonComponent.js";
import { InputComponent } from "./InputComponent.js";
import { CheckboxComponent } from "./CheckboxComponent.js";
import { CounterComponent } from "./CounterComponent.js";
import { TextComponent } from "./TextComponent.js";
import { TitleComponent } from "./TitleComponent.js";
import { RowComponent } from "./RowComponent.js";
import { StackComponent } from "./StackComponent.js";
import { ValueComponent } from "./ValueComponent.js";
import { DropdownComponent } from "./DropdownComponent.js";

export class ComponentRegistry {
  static #registry = {
    button: ButtonComponent,
    input: InputComponent,
    checkbox: CheckboxComponent,
    counter: CounterComponent,
    text: TextComponent,
    title: TitleComponent,
    row: RowComponent,
    stack: StackComponent,
    value: ValueComponent,
    dropdown: DropdownComponent,
  };

  /**
   * Get component class for a given type
   * @param {string} type - Component type
   * @returns {Class|null} Component class or null if not found
   */
  static getComponent(type) {
    return this.#registry[type] || null;
  }

  /**
   * Register a custom component
   * @param {string} type - Component type
   * @param {Class} componentClass - Component class
   */
  static register(type, componentClass) {
    this.#registry[type] = componentClass;
  }

  /**
   * Create a component instance
   * @param {string} type - Component type
   * @param {Object} item - Layout item configuration
   * @param {Object} page - Current page object
   * @param {Object} services - Services and callbacks
   * @param {...any} args - Additional arguments for specific components
   * @returns {Object} Component instance or null if type not found
   */
  static create(type, item, page, services, ...args) {
    const ComponentClass = this.getComponent(type);
    if (!ComponentClass) {
      return null;
    }
    return new ComponentClass(item, page, services, ...args);
  }

  /**
   * Render a component by type
   * @param {string} type - Component type
   * @param {Object} item - Layout item configuration
   * @param {Object} page - Current page object
   * @param {Object} services - Services and callbacks
   * @param {...any} args - Additional arguments for specific components
   * @returns {HTMLElement|null} Rendered element or null if type not found
   */
  static render(type, item, page, services, ...args) {
    const component = this.create(type, item, page, services, ...args);
    if (!component) {
      return null;
    }
    return component.render();
  }
}
