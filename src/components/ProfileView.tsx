import { useMemo, useState } from "react";
import { Brain, Clock3, Crosshair, Lightbulb, Sparkles, Target, Trash2, TrendingUp, Zap } from "lucide-react";
import { api, errorText, type Settings } from "../lib/api";
import { makeMove, type MoveNode } from "../lib/chess-utils";
import { PHASE_LABEL, type Phase } from "../lib/review";
import {
  PROFILE_SCHEMA,
  coachSystem,
  computeStats,
  profilePrompt,
  type CoachProfileAnalysis,
  type GameRecord,
  type ProfileData,
} from "../lib/profile";
import { CoachBubble } from "./TutorChat";

interface Props {
  settings: Settings;
  profile: ProfileData;
  updateProfile: (fn: (p: ProfileData) => ProfileData) => void;
  onOpenInAnalysis: (startFen: string, moves: MoveNode[], headers: Record<string, string>) => void;
}

/** Dicas gerais de método (valem para qualquer nível). */
const TIPS: { icon: typeof Zap; title: string; items: string[] }[] = [
  {
    icon: Crosshair,
    title: "Rotina antes de cada lance (10 segundos)",
    items: [
      "Pergunte primeiro: o que o último lance do adversário mudou? O que ele ameaça agora?",
      "Varra Xeques, Capturas e Ameaças, nessa ordem, para os dois lados. A maioria das táticas está aí.",
      "Antes de soltar a peça, faça o “teste do erro grave”: olhe o lance escolhido com os olhos do adversário. Qual é a melhor resposta dele?",
      "Confira as peças soltas: peça sem defensor é alvo. Conte atacantes e defensores nas casas tensas.",
    ],
  },
  {
    icon: Brain,
    title: "Calcular melhor",
    items: [
      "Liste 2 ou 3 lances candidatos antes de calcular qualquer um. Não se apaixone pelo primeiro.",
      "Calcule primeiro os lances forçantes (xeques, capturas, ameaças), que reduzem as respostas do adversário.",
      "Pare a linha numa posição calma e avalie: material, rei, atividade. Não precisa ir até o fim do mundo.",
      "“Fotografe” a posição final da variante e compare as fotos entre os candidatos.",
      "Não recalcule a mesma linha três vezes: decida com o que viu e confie no teste do erro grave.",
    ],
  },
  {
    icon: Zap,
    title: "Pensar mais rápido",
    items: [
      "Aberturas conhecidas e lances óbvios (recapturas, lances únicos) devem sair em segundos: guarde o tempo para o meio-jogo.",
      "Em posição simples, jogue o lance natural (desenvolver, centralizar, melhorar a pior peça) sem calcular tudo.",
      "Use o tempo do adversário para pensar em planos gerais; calcule variantes concretas no seu tempo.",
      "Treino de padrões é o que mais acelera: 15 minutos de exercícios táticos por dia fazem você “ver” sem calcular.",
    ],
  },
  {
    icon: Clock3,
    title: "Relógio e apuro de tempo",
    items: [
      "Regra prática: gaste no máximo 1/20 do tempo restante num lance normal; invista mais só em momentos críticos.",
      "Com pouco tempo, simplifique: troque peças, proteja o rei e evite complicações.",
      "Pré-lance só em lances forçados (recaptura óbvia, lance único). Em posição tática, pré-lance vira armadilha.",
      "Com incremento, faça lances seguros para acumular segundos antes de entrar em cálculo.",
    ],
  },
];

function pct(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `${v.toFixed(1)}%`;
}

function AccuracyChart({ games }: { games: GameRecord[] }) {
  const data = games
    .slice(0, 20)
    .reverse()
    .map((g) => g.accuracy)
    .filter((a): a is number => a !== null);
  if (data.length < 2) return <div className="muted small">Jogue pelo menos 2 partidas para ver a evolução.</div>;
  const W = 400;
  const H = 110;
  const x = (i: number) => (i / (data.length - 1)) * (W - 20) + 10;
  const y = (v: number) => H - 10 - (v / 100) * (H - 20);
  return (
    <svg className="acc-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {[25, 50, 75].map((v) => (
        <line key={v} x1="0" x2={W} y1={y(v)} y2={y(v)} className="grid-line" />
      ))}
      <polyline points={data.map((v, i) => `${x(i)},${y(v)}`).join(" ")} className="acc-line" />
      {data.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r="3.5" className="acc-dot" />
      ))}
    </svg>
  );
}

