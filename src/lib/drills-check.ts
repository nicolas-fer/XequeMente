/** Corrige a resposta do aluno num exercício: lance principal, lance "que também serve" ou erro. */
import type { MoveNode, PositionEval } from "./chess-utils";
import { evaluatePosition } from "./review";
import type { DrillExercise } from "./drills-build";

/** Perda máxima (em centipeões) para um lance diferente do principal ainda ser aceito. */
export const ACCEPT_LOSS_CP = 50;
/** Valor de um mate; mates mais curtos valem um pouco mais. */
const MATE = 100_000;
/** Limite curto para as avaliações do exercício (o aluno espera pela resposta). */
const CHECK_LIMIT = { depth: 14, movetime: 2000 };

export type Judgement =
  | { kind: "best" }
  | { kind: "alt"; lossCp: number }
  /** `reply`: melhor resposta do adversário ao lance do aluno (UCI), quando o motor avaliou */
  | { kind: "wrong"; reply?: string }
  /** motor parado ou sem avaliação: não dá para julgar o lance */
  | { kind: "unknown" };

const clean = (san: string) => san.replace(/[+#!?]/g, "");

/**
 * Pontuação de uma avaliação do ponto de vista de `color` (em centipeões; mate vale MATE menos a distância).
 * A avaliação guardada é sempre do ponto de vista das brancas.
 */
export function scoreFor(e: PositionEval, color: "w" | "b"): number {
  const sign = color === "w" ? 1 : -1;
  if (e.terminal) return e.terminal === "draw" ? 0 : e.terminal === color ? MATE : -MATE;
  if (e.mate !== null) return sign * (e.mate > 0 ? MATE - e.mate : -MATE - e.mate);
  return sign * (e.cp ?? 0);
}

/**
 * Julga o lance do aluno. Só o lance principal é aceito sem motor. Outro lance é aceito se a perda
 * for de até ACCEPT_LOSS_CP (ou, quando havia mate a favor, se o outro lance também levar a mate).
 */
export async function judgeMove(ex: DrillExercise, move: MoveNode, engineReady: boolean): Promise<Judgement> {
  if (clean(move.san) === clean(ex.bestSan)) return { kind: "best" };
  if (move.uci === ex.playedUci) return { kind: "wrong", reply: ex.replyUci || undefined };
  if (!engineReady) return { kind: "unknown" };
  try {
    const before = ex.evalBefore ?? (await evaluatePosition(ex.fen, CHECK_LIMIT));
    const after = await evaluatePosition(move.fenAfter, CHECK_LIMIT);
    if (!before || !after) return { kind: "unknown" };
    const bestScore = scoreFor(before, ex.playerColor);
    const altScore = scoreFor(after, ex.playerColor);
    const loss = bestScore - altScore;
    // Havia mate a favor: qualquer outro mate também resolve (mesmo um pouco mais longo).
    const winningMate = (s: number) => s >= MATE - 1000;
    const ok = winningMate(bestScore) ? winningMate(altScore) : loss <= ACCEPT_LOSS_CP;
    return ok ? { kind: "alt", lossCp: Math.max(0, Math.round(loss)) } : { kind: "wrong", reply: after.best ?? undefined };
  } catch {
    return { kind: "unknown" };
  }
}
