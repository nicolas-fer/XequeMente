import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Chessboard, type Arrow } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import { squareOfKingInCheck } from "../lib/chess-utils";

interface Props {
  fen: string;
  orientation: "white" | "black";
  onMove: (from: string, to: string, promotion?: string) => boolean;
  arrows?: Arrow[];
  lastMove?: { from: string; to: string } | null;
  interactive?: boolean;
}

const PROMO = [
  { p: "q", label: "Dama" },
  { p: "r", label: "Torre" },
  { p: "b", label: "Bispo" },
  { p: "n", label: "Cavalo" },
];
const GLYPH: Record<string, [string, string]> = { q: ["♕", "♛"], r: ["♖", "♜"], b: ["♗", "♝"], n: ["♘", "♞"] };

/** Camada própria de setas (a do react-chessboard deixa setas antigas na tela). */
function ArrowLayer({ arrows, orientation }: { arrows: Arrow[]; orientation: "white" | "black" }) {
  const center = (sq: string) => {
    const f = sq.charCodeAt(0) - 97;
    const r = parseInt(sq[1], 10) - 1;
    const x = orientation === "white" ? f : 7 - f;
    const y = orientation === "white" ? 7 - r : r;
    return { x: x * 100 + 50, y: y * 100 + 50 };
  };
  return (
    <svg className="arrow-layer" viewBox="0 0 800 800">
      {arrows.map((a) => {
        const from = center(a.startSquare);
        const to = center(a.endSquare);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy);
        if (!len) return null;
        const ux = dx / len;
        const uy = dy / len;
        const head = 34;
        const tipX = to.x - ux * 12;
        const tipY = to.y - uy * 12;
        const baseX = tipX - ux * head;
        const baseY = tipY - uy * head;
        const px = -uy * 24;
        const py = ux * 24;
        return (
          <g key={`${a.startSquare}${a.endSquare}${a.color}`} fill={a.color} stroke={a.color}>
            <line x1={from.x + ux * 18} y1={from.y + uy * 18} x2={baseX} y2={baseY} strokeWidth={16} strokeLinecap="round" />
            <polygon points={`${tipX},${tipY} ${baseX + px},${baseY + py} ${baseX - px},${baseY - py}`} stroke="none" />
          </g>
        );
      })}
    </svg>
  );
}

export function BoardView({ fen, orientation, onMove, arrows = [], lastMove, interactive = true }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string; color: "w" | "b" } | null>(null);

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  }, [fen]);

  useEffect(() => {
    setSelected(null);
    setPromo(null);
  }, [fen]);

  const targets = useMemo(() => {
    if (!chess || !selected) return [] as string[];
    return chess.moves({ square: selected as Square, verbose: true }).map((m) => m.to as string);
  }, [chess, selected]);

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

  const squareStyles: Record<string, CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.from] = { background: "rgba(255, 255, 51, 0.42)" };
    squareStyles[lastMove.to] = { background: "rgba(255, 255, 51, 0.5)" };
  }
  const check = squareOfKingInCheck(fen);
  if (check) squareStyles[check] = { background: "radial-gradient(circle, rgba(235,87,87,0.9) 0%, rgba(235,87,87,0.35) 55%, transparent 75%)" };
  if (selected) squareStyles[selected] = { ...(squareStyles[selected] ?? {}), background: "rgba(255, 255, 51, 0.5)" };
  for (const t of targets) {
    const occupied = chess?.get(t as Square);
    squareStyles[t] = {
      ...(squareStyles[t] ?? {}),
      backgroundImage: occupied
        ? "radial-gradient(circle, transparent 58%, rgba(0,0,0,0.16) 60%)"
        : "radial-gradient(circle, rgba(0,0,0,0.16) 18%, transparent 20%)",
    };
  }

  return (
    <div className="board-shell">
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
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
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
      <ArrowLayer arrows={arrows} orientation={orientation} />
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
