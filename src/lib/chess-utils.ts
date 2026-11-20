import { Chess, validateFen, type Square } from "chess.js";
import type { BoardRead, PvLine } from "./api";
import { isBookPosition } from "./openings";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface MoveNode {
  san: string;
  uci: string;
  from: string;
  to: string;
  promotion?: string;
  color: "w" | "b";
  fenBefore: string;
  fenAfter: string;
}

export function makeMove(fen: string, from: string, to: string, promotion?: string): MoveNode | null {
  try {
    const chess = new Chess(fen);
    const m = chess.move({ from, to, promotion: promotion ?? "q" });
    return {
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ""),
      from: m.from,
      to: m.to,
      promotion: m.promotion,
      color: m.color,
      fenBefore: m.before,
      fenAfter: m.after,
    };
  } catch {
    return null;
  }
}

export function uciToMove(fen: string, uci: string): MoveNode | null {
  if (uci.length < 4) return null;
  return makeMove(fen, uci.slice(0, 2), uci.slice(2, 4), uci.length > 4 ? uci[4] : undefined);
}

export function fullmoveOf(fen: string): number {
  return parseInt(fen.split(" ")[5] ?? "1", 10) || 1;
}

export function turnOf(fen: string): "w" | "b" {
  return fen.split(" ")[1] === "b" ? "b" : "w";
}

/** "12. Nf3" ou "12... Nf6" */
export function moveLabel(m: MoveNode): string {
  const n = fullmoveOf(m.fenBefore);
  return m.color === "w" ? `${n}. ${m.san}` : `${n}... ${m.san}`;
}

/** Formata uma lista de lances em notação de PGN. */
export function formatMoves(moves: MoveNode[]): string {
  const parts: string[] = [];
  moves.forEach((m, i) => {
    const n = fullmoveOf(m.fenBefore);
    if (m.color === "w") parts.push(`${n}. ${m.san}`);
    else if (i === 0) parts.push(`${n}... ${m.san}`);
    else parts.push(m.san);
  });
  return parts.join(" ");
}

/** Converte uma PV em UCI para SAN com numeração. */
export function pvToSan(fen: string, pv: string[], max = 12): string {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (let i = 0; i < Math.min(pv.length, max); i++) {
    const uci = pv[i];
    const color = chess.turn();
    const n = chess.moveNumber();
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (color === "w") out.push(`${n}. ${m.san}`);
      else out.push(i === 0 ? `${n}... ${m.san}` : m.san);
    } catch {
      break;
    }
  }
  return out.join(" ");
}

export function uciToSan(fen: string, uci: string | null | undefined): string {
  if (!uci) return "";
  return uciToMove(fen, uci)?.san ?? uci;
}

// ---------------------------------------------------------------- Avaliação

export interface PositionEval {
  cp: number | null;
  mate: number | null;
  best: string | null;
  depth: number;
  pv: string[];
  /** fim de jogo: vencedor ou empate */
  terminal?: "w" | "b" | "draw";
  /** avaliação da segunda melhor linha (para reconhecer lances "Ótimos": únicos bons) */
  alt?: { cp: number | null; mate: number | null } | null;
}

export function evalFromLine(line: PvLine | undefined, best: string | null, second?: PvLine): PositionEval | null {
  if (!line) return null;
  return {
    cp: line.cp,
    mate: line.mate,
    best: best ?? line.pv[0] ?? null,
    depth: line.depth,
    pv: line.pv,
    alt: second ? { cp: second.cp, mate: second.mate } : null,
  };
}

export function terminalEval(fen: string): PositionEval | null {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) {
    const winner = chess.turn() === "w" ? "b" : "w";
    return { cp: null, mate: 0, best: null, depth: 0, pv: [], terminal: winner };
  }
  if (chess.isDraw() || chess.isStalemate()) {
    return { cp: 0, mate: null, best: null, depth: 0, pv: [], terminal: "draw" };
  }
  return null;
}

