#!/usr/bin/env node
// Propiedad de archivos por stream (scripts/ownership.json).
//
// Uso:
//   node scripts/check-ownership.mjs <stream> [base]
//       Falla si la rama del stream toca archivos fuera de sus globs (diff contra base, por
//       omisión analizavende, más lo que no está commiteado). P. ej. node scripts/check-ownership.mjs B2a
//   node scripts/check-ownership.mjs --coverage A1,A2,B1,... [--table]
//       Revisa que la lista de streams (más O, que congela archivos) se pueda correr en paralelo:
//       (1) todo archivo versionado bajo kaizen_api/ tiene dueño (si no, falla); los de src/ sin
//       dueño se listan solo como información; (2) ningún archivo versionado, ninguna ruta declarada
//       y ningún par de globs pertenece a dos streams a la vez (sería un conflicto de merge seguro).
//       --table imprime el dueño de cada archivo de kaizen_api/.
//
// Sintaxis de ownership.json: "*" es cualquier cosa dentro de un segmento, "**" cualquier cantidad
// de segmentos, y una entrada que empieza con "!" EXCLUYE lo que coincida aunque otro glob del
// mismo stream lo incluya (p. ej. "src/features/dev-ui/**" con "!src/features/dev-ui/ChartsGallery.jsx").
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const map = JSON.parse(readFileSync(new URL("./ownership.json", import.meta.url), "utf8"));
const STREAMS = Object.keys(map).filter((k) => !k.startsWith("_"));
const FROZEN = "O";
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? "/Library/Developer/CommandLineTools" };
const git = (args, opts = {}) => execFileSync("git", args, { env, encoding: "utf8", ...opts });

const toRegex = (glob) =>
  new RegExp(
    "^" +
      glob
        .split("**")
        .map((part) => part.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
        .join(".*") +
      "$",
  );

/** Reglas de un stream: globs que incluyen y globs que excluyen ("!..."). */
function rulesOf(stream) {
  const entries = map[stream] ?? [];
  const include = entries.filter((g) => !g.startsWith("!"));
  const exclude = entries.filter((g) => g.startsWith("!")).map((g) => g.slice(1));
  return { stream, include, exclude, inRe: include.map(toRegex), exRe: exclude.map(toRegex) };
}

const owns = (rules, file) => rules.inRe.some((re) => re.test(file)) && !rules.exRe.some((re) => re.test(file));

// ─── intersección exacta de dos globs (dialecto de arriba) ─────────────────────────────────────
const isGlob = (g) => g.includes("*");

/** ¿Hay una cadena sin "/" que cumpla los dos patrones de segmento ("*" = cualquier cosa)? */
function segmentsIntersect(p, q) {
  const memo = new Map();
  const f = (i, j) => {
    const key = i * 4096 + j;
    if (memo.has(key)) return memo.get(key);
    let ok = false;
    if (i === p.length && j === q.length) ok = true;
    else if (i < p.length && p[i] === "*" && f(i + 1, j)) ok = true;
    else if (j < q.length && q[j] === "*" && f(i, j + 1)) ok = true;
    else if (i < p.length && j < q.length) {
      const a = p[i];
      const b = q[j];
      if (a !== "*" && b !== "*") ok = a === b && f(i + 1, j + 1);
      else if (a === "*" && b !== "*") ok = f(i, j + 1);
      else if (a !== "*" && b === "*") ok = f(i + 1, j);
    }
    memo.set(key, ok);
    return ok;
  };
  return f(0, 0);
}

/** ¿Hay alguna ruta que cumpla los dos globs? ("**" como segmento completo = 0 o más segmentos). */
function globsIntersect(a, b) {
  const A = a.split("/").map((s) => (s === "**" ? s : s.replaceAll("**", "*")));
  const B = b.split("/").map((s) => (s === "**" ? s : s.replaceAll("**", "*")));
  const memo = new Map();
  const g = (i, j) => {
    const key = i * 4096 + j;
    if (memo.has(key)) return memo.get(key);
    let ok = false;
    if (i === A.length && j === B.length) ok = true;
    if (!ok && i < A.length && A[i] === "**") ok = g(i + 1, j) || (j < B.length && g(i, j + 1));
    if (!ok && j < B.length && B[j] === "**") ok = g(i, j + 1) || (i < A.length && g(i + 1, j));
    if (!ok && i < A.length && j < B.length && A[i] !== "**" && B[j] !== "**") {
      ok = segmentsIntersect(A[i], B[j]) && g(i + 1, j + 1);
    }
    memo.set(key, ok);
    return ok;
  };
  return g(0, 0);
}

/** ¿La exclusión ``e`` cubre todo lo que cumple ``x``? (igual, literal que cumple, o prefijo "dir/**"). */
function covers(e, x) {
  if (e === x) return true;
  if (!isGlob(x)) return toRegex(e).test(x);
  return e.endsWith("/**") && x.startsWith(e.slice(0, -2));
}

// ─── modo 1: un stream contra su diff ──────────────────────────────────────────────────────────
function checkStream(stream, base) {
  if (!map[stream]) {
    console.error(`Stream desconocido: ${stream}. Válidos: ${STREAMS.join(", ")}`);
    process.exit(2);
  }
  const rules = rulesOf(stream);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const changed = git(["diff", "--name-only", `${base}...HEAD`])
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  const uncommitted = git(["status", "--porcelain", "-uall"])
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ""));
  const all = [...new Set([...changed, ...uncommitted])].map((f) => f.split(path.sep).join("/"));
  const outside = all.filter((f) => !owns(rules, f));
  if (outside.length) {
    console.error(`✗ ${stream} (${branch}) tocó ${outside.length} archivo(s) fuera de su propiedad:`);
    outside.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log(`✓ ${stream} (${branch}): ${all.length} archivo(s), todos dentro de su propiedad.`);
}

