/**
 * Metas da semana (segunda a domingo, horário local), medidas automaticamente a partir do histórico.
 * As metas são ajustadas em profile.coaching.goals; aqui só se mede o que o aluno já fez.
 */
import type { GameRecord, ProfileData } from "./profile";
import { drillsDoneSince } from "./drills";
import type { CoachingGoals, CoachingState } from "./coaching";

/** Rótulo do tipo de erro usado para medir "peças deixadas atacadas" (ver mistakeTags em review.ts). */
export const WEAKNESS_TAG = "deixou material atacado";

/** Partidas com base de tempo a partir de 10 min contam como Rápida/Clássica. */
const FAST_BASE_SECONDS = 600;

/** Quantas semanas anteriores entram na média de referência da fraqueza. */
const BASELINE_WEEKS = 4;

export interface WeekMeasure {
  /** segunda-feira 00:00 local */
  start: Date;
  /** próxima segunda 00:00 local */
  end: Date;
  /** chave da semana em profile.coaching.weeks (AAAA-MM-DD) */
  key: string;
  games: number;
  fastGames: number;
  drills: number;
  /** peças deixadas atacadas por partida nesta semana; null sem partidas */
  weaknessRate: number | null;
  /** mesma medida nas quatro semanas anteriores; null sem partidas */
  weaknessBefore: number | null;
}

export interface GoalStatus {
  id: "drills" | "games" | "fastGames" | "weakness";
  label: string;
  value: number | null;
  target: number;
  met: boolean;
}

export function weekStartOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const sinceMonday = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - sinceMonday);
  return x;
}

export function addWeeks(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + 7 * n);
  return x;
}

export function weekKey(start: Date): string {
  const m = String(start.getMonth() + 1).padStart(2, "0");
  const d = String(start.getDate()).padStart(2, "0");
  return `${start.getFullYear()}-${m}-${d}`;
}

export function isFastGame(g: GameRecord): boolean {
  return g.timeControl.base >= FAST_BASE_SECONDS;
}

function inRange(g: GameRecord, from: Date, to: Date): boolean {
  const t = new Date(g.date).getTime();
  return t >= from.getTime() && t < to.getTime();
}

/** Média de "peças deixadas atacadas" por partida no conjunto; null sem partidas. */
function weaknessPerGame(games: GameRecord[]): number | null {
  if (!games.length) return null;
  const hits = games.reduce((n, g) => n + g.mistakes.filter((m) => m.tags.includes(WEAKNESS_TAG)).length, 0);
  return hits / games.length;
}

/** Mede uma semana. Exercícios: contados entre o início e o fim (a data do fim vem do próprio `drillsDoneSince`). */
export function measureWeek(profile: ProfileData, start: Date): WeekMeasure {
  const end = addWeeks(start, 1);
  const games = profile.games.filter((g) => inRange(g, start, end));
  const baseline = profile.games.filter((g) => inRange(g, addWeeks(start, -BASELINE_WEEKS), start));
  const sinceStart = drillsDoneSince(profile.drills, start.toISOString());
  const sinceEnd = end.getTime() > Date.now() ? 0 : drillsDoneSince(profile.drills, end.toISOString());
  return {
    start,
    end,
    key: weekKey(start),
    games: games.length,
    fastGames: games.filter(isFastGame).length,
    drills: Math.max(0, sinceStart - sinceEnd),
    weaknessRate: weaknessPerGame(games),
    weaknessBefore: weaknessPerGame(baseline),
  };
}

/** Compara a semana com as metas. A fraqueza só conta quando há partidas e a média ficou dentro da meta. */
export function goalStatuses(m: WeekMeasure, goals: CoachingGoals): GoalStatus[] {
  return [
    { id: "drills", label: "Exercícios de treino", value: m.drills, target: goals.drills, met: m.drills >= goals.drills },
    { id: "games", label: "Partidas jogadas", value: m.games, target: goals.games, met: m.games >= goals.games },
    { id: "fastGames", label: "Partidas em ritmo Rápida ou Clássica", value: m.fastGames, target: goals.fastGames, met: m.fastGames >= goals.fastGames },
    {
      id: "weakness",
      label: "Peças deixadas atacadas por partida (máximo)",
      value: m.weaknessRate,
      target: goals.weakness,
      met: m.weaknessRate !== null && m.weaknessRate <= goals.weakness,
    },
  ];
}

export function weekComplete(m: WeekMeasure, goals: CoachingGoals): boolean {
  return goalStatuses(m, goals).every((g) => g.met);
}

/** Semanas seguidas com todas as metas cumpridas, contando a partir da semana atual (ou da anterior, se a atual ainda não bateu). */
export function weekStreak(profile: ProfileData, goals: CoachingGoals, now = new Date()): number {
  let start = weekStartOf(now);
  if (!weekComplete(measureWeek(profile, start), goals)) start = addWeeks(start, -1);
  let count = 0;
  for (let i = 0; i < 52; i++) {
    if (!weekComplete(measureWeek(profile, start), goals)) break;
    count++;
    start = addWeeks(start, -1);
  }
  return count;
}

/** Plano de treino do treinador como lista de itens (título = chave da marcação). */
export function planItems(profile: ProfileData): string[] {
  return (profile.coachAnalysis?.training_plan ?? []).map((t) => t.title).filter(Boolean);
}

/** Itens marcados na semana que ainda existem no plano atual. */
export function checksFor(state: CoachingState | null, key: string, items: string[]): string[] {
  const saved = state?.weeks[key]?.checks ?? [];
  return saved.filter((c) => items.includes(c));
}
