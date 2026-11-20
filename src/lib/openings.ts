/**
 * Aberturas pelo catálogo do Lichess (data/lichess-openings, domínio público).
 * O índice é pela posição, então transposições também são reconhecidas.
 */
import table from "../data/openings.json";
import type { MoveNode } from "./chess-utils";

const fullmoveOf = (fen: string) => parseInt(fen.split(" ")[5] ?? "1", 10) || 1;

export interface Opening {
  eco: string;
  /** nome em português */
  name: string;
  /** nome original do catálogo (inglês) */
  nameEn: string;
}

/** posição → [ECO, nome pt-BR, nome em inglês]; 0 = posição intermediária de uma linha do catálogo (teoria sem nome) */
const OPENINGS = table as unknown as Record<string, [string, string, string] | 0>;

/** Peças + vez + roques: ignora en passant e contadores, como o gerador do índice. */
function key(fen: string) {
  return fen.split(" ").slice(0, 3).join(" ");
}

/** Abertura com nome exatamente nesta posição (null se a posição não está no livro). */
export function openingAt(fen: string): Opening | null {
  const hit = OPENINGS[key(fen)];
  return hit ? { eco: hit[0], name: hit[1], nameEn: hit[2] ?? hit[1] } : null;
}

/** A posição faz parte da teoria (catálogo de aberturas)? */
export function isBookPosition(fen: string): boolean {
  return key(fen) in OPENINGS;
}

/** "Defesa Siciliana: Variante Najdorf" → "Defesa Siciliana". */
export function openingFamily(name: string): string {
  return name.split(":")[0].trim();
}

export interface OpeningTrack {
  /** última abertura com nome no caminho (a mais específica alcançada) */
  opening: Opening | null;
  /** a posição final ainda está no livro? */
  inBook: boolean;
  /** índice (0-based) do primeiro lance fora do livro; null se ainda não saiu (ou nunca entrou) */
  outOfBookAt: number | null;
}

/** Acompanha a abertura ao longo de uma sequência de lances. */
export function trackOpening(moves: MoveNode[]): OpeningTrack {
  let opening: Opening | null = null;
  let outOfBookAt: number | null = null;
  let everInBook = false;
  moves.forEach((m, i) => {
    const hit = openingAt(m.fenAfter);
    if (hit) opening = hit;
    if (isBookPosition(m.fenAfter)) {
      everInBook = true;
      // voltou à teoria por transposição: o "saiu do livro" vale a partir da próxima saída
      if (outOfBookAt !== null && outOfBookAt < i) outOfBookAt = null;
    } else if (everInBook && outOfBookAt === null) outOfBookAt = i;
  });
  const last = moves[moves.length - 1];
  return { opening, inBook: !!last && isBookPosition(last.fenAfter), outOfBookAt };
}

/** "C50 Abertura Italiana: Giuoco Piano" */
export function openingLabel(o: Opening | null): string {
  return o ? `${o.eco} ${o.name}` : "";
}

/** Texto para o treinador: abertura e onde a partida saiu da teoria. */
export function openingContext(moves: MoveNode[]): string {
  const t = trackOpening(moves);
  if (!t.opening) return "Abertura: fora do catálogo de aberturas desde o início.";
  let s = `Abertura (catálogo do Lichess): ${openingLabel(t.opening)}${t.opening.nameEn !== t.opening.name ? ` (em inglês: ${t.opening.nameEn})` : ""}.`;
  if (t.outOfBookAt !== null) {
    const m = moves[t.outOfBookAt];
    s += ` A partida saiu da teoria em ${fullmoveOf(m.fenBefore)}${m.color === "w" ? "." : "..."} ${m.san} (${m.color === "w" ? "brancas" : "pretas"}).`;
  } else if (t.inBook) s += " A partida ainda está dentro da teoria.";
  return s;
}
