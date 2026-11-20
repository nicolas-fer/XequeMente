/** Peças compartilhadas pelos tabuleiros: setas, anotações com botão direito e bolinhas de lances legais. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import type { Arrow } from "react-chessboard";
import type { Chess, Square } from "chess.js";

export type Orientation = "white" | "black";

/** Cores das anotações (como no chess.com): padrão, Shift, Ctrl e Alt. */
export const ANNOTATION_COLORS = {
  default: { arrow: "rgba(255, 170, 0, 0.82)", mark: "rgba(235, 97, 80, 0.8)" },
  shift: { arrow: "rgba(159, 207, 63, 0.82)", mark: "rgba(172, 206, 89, 0.8)" },
  ctrl: { arrow: "rgba(240, 80, 60, 0.85)", mark: "rgba(235, 97, 80, 0.8)" },
  alt: { arrow: "rgba(72, 148, 222, 0.85)", mark: "rgba(82, 176, 220, 0.8)" },
};

function colorKey(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): keyof typeof ANNOTATION_COLORS {
  if (e.altKey) return "alt";
  if (e.ctrlKey || e.metaKey) return "ctrl";
  if (e.shiftKey) return "shift";
  return "default";
}

function squareAt(e: MouseEvent<HTMLElement>, orientation: Orientation): string | null {
  const r = e.currentTarget.getBoundingClientRect();
  const fx = Math.floor(((e.clientX - r.left) / r.width) * 8);
  const fy = Math.floor(((e.clientY - r.top) / r.height) * 8);
  if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return null;
  const file = orientation === "white" ? fx : 7 - fx;
  const rank = orientation === "white" ? 7 - fy : fy;
  return `${"abcdefgh"[file]}${rank + 1}`;
}

/**
 * Mede a área livre da coluna do tabuleiro e devolve o maior tamanho que cabe (múltiplo de 8, para casas nítidas).
 * `reserveW`/`reserveH` = espaço dos elementos ao redor (barra de avaliação, barras dos jogadores, botões).
 */
export function useBoardFit(reserveW: number, reserveH: number, max = 1600) {
  // ref por callback: mede também quando a coluna só aparece depois (ex.: ao começar uma partida)
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState(480);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      if (!el.clientWidth || !el.clientHeight) return; // aba escondida
      const s = Math.min(el.clientWidth - reserveW, el.clientHeight - reserveH, max);
      setSize(Math.max(256, Math.floor(s / 8) * 8));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, reserveW, reserveH, max]);
  return { ref: setEl, style: { "--board": `${size}px` } as CSSProperties, size };
}

/** Setas e casas marcadas pelo usuário com o botão direito. Limpa a cada mudança de posição. */
export function useAnnotations(fen: string, orientation: Orientation) {
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [drawing, setDrawing] = useState<{ from: string; to: string; color: keyof typeof ANNOTATION_COLORS } | null>(null);
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;

  useEffect(() => {
    setArrows([]);
    setMarks({});
    setDrawing(null);
  }, [fen]);

  const clear = () => {
    setArrows([]);
    setMarks({});
  };

  const handlers = {
    onContextMenu: (e: MouseEvent<HTMLElement>) => e.preventDefault(),
    onMouseDownCapture: (e: MouseEvent<HTMLElement>) => {
      if (e.button === 2) {
        const sq = squareAt(e, orientation);
        if (sq) setDrawing({ from: sq, to: sq, color: colorKey(e) });
        e.preventDefault();
      } else if (e.button === 0) {
        clear();
      }
    },
    onMouseMoveCapture: (e: MouseEvent<HTMLElement>) => {
      const d = drawingRef.current;
      if (!d) return;
      const sq = squareAt(e, orientation);
      if (sq && sq !== d.to) setDrawing({ ...d, to: sq });
    },
    onMouseUpCapture: (e: MouseEvent<HTMLElement>) => {
      const d = drawingRef.current;
      if (e.button !== 2 || !d) return;
      setDrawing(null);
      const to = squareAt(e, orientation) ?? d.to;
      if (to === d.from) {
        const color = ANNOTATION_COLORS[d.color].mark;
        setMarks((m) => {
          const next = { ...m };
          if (next[to] === color) delete next[to];
          else next[to] = color;
          return next;
        });
      } else {
        const color = ANNOTATION_COLORS[d.color].arrow;
        setArrows((list) => {
          const same = list.find((a) => a.startSquare === d.from && a.endSquare === to);
          const rest = list.filter((a) => !(a.startSquare === d.from && a.endSquare === to));
          return same && same.color === color ? rest : [...rest, { startSquare: d.from, endSquare: to, color }];
        });
      }
    },
    onMouseLeave: () => setDrawing(null),
  };

  const preview: Arrow | null =
    drawing && drawing.to !== drawing.from
      ? { startSquare: drawing.from, endSquare: drawing.to, color: ANNOTATION_COLORS[drawing.color].arrow }
      : null;

  const markStyles: Record<string, CSSProperties> = {};
  for (const [sq, color] of Object.entries(marks)) markStyles[sq] = { background: color };
  if (drawing && drawing.to === drawing.from) markStyles[drawing.from] = { background: ANNOTATION_COLORS[drawing.color].mark };

  return { arrows: preview ? [...arrows, preview] : arrows, markStyles, handlers, clear };
}

