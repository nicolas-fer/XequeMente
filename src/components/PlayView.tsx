import { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Flag, Handshake, RotateCcw, Swords, Volume2, VolumeX } from "lucide-react";
import { api, errorText, nextSearchId, type Settings } from "../lib/api";
import { CLASS_INFO, CLASS_ORDER, START_FEN, compactEval, resolveMoveRef, capturedInfo, fullmoveOf, makeMove, uciToMove, type MoveClass, type MoveNode } from "../lib/chess-utils";
import { PERSONAS, TIME_CONTROLS, botFor, formatClock, thinkTimeMs, type Bot, type TimeControl } from "../lib/bots";
import { playMoveSound, sfx, setSoundEnabled, soundEnabled } from "../lib/sound";
import { evaluateGame, evaluatePosition, formatEta, reviewLimitOf, summarizeFor, type PlayerSummary } from "../lib/review";
import type { PositionEval } from "../lib/chess-utils";
import {
  GAME_REPORT_SCHEMA,
  coachSystem,
  gameReportPrompt,
  type CoachGameReport,
  type GameRecord,
  type ProfileData,
} from "../lib/profile";
import { PlayBoard, type Premove } from "./PlayBoard";
import { OpeningLine } from "./MoveList";
import { CoachReport } from "./CoachReport";
import { openingContext, trackOpening } from "../lib/openings";
import { useBoardFit } from "./boardKit";
import { CoachBubble, TutorChat } from "./TutorChat";
import type { OpenOpts } from "../lib/useGame";
import { PHASE_LABEL } from "../lib/review";

const POST_QUICK = [
  { label: "Onde a partida virou?", text: "Em que momento exato a partida virou e o que eu deveria ter jogado ali? Mostre a ideia, não só o lance." },
  { label: "Como evitar esse erro?", text: "Qual foi o meu erro mais caro nesta partida e que hábito ou checagem teria evitado ele?" },
  { label: "O que fiz de bom?", text: "O que eu fiz de bom nesta partida e devo continuar fazendo?" },
  { label: "O que treinar?", text: "Com base nesta partida e no que você já sabe de mim, o que eu devo treinar nesta semana? Seja concreto." },
];

interface Props {
  settings: Settings;
  engineReady: boolean;
  profile: ProfileData;
  updateProfile: (fn: (p: ProfileData) => ProfileData) => void;
  onOpenInAnalysis: (startFen: string, moves: MoveNode[], headers: Record<string, string>, opts?: OpenOpts) => void;
}

type Stage = "setup" | "playing" | "over";
type ColorChoice = "w" | "b" | "random";

interface GameResult {
  winner: "w" | "b" | null;
  reason: string;
}

interface LiveGame {
  id: number;
  startFen: string;
  moves: MoveNode[];
  /** relógio de quem jogou, antes de cada lance (ms) */
  clockBefore: (number | null)[];
  /** tempo gasto em cada lance (ms) */
  spent: number[];
  playerColor: "w" | "b";
  bot: Bot;
  tc: TimeControl;
  startedAt: string;
  result: GameResult | null;
}

interface PostState {
  status: "reviewing" | "coach" | "done" | "no-engine";
  done: number;
  total: number;
  eta?: number | null;
  summary: PlayerSummary | null;
  recordId: string | null;
  coach: CoachGameReport | null;
  coachError: string | null;
}

const LS_KEY = "xequemente.play";

