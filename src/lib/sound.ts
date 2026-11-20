/** Efeitos sonoros (gravados com o ElevenLabs), tocados via Web Audio com baixa latência. */
import moveUrl from "../assets/sfx/move.mp3";
import captureUrl from "../assets/sfx/capture.mp3";
import castleUrl from "../assets/sfx/castle.mp3";
import checkUrl from "../assets/sfx/check.mp3";
import promoteUrl from "../assets/sfx/promote.mp3";
import premoveUrl from "../assets/sfx/premove.mp3";
import startUrl from "../assets/sfx/start.mp3";
import winUrl from "../assets/sfx/win.mp3";
import lossUrl from "../assets/sfx/loss.mp3";
import drawUrl from "../assets/sfx/draw.mp3";
import tickUrl from "../assets/sfx/tick.mp3";

const URLS = {
  move: moveUrl,
  capture: captureUrl,
  castle: castleUrl,
  check: checkUrl,
  promote: promoteUrl,
  premove: premoveUrl,
  start: startUrl,
  win: winUrl,
  loss: lossUrl,
  draw: drawUrl,
  tick: tickUrl,
};
export type SoundName = keyof typeof URLS;

/** Lista para a tela de Configurações (ouvir cada som). */
export const SOUND_LIST: { name: SoundName; label: string }[] = [
  { name: "move", label: "Lance" },
  { name: "capture", label: "Captura" },
  { name: "castle", label: "Roque" },
  { name: "check", label: "Xeque" },
  { name: "promote", label: "Promoção" },
  { name: "premove", label: "Pré-lance" },
  { name: "start", label: "Início" },
  { name: "win", label: "Vitória" },
  { name: "loss", label: "Derrota" },
  { name: "draw", label: "Empate" },
  { name: "tick", label: "Relógio" },
];

const KEY = "xequemente.sound";
const VOLUME_KEY = "xequemente.volume";

export function soundVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? "");
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
  } catch {
    return 0.8;
  }
}

export function setSoundVolume(v: number) {
  try {
    localStorage.setItem(VOLUME_KEY, String(Math.min(1, Math.max(0, v))));
  } catch {
    /* ignora */
  }
}
let ctx: AudioContext | null = null;
const buffers: Partial<Record<SoundName, AudioBuffer>> = {};
let loading: Promise<void> | null = null;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* ignora */
  }
}

function context(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

/** Carrega e decodifica todos os sons uma vez (chamado na abertura do app). */
export function preloadSounds(): Promise<void> {
  const a = context();
  if (!a) return Promise.resolve();
  loading ??= Promise.all(
    (Object.keys(URLS) as SoundName[]).map(async (name) => {
      try {
        const data = await (await fetch(URLS[name])).arrayBuffer();
        buffers[name] = await a.decodeAudioData(data);
      } catch {
        /* som indisponível: segue sem ele */
      }
    }),
  ).then(() => undefined);
  return loading;
}

function play(name: SoundName, volume = 1, force = false) {
  if (!soundEnabled() && !force) return;
  const a = context();
  if (!a) return;
  if (a.state === "suspended") void a.resume();
  const buf = buffers[name];
  if (!buf) {
    void preloadSounds();
    return;
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  const gain = a.createGain();
  gain.gain.value = volume * soundVolume();
  src.connect(gain).connect(a.destination);
  src.start();
}

export const sfx = {
  move: () => play("move"),
  capture: () => play("capture"),
  castle: () => play("castle"),
  check: () => play("check"),
  promote: () => play("promote"),
  premove: () => play("premove", 0.8),
  start: () => play("start", 0.8),
  end: (win: boolean | null) => play(win === null ? "draw" : win ? "win" : "loss", 0.85),
  tick: () => play("tick", 0.7),
};

/** Toca um som para teste (mesmo com os sons desligados). */
export function previewSound(name: SoundName) {
  void preloadSounds().then(() => play(name, 1, true));
}

/** Toca o som certo para um lance a partir da notação SAN. */
export function playMoveSound(san: string) {
  if (san.includes("+") || san.includes("#")) sfx.check();
  else if (san.includes("=")) sfx.promote();
  else if (san.startsWith("O-O")) sfx.castle();
  else if (san.includes("x")) sfx.capture();
  else sfx.move();
}
