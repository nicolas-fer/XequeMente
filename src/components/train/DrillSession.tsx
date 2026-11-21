import { useRef, useState } from "react";
import type { Arrow } from "react-chessboard";
import { ArrowRight, Eye, Lightbulb, Trophy } from "lucide-react";
import { BoardView } from "../BoardView";
import { CoachBubble } from "../TutorChat";
import { coachNoteAt, type CoachNote } from "../CoachReport";
import { useBoardFit } from "../boardKit";
import { CLASS_INFO, makeMove, uciToSan, type MoveNode } from "../../lib/chess-utils";
import { playMoveSound } from "../../lib/sound";
import { addDays, dayKey, scheduleCard, type AttemptInput, type DrillRef, type DrillsState } from "../../lib/drills";
import { exercisesFor, squaresOf, themeHint, type DrillExercise } from "../../lib/drills-build";
import { judgeMove } from "../../lib/drills-check";
import type { GameRecord } from "../../lib/profile";

interface Props {
  /** exercícios escolhidos para hoje */
  refs: DrillRef[];
  games: GameRecord[];
  /** estado do treino quando a sessão começou (para prever a próxima revisão) */
  drills: DrillsState | null;
  engineReady: boolean;
  onAttempt: (a: AttemptInput) => void;
  onOpenGame: (id: string) => void;
  /** volta para a tela inicial do treino */
  onExit: () => void;
}

interface QueueItem {
  ex: DrillExercise;
  /** voltou na mesma sessão depois de um erro */
  retry: boolean;
}

interface Outcome {
  kind: "best" | "alt" | "wrong" | "solution";
  ok: boolean;
  /** lance do aluno (null quando pediu a solução) */
  played: MoveNode | null;
  lossCp: number;
  /** melhor resposta do adversário ao lance do aluno, em SAN (quando o motor avaliou) */
  replySan: string;
}

interface LogItem {
  ok: boolean;
  first: boolean;
  /** próxima revisão deste exercício */
  due: string;
}

/** Em quantas posições depois do erro o exercício volta na sessão. */
const RETRY_GAP = 3;

