import { useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import { ExternalLink, Sparkles, Trash2 } from "lucide-react";
import { api, errorText, type Settings } from "../lib/api";
import { CLASS_INFO, CLASS_ORDER, emptyCounts, fullmoveOf, moveLabel, resolveMoveRef, reviewMove, type MoveNode } from "../lib/chess-utils";
import { botFor } from "../lib/bots";
import { PHASE_LABEL } from "../lib/review";
import { openingFamily, openingLabel } from "../lib/openings";
import { OpeningLine } from "./MoveList";
import { CoachReport } from "./CoachReport";
import {
  GAME_REPORT_SCHEMA,
  coachSystem,
  gameReportPrompt,
  headersOf,
  recordOpening,
  movesOf,
  recordContext,
  type CoachGameReport,
  type GameRecord,
  type ProfileData,
} from "../lib/profile";
import type { OpenOpts } from "../lib/useGame";
import { CoachBubble, TutorChat, linkMoves } from "./TutorChat";

interface Props {
  settings: Settings;
  profile: ProfileData;
  updateProfile: (fn: (p: ProfileData) => ProfileData) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenInAnalysis: (startFen: string, moves: MoveNode[], headers: Record<string, string>, opts?: OpenOpts) => void;
}

type Filter = "all" | "win" | "loss" | "draw";

const HISTORY_QUICK = [
  { label: "Resuma de novo", text: "Resuma esta partida para mim em poucas linhas: o momento decisivo e a principal lição." },
  { label: "Onde a partida virou?", text: "Em que momento exato a partida virou e o que eu deveria ter jogado ali? Mostre a ideia." },
  { label: "Já melhorei nisso?", text: "Comparando com o que você sabe de mim, eu melhorei ou repeti os mesmos erros nesta partida?" },
];

function resultLabel(g: GameRecord) {
  return g.result === "win" ? "Vitória" : g.result === "loss" ? "Derrota" : "Empate";
}

function GameDetail({
  g,
  settings,
  profile,
  updateProfile,
  onOpenInAnalysis,
  onDeleted,
}: {
  g: GameRecord;
  settings: Settings;
  profile: ProfileData;
  updateProfile: Props["updateProfile"];
  onOpenInAnalysis: Props["onOpenInAnalysis"];
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const moves = useMemo(() => movesOf(g), [g]);
  const opening = recordOpening(g);
  const bot = botFor(g.level);
  const finalFen = moves.length ? moves[moves.length - 1].fenAfter : g.startFen;
  const aiConfigured = settings.provider === "gemini" ? !!settings.geminiApiKey : !!settings.claudeApiKey;
  const reviews = useMemo(
    () => moves.map((m, i) => (g.evals ? reviewMove(m, g.evals[i] ?? null, g.evals[i + 1] ?? null, moves[i - 1]) : null)),
    [moves, g.evals],
  );
  const counts = useMemo(() => {
    const c = emptyCounts();
    reviews.forEach((r, i) => r && moves[i].color === g.playerColor && c[r.cls]++);
    return g.evals ? c : g.counts ?? null;
  }, [reviews, moves, g]);

  const open = (ply?: number, panel: "revisao" | "treinador" = "revisao") =>
    onOpenInAnalysis(g.startFen, moves, headersOf(g, profile.playerName), { ply, preReview: g.evals ?? null, recordId: g.id, panel });
  const openRef = (n: number, black: boolean, san: string) => {
    const ply = resolveMoveRef(moves, n, black, san);
    if (ply !== null) open(ply);
  };
  /** lances clicados dentro do chat: a conversa continua na aba Treinador da Análise */
  const openRefFromChat = (n: number, black: boolean, san: string) => {
    const ply = resolveMoveRef(moves, n, black, san);
    if (ply !== null) open(ply, "treinador");
  };

  async function generateReport() {
    setBusy(true);
    setError(null);
    try {
      const rep = await api.llmJson<CoachGameReport>(
        coachSystem(settings.tutorLevel),
        gameReportPrompt({ record: g, moveDigest: g.digest ?? [], memory: profile.memory, previous: profile.games.filter((x) => x.id !== g.id) }),
        GAME_REPORT_SCHEMA,
      );
      const memory = (rep.memory ?? []).map((m) => String(m).trim()).filter(Boolean).slice(0, 12);
      updateProfile((p) => ({
        ...p,
        memory: memory.length ? memory : p.memory,
        games: p.games.map((x) => (x.id === g.id ? { ...x, coach: rep } : x)),
      }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const rows: { n: number; w?: number; b?: number }[] = [];
  moves.forEach((m, i) => {
    const n = fullmoveOf(m.fenBefore);
    if (m.color === "w" || !rows.length) rows.push({ n, [m.color]: i });
    else rows[rows.length - 1].b = i;
  });
  const cell = (i: number | undefined) => {
    if (i === undefined) return <span className="move placeholder" />;
    const r = reviews[i];
    const info = r ? CLASS_INFO[r.cls] : null;
    return (
      <button className="move" title={info ? `${info.label} · ver na Análise` : "Ver na Análise"} onClick={() => open(i + 1)}>
        {info && (
          <span className="badge mini" style={{ background: info.color }}>
            {info.symbol}
          </span>
        )}
        {moves[i].san}
      </button>
    );
  };

  return (
    <div className="history-detail">
      <div className="history-head panel">
        <div className="bot-avatar" style={{ width: 56, height: 56, background: bot.color }}>
          <img src={bot.avatar} alt={bot.name} />
        </div>
        <div className="history-title">
          <div className="history-vs">
            Você ({g.playerColor === "w" ? "brancas" : "pretas"}) x {g.botName} <span className="muted">· nível {g.level} · ~{g.botElo}</span>
          </div>
          <div className="muted small">
            {new Date(g.date).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" })} · {g.timeControl.label} · {g.plies} lances
          </div>
          {opening.opening && (
            <div className="history-opening">
              <OpeningLine track={opening} />
              {opening.outOfBookAt !== null && (
                <span className="muted small">saiu da teoria em {linkMoves(moveLabel(moves[opening.outOfBookAt]), openRef)}</span>
              )}
            </div>
          )}
        </div>
        <div className={`result-pill ${g.result}`}>
          {resultLabel(g)}
          <span>{g.reason}</span>
        </div>
      </div>

      <div className="history-grid">
        <div className="history-left">
          <div className="history-board">
            <Chessboard
              options={{
                id: `history-${g.id}`,
                position: finalFen,
                boardOrientation: g.playerColor === "w" ? "white" : "black",
                allowDragging: false,
                allowDrawingArrows: false,
                animationDurationInMs: 0,
                darkSquareStyle: { backgroundColor: "#739552" },
                lightSquareStyle: { backgroundColor: "#ebecd0" },
              }}
            />
          </div>
          <button className="btn-primary big" onClick={() => open()}>
            <ExternalLink size={18} strokeWidth={2.6} /> Abrir na Análise
          </button>
          <div className="move-card">
            <div className="card-title">Lances {g.evals ? "· clique para ver na Análise" : ""}</div>
            <div className="move-list">
              {rows.map((r) => (
                <div className="move-row" key={r.n}>
                  <span className="move-num">{r.n}.</span>
                  {cell(r.w)}
                  {cell(r.b)}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="history-right">
          <div className="acc-cards">
            <div className="acc-card light">
              <div className="acc-label">Sua precisão</div>
              <div className="acc-value">{g.accuracy !== null ? `${g.accuracy.toFixed(1)}%` : "—"}</div>
            </div>
            <div className="acc-card dark">
              <div className="acc-label">{g.botName}</div>
              <div className="acc-value">{g.opponentAccuracy !== null ? `${g.opponentAccuracy.toFixed(1)}%` : "—"}</div>
            </div>
          </div>
          {counts && (
            <div className="badge-strip">
              {CLASS_ORDER.map((c) => (
                <div key={c} className="badge-cell" title={CLASS_INFO[c].label}>
                  <span className="badge" style={{ background: CLASS_INFO[c].color }}>
                    {CLASS_INFO[c].symbol}
                  </span>
                  <span>{counts[c] ?? 0}</span>
                </div>
              ))}
            </div>
          )}

          {g.coach ? (
            <CoachReport coach={g.coach} onMoveClick={openRef} />
          ) : busy ? (
            <CoachBubble typing />
          ) : (
            <div className="notice row-buttons spread">
              <span>Esta partida ainda não tem o relatório do treinador.</span>
              <button className="btn-primary" disabled={!aiConfigured} onClick={generateReport}>
                <Sparkles size={16} /> Gerar relatório
              </button>
            </div>
          )}
          {error && <div className="error">{error}</div>}

          {g.mistakes.length > 0 && (
            <div className="moments">
              <div className="card-title">Erros apontados pelo Stockfish</div>
              {g.mistakes.map((m, i) => (
                <div key={i} className="moment">
                  <span className="badge mini" style={{ background: CLASS_INFO[m.cls].color }}>
                    {CLASS_INFO[m.cls].symbol}
                  </span>
                  <div>
                    <strong>{linkMoves(m.label, openRef)}</strong> {CLASS_INFO[m.cls].label.toLowerCase()} ({m.evalBefore} → {m.evalAfter}) · melhor era{" "}
                    <strong>{m.bestSan}</strong>
                    <div className="muted small">
                      {PHASE_LABEL[m.phase]} · {m.tags.join(", ")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="postgame-chat">
            <div className="card-title">Converse com o treinador sobre esta partida</div>
            <TutorChat
              inline
              buildContext={() => recordContext(g, profile.memory)}
              ask={null}
              providerLabel={settings.provider === "gemini" ? settings.geminiModel : settings.claudeModel}
              configured={aiConfigured}
              quick={HISTORY_QUICK}
              intro="Quer revisitar esta partida? Pergunte sobre um lance ou o que mudou desde então."
              resetKey={`${g.id}-${g.chat?.length ?? 0}`}
              initialMessages={g.chat}
              onMessagesChange={(chat) => updateProfile((p) => ({ ...p, games: p.games.map((x) => (x.id === g.id ? { ...x, chat } : x)) }))}
              onMoveClick={openRefFromChat}
            />
          </div>

          <div className="row-buttons">
            <button
              className={`btn-2 labeled ${confirmDelete ? "danger" : ""}`}
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  setTimeout(() => setConfirmDelete(false), 3000);
                  return;
                }
                updateProfile((p) => ({ ...p, games: p.games.filter((x) => x.id !== g.id) }));
                onDeleted();
              }}
            >
              <Trash2 size={15} /> {confirmDelete ? "Confirmar exclusão?" : "Excluir partida"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HistoryView({ settings, profile, updateProfile, selectedId, onSelect, onOpenInAnalysis }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [family, setFamily] = useState("");
  const families = useMemo(() => {
    const count = new Map<string, number>();
    profile.games.forEach((g) => {
      const o = recordOpening(g).opening;
      if (o) count.set(openingFamily(o.name), (count.get(openingFamily(o.name)) ?? 0) + 1);
    });
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [profile.games]);
  const games = profile.games.filter(
    (g) =>
      (filter === "all" || g.result === filter) &&
      (!family || openingFamily(recordOpening(g).opening?.name ?? "") === family),
  );
  const selected = profile.games.find((g) => g.id === selectedId) ?? games[0] ?? null;

  return (
    <div className="history">
      <aside className="history-list panel">
        <div className="panel-title">Partidas</div>
        <div className="seg">
          {(
            [
              ["all", "Todas"],
              ["win", "Vitórias"],
              ["loss", "Derrotas"],
              ["draw", "Empates"],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {label}
            </button>
          ))}
        </div>
        {families.length > 0 && (
          <select className="history-opening-filter" value={family} onChange={(e) => setFamily(e.target.value)} title="Filtrar por abertura">
            <option value="">Todas as aberturas</option>
            {families.map(([f, n]) => (
              <option key={f} value={f}>
                {f} ({n})
              </option>
            ))}
          </select>
        )}
        {games.length === 0 ? (
          <div className="muted small">{profile.games.length ? "Nenhuma partida neste filtro." : "Nenhuma partida ainda. Vá em Jogar!"}</div>
        ) : (
          <div className="history-items">
            {games.map((g) => {
              const bot = botFor(g.level);
              return (
                <button key={g.id} className={`history-item ${selected?.id === g.id ? "active" : ""}`} onClick={() => onSelect(g.id)}>
                  <span className={`result-dot ${g.result}`}>{g.result === "win" ? "V" : g.result === "loss" ? "D" : "E"}</span>
                  <span className="bot-avatar" style={{ width: 32, height: 32, background: bot.color }}>
                    <img src={bot.avatar} alt="" />
                  </span>
                  <span className="game-main">
                    <span>
                      {g.botName} <span className="muted">· {g.timeControl.label}</span>
                    </span>
                    {recordOpening(g).opening && (
                      <span className="muted small" title={openingLabel(recordOpening(g).opening)}>
                        {recordOpening(g).opening!.name}
                      </span>
                    )}
                    <span className="muted small">
                      {new Date(g.date).toLocaleDateString("pt-BR")} · {g.accuracy !== null ? `${g.accuracy.toFixed(0)}%` : "—"}
                      {g.chat?.length ? " · com conversa" : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </aside>
      <section className="history-main">
        {selected ? (
          <GameDetail
            key={selected.id}
            g={selected}
            settings={settings}
            profile={profile}
            updateProfile={updateProfile}
            onOpenInAnalysis={onOpenInAnalysis}
            onDeleted={() => onSelect(null)}
          />
        ) : (
          <div className="muted history-empty">Suas partidas contra os bots aparecem aqui, com a revisão, o relatório e a conversa com o treinador.</div>
        )}
      </section>
    </div>
  );
}
