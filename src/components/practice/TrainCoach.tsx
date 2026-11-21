import { CoachBubble } from "../TutorChat";
import type { ThreatInfo, TrainWarning } from "../../lib/practice";
import "../../styles/practice.css";

/** Selo "Modo treino" (tela de jogo e lista de partidas). */
export function TrainTag() {
  return <span className="train-tag">Modo treino</span>;
}

/** Aviso antes de o bot responder: o aluno decide entre voltar o lance e seguir. */
export function TrainWarningCard({
  warning,
  onTakeback,
  onContinue,
}: {
  warning: TrainWarning;
  onTakeback: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="train-card warning">
      <CoachBubble>{warning.text}</CoachBubble>
      <div className="row-buttons equal">
        <button className="btn-primary" onClick={onTakeback}>
          Voltar o lance
        </button>
        <button className="btn-2 labeled" onClick={onContinue}>
          Jogar assim mesmo
        </button>
      </div>
    </div>
  );
}

/** Lembrete discreto depois de um lance do bot que cria uma ameaça. */
export function ThreatReminder({ threat, revealed, onReveal }: { threat: ThreatInfo; revealed: boolean; onReveal: () => void }) {
  return (
    <div className="train-card threat">
      <div className="train-question">Antes de jogar: o que o último lance dele ameaça?</div>
      {revealed ? (
        <div className="train-reveal">{threat.text}</div>
      ) : (
        <button className="btn-2" onClick={onReveal}>
          Mostrar
        </button>
      )}
    </div>
  );
}
