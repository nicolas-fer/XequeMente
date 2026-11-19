import { useEffect, useMemo, useState } from "react";
import { Chessboard, defaultPieces } from "react-chessboard";
import {
  START_FEN,
  buildFen,
  fenToBoardMap,
  fullmoveOf,
  turnOf,
  validatePosition,
  type BoardMap,
  type Castling,
  type PieceCode,
} from "../lib/chess-utils";

export interface EditorRequest {
  key: number;
  fen: string;
  notes?: string[];
}

interface Props {
  request: EditorRequest | null;
  onAnalyze: (fen: string) => void;
}

type Tool = PieceCode | "erase" | null;

const WHITE: PieceCode[] = ["wK", "wQ", "wR", "wB", "wN", "wP"];
const BLACK: PieceCode[] = ["bK", "bQ", "bR", "bB", "bN", "bP"];

function castlingFromFen(fen: string): Castling {
  const c = fen.split(" ")[2] ?? "-";
  return { K: c.includes("K"), Q: c.includes("Q"), k: c.includes("k"), q: c.includes("q") };
}

function PieceIcon({ code }: { code: PieceCode }) {
  const Render = defaultPieces[code];
  return <span className="palette-piece">{Render ? <Render /> : code}</span>;
}

export function EditorView({ request, onAnalyze }: Props) {
  const [map, setMap] = useState<BoardMap>(() => fenToBoardMap(START_FEN));
  const [turn, setTurn] = useState<"w" | "b">("w");
  const [castling, setCastling] = useState<Castling>({ K: true, Q: true, k: true, q: true });
  const [fullmove, setFullmove] = useState(1);
  const [tool, setTool] = useState<Tool>(null);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [fenInput, setFenInput] = useState("");
  const [fenError, setFenError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  function loadFen(fen: string) {
    const parts = fen.trim().split(/\s+/);
    if (!parts[0] || parts[0].split("/").length !== 8) {
      setFenError("FEN inválido: a parte das peças precisa ter 8 fileiras separadas por '/'.");
      return false;
    }
    const full = [parts[0], parts[1] ?? "w", parts[2] ?? "-", parts[3] ?? "-", parts[4] ?? "0", parts[5] ?? "1"].join(" ");
    setMap(fenToBoardMap(full));
    setTurn(turnOf(full));
    setCastling(castlingFromFen(full));
    setFullmove(fullmoveOf(full));
    setFenError(null);
    return true;
  }

  useEffect(() => {
    if (request) {
      loadFen(request.fen);
      setNotes(request.notes ?? []);
    }
  }, [request?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const fen = useMemo(() => buildFen(map, turn, castling, "-", fullmove), [map, turn, castling, fullmove]);
  const errors = useMemo(() => validatePosition(fen), [fen]);

  useEffect(() => setFenInput(fen), [fen]);

  const position = useMemo(() => {
    const p: Record<string, { pieceType: string }> = {};
    for (const [sq, code] of Object.entries(map)) p[sq] = { pieceType: code };
    return p;
  }, [map]);

  function place(square: string) {
    if (!tool) return;
    setMap((m) => {
      const next = { ...m };
      if (tool === "erase" || next[square] === tool) delete next[square];
      else {
        // apenas um rei por cor
        if (tool === "wK" || tool === "bK") for (const s of Object.keys(next)) if (next[s] === tool) delete next[s];
        next[square] = tool;
      }
      return next;
    });
  }

  return (
    <div className="editor">
      <section className="editor-board">
        <div className="palette">
          {BLACK.map((p) => (
            <button key={p} className={tool === p ? "active" : ""} onClick={() => setTool(tool === p ? null : p)} title="Selecione e clique nas casas">
              <PieceIcon code={p} />
            </button>
          ))}
        </div>
        <div className="board-shell editor-shell">
          <Chessboard
            options={{
              id: "editor-board",
              position,
              boardOrientation: orientation,
              allowDragOffBoard: true,
              allowDrawingArrows: false,
              animationDurationInMs: 0,
              darkSquareStyle: { backgroundColor: "#739552" },
              lightSquareStyle: { backgroundColor: "#ebecd0" },
              onSquareClick: ({ square }) => place(square),
              onSquareRightClick: ({ square }) =>
                setMap((m) => {
                  const next = { ...m };
                  delete next[square];
                  return next;
                }),
              onPieceDrop: ({ sourceSquare, targetSquare }) => {
                setMap((m) => {
                  const next = { ...m };
                  const piece = next[sourceSquare];
                  delete next[sourceSquare];
                  if (targetSquare && piece) next[targetSquare] = piece;
                  return next;
                });
                return true;
              },
            }}
          />
        </div>
        <div className="palette">
          {WHITE.map((p) => (
            <button key={p} className={tool === p ? "active" : ""} onClick={() => setTool(tool === p ? null : p)} title="Selecione e clique nas casas">
              <PieceIcon code={p} />
            </button>
          ))}
          <button className={tool === "erase" ? "active" : ""} onClick={() => setTool(tool === "erase" ? null : "erase")} title="Borracha">
            🧽
          </button>
        </div>
        <p className="small muted">
          Escolha uma peça e clique nas casas para colocar (clicar de novo remove). Arraste para mover; arraste para fora
          do tabuleiro ou use o botão direito para apagar.
        </p>
      </section>

      <section className="panel editor-side">
        <div className="panel-title">Posição</div>
        {notes.length > 0 && (
          <div className="notice">
            <strong>Confira a leitura da imagem:</strong>
            <ul>
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="field">
          <span>Vez de jogar</span>
          <div className="seg">
            <button className={turn === "w" ? "active" : ""} onClick={() => setTurn("w")}>
              Brancas
            </button>
            <button className={turn === "b" ? "active" : ""} onClick={() => setTurn("b")}>
              Pretas
            </button>
          </div>
        </div>
        <div className="field">
          <span>Roques disponíveis</span>
          <div className="checks">
            {(
              [
                ["K", "Brancas O-O"],
                ["Q", "Brancas O-O-O"],
                ["k", "Pretas O-O"],
                ["q", "Pretas O-O-O"],
              ] as [keyof Castling, string][]
            ).map(([k, label]) => (
              <label key={k}>
                <input type="checkbox" checked={castling[k]} onChange={(e) => setCastling({ ...castling, [k]: e.target.checked })} /> {label}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Número do lance</span>
          <input type="number" min={1} value={fullmove} onChange={(e) => setFullmove(Math.max(1, Number(e.target.value) || 1))} />
        </div>
        <div className="row-buttons">
          <button onClick={() => loadFen(START_FEN)}>Posição inicial</button>
          <button onClick={() => setMap({})}>Limpar</button>
          <button onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}>⟲ Girar</button>
        </div>
        <div className="field">
          <span>FEN</span>
          <div className="fen-row">
            <input className="mono" value={fenInput} onChange={(e) => setFenInput(e.target.value)} spellCheck={false} />
            <button onClick={() => loadFen(fenInput)}>Carregar</button>
            <button onClick={() => navigator.clipboard.writeText(fen)} title="Copiar FEN">
              Copiar
            </button>
          </div>
          {fenError && <div className="error">{fenError}</div>}
        </div>
        {errors.length > 0 ? (
          <div className="error">
            {errors.map((e, i) => (
              <div key={i}>• {e}</div>
            ))}
          </div>
        ) : (
          <div className="ok">Posição válida.</div>
        )}
        <button className="primary big" disabled={errors.length > 0} onClick={() => onAnalyze(fen)}>
          Analisar esta posição
        </button>
      </section>
    </div>
  );
}
