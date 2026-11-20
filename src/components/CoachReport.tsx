import { useEffect, useState } from "react";
import { Loader2, Square, Volume2 } from "lucide-react";
import { CLASS_INFO, resolveMoveRef, type MoveNode } from "../lib/chess-utils";
import type { CoachGameReport } from "../lib/profile";
import { errorText } from "../lib/api";
import { coachVoiceKey, speak, speechOf, stopVoice, useVoice, voiceState } from "../lib/voice";
import { CoachBubble, Markdown, linkMoves, type MoveClickHandler } from "./TutorChat";

interface Props {
  coach: CoachGameReport;
  onMoveClick?: MoveClickHandler;
  /** nível do aluno (para gerar o resumo falado de relatórios antigos) */
  tutorLevel?: string;
  /** guarda o resumo falado gerado na hora (relatórios antigos não têm) */
  onSpeech?: (speech: string) => void;
}

/** Fala o resumo do relatório (gerando-o antes, se o relatório for antigo) e guarda o resumo gerado. */
export function speakCoach(coach: CoachGameReport, tutorLevel = "intermediario", onSpeech?: (speech: string) => void) {
  return speak(coachVoiceKey(coach), async () => {
    const text = await speechOf(coach, tutorLevel);
    if (!coach.speech && text) onSpeech?.(text);
    return text;
  });
}

/** Botão "Ouvir" do relatório: toca, mostra que está gerando e vira "Parar" enquanto fala. */
function VoiceButton({ coach, tutorLevel, onSpeech }: Omit<Props, "onMoveClick">) {
  const voice = useVoice();
  const [error, setError] = useState<string | null>(null);
  const key = coachVoiceKey(coach);
  const mine = voice.key === key;
  // ao sair do relatório (outra partida, tela fechada), a fala dele para
  useEffect(() => () => void (voiceState().key === key && stopVoice()), [key]);

  function toggle() {
    if (mine) return stopVoice();
    setError(null);
    speakCoach(coach, tutorLevel, onSpeech).catch((e) => setError(errorText(e)));
  }

  return (
    <button
      className={`voice-btn ${mine ? "on" : ""}`}
      onClick={toggle}
      title={error ? `Não consegui falar: ${error}` : mine ? "Parar a voz" : "Ouvir o resumo do treinador"}
    >
      {mine && voice.phase === "loading" ? <Loader2 size={14} className="spin" /> : mine ? <Square size={12} fill="currentColor" /> : <Volume2 size={15} />}
      <span>{mine && voice.phase === "loading" ? "Preparando…" : mine ? "Parar" : error ? "Tentar de novo" : "Ouvir"}</span>
    </button>
  );
}

/** Relatório do treinador: resumo, o que foi bem e onde errou (com lances clicáveis). */
export function CoachReport({ coach, onMoveClick, tutorLevel, onSpeech }: Props) {
  return (
    <>
      <CoachBubble>
        <div className="report-head">
          <VoiceButton coach={coach} tutorLevel={tutorLevel} onSpeech={onSpeech} />
          <strong>{coach.headline}</strong>
        </div>
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
