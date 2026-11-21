/**
 * "Treinar meus erros": repetição espaçada (caixas estilo Leitner) guardada em profile.drills.
 * Aqui fica só o agendamento e o histórico; os exercícios saem das partidas (lib/drills-build.ts).
 */

/** Dias até a próxima revisão de cada caixa. A caixa 0 é a primeira (novo ou errou). */
export const INTERVALS_DAYS = [1, 3, 7, 16, 35] as const;
/** Caixa final: exercício dominado. */
export const MASTER_BOX = INTERVALS_DAYS.length - 1;
/** Quantos exercícios novos entram por dia. */
export const NEW_PER_DAY = 10;
/** Máximo de exercícios numa sessão. */
export const SESSION_MAX = 20;
/** Histórico enxuto: as tentativas mais antigas são descartadas. */
const HISTORY_MAX = 1000;

/** Categorias de erro que viram exercício (blunder = erro grave, mistake = erro, inaccuracy = imprecisão). */
export type DrillCls = "blunder" | "mistake" | "inaccuracy";

/** Estado do treino guardado no perfil (profile.drills). */
export interface DrillsState {
  version: 1;
  cards: Record<string, DrillCard>;
  history: DrillAttempt[];
}

export interface DrillCard {
  gameId: string;
  /** caixa atual, de 0 a MASTER_BOX */
  box: number;
  /** dia da próxima revisão (AAAA-MM-DD, horário local) */
  due: string;
  /** dia em que o exercício entrou no treino */
  intro: string;
  /** vezes resolvido */
  seen: number;
  /** acertos de primeira */
  hits: number;
}

export interface DrillAttempt {
  /** instante da resposta (ISO) */
  at: string;
  id: string;
  ok: boolean;
}

/** Referência leve a um exercício (sem montar a posição). */
export interface DrillRef {
  /** `${gameId}:${ply}` */
  id: string;
  gameId: string;
  /** ply do lance errado (1 = primeiro lance da partida) */
  ply: number;
  cls: DrillCls;
}

export interface AttemptInput {
  id: string;
  gameId: string;
  ok: boolean;
  /** primeira resposta deste exercício na sessão: só ela mexe na caixa */
  first: boolean;
  now: Date;
}

export interface SessionPlan {
  items: DrillRef[];
  /** exercícios já conhecidos que vencem hoje */
  due: number;
  /** exercícios novos incluídos hoje */
  fresh: number;
}

/** Valida o que veio do disco; null quando não há treino salvo. */
export function normalizeDrills(raw: unknown): DrillsState | null {
  if (!raw || typeof raw !== "object" || (raw as { version?: unknown }).version !== 1) return null;
  const r = raw as { cards?: unknown; history?: unknown };
  const cards: Record<string, DrillCard> = {};
  if (r.cards && typeof r.cards === "object") {
    for (const [id, c] of Object.entries(r.cards as Record<string, unknown>)) {
      const card = normalizeCard(c);
      if (card) cards[id] = card;
    }
  }
  const history = Array.isArray(r.history) ? r.history.filter(isAttempt).slice(-HISTORY_MAX) : [];
  return { version: 1, cards, history };
}

function normalizeCard(c: unknown): DrillCard | null {
  if (!c || typeof c !== "object") return null;
  const x = c as Record<string, unknown>;
  if (typeof x.gameId !== "string" || typeof x.due !== "string" || typeof x.intro !== "string") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  return {
    gameId: x.gameId,
    box: Math.min(MASTER_BOX, num(x.box)),
    due: x.due,
    intro: x.intro,
    seen: num(x.seen),
    hits: num(x.hits),
  };
}

function isAttempt(a: unknown): a is DrillAttempt {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  return typeof x.at === "string" && typeof x.id === "string" && typeof x.ok === "boolean";
}

export function emptyDrills(): DrillsState {
  return { version: 1, cards: {}, history: [] };
}

// ---------------------------------------------------------------- Datas

/** Dia local no formato AAAA-MM-DD (compara bem como texto). */
export function dayKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + days));
}

// ---------------------------------------------------------------- Agendamento

/** Acertou de primeira sobe uma caixa; errou volta para a primeira. */
export function scheduleCard(card: DrillCard | undefined, gameId: string, ok: boolean, today: string): DrillCard {
  const prev: DrillCard = card ?? { gameId, box: 0, due: today, intro: today, seen: 0, hits: 0 };
  const box = ok ? Math.min(prev.box + 1, MASTER_BOX) : 0;
  return {
    ...prev,
    box,
    due: addDays(today, INTERVALS_DAYS[box]),
    seen: prev.seen + 1,
    hits: prev.hits + (ok ? 1 : 0),
  };
}

/** Registra uma resposta: atualiza a caixa (só na primeira resposta da sessão) e grava no histórico. */
export function applyAttempt(state: DrillsState | null, a: AttemptInput): DrillsState {
  const base = state ?? emptyDrills();
  const cards = { ...base.cards };
  if (a.first) cards[a.id] = scheduleCard(cards[a.id], a.gameId, a.ok, dayKey(a.now));
  const history = [...base.history, { at: a.now.toISOString(), id: a.id, ok: a.ok }].slice(-HISTORY_MAX);
  return { version: 1, cards, history };
}

/** Remove cartões de partidas que não existem mais. Devolve o mesmo objeto se nada mudou. */
export function pruneDrills(state: DrillsState | null, liveGameIds: Set<string>): DrillsState | null {
  if (!state) return state;
  const entries = Object.entries(state.cards);
  const kept = entries.filter(([, c]) => liveGameIds.has(c.gameId));
  if (kept.length === entries.length) return state;
  return { ...state, cards: Object.fromEntries(kept) };
}

/** Escolhe a sessão de hoje: revisões vencidas primeiro, depois novos (até o limite diário). */
export function planSession(refs: DrillRef[], state: DrillsState | null, today: string): SessionPlan {
  const cards = state?.cards ?? {};
  const due = refs
    .filter((r) => cards[r.id] && cards[r.id].due <= today)
    .sort((a, b) => cards[a.id].due.localeCompare(cards[b.id].due));
  const fresh = refs.filter((r) => !cards[r.id]);
  const allowance = Math.max(0, NEW_PER_DAY - introducedOn(state, today));
  const newToday = fresh.slice(0, allowance);
  const items = [...due, ...newToday].slice(0, SESSION_MAX);
  return { items, due: due.length, fresh: newToday.length };
}

/** Quantos exercícios entraram no treino naquele dia. */
export function introducedOn(state: DrillsState | null, day: string): number {
  return Object.values(state?.cards ?? {}).filter((c) => c.intro === day).length;
}

export function masteredCount(state: DrillsState | null): number {
  return Object.values(state?.cards ?? {}).filter((c) => c.box === MASTER_BOX).length;
}

/** Dias seguidos com pelo menos um exercício resolvido (hoje, ou ontem se hoje ainda não teve). */
export function streakDays(state: DrillsState | null, now: Date = new Date()): number {
  const days = new Set((state?.history ?? []).map((h) => dayKey(new Date(h.at))));
  let cursor = dayKey(now);
  if (!days.has(cursor)) cursor = addDays(cursor, -1);
  let n = 0;
  while (days.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/** Quantos exercícios o aluno resolveu (certo ou errado) desde a data ISO `sinceIso`. Usado pelas metas semanais. */
export function drillsDoneSince(state: DrillsState | null, sinceIso: string): number {
  if (!state) return 0;
  const since = Date.parse(sinceIso);
  return state.history.filter((h) => Date.parse(h.at) >= since).length;
}