/** Sessão de treino: um exercício por vez, com dicas, solução e resumo no fim. */
export function DrillSession({ refs, games, drills, engineReady, onAttempt, onOpenGame, onExit }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>(() => exercisesFor(refs, games).map((ex) => ({ ex, retry: false })));
  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState<"thinking" | "checking" | "done">("thinking");
  /** lance que está sendo conferido pelo motor (o tabuleiro mostra a posição depois dele) */
  const [pending, setPending] = useState<MoveNode | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [hint, setHint] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [log, setLog] = useState<LogItem[]>([]);
  const [finished, setFinished] = useState(false);
  // exercícios já respondidos nesta sessão (só a primeira resposta mexe na caixa)
  const seen = useRef(new Set<string>());
  // identifica a conferência em andamento: resposta antiga do motor não pode aparecer no exercício seguinte
  const run = useRef(0);
  const fit = useBoardFit(0, 0, 720);

  const item = queue[idx];
  const ex = item?.ex;
  if (finished || !item || !ex) return <Summary log={log} onExit={onExit} />;

  const best = squaresOf(ex.bestUci);
  const orientation = ex.playerColor === "w" ? "white" : "black";
  const symbol = CLASS_INFO[ex.cls].symbol;
  const revealed = status === "done" && outcome && !outcome.ok;
  const note: CoachNote | null = revealed ? coachNoteAt(ex.coach, ex.moves, ex.ply) : null;

  let fen = ex.fen;
  if (status === "checking" && pending) fen = pending.fenAfter;
  else if (status === "done" && outcome?.ok && outcome.played) fen = outcome.played.fenAfter;

  const arrows: Arrow[] = revealed ? [{ startSquare: best.from, endSquare: best.to, color: "rgba(129,182,76,0.9)" }] : [];
  const lastMove = status === "done" && outcome?.ok && outcome.played ? { from: outcome.played.from, to: outcome.played.to } : null;
  // dica 1: destaca a casa de origem da peça (a mesma casa nos dois lados)
  const hintSquare = status === "thinking" && hint >= 1 ? { from: best.from, to: best.from } : null;
  const lastIndex = idx + 1 >= queue.length;

  function resolve(kind: Outcome["kind"], ok: boolean, played: MoveNode | null, lossCp: number, replySan = "") {
    const first = !seen.current.has(ex.id);
    seen.current.add(ex.id);
    const now = new Date();
    onAttempt({ id: ex.id, gameId: ex.gameId, ok, first, now });
    const due = scheduleCard(drills?.cards[ex.id], ex.gameId, ok, dayKey(now)).due;
    setLog((l) => [...l, { ok, first, due }]);
    setPending(null);
    setOutcome({ kind, ok, played, lossCp, replySan });
    setStatus("done");
    // erro na primeira tentativa: o exercício volta mais adiante na mesma sessão
    if (!ok && first) {
      setQueue((q) => {
        const copy = [...q];
        copy.splice(Math.min(idx + RETRY_GAP, copy.length), 0, { ex, retry: true });
        return copy;
      });
    }
  }

  function handleMove(from: string, to: string, promotion?: string): boolean {
    if (status !== "thinking") return false;
    const move = makeMove(ex.fen, from, to, promotion);
    if (!move) return false;
    const current = ++run.current;
    playMoveSound(move.san);
    setNotice(null);
    setPending(move);
    setStatus("checking");
    void judgeMove(ex, move, engineReady).then((j) => {
      if (current !== run.current) return;
      if (j.kind === "unknown") {
        // motor parado: só o lance principal é aceito; o aluno tenta de novo sem perder ponto
        setPending(null);
        setStatus("thinking");
        setNotice("O motor está parado, então só consigo confirmar o lance principal. Tente outro lance ou veja a solução.");
      } else if (j.kind === "wrong") resolve("wrong", false, move, 0, j.reply ? safeSan(move.fenAfter, j.reply) : "");
      else resolve(j.kind, true, move, j.kind === "alt" ? j.lossCp : 0);
    });
    return true;
  }

  function showSolution() {
    if (status !== "thinking") return;
    run.current++;
    resolve("solution", false, null, 0);
  }

  function next() {
    run.current++;
    setOutcome(null);
    setNotice(null);
    setHint(0);
    setStatus("thinking");
    setIdx((i) => i + 1);
  }

  return (
    <div className="train-session">
      <section className="train-board-col" ref={fit.ref} style={fit.style}>
        <div className="train-board-wrap">
          <BoardView
            fen={fen}
            orientation={orientation}
            onMove={handleMove}
            arrows={arrows}
            lastMove={lastMove}
            previewMove={hintSquare}
            interactive={status === "thinking"}
          />
        </div>
      </section>

      <aside className="train-side panel" aria-label="Exercício">
        <div className="train-progress small muted">
          Exercício {idx + 1} de {queue.length}
          {item.retry && <span className="train-retry"> · voltou para revisar</span>}
        </div>

        <CoachBubble>
          <span>
            Na partida contra <strong>{ex.botName}</strong> você jogou <strong>{ex.label}{symbol}</strong> aqui. Tem coisa melhor: ache o lance.
          </span>
        </CoachBubble>

        {status === "thinking" && hint >= 1 && <p className="train-hint">Comece pela peça destacada.</p>}
        {status === "thinking" && hint >= 2 && <p className="train-hint">{themeHint(ex.tags)}</p>}
        {notice && <p className="train-notice" role="status">{notice}</p>}
        {status === "checking" && <p className="hint" role="status">Conferindo o lance com o motor...</p>}
        {status === "done" && outcome && <Feedback ex={ex} outcome={outcome} note={note} />}

        <div className="train-actions">
          {status === "thinking" && (
            <>
              <button type="button" className="btn-2 labeled" onClick={() => setHint((h) => Math.min(2, h + 1))} disabled={hint >= 2}>
                <Lightbulb size={16} aria-hidden /> {hint === 0 ? "Dica" : "Mais uma dica"}
              </button>
              <button type="button" className="btn-2 labeled" onClick={showSolution}>
                <Eye size={16} aria-hidden /> Ver solução
              </button>
            </>
          )}
          {status === "done" && (
            <button type="button" className="btn-primary" onClick={lastIndex ? () => setFinished(true) : next}>
              {lastIndex ? "Ver resumo" : "Próximo"} <ArrowRight size={16} aria-hidden />
            </button>
          )}
        </div>

        <div className="train-footer">
          <button type="button" className="link" onClick={() => onOpenGame(ex.gameId)}>
            Ver a partida
          </button>
          <button type="button" className="link" onClick={() => setFinished(true)}>
            Encerrar sessão
          </button>
        </div>
      </aside>
    </div>
  );
}

