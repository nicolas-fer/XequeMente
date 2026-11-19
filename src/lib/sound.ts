/** Sons sintetizados com Web Audio (sem arquivos): lance, captura, xeque, fim de jogo, relógio. */

let ctx: AudioContext | null = null;
const KEY = "xequemente.sound";

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

function audio(): AudioContext | null {
  if (!soundEnabled()) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function knock(a: AudioContext, at: number, freq: number, gain: number, dur: number) {
  // Ruído curto filtrado: o "toc" da peça na madeira.
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = 1.2;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(a.destination);
  src.start(at);
  // Corpo grave
  const osc = a.createOscillator();
  const og = a.createGain();
  osc.frequency.setValueAtTime(freq / 8, at);
  osc.frequency.exponentialRampToValueAtTime(freq / 16, at + dur);
  og.gain.setValueAtTime(gain * 0.5, at);
  og.gain.exponentialRampToValueAtTime(0.001, at + dur);
  osc.connect(og).connect(a.destination);
  osc.start(at);
  osc.stop(at + dur);
}

function tone(a: AudioContext, at: number, freq: number, dur: number, gain = 0.12, type: OscillatorType = "sine") {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(a.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export const sfx = {
  move() {
    const a = audio();
    if (a) knock(a, a.currentTime, 1700, 0.9, 0.07);
  },
  capture() {
    const a = audio();
    if (!a) return;
    knock(a, a.currentTime, 1100, 1.1, 0.09);
    knock(a, a.currentTime + 0.045, 800, 0.7, 0.08);
  },
  check() {
    const a = audio();
    if (!a) return;
    knock(a, a.currentTime, 1500, 0.8, 0.07);
    tone(a, a.currentTime + 0.02, 880, 0.18, 0.09, "triangle");
  },
  premove() {
    const a = audio();
    if (a) tone(a, a.currentTime, 1250, 0.05, 0.05, "square");
  },
  start() {
    const a = audio();
    if (!a) return;
    tone(a, a.currentTime, 523, 0.14);
    tone(a, a.currentTime + 0.12, 784, 0.22);
  },
  end(win: boolean | null) {
    const a = audio();
    if (!a) return;
    const notes = win === null ? [523, 659, 523] : win ? [523, 659, 784, 1047] : [523, 466, 392];
    notes.forEach((f, i) => tone(a, a.currentTime + i * 0.13, f, 0.3, 0.12, "triangle"));
  },
  tick() {
    const a = audio();
    if (a) tone(a, a.currentTime, 1900, 0.03, 0.05, "square");
  },
};
