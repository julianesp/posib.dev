/**
 * Ayudas de audio: lectura en voz alta (voz del navegador, gratis y sin
 * internet en la mayoría de equipos) y pitidos del POS con Web Audio.
 * Todo es opcional y respeta las preferencias de lib/a11y.ts.
 */

import { getA11yPrefs } from "./a11y";

// ---------------------------------------------------------------------------
// Voz
// ---------------------------------------------------------------------------

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function spanishVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "es-CO") ||
    voices.find((v) => v.lang?.startsWith("es-") && /419|US|MX/.test(v.lang)) ||
    voices.find((v) => v.lang?.startsWith("es"))
  );
}

/** Lee un texto en voz alta (corta lo que estuviera leyendo). */
export function speak(text: string, onEnd?: () => void): boolean {
  if (!canSpeak() || !text.trim()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  // Los motores cortan textos muy largos: se lee por frases.
  const parts = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?:;])\s+/)
    .flatMap((p) => (p.length > 220 ? p.match(/.{1,220}(\s|$)/g) ?? [p] : [p]))
    .filter((p) => p.trim());
  const voice = spanishVoice();
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part);
    u.lang = voice?.lang || "es-CO";
    if (voice) u.voice = voice;
    u.rate = 0.95;
    if (i === parts.length - 1 && onEnd) {
      u.onend = onEnd;
      u.onerror = onEnd;
    }
    synth.speak(u);
  });
  return true;
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}

export function isSpeaking(): boolean {
  return canSpeak() && window.speechSynthesis.speaking;
}

/** "$ 13.000" se lee raro: mejor "13.000 pesos". */
export function pesosForSpeech(amount: number): string {
  return `${Math.round(amount).toLocaleString("es-CO")} pesos`;
}

/** Texto a leer: lo seleccionado, o el contenido principal de la pantalla. */
export function textToRead(): string {
  const selection = window.getSelection()?.toString().trim();
  if (selection) return selection;
  const main = document.querySelector("main") || document.body;
  const clone = main.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, style, noscript, svg, [aria-hidden='true'], .sr-only-skip").forEach((el) => el.remove());
  return (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim().slice(0, 6000);
}

// ---------------------------------------------------------------------------
// Pitidos del POS
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;

function tone(freq: number, startAt: number, duration: number) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/**
 * "ok": un pitido agudo y corto (producto agregado).
 * "error": dos tonos graves (código no encontrado / sin stock).
 * Solo suena si el tendero activó "Sonidos en el POS".
 */
export function posBeep(kind: "ok" | "error"): void {
  if (!getA11yPrefs().posSounds) return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const now = audioCtx.currentTime;
    if (kind === "ok") {
      tone(1320, now, 0.12);
    } else {
      tone(440, now, 0.16);
      tone(330, now + 0.2, 0.22);
    }
  } catch {
    // Sin audio disponible: no pasa nada.
  }
}

/** Dice el total de la venta si el tendero lo activó. */
export function speakSaleTotal(total: number, practice = false): void {
  if (!getA11yPrefs().speakTotal) return;
  speak(`${practice ? "Venta de práctica" : "Venta lista"}. Total: ${pesosForSpeech(total)}.`);
}