function Feedback({ ex, outcome, note }: { ex: DrillExercise; outcome: Outcome; note: CoachNote | null }) {
  const played = outcome.played?.san ?? "";
  let title: string;
  if (outcome.kind === "best") title = `Isso mesmo! ${ex.bestSan} é o melhor lance aqui.`;
  else if (outcome.kind === "alt") title = `Também serve! ${played} perde pouco em relação a ${ex.bestSan}, o melhor lance.`;
  else if (outcome.kind === "solution") title = `O lance certo era ${ex.bestSan}.`;
  else title = `Não era esse. Você jogou ${played}; o melhor era ${ex.bestSan}.`;

  return (
    <div className={`train-feedback ${outcome.ok ? "ok" : "bad"}`} role="status">
      <p className="train-feedback-title">{title}</p>
      {!outcome.ok && outcome.played && outcome.replySan && (
        <p>
          Depois de {played}, o adversário responde <strong>{outcome.replySan}</strong>.
        </p>
      )}
      {outcome.kind === "solution" && ex.reply && (
        <p>
          Na partida você jogou {ex.label} e o adversário podia responder <strong>{ex.reply}</strong>.
        </p>
      )}
      {!outcome.ok && ex.line && (
        <p className="small">
          Continuação: <span className="train-line">{ex.line}</span>
        </p>
      )}
      {note?.kind === "mistake" && note.lesson && (
        <p className="train-lesson">
          <strong>Lição do treinador:</strong> {note.lesson}
        </p>
      )}
    </div>
  );
}

function Summary({ log, onExit }: { log: LogItem[]; onExit: () => void }) {
  const firstRight = log.filter((l) => l.first && l.ok).length;
  const firstWrong = log.filter((l) => l.first && !l.ok).length;
  const tomorrow = addDays(dayKey(), 1);
  const nextDue = log.length ? [...log.map((l) => l.due)].sort()[0] : null;
  const nextLabel = !nextDue ? null : nextDue <= tomorrow ? "amanhã" : formatDay(nextDue);

  return (
    <section className="train-summary panel" aria-label="Resumo da sessão">
      <h2 className="panel-title">
        <Trophy size={20} aria-hidden /> Sessão concluída
      </h2>
      {log.length === 0 ? (
        <p className="hint">Nenhum exercício foi resolvido nesta sessão.</p>
      ) : (
        <>
          <ul className="train-summary-list">
            <li>
              <strong>{firstRight}</strong> acertos de primeira
            </li>
            <li>
              <strong>{firstWrong}</strong> erros (voltam em breve)
            </li>
            <li>
              <strong>{log.length}</strong> respostas no total
            </li>
          </ul>
          {nextLabel && <p className="hint">Próxima revisão: {nextLabel}.</p>}
        </>
      )}
      <button type="button" className="btn-primary" onClick={onExit}>
        Voltar ao treino
      </button>
    </section>
  );
}

/** SAN de um lance em UCI; vazio se não der para converter. */
function safeSan(fen: string, uci: string): string {
  try {
    return uciToSan(fen, uci);
  } catch {
    return "";
  }
}

/** "12/03" a partir de AAAA-MM-DD. */
function formatDay(key: string): string {
  const [, m, d] = key.split("-");
  return `${d}/${m}`;
}
