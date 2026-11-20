import { useMemo, useState } from "react";
import { BookOpen, Brain, Clock3, Crosshair, Lightbulb, Sparkles, Target, ThumbsUp, Trash2, TrendingUp, Wrench, Zap } from "lucide-react";
import { api, errorText, type Settings } from "../lib/api";
import { PHASE_LABEL, type Phase } from "../lib/review";
import {
  PROFILE_SCHEMA,
  coachSystem,
  computeStats,
  computeOpeningStats,
  profilePrompt,
  tipRelevance,
  type CoachProfileAnalysis,
  type TipId,
  type GameRecord,
  type ProfileData,
} from "../lib/profile";
import { CoachBubble } from "./TutorChat";

interface Props {
  settings: Settings;
  profile: ProfileData;
  updateProfile: (fn: (p: ProfileData) => ProfileData) => void;
  /** abre a partida na aba Partidas */
  onOpenGame: (id: string) => void;
}

/** Dicas gerais de método (valem para qualquer nível). */
const TIPS: { id: TipId; icon: typeof Zap; title: string; items: string[] }[] = [
  {
    id: "routine",
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
    id: "calc",
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
    id: "speed",
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
    id: "clock",
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

/** Dicas: personalizadas pela IA quando há análise; senão, as gerais ordenadas pelos erros medidos. */
function TipsSection({ games, analysis }: { games: GameRecord[]; analysis: CoachProfileAnalysis | null }) {
  const rel = useMemo(() => tipRelevance(games), [games]);
  const groups = analysis?.tip_groups ?? [];
  const legacy = analysis?.thinking_tips ?? [];
  const hasGames = games.length > 0;
  const ordered = [...TIPS].sort((a, b) => rel[b.id].score - rel[a.id].score);
  const top = rel[ordered[0].id].score;

  const general = (
    <div className="tips-grid">
      {ordered.map(({ id, icon: Icon, title, items }) => {
        const r = rel[id];
        const key = hasGames && r.score > 0 && r.score >= top * 0.6;
        return (
          <div key={id} className={`tip-card ${key ? "key" : ""}`}>
            {key && <span className="tip-badge">Mais importante para você</span>}
            <div className="tip-title">
              <Icon size={18} /> {title}
            </div>
            {key && r.reason && <div className="tip-evidence">Por quê: {r.reason} nas últimas partidas.</div>}
            <ul>
              {items.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );

  if (!hasGames) {
    return (
      <section className="panel">
        <details className="tips-collapsed">
          <summary>
            <span className="panel-title">
              <Lightbulb size={18} /> Dicas e macetes
            </span>
            <span className="muted small">Jogue algumas partidas para receber dicas baseadas no seu jogo · ver dicas gerais</span>
          </summary>
          {general}
        </details>
      </section>
    );
  }

  if (groups.length) {
    return (
      <section className="panel">
        <div className="panel-title">
          <Lightbulb size={18} /> Dicas para você
        </div>
        <p className="hint">Escritas pelo treinador a partir dos seus pontos fortes e fracos. Atualizam junto com a análise.</p>
        <div className="tips-grid">
          {[...groups]
            .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "weakness" ? -1 : 1))
            .map((g, i) => (
              <div key={i} className={`tip-card personal ${g.kind}`}>
                <span className={`tip-kind ${g.kind}`}>
                  {g.kind === "weakness" ? <Wrench size={13} /> : <ThumbsUp size={13} />}
                  {g.kind === "weakness" ? "Para corrigir" : "Para aproveitar"}
                </span>
                <div className="tip-title">{g.title}</div>
                <div className="tip-linked">{g.linked_to}</div>
                {g.evidence && <div className="tip-evidence">{g.evidence}</div>}
                <ul>
                  {g.tips.map((t, j) => (
                    <li key={j}>{t}</li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
        <details className="tips-collapsed">
          <summary>
            <span className="muted small">Ver dicas gerais (ordenadas pelos seus erros)</span>
          </summary>
          {general}
        </details>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <Lightbulb size={18} /> Dicas e macetes
      </div>
      <p className="hint">
        Ordenadas pelos erros das suas partidas. Gere a análise do treinador para receber dicas escritas para os seus pontos fortes e
        fracos.
      </p>
      {legacy.length > 0 && (
        <ul className="tips-list">
          {legacy.map((t, i) => (
            <li key={i}>
              <Lightbulb size={15} /> {t}
            </li>
          ))}
        </ul>
      )}
      {general}
    </section>
  );
}

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

export function ProfileView({ settings, profile, updateProfile, onOpenGame }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(profile.playerName);
  const stats = useMemo(() => computeStats(profile.games), [profile.games]);
  const openingStats = useMemo(() => computeOpeningStats(profile.games), [profile.games]);
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

      {openingStats.length > 0 && (
        <section className="panel">
          <div className="panel-title">
            <BookOpen size={18} /> Suas aberturas
            <span className="spacer" />
            <span className="muted small">pelo catálogo do Lichess</span>
          </div>
          <div className="opening-table">
            <div className="opening-row head">
              <span>Abertura</span>
              <span>Cor</span>
              <span>Partidas</span>
              <span>V / E / D</span>
              <span>Aproveitamento</span>
              <span>Precisão</span>
            </div>
            {openingStats.slice(0, 10).map((o) => (
              <div className="opening-row" key={`${o.color}-${o.family}`} title={o.variations.join("\n")}>
                <span className="opening-family">{o.family}</span>
                <span>
                  <span className={`color-chip ${o.color}`} /> {o.color === "w" ? "Brancas" : "Pretas"}
                </span>
                <span>{o.games}</span>
                <span>
                  <span className="w">{o.wins}</span>/<span className="d">{o.draws}</span>/<span className="l">{o.losses}</span>
                </span>
                <span className="opening-score">
                  <span className="bar">
                    <span style={{ width: `${o.score * 100}%` }} className={o.score >= 0.5 ? "" : "low"} />
                  </span>
                  {Math.round(o.score * 100)}%
                </span>
                <span>{pct(o.avgAccuracy)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

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
          </>
        )}
      </section>

      <TipsSection games={profile.games} analysis={busy ? null : analysis} />

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
                <button key={g.id} className="game-row" onClick={() => onOpenGame(g.id)} title="Ver a partida">
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

    </div>
  );
}