/** Probabilidade de vitória das brancas (0..100), fórmula usada pelo Lichess. */
export function winPct(e: Pick<PositionEval, "cp" | "mate" | "terminal"> | null | undefined): number {
  if (!e) return 50;
  if (e.terminal === "w") return 100;
  if (e.terminal === "b") return 0;
  if (e.terminal === "draw") return 50;
  if (e.mate !== null && e.mate !== undefined) return e.mate > 0 ? 100 : 0;
  const cp = Math.max(-1000, Math.min(1000, e.cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function evalText(e: Pick<PositionEval, "cp" | "mate" | "terminal"> | null | undefined): string {
  if (!e) return "…";
  if (e.terminal === "w") return "1-0";
  if (e.terminal === "b") return "0-1";
  if (e.terminal === "draw") return "½-½";
  if (e.mate !== null && e.mate !== undefined) return e.mate > 0 ? `#${e.mate}` : `#-${Math.abs(e.mate)}`;
  const v = (e.cp ?? 0) / 100;
  return (v > 0 ? "+" : "") + v.toFixed(2);
}

export function evalWords(e: PositionEval | null | undefined): string {
  if (!e) return "sem avaliação";
  if (e.terminal) return e.terminal === "draw" ? "empate" : e.terminal === "w" ? "brancas venceram" : "pretas venceram";
  if (e.mate !== null) return e.mate > 0 ? `brancas dão mate em ${e.mate}` : `pretas dão mate em ${Math.abs(e.mate)}`;
  const cp = e.cp ?? 0;
  const a = Math.abs(cp);
  const side = cp > 0 ? "brancas" : "pretas";
  if (a < 30) return "igualdade";
  if (a < 80) return `leve vantagem das ${side}`;
  if (a < 200) return `vantagem clara das ${side}`;
  return `vantagem decisiva das ${side}`;
}

export type MoveClass = "great" | "best" | "excellent" | "good" | "book" | "inaccuracy" | "mistake" | "blunder";

/** Ordem de exibição das categorias (da melhor para a pior). */
export const CLASS_ORDER: MoveClass[] = ["great", "best", "excellent", "good", "book", "inaccuracy", "mistake", "blunder"];

export function emptyCounts(): Record<MoveClass, number> {
  return { great: 0, best: 0, excellent: 0, good: 0, book: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
}

export interface MoveReview {
  cls: MoveClass;
  loss: number;
  accuracy: number;
  bestUci: string | null;
  bestSan: string;
}

export const CLASS_INFO: Record<MoveClass, { label: string; symbol: string; color: string }> = {
  great: { label: "Ótimo", symbol: "!", color: "#749bbf" },
  best: { label: "Melhor lance", symbol: "★", color: "#81b64c" },
  excellent: { label: "Excelente", symbol: "✔", color: "#96bc4b" },
  good: { label: "Bom", symbol: "✓", color: "#95b776" },
  // símbolo vazio: o selo desenha um livro via CSS (.badge:empty)
  book: { label: "Teórico", symbol: "", color: "#a88865" },
  inaccuracy: { label: "Imprecisão", symbol: "?!", color: "#f7c045" },
  mistake: { label: "Erro", symbol: "?", color: "#e58f2a" },
  blunder: { label: "Erro grave", symbol: "??", color: "#ca3431" },
};

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const GLYPHS: Record<string, string> = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛" };

/** Peças que cada lado capturou (glifos) e a vantagem material. */
export function capturedInfo(fen: string): Record<"w" | "b", { glyphs: string; advantage: number }> {
  const placement = fen.split(" ")[0];
  const count = { w: {} as Record<string, number>, b: {} as Record<string, number> };
  for (const ch of placement) {
    if (!/[a-z]/i.test(ch)) continue;
    const c = ch === ch.toUpperCase() ? "w" : "b";
    const t = ch.toLowerCase();
    count[c][t] = (count[c][t] ?? 0) + 1;
  }
  const material = (c: "w" | "b") => Object.entries(count[c]).reduce((s, [t, n]) => s + PIECE_VALUE[t] * n, 0);
  const capturedBy = (c: "w" | "b") => {
    const opp = c === "w" ? "b" : "w";
    let out = "";
    for (const t of ["q", "r", "b", "n", "p"]) {
      const missing = Math.max(0, START_COUNT[t] - (count[opp][t] ?? 0));
      out += GLYPHS[t].repeat(missing);
    }
    return out;
  };
  const diff = material("w") - material("b");
  return {
    w: { glyphs: capturedBy("w"), advantage: Math.max(0, diff) },
    b: { glyphs: capturedBy("b"), advantage: Math.max(0, -diff) },
  };
}

/** Chance de vitória das brancas como o Lichess usa na precisão: mate (e posição de mate) vale ±1000 centipeões. */
export function lichessWinPct(e: Pick<PositionEval, "cp" | "mate" | "terminal">): number {
  let cp: number;
  if (e.terminal === "draw") cp = 0;
  else if (e.terminal) cp = e.terminal === "w" ? 1000 : -1000;
  else if (e.mate !== null && e.mate !== undefined) cp = e.mate > 0 ? 1000 : e.mate < 0 ? -1000 : 0;
  else cp = e.cp ?? 0;
  return winPct({ cp, mate: null });
}

/**
 * Precisão de um lance a partir da chance de vitória antes e depois (do ponto de vista de quem jogou).
 * Fórmula do Lichess, incluindo o bônus de +1 pela imprecisão da própria análise.
 */
export function moveAccuracy(before: number, after: number): number {
  if (after >= before) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw + 1));
}

/**
 * Classifica um lance como no chess.com, pela perda em "pontos esperados" (aqui, pontos de chance de vitória):
 * Excelente < 2, Bom 2–5, Imprecisão 5–10, Erro 10–20, Erro grave 20+.
 * "Melhor" = lance do motor; "Ótimo" = lance do motor quando a segunda opção era bem pior (lance crítico).
 * "Teórico" = lance que leva a uma posição do catálogo de aberturas (tem prioridade, como no chess.com).
 */
export function reviewMove(
  move: MoveNode,
  before: PositionEval | null,
  after: PositionEval | null,
  prev?: MoveNode | null,
): MoveReview | null {
  if (!before || !after) return null;
  const forMover = (e: Pick<PositionEval, "cp" | "mate" | "terminal">) => (move.color === "w" ? winPct(e) : 100 - winPct(e));
  const wb = forMover(before);
  const wa = forMover(after);
  const loss = Math.max(0, wb - wa);
  let cls: MoveClass;
  if (isBookPosition(move.fenAfter)) cls = "book";
  else if (before.best && move.uci === before.best) {
    const altLoss = before.alt ? wb - forMover({ cp: before.alt.cp, mate: before.alt.mate }) : 0;
    const recapture = !!prev && prev.san.includes("x") && prev.to === move.to;
    const critical = altLoss >= 15 && !recapture && wb > 8 && wb < 97;
    cls = critical ? "great" : "best";
  } else if (loss >= 20) cls = "blunder";
  else if (loss >= 10) cls = "mistake";
  else if (loss >= 5) cls = "inaccuracy";
  else if (loss >= 2) cls = "good";
  else cls = "excellent";
  const lw = (e: PositionEval) => (move.color === "w" ? lichessWinPct(e) : 100 - lichessWinPct(e));
  return { cls, loss, accuracy: moveAccuracy(lw(before), lw(after)), bestUci: before.best, bestSan: uciToSan(move.fenBefore, before.best) };
}

function stdDev(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

/**
 * Precisão da partida para cada lado, pelo algoritmo do Lichess: cada lance pesa pela volatilidade
 * da posição (desvio padrão da chance de vitória numa janela) e o resultado é a média entre a média
 * ponderada e a média harmônica, o que faz os erros graves pesarem mais que numa média simples.
 */
export function gameAccuracy(moves: MoveNode[], evals: (PositionEval | null)[]): Record<"w" | "b", number | null> {
  const n = moves.length;
  if (!n || evals.length < n + 1 || evals.slice(0, n + 1).some((e) => !e)) return { w: null, b: null };
  const wp = evals.slice(0, n + 1).map((e) => lichessWinPct(e!));
  const windowSize = Math.min(8, Math.max(2, Math.floor(n / 10)));
  const windows: number[][] = [];
  const first = wp.slice(0, windowSize);
  for (let k = 0; k < Math.min(windowSize, wp.length) - 2; k++) windows.push(first);
  for (let i = 0; i + windowSize <= wp.length; i++) windows.push(wp.slice(i, i + windowSize));
  const weights = windows.map((xs) => Math.min(12, Math.max(0.5, stdDev(xs))));
  const per: Record<"w" | "b", { acc: number; weight: number }[]> = { w: [], b: [] };
  moves.forEach((m, i) => {
    const before = m.color === "w" ? wp[i] : 100 - wp[i];
    const after = m.color === "w" ? wp[i + 1] : 100 - wp[i + 1];
    per[m.color].push({ acc: moveAccuracy(before, after), weight: weights[i] ?? 0.5 });
  });
  const combine = (xs: { acc: number; weight: number }[]) => {
    if (!xs.length) return null;
    const wsum = xs.reduce((s, x) => s + x.weight, 0);
    const weighted = xs.reduce((s, x) => s + x.acc * x.weight, 0) / wsum;
    const harmonic = xs.length / xs.reduce((s, x) => s + 1 / Math.max(x.acc, 1e-9), 0);
    return (weighted + harmonic) / 2;
  };
  return { w: combine(per.w), b: combine(per.b) };
}

// ---------------------------------------------------------------- Editor / FEN

export type PieceCode = "wK" | "wQ" | "wR" | "wB" | "wN" | "wP" | "bK" | "bQ" | "bR" | "bB" | "bN" | "bP";
export type BoardMap = Record<string, PieceCode>;

const FILES = "abcdefgh";

export function fenToBoardMap(fen: string): BoardMap {
  const map: BoardMap = {};
  const rows = fen.split(" ")[0].split("/");
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += parseInt(ch, 10);
      else {
        const color = ch === ch.toUpperCase() ? "w" : "b";
        if (f < 8 && r < 8) map[`${FILES[f]}${8 - r}`] = (color + ch.toUpperCase()) as PieceCode;
        f++;
      }
    }
  });
  return map;
}

