/** Adversários (níveis do Stockfish com cara de jogador), modalidades e tempo de pensamento humano. */
import tico from "../assets/avatars/tico.webp";
import bia from "../assets/avatars/bia.webp";
import rafa from "../assets/avatars/rafa.webp";
import lucia from "../assets/avatars/lucia.webp";
import helio from "../assets/avatars/helio.webp";
import otavio from "../assets/avatars/otavio.webp";
import sombra from "../assets/avatars/sombra.webp";
import stockfish from "../assets/avatars/stockfish.webp";

export interface Bot {
  level: number;
  name: string;
  title: string;
  elo: number;
  color: string;
  avatar: string;
}

export const PERSONAS: { min: number; max: number; name: string; title: string; color: string; avatar: string }[] = [
  { min: 0, max: 2, name: "Tico", title: "Iniciante", color: "#7fb3d5", avatar: tico },
  { min: 3, max: 5, name: "Bia", title: "Aprendiz", color: "#82c99b", avatar: bia },
  { min: 6, max: 8, name: "Rafa", title: "Jogador de clube", color: "#e5b55a", avatar: rafa },
  { min: 9, max: 11, name: "Dona Lúcia", title: "Experiente", color: "#d98c6b", avatar: lucia },
  { min: 12, max: 14, name: "Prof. Hélio", title: "Avançado", color: "#b48ad6", avatar: helio },
  { min: 15, max: 17, name: "Mestre Otávio", title: "Mestre", color: "#d46a6a", avatar: otavio },
  { min: 18, max: 19, name: "GM Sombra", title: "Grande mestre", color: "#5c5a57", avatar: sombra },
  { min: 20, max: 20, name: "Stockfish", title: "Força máxima", color: "#6a9c3c", avatar: stockfish },
];

/**
 * Elo aproximado de cada Skill Level, pela fórmula que o próprio Stockfish usa para
 * converter UCI_Elo em nível (Elo ≈ 1346,6 + 143,4 · nível^0,806). Nível 20 não tem limite.
 */
export function eloForLevel(level: number): number {
  if (level >= 20) return 3200;
  return Math.round((1346.6 + 143.4 * Math.pow(Math.max(0, level), 0.806)) / 10) * 10;
}

export function botFor(level: number): Bot {
  const p = PERSONAS.find((x) => level <= x.max) ?? PERSONAS[PERSONAS.length - 1];
  return { level, name: p.name, title: p.title, elo: eloForLevel(level), color: p.color, avatar: p.avatar };
}

export interface TimeControl {
  id: string;
  label: string;
  category: "Bullet" | "Blitz" | "Rápida" | "Clássica" | "Livre";
  /** segundos; 0 = sem relógio */
  base: number;
  inc: number;
}

export const TIME_CONTROLS: TimeControl[] = [
  { id: "1+0", label: "1 min", category: "Bullet", base: 60, inc: 0 },
  { id: "2+1", label: "2 | 1", category: "Bullet", base: 120, inc: 1 },
  { id: "3+0", label: "3 min", category: "Blitz", base: 180, inc: 0 },
  { id: "3+2", label: "3 | 2", category: "Blitz", base: 180, inc: 2 },
  { id: "5+0", label: "5 min", category: "Blitz", base: 300, inc: 0 },
  { id: "10+0", label: "10 min", category: "Rápida", base: 600, inc: 0 },
  { id: "15+10", label: "15 | 10", category: "Rápida", base: 900, inc: 10 },
  { id: "30+0", label: "30 min", category: "Clássica", base: 1800, inc: 0 },
  { id: "none", label: "Sem relógio", category: "Livre", base: 0, inc: 0 },
];

function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface ThinkInput {
  /** tempo restante do bot (ms); null = sem relógio */
  remainingMs: number | null;
  incMs: number;
  fullmove: number;
  legalMoves: number;
  /** o último lance do jogador foi uma captura (provável recaptura) */
  afterCapture: boolean;
  inCheck: boolean;
  level: number;
}

/**
 * Quanto tempo um jogador humano levaria neste lance (ms).
 * Abertura e lances forçados saem rápido; o meio-jogo consome mais; com pouco tempo, joga no reflexo.
 */
export function thinkTimeMs(t: ThinkInput): number {
  const noise = Math.exp(gaussian() * (t.level < 8 ? 0.55 : 0.42));
  if (t.legalMoves <= 1) return 250 + Math.random() * 450;

  if (t.remainingMs === null) {
    let base = 900 + t.level * 110;
    if (t.fullmove <= 6) base *= 0.45;
    if (t.afterCapture || t.inCheck) base *= 0.6;
    return Math.min(9000, Math.max(400, base * noise));
  }

  const remaining = Math.max(0, t.remainingMs);
  if (remaining < 10_000) return Math.min(remaining * 0.08, 250 + Math.random() * 700);

  const movesLeft = Math.max(18, 42 - t.fullmove * 0.6);
  let budget = remaining / movesLeft + t.incMs * 0.75;
  if (t.fullmove <= 6) budget *= 0.3;
  else if (t.fullmove <= 12) budget *= 0.75;
  else if (t.fullmove <= 35) budget *= 1.15;
  if (t.afterCapture) budget *= 0.45;
  if (t.inCheck) budget *= 0.7;
  if (t.legalMoves <= 3) budget *= 0.5;

  const ms = budget * noise;
  return Math.max(300, Math.min(ms, remaining * 0.14, budget * 3, 90_000));
}

export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSec = clamped / 1000;
  if (totalSec < 10) return `0:0${totalSec.toFixed(1)}`;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
