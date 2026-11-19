import { useEffect, useRef } from "react";
import { CLASS_INFO, fullmoveOf, type MoveNode, type MoveReview } from "../lib/chess-utils";
import type { GameState } from "../lib/useGame";

interface Props {
  state: GameState;
  reviews: (MoveReview | null)[];
  onGoto: (inVar: boolean, ply: number) => void;
  onExitVariation: () => void;
  onPromoteVariation: () => void;
}

function MoveCell({ m, active, review, onClick }: { m: MoveNode; active: boolean; review?: MoveReview | null; onClick: () => void }) {
  const info = review ? CLASS_INFO[review.cls] : null;
  return (
    <button className={`move ${active ? "active" : ""}`} onClick={onClick} data-active={active || undefined} title={info?.label}>
      {info && (
        <span className="badge mini" style={{ background: info.color }}>
          {info.symbol}
        </span>
      )}
      {m.san}
    </button>
  );
}

export function MoveList({ state, reviews, onGoto, onExitVariation, onPromoteVariation }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { moves, cursor, variation } = state;

  useEffect(() => {
    const el = ref.current?.querySelector("[data-active]") as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const rows: { n: number; w?: number; b?: number }[] = [];
  moves.forEach((m, i) => {
    const n = fullmoveOf(m.fenBefore);
    if (m.color === "w" || rows.length === 0) rows.push({ n, [m.color]: i });
    else {
      const last = rows[rows.length - 1];
      if (last.b === undefined && last.n === n) last.b = i;
      else rows.push({ n, b: i });
    }
  });

  const result = state.headers.Result && state.headers.Result !== "*" ? state.headers.Result : null;

  return (
    <div className="move-card">
      <div className="card-title">Lances</div>
      <div className="move-list" ref={ref}>
        {moves.length === 0 && <div className="muted small">Faça lances no tabuleiro ou importe uma partida.</div>}
        {rows.map((r) => (
          <div className="move-row" key={`${r.n}-${r.w ?? "x"}-${r.b ?? "x"}`}>
            <span className="move-num">{r.n}.</span>
            {r.w !== undefined ? (
              <MoveCell m={moves[r.w]} review={reviews[r.w]} active={!cursor.inVar && cursor.ply === r.w + 1} onClick={() => onGoto(false, r.w! + 1)} />
            ) : (
              <span className="move placeholder">…</span>
            )}
            {r.b !== undefined && (
              <MoveCell m={moves[r.b]} review={reviews[r.b]} active={!cursor.inVar && cursor.ply === r.b + 1} onClick={() => onGoto(false, r.b! + 1)} />
            )}
          </div>
        ))}
        {result && <div className="result">{result}</div>}
      </div>
      {variation && (
        <div className="variation">
          <div className="variation-head">
            <span>Variante</span>
            <span className="spacer" />
            <button className="link" onClick={onPromoteVariation} title="Substitui a continuação da partida por esta variante">
              Tornar principal
            </button>
            <button className="link" onClick={onExitVariation}>
              Descartar
            </button>
          </div>
          <div className="variation-moves">
            {variation.moves.map((m, i) => {
              const n = fullmoveOf(m.fenBefore);
              const label = m.color === "w" ? `${n}.` : i === 0 ? `${n}...` : "";
              return (
                <span key={i}>
                  {label && <span className="move-num">{label}</span>}
                  <MoveCell m={m} active={cursor.inVar && cursor.ply === i + 1} onClick={() => onGoto(true, i + 1)} />
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
