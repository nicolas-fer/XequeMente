/** Perfil do jogador: histórico, memória do treinador e prompts das análises. */
import { api } from "./api";
import { gameAccuracy, makeMove, type MoveClass, type MoveNode, type PositionEval } from "./chess-utils";
import type { StoredChatMsg } from "../components/TutorChat";
import { PHASE_LABEL, type MistakeInfo, type Phase } from "./review";
import { openingContext, openingFamily, trackOpening, type OpeningTrack } from "./openings";
import { normalizeDrills, type DrillsState } from "./drills";
import { stockfishLevelText } from "./bots";
import { normalizeCoaching, type CoachingState } from "./coaching";

export interface CoachGameReport {
  headline: string;
  report: string;
  good_moments: { move: string; why: string }[];
  mistakes: { move: string; what_happened: string; lesson: string }[];
  memory: string[];
  /** resumo curto para o treinador falar em voz alta (relatórios antigos não têm) */
  speech?: string;
}

export interface GameRecord {
  id: string;
  date: string;
  level: number;
  botName: string;
  botElo: number;
  timeControl: { id: string; label: string; base: number; inc: number };
  playerColor: "w" | "b";
  result: "win" | "loss" | "draw";
  reason: string;
  startFen: string;
  uci: string[];
  pgn: string;
  plies: number;
  accuracy: number | null;
  opponentAccuracy: number | null;
  counts: Record<MoveClass, number> | null;
  phaseAcc: Partial<Record<Phase, number>>;
  mistakes: MistakeInfo[];
  avgMoveMs: number | null;
  coach: CoachGameReport | null;
  /** revisão do Stockfish (uma avaliação por posição), para abrir na Análise sem recalcular */
  evals?: (PositionEval | null)[] | null;
  /** lances do aluno em texto compacto (para o treinador) */
  digest?: string[];
  /** conversa com o treinador sobre esta partida */
  chat?: StoredChatMsg[];
  /** "lichess" = precisão já calculada pelo algoritmo atual (partidas antigas usavam média simples) */
  accuracyAlgo?: "lichess";
  /** partida jogada no modo treino (avisos do treinador, lances voltados, dicas) */
  assisted?: { warnings: number; takebacks: number; hints: number };
}

export interface CoachProfileAnalysis {
  level_label: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  frequent_errors: { pattern: string; example: string; fix: string }[];
  training_plan: { title: string; detail: string }[];
  /** grupos de dicas ligados a um ponto fraco (para corrigir) ou forte (para aproveitar) */
  tip_groups?: TipGroup[];
  /** formato antigo (análises geradas antes dos grupos de dicas) */
  thinking_tips?: string[];
  memory: string[];
  updatedAt?: string;
  gamesCount?: number;
}

export interface TipGroup {
  title: string;
  kind: "weakness" | "strength";
  linked_to: string;
  evidence: string;
  tips: string[];
}

export interface ProfileData {
  version: 1;
  playerName: string;
  games: GameRecord[];
  memory: string[];
  coachAnalysis: CoachProfileAnalysis | null;
  /** "Treinar meus erros" (lib/drills.ts) */
  drills: DrillsState | null;
  /** adversário que se ajusta e metas semanais (lib/coaching.ts) */
  coaching: CoachingState | null;
}

export const EMPTY_PROFILE: ProfileData = { version: 1, playerName: "", games: [], memory: [], coachAnalysis: null, drills: null, coaching: null };

export function normalizeProfile(raw: unknown): ProfileData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<ProfileData>;
  return {
    version: 1,
    playerName: typeof r.playerName === "string" ? r.playerName : "",
    games: Array.isArray(r.games) ? r.games.map((g) => withCurrentAccuracy(g)) : [],
    memory: Array.isArray(r.memory) ? r.memory.filter((m) => typeof m === "string") : [],
    coachAnalysis: r.coachAnalysis ?? null,
    drills: normalizeDrills(r.drills),
    coaching: normalizeCoaching(r.coaching),
  };
}

