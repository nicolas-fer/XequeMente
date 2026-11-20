import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { preloadSounds } from "./lib/sound";
import { Download, History, LayoutGrid, Search, Settings as SettingsIcon, Swords, UserRound, type LucideIcon } from "lucide-react";
import { api, errorText, type EngineInfo, type Settings } from "./lib/api";
import { useGame } from "./lib/useGame";
import type { MoveNode } from "./lib/chess-utils";
import { AnalysisView } from "./components/AnalysisView";
import { EditorView, type EditorRequest } from "./components/EditorView";
import { ImportView } from "./components/ImportView";
import { SettingsView } from "./components/SettingsView";
import { PlayView } from "./components/PlayView";
import { ProfileView } from "./components/ProfileView";
import { HistoryView } from "./components/HistoryView";
import type { OpenOpts } from "./lib/useGame";
import { EMPTY_PROFILE, loadProfile, saveProfile, type ProfileData } from "./lib/profile";
import logo from "./assets/brand/logo.png";
import "./App.css";

type Tab = "jogar" | "partidas" | "analise" | "editor" | "importar" | "perfil" | "config";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "jogar", label: "Jogar", icon: Swords },
  { id: "partidas", label: "Partidas", icon: History },
  { id: "analise", label: "Análise", icon: Search },
  { id: "editor", label: "Editor", icon: LayoutGrid },
  { id: "importar", label: "Importar", icon: Download },
  { id: "perfil", label: "Perfil", icon: UserRound },
  { id: "config", label: "Configurações", icon: SettingsIcon },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("jogar");
  const game = useGame();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [editorReq, setEditorReq] = useState<EditorRequest | null>(null);
  /** muda a cada (re)início do motor ou comando, para recomeçar a análise ao vivo */
  const [engineGen, setEngineGen] = useState(0);
  const [profile, setProfile] = useState<ProfileData>(EMPTY_PROFILE);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
    void preloadSounds();
  }, []);

  /** Atualiza o perfil e grava em disco. */
  const updateProfile = useCallback((fn: (p: ProfileData) => ProfileData) => {
    setProfile((prev) => {
      const next = fn(prev);
      saveProfile(next).catch((e) => setProfileError(errorText(e)));
      return next;
    });
  }, []);

  const restartEngine = useCallback(async () => {
    setEngineError(null);
    try {
      setEngine(await api.engineStart());
      setEngineGen((g) => g + 1);
    } catch (e) {
      setEngine(null);
      setEngineError(errorText(e));
    }
  }, []);

  useEffect(() => {
    loadProfile()
      .then(setProfile)
      .catch((e) => setProfileError(errorText(e)));
    api.getSettings().then((s) => {
      setSettings(s);
      if (s.enginePath) restartEngine();
      else setTab("config");
    });
    const un = listen("engine-exited", () => setEngine(null));
    return () => {
      un.then((f) => f());
    };
  }, [restartEngine]);

  if (!settings) return <div className="loading">Carregando…</div>;

  const aiConfigured = settings.provider === "gemini" ? !!settings.geminiApiKey : !!settings.claudeApiKey;
  const aiName = settings.provider === "gemini" ? "Gemini" : "Claude";

  const loadGame = (startFen: string, moves: MoveNode[], headers: Record<string, string>) => {
    game.load(startFen, moves, headers);
    setTab("analise");
  };
  const analyzeFen = (fen: string) => {
    game.load(fen);
    setTab("analise");
  };
  const openInAnalysis = (startFen: string, moves: MoveNode[], headers: Record<string, string>, opts?: OpenOpts) => {
    game.load(startFen, moves, headers, false, opts ?? {});
    setTab("analise");
  };
  const openHistory = (id: string) => {
    setHistoryId(id);
    setTab("partidas");
  };
  const editFen = (fen: string, notes?: string[]) => {
    setEditorReq({ key: Date.now(), fen, notes });
    setTab("editor");
  };

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-brand">
          <img src={logo} alt="" />
          <span>XequeMente</span>
        </div>
        <nav className="rail-nav">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`rail-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
              <Icon size={20} strokeWidth={2.4} />
              {label}
            </button>
          ))}
        </nav>
        <div className="rail-status">
          <button className="status-line" onClick={() => setTab("config")} title={engineError ?? undefined}>
            <span className={engine ? "dot on" : "dot"} /> {engine ? engine.name : "Motor parado"}
          </button>
          <button className="status-line" onClick={() => setTab("config")}>
            <span className={aiConfigured ? "dot on" : "dot"} /> {aiConfigured ? aiName : `${aiName} sem chave`}
          </button>
          {version && <div className="app-version">XequeMente v{version}</div>}
        </div>
      </aside>
      <main className="stage">
        {profileError && <div className="error stage-error">Perfil: {profileError}</div>}
        <div className={tab === "jogar" ? "view" : "view hidden"}>
          <PlayView
            settings={settings}
            engineReady={!!engine}
            profile={profile}
            updateProfile={updateProfile}
            onOpenInAnalysis={openInAnalysis}
          />
        </div>
        <div className={tab === "partidas" ? "view" : "view hidden"}>
          <HistoryView
            settings={settings}
            profile={profile}
            updateProfile={updateProfile}
            selectedId={historyId}
            onSelect={setHistoryId}
            onOpenInAnalysis={openInAnalysis}
          />
        </div>
        <div className={tab === "analise" ? "view" : "view hidden"}>
          <AnalysisView
            game={game}
            settings={settings}
            engineReady={!!engine}
            engineGen={engineGen}
            memory={profile.memory}
            linkedRecord={profile.games.find((g) => g.id === game.state.linkedRecordId) ?? null}
            onLinkedChange={(id, patch) => updateProfile((p) => ({ ...p, games: p.games.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))}
            active={tab === "analise"}
            onEditPosition={(fen) => editFen(fen)}
          />
        </div>
        <div className={tab === "editor" ? "view" : "view hidden"}>
          <EditorView request={editorReq} onAnalyze={analyzeFen} />
        </div>
        <div className={tab === "importar" ? "view" : "view hidden"}>
          <ImportView
            active={tab === "importar"}
            aiConfigured={aiConfigured}
            onLoadGame={loadGame}
            onAnalyzeFen={analyzeFen}
            onEditFen={editFen}
          />
        </div>
        <div className={tab === "perfil" ? "view" : "view hidden"}>
          <ProfileView settings={settings} profile={profile} updateProfile={updateProfile} onOpenGame={openHistory} />
        </div>
        <div className={tab === "config" ? "view" : "view hidden"}>
          <SettingsView
            settings={settings}
            engine={engine}
            engineError={engineError}
            onSaved={(s) => {
              setSettings(s);
              setEngineGen((g) => g + 1);
            }}
            onRestartEngine={restartEngine}
            onEngineCommand={() => setEngineGen((g) => g + 1)}
          />
        </div>
      </main>
    </div>
  );
}
