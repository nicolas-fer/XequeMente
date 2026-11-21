/**
 * Modo treino: lógica pura (sem React) para os avisos do treinador.
 * Tudo aqui é determinístico: o motor entra só para avaliar lances; os textos são montados
 * a partir do lance do motor e do chess.js.
 */
import { Chess, type PieceSymbol } from "chess.js";
import type { PositionEval } from "./chess-utils";

/** Perda (cp, do ponto de vista do aluno) a partir da qual o treinador avisa antes do bot jogar. */
export const TRAIN_LOSS_CP = 150;
/** Perda menor, mas suficiente para avisar se o bot ganha uma peça que ninguém recaptura. */
export const TRAIN_UNDEFENDED_CP = 60;
/** Pontuação acima disso (em módulo) significa mate. */
const MATE_SCORE = 9000;

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_NAME: Record<PieceSymbol, string> = { p: "peão", n: "cavalo", b: "bispo", r: "torre", q: "dama", k: "rei" };
const FEMININE: Record<PieceSymbol, boolean> = { p: false, n: false, b: false, r: true, q: true, k: false };

export interface TrainWarning {
  /** texto do balão do treinador */
  text: string;
  /** casas a destacar (lance de resposta do bot) */
  squares: string[];
}

export interface ThreatInfo {
  /** identificador para comparar ameaças entre posições */
  key: string;
  kind: "mate" | "capture" | "check";
  /** casas do lance que faz a ameaça (vazio em xeque) */
  squares: string[];
  text: string;
  /** peso para escolher a ameaça mais importante */
  value: number;
}

function withArticle(t: PieceSymbol): string {
  return `${FEMININE[t] ? "a" : "o"} ${PIECE_NAME[t]}`;
}