/**
 * Precisão da partida recalculada pela revisão salva, com o algoritmo atual (Lichess).
 * Partidas gravadas antes da v0.3.0 guardavam a média simples; revisões feitas depois na
 * Análise também passam por aqui. Sem revisão completa, mantém o valor gravado.
 */
export function withCurrentAccuracy(g: GameRecord, force = false): GameRecord {
  if (!g.evals?.length || (g.accuracyAlgo === "lichess" && !force)) return g;
  const acc = gameAccuracy(movesOf(g), g.evals);
  const mine = acc[g.playerColor];
  const theirs = acc[g.playerColor === "w" ? "b" : "w"];
  if (mine === null) return g;
  return { ...g, accuracy: mine, opponentAccuracy: theirs ?? g.opponentAccuracy, accuracyAlgo: "lichess" };
}

export async function loadProfile(): Promise<ProfileData> {
  const raw = await api.profileGet();
  const p = normalizeProfile(raw);
  // grava já a precisão recalculada das partidas antigas (uma vez só)
  const before = (raw as Partial<ProfileData> | null)?.games;
  if (Array.isArray(before) && p.games.some((g, i) => g !== before[i])) await saveProfile(p);
  return p;
}

export async function saveProfile(p: ProfileData) {
  await api.profilePut({ ...p, games: p.games.slice(0, 300) });
}

// ---------------------------------------------------------------- Estatísticas

export interface ProfileStats {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  avgAccuracy: number | null;
  recentAccuracy: number | null;
  performance: number | null;
  phaseAcc: Partial<Record<Phase, number>>;
  tagCounts: [string, number][];
  timePressureShare: number | null;
  blundersPerGame: number | null;
}

export function computeStats(games: GameRecord[]): ProfileStats {
  const wins = games.filter((g) => g.result === "win").length;
  const draws = games.filter((g) => g.result === "draw").length;
  const losses = games.filter((g) => g.result === "loss").length;
  const accs = games.map((g) => g.accuracy).filter((a): a is number => a !== null);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const recent = games.slice(0, 20);
  let performance: number | null = null;
  if (recent.length >= 3) {
    const score = recent.reduce((s, g) => s + (g.result === "win" ? 1 : g.result === "draw" ? 0 : -1), 0);
    const opp = avg(recent.map((g) => g.botElo))!;
    performance = Math.round(Math.max(400, Math.min(3200, opp + (400 * score) / recent.length)) / 10) * 10;
  }
  const phases: Record<Phase, number[]> = { opening: [], middlegame: [], endgame: [] };
  games.slice(0, 30).forEach((g) =>
    (Object.keys(g.phaseAcc ?? {}) as Phase[]).forEach((p) => phases[p].push(g.phaseAcc[p]!)),
  );
  const phaseAcc: Partial<Record<Phase, number>> = {};
  (Object.keys(phases) as Phase[]).forEach((p) => {
    const v = avg(phases[p]);
    if (v !== null) phaseAcc[p] = v;
  });
  const tagMap = new Map<string, number>();
  let mistakesTotal = 0;
  let pressured = 0;
  let blunders = 0;
  games.slice(0, 30).forEach((g) => {
    blunders += g.counts?.blunder ?? 0;
    g.mistakes.forEach((m) => {
      mistakesTotal++;
      m.tags.forEach((t) => {
        if (t === "apuro de tempo") pressured++;
        else tagMap.set(t, (tagMap.get(t) ?? 0) + 1);
      });
      tagMap.set(`erro na ${PHASE_LABEL[m.phase].toLowerCase()}`, (tagMap.get(`erro na ${PHASE_LABEL[m.phase].toLowerCase()}`) ?? 0) + 1);
    });
  });
  const sample = games.slice(0, 30).length;
  return {
    games: games.length,
    wins,
    draws,
    losses,
    avgAccuracy: avg(accs),
    recentAccuracy: avg(accs.slice(0, 10)),
    performance,
    phaseAcc,
    tagCounts: [...tagMap.entries()].sort((a, b) => b[1] - a[1]),
    timePressureShare: mistakesTotal ? pressured / mistakesTotal : null,
    blundersPerGame: sample ? blunders / sample : null,
  };
}

