/** Voz do treinador: lê o resumo do relatório com o TTS do Gemini (ou com a voz do Windows, sem chave). */
import { useSyncExternalStore } from "react";
import { api, errorText } from "./api";
import { SPEECH_RULES, coachSystem, type CoachGameReport } from "./profile";

/** Vozes do Gemini oferecidas nas Configurações. */
export const TTS_VOICES: { id: string; label: string }[] = [
  { id: "Charon", label: "Charon · masculina, explicativa" },
  { id: "Orus", label: "Orus · masculina, firme" },
  { id: "Iapetus", label: "Iapetus · masculina, clara" },
  { id: "Algenib", label: "Algenib · masculina, grave" },
  { id: "Puck", label: "Puck · masculina, animada" },
  { id: "Fenrir", label: "Fenrir · masculina, empolgada" },
  { id: "Kore", label: "Kore · feminina, firme" },
  { id: "Sulafat", label: "Sulafat · feminina, calorosa" },
  { id: "Achernar", label: "Achernar · feminina, suave" },
  { id: "Aoede", label: "Aoede · feminina, leve" },
  { id: "Leda", label: "Leda · feminina, jovem" },
  { id: "Zephyr", label: "Zephyr · feminina, brilhante" },
];

export type VoicePhase = "idle" | "loading" | "playing";
interface VoiceState {
  /** o que está tocando (ex.: um relatório); null quando parado */
  key: string | null;
  phase: VoicePhase;
}

let state: VoiceState = { key: null, phase: "idle" };
const listeners = new Set<() => void>();
function setState(s: VoiceState) {
  state = s;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Estado atual da voz (o que está tocando e em que fase). */
export function useVoice(): VoiceState {
  return useSyncExternalStore(subscribe, () => state);
}
export const voiceState = () => state;

let audio: HTMLAudioElement | null = null;
let audioUrl: string | null = null;
let token = 0;

const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
synth?.getVoices(); // a lista de vozes do Windows carrega na primeira chamada

/** Para a fala em andamento (e cancela a que ainda está sendo gerada). */
export function stopVoice() {
  token++;
  audio?.pause();
  audio = null;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
  synth?.cancel();
  if (state.phase !== "idle") setState({ key: null, phase: "idle" });
}

function speakNative(text: string, key: string, my: number) {
  if (!synth) throw new Error("Nenhuma voz disponível neste computador.");
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "pt-BR";
  const voices = synth.getVoices().filter((v) => v.lang.replace("_", "-").toLowerCase() === "pt-br");
  u.voice = voices.find((v) => /natural|online/i.test(v.name)) ?? voices[0] ?? null;
  u.onend = u.onerror = () => {
    if (my === token) setState({ key: null, phase: "idle" });
  };
  synth.speak(u);
  setState({ key, phase: "playing" });
}

/**
 * Fala o texto devolvido por `getText` (pode ser gerado na hora). `key` identifica quem pediu,
 * para o botão certo mostrar "parar". Uma fala nova interrompe a anterior.
 */
export async function speak(key: string, getText: () => Promise<string> | string, voice?: string) {
  stopVoice();
  const my = ++token;
  setState({ key, phase: "loading" });
  try {
    const text = (await getText()).trim();
    if (my !== token) return;
    if (!text) throw new Error("Não há resumo para ler.");
    try {
      const buf = await api.ttsSpeak(text, voice);
      if (my !== token) return;
      audioUrl = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
      const a = new Audio(audioUrl);
      audio = a;
      a.onended = () => {
        if (my === token) stopVoice();
      };
      await a.play();
      if (my === token) setState({ key, phase: "playing" });
    } catch (e) {
      if (my !== token) return;
      console.warn("Voz do Gemini indisponível, usando a voz do Windows:", errorText(e));
      speakNative(text, key, my);
    }
  } catch (e) {
    if (my === token) setState({ key: null, phase: "idle" });
    throw e;
  }
}

/** Identificador de um relatório para a voz. */
export const coachVoiceKey = (coach: CoachGameReport) => `coach:${coach.headline}:${coach.report.length}`;

const SPEECH_SCHEMA = {
  type: "object",
  properties: { speech: { type: "string" } },
  required: ["speech"],
  additionalProperties: false,
};

/** Resumo falado do relatório. Relatórios antigos não têm: é gerado a partir do texto. */
export async function speechOf(coach: CoachGameReport, tutorLevel: string): Promise<string> {
  if (coach.speech?.trim()) return coach.speech.trim();
  const prompt = [
    "Este é o relatório que você escreveu sobre a última partida do aluno:",
    `# ${coach.headline}`,
    coach.report,
    ...coach.mistakes.map((m) => `- Erro em ${m.move}: ${m.what_happened} Lição: ${m.lesson}`),
    "",
    `Devolva em speech ${SPEECH_RULES}`,
  ].join("\n");
  const r = await api.llmJson<{ speech: string }>(coachSystem(tutorLevel), prompt, SPEECH_SCHEMA);
  return String(r.speech ?? "").trim();
}
