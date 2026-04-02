/**
 * YAML configuration loader
 * Provides utilities to load and parse YAML config files
 */

/**
 * Load YAML content (as string) and parse it
 * This function assumes js-yaml is available globally or imported
 */
export async function loadYamlFile(filePath) {
  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to load ${filePath}: ${response.status}`);
    }
    const yamlContent = await response.text();
    
    // Dynamic import to handle js-yaml
    const { default: YAML } = await import('js-yaml');
    return YAML.load(yamlContent);
  } catch (error) {
    console.error(`Error loading YAML file ${filePath}:`, error);
    throw error;
  }
}

/**
 * Try to load a YAML or JSON file with fallback
 * Tries YAML first, then falls back to JSON if YAML fails
 */
export async function loadConfigFile(basePath) {
  const yamlPath = `${basePath}.yaml`;
  const jsonPath = `${basePath}.json`;
  
  // Try YAML first
  try {
    return await loadYamlFile(yamlPath);
  } catch (yamlError) {
    console.warn(`Could not load YAML from ${yamlPath}, trying JSON...`);
    
    // Fall back to JSON
    try {
      const response = await fetch(jsonPath);
      if (response.ok) {
        return await response.json();
      }
    } catch (jsonError) {
      console.error(`Could not load config from either ${yamlPath} or ${jsonPath}`);
      throw new Error(`Failed to load config: ${yamlError.message}`);
    }
  }
}
