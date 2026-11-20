import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Cpu, Download, Loader2, MemoryStick, Play, RefreshCw, RotateCcw, Square, Trash2, Volume2 } from "lucide-react";
import { TTS_VOICES, speak, stopVoice, useVoice } from "../lib/voice";
import { SOUND_LIST, previewSound, setSoundEnabled, setSoundVolume, soundEnabled, soundVolume } from "../lib/sound";
import { MANAGED_OPTIONS, api, errorText, type EngineInfo, type ModelOption, type Settings, type SystemInfo, type UciOption } from "../lib/api";

interface Props {
  settings: Settings;
  engine: EngineInfo | null;
  engineError: string | null;
  onSaved: (s: Settings) => void;
  onRestartEngine: () => Promise<void>;
  onEngineCommand: () => void;
}

const VOICE_SAMPLE = "Boa partida! Você jogou a abertura com muita segurança. Da próxima vez, antes de soltar a peça, confira as capturas do adversário.";

/** Voz do treinador: leitura automática do relatório e escolha da voz (com teste). */
function CoachVoiceSettings({ form, set }: { form: Settings; set: <K extends keyof Settings>(k: K, v: Settings[K]) => void }) {
  const voice = useVoice();
  const [error, setError] = useState<string | null>(null);
  const testing = voice.key === "settings-test";
  const hasGemini = !!form.geminiApiKey.trim();
  function test() {
    if (testing) return stopVoice();
    setError(null);
    speak("settings-test", () => VOICE_SAMPLE, form.ttsVoice).catch((e) => setError(errorText(e)));
  }
  return (
    <div className="voice-settings">
      <label className="toggle small">
        <input type="checkbox" checked={form.coachVoice} onChange={(e) => set("coachVoice", e.target.checked)} /> Ler em voz alta o resumo de cada relatório novo
      </label>
      <label className="inline-field">
        Voz
        <select value={form.ttsVoice} onChange={(e) => set("ttsVoice", e.target.value)} disabled={!hasGemini}>
          {TTS_VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <button className="btn-2 labeled" onClick={test} title={error ?? undefined}>
        {testing && voice.phase === "loading" ? <Loader2 size={14} className="spin" /> : testing ? <Square size={12} fill="currentColor" /> : <Volume2 size={14} />}
        {testing ? (voice.phase === "loading" ? "Preparando…" : "Parar") : "Testar voz"}
      </button>
      <p className="small muted">
        {hasGemini
          ? "A voz é do Gemini e usa a chave do Gemini, mesmo com o Claude como provedor. Cada resumo é gerado uma vez e fica guardado neste computador."
          : "Sem chave do Gemini, o treinador fala com a voz do Windows. Com a chave, a voz fica bem mais natural."}
        {error && <span className="error-text"> Falhou: {error}</span>}
      </p>
    </div>
  );
}

/** Modelo escolhido por padrão quando o atual não está na lista da chave. */
const PREFERRED: Record<"claude" | "gemini", string[]> = {
  claude: ["claude-opus-5-5", "claude-sonnet-5-5"],
  gemini: ["gemini-flash-latest", "gemini-pro-latest"],
};

/** Menu de modelos carregado da API com a chave digitada. Só aparece quando há chave. */
function ModelPicker({
  provider,
  apiKey,
  value,
  onChange,
}: {
  provider: "claude" | "gemini";
  apiKey: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "ok" | "error"; models: ModelOption[]; error?: string }>({
    status: "idle",
    models: [],
  });

  useEffect(() => {
    const key = apiKey.trim();
    if (!key) {
      setState({ status: "idle", models: [] });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, status: "loading" }));
    const t = setTimeout(() => {
      api
        .llmModels(provider, key)
        .then((models) => {
          if (cancelled) return;
          setState({ status: "ok", models });
          if (models.length && !models.some((m) => m.id === value)) {
            const pick = PREFERRED[provider].find((id) => models.some((m) => m.id === id)) ?? models[0].id;
            onChange(pick);
          }
        })
        .catch((e) => !cancelled && setState({ status: "error", models: [], error: errorText(e) }));
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, apiKey]);

  if (state.status === "idle") return <span className="hint model-hint">Cole a chave para ver os modelos disponíveis.</span>;
  if (state.status === "loading") return <select disabled className="model-select"><option>Carregando modelos…</option></select>;
  if (state.status === "error") return <span className="error-text small">Não consegui listar os modelos: {state.error}</span>;
  if (!state.models.length) return <span className="error-text small">Nenhum modelo disponível para esta chave.</span>;
  return (
    <select className="model-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {state.models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

const HASH_PRESETS = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];

/** Explicações em português para as opções mais comuns do Stockfish. */
const OPTION_HELP: Record<string, string> = {
  "Clear Hash": "Esvazia a memória de posições já calculadas.",
  Ponder: "Pensar no tempo do adversário. Só faz efeito jogando com relógio; na análise não muda nada.",
  "Skill Level": "Força do motor de 0 a 20. Abaixo de 20 ele erra de propósito: para analisar, deixe em 20.",
  "Move Overhead": "Margem de segurança (ms) por lance para atrasos de comunicação. Só importa com relógio.",
  nodestime: "Conta tempo em nós em vez de milissegundos (uso de testes). Deixe 0.",
  UCI_Chess960: "Ativa o Xadrez 960 (Fischer Random), com roques especiais.",
  UCI_LimitStrength: "Limita a força ao Elo escolhido abaixo. Deixa a análise pior: só use para jogar.",
  UCI_Elo: "Elo alvo quando a força está limitada.",
  SyzygyPath: "Pasta das tablebases Syzygy (finais com poucas peças jogados com perfeição). Separe várias pastas com ;",
  SyzygyProbeDepth: "Profundidade mínima para consultar as tablebases.",
  Syzygy50MoveRule: "Considera a regra dos 50 lances nas tablebases.",
  SyzygyProbeLimit: "Número máximo de peças para consultar as tablebases.",
  EvalFile: "Arquivo da rede neural (NNUE) principal. Deixe o padrão se não souber o que é.",
  EvalFileSmall: "Arquivo da rede neural (NNUE) pequena. Deixe o padrão se não souber o que é.",
  "Debug Log File": "Grava toda a comunicação com o motor nesse arquivo (para depuração).",
  NumaPolicy: "Como distribuir as threads entre nós NUMA (só importa em máquinas com vários processadores).",
  UCI_AnalyseMode: "Avisa o motor que ele está analisando (alguns motores mudam o comportamento).",
};

const WEAKENING = ["Skill Level", "UCI_LimitStrength"];

function formatMb(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB` : `${mb} MB`;
}

function UciField({
  opt,
  value,
  onChange,
  onButton,
}: {
  opt: UciOption;
  value: string;
  onChange: (v: string) => void;
  onButton: () => void;
}) {
  switch (opt.kind) {
    case "check":
      return (
        <label className="switch">
          <input type="checkbox" checked={value === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "false")} />
          <span className="switch-track" />
        </label>
      );
    case "spin":
      return (
        <input
          type="number"
          className="num"
          min={opt.min ?? undefined}
          max={opt.max ?? undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "combo":
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {opt.vars.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      );
    case "button":
      return (
        <button className="btn-2 labeled" onClick={onButton}>
          Executar
        </button>
      );
    default:
      return <input className="mono wide" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />;
  }
}

export function SettingsView({ settings, engine, engineError, onSaved, onRestartEngine, onEngineCommand }: Props) {
  const [form, setForm] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [filter, setFilter] = useState("");
  const [soundOn, setSoundOn] = useState(soundEnabled());
  const [volume, setVolume] = useState(soundVolume());

  useEffect(() => setForm(settings), [settings]);
  useEffect(() => {
    api.systemInfo().then(setSys).catch(() => {});
    const un = listen<string>("download-progress", (e) => setProgress(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => ({ ...f, [k]: v }));

  const logical = sys?.logicalCores ?? 1;
  const threadOpt = engine?.options.find((o) => o.name === "Threads");
  const hashOpt = engine?.options.find((o) => o.name === "Hash");
  const maxThreads = Math.min(threadOpt?.max ?? 1024, Math.max(logical, form.engineThreads));
  const ramMb = sys?.totalMemoryMb ?? 0;
  const hashLimit = Math.min(hashOpt?.max ?? 33554432, ramMb ? Math.floor(ramMb * 0.75) : 32768);
  const hashPresets = HASH_PRESETS.filter((h) => h <= hashLimit);

  const advanced = useMemo(
    () =>
      (engine?.options ?? [])
        .filter((o) => !MANAGED_OPTIONS.includes(o.name))
        .filter((o) => !filter || o.name.toLowerCase().includes(filter.toLowerCase())),
    [engine, filter],
  );

  const valueOf = (o: UciOption) => form.engineOptions[o.name] ?? o.default ?? "";
  const setOption = (o: UciOption, v: string) =>
    setForm((f) => {
      const next = { ...f.engineOptions };
      if (v === (o.default ?? "")) delete next[o.name];
      else next[o.name] = v;
      return { ...f, engineOptions: next };
    });
  const changedCount = Object.keys(form.engineOptions).length;
  const weakened = WEAKENING.some((n) => {
    const o = engine?.options.find((x) => x.name === n);
    if (!o || form.engineOptions[n] === undefined) return false;
    return n === "Skill Level" ? Number(form.engineOptions[n]) < 20 : form.engineOptions[n] === "true";
  });

  const engineChanged =
    form.enginePath !== settings.enginePath ||
    form.engineThreads !== settings.engineThreads ||
    form.engineHashMb !== settings.engineHashMb ||
    form.showWdl !== settings.showWdl ||
    JSON.stringify(form.engineOptions) !== JSON.stringify(settings.engineOptions);
  const dirty = JSON.stringify(form) !== JSON.stringify(settings);

  async function save() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      await api.saveSettings(form);
      onSaved(form);
      if (form.enginePath && (engineChanged || !engine)) {
        await onRestartEngine();
        setMsg("Configurações salvas e motor reiniciado.");
      } else setMsg("Configurações salvas.");
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  async function download() {
    setDownloading(true);
    setErr(null);
    try {
      const path = await api.engineDownload();
      const next = { ...form, enginePath: path };
      setForm(next);
      onSaved(next);
      await onRestartEngine();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setDownloading(false);
    }
  }

  async function command(cmd: string, done: string) {
    setErr(null);
    try {
      await api.engineCommand(cmd);
      onEngineCommand();
      setMsg(done);
    } catch (e) {
      setErr(errorText(e));
    }
  }

  return (
    <div className="settings">
      <section className="panel">
        <div className="panel-title">Tutor (IA)</div>
        <div className="field">
          <span>Provedor</span>
          <div className="seg">
            <button className={form.provider === "claude" ? "active" : ""} onClick={() => set("provider", "claude")}>
              Claude (Anthropic)
            </button>
            <button className={form.provider === "gemini" ? "active" : ""} onClick={() => set("provider", "gemini")}>
              Gemini (Google)
            </button>
          </div>
        </div>
        {form.provider === "claude" ? (
          <div className="grid2 two">
            <label className="field">
              <span>Chave da API Anthropic</span>
              <input type={showKeys ? "text" : "password"} value={form.claudeApiKey} onChange={(e) => set("claudeApiKey", e.target.value)} placeholder="sk-ant-..." />
            </label>
            <div className="field">
              <span>Modelo</span>
              <ModelPicker provider="claude" apiKey={form.claudeApiKey} value={form.claudeModel} onChange={(id) => set("claudeModel", id)} />
            </div>
          </div>
        ) : (
          <div className="grid2 two">
            <label className="field">
              <span>Chave da API Gemini</span>
              <input type={showKeys ? "text" : "password"} value={form.geminiApiKey} onChange={(e) => set("geminiApiKey", e.target.value)} placeholder="AIza..." />
            </label>
            <div className="field">
              <span>Modelo</span>
              <ModelPicker provider="gemini" apiKey={form.geminiApiKey} value={form.geminiModel} onChange={(id) => set("geminiModel", id)} />
            </div>
          </div>
        )}
        <div className="row-buttons spread">
          <label className="toggle small">
            <input type="checkbox" checked={showKeys} onChange={(e) => setShowKeys(e.target.checked)} /> Mostrar chaves
          </label>
          <label className="inline-field">
            Seu nível
            <select value={form.tutorLevel} onChange={(e) => set("tutorLevel", e.target.value as Settings["tutorLevel"])}>
              <option value="iniciante">Iniciante</option>
              <option value="intermediario">Intermediário</option>
              <option value="avancado">Avançado</option>
            </select>
          </label>
        </div>
        <p className="small muted">As chaves ficam só neste computador e as chamadas às APIs saem do processo nativo do app.</p>
        <CoachVoiceSettings form={form} set={set} />
      </section>

      <section className="panel">
        <div className="panel-title">
          <Volume2 size={18} /> Sons
          <span className="spacer" />
          <label className="switch">
            <input
              type="checkbox"
              checked={soundOn}
              onChange={(e) => {
                setSoundEnabled(e.target.checked);
                setSoundOn(e.target.checked);
              }}
            />
            <span className="switch-track" />
          </label>
        </div>
        <div className="field">
          <span>
            Volume: <strong className="value">{Math.round(volume * 100)}%</strong>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              setVolume(v);
              setSoundVolume(v);
            }}
            onMouseUp={() => previewSound("move")}
          />
        </div>
        <div className="sound-grid">
          {SOUND_LIST.map((s) => (
            <button key={s.name} className="btn-2 labeled" onClick={() => previewSound(s.name)} title="Ouvir">
              <Play size={14} strokeWidth={2.6} /> {s.label}
            </button>
          ))}
        </div>
        <span className="hint">Valem para o modo Jogar e para os lances feitos na Análise. Os botões tocam mesmo com os sons desligados.</span>
      </section>

      <section className="panel">
        <div className="panel-title">
          Motor
          <span className="spacer" />
          {engine ? <span className="engine-chip on">● {engine.name}</span> : <span className="engine-chip">● Motor parado</span>}
        </div>
        {engineError && <div className="error">{engineError}</div>}
        <label className="field">
          <span>Executável</span>
          <input className="mono" value={form.enginePath} onChange={(e) => set("enginePath", e.target.value)} placeholder="C:\...\stockfish.exe" />
        </label>
        <div className="row-buttons">
          <button className="btn-2 labeled" onClick={download} disabled={downloading}>
            <Download size={16} strokeWidth={2.6} /> {downloading ? "Baixando…" : "Baixar Stockfish oficial"}
          </button>
          <button className="btn-2 labeled" onClick={() => onRestartEngine()} disabled={!settings.enginePath}>
            <RefreshCw size={16} strokeWidth={2.6} /> Reiniciar motor
          </button>
          <button className="btn-2 labeled" disabled={!engine} onClick={() => command("ucinewgame", "Memória do motor limpa.")} title="ucinewgame: esquece o que já calculou">
            <Trash2 size={16} strokeWidth={2.6} /> Limpar memória
          </button>
          {progress && <span className="small muted">{progress}</span>}
        </div>

        <div className="subsection">
          <div className="sub-title">Desempenho</div>
          {sys && (
            <div className="hw-line">
              <Cpu size={16} />
              <span>
                {sys.cpuName || "Processador"} · <strong>{sys.physicalCores ?? "?"}</strong> núcleos físicos,{" "}
                <strong>{sys.logicalCores}</strong> threads
              </span>
              {ramMb > 0 && (
                <>
                  <MemoryStick size={16} />
                  <span>
                    <strong>{formatMb(ramMb)}</strong> de RAM
                  </span>
                </>
              )}
            </div>
          )}
          <div className="field">
            <span>
              Threads (núcleos usados): <strong className="value">{form.engineThreads}</strong> de {logical}
            </span>
            <input
              type="range"
              min={1}
              max={maxThreads}
              value={form.engineThreads}
              onChange={(e) => set("engineThreads", Number(e.target.value))}
            />
            <div className="row-buttons">
              {[
                ["1", 1],
                ["Metade", Math.max(1, Math.floor(logical / 2))],
                ["Todos menos 1", Math.max(1, logical - 1)],
                ["Todos", logical],
              ].map(([label, n]) => (
                <button
                  key={label as string}
                  className={`chip ${form.engineThreads === n ? "selected" : ""}`}
                  onClick={() => set("engineThreads", n as number)}
                >
                  {label} ({n})
                </button>
              ))}
            </div>
            <span className="hint">Mais threads = análise mais rápida, mas o PC fica mais ocupado. "Todos menos 1" deixa o app fluido.</span>
          </div>
          <div className="field">
            <span>
              Hash (memória de posições): <strong className="value">{formatMb(form.engineHashMb)}</strong>
            </span>
            <div className="row-buttons">
              {hashPresets.map((h) => (
                <button key={h} className={`chip ${form.engineHashMb === h ? "selected" : ""}`} onClick={() => set("engineHashMb", h)}>
                  {formatMb(h)}
                </button>
              ))}
              <input
                type="number"
                className="num"
                min={hashOpt?.min ?? 1}
                max={hashLimit}
                value={form.engineHashMb}
                onChange={(e) => set("engineHashMb", Math.max(1, Number(e.target.value) || 16))}
                title="Valor em MB"
              />
            </div>
            <span className="hint">
              Para análise, 256 MB a 1 GB já é ótimo. {ramMb > 0 && `Evite passar de ${formatMb(Math.floor(ramMb / 2))} (metade da sua RAM).`}
            </span>
          </div>
        </div>

        <div className="subsection">
          <div className="sub-title">Análise ao vivo</div>
          <div className="grid2">
            <div className="field">
              <span>Linhas mostradas (padrão)</span>
              <div className="seg">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} className={form.defaultMultipv === n ? "active" : ""} onClick={() => set("defaultMultipv", n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>Até quando calcular</span>
              <div className="seg">
                {(
                  [
                    ["infinite", "Sem limite"],
                    ["depth", "Profundidade"],
                    ["time", "Tempo"],
                  ] as [Settings["liveLimit"], string][]
                ).map(([k, label]) => (
                  <button key={k} className={form.liveLimit === k ? "active" : ""} onClick={() => set("liveLimit", k)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {form.liveLimit === "depth" && (
              <label className="field">
                <span>Profundidade máxima</span>
                <input type="number" className="num" min={1} max={99} value={form.liveDepth} onChange={(e) => set("liveDepth", Number(e.target.value) || 20)} />
              </label>
            )}
            {form.liveLimit === "time" && (
              <label className="field">
                <span>Segundos por posição</span>
                <input type="number" className="num" min={1} max={3600} value={form.liveSeconds} onChange={(e) => set("liveSeconds", Number(e.target.value) || 5)} />
              </label>
            )}
          </div>
          <label className="switch">
            <input type="checkbox" checked={form.showWdl} onChange={(e) => set("showWdl", e.target.checked)} />
            <span className="switch-track" />
            Mostrar chances de vitória / empate / derrota (WDL)
          </label>
          <span className="hint">"Sem limite" calcula até você mudar de posição, e o motor fica usando a CPU enquanto isso.</span>
        </div>

        <div className="subsection">
          <div className="sub-title">Revisão da partida</div>
          <div className="grid2">
            <div className="field">
              <span>Critério por posição</span>
              <div className="seg">
                <button className={form.reviewMode === "depth" ? "active" : ""} onClick={() => set("reviewMode", "depth")}>
                  Profundidade
                </button>
                <button className={form.reviewMode === "time" ? "active" : ""} onClick={() => set("reviewMode", "time")}>
                  Tempo
                </button>
              </div>
            </div>
            {form.reviewMode === "depth" ? (
              <label className="field">
                <span>Profundidade</span>
                <input type="number" className="num" min={6} max={40} value={form.reviewDepth} onChange={(e) => set("reviewDepth", Number(e.target.value) || 16)} />
              </label>
            ) : (
              <label className="field">
                <span>Milissegundos por posição</span>
                <input type="number" className="num" min={50} max={60000} step={50} value={form.reviewMs} onChange={(e) => set("reviewMs", Number(e.target.value) || 500)} />
              </label>
            )}
          </div>
          {form.reviewMode === "depth" && (
            <div className="field">
              <span>Tempo máximo por posição</span>
              <div className="seg">
                {[
                  [0, "Sem limite"],
                  [500, "0,5 s"],
                  [1000, "1 s"],
                  [1500, "1,5 s"],
                  [3000, "3 s"],
                  [5000, "5 s"],
                ].map(([ms, label]) => (
                  <button key={ms} className={form.reviewCapMs === ms ? "active" : ""} onClick={() => set("reviewCapMs", ms as number)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(() => {
            // Estimativa para uma partida típica de 40 lances (80 posições), descontando o que já é analisado durante o jogo.
            const perPos = form.reviewMode === "time" ? form.reviewMs : form.reviewCapMs;
            const slow = form.reviewMode === "depth" && form.reviewCapMs === 0 && form.reviewDepth >= 20;
            if (slow)
              return (
                <div className="notice">
                  Profundidade {form.reviewDepth} sem limite de tempo pode levar de vários minutos a mais de uma hora por partida
                  (algumas posições passam de 1 minuto cada). Escolha um tempo máximo por posição.
                </div>
              );
            if (perPos > 0) {
              const secs = (perPos * 80) / 1000;
              return (
                <span className="hint">
                  Uma partida de 40 lances leva no máximo ~{secs >= 90 ? `${Math.round(secs / 60)} min` : `${Math.round(secs)} s`} para revisar;
                  no modo Jogar, a maior parte é analisada durante a própria partida.
                </span>
              );
            }
            return <span className="hint">Profundidade 14–18 serve para treino; mais alto fica mais preciso e mais lento.</span>;
          })()}
        </div>

        <details className="subsection advanced">
          <summary>
            <span className="sub-title">Opções avançadas do motor</span>
            <span className="muted small">
              {engine ? `${advanced.length} opções` : "inicie o motor para ver"}
              {changedCount > 0 && ` · ${changedCount} alterada(s)`}
            </span>
          </summary>
          {engine ? (
            <>
              <div className="row-buttons">
                <input className="grow" placeholder="Filtrar opções…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                <button className="btn-2 labeled" disabled={changedCount === 0} onClick={() => set("engineOptions", {})}>
                  <RotateCcw size={15} strokeWidth={2.6} /> Restaurar todas
                </button>
              </div>
              {weakened && (
                <div className="notice">Você reduziu a força do motor (Skill Level ou UCI_LimitStrength). As avaliações e a revisão ficarão menos confiáveis.</div>
              )}
              <div className="uci-list">
                {advanced.map((o) => {
                  const changed = form.engineOptions[o.name] !== undefined;
                  return (
                    <div className={`uci-row ${changed ? "changed" : ""}`} key={o.name}>
                      <div className="uci-name">
                        <span className="mono">{o.name}</span>
                        <span className="uci-meta">
                          {o.kind}
                          {o.kind === "spin" && ` · ${o.min}–${o.max}`}
                          {o.default !== null && o.kind !== "button" && ` · padrão: ${o.default === "" ? "(vazio)" : o.default}`}
                        </span>
                        {OPTION_HELP[o.name] && <span className="uci-help">{OPTION_HELP[o.name]}</span>}
                      </div>
                      <div className="uci-control">
                        <UciField
                          opt={o}
                          value={valueOf(o)}
                          onChange={(v) => setOption(o, v)}
                          onButton={() => command(`setoption name ${o.name}`, `“${o.name}” executado.`)}
                        />
                        {changed && (
                          <button className="link small" onClick={() => setOption(o, o.default ?? "")} title="Voltar ao padrão">
                            padrão
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <span className="hint">Threads, Hash, MultiPV e WDL são ajustados nas seções acima. As alterações valem ao salvar (o motor reinicia).</span>
            </>
          ) : (
            <div className="muted small">Configure e inicie o motor para listar as opções que ele oferece.</div>
          )}
        </details>
      </section>

      <div className="save-bar">
        <button className="btn-primary big" disabled={saving || !dirty} onClick={save}>
          {saving ? "Salvando…" : dirty ? "Salvar alterações" : "Tudo salvo"}
        </button>
        {dirty && engineChanged && form.enginePath && <span className="small muted">O motor será reiniciado.</span>}
        {msg && !dirty && <span className="ok">{msg}</span>}
        {err && <span className="error-text">{err}</span>}
      </div>
    </div>
  );
}
