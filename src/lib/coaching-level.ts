/**
 * Sugestão de adversário e de ritmo a partir das partidas recentes.
 * Mira ~50% de aproveitamento: estima o Elo do aluno pelos resultados contra o Elo dos bots e escolhe o nível mais próximo.
 * Partidas no modo treino contam com peso menor (0,5), porque o treinador ajudou.
 */
import type { GameRecord, ProfileData } from "./profile";
import { MAX_LEVEL, MIN_LEVEL, TIME_CONTROLS, eloForLevel } from "./bots";

/** Partidas recentes usadas na sugestão. */
const WINDOW = 12;
/** Abaixo disso, a estimativa de Elo é ruidosa demais: anda um nível por vez. */
const MIN_FOR_RATING = 3;
/** Máximo de níveis que a sugestão anda de uma vez em relação à última partida. */
const MAX_STEP = 3;
const ASSISTED_WEIGHT = 0.5;
const FAST_BASE = 600;

export interface LevelSuggestion {
  level: number;
  /** explicação curta, pronta para a interface */
  reason: string;
  /** nível da partida mais recente (null sem partidas) */
  lastLevel: number | null;
}

export interface TcSuggestion {
  id: string;
  label: string;
  reason: string;
}

/** Nível como aparece na interface: "−2" com sinal de menos real. */
export function formatLevel(level: number): string {
  return level < 0 ? `−${Math.abs(level)}` : String(level);
}

function scoreOf(g: GameRecord): number {
  return g.result === "win" ? 1 : g.result === "draw" ? 0.5 : 0;
}

function recentGames(profile: ProfileData): GameRecord[] {
  return [...profile.games].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, WINDOW);
}

/** Quantas partidas seguidas (a partir da mais recente) têm o mesmo resultado, no mesmo nível. */
function sameResultStreak(games: GameRecord[], result: GameRecord["result"]): number {
  if (!games.length || games[0].result !== result) return 0;
  let n = 0;
  for (const g of games) {
    if (g.result !== result || g.level !== games[0].level) break;
    n++;
  }
  return n;
}

export function suggestLevel(profile: ProfileData): LevelSuggestion | null {
  const games = recentGames(profile);
  if (!games.length) return null;
  const last = games[0];
  const ref = last.level;

  let target: number;
  let reason: string;
  const streakLoss = sameResultStreak(games, "loss");
  const streakWin = sameResultStreak(games, "win");

  if (games.length < MIN_FOR_RATING) {
    // Poucas partidas: anda um nível a partir da última (para cima se venceu, para baixo se perdeu).
    const step = last.result === "win" ? 1 : last.result === "loss" ? -1 : 0;
    target = ref + step;
    reason = `com base nas suas ${games.length} últimas partidas`;
  } else {
    let wsum = 0;
    let score = 0;
    let oppSum = 0;
    for (const g of games) {
      const w = g.assisted ? ASSISTED_WEIGHT : 1;
      const opp = g.botElo || eloForLevel(g.level);
      wsum += w;
      score += w * scoreOf(g);
      oppSum += w * opp;
    }
    const p = (score + 0.5) / (wsum + 1);
    const perf = oppSum / wsum + 400 * Math.log10(p / (1 - p));
    target = nearestLevel(perf);
    const w = games.filter((g) => !g.assisted).length;
    reason = `com base nas suas ${games.length} últimas partidas (${w} sem treino)`;
  }

  target = Math.max(ref - MAX_STEP, Math.min(ref + MAX_STEP, target));
  target = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, target));

  if (target < ref && streakLoss >= 2) reason = `você perdeu as últimas ${streakLoss} no nível ${formatLevel(ref)}`;
  else if (target > ref && streakWin >= 2) reason = `você venceu as últimas ${streakWin} no nível ${formatLevel(ref)}`;

  return { level: target, reason, lastLevel: ref };
}

/** Nível cujo Elo estimado fica mais perto de `elo`. */
function nearestLevel(elo: number): number {
  let best = MIN_LEVEL;
  let bestDiff = Infinity;
  for (let l = MIN_LEVEL; l <= MAX_LEVEL; l++) {
    const diff = Math.abs(eloForLevel(l) - elo);
    if (diff < bestDiff) {
      best = l;
      bestDiff = diff;
    }
  }
  return best;
}

/** Ritmo: sugere Rápida 10 min quando o aluno joga quase só Bullet/Blitz e a partida atual também é rápida. */
export function suggestTc(profile: ProfileData, currentTcId: string): TcSuggestion | null {
  const current = TIME_CONTROLS.find((t) => t.id === currentTcId);
  const currentIsFast = current !== undefined && current.base > 0 && current.base < FAST_BASE;
  if (!currentIsFast) return null;
  const games = recentGames(profile).filter((g) => !g.assisted);
  if (games.length < 3) return null;
  const quick = games.filter((g) => g.timeControl.base > 0 && g.timeControl.base < FAST_BASE).length;
  if (quick / games.length < 0.6) return null;
  const target = TIME_CONTROLS.find((t) => t.id === "10+0");
  if (!target) return null;
  return { id: target.id, label: target.label, reason: "para aprender, prefira partidas mais lentas" };
}
