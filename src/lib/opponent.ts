/**
 * Ponte entre a tela Jogar e o motor adversário. Concentra aqui qualquer ajuste de força
 * (ex.: níveis abaixo do Skill Level 0), para a PlayView não precisar saber como é feito.
 */
import { api, type PvLine, type SearchResult } from "./api";

/** Quantos candidatos o motor devolve quando o bot joga abaixo do nível 0. */
const CANDIDATES = 4;

export function opponentStart(level: number) {
  // Níveis negativos usam o Skill Level 0 do motor; o erro é aplicado aqui (pickWeakerMove).
  return api.opponentStart(Math.max(0, Math.min(20, level)));
}

export async function opponentMove(
  level: number,
  args: { id: number; startFen: string; moves: string[]; fen: string; movetime: number },
): Promise<SearchResult> {
  if (level >= 0) return api.opponentMove(args.id, args.startFen, args.moves, args.fen, args.movetime);
  const res = await api.opponentMove(args.id, args.startFen, args.moves, args.fen, args.movetime, CANDIDATES);
  return { ...res, bestMove: pickWeakerMove(res, level, args.fen) ?? res.bestMove };
}

/** Pontuação de uma linha do motor, em centipeões, do ponto de vista de quem joga. */
function scoreFor(line: PvLine, sideSign: number): number {
  if (line.mate !== null) {
    const m = line.mate * sideSign;
    return Math.sign(m) * (10_000 - Math.abs(m) * 10);
  }
  return (line.cp ?? 0) * sideSign;
}

/**
 * Escolhe o lance do bot entre os candidatos do motor. Nível 0 e acima: o lance do motor (sem passar por aqui).
 * Níveis −1 a −5: na maioria das vezes joga o lance do motor no Skill Level 0; em outras, escolhe um dos candidatos que perdem
 * pouco (até ~1,25 peão no −1 e ~3 peões no −5). A chance e o tamanho do erro crescem conforme o nível cai.
 * Se nenhum candidato for "aceitável", joga o lance do motor: o bot erra, mas não joga lances absurdos.
 */
export function pickWeakerMove(res: SearchResult, level: number, fen: string): string | null {
  const lines = res.lines.filter((l) => l.pv.length > 0).sort((a, b) => a.multipv - b.multipv);
  if (!lines.length) return res.bestMove;
  const best = lines[0];
  // Sem errar, joga o que o motor escolheu: com Skill Level 0 ele já não é o primeiro da lista
  // (o Stockfish enfraquecido sorteia entre os candidatos). Usar lines[0] deixaria o bot MAIS forte que o nível 0.
  const engineMove = res.bestMove ?? best.pv[0];
  const k = Math.min(5, Math.max(1, -level));
  const errorChance = 0.1 + 0.12 * (k - 1);
  if (Math.random() >= errorChance) return engineMove;

  const sideSign = fen.split(" ")[1] === "b" ? -1 : 1;
  const bestScore = scoreFor(best, sideSign);
  const maxLoss = 80 + 45 * k;
  const acceptable = lines
    .slice(1)
    .map((l) => ({ move: l.pv[0], loss: bestScore - scoreFor(l, sideSign) }))
    .filter((c) => c.move !== engineMove && c.loss <= maxLoss);
  if (!acceptable.length) return engineMove;
  return acceptable[Math.floor(Math.random() * acceptable.length)].move;
}
