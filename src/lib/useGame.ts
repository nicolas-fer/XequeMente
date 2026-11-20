import { useCallback, useMemo, useReducer } from "react";
import { START_FEN, type MoveNode, type PositionEval } from "./chess-utils";

export interface Variation {
  /** número de lances da linha principal antes da variante */
  base: number;
  moves: MoveNode[];
}

export interface Cursor {
  inVar: boolean;
  ply: number;
}

export interface GameState {
  startFen: string;
  moves: MoveNode[];
  headers: Record<string, string>;
  variation: Variation | null;
  cursor: Cursor;
  /** muda a cada partida carregada (zera revisão) */
  version: number;
  /** revisão já feita (ex.: partida do histórico): a Análise mostra sem recalcular */
  preReview?: (PositionEval | null)[] | null;
  /** partida salva de onde esta análise veio (conversa e revisão ficam ligadas a ela) */
  linkedRecordId?: string | null;
  /** aba do painel lateral para abrir */
  openPanel?: AnalysisPanel | null;
}

export type AnalysisPanel = "revisao" | "analise" | "treinador";

type Action =
  | {
      type: "load";
      startFen: string;
      moves: MoveNode[];
      headers: Record<string, string>;
      atEnd?: boolean;
      ply?: number;
      preReview?: (PositionEval | null)[] | null;
      recordId?: string | null;
      panel?: AnalysisPanel | null;
    }
  | { type: "play"; move: MoveNode }
  | { type: "goto"; cursor: Cursor }
  | { type: "step"; delta: number }
  | { type: "edge"; end: boolean }
  | { type: "exitVariation" }
  | { type: "promoteVariation" };

function mainFen(s: GameState, ply: number) {
  return ply === 0 ? s.startFen : s.moves[ply - 1].fenAfter;
}

export function fenAt(s: GameState, c: Cursor = s.cursor): string {
  if (!c.inVar || !s.variation) return mainFen(s, c.ply);
  return c.ply === 0 ? mainFen(s, s.variation.base) : s.variation.moves[c.ply - 1].fenAfter;
}

/** Lances que levaram à posição atual. */
export function pathMoves(s: GameState): MoveNode[] {
  if (!s.cursor.inVar || !s.variation) return s.moves.slice(0, s.cursor.ply);
  return s.moves.slice(0, s.variation.base).concat(s.variation.moves.slice(0, s.cursor.ply));
}

function reducer(s: GameState, a: Action): GameState {
  switch (a.type) {
    case "load":
      return {
        startFen: a.startFen,
        moves: a.moves,
        headers: a.headers,
        variation: null,
        cursor: { inVar: false, ply: a.ply !== undefined ? Math.max(0, Math.min(a.moves.length, a.ply)) : a.atEnd ? a.moves.length : 0 },
        version: s.version + 1,
        preReview: a.preReview ?? null,
        linkedRecordId: a.recordId ?? null,
        openPanel: a.panel ?? null,
      };
    case "play": {
      const { cursor } = s;
      if (!cursor.inVar) {
        if (cursor.ply < s.moves.length) {
          if (s.moves[cursor.ply].uci === a.move.uci) return { ...s, cursor: { inVar: false, ply: cursor.ply + 1 } };
          return { ...s, variation: { base: cursor.ply, moves: [a.move] }, cursor: { inVar: true, ply: 1 } };
        }
        return { ...s, moves: [...s.moves, a.move], cursor: { inVar: false, ply: cursor.ply + 1 } };
      }
      const v = s.variation!;
      if (cursor.ply < v.moves.length && v.moves[cursor.ply].uci === a.move.uci) {
        return { ...s, cursor: { inVar: true, ply: cursor.ply + 1 } };
      }
      // Lance na base da variante igual ao da linha principal: volta para a principal.
      if (cursor.ply === 0 && s.moves[v.base]?.uci === a.move.uci) {
        return { ...s, cursor: { inVar: false, ply: v.base + 1 } };
      }
      return {
        ...s,
        variation: { base: v.base, moves: [...v.moves.slice(0, cursor.ply), a.move] },
        cursor: { inVar: true, ply: cursor.ply + 1 },
      };
    }
    case "goto":
      return { ...s, cursor: a.cursor };
    case "step": {
      const { cursor } = s;
      if (cursor.inVar && s.variation) {
        const ply = cursor.ply + a.delta;
        if (ply <= 0) return { ...s, cursor: { inVar: false, ply: s.variation.base } };
        return { ...s, cursor: { inVar: true, ply: Math.min(ply, s.variation.moves.length) } };
      }
      const ply = Math.max(0, Math.min(s.moves.length, cursor.ply + a.delta));
      return { ...s, cursor: { inVar: false, ply } };
    }
    case "edge":
      if (s.cursor.inVar && s.variation) {
        return { ...s, cursor: a.end ? { inVar: true, ply: s.variation.moves.length } : { inVar: false, ply: s.variation.base } };
      }
      return { ...s, cursor: { inVar: false, ply: a.end ? s.moves.length : 0 } };
    case "exitVariation":
      if (!s.variation) return s;
      return { ...s, cursor: { inVar: false, ply: s.variation.base }, variation: null };
    case "promoteVariation": {
      if (!s.variation) return s;
      const moves = s.moves.slice(0, s.variation.base).concat(s.variation.moves);
      return {
        ...s,
        moves,
        variation: null,
        cursor: { inVar: false, ply: s.variation.base + s.cursor.ply },
        version: s.version + 1,
      };
    }
  }
}

const initial: GameState = {
  startFen: START_FEN,
  moves: [],
  headers: {},
  variation: null,
  cursor: { inVar: false, ply: 0 },
  version: 0,
};

export function useGame() {
  const [state, dispatch] = useReducer(reducer, initial);
  const fen = useMemo(() => fenAt(state), [state]);
  const lastMove: MoveNode | null = useMemo(() => {
    const path = pathMoves(state);
    return path.length ? path[path.length - 1] : null;
  }, [state]);

  const load = useCallback(
    (
      startFen: string,
      moves: MoveNode[] = [],
      headers: Record<string, string> = {},
      atEnd = false,
      opts: OpenOpts = {},
    ) => dispatch({ type: "load", startFen, moves, headers, atEnd, ...opts }),
    [],
  );
  const play = useCallback((move: MoveNode) => dispatch({ type: "play", move }), []);
  const goto = useCallback((cursor: Cursor) => dispatch({ type: "goto", cursor }), []);
  const step = useCallback((delta: number) => dispatch({ type: "step", delta }), []);
  const edge = useCallback((end: boolean) => dispatch({ type: "edge", end }), []);
  const exitVariation = useCallback(() => dispatch({ type: "exitVariation" }), []);
  const promoteVariation = useCallback(() => dispatch({ type: "promoteVariation" }), []);

  return { state, fen, lastMove, load, play, goto, step, edge, exitVariation, promoteVariation };
}

export type GameApi = ReturnType<typeof useGame>;

/** Opções ao abrir uma partida na Análise. */
export interface OpenOpts {
  ply?: number;
  preReview?: (PositionEval | null)[] | null;
  /** id da partida salva: a aba Treinador da Análise continua a conversa dela */
  recordId?: string | null;
  panel?: AnalysisPanel | null;
}
