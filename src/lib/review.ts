import { api, nextSearchId, type Settings } from "./api";
import {
  CLASS_INFO,
  evalFromLine,
  evalText,
  fenToBoardMap,
  moveLabel,
  pvToSan,
  reviewMove,
  terminalEval,
  uciToSan,
  type MoveClass,
  type MoveNode,
  type MoveReview,
  type PositionEval,
} from "./chess-utils";

export type Phase = "opening" | "middlegame" | "endgame";
export const PHASE_LABEL: Record<Phase, string> = { opening: "Abertura", middlegame: "Meio-jogo", endgame: "Final" };

export function reviewLimitOf(s: Settings) {
  return s.reviewMode === "time" ? { movetime: s.reviewMs } : { depth: s.reviewDepth };
}

/** Avalia todas as posições da partida com o motor de análise. Devolve null se cancelado. */
export async function evaluateGame(
  startFen: string,
  moves: MoveNode[],
  limit: { depth?: number; movetime?: number },
  onProgress: (evals: (PositionEval | null)[], done: number, total: number) => void,
  cancelled: () => boolean,
): Promise<(PositionEval | null)[] | null> {
  const positions = [startFen, ...moves.map((m) => m.fenAfter)];
  const evals: (PositionEval | null)[] = new Array(positions.length).fill(null);
  for (let i = 0; i < positions.length; i++) {
    if (cancelled()) return null;
    const term = terminalEval(positions[i]);
    if (term) evals[i] = term;
    else {
      const r = await api.engineEval(nextSearchId(), positions[i], limit, 1);
      evals[i] = evalFromLine(r.lines[0], r.bestMove);
    }
    onProgress([...evals], i + 1, positions.length);
  }
  return evals;
}

export function phaseOf(fen: string): Phase {
  const map = fenToBoardMap(fen);
  const value: Record<string, number> = { N: 3, B: 3, R: 5, Q: 9 };
  const material = Object.values(map).reduce((s, p) => s + (value[p[1]] ?? 0), 0);
  const fullmove = parseInt(fen.split(" ")[5] ?? "1", 10) || 1;
  if (material <= 26) return "endgame";
  if (fullmove <= 10) return "opening";
  return "middlegame";
}

/** Avaliação do ponto de vista de quem jogou. */
function forColor(e: PositionEval | null, color: "w" | "b") {
  if (!e) return null;
  const s = color === "w" ? 1 : -1;
  return { cp: e.cp === null ? null : e.cp * s, mate: e.mate === null ? null : e.mate * s, terminal: e.terminal };
}

/** Rótulos do tipo de erro, calculados a partir dos dados do motor. */
export function mistakeTags(
  move: MoveNode,
  review: MoveReview,
  before: PositionEval | null,
  after: PositionEval | null,
  clockMs: number | null,
  baseMs: number | null,
): string[] {
  const tags: string[] = [];
  const b = forColor(before, move.color);
  const a = forColor(after, move.color);
  const replySan = after?.best ? uciToSan(move.fenAfter, after.best) : "";
  if (b?.mate && b.mate > 0 && !(a?.mate && a.mate > 0)) tags.push("perdeu um mate");
  else if (a?.mate && a.mate < 0 && !(b?.mate && b.mate < 0)) tags.push("permitiu mate");
  else if (replySan.includes("x")) tags.push("deixou material atacado");
  else if (/[x+#]/.test(review.bestSan)) tags.push("perdeu lance tático");
  else tags.push("erro posicional");
  if (clockMs !== null && baseMs) {
    if (clockMs < Math.max(20_000, baseMs * 0.1)) tags.push("apuro de tempo");
  }
  return tags;
}

export interface MistakeInfo {
  ply: number;
  label: string;
  cls: MoveClass;
  bestSan: string;
  line: string;
  evalBefore: string;
  evalAfter: string;
  phase: Phase;
  tags: string[];
  clockMs: number | null;
}

export interface PlayerSummary {
  accuracy: number | null;
  opponentAccuracy: number | null;
  counts: Record<MoveClass, number>;
  phaseAcc: Partial<Record<Phase, number>>;
  mistakes: MistakeInfo[];
  /** lances do jogador em formato compacto para o treinador: "12. Nf5 [melhor] (+0.80 → +0.92)" */
  moveDigest: string[];
}

/** Resume a revisão do ponto de vista de um lado. `clocks[i]` = relógio de quem jogou o lance i, antes dele. */
export function summarizeFor(
  color: "w" | "b",
  moves: MoveNode[],
  evals: (PositionEval | null)[],
  clocks: (number | null)[] = [],
  baseMs: number | null = null,
): PlayerSummary {
  const counts: Record<MoveClass, number> = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  const acc: number[] = [];
  const oppAcc: number[] = [];
  const byPhase: Record<Phase, number[]> = { opening: [], middlegame: [], endgame: [] };
  const mistakes: MistakeInfo[] = [];
  const moveDigest: string[] = [];
  moves.forEach((m, i) => {
    const r = reviewMove(m, evals[i] ?? null, evals[i + 1] ?? null);
    if (!r) return;
    if (m.color !== color) {
      oppAcc.push(r.accuracy);
      return;
    }
    counts[r.cls]++;
    acc.push(r.accuracy);
    const phase = phaseOf(m.fenBefore);
    byPhase[phase].push(r.accuracy);
    const before = evals[i] ?? null;
    const after = evals[i + 1] ?? null;
    moveDigest.push(`${moveLabel(m)} [${CLASS_INFO[r.cls].label.toLowerCase()}] (${evalText(before)} → ${evalText(after)})`);
    if (r.cls === "inaccuracy" || r.cls === "mistake" || r.cls === "blunder") {
      const clockMs = clocks[i] ?? null;
      mistakes.push({
        ply: i + 1,
        label: moveLabel(m),
        cls: r.cls,
        bestSan: r.bestSan,
        line: before?.pv.length ? pvToSan(m.fenBefore, before.pv, 6) : "",
        evalBefore: evalText(before),
        evalAfter: evalText(after),
        phase,
        tags: mistakeTags(m, r, before, after, clockMs, baseMs),
        clockMs,
      });
    }
  });
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const phaseAcc: Partial<Record<Phase, number>> = {};
  (Object.keys(byPhase) as Phase[]).forEach((p) => {
    const v = avg(byPhase[p]);
    if (v !== null) phaseAcc[p] = Math.round(v * 10) / 10;
  });
  return { accuracy: avg(acc), opponentAccuracy: avg(oppAcc), counts, phaseAcc, mistakes, moveDigest };
}