// ---------------------------------------------------------------- Aberturas

const openingCache = new Map<string, OpeningTrack>();

/** Abertura de uma partida salva (calculada a partir dos lances; fica em cache por partida). */
export function recordOpening(g: GameRecord): OpeningTrack {
  let t = openingCache.get(g.id);
  if (!t) {
    t = trackOpening(movesOf(g));
    openingCache.set(g.id, t);
  }
  return t;
}

export interface OpeningStat {
  family: string;
  color: "w" | "b";
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** pontos por partida (vitória 1, empate 0,5), de 0 a 1 */
  score: number;
  avgAccuracy: number | null;
  /** nomes completos (variantes) vistos nesta família */
  variations: string[];
}

/** Desempenho do aluno por família de abertura e cor. Mais jogadas primeiro. */
export function computeOpeningStats(games: GameRecord[]): OpeningStat[] {
  const map = new Map<string, OpeningStat & { accs: number[] }>();
  for (const g of games) {
    const o = recordOpening(g).opening;
    if (!o) continue;
    const family = openingFamily(o.name);
    const k = `${g.playerColor}|${family}`;
    let st = map.get(k);
    if (!st) {
      st = { family, color: g.playerColor, games: 0, wins: 0, draws: 0, losses: 0, score: 0, avgAccuracy: null, variations: [], accs: [] };
      map.set(k, st);
    }
    st.games++;
    if (g.result === "win") st.wins++;
    else if (g.result === "draw") st.draws++;
    else st.losses++;
    if (g.accuracy !== null) st.accs.push(g.accuracy);
    if (!st.variations.includes(o.name)) st.variations.push(o.name);
  }
  return [...map.values()]
    .map(({ accs, ...st }) => ({
      ...st,
      score: (st.wins + st.draws / 2) / st.games,
      avgAccuracy: accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null,
    }))
    .sort((a, b) => b.games - a.games || a.family.localeCompare(b.family));
}

function openingStatsBlock(games: GameRecord[]) {
  const st = computeOpeningStats(games).slice(0, 10);
  if (!st.length) return "(sem dados)";
  return st
    .map(
      (o) =>
        `- ${o.family}, de ${o.color === "w" ? "brancas" : "pretas"}: ${o.games} partida(s), ${o.wins}V ${o.draws}E ${o.losses}D, precisão média ${o.avgAccuracy?.toFixed(0) ?? "?"}%`,
    )
    .join("\n");
}

// ---------------------------------------------------------------- Prompts

const LEVEL_TEXT: Record<string, string> = {
  iniciante: "iniciante",
  intermediario: "intermediário",
  avancado: "avançado",
};

export function coachSystem(tutorLevel: string) {
  return [
    `Você é o treinador de xadrez pessoal do aluno no app XequeMente. O aluno se declara de nível ${LEVEL_TEXT[tutorLevel] ?? "intermediário"}.`,
    "Você tem uma MEMÓRIA de longo prazo sobre o aluno (observações de partidas anteriores). Use-a para personalizar o que diz: aponte padrões que se repetem, reconheça progressos e não repita conselhos que já não se aplicam.",
    "Avaliações e lances concretos vêm SOMENTE dos dados do Stockfish fornecidos; não invente variantes. Fale de ideias humanas: ameaças, peças soltas, segurança do rei, estrutura, planos, uso do relógio.",
    "Seja honesto e encorajador, direto, sem enrolação. Escreva em português do Brasil, falando com o aluno na segunda pessoa (você).",
  ].join("\n");
}

/** Guarda no registro da partida o resumo falado gerado para um relatório antigo. */
export const withCoachSpeech = (p: ProfileData, id: string, speech: string): ProfileData => ({
  ...p,
  games: p.games.map((x) => (x.id === id && x.coach ? { ...x, coach: { ...x.coach, speech } } : x)),
});

