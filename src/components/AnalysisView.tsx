import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Arrow } from "react-chessboard";
import { Chess } from "chess.js";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pencil, Plus, RotateCcw, Star, User } from "lucide-react";
import { errorText, type Settings } from "../lib/api";
import {
  CLASS_INFO,
  CLASS_ORDER,
  START_FEN,
  emptyCounts,
  gameAccuracy,
  resolveMoveRef,
  capturedInfo,
  evalFromLine,
  evalText,
  evalWords,
  formatMoves,
  makeMove,
  moveLabel,
  pvToSan,
  reviewMove,
  terminalEval,
  turnOf,
  uciToMove,
  type MoveClass,
  type MoveReview,
  type PositionEval,
} from "../lib/chess-utils";
import { pathMoves, type GameApi } from "../lib/useGame";
import { useLiveEngine } from "../lib/useEngine";
import { playMoveSound, sfx } from "../lib/sound";
import { evaluateGame, formatEta, reviewLimitOf } from "../lib/review";
import { recordContext, type GameRecord } from "../lib/profile";
import { compactEval } from "../lib/chess-utils";
import { BoardView } from "./BoardView";
import { useBoardFit } from "./boardKit";
import { EvalBar } from "./EvalBar";
import { EvalGraph } from "./EvalGraph";
import { MoveList } from "./MoveList";
import { openingContext, openingLabel, trackOpening } from "../lib/openings";
import { CoachBubble, TutorChat, type TutorAsk } from "./TutorChat";

interface Props {
  game: GameApi;
  settings: Settings;
  engineReady: boolean;
  engineGen: number;
  /** memória do treinador sobre o aluno (vinda do perfil) */
  memory: string[];
  /** partida salva vinculada (aberta a partir do pós-jogo ou da aba Partidas) */
  linkedRecord: GameRecord | null;
  /** salva a conversa / a revisão na partida vinculada */
  onLinkedChange: (id: string, patch: Partial<GameRecord>) => void;
  active: boolean;
  onEditPosition: (fen: string) => void;
}

interface ReviewState {
  status: "idle" | "running" | "done";
  done: number;
  total: number;
  evals: (PositionEval | null)[];
  error?: string;
  eta?: number | null;
}

type PanelTab = "revisao" | "analise" | "treinador";

const emptyReview: ReviewState = { status: "idle", done: 0, total: 0, evals: [] };

function PlayerBar({ name, rating, color, fen, toMove }: { name: string; rating?: string; color: "w" | "b"; fen: string; toMove: boolean }) {
  const cap = capturedInfo(fen)[color];
  return (
    <div className={`player-bar ${toMove ? "to-move" : ""}`}>
      <div className={`player-avatar ${color === "w" ? "white" : "black"}`}>
        <User size={22} strokeWidth={2.5} />
      </div>
      <div className="player-info">
        <div className="player-name">
          {name}
          {rating && <span className="player-rating">({rating})</span>}
        </div>
        <div className={`captured ${color === "w" ? "of-black" : "of-white"}`}>
          {cap.glyphs}
          {cap.advantage > 0 && <span className="material">+{cap.advantage}</span>}
        </div>
      </div>
      {toMove && <span className="turn-pill">vez de jogar</span>}
    </div>
  );
}

function Stars({ value }: { value: number | null }) {
  const n = value === null ? 0 : value >= 90 ? 3 : value >= 75 ? 2 : value >= 55 ? 1 : 0;
  return (
    <div className="stars">
      {[0, 1, 2].map((i) => (
        <Star key={i} size={14} className={i < n ? "on" : ""} fill={i < n ? "currentColor" : "none"} strokeWidth={2.4} />
      ))}
    </div>
  );
}

