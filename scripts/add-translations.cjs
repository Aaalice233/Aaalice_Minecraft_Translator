/**
 * Simple script to add missing translation entries.
 * Run: node scripts/add-translations.js
 *
 * Strategy: Find each language section by 'const <lang>: TranslationMap = {'
 * and insert missing translation entries (sorted alphabetically) before the '};' end.
 */
const fs = require("fs");
const path = require("path");

const FILE = path.resolve("src/i18n/translations.ts");
let content = fs.readFileSync(FILE, "utf-8");

// Helper: get all keys from a section using indexOf based parsing
function getSectionKeys(name) {
  const marker = `const ${name}: TranslationMap = {`;
  const start = content.indexOf(marker);
  if (start === -1) return { start, end: -1, keys: {} };

  const bodyStart = start + marker.length;
  // Find the matching '};' by counting braces
  let depth = 1;
  let end = bodyStart;
  while (end < content.length && depth > 0) {
    if (content[end] === "{") depth++;
    else if (content[end] === "}") depth--;
    end++;
  }

  const block = content.substring(bodyStart, end - 1); // exclude the final '}'
  const keys = {};
  const regex = /"([a-z_][a-zA-Z.]+)"\s*:\s*"([^"]*)"/g;
  let m;
  while ((m = regex.exec(block)) !== null) {
    if (!m[1].startsWith("...")) keys[m[1]] = m[2];
  }
  return { start: bodyStart, end: end - 1, keys };
}

const zhCn = getSectionKeys("zhCn");
const jaJp = getSectionKeys("jaJp");
const koKr = getSectionKeys("koKr");
const ruRu = getSectionKeys("ruRu");

const zhKeys = Object.keys(zhCn.keys);
const jaMissing = zhKeys.filter(k => !(k in jaJp.keys));
const koMissing = zhKeys.filter(k => !(k in koKr.keys));
const ruMissing = zhKeys.filter(k => !(k in ruRu.keys));

console.log("zhCn:", zhKeys.length);
console.log("jaJp:", Object.keys(jaJp.keys).length, "missing:", jaMissing.length);
console.log("koKr:", Object.keys(koKr.keys).length, "missing:", koMissing.length);
console.log("ruRu:", Object.keys(ruRu.keys).length, "missing:", ruMissing.length);

// For each section, generate translation entries and insert before '};'
const jaLines = jaMissing.sort().map(k => `  "${k}": "PLACEHOLDER_${k}",`).join("\n");
const koLines = koMissing.sort().map(k => `  "${k}": "PLACEHOLDER_${k}",`).join("\n");
const ruLines = ruMissing.sort().map(k => `  "${k}": "PLACEHOLDER_${k}",`).join("\n");

// Just output for manual use
console.log("\nInsert these lines before the end of each language section:\n");
console.log("=== jaJp entries (" + jaMissing.length + ") ===");
jaMissing.slice(0, 5).forEach(k => console.log(`  "${k}": "PLACEHOLDER",`));
console.log("...");

console.log("\n=== koKr entries (" + koMissing.length + ") ===");
koMissing.slice(0, 5).forEach(k => console.log(`  "${k}": "PLACEHOLDER",`));
console.log("...");

console.log("\n=== ruRu entries (" + ruMissing.length + ") ===");
ruMissing.forEach(k => console.log(`  "${k}": "PLACEHOLDER",`));