export function boardMapToPlacement(map: BoardMap): string {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = "";
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = map[`${FILES[f]}${rank}`];
      if (!p) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += p[0] === "w" ? p[1] : p[1].toLowerCase();
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join("/");
}

export interface Castling {
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
}

/** Mantém apenas os roques possíveis pela posição de reis e torres. */
export function sanitizeCastling(map: BoardMap, c: Castling): string {
  let s = "";
  if (c.K && map.e1 === "wK" && map.h1 === "wR") s += "K";
  if (c.Q && map.e1 === "wK" && map.a1 === "wR") s += "Q";
  if (c.k && map.e8 === "bK" && map.h8 === "bR") s += "k";
  if (c.q && map.e8 === "bK" && map.a8 === "bR") s += "q";
  return s || "-";
}

export function buildFen(map: BoardMap, turn: "w" | "b", castling: Castling, ep = "-", fullmove = 1): string {
  return `${boardMapToPlacement(map)} ${turn} ${sanitizeCastling(map, castling)} ${ep} 0 ${Math.max(1, fullmove)}`;
}

/** Validação amigável de posição (em português). Retorna lista de problemas. */
export function validatePosition(fen: string): string[] {
  const errors: string[] = [];
  const map = fenToBoardMap(fen);
  const count = (p: PieceCode) => Object.values(map).filter((x) => x === p).length;
  const side = (c: "w" | "b") => Object.values(map).filter((x) => x[0] === c).length;
  if (count("wK") !== 1) errors.push("As brancas precisam ter exatamente um rei.");
  if (count("bK") !== 1) errors.push("As pretas precisam ter exatamente um rei.");
  if (count("wP") > 8) errors.push("As brancas têm mais de 8 peões.");
  if (count("bP") > 8) errors.push("As pretas têm mais de 8 peões.");
  if (side("w") > 16) errors.push("As brancas têm mais de 16 peças.");
  if (side("b") > 16) errors.push("As pretas têm mais de 16 peças.");
  for (const sq of Object.keys(map)) {
    if (map[sq][1] === "P" && (sq[1] === "1" || sq[1] === "8")) errors.push(`Peão em ${sq} (1ª/8ª fileira) não é permitido.`);
  }
  if (errors.length) return errors;
  const v = validateFen(fen);
  if (!v.ok) return [v.error ?? "FEN inválido."];
  try {
    const parts = fen.split(" ");
    parts[1] = parts[1] === "w" ? "b" : "w";
    parts[3] = "-";
    const flipped = new Chess(parts.join(" "));
    if (flipped.isCheck()) errors.push("O lado que NÃO joga está em xeque: a posição é impossível (confira de quem é a vez).");
  } catch (e) {
    errors.push(String(e));
  }
  return errors;
}

