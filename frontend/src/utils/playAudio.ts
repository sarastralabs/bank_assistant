import { base64ToAudioUrl } from "../api/client";

let audioUnlocked = false;
let sharedCtx: AudioContext | null = null;

/** Play a base64 WAV and resolve when finished (or on error). */
export function playBase64Wav(audioB64: string, signal?: AbortSignal): Promise<void> {
  if (!audioB64) return Promise.resolve();
  const url = base64ToAudioUrl(audioB64);
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.onended = null;
      audio.onerror = null;
    };
    const onAbort = () => {
      audio.pause();
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    audio.onended = () => {
      signal?.removeEventListener("abort", onAbort);
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      cleanup();
      reject(new Error("Audio playback failed"));
    };
    void audio.play().catch((err) => {
      signal?.removeEventListener("abort", onAbort);
      cleanup();
      reject(err);
    });
  });
}

/**
 * Unlock browser audio (Chrome blocks speech/Audio until AudioContext runs).
 * Call after camera permission or a tap — required for auto-greet voice.
 */
export async function unlockAudio(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    if (!sharedCtx || sharedCtx.state === "closed") {
      sharedCtx = new AC();
    }
    if (sharedCtx.state === "suspended") {
      await sharedCtx.resume();
    }
    // Silent blip so the browser marks audio as allowed
    const osc = sharedCtx.createOscillator();
    const gain = sharedCtx.createGain();
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(sharedCtx.destination);
    osc.start();
    osc.stop(sharedCtx.currentTime + 0.05);
    audioUnlocked = true;
    preloadBrowserVoices();
    return true;
  } catch {
    return false;
  }
}

export function isAudioUnlocked(): boolean {
  return audioUnlocked;
}

function pickKannadaVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith("kn")) ||
    voices.find((v) => /kannada/i.test(v.name)) ||
    null
  );
}

function speakOnce(text: string): Promise<{ ok: boolean; ms: number }> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "kn-IN";
    utter.rate = 1;
    const kn = pickKannadaVoice();
    if (kn) utter.voice = kn;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ ok, ms: performance.now() - t0 });
    };
    utter.onend = () => finish(true);
    utter.onerror = () => finish(false);
    // If Chrome drops the utterance, onend may never fire — watchdog
    window.setTimeout(() => {
      if (!settled && !window.speechSynthesis.speaking) finish(false);
    }, 1500);
    window.speechSynthesis.speak(utter);
  });
}

/** Browser TTS — unlocks audio and retries if Chrome blocks the first attempt. */
export async function speakKannadaBrowser(text: string): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis || !text.trim()) {
    return;
  }

  await unlockAudio();
  window.speechSynthesis.cancel();

  // Wait briefly for voices list if empty
  if (window.speechSynthesis.getVoices().length === 0) {
    await new Promise<void>((resolve) => {
      const done = () => {
        window.speechSynthesis.removeEventListener("voiceschanged", done);
        resolve();
      };
      window.speechSynthesis.addEventListener("voiceschanged", done);
      window.setTimeout(done, 200);
    });
  }

  let result = await speakOnce(text);
  // Blocked / instant fail → unlock again and retry once
  if (!result.ok || result.ms < 250) {
    await unlockAudio();
    window.speechSynthesis.cancel();
    await new Promise((r) => window.setTimeout(r, 80));
    result = await speakOnce(text);
  }
  // Still tiny duration → utterance likely dropped; wait while speaking if any
  if (result.ok && result.ms < 250 && window.speechSynthesis.speaking) {
    await new Promise<void>((resolve) => {
      const id = window.setInterval(() => {
        if (!window.speechSynthesis.speaking) {
          window.clearInterval(id);
          resolve();
        }
      }, 100);
      window.setTimeout(() => {
        window.clearInterval(id);
        resolve();
      }, 20000);
    });
  }
}

/** Warm browser voices so the first greet isn't delayed. */
export function preloadBrowserVoices(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener(
    "voiceschanged",
    () => {
      window.speechSynthesis.getVoices();
    },
    { once: true },
  );
}
