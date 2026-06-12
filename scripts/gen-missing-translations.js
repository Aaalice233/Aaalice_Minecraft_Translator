/**
 * Generate missing translation entries for ja_jp, ko_kr, ru_ru
 * Compares each language's override set against zhCn and outputs
 * the missing entries formatted for insertion.
 */
const fs = require("fs");

const content = fs.readFileSync("src/i18n/translations.ts", "utf-8");

function extractKVs(block) {
  const pairs = {};
  const regex = /"([a-z_][a-zA-Z.]+)"\s*:\s*"([^"]*)"/g;
  let m;
  while ((m = regex.exec(block)) !== null) {
    if (!m[1].startsWith("...")) pairs[m[1]] = m[2];
  }
  return pairs;
}

function extractSection(name) {
  const re = new RegExp(`const ${name}: TranslationMap = \\{([\\s\\S]*?)\\};`);
  const m = content.match(re);
  return m ? extractKVs(m[1]) : {};
}

const zhCn = extractSection("zhCn");
const enUs = extractSection("enUs");
const jaJp = extractSection("jaJp");
const koKr = extractSection("koKr");
const ruRu = extractSection("ruRu");

function missing(kvs, total) {
  return Object.keys(total).filter((k) => !(k in kvs));
}

const jaMiss = missing(jaJp, zhCn);
const koMiss = missing(koKr, zhCn);
const ruMiss = missing(ruRu, zhCn);

console.log("zhCn:", Object.keys(zhCn).length);
console.log("enUs:", Object.keys(enUs).length);
console.log("jaJp:", Object.keys(jaJp).length, "missing:", jaMiss.length);
console.log("koKr:", Object.keys(koKr).length, "missing:", koMiss.length);
console.log("ruRu:", Object.keys(ruRu).length, "missing:", ruMiss.length);

// Group missing keys by prefix for analysis
function groupByPrefix(keys) {
  const groups = {};
  keys.forEach((k) => {
    const prefix = k.split(".")[0];
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(k);
  });
  return groups;
}

console.log("\n=== jaJp missing by prefix ===");
const jaGroups = groupByPrefix(jaMiss);
Object.entries(jaGroups).forEach(([p, ks]) => {
  console.log(`  ${p}: ${ks.length} keys`);
});

console.log("\n=== ruRu missing ===");
ruMiss.forEach((k) => console.log(" ", k));
