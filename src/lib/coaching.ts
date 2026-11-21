/**
 * Adversário que se ajusta ao aluno e metas semanais.
 * O estado fica em profile.coaching: metas escolhidas pelo aluno e, por semana, os itens do plano marcados.
 * As metas medidas (partidas, exercícios, peças atacadas) são calculadas a partir do histórico, não guardadas.
 */

/** Metas da semana, ajustáveis pelo aluno na aba Perfil. */
export interface CoachingGoals {
  /** exercícios de "Treinar meus erros" resolvidos na semana */
  drills: number;
  /** partidas jogadas na semana */
  games: number;
  /** partidas na semana em ritmo Rápida ou Clássica */
  fastGames: number;
  /** média máxima de "peças deixadas atacadas" por partida */
  weakness: number;
}

/** Itens do plano de treino marcados numa semana (pelo título do item). */
export interface CoachingWeek {
  checks: string[];
}

/** Estado guardado no perfil (profile.coaching). Semanas são indexadas pela segunda-feira (AAAA-MM-DD, horário local). */
export interface CoachingState {
  version: 1;
  goals: CoachingGoals;
  weeks: Record<string, CoachingWeek>;
}

export const DEFAULT_GOALS: CoachingGoals = { drills: 10, games: 3, fastGames: 2, weakness: 0.5 };

/** Quantas semanas guardar no perfil (o histórico mostrado é menor). */
export const MAX_WEEKS_STORED = 52;

const WEEK_KEY = /^\d{4}-\d{2}-\d{2}$/;

function clampNumber(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Valida o que veio do disco. Perfis sem metas (ou de versões antigas) recebem os valores padrão; sem dados, null. */
export function normalizeCoaching(raw: unknown): CoachingState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { goals?: unknown; weeks?: unknown };
  const goals = (r.goals && typeof r.goals === "object" ? r.goals : {}) as Partial<CoachingGoals>;
  const weeks: Record<string, CoachingWeek> = {};
  if (r.weeks && typeof r.weeks === "object") {
    for (const [key, value] of Object.entries(r.weeks as Record<string, unknown>)) {
      if (!WEEK_KEY.test(key) || !value || typeof value !== "object") continue;
      const checks = (value as { checks?: unknown }).checks;
      weeks[key] = { checks: Array.isArray(checks) ? checks.filter((c): c is string => typeof c === "string") : [] };
    }
  }
  return {
    version: 1,
    goals: {
      drills: Math.round(clampNumber(goals.drills, DEFAULT_GOALS.drills, 0, 200)),
      games: Math.round(clampNumber(goals.games, DEFAULT_GOALS.games, 0, 50)),
      fastGames: Math.round(clampNumber(goals.fastGames, DEFAULT_GOALS.fastGames, 0, 50)),
      weakness: clampNumber(goals.weakness, DEFAULT_GOALS.weakness, 0, 10),
    },
    weeks,
  };
}

/** Estado vazio com as metas padrão (usado quando o perfil ainda não tem coaching). */
export function emptyCoaching(): CoachingState {
  return normalizeCoaching({}) as CoachingState;
}

/** Guarda as marcações da semana, mantendo só as últimas semanas. */
export function withWeekChecks(state: CoachingState, weekKey: string, checks: string[]): CoachingState {
  const weeks = { ...state.weeks, [weekKey]: { checks } };
  const keys = Object.keys(weeks).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_WEEKS_STORED))) delete weeks[k];
  return { ...state, weeks };
}
