// Gera src/data/openings.json a partir do catálogo do Lichess (data/lichess-openings/*.tsv).
// Índice pela POSIÇÃO (peças + vez + roques), não pela ordem dos lances: assim transposições
// também são reconhecidas. Formato: { "<chave>": ["ECO", "Nome em pt-BR", "Nome em inglês"] | 0 }, onde 0
// marca uma posição intermediária de alguma linha do catálogo (é teoria, mas não tem nome próprio).
// Tradução: families.pt-BR.tsv (feita à mão) + segments.pt-BR.tsv (scripts/translate-openings.py).
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chess.js";

const dir = new URL("../data/lichess-openings/", import.meta.url);
const out = new URL("../src/data/openings.json", import.meta.url);
const key = (fen) => fen.split(" ").slice(0, 3).join(" ");
const readTsv = (f) => {
  try {
    return new Map(readFileSync(new URL(f, dir), "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split("\t")));
  } catch {
    return new Map();
  }
};
const families = readTsv("families.pt-BR.tsv");
const segments = readTsv("segments.pt-BR.tsv");
const untranslated = new Set();
/** "Sicilian Defense: Najdorf Variation, English Attack" → "Defesa Siciliana: Variante Najdorf, Ataque Inglês" */
function toPt(name) {
  const i = name.indexOf(":");
  const family = i < 0 ? name : name.slice(0, i);
  const fam = families.get(family) ?? (untranslated.add(family), family);
  if (i < 0) return fam;
  const rest = name
    .slice(i + 1)
    .trim()
    .split(", ")
    .map((s) => segments.get(s) ?? (untranslated.add(s), s));
  return `${fam}: ${rest.join(", ")}`;
}

const index = new Map(); // chave -> { eco, name, plies }
const inner = new Set(); // posições no caminho das linhas (teoria sem nome)
let lines = 0;
for (const f of ["a", "b", "c", "d", "e"]) {
  const rows = readFileSync(new URL(`${f}.tsv`, dir), "utf8").split(/\r?\n/).slice(1).filter(Boolean);
  for (const row of rows) {
    const [eco, name, pgn] = row.split("\t");
    const chess = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, " ").trim().split(/\s+/);
    sans.forEach((san, i) => {
      chess.move(san); // lança se o catálogo tiver lance inválido
      if (i < sans.length - 1) inner.add(key(chess.fen()));
    });
    lines++;
    const k = key(chess.fen());
    const prev = index.get(k);
    // Mesma posição com dois nomes: fica o da linha mais curta (a principal).
    if (!prev || sans.length < prev.plies) index.set(k, { eco, name, plies: sans.length });
  }
}
const obj = {};
for (const k of inner) if (!index.has(k)) obj[k] = 0;
for (const [k, v] of index.entries()) obj[k] = [v.eco, toPt(v.name), v.name];
const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(out, JSON.stringify(sorted));
if (untranslated.size) console.warn(`${untranslated.size} trechos sem tradução (ficam em inglês): ${[...untranslated].slice(0, 10).join(" | ")}`);
console.log(`${lines} linhas do catálogo → ${index.size} posições com nome + ${Object.keys(sorted).length - index.size} intermediárias`);
