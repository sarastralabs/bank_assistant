import { normalizeSpokenNumber } from "../utils/kannadaNumbers";
import { normalizeDepositMode, transliterateKannadaToEnglish } from "../utils/kannadaText";
import type { Greeting, GreetingCatalogSlot } from "../utils/greetings";

export interface PipelineResult {
  kannada_text: string;
  english_text: string;
  intent: string;
  confidence: number;
  route: string;
  response_text: string;
  required_fields?: string[];
  form_id?: string;
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
  intent_map?: Record<string, string>;
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

export interface FormFillResult {
  kannada_text: string;
  english_text: string;
  value: string;
  error?: string | null;
}

/**
 * Speak Kannada → local STT + IndicTrans2 Kn→En + typed extract → English form value.
 */
export async function fillFormFieldAudio(
  audioBlob: Blob,
  fieldType: FormField["type"],
  fieldId: string,
  filename = "field.webm",
): Promise<FormFillResult> {
  const formData = new FormData();
  formData.append("audio", audioBlob, filename);
  formData.append("field_type", fieldType);
  formData.append("field_id", fieldId);

  const res = await fetch(`${API_BASE}/api/forms/fill-field`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    let detail = `Form fill failed (${res.status})`;
    try {
      const err = await res.json();
      detail = err.detail ?? detail;
    } catch {
      // keep default
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }

  const data = await res.json();
  return {
    kannada_text: (data.kannada_text ?? "").trim(),
    english_text: (data.english_text ?? "").trim(),
    value: (data.value ?? "").trim(),
    error: data.error ?? null,
  };
}

/**
 * Clean / convert STT text for a form field into English-form values.
 * Prefer fillFormFieldAudio (IndicTrans2) for voice; this is a client-side fallback.
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

// ── Kiosk / Admin agent control ─────────────────────────────────────────────

export interface KioskSession {
  id: string;
  started_at: string;
  ended_at: string | null;
  phase: string;
  note: string;
}

export interface KioskStatus {
  running: boolean;
  phase: string;
  started_at: string | null;
  stopped_at: string | null;
  current_session_id: string | null;
  person_present: boolean;
  last_event: string;
  updated_at: string;
  demo_mode: boolean;
  sessions: KioskSession[];
}

async function kioskPost(
  path: string,
  body?: unknown,
  opts?: { admin?: boolean },
): Promise<KioskStatus> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (opts?.admin) {
    const { adminAuthHeaders } = await import("../auth/adminSession");
    Object.assign(headers, adminAuthHeaders());
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const err = await res.json();
      detail = err.detail ?? detail;
    } catch {
      // keep default
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json();
}

export async function fetchKioskStatus(): Promise<KioskStatus> {
  const res = await fetch(`${API_BASE}/api/kiosk/status`);
  if (!res.ok) throw new Error("Failed to load lobby status");
  return res.json();
}

export async function startKiosk(): Promise<KioskStatus> {
  return kioskPost("/api/kiosk/start", undefined, { admin: true });
}

export async function stopKiosk(): Promise<KioskStatus> {
  return kioskPost("/api/kiosk/stop", undefined, { admin: true });
}

export async function reportKioskPresence(present: boolean): Promise<KioskStatus> {
  return kioskPost("/api/kiosk/presence", { present });
}

export async function beginKioskSession(): Promise<KioskStatus> {
  return kioskPost("/api/kiosk/session/begin");
}

export async function setKioskPhase(
  phase: "idle" | "greeting" | "conversation",
): Promise<KioskStatus> {
  return kioskPost("/api/kiosk/session/phase", { phase });
}

export async function endKioskSession(note = ""): Promise<KioskStatus> {
  return kioskPost("/api/kiosk/session/end", { note });
}

export async function endKioskSessionAsAdmin(note = "Ended by admin"): Promise<KioskStatus> {
  return kioskPost("/api/kiosk/session/end-admin", { note }, { admin: true });
}

/** Time-based Kannada lobby greeting — random full sentence; prefer cached MMS. */
export async function fetchKioskGreetAudio(opts?: {
  slot?: string;
  hour?: number;
  variant?: number;
  random?: boolean;
  generate?: boolean;
}): Promise<{
  audio_b64: string;
  cached: boolean;
  slot: string;
  variant: number;
  title_kn: string;
  line_kn: string;
  line_en: string;
  title_en: string;
}> {
  const params = new URLSearchParams();
  if (opts?.slot) params.set("slot", opts.slot);
  if (opts?.hour !== undefined) params.set("hour", String(opts.hour));
  if (opts?.variant !== undefined) params.set("variant", String(opts.variant));
  if (opts?.random === false) params.set("random", "false");
  else params.set("random", "true");
  if (opts?.generate) params.set("generate", "true");
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/api/kiosk/greet-audio${qs ? `?${qs}` : ""}`);
  if (!res.ok) {
    let detail = "Greeting audio failed";
    try {
      const err = await res.json();
      detail = err.detail ?? detail;
    } catch {
      // keep
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  const data = await res.json();
  return {
    audio_b64: (data.audio_b64 ?? "") as string,
    cached: Boolean(data.cached),
    slot: (data.slot ?? "") as string,
    variant: Number(data.variant ?? 0),
    title_kn: (data.title_kn ?? "") as string,
    title_en: (data.title_en ?? "") as string,
    line_kn: (data.line_kn ?? "") as string,
    line_en: (data.line_en ?? "") as string,
  };
}

export async function fetchGreetingCatalog(hour?: number): Promise<{
  current: Greeting;
  greetings: GreetingCatalogSlot[];
}> {
  const h = hour ?? new Date().getHours();
  const res = await fetch(`${API_BASE}/api/kiosk/greetings?hour=${h}&random=true`);
  if (!res.ok) throw new Error("Failed to load greeting catalog");
  return res.json();
}

export interface AdminLoginResult {
  token: string;
  username: string;
  role: string;
  demo_mode: boolean;
}

export async function adminLogin(username: string, password: string): Promise<AdminLoginResult> {
  const res = await fetch(`${API_BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    let detail = "Login failed";
    try {
      const err = await res.json();
      detail = err.detail ?? detail;
    } catch {
      // keep
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json();
}

export async function adminLogout(): Promise<void> {
  const { adminAuthHeaders, clearAdminSession } = await import("../auth/adminSession");
  try {
    await fetch(`${API_BASE}/api/admin/logout`, {
      method: "POST",
      headers: adminAuthHeaders(),
    });
  } finally {
    clearAdminSession();
  }
}

export async function fetchAdminMe(): Promise<{ username: string; role: string } | null> {
  const { adminAuthHeaders, clearAdminSession } = await import("../auth/adminSession");
  const headers = adminAuthHeaders();
  if (!headers.Authorization) return null;
  const res = await fetch(`${API_BASE}/api/admin/me`, { headers });
  if (!res.ok) {
    clearAdminSession();
    return null;
  }
  return res.json();
}