function withPossessive(t: PieceSymbol): string {
  return `${FEMININE[t] ? "sua" : "seu"} ${PIECE_NAME[t]}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Pontuação em centipeões do ponto de vista de `color`. Mate vale muito, com a distância preferida. */
export function scoreFor(e: PositionEval | null | undefined, color: "w" | "b"): number | null {
  if (!e) return null;
  const sign = color === "w" ? 1 : -1;
  if (e.terminal) return e.terminal === "draw" ? 0 : e.terminal === color ? 10_000 : -10_000;
  // PositionEval guarda a avaliação do ponto de vista das brancas.
  if (e.mate !== null && e.mate !== undefined) return sign * (e.mate > 0 ? 10_000 - e.mate * 10 : -10_000 - e.mate * 10);
  if (e.cp === null || e.cp === undefined) return null;
  return sign * e.cp;
}

/** Os lances do bot ficam dentro da mesma posição: o lado a jogar vira `color` (sem mexer no resto). */
function fenWithTurn(fen: string, color: "w" | "b"): string {
  const parts = fen.split(" ");
  parts[1] = color;
  parts[3] = "-";
  return parts.join(" ");
}

/**
 * Avalia o lance do aluno (antes de o bot responder).
 * `before` é a avaliação da posição antes do lance do aluno; `after`, a posição depois dele (bot a jogar).
 * Devolve o aviso só para erros sérios; lances que o motor considera bons não geram aviso.
 */
export function assessMove(args: {
  playerColor: "w" | "b";
  /** lance do aluno em SAN (ex.: "Bb4") */
  san: string;
  fenAfter: string;
  before: PositionEval | null;
  after: PositionEval | null;
}): TrainWarning | null {
  const { playerColor, san, fenAfter, before, after } = args;
  if (!before || !after || after.terminal || !after.best) return null;
  const sb = scoreFor(before, playerColor);
  const sa = scoreFor(after, playerColor);
  if (sb === null || sa === null) return null;
  const loss = sb - sa;
  const mateAgainst = sa <= -MATE_SCORE && sb > -MATE_SCORE;

  // Resposta do bot segundo o motor (a posição é a do bot a jogar).
  const chess = new Chess(fenAfter);
  const from = after.best.slice(0, 2);
  const to = after.best.slice(2, 4);
  let reply;
  try {
    reply = chess.move({ from, to, promotion: after.best.length > 4 ? after.best[4] : undefined });
  } catch {
    return null;
  }
  const replyCaptured = reply.captured as PieceSymbol | undefined;

  // Peça ganha de graça: o bot captura algo que o aluno não consegue recapturar.
  let undefended = false;
  if (replyCaptured && VALUE[replyCaptured] >= 3) {
    undefended = !chess.moves({ verbose: true }).some((m) => m.to === to && !!m.captured);
  }

  const serious = loss >= TRAIN_LOSS_CP || mateAgainst || (loss >= TRAIN_UNDEFENDED_CP && undefended);
  if (!serious) return null;

  let text: string;
  if (mateAgainst && after.mate !== null) {
    const n = Math.abs(after.mate);
    text = `Cuidado! Depois de ${san}, ele consegue dar mate em ${n} ${n === 1 ? "lance" : "lances"}.`;
  } else if (replyCaptured) {
    text = `Cuidado! Depois de ${san}, ${withArticle(reply.piece)} em ${from} pode tomar ${withPossessive(replyCaptured)} em ${to}.`;
    if (undefended) text += " Você não tem como recapturar.";
  } else {
    const pawns = (Math.abs(loss) / 100).toFixed(1).replace(".", ",");
    text = `Cuidado! Depois de ${san}, a resposta ${reply.san} deixa você cerca de ${pawns} peões atrás.`;
  }
  return { text, squares: [from, to] };
}

/** Ameaças que o lado `victim` sofre na posição (lances de captura e mates do adversário). */
export function threatsAgainst(fen: string, victim: "w" | "b"): ThreatInfo[] {
  const attacker = victim === "w" ? "b" : "w";
  const out: ThreatInfo[] = [];
  try {
    const base = new Chess(fen);
    if (base.turn() === victim && base.isCheck()) {
      return [{ key: "check", kind: "check", squares: [], text: "Ele deu xeque: o rei precisa sair do ataque.", value: 50 }];
    }
    const c = base.turn() === attacker ? base : new Chess(fenWithTurn(fen, attacker));
    for (const mv of c.moves({ verbose: true })) {
      const after = new Chess(c.fen());
      after.move(mv);
      if (after.isCheckmate()) {
        out.push({
          key: `mate:${mv.from}${mv.to}`,
          kind: "mate",
          squares: [mv.from, mv.to],
          text: `Ele ameaça dar mate com ${mv.san}.`,
          value: 100,
        });
        continue;
      }
      if (!mv.captured) continue;
      const target = mv.captured as PieceSymbol;
      const defended = base.isAttacked(mv.to, victim);
      const tval = VALUE[target];
      if (defended && tval <= VALUE[mv.piece]) continue;
      out.push({
        key: `capture:${mv.from}${mv.to}`,
        kind: "capture",
        squares: [mv.from, mv.to],
        text: `${cap(withArticle(mv.piece))} em ${mv.from} ataca ${withPossessive(target)} em ${mv.to}${defended ? "." : ", que não tem defesa."}`,
        value: tval,
      });
    }
  } catch {
    /* posição inválida para este cálculo (ex.: o outro rei em xeque): sem ameaças listadas */
  }
  return out;
}

/** Valor mínimo da peça ameaçada para o lembrete aparecer (peão atacado não vale o lembrete). */
const REMINDER_MIN_VALUE = 3;

/**
 * A ameaça mais importante que o último lance do bot criou (ou null). Só entra o que vale o lembrete:
 * ameaça de mate ou peça de valor (cavalo para cima) atacada. Xeque não entra, porque o tabuleiro já obriga a responder.
 */
export function newThreatAfterBotMove(fenBefore: string, fenAfter: string, playerColor: "w" | "b"): ThreatInfo | null {
  const old = new Set(threatsAgainst(fenBefore, playerColor).map((t) => t.key));
  const fresh = threatsAgainst(fenAfter, playerColor).filter(
    (t) => !old.has(t.key) && (t.kind === "mate" || (t.kind === "capture" && t.value >= REMINDER_MIN_VALUE)),
  );
  fresh.sort((a, b) => b.value - a.value);
  return fresh[0] ?? null;
}
