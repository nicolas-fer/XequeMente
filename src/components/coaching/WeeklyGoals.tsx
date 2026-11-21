import { Flame, Target } from "lucide-react";
import type { ProfileData } from "../../lib/profile";
import { DEFAULT_GOALS, emptyCoaching, withWeekChecks, type CoachingGoals } from "../../lib/coaching";
import {
  addWeeks,
  checksFor,
  goalStatuses,
  measureWeek,
  planItems,
  weekComplete,
  weekStartOf,
  weekStreak,
  type GoalStatus,
  type WeekMeasure,
} from "../../lib/coaching-goals";
import "../../styles/coaching.css";

interface Props {
  profile: ProfileData;
  updateProfile: (fn: (p: ProfileData) => ProfileData) => void;
}

const HISTORY_WEEKS = 8;

const GOAL_FIELDS: { id: keyof CoachingGoals; label: string; step: number; min: number; max: number }[] = [
  { id: "drills", label: "Exercícios de treino por semana", step: 1, min: 0, max: 200 },
  { id: "games", label: "Partidas por semana", step: 1, min: 0, max: 50 },
  { id: "fastGames", label: "Partidas em Rápida ou Clássica", step: 1, min: 0, max: 50 },
  { id: "weakness", label: "Peças deixadas atacadas por partida (máximo)", step: 0.1, min: 0, max: 10 },
];

function fmtDay(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function fmtRate(v: number | null) {
  return v === null ? "—" : v.toFixed(1).replace(".", ",");
}

/** Progresso de 0 a 100 para a barra. Na fraqueza, quanto menor a média, melhor. */
function progressOf(g: GoalStatus): number {
  if (g.met) return 100;
  if (g.id === "weakness") {
    if (g.value === null) return 0;
    if (g.target === 0) return 0;
    return Math.min(100, (g.target / g.value) * 100);
  }
  if (!g.target) return 100;
  return Math.min(100, ((g.value ?? 0) / g.target) * 100);
}

function valueText(g: GoalStatus): string {
  if (g.id === "weakness") return `${fmtRate(g.value)} · meta até ${fmtRate(g.target)}`;
  return `${g.value ?? 0} de ${g.target}`;
}

function GoalRow({ goal, before }: { goal: GoalStatus; before: number | null }) {
  const trend =
    goal.id === "weakness" && goal.value !== null && before !== null
      ? goal.value < before
        ? `Melhorou (antes ${fmtRate(before)})`
        : goal.value > before
          ? `Piorou (antes ${fmtRate(before)})`
          : `Igual à média anterior (${fmtRate(before)})`
      : "";
  return (
    <div className={`goal-row ${goal.met ? "met" : ""}`}>
      <div className="goal-head">
        <span>{goal.label}</span>
        <span className="goal-value">
          {valueText(goal)}
          {goal.met && " ✓"}
        </span>
      </div>
      <div className="bar goal-bar">
        <div style={{ width: `${progressOf(goal)}%` }} />
      </div>
      {trend && <div className="goal-trend muted small">{trend}</div>}
    </div>
  );
}

export function WeeklyGoals({ profile, updateProfile }: Props) {
  const now = new Date();
  const goals = profile.coaching?.goals ?? DEFAULT_GOALS;
  const thisStart = weekStartOf(now);
  const thisWeek = measureWeek(profile, thisStart);
  const statuses = goalStatuses(thisWeek, goals);
  const streak = weekStreak(profile, goals, now);
  const items = planItems(profile);
  const checked = checksFor(profile.coaching, thisWeek.key, items);
  const doneCount = statuses.filter((s) => s.met).length;

  const history: { measure: WeekMeasure; complete: boolean }[] = [];
  for (let i = 0; i < HISTORY_WEEKS; i++) {
    const m = i === 0 ? thisWeek : measureWeek(profile, addWeeks(thisStart, -i));
    history.push({ measure: m, complete: weekComplete(m, goals) });
  }

  function toggleItem(title: string) {
    updateProfile((p) => {
      const base = p.coaching ?? emptyCoaching();
      const current = checksFor(base, thisWeek.key, items);
      const next = current.includes(title) ? current.filter((t) => t !== title) : [...current, title];
      return { ...p, coaching: withWeekChecks(base, thisWeek.key, next) };
    });
  }

  function setGoal(id: keyof CoachingGoals, raw: string) {
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value)) return;
    updateProfile((p) => {
      const base = p.coaching ?? emptyCoaching();
      return { ...p, coaching: { ...base, goals: { ...base.goals, [id]: Math.max(0, value) } } };
    });
  }

  return (
    <section className="panel coach-goals">
      <div className="panel-title">
        <Target size={18} /> Metas da semana
      </div>
      <p className="hint">
        Semana de {fmtDay(thisStart)} a {fmtDay(new Date(thisStart.getFullYear(), thisStart.getMonth(), thisStart.getDate() + 6))} (segunda a domingo). As metas são medidas pelas suas partidas e
        exercícios; você só marca os itens do plano de treino.
      </p>

      <div className="coach-goals-top">
        <span className="coach-streak">
          <Flame size={16} /> {streak > 0 ? `${streak} ${streak === 1 ? "semana seguida" : "semanas seguidas"} com todas as metas` : "Nenhuma sequência ainda"}
        </span>
        <span className="muted small">
          {doneCount} de {statuses.length} metas cumpridas nesta semana
        </span>
      </div>

      <div className="goal-list">
        {statuses.map((s) => (
          <GoalRow key={s.id} goal={s} before={s.id === "weakness" ? thisWeek.weaknessBefore : null} />
        ))}
      </div>

      {items.length > 0 && (
        <div className="plan-checks">
          <div className="card-title">Plano de treino desta semana</div>
          {(profile.coachAnalysis?.training_plan ?? [])
            .filter((t) => t.title)
            .map((t) => (
              <label key={t.title} className={`plan-check ${checked.includes(t.title) ? "done" : ""}`}>
                <input type="checkbox" checked={checked.includes(t.title)} onChange={() => toggleItem(t.title)} />
                <span>
                  <strong>{t.title}</strong>
                  {t.detail && <span className="muted small"> · {t.detail}</span>}
                </span>
              </label>
            ))}
          <div className="muted small">
            {checked.length} de {items.length} itens marcados
          </div>
        </div>
      )}

      <div className="coach-history">
        <div className="card-title">Últimas semanas</div>
        <div className="coach-weeks">
          {[...history].reverse().map(({ measure: m, complete }) => {
            const active = m.games > 0 || m.drills > 0;
            const cls = complete ? "done" : active ? "partial" : "empty";
            return (
              <div
                key={m.key}
                className={`coach-week ${cls}`}
                title={`${fmtDay(m.start)}: ${m.games} partidas, ${m.drills} exercícios${complete ? ", metas cumpridas" : ""}`}
              >
                <span className="coach-week-dot" />
                <span className="coach-week-label">{fmtDay(m.start)}</span>
                <span className="muted small">
                  {m.games}p · {m.drills}ex
                </span>
              </div>
            );
          })}
        </div>
        <div className="muted small">Verde: metas cumpridas · dourado: semana com atividade · cinza: sem atividade.</div>
      </div>

      <details className="coach-goals-edit">
        <summary>Ajustar metas</summary>
        <div className="coach-goal-fields">
          {GOAL_FIELDS.map((f) => (
            <label key={f.id} className="coach-goal-field">
              <span>{f.label}</span>
              <input
                type="number"
                inputMode="decimal"
                min={f.min}
                max={f.max}
                step={f.step}
                value={goals[f.id]}
                onChange={(e) => setGoal(f.id, e.target.value)}
              />
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}