export const SPEECH_RULES =
  "o que você diz em voz alta ao aluno logo após a partida (vai ser lido por voz sintetizada): 2 ou 3 frases, no máximo 45 palavras, só o essencial (o momento que decidiu a partida e a lição principal). Texto corrido, sem markdown, listas nem porcentagens com casas decimais. Escreva os lances como se fala, sem notação algébrica: 'o bispo em b4', 'o roque pequeno', 'no lance 19', 'a dama toma em d5'.";

const MEMORY_RULES =
  "Campo memory: devolva a lista COMPLETA e atualizada (no máximo 12 itens) de observações duradouras sobre o aluno, juntando a memória anterior com o que esta análise mostrou. Cada item tem até 140 caracteres, descreve um fato sobre o aluno (força, fraqueza, hábito, preferência de abertura, gestão de tempo, progresso) e, quando possível, a evidência (ex.: 'em 3 de 5 partidas'). Remova o que ficou desatualizado; não guarde detalhes de uma única partida que não indiquem padrão.";

function memoryBlock(memory: string[]) {
  return memory.length ? memory.map((m) => `- ${m}`).join("\n") : "(vazia: é a primeira análise deste aluno)";
}

function recentBlock(games: GameRecord[]) {
  if (!games.length) return "(nenhuma)";
  return games
    .slice(0, 6)
    .map(
      (g) =>
        `- ${new Date(g.date).toLocaleDateString("pt-BR")}: ${g.result === "win" ? "vitória" : g.result === "loss" ? "derrota" : "empate"} contra ${g.botName} (~${g.botElo}), ${g.timeControl.label}, precisão ${g.accuracy?.toFixed(0) ?? "?"}%${g.coach ? ` — ${g.coach.headline}` : ""}`,
    )
    .join("\n");
}

export const GAME_REPORT_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    report: { type: "string" },
    good_moments: {
      type: "array",
      items: {
        type: "object",
        properties: { move: { type: "string" }, why: { type: "string" } },
        required: ["move", "why"],
        additionalProperties: false,
      },
    },
    mistakes: {
      type: "array",
      items: {
        type: "object",
        properties: { move: { type: "string" }, what_happened: { type: "string" }, lesson: { type: "string" } },
        required: ["move", "what_happened", "lesson"],
        additionalProperties: false,
      },
    },
    memory: { type: "array", items: { type: "string" } },
    speech: { type: "string" },
  },
  required: ["headline", "report", "good_moments", "mistakes", "memory", "speech"],
  additionalProperties: false,
};

