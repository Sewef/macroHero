import Ajv from "ajv";
import { MACRO_HERO_CONFIG_JSON_SCHEMA } from "./configJsonSchema.js";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});

const validateMacroHeroConfig = ajv.compile(MACRO_HERO_CONFIG_JSON_SCHEMA);

export function validateConfigShape(config) {
  const valid = validateMacroHeroConfig(config);
  return {
    valid,
    errors: valid ? [] : [...(validateMacroHeroConfig.errors || [])],
  };
}

export function formatValidationErrors(errors = []) {
  if (!errors.length) return "";
  return errors
    .slice(0, 8)
    .map(error => {
      const path = error.instancePath || "/";
      return `${path}: ${error.message}`;
    })
    .join("\n");
}