// ─── modo 2: cobertura y traslapes de una lista de streams ─────────────────────────────────────
function checkCoverage(list, { table }) {
  const requested = [...new Set(list.split(",").map((s) => s.trim()).filter(Boolean))];
  const unknown = requested.filter((s) => !map[s]);
  if (!requested.length || unknown.length) {
    console.error(`Streams desconocidos: ${unknown.join(", ") || "(lista vacía)"}. Válidos: ${STREAMS.join(", ")}`);
    process.exit(2);
  }
  const participants = [...requested.filter((s) => s !== FROZEN), FROZEN].map(rulesOf);
  const top = git(["rev-parse", "--show-toplevel"]).trim();
  const tracked = git(["ls-files", "-z"], { cwd: top }).split("\0").filter(Boolean);
  const ownersOf = (file) => participants.filter((r) => owns(r, file)).map((r) => r.stream);
  let failed = false;

  console.log(`Cobertura de ${requested.join(", ")} (+ ${FROZEN}, archivos congelados), ${tracked.length} archivos versionados`);

  // (1) cobertura
  const backend = tracked.filter((f) => f.startsWith("kaizen_api/"));
  const orphansBackend = backend.filter((f) => ownersOf(f).length === 0);
  if (orphansBackend.length) {
    failed = true;
    console.error(`✗ kaizen_api/: ${orphansBackend.length} de ${backend.length} archivo(s) sin dueño:`);
    orphansBackend.forEach((f) => console.error(`  - ${f}`));
  } else {
    console.log(`✓ kaizen_api/: ${backend.length} archivos, cada uno con dueño.`);
  }
  if (table) {
    for (const f of backend) console.log(`    ${f} → ${ownersOf(f).join(" y ") || "SIN DUEÑO"}`);
  }
  const front = tracked.filter((f) => f.startsWith("src/"));
  const orphansFront = front.filter((f) => ownersOf(f).length === 0);
  console.log(`ℹ src/: ${orphansFront.length} de ${front.length} archivo(s) sin dueño entre estos streams (informativo):`);
  orphansFront.forEach((f) => console.log(`  - ${f}`));

  // (2) traslapes
  const overlaps = new Map();
  const note = (what, streams) => {
    const key = `${what} :: ${[...streams].sort().join(",")}`;
    if (!overlaps.has(key)) overlaps.set(key, `${what}: ${[...streams].sort().join(" y ")}`);
  };
  for (const f of tracked) {
    const who = ownersOf(f);
    if (who.length > 1) note(f, who);
  }
  for (const p of participants) {
    for (const g of p.include) {
      if (!isGlob(g)) {
        const who = ownersOf(g);
        if (who.length > 1) note(g, who);
        continue;
      }
      for (const q of participants) {
        if (q.stream <= p.stream) continue;
        for (const h of q.include) {
          if (!isGlob(h) || !globsIntersect(g, h)) continue;
          const excluded = [...p.exclude, ...q.exclude].some((e) => covers(e, g) || covers(e, h));
          if (!excluded) note(`${g} (${p.stream}) ∩ ${h} (${q.stream})`, [p.stream, q.stream]);
        }
      }
    }
  }
  if (overlaps.size) {
    failed = true;
    console.error(`✗ ${overlaps.size} traslape(s): el mismo archivo tendría dos dueños.`);
    for (const line of overlaps.values()) console.error(`  - ${line}`);
  } else {
    console.log("✓ Sin traslapes: ningún archivo versionado, ruta declarada ni par de globs tiene dos dueños.");
  }
  process.exit(failed ? 1 : 0);
}

const args = process.argv.slice(2);
if (args[0] === "--coverage") {
  if (!args[1] || args[1].startsWith("--")) {
    console.error("Uso: node scripts/check-ownership.mjs --coverage A1,A2,B1,... [--table]");
    process.exit(2);
  }
  checkCoverage(args[1], { table: args.includes("--table") });
} else {
  const [stream, base = "analizavende"] = args;
  if (!stream) {
    console.error("Uso: node scripts/check-ownership.mjs <stream> [base]  |  --coverage A1,A2,... [--table]");
    process.exit(2);
  }
  checkStream(stream, base);
}