function loadPrefs(): { level: number; tc: string; color: ColorChoice } {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
    return { level: v.level ?? 5, tc: v.tc ?? "5+0", color: v.color ?? "random" };
  } catch {
    return { level: 5, tc: "5+0", color: "random" };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function gameOutcome(startFen: string, moves: MoveNode[]): GameResult | null {
  const c = new Chess(startFen);
  for (const m of moves) c.move({ from: m.from, to: m.to, promotion: m.promotion });
  if (c.isCheckmate()) return { winner: c.turn() === "w" ? "b" : "w", reason: "xeque-mate" };
  if (c.isStalemate()) return { winner: null, reason: "afogamento" };
  if (c.isThreefoldRepetition()) return { winner: null, reason: "repetição tripla" };
  if (c.isInsufficientMaterial()) return { winner: null, reason: "material insuficiente" };
  if (c.isDrawByFiftyMoves()) return { winner: null, reason: "regra dos 50 lances" };
  return null;
}

/** O lado `color` ainda tem material para dar mate? (usado quando o adversário perde no tempo) */
function canMate(fen: string, color: "w" | "b"): boolean {
  const pieces = fen
    .split(" ")[0]
    .split("")
    .filter((ch) => /[a-z]/i.test(ch) && (color === "w" ? ch === ch.toUpperCase() : ch === ch.toLowerCase()))
    .map((ch) => ch.toLowerCase())
    .filter((p) => p !== "k");
  if (pieces.some((p) => p === "q" || p === "r" || p === "p")) return true;
  return pieces.length >= 2;
}

function BotAvatar({ bot, size = 44 }: { bot: Bot; size?: number }) {
  return (
    <div className="bot-avatar" style={{ width: size, height: size, background: bot.color }}>
      <img src={bot.avatar} alt={bot.name} draggable={false} />
    </div>
  );
}

function Clock({ ms, running, low }: { ms: number | null; running: boolean; low: boolean }) {
  if (ms === null) return null;
  return <div className={`clock ${running ? "running" : ""} ${low ? "low" : ""}`}>{formatClock(ms)}</div>;
}

export function PlayView({ settings, engineReady, profile, updateProfile, onOpenInAnalysis }: Props) {
  const prefs = useRef(loadPrefs()).current;
  const [level, setLevel] = useState(prefs.level);
  const [tcId, setTcId] = useState(prefs.tc);
  const [colorChoice, setColorChoice] = useState<ColorChoice>(prefs.color);
  const [stage, setStage] = useState<Stage>("setup");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [premove, setPremoveState] = useState<Premove | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [sound, setSound] = useState(soundEnabled());
  const [post, setPost] = useState<PostState | null>(null);
  const [, setTick] = useState(0);
  // espaço da coluna da barra de avaliação; barras dos jogadores
  const fit = useBoardFit(38, 112);

  const gameRef = useRef<LiveGame | null>(null);
  const clockRef = useRef({ w: 0, b: 0, running: null as "w" | "b" | null, since: 0 });
  const premoveRef = useRef<Premove | null>(null);
  const busyRef = useRef(false);
  const botEvalRef = useRef<{ cp: number | null; mate: number | null } | null>(null);
  const losingStreak = useRef(0);
  const drawCooldown = useRef(0);
  const lastTickSecond = useRef<number | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const lastDigest = useRef<{ record: GameRecord; digest: string[] } | null>(null);
  // Análise em segundo plano durante a partida (o motor de análise fica livre enquanto se joga).
  const preCache = useRef(new Map<string, PositionEval>());
  const preQueue = useRef<string[]>([]);
  const preBusy = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const engineReadyRef = useRef(engineReady);
  engineReadyRef.current = engineReady;

  const pumpPreAnalysis = useCallback(async () => {
    if (preBusy.current || !engineReadyRef.current) return;
    preBusy.current = true;
    try {
      while (preQueue.current.length) {
        const game = gameRef.current;
        if (!game || game.result) break;
        const fen = preQueue.current.shift()!;
        if (preCache.current.has(fen)) continue;
        const ev = await evaluatePosition(fen, reviewLimitOf(settingsRef.current));
        // Se a partida acabou no meio, a busca pode ter sido interrompida: não guarda.
        if (gameRef.current !== game || game.result) break;
        if (ev) preCache.current.set(fen, ev);
      }
    } catch {
      /* a revisão final cobre o que faltar */
    } finally {
      preBusy.current = false;
    }
  }, []);
  const queuePreAnalysis = useCallback(
    (fen: string) => {
      preQueue.current.push(fen);
      void pumpPreAnalysis();
    },
    [pumpPreAnalysis],
  );

  const rerender = useCallback(() => setTick((t) => t + 1), []);
  const setPremove = (p: Premove | null) => {
    premoveRef.current = p;
    setPremoveState(p);
    if (p) sfx.premove();
  };

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ level, tc: tcId, color: colorChoice }));
    } catch {
      /* ignora */
    }
  }, [level, tcId, colorChoice]);

  const g = gameRef.current;
  const fen = g ? (g.moves.length ? g.moves[g.moves.length - 1].fenAfter : g.startFen) : START_FEN;
  const timed = !!g && g.tc.base > 0;

  const remaining = useCallback((c: "w" | "b") => {
    const k = clockRef.current;
    return k[c] - (k.running === c ? performance.now() - k.since : 0);
  }, []);

  // ------------------------------------------------------------ fim de jogo e pós-jogo

  const runCoach = useCallback(
    async (record: GameRecord, digest: string[]) => {
      setPost((p) => (p ? { ...p, status: "coach", coachError: null } : p));
      try {
        const prof = profileRef.current;
        const rep = await api.llmJson<CoachGameReport>(
          coachSystem(settings.tutorLevel),
          gameReportPrompt({ record, moveDigest: digest, memory: prof.memory, previous: prof.games.filter((x) => x.id !== record.id) }),
          GAME_REPORT_SCHEMA,
        );
        const memory = (rep.memory ?? []).map((m) => String(m).trim()).filter(Boolean).slice(0, 12);
        updateProfile((p) => ({
          ...p,
          memory: memory.length ? memory : p.memory,
          games: p.games.map((x) => (x.id === record.id ? { ...x, coach: rep } : x)),
        }));
        setPost((p) => (p ? { ...p, status: "done", coach: rep } : p));
      } catch (e) {
        setPost((p) => (p ? { ...p, status: "done", coachError: errorText(e) } : p));
      }
    },
    [settings.tutorLevel, updateProfile],
  );

  const finish = useCallback(
    async (result: GameResult) => {
      const game = gameRef.current;
      if (!game || game.result) return;
      const k = clockRef.current;
      if (k.running) {
        k[k.running] -= performance.now() - k.since;
        k.running = null;
      }
      game.result = result;
      setPremove(null);
      setThinking(false);
      setStage("over");
      setConfirmResign(false);
      sfx.end(result.winner === null ? null : result.winner === game.playerColor);
      rerender();

      const aiConfigured = settings.provider === "gemini" ? !!settings.geminiApiKey : !!settings.claudeApiKey;
      if (!engineReady) {
        setPost({ status: "no-engine", done: 0, total: 0, summary: null, recordId: null, coach: null, coachError: null });
        return;
      }
      setPost({ status: "reviewing", done: 0, total: game.moves.length + 1, summary: null, recordId: null, coach: null, coachError: null });
      let evals;
      try {
        evals = await evaluateGame(
          game.startFen,
          game.moves,
          reviewLimitOf(settings),
          (_e, done, total, eta) => setPost((p) => (p ? { ...p, done, total, eta } : p)),
          () => gameRef.current !== game,
          preCache.current,
        );
      } catch (e) {
        setPost((p) => (p ? { ...p, status: "done", coachError: `Revisão falhou: ${errorText(e)}` } : p));
        return;
      }
      if (!evals) return;
      const summary = summarizeFor(game.playerColor, game.moves, evals, game.clockBefore, game.tc.base > 0 ? game.tc.base * 1000 : null);
      const playerSpent = game.spent.filter((_, i) => game.moves[i]?.color === game.playerColor);

      // PGN
      const c = new Chess(game.startFen);
      game.moves.forEach((m) => c.move({ from: m.from, to: m.to, promotion: m.promotion }));
      const me = profileRef.current.playerName || "Você";
      const botLabel = `${game.bot.name} (nível ${game.bot.level})`;
      const resultTag = result.winner === null ? "1/2-1/2" : result.winner === "w" ? "1-0" : "0-1";
      const date = new Date();
      c.setHeader("Event", `XequeMente — ${game.tc.label}`);
      c.setHeader("Site", "XequeMente");
      c.setHeader("Date", `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`);
      c.setHeader("White", game.playerColor === "w" ? me : botLabel);
      c.setHeader("Black", game.playerColor === "b" ? me : botLabel);
      c.setHeader(game.playerColor === "w" ? "BlackElo" : "WhiteElo", String(game.bot.elo));
      c.setHeader("Result", resultTag);
      if (game.tc.base > 0) c.setHeader("TimeControl", `${game.tc.base}+${game.tc.inc}`);
      c.setHeader("Termination", result.reason);

      const record: GameRecord = {
        id: `g${Date.now()}`,
        date: game.startedAt,
        level: game.bot.level,
        botName: game.bot.name,
        botElo: game.bot.elo,
        timeControl: { id: game.tc.id, label: game.tc.label, base: game.tc.base, inc: game.tc.inc },
        playerColor: game.playerColor,
        result: result.winner === null ? "draw" : result.winner === game.playerColor ? "win" : "loss",
        reason: result.reason,
        startFen: game.startFen,
        uci: game.moves.map((m) => m.uci),
        pgn: c.pgn(),
        plies: game.moves.length,
        accuracy: summary.accuracy,
        opponentAccuracy: summary.opponentAccuracy,
        counts: summary.counts,
        phaseAcc: summary.phaseAcc,
        mistakes: summary.mistakes,
        avgMoveMs: playerSpent.length ? playerSpent.reduce((a, b) => a + b, 0) / playerSpent.length : null,
        coach: null,
        evals: evals.map(compactEval),
        accuracyAlgo: "lichess",
        digest: summary.moveDigest,
        chat: [],
      };
      updateProfile((p) => ({ ...p, games: [record, ...p.games] }));
      setPost({ status: "done", done: 0, total: 0, summary, recordId: record.id, coach: null, coachError: null });
      if (aiConfigured && game.moves.length >= 4) {
        lastDigest.current = { record, digest: summary.moveDigest };
        await runCoach(record, summary.moveDigest);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engineReady, settings, rerender, runCoach, updateProfile],
  );
  // ------------------------------------------------------------ lances

  const applyMove = useCallback(
    (m: MoveNode) => {
      const game = gameRef.current;
      if (!game || game.result) return false;
      const k = clockRef.current;
      const now = performance.now();
      const before = game.tc.base > 0 ? remaining(m.color) : null;
      const spent = k.running === m.color ? now - k.since : 0;
      if (game.tc.base > 0) {
        k[m.color] = Math.max(0, k[m.color] - spent) + game.tc.inc * 1000;
      }
      k.running = m.color === "w" ? "b" : "w";
      k.since = now;
      game.moves = [...game.moves, m];
      queuePreAnalysis(m.fenAfter);
      game.clockBefore = [...game.clockBefore, before];
      game.spent = [...game.spent, spent];
      playMoveSound(m.san);
      rerender();
      const end = gameOutcome(game.startFen, game.moves);
      if (end) void finish(end);
      return true;
    },
    [finish, remaining, rerender, queuePreAnalysis],
  );

  const playerMove = useCallback(
    (from: string, to: string, promotion?: string) => {
      const game = gameRef.current;
      if (!game || game.result) return false;
      const cur = game.moves.length ? game.moves[game.moves.length - 1].fenAfter : game.startFen;
      if (cur.split(" ")[1] !== game.playerColor) return false;
      const m = makeMove(cur, from, to, promotion);
      if (!m) return false;
      return applyMove(m);
    },
    [applyMove],
  );

  const engineTurn = useCallback(async () => {
    const game = gameRef.current;
    if (!game || game.result || busyRef.current) return;
    const cur = game.moves.length ? game.moves[game.moves.length - 1].fenAfter : game.startFen;
    const botColor = game.playerColor === "w" ? "b" : "w";
    if (cur.split(" ")[1] !== botColor) return;
    busyRef.current = true;
    setThinking(true);
    try {
      const chess = new Chess(cur);
      const last = game.moves[game.moves.length - 1];
      const think = thinkTimeMs({
        remainingMs: game.tc.base > 0 ? remaining(botColor) : null,
        incMs: game.tc.inc * 1000,
        fullmove: fullmoveOf(cur),
        legalMoves: chess.moves().length,
        afterCapture: !!last && last.san.includes("x"),
        inCheck: chess.isCheck(),
        level: game.bot.level,
      });
      const t0 = performance.now();
      const res = await api.opponentMove(
        nextSearchId(),
        game.startFen,
        game.moves.map((m) => m.uci),
        cur,
        Math.round(Math.max(30, Math.min(think * 0.85, 30_000))),
      );
      // Espera o resto do "tempo humano", sem passar do fim da partida.
      let wait = think - (performance.now() - t0);
      while (wait > 0 && gameRef.current === game && !game.result) {
        await sleep(Math.min(wait, 100));
        wait = think - (performance.now() - t0);
      }
      if (gameRef.current !== game || game.result) return;

      // Avaliação do ponto de vista do bot (para desistir ou aceitar empate).
      const line = res.lines[0];
      const sign = botColor === "w" ? 1 : -1;
      const ev = line ? { cp: line.cp === null ? null : line.cp * sign, mate: line.mate === null ? null : line.mate * sign } : null;
      botEvalRef.current = ev;
      const hopeless = !!ev && ((ev.mate !== null && ev.mate < 0) || (ev.cp !== null && ev.cp <= -1000));
      losingStreak.current = hopeless ? losingStreak.current + 1 : 0;
      if (losingStreak.current >= 3 && game.bot.level >= 6 && fullmoveOf(cur) >= 15) {
        setNotice(`${game.bot.name} abandonou a partida.`);
        await finish({ winner: game.playerColor, reason: "abandono do adversário" });
        return;
      }

      const mv = res.bestMove ? uciToMove(cur, res.bestMove) : null;
      if (!mv) {
        setError("O adversário não encontrou lance.");
        return;
      }
      applyMove(mv);
      if (drawCooldown.current > 0) drawCooldown.current--;

      // Pré-lance do jogador
      const pm = premoveRef.current;
      if (pm && !game.result) {
        setPremove(null);
        const m2 = makeMove(mv.fenAfter, pm.from, pm.to, pm.promotion);
        if (m2) applyMove(m2);
      }
    } catch (e) {
      if (gameRef.current === game) setError(errorText(e));
    } finally {
      busyRef.current = false;
      if (gameRef.current === game) setThinking(false);
      rerender();
    }
  }, [applyMove, finish, remaining, rerender]);

  /**
   * Pré-lance vindo do tabuleiro. Se já é a vez do jogador (ex.: segurou a peça enquanto o
   * adversário jogava e soltou depois), joga o lance na hora em vez de guardar como pré-lance.
   */
  const handlePremove = (p: Premove | null) => {
    const game = gameRef.current;
    if (!p) return setPremove(null);
    if (!game || game.result) return;
    const cur = game.moves.length ? game.moves[game.moves.length - 1].fenAfter : game.startFen;
    if (cur.split(" ")[1] === game.playerColor) {
      setPremove(null);
      playerMove(p.from, p.to, p.promotion);
      return;
    }
    setPremove(p);
  };

  // Vez do bot?
  useEffect(() => {
    if (stage !== "playing" || !g || g.result) return;
    const botColor = g.playerColor === "w" ? "b" : "w";
    if (fen.split(" ")[1] === botColor && !busyRef.current) void engineTurn();
  });

  // Relógio
  useEffect(() => {
    if (stage !== "playing" || !timed) return;
    const t = setInterval(() => {
      const game = gameRef.current;
      const k = clockRef.current;
      if (!game || game.result || !k.running) return;
      const left = remaining(k.running);
      if (left <= 0) {
        k[k.running] = 0;
        const loser = k.running;
        const winner = loser === "w" ? "b" : "w";
        const curFen = game.moves.length ? game.moves[game.moves.length - 1].fenAfter : game.startFen;
        void finish(canMate(curFen, winner) ? { winner, reason: "tempo esgotado" } : { winner: null, reason: "tempo esgotado sem material para mate" });
        return;
      }
      if (k.running === game.playerColor && left < 10_000) {
        const sec = Math.ceil(left / 1000);
        if (sec !== lastTickSecond.current) {
          lastTickSecond.current = sec;
          sfx.tick();
        }
      }
      setTick((x) => x + 1);
    }, 100);
    return () => clearInterval(t);
  }, [stage, timed, finish, remaining]);

  // ------------------------------------------------------------ ações

  async function start(opts?: { swapColor?: boolean }) {
    if (!settings.enginePath) {
      setError("Configure o Stockfish na aba Configurações antes de jogar.");
      return;
    }
    setStarting(true);
    setError(null);
    setNotice(null);
    try {
      await api.opponentStart(level);
      const tc = TIME_CONTROLS.find((t) => t.id === tcId) ?? TIME_CONTROLS[4];
      let color: "w" | "b" =
        colorChoice === "random" ? (Math.random() < 0.5 ? "w" : "b") : colorChoice;
      if (opts?.swapColor && gameRef.current) color = gameRef.current.playerColor === "w" ? "b" : "w";
      gameRef.current = {
        id: Date.now(),
        startFen: START_FEN,
        moves: [],
        clockBefore: [],
        spent: [],
        playerColor: color,
        bot: botFor(level),
        tc,
        startedAt: new Date().toISOString(),
        result: null,
      };
      clockRef.current = { w: tc.base * 1000, b: tc.base * 1000, running: "w", since: performance.now() };
      botEvalRef.current = null;
      losingStreak.current = 0;
      drawCooldown.current = 0;
      lastTickSecond.current = null;
      busyRef.current = false;
      preCache.current = new Map();
      preQueue.current = [];
      queuePreAnalysis(START_FEN);
      setPremove(null);
      setPost(null);
      setStage("playing");
      sfx.start();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(false);
    }
  }

  function offerDraw() {
    const game = gameRef.current;
    if (!game || game.result) return;
    const ev = botEvalRef.current;
    const plies = game.moves.length;
    const accepts = plies >= 20 && !!ev && ((ev.mate !== null && ev.mate < 0) || (ev.mate === null && (ev.cp ?? 0) <= 30));
    if (accepts) {
      setNotice(`${game.bot.name} aceitou o empate.`);
      void finish({ winner: null, reason: "empate por acordo" });
    } else {
      drawCooldown.current = 5;
      setNotice(`${game.bot.name} recusou o empate.`);
      rerender();
    }
  }

  function resign() {
    const game = gameRef.current;
    if (!game || game.result) return;
    if (!confirmResign) {
      setConfirmResign(true);
      setTimeout(() => setConfirmResign(false), 3000);
      return;
    }
    void finish({ winner: game.playerColor === "w" ? "b" : "w", reason: "abandono" });
  }

  function openInAnalysis(ply?: number, panel: "revisao" | "treinador" = "revisao") {
    const game = gameRef.current;
    if (!game) return;
    const rec = post?.recordId ? profileRef.current.games.find((x) => x.id === post.recordId) : null;
    const me = profileRef.current.playerName || "Você";
    const botLabel = `${game.bot.name} (nível ${game.bot.level})`;
    const r = game.result;
    onOpenInAnalysis(game.startFen, game.moves, {
      White: game.playerColor === "w" ? me : botLabel,
      Black: game.playerColor === "b" ? me : botLabel,
      [game.playerColor === "w" ? "BlackElo" : "WhiteElo"]: String(game.bot.elo),
      Result: !r ? "*" : r.winner === null ? "1/2-1/2" : r.winner === "w" ? "1-0" : "0-1",
    }, { ply, preReview: rec?.evals ?? null, recordId: rec?.id ?? null, panel });
  }

  /** Clique num lance citado pelo treinador: abre a Análise naquela posição. */
  function openMoveRef(moveNumber: number, black: boolean, san: string, panel: "revisao" | "treinador" = "revisao") {
    const game = gameRef.current;
    if (!game) return;
    const ply = resolveMoveRef(game.moves, moveNumber, black, san);
    if (ply !== null) openInAnalysis(ply, panel);
  }
  /** lances clicados dentro do chat: a conversa continua na aba Treinador da Análise */
  const openMoveRefFromChat = (n: number, black: boolean, san: string) => openMoveRef(n, black, san, "treinador");

  /** Contexto da partida terminada para o chat do pós-jogo. */
  function postGameContext(game: LiveGame, summary: PlayerSummary, coach: CoachGameReport | null): string {
    const color = game.playerColor === "w" ? "brancas" : "pretas";
    const res = game.result;
    const outcome = !res ? "em andamento" : res.winner === null ? "empate" : res.winner === game.playerColor ? "vitória do aluno" : "derrota do aluno";
    const c = new Chess(game.startFen);
    game.moves.forEach((m) => c.move({ from: m.from, to: m.to, promotion: m.promotion }));
    const lines = [
      `Partida que o aluno acabou de jogar contra ${game.bot.name} (Stockfish nível ${game.bot.level}, ~${game.bot.elo} de Elo), modalidade ${game.tc.label}.`,
      `O aluno jogou de ${color}. Resultado: ${outcome}${res ? ` (${res.reason})` : ""}.`,
      openingContext(game.moves),
      `Lances: ${c.pgn().split("\n").filter((l) => !l.startsWith("[")).join(" ").trim()}`,
      `Precisão do aluno: ${summary.accuracy?.toFixed(1) ?? "?"}% · adversário: ${summary.opponentAccuracy?.toFixed(1) ?? "?"}%.`,
      "Lances do aluno avaliados pelo Stockfish (avaliação do ponto de vista das brancas):",
      ...summary.moveDigest,
      summary.mistakes.length ? "Erros do aluno:" : "O aluno não cometeu erros relevantes.",
      ...summary.mistakes.map(
        (m) =>
          `- ${m.label}: ${m.evalBefore} → ${m.evalAfter}; melhor era ${m.bestSan}${m.line ? ` (linha: ${m.line})` : ""}; fase: ${PHASE_LABEL[m.phase]}; tipo: ${m.tags.join(", ")}`,
      ),
    ];
    if (coach) lines.push(`Relatório que você (treinador) já deu ao aluno sobre esta partida: ${coach.headline}. ${coach.report}`);
    const memory = profileRef.current.memory;
    if (memory.length) lines.push(`O que você já sabe sobre o aluno (memória):\n${memory.map((m) => `- ${m}`).join("\n")}`);
    lines.push("Responda sobre esta partida; use só as variantes do Stockfish acima para lances concretos.");
    return lines.join("\n");
  }

  // ------------------------------------------------------------ render

  if (stage === "setup" || !g) {
    const bot = botFor(level);
    const categories = [...new Set(TIME_CONTROLS.map((t) => t.category))];
    return (
      <div className="play-setup">
        <section className="panel setup-bot">
          <div className="setup-bot-head">
            <BotAvatar bot={bot} size={112} />
            <div>
              <div className="bot-name">{bot.name}</div>
              <div className="bot-title">
                {bot.title} · ~{bot.elo} Elo
              </div>
              <div className="bot-level">Nível {level} de 20</div>
            </div>
          </div>
          <div className="persona-strip">
            {PERSONAS.map((p) => {
              const active = level >= p.min && level <= p.max;
              return (
                <button
                  key={p.name}
                  className={`persona ${active ? "active" : ""}`}
                  title={`${p.name} · ${p.title} (níveis ${p.min === p.max ? p.min : `${p.min}–${p.max}`})`}
                  onClick={() => setLevel(active ? level : p.min)}
                  style={{ background: p.color }}
                >
                  <img src={p.avatar} alt={p.name} draggable={false} />
                </button>
              );
            })}
          </div>
          <input type="range" min={0} max={20} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
          <div className="level-scale">
            <span>0 · Iniciante</span>
            <span>10</span>
            <span>20 · Máximo</span>
          </div>
          <p className="hint">
            O nível é o <span className="mono">Skill Level</span> do Stockfish. O Elo é uma estimativa pela fórmula do próprio Stockfish. O
            adversário pensa como gente: rápido na abertura e em lances óbvios, demora nas posições difíceis e desiste quando está
            perdido.
          </p>
        </section>

        <section className="panel setup-options">
          <div className="panel-title">Modalidade</div>
          {categories.map((cat) => (
            <div key={cat} className="tc-group">
              <div className="tc-cat">{cat}</div>
              <div className="tc-grid">
                {TIME_CONTROLS.filter((t) => t.category === cat).map((t) => (
                  <button key={t.id} className={`tc ${tcId === t.id ? "selected" : ""}`} onClick={() => setTcId(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="panel-title">Jogar com</div>
          <div className="color-pick">
            {(
              [
                ["w", "♔", "Brancas"],
                ["random", "?", "Aleatório"],
                ["b", "♚", "Pretas"],
              ] as [ColorChoice, string, string][]
            ).map(([c, glyph, label]) => (
              <button key={c} className={`color-opt ${colorChoice === c ? "selected" : ""}`} onClick={() => setColorChoice(c)}>
                <span className={`glyph ${c}`}>{glyph}</span>
                {label}
              </button>
            ))}
          </div>
          {error && <div className="error">{error}</div>}
          {!engineReady && <div className="notice">O motor de análise está parado: a partida funciona, mas a revisão no final precisa dele.</div>}
          <button className="btn-primary big play-btn" disabled={starting || !settings.enginePath} onClick={() => start()}>
            <Swords size={22} strokeWidth={2.6} /> {starting ? "Preparando…" : "Jogar"}
          </button>
        </section>
      </div>
    );
  }

  const botColor = g.playerColor === "w" ? "b" : "w";
  const turn = fen.split(" ")[1] as "w" | "b";
  const caps = capturedInfo(fen);
  const k = clockRef.current;
  const playerMs = timed ? remaining(g.playerColor) : null;
  const botMs = timed ? remaining(botColor) : null;
  const last = g.moves[g.moves.length - 1];
  const r = g.result;
  const won = r ? r.winner === g.playerColor : false;

  const rows: { n: number; w?: MoveNode; b?: MoveNode }[] = [];
  g.moves.forEach((m) => {
    const n = fullmoveOf(m.fenBefore);
    if (m.color === "w" || !rows.length) rows.push({ n, [m.color]: m });
    else rows[rows.length - 1].b = m;
  });

  const summary = post?.summary;
  const record = post?.recordId ? profile.games.find((x) => x.id === post.recordId) : null;
  const badgeOrder: MoveClass[] = CLASS_ORDER;

  return (
    <div className="analysis play">
      <section className="board-col" ref={fit.ref} style={fit.style}>
        <div className="board-stack">
        <div className="player-bar">
          <BotAvatar bot={g.bot} size={40} />
          <div className="player-info">
            <div className="player-name">
              {g.bot.name}
              <span className="player-rating">({g.bot.elo})</span>
            </div>
            <div className={`captured ${botColor === "w" ? "of-black" : "of-white"}`}>
              {caps[botColor].glyphs}
              {caps[botColor].advantage > 0 && <span className="material">+{caps[botColor].advantage}</span>}
            </div>
          </div>
          {thinking && !r && <span className="thinking-dots">pensando<i>.</i><i>.</i><i>.</i></span>}
          <Clock ms={botMs} running={!r && k.running === botColor} low={botMs !== null && botMs < 20_000} />
        </div>
        <div className="board-row">
          <div className="eval-bar placeholder-bar" />
          <PlayBoard
            fen={fen}
            playerColor={g.playerColor}
            active={!r}
            lastMove={last ? { from: last.from, to: last.to } : null}
            premove={premove}
            onMove={playerMove}
            onPremove={handlePremove}
          />
        </div>
        <div className="player-bar">
          <div className={`player-avatar ${g.playerColor === "w" ? "white" : "black"}`}>{(profile.playerName || "V")[0].toUpperCase()}</div>
          <div className="player-info">
            <div className="player-name">{profile.playerName || "Você"}</div>
            <div className={`captured ${g.playerColor === "w" ? "of-black" : "of-white"}`}>
              {caps[g.playerColor].glyphs}
              {caps[g.playerColor].advantage > 0 && <span className="material">+{caps[g.playerColor].advantage}</span>}
            </div>
          </div>
          <Clock ms={playerMs} running={!r && k.running === g.playerColor} low={playerMs !== null && playerMs < 20_000} />
        </div>
        </div>
      </section>

      <section className="side-panel">
        <div className="play-head">
          <BotAvatar bot={g.bot} size={36} />
          <div>
            <div className="bot-name small-name">{g.bot.name}</div>
            <div className="bot-title">
              Nível {g.bot.level} · {g.tc.label}
            </div>
          </div>
          <span className="spacer" />
          <button
            className="btn-2 icon-btn"
            title={sound ? "Desligar sons" : "Ligar sons"}
            onClick={() => {
              setSoundEnabled(!soundEnabled());
              setSound(soundEnabled());
            }}
          >
            {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
        </div>

        <div className="panel-scroll">
          {!r && (
            <div className={`turn-banner ${turn === g.playerColor ? "mine" : ""}`}>
              {turn === g.playerColor ? "Sua vez" : `${g.bot.name} está pensando…`}
              {premove && (
                <span className="premove-info">
                  Pré-lance {premove.from}→{premove.to} · botão direito cancela
                </span>
              )}
            </div>
          )}
          {notice && <div className="notice">{notice}</div>}
          {error && <div className="error">{error}</div>}

          {r && (
            <div className={`result-card ${r.winner === null ? "draw" : won ? "win" : "loss"}`}>
              <div className="result-title">{r.winner === null ? "Empate" : won ? "Você venceu!" : "Você perdeu"}</div>
              <div className="result-reason">por {r.reason}</div>
            </div>
          )}

          {r && post?.status === "reviewing" && (
            <>
              <CoachBubble>Deixa eu rever a partida com o Stockfish antes de comentar…</CoachBubble>
              <div className="progress-wrap">
                <div className="progress">
                  <div style={{ width: `${(post.done / Math.max(1, post.total)) * 100}%` }} />
                </div>
                <span className="small muted">
                  {post.done}/{post.total} {formatEta(post.eta ?? null)}
                </span>
              </div>
            </>
          )}
          {r && post?.status === "no-engine" && <div className="notice">Inicie o motor de análise para revisar a partida.</div>}

          {r && summary && (
            <>
              <div className="acc-cards">
                <div className="acc-card light">
                  <div className="acc-label">Sua precisão</div>
                  <div className="acc-value">{summary.accuracy !== null ? `${summary.accuracy.toFixed(1)}%` : "—"}</div>
                </div>
                <div className="acc-card dark">
                  <div className="acc-label">{g.bot.name}</div>
                  <div className="acc-value">{summary.opponentAccuracy !== null ? `${summary.opponentAccuracy.toFixed(1)}%` : "—"}</div>
                </div>
              </div>
              <div className="badge-strip">
                {badgeOrder.map((c) => (
                  <div key={c} className="badge-cell" title={CLASS_INFO[c].label}>
                    <span className="badge" style={{ background: CLASS_INFO[c].color }}>
                      {CLASS_INFO[c].symbol}
                    </span>
                    <span>{summary.counts[c]}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {r && post?.status === "coach" && <CoachBubble typing />}
          {r && (post?.coach ?? record?.coach) && (() => {
            const c = (post?.coach ?? record?.coach)!;
            return (
              <>
                <CoachReport coach={c} onMoveClick={openMoveRef} />
                <div className="hint">O treinador guardou na memória o que aprendeu sobre você (veja em Perfil).</div>
              </>
            );
          })()}
          {r && post?.coachError && (
            <div className="error">
              {post.coachError}
              {lastDigest.current && (
                <div>
                  <button className="link" onClick={() => runCoach(lastDigest.current!.record, lastDigest.current!.digest)}>
                    Tentar de novo
                  </button>
                </div>
              )}
            </div>
          )}
          {r && post?.status === "done" && !post.coach && !post.coachError && summary && (
            <div className="hint">Configure uma chave de IA para receber o comentário do treinador. A revisão foi salva no seu perfil.</div>
          )}

          {r && post?.status === "done" && summary && (
            <div className="postgame-chat">
              <div className="card-title">Converse com o treinador</div>
              <TutorChat
                inline
                buildContext={() => postGameContext(g, summary, post.coach ?? record?.coach ?? null)}
                ask={null}
                providerLabel={settings.provider === "gemini" ? settings.geminiModel : settings.claudeModel}
                configured={settings.provider === "gemini" ? !!settings.geminiApiKey : !!settings.claudeApiKey}
                quick={POST_QUICK}
                intro="Ficou alguma dúvida sobre a partida? Pergunte sobre um lance, um momento ou o que treinar."
                resetKey={`${post.recordId ?? g.id}-${record?.chat?.length ?? 0}`}
                initialMessages={record?.chat}
                onMessagesChange={(chat) =>
                  post.recordId && updateProfile((p) => ({ ...p, games: p.games.map((x) => (x.id === post.recordId ? { ...x, chat } : x)) }))
                }
                onMoveClick={openMoveRefFromChat}
              />
            </div>
          )}

          <div className="move-card">
            <div className="card-title">Lances</div>
            <OpeningLine track={trackOpening(g.moves)} />
            <div className="move-list">
              {rows.length === 0 && <div className="muted small">{g.playerColor === "w" ? "Você começa." : `${g.bot.name} começa.`}</div>}
              {rows.map((row) => (
                <div className="move-row" key={row.n}>
                  <span className="move-num">{row.n}.</span>
                  <span className="move static">{row.w?.san ?? "…"}</span>
                  <span className="move static">{row.b?.san ?? ""}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel-footer">
          {!r ? (
            <div className="row-buttons equal">
              <button className="btn-2 labeled" onClick={offerDraw} disabled={drawCooldown.current > 0 || g.moves.length < 2}>
                <Handshake size={16} strokeWidth={2.6} /> Empate
              </button>
              <button className={`btn-2 labeled ${confirmResign ? "danger" : ""}`} onClick={resign}>
                <Flag size={16} strokeWidth={2.6} /> {confirmResign ? "Confirmar?" : "Desistir"}
              </button>
            </div>
          ) : (
            <>
              <button className="btn-primary big" onClick={() => start({ swapColor: true })} disabled={starting}>
                <RotateCcw size={20} strokeWidth={2.6} /> Revanche (trocar cores)
              </button>
              <div className="row-buttons equal">
                <button className="btn-2 labeled" onClick={() => openInAnalysis()}>
                  Ver na Análise
                </button>
                <button
                  className="btn-2 labeled"
                  onClick={() => {
                    gameRef.current = null;
                    setPost(null);
                    setStage("setup");
                  }}
                >
                  Nova partida
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
