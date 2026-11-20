import { invoke } from "@tauri-apps/api/core";

export interface PvLine {
  multipv: number;
  depth: number;
  seldepth: number;
  /** centipeões, ponto de vista das brancas */
  cp: number | null;
  /** mate em N, ponto de vista das brancas */
  mate: number | null;
  pv: string[];
  nodes: number;
  nps: number;
  /** vitória/empate/derrota em permilagem, ponto de vista das brancas */
  wdl: [number, number, number] | null;
}

export interface InfoEvent {
  id: number;
  fen: string;
  lines: PvLine[];
}

export interface SearchResult {
  id: number;
  fen: string;
  bestMove: string | null;
  lines: PvLine[];
}

export interface UciOption {
  name: string;
  kind: "check" | "spin" | "combo" | "string" | "button";
  default: string | null;
  min: number | null;
  max: number | null;
  vars: string[];
}

export interface EngineInfo {
  name: string;
  path: string;
  options: UciOption[];
}

export interface SystemInfo {
  logicalCores: number;
  physicalCores: number | null;
  totalMemoryMb: number;
  cpuName: string;
}

/** Opções que o app controla em campos próprios. */
export const MANAGED_OPTIONS = ["Threads", "Hash", "MultiPV", "UCI_ShowWDL"];

export interface Settings {
  provider: "claude" | "gemini";
  claudeApiKey: string;
  claudeModel: string;
  geminiApiKey: string;
  geminiModel: string;
  enginePath: string;
  engineThreads: number;
  engineHashMb: number;
  reviewDepth: number;
  tutorLevel: "iniciante" | "intermediario" | "avancado";
  defaultMultipv: number;
  liveLimit: "infinite" | "depth" | "time";
  liveDepth: number;
  liveSeconds: number;
  reviewMode: "depth" | "time";
  reviewMs: number;
  reviewCapMs: number;
  showWdl: boolean;
  engineOptions: Record<string, string>;
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface BoardRead {
  boardFound: boolean;
  orientation: "white_bottom" | "black_bottom";
  rows: string[];
  sideToMove: "w" | "b" | "unknown";
  notes: string;
}

export interface ChatMessageParam {
  role: "user" | "assistant";
  content: string;
}

let searchCounter = 1;
export const nextSearchId = () => searchCounter++;

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  engineStart: () => invoke<EngineInfo>("engine_start"),
  engineStatus: () => invoke<EngineInfo | null>("engine_status"),
  engineAnalyze: (id: number, fen: string, multipv: number) =>
    invoke<void>("engine_analyze", { id, fen, multipv }),
  engineEval: (id: number, fen: string, limit: { depth?: number; movetime?: number }, multipv = 1) =>
    invoke<SearchResult>("engine_eval", { id, fen, depth: limit.depth ?? null, movetime: limit.movetime ?? null, multipv }),
  engineCommand: (command: string) => invoke<void>("engine_command", { command }),
  systemInfo: () => invoke<SystemInfo>("system_info"),
  engineStop: () => invoke<void>("engine_stop"),
  engineDownload: () => invoke<string>("engine_download"),
  tutorChat: (requestId: string, messages: ChatMessageParam[]) =>
    invoke<void>("tutor_chat", { requestId, messages }),
  tutorCancel: (requestId: string) => invoke<void>("tutor_cancel", { requestId }),
  imageToBoard: (imageBase64: string, mediaType: string) =>
    invoke<BoardRead>("image_to_board", { imageBase64, mediaType }),
  opponentStart: (skill: number) => invoke<EngineInfo>("opponent_start", { skill }),
  opponentMove: (id: number, startFen: string, moves: string[], fen: string, movetime: number) =>
    invoke<SearchResult>("opponent_move", { id, startFen, moves, fen, movetime }),
  opponentStop: () => invoke<void>("opponent_stop"),
  profileGet: () => invoke<unknown>("profile_get"),
  profilePut: (data: unknown) => invoke<void>("profile_put", { data }),
  llmModels: (provider: "claude" | "gemini", apiKey: string) => invoke<ModelOption[]>("llm_models", { provider, apiKey }),
  llmJson: <T>(system: string, prompt: string, schema: object) => invoke<T>("llm_json", { system, prompt, schema }),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
