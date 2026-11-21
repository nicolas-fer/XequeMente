import { useMemo, useState, type ReactNode } from "react";
import { Flame, Play, Sparkles, Target, Trophy } from "lucide-react";
import type { Settings } from "../lib/api";
import type { ProfileData } from "../lib/profile";
import {
  applyAttempt,
  dayKey,
  masteredCount,
  NEW_PER_DAY,
  planSession,
  pruneDrills,
  streakDays,
  type AttemptInput,
  type DrillRef,
  type DrillsState,
} from "../lib/drills";
import { drillRefs } from "../lib/drills-build";
import { DrillSession } from "./train/DrillSession";
import "../styles/train.css";

export interface TrainViewProps {
  settings: Settings;
  engineReady: boolean;
  profile: ProfileData;
  updateProfile: (fn: (p: ProfileData) => ProfileData) => void;
  /** a aba está visível */
  active: boolean;
  /** abre a partida de origem na aba Partidas */
  onOpenGame: (id: string) => void;
}

/** Sessão em andamento: exercícios escolhidos e o estado do treino no momento em que começou. */
interface Session {
  refs: DrillRef[];
  drills: DrillsState | null;
}

/** Aba Treinar: exercícios a partir dos erros do aluno, com repetição espaçada. */
export function TrainView({ engineReady, profile, updateProfile, onOpenGame }: TrainViewProps) {
  const [session, setSession] = useState<Session | null>(null);
  const today = dayKey();
  const refs = useMemo(() => drillRefs(profile.games), [profile.games]);
  const plan = useMemo(() => planSession(refs, profile.drills, today), [refs, profile.drills, today]);
  const streak = streakDays(profile.drills);
  const mastered = masteredCount(profile.drills);

  function start() {
    // tira do treino os exercícios de partidas apagadas
    const live = new Set(profile.games.map((g) => g.id));
    if (pruneDrills(profile.drills, live) !== profile.drills) {
      updateProfile((p) => ({ ...p, drills: pruneDrills(p.drills, live) }));
    }
    setSession({ refs: plan.items, drills: profile.drills });
  }

  function onAttempt(a: AttemptInput) {
    updateProfile((p) => ({ ...p, drills: applyAttempt(p.drills, a) }));
  }

  if (session) {
    return (
      <div className="train-view">
        <DrillSession
          refs={session.refs}
          games={profile.games}
          drills={session.drills}
          engineReady={engineReady}
          onAttempt={onAttempt}
          onOpenGame={onOpenGame}
          onExit={() => setSession(null)}
        />
      </div>
    );
  }

  if (refs.length === 0) {
    return (
      <div className="train-view">
        <div className="train-empty panel">
          <h2 className="panel-title">
            <Target size={20} aria-hidden /> Nenhum exercício ainda
          </h2>
          <p className="hint">
            Os exercícios nascem dos seus erros nas partidas. Jogue uma partida na aba Jogar e espere a revisão terminar: cada erro
            vira um exercício em que você tenta achar o lance certo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="train-view">
      <header className="train-head">
        <Stat icon={<Target size={18} aria-hidden />} value={plan.items.length} label="para hoje" />
        <Stat icon={<Sparkles size={18} aria-hidden />} value={plan.fresh} label={`novos (até ${NEW_PER_DAY} por dia)`} />
        <Stat icon={<Trophy size={18} aria-hidden />} value={mastered} label="dominados" />
        <Stat icon={<Flame size={18} aria-hidden />} value={streak} label={streak === 1 ? "dia seguido" : "dias seguidos"} />
      </header>

      <section className="train-start panel">
        <h2 className="panel-title">Treinar meus erros</h2>
        <p className="hint">
          Você vai ver a posição em que errou e tentar achar o lance certo. Acertou de primeira, o exercício sobe de caixa e demora mais
          para voltar; errou, ele volta para a primeira caixa e reaparece na mesma sessão.
        </p>
        {plan.items.length > 0 ? (
          <button type="button" className="btn-primary big" onClick={start}>
            <Play size={18} aria-hidden /> Começar sessão ({plan.items.length} {plan.items.length === 1 ? "exercício" : "exercícios"})
          </button>
        ) : (
          <p className="train-notice">Nada para hoje. Os exercícios voltam nos próximos dias, e novos entram amanhã.</p>
        )}
      </section>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <div className="train-stat">
      <span className="train-stat-icon">{icon}</span>
      <span className="train-stat-value">{value}</span>
      <span className="train-stat-label">{label}</span>
    </div>
  );
}