export function gameReportPrompt(args: {
  record: GameRecord;
  moveDigest: string[];
  memory: string[];
  previous: GameRecord[];
}) {
  const g = args.record;
  const color = g.playerColor === "w" ? "brancas" : "pretas";
  const mistakes = g.mistakes.length
    ? g.mistakes
        .map(
          (m) =>
            `- ${m.label}: ${m.cls === "blunder" ? "erro grave" : m.cls === "mistake" ? "erro" : "imprecisão"}; ${m.evalBefore} → ${m.evalAfter}; melhor era ${m.bestSan}${m.line ? ` (linha: ${m.line})` : ""}; fase: ${PHASE_LABEL[m.phase]}; tipo: ${m.tags.join(", ")}${m.clockMs !== null ? `; relógio: ${Math.round(m.clockMs / 1000)}s` : ""}`,
        )
        .join("\n")
    : "(nenhum erro relevante)";
  return [
    "Analise a partida que o aluno acabou de jogar contra o computador.",
    "",
    "## Partida",
    `Adversário: ${g.botName} (${stockfishLevelText(g.level)}, ~${g.botElo} de Elo aproximado)`,
    `Modalidade: ${g.timeControl.label}${g.timeControl.base ? ` (${g.timeControl.base / 60} min + ${g.timeControl.inc}s)` : ""}`,
    `O aluno jogou de ${color}. Resultado: ${g.result === "win" ? "vitória" : g.result === "loss" ? "derrota" : "empate"} (${g.reason}).`,
    openingContext(movesOf(g)),
    `Precisão do aluno: ${g.accuracy?.toFixed(1) ?? "?"}% · precisão do adversário: ${g.opponentAccuracy?.toFixed(1) ?? "?"}%`,
    g.avgMoveMs !== null ? `Tempo médio por lance do aluno: ${(g.avgMoveMs / 1000).toFixed(1)}s` : "",
    `Precisão por fase: ${Object.entries(g.phaseAcc).map(([p, v]) => `${PHASE_LABEL[p as Phase]} ${v.toFixed(0)}%`).join(", ") || "—"}`,
    "",
    "PGN:",
    g.pgn,
    "",
    "## Lances do aluno, avaliados pelo Stockfish (avaliação do ponto de vista das brancas)",
    args.moveDigest.join("\n"),
    "",
    "## Erros do aluno",
    mistakes,
    "",
    "## Memória que você tem do aluno",
    memoryBlock(args.memory),
    "",
    "## Partidas recentes",
    recentBlock(args.previous),
    "",
    "## O que devolver",
    "headline: uma frase curta resumindo a partida (até 90 caracteres).",
    "report: análise de treinador em markdown, 150 a 300 palavras: o fio da partida, o momento decisivo, o que foi bem, o que custou caro e como isso se conecta (ou não) com os padrões da memória.",
    "good_moments: de 1 a 3 lances bons do aluno (use a notação do PGN, ex.: '14. Nf5') com o porquê.",
    "mistakes: até 4 erros mais instrutivos, cada um com o que aconteceu e a lição prática.",
    `speech: ${SPEECH_RULES}`,
    MEMORY_RULES,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export const PROFILE_SCHEMA = {
  type: "object",
  properties: {
    level_label: { type: "string" },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    frequent_errors: {
      type: "array",
      items: {
        type: "object",
        properties: { pattern: { type: "string" }, example: { type: "string" }, fix: { type: "string" } },
        required: ["pattern", "example", "fix"],
        additionalProperties: false,
      },
    },
    training_plan: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, detail: { type: "string" } },
        required: ["title", "detail"],
        additionalProperties: false,
      },
    },
    tip_groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          kind: { type: "string", enum: ["weakness", "strength"] },
          linked_to: { type: "string" },
          evidence: { type: "string" },
          tips: { type: "array", items: { type: "string" } },
        },
        required: ["title", "kind", "linked_to", "evidence", "tips"],
        additionalProperties: false,
      },
    },
    memory: { type: "array", items: { type: "string" } },
  },
  required: ["level_label", "summary", "strengths", "weaknesses", "frequent_errors", "training_plan", "tip_groups", "memory"],
  additionalProperties: false,
};

