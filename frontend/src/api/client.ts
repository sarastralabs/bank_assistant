import { normalizeSpokenNumber } from "../utils/kannadaNumbers";
import { normalizeDepositMode, transliterateKannadaToEnglish } from "../utils/kannadaText";

export interface PipelineResult {
  kannada_text: string;
  english_text: string;
  intent: string;
  confidence: number;
  route: string;
  response_text: string;
  audio_b64: string;
  stage_times: Record<string, number>;
  total_time_s: number;
  error: string | null;
  history_id?: number | null;
}

export interface HistoryItem {
  id: number;
  created_at: string;
  kannada_text: string;
  english_text: string;
  intent: string;
  confidence: number;
  route: string;
  response_text: string;
  has_audio: boolean;
  total_time_s: number | null;
  stage_times: Record<string, number>;
  audio_b64?: string;
}

export interface LandingData {
  product: {
    name: string;
    tagline: string;
    language: string;
    mode: string;
  };
  stats: {
    supported_intents: number;
    history_queries: number;
    pipeline_stages: number;
    typical_latency_s: string;
  };
  intents: Array<{ id: string; label: string; example: string }>;
  interest_rates: Array<{ product: string; rate: string }>;
  pipeline: Array<{ step: number; name: string; detail: string }>;
  recent: Array<{
    id: number;
    intent: string;
    kannada_text: string;
    created_at: string;
  }>;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === "ok";
  } catch {
    return false;
  }
}

export async function processAudio(audioBlob: Blob, filename = "recording.webm"): Promise<PipelineResult> {
  const formData = new FormData();
  formData.append("audio", audioBlob, filename);

  const res = await fetch(`${API_BASE}/api/process-audio`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const err = await res.json();
      detail = err.detail ?? detail;
    } catch {
      // use default message
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }

  return res.json();
}

export async function fetchLanding(): Promise<LandingData> {
  const res = await fetch(`${API_BASE}/api/landing`);
  if (!res.ok) throw new Error("Failed to load landing data");
  return res.json();
}

export async function fetchHistory(limit = 50): Promise<HistoryItem[]> {
  const res = await fetch(`${API_BASE}/api/history?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to load history");
  const data = await res.json();
  return data.items ?? [];
}

export async function fetchHistoryItem(id: number): Promise<HistoryItem> {
  const res = await fetch(`${API_BASE}/api/history/${id}`);
  if (!res.ok) throw new Error("Failed to load history item");
  return res.json();
}

export async function deleteHistoryItem(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/history/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete history item");
}

export async function clearHistory(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/history`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to clear history");
}

export function base64ToAudioUrl(audioB64: string): string {
  const binary = atob(audioB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

export function formatHistoryTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function formatIntentLabel(intent: string): string {
  return intent.replace(/_/g, " ");
}

export interface FormField {
  id: string;
  label_kn: string;
  label_en: string;
  prompt_kn: string;
  type: "text" | "digits" | "amount" | "date";
  required: boolean;
  /** If set, field is filled automatically and not asked by voice. */
  auto?: "today" | null;
}

export interface FormSummary {
  id: string;
  title_kn: string;
  title_en: string;
  description_kn: string;
  description_en: string;
  field_count: number;
}

export interface FormCatalog {
  disclaimer_kn: string;
  disclaimer_en: string;
  forms: FormSummary[];
}

export interface BankForm {
  id: string;
  title_kn: string;
  title_en: string;
  description_kn: string;
  description_en: string;
  fields: FormField[];
  disclaimer_kn: string;
  disclaimer_en: string;
}

export async function fetchFormCatalog(): Promise<FormCatalog> {
  const res = await fetch(`${API_BASE}/api/forms`);
  if (!res.ok) throw new Error("Failed to load forms");
  return res.json();
}

export async function fetchForm(formId: string): Promise<BankForm> {
  const res = await fetch(`${API_BASE}/api/forms/${formId}`);
  if (!res.ok) throw new Error("Failed to load form");
  return res.json();
}

export async function transcribeFormAudio(
  audioBlob: Blob,
  filename = "field.webm",
): Promise<string> {
  const formData = new FormData();
  formData.append("audio", audioBlob, filename);

  const res = await fetch(`${API_BASE}/api/forms/transcribe`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    let detail = `Transcription failed (${res.status})`;
    try {
      const err = await res.json();
      detail = err.detail ?? detail;
    } catch {
      // keep default
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }

  const data = await res.json();
  return (data.text ?? "").trim();
}

/**
 * Clean / convert STT text for a form field into English-form values.
 * - digits / amount → Arabic numerals from Kannada number words
 * - name / text → Kannada script transliterated to English letters
 * - deposit_mode → Cash / Cheque when recognized
 */
export function normalizeFormValue(
  raw: string,
  type: FormField["type"],
  fieldId?: string,
): string {
  const text = raw.trim();
  if (!text) return "";

  if (type === "digits" || type === "amount" || type === "date") {
    return normalizeSpokenNumber(text, type);
  }

  if (fieldId === "deposit_mode") {
    return normalizeDepositMode(text);
  }

  if (fieldId === "full_name" || type === "text") {
    return transliterateKannadaToEnglish(text);
  }

  return text;
}
