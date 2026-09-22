#!/usr/bin/env node
// Falla si una rama de stream toca archivos fuera de sus globs (scripts/ownership.json).
// Uso: node scripts/check-ownership.mjs <stream> [base]   p. ej. node scripts/check-ownership.mjs B2 analizavende
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const [stream, base = "analizavende"] = process.argv.slice(2);
if (!stream) {
  console.error("Uso: node scripts/check-ownership.mjs <stream> [base]");
  process.exit(2);
}
const map = JSON.parse(readFileSync(new URL("./ownership.json", import.meta.url), "utf8"));
const globs = map[stream];
if (!globs) {
  console.error(`Stream desconocido: ${stream}. Válidos: ${Object.keys(map).filter((k) => !k.startsWith("_")).join(", ")}`);
  process.exit(2);
}
const toRegex = (glob) =>
  new RegExp(
    "^" +
      glob
        .split("**")
        .map((part) => part.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
        .join(".*") +
      "$",
  );
const patterns = globs.map(toRegex);
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? "/Library/Developer/CommandLineTools" };
const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { env, encoding: "utf8" }).trim();
const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { env, encoding: "utf8" })
  .split("\n")
  .map((f) => f.trim())
  .filter(Boolean);
const uncommitted = execFileSync("git", ["status", "--porcelain", "-uall"], { env, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .map((l) => l.slice(3).replace(/^"|"$/g, ""));
const all = [...new Set([...changed, ...uncommitted])].map((f) => f.split(path.sep).join("/"));
const outside = all.filter((f) => !patterns.some((re) => re.test(f)));
if (outside.length) {
  console.error(`✗ ${stream} (${branch}) tocó ${outside.length} archivo(s) fuera de su propiedad:`);
  outside.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`✓ ${stream} (${branch}): ${all.length} archivo(s), todos dentro de su propiedad.`);
