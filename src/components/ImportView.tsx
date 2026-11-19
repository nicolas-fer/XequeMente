import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { api, errorText, type BoardRead } from "../lib/api";
import { START_FEN, boardReadToFen, validatePosition, type MoveNode } from "../lib/chess-utils";

interface Props {
  active: boolean;
  aiConfigured: boolean;
  onLoadGame: (startFen: string, moves: MoveNode[], headers: Record<string, string>) => void;
  onAnalyzeFen: (fen: string) => void;
  onEditFen: (fen: string, notes?: string[]) => void;
}

interface ParsedGame {
  label: string;
  startFen: string;
  moves: MoveNode[];
  headers: Record<string, string>;
}

function splitPgn(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const parts = normalized.split(/\n\s*\n(?=\[Event\s)/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parsePgn(pgn: string): ParsedGame {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const headers = chess.getHeaders();
  const history = chess.history({ verbose: true });
  const startFen = history.length ? history[0].before : headers.FEN || START_FEN;
  const moves: MoveNode[] = history.map((m) => ({
    san: m.san,
    uci: m.from + m.to + (m.promotion ?? ""),
    from: m.from,
    to: m.to,
    promotion: m.promotion,
    color: m.color,
    fenBefore: m.before,
    fenAfter: m.after,
  }));
  const label = `${headers.White ?? "?"} x ${headers.Black ?? "?"}${headers.Date && !headers.Date.includes("?") ? ` (${headers.Date})` : ""} — ${moves.length} lances`;
  return { label, startFen, moves, headers };
}

/** Reduz a imagem (lado maior até 1568px) e devolve base64 sem prefixo. */
async function prepareImage(file: Blob): Promise<{ data: string; mediaType: string; preview: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Não consegui ler a imagem."));
      i.src = url;
    });
    const scale = Math.min(1, 1568 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL("image/png");
    let mediaType = "image/png";
    if (dataUrl.length > 4_500_000) {
      dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      mediaType = "image/jpeg";
    }
    return { data: dataUrl.split(",")[1], mediaType, preview: dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ImportView({ active, aiConfigured, onLoadGame, onAnalyzeFen, onEditFen }: Props) {
  const [pgnText, setPgnText] = useState("");
  const [games, setGames] = useState<ParsedGame[]>([]);
  const [pgnError, setPgnError] = useState<string | null>(null);
  const [fen, setFen] = useState("");
  const [fenErrors, setFenErrors] = useState<string[]>([]);
  const [image, setImage] = useState<{ data: string; mediaType: string; preview: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [read, setRead] = useState<{ raw: BoardRead; fen: string; warnings: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  async function acceptImage(file: Blob | null) {
    if (!file) return;
    setRead(null);
    setReadError(null);
    try {
      setImage(await prepareImage(file));
    } catch (e) {
      setReadError(errorText(e));
    }
  }

  // Colar print com Ctrl+V enquanto a aba está aberta.
  useEffect(() => {
    if (!active) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (item) {
        e.preventDefault();
        acceptImage(item.getAsFile());
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [active]);

  function handlePgn(text: string) {
    setPgnError(null);
    setGames([]);
    const chunks = splitPgn(text);
    if (!chunks.length) {
      setPgnError("Cole um PGN ou abra um arquivo .pgn.");
      return;
    }
    const parsed: ParsedGame[] = [];
    const failures: string[] = [];
    chunks.forEach((c, i) => {
      try {
        parsed.push(parsePgn(c));
      } catch (e) {
        failures.push(`Partida ${i + 1}: ${errorText(e)}`);
      }
    });
    if (!parsed.length) {
      setPgnError(`Não consegui ler o PGN. ${failures[0] ?? ""}`);
      return;
    }
    if (parsed.length === 1) {
      const g = parsed[0];
      onLoadGame(g.startFen, g.moves, g.headers);
      return;
    }
    setGames(parsed);
    if (failures.length) setPgnError(`${failures.length} partida(s) ignoradas por erro.`);
  }

  function checkFen(f: string) {
    const parts = f.trim().split(/\s+/);
    const full = [parts[0] ?? "", parts[1] ?? "w", parts[2] ?? "-", parts[3] ?? "-", parts[4] ?? "0", parts[5] ?? "1"].join(" ");
    const errs = validatePosition(full);
    setFenErrors(errs);
    return { full, ok: errs.length === 0 };
  }

  async function readImage() {
    if (!image) return;
    setReading(true);
    setReadError(null);
    setRead(null);
    try {
      const raw = await api.imageToBoard(image.data, image.mediaType);
      if (!raw.boardFound) {
        setReadError("O modelo não encontrou um tabuleiro na imagem.");
        return;
      }
      const { fen: f, warnings } = boardReadToFen(raw);
      setRead({ raw, fen: f, warnings: raw.notes ? [raw.notes, ...warnings] : warnings });
    } catch (e) {
      setReadError(errorText(e));
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="import">
      <section className="panel">
        <div className="panel-title">PGN</div>
        <textarea
          className="mono pgn-input"
          placeholder={'[Event "..."]\n\n1. e4 e5 2. Nf3 Nc6 ...'}
          value={pgnText}
          onChange={(e) => setPgnText(e.target.value)}
          spellCheck={false}
        />
        <div className="row-buttons">
          <button className="primary" onClick={() => handlePgn(pgnText)}>
            Carregar PGN
          </button>
          <button onClick={() => fileRef.current?.click()}>Abrir arquivo .pgn</button>
          <input
            ref={fileRef}
            type="file"
            accept=".pgn,.txt"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const text = await f.text();
              setPgnText(text);
              handlePgn(text);
            }}
          />
        </div>
        {pgnError && <div className="error">{pgnError}</div>}
        {games.length > 1 && (
          <div className="game-pick">
            <div className="small muted">O arquivo tem {games.length} partidas. Escolha uma:</div>
            {games.map((g, i) => (
              <button key={i} className="game-item" onClick={() => onLoadGame(g.startFen, g.moves, g.headers)}>
                {i + 1}. {g.label}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">FEN</div>
        <input
          className="mono"
          placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
          value={fen}
          onChange={(e) => {
            setFen(e.target.value);
            setFenErrors([]);
          }}
          spellCheck={false}
        />
        <div className="row-buttons">
          <button
            className="primary"
            onClick={() => {
              const r = checkFen(fen);
              if (r.ok) onAnalyzeFen(r.full);
            }}
          >
            Analisar
          </button>
          <button onClick={() => onEditFen(checkFen(fen).full)}>Abrir no editor</button>
        </div>
        {fenErrors.length > 0 && (
          <div className="error">
            {fenErrors.map((e, i) => (
              <div key={i}>• {e}</div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">Print / foto do tabuleiro</div>
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            acceptImage(e.dataTransfer.files?.[0] ?? null);
          }}
          onClick={() => imgRef.current?.click()}
        >
          {image ? (
            <img src={image.preview} alt="Imagem do tabuleiro" />
          ) : (
            <span className="muted">Cole com Ctrl+V, arraste uma imagem aqui ou clique para escolher.</span>
          )}
        </div>
        <input
          ref={imgRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            acceptImage(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <div className="row-buttons">
          <button className="primary" disabled={!image || reading || !aiConfigured} onClick={readImage}>
            {reading ? "Lendo a imagem…" : "Converter para FEN com IA"}
          </button>
          {image && (
            <button
              onClick={() => {
                setImage(null);
                setRead(null);
              }}
            >
              Remover
            </button>
          )}
        </div>
        {!aiConfigured && <div className="notice">Configure uma chave de API para usar a leitura de imagem.</div>}
        {readError && <div className="error">{readError}</div>}
        {read && (
          <div className="read-result">
            <div className="mono small">{read.fen}</div>
            {read.warnings.length > 0 && (
              <ul className="small">
                {read.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <div className="small muted">
              A leitura por IA pode errar uma ou outra casa. Revise no editor antes de analisar.
            </div>
            <div className="row-buttons">
              <button className="primary" onClick={() => onEditFen(read.fen, read.warnings)}>
                Revisar no editor
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
