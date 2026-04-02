#!/usr/bin/env node
/**
 * Script to convert JSON config files to YAML
 * Usage: node convertToYaml.js [files...]
 */

import fs from 'fs';
import path from 'path';
import YAML from 'js-yaml';

async function convertJsonToYaml(jsonFilePath) {
  try {
    console.log(`Converting: ${jsonFilePath}`);

    // Read JSON file
    const jsonContent = fs.readFileSync(jsonFilePath, 'utf8');
    const data = JSON.parse(jsonContent);

    // Generate YAML output path
    const outputPath = jsonFilePath.replace(/\.json$/, '.yaml');

    // Convert to YAML with nice formatting
    const yamlContent = YAML.dump(data, {
      indent: 2,
      lineWidth: -1, // No line wrapping
      forceQuotes: false,
      sortKeys: false, // Preserve original order
      flowLevel: -1   // Block style for all nested objects
    });

    // Write YAML file
    fs.writeFileSync(outputPath, yamlContent, 'utf8');

    const jsonSize = (fs.statSync(jsonFilePath).size / 1024).toFixed(2);
    const yamlSize = (fs.statSync(outputPath).size / 1024).toFixed(2);

    console.log(`✓ Converted successfully`);
    console.log(`  Input:  ${jsonFilePath} (${jsonSize} KB)`);
    console.log(`  Output: ${outputPath} (${yamlSize} KB)`);
  } catch (error) {
    console.error(`✗ Error converting ${jsonFilePath}:`, error.message);
    process.exit(1);
  }
}

// Main
const args = process.argv.slice(2);

if (args.length === 0) {
  // Default: convert default.json and Xalithra.json
  const files = [
    './src/default.json',
    './src/Xalithra.json'
  ];

  console.log('No files specified, converting defaults...\n');

  for (const file of files) {
    if (fs.existsSync(file)) {
      await convertJsonToYaml(file);
    } else {
      console.warn(`File not found: ${file}`);
    }
  }
} else {
  // Convert specified files
  for (const file of args) {
    await convertJsonToYaml(file);
  }
}

console.log('\n✓ Conversion complete!');