export function ProfileView({ settings, profile, updateProfile, onOpenInAnalysis }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(profile.playerName);
  const stats = useMemo(() => computeStats(profile.games), [profile.games]);
  const analysis = profile.coachAnalysis;
  const aiConfigured = settings.provider === "gemini" ? !!settings.geminiApiKey : !!settings.claudeApiKey;
  const maxTag = stats.tagCounts[0]?.[1] ?? 1;

  async function refreshAnalysis() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.llmJson<CoachProfileAnalysis>(coachSystem(settings.tutorLevel), profilePrompt(profile, stats), PROFILE_SCHEMA);
      const memory = (res.memory ?? []).map((m) => String(m).trim()).filter(Boolean).slice(0, 12);
      updateProfile((p) => ({
        ...p,
        memory: memory.length ? memory : p.memory,
        coachAnalysis: { ...res, updatedAt: new Date().toISOString(), gamesCount: p.games.length },
      }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function openGame(g: GameRecord) {
    const moves: MoveNode[] = [];
    let fen = g.startFen;
    for (const u of g.uci) {
      const m = makeMove(fen, u.slice(0, 2), u.slice(2, 4), u[4]);
      if (!m) break;
      moves.push(m);
      fen = m.fenAfter;
    }
    const me = profile.playerName || "Você";
    const bot = `${g.botName} (nível ${g.level})`;
    onOpenInAnalysis(g.startFen, moves, {
      White: g.playerColor === "w" ? me : bot,
      Black: g.playerColor === "b" ? me : bot,
      Result: g.result === "draw" ? "1/2-1/2" : (g.result === "win") === (g.playerColor === "w") ? "1-0" : "0-1",
    });
  }

  const outdated = analysis && (analysis.gamesCount ?? 0) < profile.games.length;

  return (
    <div className="profile">
      <section className="panel profile-hero">
        <div className="hero-avatar">{(profile.playerName || "V")[0].toUpperCase()}</div>
        <div className="hero-info">
          <input
            className="hero-name"
            value={name}
            placeholder="Seu nome"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== profile.playerName && updateProfile((p) => ({ ...p, playerName: name.trim() }))}
          />
          <div className="hero-level">{analysis?.level_label ?? (stats.games ? "Avaliação ainda não gerada" : "Jogue partidas para montar seu perfil")}</div>
        </div>
        <div className="hero-stats">
          <div>
            <span className="hs-value">{stats.games}</span>
            <span className="hs-label">partidas</span>
          </div>
          <div>
            <span className="hs-value">
              <span className="w">{stats.wins}</span>/<span className="d">{stats.draws}</span>/<span className="l">{stats.losses}</span>
            </span>
            <span className="hs-label">V / E / D</span>
          </div>
          <div>
            <span className="hs-value">{pct(stats.recentAccuracy)}</span>
            <span className="hs-label">precisão (últ. 10)</span>
          </div>
          <div>
            <span className="hs-value">{stats.performance ?? "—"}</span>
            <span className="hs-label">performance estimada</span>
          </div>
        </div>
      </section>

      <div className="profile-grid">
        <section className="panel">
          <div className="panel-title">
            <TrendingUp size={18} /> Evolução da precisão
          </div>
          <AccuracyChart games={profile.games} />
          <div className="phase-bars">
            {(["opening", "middlegame", "endgame"] as Phase[]).map((p) => {
              const v = stats.phaseAcc[p];
              return (
                <div key={p} className="phase-row">
                  <span>{PHASE_LABEL[p]}</span>
                  <div className="bar">
                    <div style={{ width: `${v ?? 0}%` }} />
                  </div>
                  <span className="bar-value">{pct(v)}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <Target size={18} /> Onde você mais erra
          </div>
          {stats.tagCounts.length === 0 ? (
            <div className="muted small">Sem erros registrados ainda.</div>
          ) : (
            <div className="phase-bars">
              {stats.tagCounts.slice(0, 7).map(([tag, n]) => (
                <div key={tag} className="phase-row">
                  <span className="tag-name">{tag}</span>
                  <div className="bar bad">
                    <div style={{ width: `${(n / maxTag) * 100}%` }} />
                  </div>
                  <span className="bar-value">{n}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mini-stats">
            <span>
              Erros graves por partida: <strong>{stats.blundersPerGame?.toFixed(2) ?? "—"}</strong>
            </span>
            <span>
              Erros em apuro de tempo: <strong>{stats.timePressureShare !== null ? `${(stats.timePressureShare * 100).toFixed(0)}%` : "—"}</strong>
            </span>
          </div>
        </section>
      </div>

      <section className="panel coach-panel">
        <div className="panel-title">
          <Sparkles size={18} /> Análise do treinador
          <span className="spacer" />
          {analysis?.updatedAt && <span className="muted small">atualizada em {new Date(analysis.updatedAt).toLocaleDateString("pt-BR")}</span>}
          <button className="btn-primary" disabled={busy || !aiConfigured || profile.games.length === 0} onClick={refreshAnalysis}>
            {busy ? "Analisando…" : analysis ? "Atualizar análise" : "Gerar análise"}
          </button>
        </div>
        {!aiConfigured && <div className="notice">Configure uma chave de IA em Configurações para o treinador avaliar seu perfil.</div>}
        {outdated && !busy && <div className="hint">Você jogou partidas novas desde a última análise: vale atualizar.</div>}
        {error && <div className="error">{error}</div>}
        {busy && <CoachBubble typing />}
        {analysis && !busy && (
          <>
            <CoachBubble>{analysis.summary}</CoachBubble>
            <div className="coach-cols">
              <div className="coach-list good">
                <div className="card-title">Pontos fortes</div>
                <ul>
                  {analysis.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div className="coach-list bad">
                <div className="card-title">Pontos fracos</div>
                <ul>
                  {analysis.weaknesses.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="card-title">Erros frequentes</div>
            <div className="error-cards">
              {analysis.frequent_errors.map((e, i) => (
                <div key={i} className="error-card">
                  <strong>{e.pattern}</strong>
                  <div className="muted small">Exemplo: {e.example}</div>
                  <div>Como corrigir: {e.fix}</div>
                </div>
              ))}
            </div>
            <div className="card-title">O que treinar</div>
            <ol className="plan">
              {analysis.training_plan.map((t, i) => (
                <li key={i}>
                  <strong>{t.title}</strong> — {t.detail}
                </li>
              ))}
            </ol>
            {analysis.thinking_tips.length > 0 && (
              <>
                <div className="card-title">Dicas personalizadas para pensar e calcular</div>
                <ul className="tips-list">
                  {analysis.thinking_tips.map((t, i) => (
                    <li key={i}>
                      <Lightbulb size={15} /> {t}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <div className="profile-grid">
        <section className="panel">
          <div className="panel-title">
            <Brain size={18} /> Memória do treinador
          </div>
          <p className="hint">
            O que o treinador lembra sobre você. É atualizada depois de cada partida e entra em todas as análises e no chat. Apague o
            que não fizer sentido.
          </p>
          {profile.memory.length === 0 ? (
            <div className="muted small">Ainda vazia. Jogue uma partida com a IA configurada.</div>
          ) : (
            <ul className="memory-list">
              {profile.memory.map((m, i) => (
                <li key={i}>
                  <span>{m}</span>
                  <button
                    className="link small"
                    title="Esquecer"
                    onClick={() => updateProfile((p) => ({ ...p, memory: p.memory.filter((_, j) => j !== i) }))}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-title">Partidas</div>
          {profile.games.length === 0 ? (
            <div className="muted small">Nenhuma partida ainda. Vá em Jogar!</div>
          ) : (
            <div className="games-list">
              {profile.games.slice(0, 40).map((g) => (
                <button key={g.id} className="game-row" onClick={() => openGame(g)} title="Abrir na Análise">
                  <span className={`result-dot ${g.result}`}>{g.result === "win" ? "V" : g.result === "loss" ? "D" : "E"}</span>
                  <span className="game-main">
                    <span>
                      {g.botName} <span className="muted">· nível {g.level} · {g.timeControl.label}</span>
                    </span>
                    <span className="muted small">{g.coach?.headline ?? `${g.reason} · ${g.plies} lances`}</span>
                  </span>
                  <span className="game-acc">{pct(g.accuracy)}</span>
                  <span className="muted small">{new Date(g.date).toLocaleDateString("pt-BR")}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-title">
          <Lightbulb size={18} /> Dicas e macetes
        </div>
        <div className="tips-grid">
          {TIPS.map(({ icon: Icon, title, items }) => (
            <div key={title} className="tip-card">
              <div className="tip-title">
                <Icon size={18} /> {title}
              </div>
              <ul>
                {items.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