export function profilePrompt(p: ProfileData, s: ProfileStats) {
  const games = p.games.slice(0, 15);
  const gameLines = games
    .map((g) => {
      const top = g.mistakes
        .filter((m) => m.cls !== "inaccuracy")
        .slice(0, 3)
        .map((m) => `${m.label} (${m.tags.join(", ")}; ${PHASE_LABEL[m.phase].toLowerCase()})`)
        .join("; ");
      const op = recordOpening(g).opening;
      return `- ${g.result === "win" ? "V" : g.result === "loss" ? "D" : "E"} vs ${g.botName} ~${g.botElo}, ${g.timeControl.label}, de ${g.playerColor === "w" ? "brancas" : "pretas"}${op ? `, ${op.name}` : ""}, precisão ${g.accuracy?.toFixed(0) ?? "?"}%${top ? `; erros: ${top}` : ""}${g.coach ? `; resumo: ${g.coach.headline}` : ""}`;
    })
    .join("\n");
  return [
    "Faça a avaliação de perfil do aluno com base no histórico abaixo.",
    "",
    "## Estatísticas",
    `Partidas: ${s.games} (vitórias ${s.wins}, empates ${s.draws}, derrotas ${s.losses})`,
    `Precisão média: ${s.avgAccuracy?.toFixed(1) ?? "?"}% (últimas 10: ${s.recentAccuracy?.toFixed(1) ?? "?"}%)`,
    `Rating de performance estimado contra os bots: ${s.performance ?? "poucos dados"}`,
    `Precisão por fase: ${Object.entries(s.phaseAcc).map(([k, v]) => `${PHASE_LABEL[k as Phase]} ${v.toFixed(0)}%`).join(", ") || "—"}`,
    `Erros graves por partida: ${s.blundersPerGame?.toFixed(2) ?? "?"}`,
    `Parcela dos erros cometidos em apuro de tempo: ${s.timePressureShare !== null ? `${(s.timePressureShare * 100).toFixed(0)}%` : "?"}`,
    `Tipos de erro mais frequentes: ${s.tagCounts.slice(0, 8).map(([t, n]) => `${t} (${n})`).join(", ") || "—"}`,
    "",
    "## Partidas recentes",
    gameLines || "(nenhuma)",
    "",
    "## Desempenho por abertura (catálogo do Lichess)",
    openingStatsBlock(p.games),
    "",
    "## Memória que você tem do aluno",
    memoryBlock(p.memory),
    "",
    "## O que devolver",
    "level_label: rótulo curto do nível atual (ex.: 'Intermediário em evolução (~1300)').",
    "summary: 2 a 4 frases sobre como o aluno joga hoje.",
    "strengths e weaknesses: de 2 a 5 itens cada, concretos e baseados nos dados.",
    "frequent_errors: de 2 a 5 padrões de erro recorrentes, cada um com um exemplo real das partidas (lance) e como corrigir.",
    "training_plan: de 3 a 5 itens de treino priorizados para as próximas semanas (o quê, quanto tempo, como).",
    "tip_groups: de 3 a 5 grupos de dicas e macetes práticos para usar DURANTE a partida (rotina antes do lance, como calcular, como pensar mais rápido, uso do relógio, padrões a procurar). Cada grupo é ligado a um item de weaknesses (kind 'weakness', para corrigir) ou de strengths (kind 'strength', para aproveitar ainda mais); pelo menos um grupo deve ser de ponto forte. linked_to repete o ponto fraco ou forte; evidence cita os dados que justificam (contagens, fase, lance de exemplo); title é curto (ex.: 'Antes de soltar a peça'); tips tem de 2 a 4 dicas concretas e acionáveis, escritas para este aluno.",
    MEMORY_RULES,
  ].join("\n");
}

// ---------------------------------------------------------------- Relevância das dicas gerais

export type TipId = "routine" | "calc" | "speed" | "clock";

export interface TipRelevance {
  score: number;
  reason: string;
}

/** Quanto cada grupo de dicas gerais importa para este jogador, pelos erros medidos. */
export function tipRelevance(games: GameRecord[]): Record<TipId, TipRelevance> {
  const recent = games.slice(0, 30);
  const count = (tag: string) => recent.reduce((n, g) => n + g.mistakes.filter((m) => m.tags.includes(tag)).length, 0);
  const material = count("deixou material atacado");
  const allowedMate = count("permitiu mate");
  const tactic = count("perdeu lance tático");
  const missedMate = count("perdeu um mate");
  const pressure = count("apuro de tempo");
  const flagged = recent.filter((g) => g.result === "loss" && g.reason.startsWith("tempo esgotado")).length;
  const slowGames = recent.filter((g) => g.avgMoveMs !== null && g.timeControl.base > 0 && g.avgMoveMs > (g.timeControl.base * 1000) / 35).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const join = (parts: string[]) => parts.filter(Boolean).join(" e ");
  return {
    routine: {
      score: material + allowedMate * 1.5,
      reason: join([
        material ? `${plural(material, "vez", "vezes")} você deixou material atacado` : "",
        allowedMate ? `${plural(allowedMate, "vez", "vezes")} permitiu mate` : "",
      ]),
    },
    calc: {
      score: tactic + missedMate * 1.5,
      reason: join([
        tactic ? `${plural(tactic, "lance tático perdido", "lances táticos perdidos")}` : "",
        missedMate ? `${plural(missedMate, "mate perdido", "mates perdidos")}` : "",
      ]),
    },
    clock: {
      score: pressure + flagged * 2,
      reason: join([
        pressure ? `${plural(pressure, "erro", "erros")} em apuro de tempo` : "",
        flagged ? `${plural(flagged, "derrota", "derrotas")} no tempo` : "",
      ]),
    },
    speed: {
      score: slowGames * 1.5 + flagged,
      reason: slowGames ? `ritmo lento em ${plural(slowGames, "partida", "partidas")}` : "",
    },
  };
}

