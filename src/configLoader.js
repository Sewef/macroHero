/**
 * JSON configuration loader.
 */

export async function loadConfigFile(basePath) {
  const jsonPath = `${basePath}.json`;
  const response = await fetch(jsonPath);

  if (!response.ok) {
    throw new Error(`Failed to load ${jsonPath}: ${response.status}`);
  }

  return response.json();
}
