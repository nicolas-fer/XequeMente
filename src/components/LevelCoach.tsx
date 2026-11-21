import { Sparkles } from "lucide-react";
import type { ProfileData } from "../lib/profile";
import { botFor } from "../lib/bots";
import { formatLevel, suggestLevel, suggestTc } from "../lib/coaching-level";
import "../styles/coaching.css";

export interface LevelCoachProps {
  profile: ProfileData;
  /** nível escolhido agora na tela Jogar */
  level: number;
  tcId: string;
  onPickLevel: (level: number) => void;
  onPickTc: (tcId: string) => void;
}

/** Sugestão de adversário e de ritmo na tela Jogar, a partir das partidas recentes. */
export function LevelCoach({ profile, level, tcId, onPickLevel, onPickTc }: LevelCoachProps) {
  if (!profile.games.length) {
    return (
      <div className="coach-card coach-welcome">
        <Sparkles size={16} />
        <span>Bem-vindo! Jogue algumas partidas e o treinador sugere o adversário ideal para você.</span>
      </div>
    );
  }

  const suggestion = suggestLevel(profile);
  const tc = suggestTc(profile, tcId);
  if (!suggestion) return null;
  const bot = botFor(suggestion.level);
  const isSuggested = suggestion.level === level;

  return (
    <div className="coach-card">
      {isSuggested ? (
        <div className="coach-quiet muted small">
          Nível recomendado pelo treinador: {bot.name}, nível {formatLevel(suggestion.level)}.
        </div>
      ) : (
        <div className="coach-row">
          <div className="coach-text">
            <Sparkles size={16} />
            <span>
              <strong>Sugestão do treinador:</strong> {bot.name}, nível {formatLevel(suggestion.level)} ({suggestion.reason}).
            </span>
          </div>
          <button className="btn-2 labeled" onClick={() => onPickLevel(suggestion.level)}>
            Usar sugestão
          </button>
        </div>
      )}
      {tc && (
        <div className="coach-row">
          <div className="coach-text">
            <span>Para aprender, prefira Rápida {tc.label}.</span>
          </div>
          <button className="btn-2 labeled" onClick={() => onPickTc(tc.id)}>
            Usar {tc.label}
          </button>
        </div>
      )}
    </div>
  );
}
