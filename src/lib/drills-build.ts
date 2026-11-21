/** Monta os exercícios "Treinar meus erros" a partir das partidas salvas do aluno. */
import { Chess } from "chess.js";
import { uciToSan, type MoveNode, type PositionEval } from "./chess-utils";
import type { MistakeInfo } from "./review";
import { movesOf, type GameRecord } from "./profile";
import type { DrillCls, DrillRef } from "./drills";

const PRIORITY: Record<DrillCls, number> = { blunder: 0, mistake: 1, inaccuracy: 2 };

/** Exercício pronto para a sessão. A posição é a de antes do lance errado. */
export interface DrillExercise {
  id: string;
  gameId: string;
  ply: number;
  botName: string;
  /** cor do aluno (tabuleiro orientado para ele) */
  playerColor: "w" | "b";
  fen: string;
  /** rótulo do lance errado, ex.: "19. Bb4" */
  label: string;
  cls: DrillCls;
  bestSan: string;
  bestUci: string;
  /** lance que o aluno jogou de fato */
  playedUci: string;
  /** continuação do melhor lance, em SAN numerado */
  line: string;
  tags: string[];
  /** avaliação antes do lance (null se a partida não foi revisada) */
  evalBefore: PositionEval | null;
  /** melhor resposta do adversário ao lance errado da partida, em SAN (vazio se não avaliado) */
  reply: string;
  /** a mesma resposta em UCI */
  replyUci: string;
  moves: MoveNode[];
  coach: GameRecord["coach"];
}

/** Referências dos exercícios de todas as partidas, do erro mais grave para o mais leve. */
export function drillRefs(games: GameRecord[]): DrillRef[] {
  const refs: DrillRef[] = [];
  for (const g of games) {
    for (const m of g.mistakes ?? []) {
      if (m.cls !== "blunder" && m.cls !== "mistake" && m.cls !== "inaccuracy") continue;
      refs.push({ id: `${g.id}:${m.ply}`, gameId: g.id, ply: m.ply, cls: m.cls });
    }
  }
  // sort é estável: dentro de cada categoria, as partidas mais recentes continuam primeiro
  return refs.sort((a, b) => PRIORITY[a.cls] - PRIORITY[b.cls]);
}

/** Monta o exercício de um erro. Devolve null se não der para reconstruir a posição. */
export function buildExercise(g: GameRecord, m: MistakeInfo): DrillExercise | null {
  const moves = movesOf(g);
  const played = moves[m.ply - 1];
  if (!played || played.color !== g.playerColor || !m.bestSan) return null;
  let best;
  try {
    best = new Chess(played.fenBefore).move(m.bestSan);
  } catch {
    return null;
  }
  if (!best) return null;
  const afterEval = g.evals?.[m.ply] ?? null;
  return {
    id: `${g.id}:${m.ply}`,
    gameId: g.id,
    ply: m.ply,
    botName: g.botName,
    playerColor: g.playerColor,
    fen: played.fenBefore,
    label: m.label,
    cls: m.cls as DrillCls,
    bestSan: best.san,
    bestUci: best.from + best.to + (best.promotion ?? ""),
    playedUci: played.uci,
    line: m.line,
    tags: m.tags,
    evalBefore: g.evals?.[m.ply - 1] ?? null,
    reply: afterEval?.best ? uciToSan(played.fenAfter, afterEval.best) : "",
    replyUci: afterEval?.best ?? "",
    moves,
    coach: g.coach,
  };
}

/** Exercícios das referências escolhidas para a sessão (ignora os que não puderam ser montados). */
export function exercisesFor(refs: DrillRef[], games: GameRecord[]): DrillExercise[] {
  const byId = new Map(games.map((g) => [g.id, g]));
  const out: DrillExercise[] = [];
  for (const r of refs) {
    const g = byId.get(r.gameId);
    const m = g?.mistakes.find((x) => x.ply === r.ply);
    const ex = g && m ? buildExercise(g, m) : null;
    if (ex) out.push(ex);
  }
  return out;
}

const THEME_HINTS: Record<string, string> = {
  "perdeu um mate": "Havia um mate ou uma vantagem decisiva. Procure a continuação forçada, com xeque.",
  "permitiu mate": "Cuidado com as ameaças do adversário: antes de jogar, veja se ele tem mate ou ameaça forte.",
  "deixou material atacado": "Antes de jogar, veja se alguma peça sua fica atacada ou sem proteção depois do lance.",
  "perdeu lance tático": "Procure um lance tático: xeque, captura, garfo ou ameaça que ganhe material.",
  "erro posicional": "Não é um lance tático. Pense no plano: peças ativas, casas centrais e a estrutura de peões.",
};

/** Dica de tema, a partir dos rótulos do erro. */
export function themeHint(tags: string[]): string {
  for (const t of tags) if (THEME_HINTS[t]) return THEME_HINTS[t];
  return "Compare as ameaças dos dois lados antes de mover.";
}

/** Casas de origem e destino de um lance em UCI. */
export function squaresOf(uci: string): { from: string; to: string } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}
