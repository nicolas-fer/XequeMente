import { evalText, winPct, type PositionEval } from "../lib/chess-utils";

interface Props {
  evaluation: Pick<PositionEval, "cp" | "mate" | "terminal"> | null;
  orientation: "white" | "black";
}

export function EvalBar({ evaluation, orientation }: Props) {
  const white = winPct(evaluation);
  const flipped = orientation === "black";
  const text = evaluation ? evalText(evaluation) : "";
  const whiteAhead = white >= 50;
  return (
    <div className={`eval-bar ${flipped ? "flipped" : ""}`} title="Avaliação do Stockfish (brancas embaixo)">
      <div className="eval-white" style={{ height: `${white}%` }} />
      {text && (
        <span className={`eval-label ${whiteAhead ? "on-white" : "on-black"}`}>{text.replace("+", "")}</span>
      )}
    </div>
  );
}
