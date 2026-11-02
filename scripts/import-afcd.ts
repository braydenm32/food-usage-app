// Build src/lib/nutrition/data/afcd.json from the FSANZ "Nutrient profiles" Excel file.
//
//   node scripts/import-afcd.ts path/to/AFCD-Release-3-Nutrient-profiles.xlsx
//
// Download the file from:
// https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/australian-food-composition-database-download-excel-files
// No dependencies: reads the .xlsx (a zip of XML files) directly.

import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { NUTRIENTS } from "../src/lib/nutrition/nutrients.ts";

function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  // End of central directory record
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("Not a zip/xlsx file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
}

const colIndex = (ref: string) => ref.replace(/\d+/g, "").split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

function rows(xml: string, strings: string[]): string[][] {
  const out: string[][] = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = c[1].match(/r="([A-Z]+\d+)"/)?.[1];
      const type = c[1].match(/t="(\w+)"/)?.[1];
      const v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? c[2]?.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
      if (!ref) continue;
      row[colIndex(ref)] = type === "s" ? strings[Number(v)] : unescape(v);
    }
    out.push(row);
  }
  return out;
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/import-afcd.ts <Nutrient profiles .xlsx>");
  process.exit(1);
}
const zip = unzip(readFileSync(file));
const strings = sharedStrings(zip.get("xl/sharedStrings.xml")?.toString("utf8"));
const sheetName = [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
const table = rows(zip.get(sheetName)!.toString("utf8"), strings);

const headerAt = table.findIndex((r) => r.some((c) => /^food name$/i.test((c ?? "").trim())));
if (headerAt < 0) throw new Error("Couldn't find the 'Food Name' header row");
const header = table[headerAt].map((h) => (h ?? "").replace(/\s+/g, " ").trim());
const keyCol = header.findIndex((h) => /public food key/i.test(h));
const nameCol = header.findIndex((h) => /^food name$/i.test(h));
const cols = NUTRIENTS.map((n) => ({ n, col: header.findIndex((h) => n.afcd.test(h)) }));

const missing = cols.filter((c) => c.col < 0).map((c) => c.n.label);
if (missing.length) console.warn(`No column found for: ${missing.join(", ")}. Check the patterns in src/lib/nutrition/nutrients.ts.`);

const foods = table
  .slice(headerAt + 1)
  .filter((r) => r[keyCol] && r[nameCol])
  .map((r) => {
    const n: Record<string, number> = {};
    for (const { n: info, col } of cols) {
      if (col < 0) continue;
      const v = Number(r[col]);
      if (r[col] !== undefined && r[col] !== "" && Number.isFinite(v)) n[info.key] = Math.round(v * 1000) / 1000;
    }
    return { key: r[keyCol].trim(), name: r[nameCol].trim(), n };
  });

const out = new URL("../src/lib/nutrition/data/afcd.json", import.meta.url);
writeFileSync(out, JSON.stringify(foods));
console.log(`Wrote ${foods.length} foods with ${cols.length - missing.length} nutrients to ${out.pathname}`);