/** Converte a leitura da imagem (feita pelo LLM) em FEN. */
export function boardReadToFen(read: BoardRead): { fen: string; warnings: string[] } {
  const warnings: string[] = [];
  let rows = read.rows.slice(0, 8).map((r) => {
    const clean = r.replace(/\s/g, "").replace(/[^KQRBNPkqrbnp.1-8]/g, "");
    // aceita dígitos estilo FEN dentro da linha, por garantia
    const expanded = clean.replace(/[1-8]/g, (d) => ".".repeat(parseInt(d, 10)));
    if (expanded.length !== 8) warnings.push(`Uma fileira veio com ${expanded.length} casas; foi ajustada.`);
    return (expanded + "........").slice(0, 8);
  });
  while (rows.length < 8) {
    rows.push("........");
    warnings.push("Faltaram fileiras na leitura; completei com casas vazias.");
  }
  if (read.orientation === "black_bottom") {
    rows = rows.reverse().map((r) => r.split("").reverse().join(""));
  }
  const map: BoardMap = {};
  rows.forEach((row, r) => {
    row.split("").forEach((ch, f) => {
      if (ch !== ".") map[`${FILES[f]}${8 - r}`] = ((ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase()) as PieceCode;
    });
  });
  const turn = read.sideToMove === "b" ? "b" : "w";
  if (read.sideToMove === "unknown") warnings.push("Não deu para saber de quem é a vez; deixei as brancas. Ajuste se precisar.");
  const fen = buildFen(map, turn, { K: true, Q: true, k: true, q: true });
  return { fen, warnings };
}

export function squareOfKingInCheck(fen: string): string | null {
  try {
    const chess = new Chess(fen);
    if (!chess.isCheck()) return null;
    const turn = chess.turn();
    for (const row of chess.board()) {
      for (const p of row) if (p && p.type === "k" && p.color === turn) return p.square as Square;
    }
  } catch {
    /* ignora */
  }
  return null;
}

/**
 * Encontra na partida o lance citado num texto ("12. Nf3", "7... Bf8") e devolve o ply da posição depois dele.
 * Usa número + cor; se não bater, procura pelo SAN.
 */
export function resolveMoveRef(moves: MoveNode[], moveNumber: number, black: boolean, san: string): number | null {
  const clean = (x: string) => x.replace(/[+#!?]/g, "");
  const color = black ? "b" : "w";
  const byNumber = moves.findIndex((m) => m.color === color && fullmoveOf(m.fenBefore) === moveNumber);
  if (byNumber >= 0 && clean(moves[byNumber].san) === clean(san)) return byNumber + 1;
  const bySan = moves.map((m, i) => (clean(m.san) === clean(san) ? i : -1)).filter((i) => i >= 0);
  if (bySan.length) {
    // o mais próximo do número citado
    const target = (moveNumber - 1) * 2 + (black ? 1 : 0);
    bySan.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
    return bySan[0] + 1;
  }
  return byNumber >= 0 ? byNumber + 1 : null;
}

/** Versão enxuta de uma avaliação para guardar no histórico (linha principal curta). */
export function compactEval(e: PositionEval | null): PositionEval | null {
  if (!e) return null;
  return { ...e, pv: e.pv.slice(0, 8) };
}
