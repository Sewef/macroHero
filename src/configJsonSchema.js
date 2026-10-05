import { CONFIG_SCHEMA_VERSION } from "./configSchema.js";

const commandListSchema = {
  type: "array",
  items: { type: "string" },
};

const variableNamePattern = "^[A-Za-z_$][A-Za-z0-9_$]*$";

export const MACRO_HERO_CONFIG_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://macrohero.local/schemas/config-v2.json",
  title: "MacroHero config",
  type: "object",
  required: ["schemaVersion", "global", "pages"],
  additionalProperties: true,
  properties: {
    schemaVersion: { const: CONFIG_SCHEMA_VERSION },
    global: { $ref: "#/definitions/globalConfig" },
    pages: {
      type: "array",
      items: { $ref: "#/definitions/pageConfig" },
    },
  },
  definitions: {
    globalConfig: {
      type: "object",
      additionalProperties: true,
      properties: {
        title: { type: "string" },
        width: { type: "number", minimum: 1 },
        height: { type: "number", minimum: 1 },
        state: { $ref: "#/definitions/stateVariables" },
        computed: { $ref: "#/definitions/computedVariables" },
      },
    },
    pageConfig: {
      type: "object",
      required: ["label", "id", "layout"],
      additionalProperties: true,
      properties: {
        label: { type: "string" },
        id: { type: "string", minLength: 1 },
        state: { $ref: "#/definitions/stateVariables" },
        computed: { $ref: "#/definitions/computedVariables" },
        layout: { $ref: "#/definitions/layout" },
      },
    },
    stateVariables: {
      type: "object",
      additionalProperties: { $ref: "#/definitions/stateVariable" },
      propertyNames: { pattern: variableNamePattern },
    },
    computedVariables: {
      type: "object",
      additionalProperties: { $ref: "#/definitions/computedVariable" },
      propertyNames: { pattern: variableNamePattern },
    },
    stateVariable: {
      anyOf: [
        {
          type: "object",
          additionalProperties: true,
          properties: {
            default: true,
            min: { type: "number" },
            max: { type: "number" },
          },
        },
        true,
      ],
    },
    computedVariable: {
      anyOf: [
        { type: "string", minLength: 1 },
        {
          type: "object",
          required: ["eval"],
          additionalProperties: true,
          properties: {
            eval: { type: "string", minLength: 1 },
            min: { type: "number" },
            max: { type: "number" },
          },
        },
      ],
    },
    layout: {
      type: "array",
      items: { $ref: "#/definitions/element" },
    },
    element: {
      type: "object",
      required: ["type"],
      additionalProperties: true,
      properties: {
        type: {
          enum: [
            "button",
            "value",
            "input",
            "counter",
            "checkbox",
            "toggle",
            "dropdown",
            "title",
            "text",
            "divider",
            "row",
            "stack",
            "matrix",
            "matrixButton",
          ],
        },
        label: { type: "string" },
        text: { type: "string" },
        var: { type: "string" },
        placeholder: { type: "string" },
        tooltip: { type: "string" },
        icon: { type: "string" },
        columns: { type: "number", minimum: 1 },
        buttonSize: { type: "string" },
        buttonShape: { enum: ["square", "rectangle"] },
        gap: { type: "string" },
        step: { type: "number" },
        height: { type: "string" },
        margin: { type: "string" },
        style: { enum: ["solid", "dashed", "dotted"] },
        border: { type: "boolean" },
        color: { type: "string" },
        borderColor: { type: "string" },
        onclick: commandListSchema,
        onrightclick: commandListSchema,
        onupdate: commandListSchema,
        options: {
          type: "array",
          items: {
            anyOf: [
              { type: "string" },
              {
                type: "object",
                required: ["label", "value"],
                additionalProperties: true,
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                },
              },
            ],
          },
        },
        children: { $ref: "#/definitions/layout" },
      },
    },
  },
};
