import { CLASS_INFO, resolveMoveRef, type MoveNode } from "../lib/chess-utils";
import type { CoachGameReport } from "../lib/profile";
import { CoachBubble, Markdown, linkMoves, type MoveClickHandler } from "./TutorChat";

/** Relatório do treinador: resumo, o que foi bem e onde errou (com lances clicáveis). */
export function CoachReport({ coach, onMoveClick }: { coach: CoachGameReport; onMoveClick?: MoveClickHandler }) {
  return (
    <>
      <CoachBubble>
        <strong>{coach.headline}</strong>
        <Markdown text={coach.report} onMoveClick={onMoveClick} />
      </CoachBubble>
      {coach.good_moments.length > 0 && (
        <div className="moments good">
          <div className="card-title">O que você fez bem</div>
          {coach.good_moments.map((m, i) => (
            <div key={i} className="moment">
              <span className="badge mini" style={{ background: CLASS_INFO.best.color }}>
                ★
              </span>
              <div>
                <strong>{linkMoves(m.move, onMoveClick)}</strong> {m.why}
              </div>
            </div>
          ))}
        </div>
      )}
      {coach.mistakes.length > 0 && (
        <div className="moments bad">
          <div className="card-title">Onde errou e a lição</div>
          {coach.mistakes.map((m, i) => (
            <div key={i} className="moment">
              <span className="badge mini" style={{ background: CLASS_INFO.blunder.color }}>
                ?
              </span>
              <div>
                <strong>{linkMoves(m.move, onMoveClick)}</strong> {m.what_happened}
                <div className="lesson">Lição: {m.lesson}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const REF = /(\d{1,3})\.(\.\.|…)?\s?(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)/;

/** Lance (ply, 1 = primeiro lance) citado num texto como "12. Ng3" ou "17... Qd5". */
function plyOf(moves: MoveNode[], ref: string): number | null {
  const m = REF.exec(ref);
  return m ? resolveMoveRef(moves, parseInt(m[1], 10), !!m[2], m[3]) : null;
}

export type CoachNote = { kind: "good"; text: string } | { kind: "mistake"; text: string; lesson: string };

/** Comentário do relatório do treinador sobre o lance que leva ao `ply` (se houver). */
export function coachNoteAt(coach: CoachGameReport | null | undefined, moves: MoveNode[], ply: number): CoachNote | null {
  if (!coach || ply <= 0) return null;
  const bad = coach.mistakes.find((m) => plyOf(moves, m.move) === ply);
  if (bad) return { kind: "mistake", text: bad.what_happened, lesson: bad.lesson };
  const good = coach.good_moments.find((m) => plyOf(moves, m.move) === ply);
  return good ? { kind: "good", text: good.why } : null;
}