// ---------------------------------------------------------------- Contexto do chat de uma partida salva

export function recordContext(g: GameRecord, memory: string[]): string {
  const color = g.playerColor === "w" ? "brancas" : "pretas";
  const outcome = g.result === "win" ? "vitória do aluno" : g.result === "loss" ? "derrota do aluno" : "empate";
  const lines = [
    `Partida do aluno contra ${g.botName} (${stockfishLevelText(g.level)}, ~${g.botElo} de Elo), modalidade ${g.timeControl.label}, em ${new Date(g.date).toLocaleDateString("pt-BR")}.`,
    `O aluno jogou de ${color}. Resultado: ${outcome} (${g.reason}).`,
    openingContext(movesOf(g)),
    `Lances: ${g.pgn.split("\n").filter((l) => !l.startsWith("[")).join(" ").trim()}`,
    `Precisão do aluno: ${g.accuracy?.toFixed(1) ?? "?"}% · adversário: ${g.opponentAccuracy?.toFixed(1) ?? "?"}%.`,
  ];
  if (g.digest?.length) lines.push("Lances do aluno avaliados pelo Stockfish (ponto de vista das brancas):", ...g.digest);
  if (g.mistakes.length) {
    lines.push("Erros do aluno:");
    g.mistakes.forEach((m) =>
      lines.push(
        `- ${m.label}: ${m.evalBefore} → ${m.evalAfter}; melhor era ${m.bestSan}${m.line ? ` (linha: ${m.line})` : ""}; fase: ${PHASE_LABEL[m.phase]}; tipo: ${m.tags.join(", ")}`,
      ),
    );
  }
  if (g.coach) lines.push(`Relatório que você (treinador) já deu sobre esta partida: ${g.coach.headline}. ${g.coach.report}`);
  if (memory.length) lines.push(`O que você já sabe sobre o aluno (memória):\n${memory.map((m) => `- ${m}`).join("\n")}`);
  lines.push("Responda sobre esta partida; use só as variantes do Stockfish acima para lances concretos.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- Partida salva -> Análise

/** Reconstrói os lances de uma partida salva. */
export function movesOf(g: GameRecord): MoveNode[] {
  const moves: MoveNode[] = [];
  let fen = g.startFen;
  for (const u of g.uci) {
    const m = makeMove(fen, u.slice(0, 2), u.slice(2, 4), u[4]);
    if (!m) break;
    moves.push(m);
    fen = m.fenAfter;
  }
  return moves;
}

/** Cabeçalhos PGN para abrir a partida na Análise. */
export function headersOf(g: GameRecord, playerName: string): Record<string, string> {
  const me = playerName || "Você";
  const bot = `${g.botName} (nível ${g.level})`;
  return {
    White: g.playerColor === "w" ? me : bot,
    Black: g.playerColor === "b" ? me : bot,
    [g.playerColor === "w" ? "BlackElo" : "WhiteElo"]: String(g.botElo),
    Result: g.result === "draw" ? "1/2-1/2" : (g.result === "win") === (g.playerColor === "w") ? "1-0" : "0-1",
  };
}
