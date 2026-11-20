import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Chessboard, type Arrow } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import { squareOfKingInCheck } from "../lib/chess-utils";
import { ArrowLayer, legalTargetStyles, mergeSquareStyles, useAnnotations } from "./boardKit";

interface Props {
  fen: string;
  orientation: "white" | "black";
  onMove: (from: string, to: string, promotion?: string) => boolean;
  arrows?: Arrow[];
  lastMove?: { from: string; to: string } | null;
  /** lance destacado ao passar o mouse numa linha do motor */
  previewMove?: { from: string; to: string } | null;
  interactive?: boolean;
}

const PROMO = [
  { p: "q", label: "Dama" },
  { p: "r", label: "Torre" },
  { p: "b", label: "Bispo" },
  { p: "n", label: "Cavalo" },
];
const GLYPH: Record<string, [string, string]> = { q: ["♕", "♛"], r: ["♖", "♜"], b: ["♗", "♝"], n: ["♘", "♞"] };

export function BoardView({ fen, orientation, onMove, arrows = [], lastMove, previewMove, interactive = true }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string; color: "w" | "b" } | null>(null);
  const notes = useAnnotations(fen, orientation);

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  }, [fen]);

  useEffect(() => {
    setSelected(null);
    setDragFrom(null);
    setPromo(null);
  }, [fen]);

  function tryMove(from: string, to: string): boolean {
    if (!chess || !interactive) return false;
    const legal = chess.moves({ square: from as Square, verbose: true }).filter((m) => m.to === to);
    if (!legal.length) return false;
    if (legal.some((m) => m.promotion)) {
      setPromo({ from, to, color: chess.turn() });
      return false;
    }
    return onMove(from, to);
  }

  const base: Record<string, CSSProperties> = {};
  if (lastMove) {
    base[lastMove.from] = { background: "rgba(255, 255, 51, 0.42)" };
    base[lastMove.to] = { background: "rgba(255, 255, 51, 0.5)" };
  }
  if (previewMove) {
    base[previewMove.from] = { background: "rgba(72, 148, 222, 0.45)" };
    base[previewMove.to] = { background: "rgba(72, 148, 222, 0.6)" };
  }
  const check = squareOfKingInCheck(fen);
  if (check) base[check] = { background: "radial-gradient(circle, rgba(235,87,87,0.9) 0%, rgba(235,87,87,0.35) 55%, transparent 75%)" };
  const source = dragFrom ?? selected;
  if (source) base[source] = { background: "rgba(255, 255, 51, 0.5)" };
  const squareStyles = mergeSquareStyles(base, notes.markStyles, interactive ? legalTargetStyles(chess, source) : {});

  return (
    <div className="board-shell" {...notes.handlers}>
      <Chessboard
        options={{
          id: "analysis-board",
          position: fen,
          boardOrientation: orientation,
          squareStyles,
          allowDragging: interactive,
          animationDurationInMs: 180,
          allowDrawingArrows: false,
          darkSquareStyle: { backgroundColor: "#739552" },
          lightSquareStyle: { backgroundColor: "#ebecd0" },
          canDragPiece: ({ piece }) => !!chess && piece.pieceType[0] === chess.turn(),
          onPieceDrag: ({ square }) => setDragFrom(square),
          onPieceDragCancel: () => setDragFrom(null),
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            setDragFrom(null);
            setSelected(null);
            if (!targetSquare) return false;
            return tryMove(sourceSquare, targetSquare);
          },
          onSquareClick: ({ square, piece }) => {
            if (!chess || !interactive) return;
            if (selected && selected !== square && tryMove(selected, square)) {
              setSelected(null);
              return;
            }
            if (promo) return;
            if (piece && piece.pieceType[0] === chess.turn()) setSelected(square === selected ? null : square);
            else setSelected(null);
          },
        }}
      />
      <ArrowLayer arrows={[...arrows, ...notes.arrows]} orientation={orientation} />
      {promo && (
        <div className="promo-overlay" onClick={() => setPromo(null)}>
          <div className="promo-box" onClick={(e) => e.stopPropagation()}>
            <div className="promo-title">Promover para:</div>
            <div className="promo-options">
              {PROMO.map(({ p, label }) => (
                <button
                  key={p}
                  title={label}
                  onClick={() => {
                    const { from, to } = promo;
                    setPromo(null);
                    setSelected(null);
                    onMove(from, to, p);
                  }}
                >
                  {GLYPH[p][promo.color === "w" ? 0 : 1]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
