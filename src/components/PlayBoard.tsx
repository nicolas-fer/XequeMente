import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import { squareOfKingInCheck } from "../lib/chess-utils";
import { ArrowLayer, legalTargetStyles, mergeSquareStyles, useAnnotations } from "./boardKit";

export interface Premove {
  from: string;
  to: string;
  promotion?: string;
}

interface Props {
  fen: string;
  playerColor: "w" | "b";
  active: boolean;
  lastMove: { from: string; to: string } | null;
  premove: Premove | null;
  onMove: (from: string, to: string, promotion?: string) => boolean;
  onPremove: (p: Premove | null) => void;
  /** casas de ameaça do bot (modo treino) */
  threatSquares?: string[];
  /** casas da dica do melhor lance (modo treino) */
  hintSquares?: string[];
}

const GLYPH: Record<string, [string, string]> = { q: ["♕", "♛"], r: ["♖", "♜"], b: ["♗", "♝"], n: ["♘", "♞"] };

export function PlayBoard({ fen, playerColor, active, lastMove, premove, onMove, onPremove, threatSquares, hintSquares }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const orientation = playerColor === "w" ? "white" : "black";
  const notes = useAnnotations(fen, orientation);

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  }, [fen]);
  const myTurn = !!chess && chess.turn() === playerColor;

  useEffect(() => {
    if (myTurn) setSelected(null);
  }, [fen, myTurn]);


  // Estado mais recente para os handlers: um arraste começado na vez do adversário
  // pode terminar depois que ele jogou, e aí o lance é normal (não pré-lance).
  const live = useRef({ chess, myTurn, active });
  live.current = { chess, myTurn, active };

  const isOwn = (pieceType: string) => pieceType[0] === playerColor;
  const isPawnToLastRank = (from: string, to: string) => {
    const p = live.current.chess?.get(from as Square);
    return !!p && p.type === "p" && (to[1] === "8" || to[1] === "1");
  };

  function attempt(from: string, to: string): boolean {
    const { chess, myTurn, active } = live.current;
    if (!chess || !active || from === to) return false;
    if (!myTurn) {
      // Pré-lance: guarda e executa quando o adversário jogar.
      onPremove({ from, to, promotion: isPawnToLastRank(from, to) ? "q" : undefined });
      return false;
    }
    const legal = chess.moves({ square: from as Square, verbose: true }).filter((m) => m.to === to);
    if (!legal.length) return false;
    if (legal.some((m) => m.promotion)) {
      setPromo({ from, to });
      return false;
    }
    return onMove(from, to);
  }

  const styles: Record<string, CSSProperties> = {};
  if (lastMove) {
    styles[lastMove.from] = { background: "rgba(255, 255, 51, 0.42)" };
    styles[lastMove.to] = { background: "rgba(255, 255, 51, 0.5)" };
  }
  const check = squareOfKingInCheck(fen);
  if (check) styles[check] = { background: "radial-gradient(circle, rgba(235,87,87,0.9) 0%, rgba(235,87,87,0.35) 55%, transparent 75%)" };
  for (const s of threatSquares ?? []) styles[s] = { background: "rgba(214, 79, 64, 0.6)" };
  for (const s of hintSquares ?? []) styles[s] = { background: "rgba(80, 150, 230, 0.6)" };
  if (premove) {
    styles[premove.from] = { background: "rgba(214, 79, 64, 0.65)" };
    styles[premove.to] = { background: "rgba(214, 79, 64, 0.8)" };
  }
  const source = dragFrom ?? selected;
  if (source) styles[source] = { ...(styles[source] ?? {}), background: myTurn ? "rgba(255, 255, 51, 0.5)" : "rgba(214, 79, 64, 0.45)" };
  const squareStyles = mergeSquareStyles(styles, notes.markStyles, myTurn && active ? legalTargetStyles(chess, source) : {});

  return (
    <div className="board-shell" {...notes.handlers}>
      <Chessboard
        options={{
          id: "play-board",
          position: fen,
          boardOrientation: orientation,
          squareStyles,
          allowDragging: active,
          allowDrawingArrows: false,
          animationDurationInMs: 160,
          darkSquareStyle: { backgroundColor: "#739552" },
          lightSquareStyle: { backgroundColor: "#ebecd0" },
          canDragPiece: ({ piece }) => active && isOwn(piece.pieceType),
          onPieceDrag: ({ square }) => setDragFrom(square),
          onPieceDragCancel: () => setDragFrom(null),
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            setDragFrom(null);
            setSelected(null);
            if (!targetSquare) return false;
            return attempt(sourceSquare, targetSquare);
          },
          onSquareClick: ({ square, piece }) => {
            if (!active || promo) return;
            if (selected && selected !== square && (!piece || !isOwn(piece.pieceType))) {
              attempt(selected, square);
              setSelected(null);
              return;
            }
            if (piece && isOwn(piece.pieceType)) setSelected(square === selected ? null : square);
            else setSelected(null);
          },
          onSquareRightClick: () => {
            setSelected(null);
            onPremove(null);
          },
        }}
      />
      <ArrowLayer arrows={notes.arrows} orientation={orientation} />
      {promo && (
        <div className="promo-overlay" onClick={() => setPromo(null)}>
          <div className="promo-box" onClick={(e) => e.stopPropagation()}>
            <div className="promo-title">Promover para:</div>
            <div className="promo-options">
              {(["q", "r", "b", "n"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    const { from, to } = promo;
                    setPromo(null);
                    onMove(from, to, p);
                  }}
                >
                  {GLYPH[p][playerColor === "w" ? 0 : 1]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