/** Bolinhas (casa vazia) e anéis (captura) nas casas para onde a peça pode ir. */
export function legalTargetStyles(chess: Chess | null, from: string | null): Record<string, CSSProperties> {
  const out: Record<string, CSSProperties> = {};
  if (!chess || !from) return out;
  for (const m of chess.moves({ square: from as Square, verbose: true })) {
    const occupied = !!chess.get(m.to as Square) || m.flags.includes("e");
    out[m.to] = {
      backgroundImage: occupied
        ? "radial-gradient(circle, transparent 0, transparent 79%, rgba(0, 0, 0, 0.16) 80%)"
        : "radial-gradient(circle, rgba(0, 0, 0, 0.16) 0, rgba(0, 0, 0, 0.16) 27%, transparent 28%)",
    };
  }
  return out;
}

/** Junta estilos de casas sem perder o fundo de uma camada anterior. */
export function mergeSquareStyles(...layers: Record<string, CSSProperties>[]): Record<string, CSSProperties> {
  const out: Record<string, CSSProperties> = {};
  for (const layer of layers) for (const [sq, st] of Object.entries(layer)) out[sq] = { ...(out[sq] ?? {}), ...st };
  return out;
}

/** Desenha setas sobre o tabuleiro. Lances de cavalo saem em L, como no chess.com. */
export function ArrowLayer({ arrows, orientation }: { arrows: Arrow[]; orientation: Orientation }) {
  const center = (sq: string) => {
    const f = sq.charCodeAt(0) - 97;
    const r = parseInt(sq[1], 10) - 1;
    const x = orientation === "white" ? f : 7 - f;
    const y = orientation === "white" ? 7 - r : r;
    return { x: x * 100 + 50, y: y * 100 + 50 };
  };
  const width = 20;
  const head = 40;
  const headHalf = 30;
  return (
    <svg className="arrow-layer" viewBox="0 0 800 800">
      {arrows.map((a) => {
        const from = center(a.startSquare);
        const to = center(a.endSquare);
        const dxs = Math.abs(to.x - from.x) / 100;
        const dys = Math.abs(to.y - from.y) / 100;
        const knight = (dxs === 1 && dys === 2) || (dxs === 2 && dys === 1);
        // No L do cavalo, anda primeiro na direção mais longa.
        const corner = knight ? (dys === 2 ? { x: from.x, y: to.y } : { x: to.x, y: from.y }) : null;
        const lastFrom = corner ?? from;
        const dx = to.x - lastFrom.x;
        const dy = to.y - lastFrom.y;
        const len = Math.hypot(dx, dy);
        if (!len) return null;
        const ux = dx / len;
        const uy = dy / len;
        const tipX = to.x - ux * 8;
        const tipY = to.y - uy * 8;
        const baseX = tipX - ux * head;
        const baseY = tipY - uy * head;
        const px = -uy * headHalf;
        const py = ux * headHalf;
        const startOffset = corner ? 0 : 22;
        const sx0 = from.x + (corner ? 0 : ux * startOffset);
        const sy0 = from.y + (corner ? 0 : uy * startOffset);
        let d: string;
        if (corner) {
          const c0x = corner.x - from.x;
          const c0y = corner.y - from.y;
          const l0 = Math.hypot(c0x, c0y);
          const sx = from.x + (c0x / l0) * 22;
          const sy = from.y + (c0y / l0) * 22;
          d = `M ${sx} ${sy} L ${corner.x} ${corner.y} L ${baseX} ${baseY}`;
        } else {
          d = `M ${sx0} ${sy0} L ${baseX} ${baseY}`;
        }
        return (
          <g key={`${a.startSquare}${a.endSquare}${a.color}`}>
            <path d={d} fill="none" stroke={a.color} strokeWidth={width} strokeLinejoin="miter" strokeLinecap="butt" />
            <polygon points={`${tipX},${tipY} ${baseX + px},${baseY + py} ${baseX - px},${baseY - py}`} fill={a.color} />
          </g>
        );
      })}
    </svg>
  );
}
