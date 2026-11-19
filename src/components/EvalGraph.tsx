import { CLASS_INFO, winPct, type MoveReview, type PositionEval } from "../lib/chess-utils";

interface Props {
  evals: (PositionEval | null)[];
  reviews: (MoveReview | null)[];
  currentPly: number | null;
  onSelect: (ply: number) => void;
}

export function EvalGraph({ evals, reviews, currentPly, onSelect }: Props) {
  const n = evals.length;
  if (n < 2) return null;
  const W = 600;
  const H = 90;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (i: number) => H - (winPct(evals[i]) / 100) * H;
  const pts = evals.map((_, i) => `${x(i).toFixed(1)},${y(i).toFixed(1)}`).join(" ");
  const area = `0,${H} ${pts} ${W},${H}`;

  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const ply = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
        onSelect(Math.max(0, Math.min(n - 1, ply)));
      }}
    >
      <rect x="0" y="0" width={W} height={H} className="graph-bg" />
      <polygon points={area} className="graph-white" />
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="graph-mid" />
      {currentPly !== null && <line x1={x(currentPly)} x2={x(currentPly)} y1="0" y2={H} className="graph-cursor" />}
      {reviews.map((r, i) =>
        r && (r.cls === "blunder" || r.cls === "mistake") ? (
          <circle key={i} cx={x(i + 1)} cy={y(i + 1)} r="3.5" fill={CLASS_INFO[r.cls].color} vectorEffect="non-scaling-stroke" />
        ) : null,
      )}
    </svg>
  );
}