export function AnalysisView({ game, settings, engineReady, engineGen, memory, linkedRecord, onLinkedChange, active, onEditPosition }: Props) {
  const { state, fen, lastMove } = game;
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [engineOn, setEngineOn] = useState(true);
  const [multipv, setMultipv] = useState(settings.defaultMultipv || 3);
  useEffect(() => setMultipv(settings.defaultMultipv || 3), [settings.defaultMultipv]);
  const [review, setReview] = useState<ReviewState>(emptyReview);
  const [mySide, setMySide] = useState<"w" | "b" | "both">("both");
  const [ask, setAsk] = useState<TutorAsk | null>(null);
  const [panel, setPanel] = useState<PanelTab>("revisao");
  const cancelReview = useRef(false);
  // barra de avaliação + espaço; barras dos jogadores + botões de navegação
  const fit = useBoardFit(38, 172);

  const reviewing = review.status === "running";
  const live = useLiveEngine(fen, engineReady && engineOn && active && !reviewing, multipv, engineGen);

  useEffect(() => {
    cancelReview.current = true;
    const pre = state.preReview;
    // Partida do histórico: a revisão já vem pronta.
    if (pre && pre.length === state.moves.length + 1 && pre.every(Boolean))
      setReview({ status: "done", done: pre.length, total: pre.length, evals: pre });
    else {
      setReview(emptyReview);
      // Partida salva sem revisão (versões antigas): revisa sozinho e guarda na partida.
      if (state.linkedRecordId && state.moves.length && engineReady) autoReview.current = true;
    }
    if (state.openPanel) setPanel(state.openPanel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.version]);

  const autoReview = useRef(false);
  useEffect(() => {
    if (autoReview.current && review.status === "idle") {
      autoReview.current = false;
      void runReview();
    }
  });

  const reviews: (MoveReview | null)[] = useMemo(
    () =>
      state.moves.map((m, i) =>
        review.evals.length ? reviewMove(m, review.evals[i] ?? null, review.evals[i + 1] ?? null, state.moves[i - 1]) : null,
      ),
    [state.moves, review.evals],
  );

  const onMainline = !state.cursor.inVar;
  const ply = state.cursor.ply;
  const currentReviewEval = onMainline ? review.evals[ply] ?? null : null;
  const liveEval = evalFromLine(live.lines[0], null);
  const shownEval: PositionEval | null = terminalEval(fen) ?? liveEval ?? currentReviewEval;
  const lastReview = onMainline && ply > 0 ? reviews[ply - 1] : null;
  /** abertura até a posição do tabuleiro (segue variantes também) */
  const openingTrack = useMemo(() => trackOpening(pathMoves(state)), [state]);

  /** lance (UCI) da linha do motor sob o mouse: destacado no tabuleiro */
  const [hoverMove, setHoverMove] = useState<string | null>(null);
  useEffect(() => setHoverMove(null), [fen]);
  const hoverValid = !!hoverMove && live.lines.some((l) => l.pv[0] === hoverMove);

  const arrows: Arrow[] = useMemo(() => {
    if (hoverMove && hoverValid)
      return [{ startSquare: hoverMove.slice(0, 2), endSquare: hoverMove.slice(2, 4), color: "rgba(72, 148, 222, 0.95)" }];
    const out: Arrow[] = [];
    const best = live.lines[0]?.pv[0] ?? (onMainline ? review.evals[ply]?.best : null);
    if (best && engineOn) out.push({ startSquare: best.slice(0, 2), endSquare: best.slice(2, 4), color: "rgba(129,182,76,0.9)" });
    const second = live.lines[1]?.pv[0];
    if (second && engineOn && multipv > 1)
      out.push({ startSquare: second.slice(0, 2), endSquare: second.slice(2, 4), color: "rgba(129,182,76,0.4)" });
    return out;
  }, [live.lines, review.evals, ply, onMainline, engineOn, multipv, hoverMove, hoverValid]);

  const handleMove = useCallback(
    (from: string, to: string, promotion?: string) => {
      const m = makeMove(fen, from, to, promotion);
      if (!m) return false;
      game.play(m);
      return true;
    },
    [fen, game],
  );

  // Som do lance a cada mudança de posição: lance feito no tabuleiro, linha do motor, setas,
  // lista de lances, gráfico… Ao carregar uma partida nova (versão muda), fica em silêncio.
  const prevNav = useRef({ fen, version: state.version });
  useEffect(() => {
    const prev = prevNav.current;
    prevNav.current = { fen, version: state.version };
    if (prev.version !== state.version || prev.fen === fen || !active) return;
    if (lastMove) playMoveSound(lastMove.san);
    else sfx.move();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, state.version]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "ArrowLeft") game.step(-1);
      else if (e.key === "ArrowRight") game.step(1);
      else if (e.key === "Home") game.edge(false);
      else if (e.key === "End") game.edge(true);
      else if (e.key.toLowerCase() === "f") setOrientation((o) => (o === "white" ? "black" : "white"));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, game]);

  async function runReview() {
    if (!engineReady) return;
    cancelReview.current = false;
    const total = state.moves.length + 1;
    setReview({ status: "running", done: 0, total, evals: [] });
    try {
      const evals = await evaluateGame(
        state.startFen,
        state.moves,
        reviewLimitOf(settings),
        (partial, done, t, eta) => setReview({ status: "running", done, total: t, evals: partial, eta }),
        () => cancelReview.current,
      );
      if (!evals) {
        setReview(emptyReview);
        return;
      }
      setReview({ status: "done", done: total, total, evals });
      if (state.linkedRecordId) onLinkedChange(state.linkedRecordId, { evals: evals.map(compactEval) });
    } catch (e) {
      setReview({ status: "idle", done: 0, total: 0, evals: [], error: errorText(e) });
    }
  }

  const stats = useMemo(() => {
    const acc: Record<"w" | "b", number[]> = { w: [], b: [] };
    const counts: Record<"w" | "b", Record<MoveClass, number>> = { w: emptyCounts(), b: emptyCounts() };
    reviews.forEach((r, i) => {
      if (!r) return;
      const c = state.moves[i].color;
      acc[c].push(r.accuracy);
      counts[c][r.cls]++;
    });
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    // Precisão da partida pelo algoritmo do Lichess (ponderada pela volatilidade + média harmônica).
    const game = gameAccuracy(state.moves, review.evals);
    return { accW: game.w ?? avg(acc.w), accB: game.b ?? avg(acc.b), counts };
  }, [reviews, state.moves, review.evals]);

  const buildContext = useCallback(() => {
    const path = pathMoves(state);
    const lines: string[] = [];
    const h = state.headers;
    if ((h.White && h.White !== "?") || (h.Black && h.Black !== "?"))
      lines.push(`Partida: ${h.White ?? "?"} (brancas) x ${h.Black ?? "?"} (pretas)${h.Result ? `, resultado ${h.Result}` : ""}`);
    if (mySide !== "both") lines.push(`O aluno jogou com as ${mySide === "w" ? "brancas" : "pretas"}.`);
    if (memory.length) lines.push(`O que você já sabe sobre o aluno (memória de partidas anteriores):\n${memory.map((m) => `- ${m}`).join("\n")}`);
    if (state.startFen !== START_FEN) lines.push(`Posição inicial (FEN): ${state.startFen}`);
    else lines.push(openingContext(path));
    lines.push(`Lances até a posição atual: ${formatMoves(path) || "(nenhum lance)"}`);
    lines.push(`Posição atual (FEN): ${fen}`);
    lines.push(`Vez de jogar: ${turnOf(fen) === "w" ? "brancas" : "pretas"}`);
    try {
      const c = new Chess(fen);
      if (c.isCheckmate()) lines.push("A posição é xeque-mate.");
      else if (c.isStalemate()) lines.push("A posição é afogamento (empate).");
      else if (c.isCheck()) lines.push("O rei de quem joga está em xeque.");
    } catch {
      /* ignora */
    }
    if (state.cursor.inVar) lines.push("Observação: o aluno está explorando uma variante fora da partida original.");
    if (lastMove) {
      let l = `Último lance: ${moveLabel(lastMove)}`;
      if (lastReview) {
        l += ` — classificação: ${CLASS_INFO[lastReview.cls].label}; perdeu ${lastReview.loss.toFixed(0)} pontos percentuais de chance de vitória`;
        if (lastReview.cls !== "best" && lastReview.bestSan) l += `; o lance do Stockfish era ${lastReview.bestSan}`;
        const before = review.evals[ply - 1];
        if (before?.pv.length) l += ` (linha: ${pvToSan(lastMove.fenBefore, before.pv, 8)})`;
      }
      lines.push(l);
    }
    if (live.lines.length) {
      const d = live.lines[0].depth;
      const top = evalFromLine(live.lines[0], null);
      lines.push(`Stockfish (profundidade ${d}): ${evalText(top)} — ${evalWords(top)}. Valores positivos favorecem as brancas.`);
      lines.push("Melhores linhas:");
      live.lines.forEach((l, i) => lines.push(`${i + 1}) ${evalText(evalFromLine(l, null))}: ${pvToSan(fen, l.pv, 10)}`));
    } else if (currentReviewEval && !currentReviewEval.terminal) {
      lines.push(
        `Stockfish (profundidade ${currentReviewEval.depth}): ${evalText(currentReviewEval)} — ${evalWords(currentReviewEval)}. Valores positivos favorecem as brancas.`,
      );
      if (currentReviewEval.pv.length) lines.push(`Melhor linha: ${pvToSan(fen, currentReviewEval.pv, 10)}`);
    } else {
      lines.push("Análise do Stockfish indisponível para esta posição.");
    }
    return lines.join("\n");
  }, [state, fen, lastMove, lastReview, live.lines, currentReviewEval, review.evals, ply, mySide, memory]);

  function sendAsk(text: string, display: string) {
    setAsk({ id: Date.now(), text, display });
    setPanel("treinador");
  }

  function askGameReview() {
    const items: string[] = [];
    reviews.forEach((r, i) => {
      if (!r || r.cls === "best" || r.cls === "good" || r.cls === "book") return;
      const m = state.moves[i];
      if (mySide !== "both" && m.color !== mySide) return;
      const before = review.evals[i];
      const after = review.evals[i + 1];
      items.push(
        `- ${moveLabel(m)} (${m.color === "w" ? "brancas" : "pretas"}): ${CLASS_INFO[r.cls].label}, avaliação ${evalText(before)} → ${evalText(after)}; melhor era ${r.bestSan}${
          before?.pv.length ? ` (linha: ${pvToSan(m.fenBefore, before.pv, 6)})` : ""
        }`,
      );
    });
    const who = mySide === "both" ? "dos dois lados" : `das ${mySide === "w" ? "brancas" : "pretas"} (o meu lado)`;
    const acc = [
      stats.accW !== null ? `precisão das brancas ${stats.accW.toFixed(1)}%` : "",
      stats.accB !== null ? `precisão das pretas ${stats.accB.toFixed(1)}%` : "",
    ]
      .filter(Boolean)
      .join(", ");
    const text = [
      `Revisei a partida inteira com o Stockfish (${acc}). Partida completa: ${formatMoves(state.moves)}`,
      openingContext(state.moves),
      "",
      `Lances imprecisos ${who}:`,
      items.length ? items.join("\n") : "(nenhum erro relevante)",
      "",
      "Faça um resumo de treinador: (1) os 2 ou 3 momentos decisivos e o que eu deixei de ver em cada um, (2) os padrões de erro que se repetem, (3) três coisas concretas para eu treinar.",
    ].join("\n");
    sendAsk(text, "Comente minha partida (resumo da revisão)");
  }

  function showBestInstead() {
    if (!lastReview?.bestUci || !lastMove) return;
    const m = uciToMove(lastMove.fenBefore, lastReview.bestUci);
    if (!m) return;
    game.goto({ inVar: false, ply: ply - 1 });
    game.play(m);
  }

  const headers = state.headers;
  const configured = settings.provider === "gemini" ? !!settings.geminiApiKey : !!settings.claudeApiKey;
  // só vale enquanto a análise mostra a mesma partida (se o aluno carregar outra, desliga)
  const linked = linkedRecord && state.linkedRecordId === linkedRecord.id ? linkedRecord : null;
  const providerLabel = settings.provider === "gemini" ? settings.geminiModel : settings.claudeModel;
  const nameOf = (c: "w" | "b") => {
    const n = c === "w" ? headers.White : headers.Black;
    return n && n !== "?" ? n : c === "w" ? "Brancas" : "Pretas";
  };
  const eloOf = (c: "w" | "b") => {
    const e = c === "w" ? headers.WhiteElo : headers.BlackElo;
    return e && e !== "?" ? e : undefined;
  };
  const topColor = orientation === "white" ? "b" : "w";
  const bottomColor = orientation === "white" ? "w" : "b";
  const turn = turnOf(fen);

  // Mensagem do treinador na aba Revisão
  let coachText: React.ReactNode;
  if (!engineReady) coachText = "Preciso do Stockfish para revisar. Configure o motor na aba Configurações.";
  else if (state.moves.length === 0) coachText = "Importe uma partida ou jogue alguns lances, e eu reviso cada decisão com você.";
  else if (review.status === "idle") coachText = "Vamos ver onde a partida foi decidida? Clique em Revisar partida e eu classifico cada lance.";
  else if (review.status === "running") coachText = "Analisando cada lance com o Stockfish…";
  else if (lastMove && lastReview) {
    const info = CLASS_INFO[lastReview.cls];
    coachText = (
      <>
        <strong>{moveLabel(lastMove)}</strong>{" "}
        {lastReview.cls === "book" ? (
          <>
            é <span style={{ color: info.color, fontWeight: 800 }}>teórico</span>
            {openingTrack.opening ? <>: {openingLabel(openingTrack.opening)}</> : null}.
          </>
        ) : (
          <>
            foi <span style={{ color: info.color, fontWeight: 800 }}>{info.label.toLowerCase()}</span>.
          </>
        )}
        {lastReview.cls !== "best" && lastReview.cls !== "book" && lastReview.bestSan && (
          <>
            {" "}O Stockfish preferia <strong>{lastReview.bestSan}</strong>.
          </>
        )}{" "}
        <span className="bubble-eval">
          {evalText(review.evals[ply - 1])} → {evalText(review.evals[ply])}
        </span>
      </>
    );
  } else coachText = "Revisão pronta! Navegue pelos lances com ← → e eu comento cada um.";

  const badgeOrder: MoveClass[] = CLASS_ORDER;

  return (
    <div className="analysis">
      <section className="board-col" ref={fit.ref} style={fit.style}>
        <div className="board-stack">
        <PlayerBar name={nameOf(topColor)} rating={eloOf(topColor)} color={topColor} fen={fen} toMove={turn === topColor} />
        <div className="board-row">
          <EvalBar evaluation={engineOn || review.evals.length ? shownEval : null} orientation={orientation} />
          <BoardView
            fen={fen}
            orientation={orientation}
            onMove={handleMove}
            arrows={arrows}
            lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : null}
            previewMove={hoverMove && hoverValid ? { from: hoverMove.slice(0, 2), to: hoverMove.slice(2, 4) } : null}
          />
        </div>
        <PlayerBar name={nameOf(bottomColor)} rating={eloOf(bottomColor)} color={bottomColor} fen={fen} toMove={turn === bottomColor} />
        <div className="controls">
          <div className="nav-group">
            <button className="btn-2" onClick={() => game.edge(false)} title="Início (Home)">
              <ChevronsLeft size={22} strokeWidth={2.6} />
            </button>
            <button className="btn-2" onClick={() => game.step(-1)} title="Voltar (←)">
              <ChevronLeft size={22} strokeWidth={2.6} />
            </button>
            <button className="btn-2" onClick={() => game.step(1)} title="Avançar (→)">
              <ChevronRight size={22} strokeWidth={2.6} />
            </button>
            <button className="btn-2" onClick={() => game.edge(true)} title="Fim (End)">
              <ChevronsRight size={22} strokeWidth={2.6} />
            </button>
          </div>
          <button className="btn-2 labeled" onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))} title="Girar tabuleiro (F)">
            <RotateCcw size={16} strokeWidth={2.6} /> Girar
          </button>
          <button className="btn-2 labeled" onClick={() => onEditPosition(fen)} title="Abrir esta posição no editor">
            <Pencil size={16} strokeWidth={2.6} /> Editar
          </button>
          <button className="btn-2 labeled" onClick={() => game.load(START_FEN)} title="Novo tabuleiro na posição inicial">
            <Plus size={16} strokeWidth={2.6} /> Novo
          </button>
        </div>
        </div>
      </section>

      <section className="side-panel">
        <div className="panel-tabs">
          {(
            [
              ["revisao", "Revisão"],
              ["analise", "Análise"],
              ["treinador", "Treinador"],
            ] as [PanelTab, string][]
          ).map(([id, label]) => (
            <button key={id} className={panel === id ? "active" : ""} onClick={() => setPanel(id)}>
              {label}
            </button>
          ))}
        </div>

        {/* ---------------- Revisão */}
        <div className={`panel-body ${panel === "revisao" ? "" : "hidden"}`}>
          <div className="panel-scroll">
            <CoachBubble>{coachText}</CoachBubble>

            {review.status === "running" && (
              <div className="progress-wrap">
                <div className="progress">
                  <div style={{ width: `${(review.done / Math.max(1, review.total)) * 100}%` }} />
                </div>
                <span className="small muted">
                  {review.done}/{review.total} {formatEta(review.eta ?? null)}
                </span>
                <button className="link" onClick={() => (cancelReview.current = true)}>
                  Cancelar
                </button>
              </div>
            )}
            {review.error && <div className="error">{review.error}</div>}

            {review.status === "done" && (
              <>
                <div className="acc-cards">
                  <div className="acc-card light">
                    <div className="acc-label">Precisão brancas</div>
                    <div className="acc-value">{stats.accW !== null ? `${stats.accW.toFixed(1)}%` : "—"}</div>
                    <Stars value={stats.accW} />
                  </div>
                  <div className="acc-card dark">
                    <div className="acc-label">Precisão pretas</div>
                    <div className="acc-value">{stats.accB !== null ? `${stats.accB.toFixed(1)}%` : "—"}</div>
                    <Stars value={stats.accB} />
                  </div>
                </div>
                <div className="badge-table">
                  <div className="badge-row head">
                    <span />
                    <span>Brancas</span>
                    <span>Pretas</span>
                  </div>
                  {badgeOrder.map((c) => (
                    <div className="badge-row" key={c}>
                      <span className="badge-name">
                        <span className="badge" style={{ background: CLASS_INFO[c].color }}>
                          {CLASS_INFO[c].symbol}
                        </span>
                        {CLASS_INFO[c].label}
                      </span>
                      <span>{stats.counts.w[c]}</span>
                      <span>{stats.counts.b[c]}</span>
                    </div>
                  ))}
                </div>
                {review.evals.length > 1 && (
                  <EvalGraph
                    evals={review.evals}
                    reviews={reviews}
                    currentPly={onMainline ? ply : null}
                    onSelect={(p) => game.goto({ inVar: false, ply: p })}
                  />
                )}
                {lastMove && lastReview && (
                  <div className="row-buttons">
                    {lastReview.cls !== "best" && lastReview.bestUci && (
                      <button className="btn-2 labeled" onClick={showBestInstead}>
                        Ver melhor lance
                      </button>
                    )}
                    <button
                      className="btn-2 labeled"
                      disabled={!configured}
                      onClick={() =>
                        sendAsk(
                          "Explique este último lance: por que ele recebeu essa classificação, o que o lance do Stockfish faz de diferente e que ideia eu deveria levar para próximas partidas.",
                          `Explique o lance ${moveLabel(lastMove)}`,
                        )
                      }
                    >
                      Perguntar ao treinador
                    </button>
                  </div>
                )}
              </>
            )}

            <MoveList
              state={state}
              reviews={reviews}
              onGoto={(inVar, p) => game.goto({ inVar, ply: p })}
              onExitVariation={game.exitVariation}
              onPromoteVariation={game.promoteVariation}
              opening={openingTrack}
            />
          </div>
          <div className="panel-footer">
            <label className="side-select">
              Eu joguei de
              <select value={mySide} onChange={(e) => setMySide(e.target.value as "w" | "b" | "both")}>
                <option value="both">—</option>
                <option value="w">Brancas</option>
                <option value="b">Pretas</option>
              </select>
            </label>
            {review.status === "done" ? (
              <>
                <button className="btn-primary big" disabled={!configured} onClick={askGameReview}>
                  Pedir resumo ao treinador
                </button>
                <button className="link small" onClick={() => setReview(emptyReview)}>
                  Refazer revisão
                </button>
              </>
            ) : (
              <button className="btn-primary big" disabled={!engineReady || state.moves.length === 0 || reviewing} onClick={runReview}>
                {reviewing
                  ? "Revisando…"
                  : settings.reviewMode === "time"
                    ? `Revisar partida (${(settings.reviewMs / 1000).toLocaleString("pt-BR")} s/lance)`
                    : `Revisar partida (prof. ${settings.reviewDepth})`}
              </button>
            )}
          </div>
        </div>

        {/* ---------------- Análise */}
        <div className={`panel-body ${panel === "analise" ? "" : "hidden"}`}>
          <div className="panel-scroll">
            <div className="engine-head">
              <label className="switch">
                <input type="checkbox" checked={engineOn} onChange={(e) => setEngineOn(e.target.checked)} />
                <span className="switch-track" />
                Stockfish
              </label>
              <span className="muted small">
                {live.lines[0] ? `prof. ${live.lines[0].depth} · ${(live.lines[0].nps / 1000).toFixed(0)} kn/s` : ""}
              </span>
              <span className="spacer" />
              <label className="small muted">
                Linhas{" "}
                <select value={multipv} onChange={(e) => setMultipv(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            {live.lines[0]?.wdl && engineOn && !reviewing && (
              <div className="wdl" title="Chances estimadas pelo Stockfish (ponto de vista das brancas)">
                <div className="wdl-bar">
                  <span className="w" style={{ flex: live.lines[0].wdl[0] }} />
                  <span className="d" style={{ flex: live.lines[0].wdl[1] }} />
                  <span className="l" style={{ flex: live.lines[0].wdl[2] }} />
                </div>
                <div className="wdl-legend">
                  <span>Brancas vencem {(live.lines[0].wdl[0] / 10).toFixed(1)}%</span>
                  <span>Empate {(live.lines[0].wdl[1] / 10).toFixed(1)}%</span>
                  <span>Pretas vencem {(live.lines[0].wdl[2] / 10).toFixed(1)}%</span>
                </div>
              </div>
            )}
            {engineReady && settings.liveLimit !== "infinite" && (
              <div className="muted small">
                Limite: {settings.liveLimit === "depth" ? `profundidade ${settings.liveDepth}` : `${settings.liveSeconds} s por posição`} (mude em
                Configurações)
              </div>
            )}
            {!engineReady && <div className="notice">Motor não iniciado. Configure o Stockfish na aba Configurações.</div>}
            {live.error && <div className="error">{live.error}</div>}
            {reviewing && <div className="muted small">Análise ao vivo pausada durante a revisão.</div>}
            {engineReady && engineOn && !reviewing && (
              <div className="pv-lines">
                {live.lines.length === 0 && !terminalEval(fen) && <div className="muted small">calculando…</div>}
                {terminalEval(fen) && <div className="muted small">Fim de jogo.</div>}
                {live.lines.map((l) => (
                  <button
                    key={l.multipv}
                    className={`pv-line ${hoverMove === l.pv[0] ? "hovered" : ""}`}
                    title="Clique para jogar o primeiro lance desta linha"
                    onMouseEnter={() => setHoverMove(l.pv[0] ?? null)}
                    onMouseLeave={() => setHoverMove(null)}
                    onFocus={() => setHoverMove(l.pv[0] ?? null)}
                    onBlur={() => setHoverMove(null)}
                    onClick={() => {
                      const m = uciToMove(fen, l.pv[0]);
                      if (m) game.play(m);
                    }}
                  >
                    <span className={`pv-eval ${(l.mate ?? 0) > 0 || (l.mate === null && (l.cp ?? 0) >= 0) ? "pos" : "neg"}`}>
                      {evalText(evalFromLine(l, null))}
                    </span>
                    <span className="pv-moves">{pvToSan(fen, l.pv, 14)}</span>
                  </button>
                ))}
              </div>
            )}
            <MoveList
              state={state}
              reviews={reviews}
              onGoto={(inVar, p) => game.goto({ inVar, ply: p })}
              onExitVariation={game.exitVariation}
              onPromoteVariation={game.promoteVariation}
              opening={openingTrack}
            />
          </div>
        </div>

        {/* ---------------- Treinador (sempre montado para manter a conversa) */}
        <div className={`panel-body ${panel === "treinador" ? "" : "hidden"}`}>
          {linked && (
            <div className="linked-banner">
              Conversa da partida contra <strong>{linked.botName}</strong> · {new Date(linked.date).toLocaleDateString("pt-BR")}
            </div>
          )}
          <TutorChat
            buildContext={() =>
              linked
                ? `${recordContext(linked, memory)}\n\n[POSIÇÃO QUE O ALUNO ESTÁ OLHANDO AGORA NO TABULEIRO]\n${buildContext()}`
                : buildContext()
            }
            ask={ask}
            providerLabel={providerLabel}
            configured={configured}
            resetKey={linked ? `partida-${linked.id}-${linked.chat?.length ?? 0}` : "livre"}
            initialMessages={linked?.chat}
            onMessagesChange={linked ? (chat) => onLinkedChange(linked.id, { chat }) : undefined}
            intro={linked ? `Continuando nossa conversa sobre a partida contra ${linked.botName}. Pergunte sobre esta posição ou qualquer lance.` : undefined}
            onMoveClick={(n, black, san) => {
              const p = resolveMoveRef(state.moves, n, black, san);
              if (p !== null) game.goto({ inVar: false, ply: p });
            }}
          />
        </div>
      </section>
    </div>
  );
}
