import { botFail, botThink, botWarn } from "./activityLog.js";
import { envKey, reloadEnv } from "../config.js";
import { getSettings, type AiProviderId } from "./settings.js";

export type AiSpeed = "fast" | "smart";

export type ProviderKind = Exclude<AiProviderId, "auto">;

type CatalogRow = {
  id: ProviderKind;
  label: string;
  hint: string;
  envName: string;
  models: Array<{ id: string; label: string; speed: AiSpeed; free: boolean }>;
};

export const ORIGINAL_GEMINI_MODEL = "gemini-3.5-flash-lite";

export const AI_CATALOG: CatalogRow[] = [
  {
    id: "gemini",
    label: "Gemini",
    hint: "Original CamelBot agent (Google AI Studio free). Stay on gemini-3.5-flash-lite — 3.6-flash burns quota and 429s.",
    envName: "GEMINI_API_KEY",
    models: [
      { id: "gemini-3.5-flash-lite", label: "gemini-3.5-flash-lite (original, free)", speed: "fast", free: true },
      { id: "gemini-3.5-flash", label: "gemini-3.5-flash (free)", speed: "smart", free: true },
    ],
  },
  {
    id: "groq",
    label: "Groq",
    hint: "Free developer tier. openai/gpt-oss-20b only in Auto.",
    envName: "GROQ_API_KEY",
    models: [
      { id: "openai/gpt-oss-20b", label: "gpt-oss-20b (free/fast)", speed: "fast", free: true },
    ],
  },
  {
    id: "openai",
    label: "OpenAI (paid API)",
    hint: "Not used in Auto. Needs billed credits — ChatGPT Pro does not count. Pick this agent only if you added API credit.",
    envName: "OPENAI_API_KEY",
    models: [
      { id: "gpt-4o-mini", label: "gpt-4o-mini (paid)", speed: "fast", free: false },
      { id: "gpt-4o", label: "gpt-4o (paid)", speed: "smart", free: false },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    hint: "Auto only uses openrouter/free. gpt-4o is paid — not in Auto.",
    envName: "OPENROUTER_API_KEY",
    models: [
      { id: "openrouter/free", label: "openrouter/free", speed: "fast", free: true },
      { id: "openai/gpt-oss-20b:free", label: "gpt-oss-20b :free", speed: "fast", free: true },
      { id: "openai/gpt-4o", label: "gpt-4o (paid)", speed: "smart", free: false },
    ],
  },
];

export function providerKey(id: ProviderKind): string {
  if (id === "gemini") return envKey("GEMINI_API_KEY");
  if (id === "openai") return envKey("OPENAI_API_KEY");
  if (id === "groq") return envKey("GROQ_API_KEY");
  return envKey("OPENROUTER_API_KEY");
}

export function providerConfigured(id: ProviderKind): boolean {
  return Boolean(providerKey(id));
}

export function anyAiConfigured(): boolean {
  return AI_CATALOG.some((row) => providerConfigured(row.id));
}

export function providerStatus(): Array<{
  id: ProviderKind;
  label: string;
  hint: string;
  configured: boolean;
  envName: string;
}> {
  reloadEnv();
  return AI_CATALOG.map((row) => ({
    id: row.id,
    label: row.label,
    hint: row.hint,
    configured: providerConfigured(row.id),
    envName: row.envName,
  }));
}

export function catalogModels(id: ProviderKind): CatalogRow["models"] {
  return AI_CATALOG.find((r) => r.id === id)?.models ?? [];
}

function defaultModel(id: ProviderKind, speed: AiSpeed): string {
  if (id === "gemini") return ORIGINAL_GEMINI_MODEL;
  const rows = catalogModels(id).filter((m) => m.free);
  return rows.find((m) => m.speed === speed)?.id ?? rows[0]?.id ?? catalogModels(id)[0]?.id ?? "";
}

function modelsForProvider(id: ProviderKind, speed: AiSpeed, freeOnly: boolean): string[] {
  const rows = catalogModels(id).filter((m) => (freeOnly ? m.free : true));
  const preferred = defaultModel(id, speed);
  const ordered = [
    preferred,
    ...rows.filter((m) => m.speed === speed).map((m) => m.id),
    ...rows.filter((m) => m.speed !== speed).map((m) => m.id),
  ];
  return [...new Set(ordered.filter(Boolean))];
}

function autoChain(speed: AiSpeed): Array<{ provider: ProviderKind; model: string }> {
  // One model per provider. Stacking lite+flash+groq+openrouter eats the timeout.
  const prefer: ProviderKind[] = ["gemini", "groq", "openrouter"];
  const out: Array<{ provider: ProviderKind; model: string }> = [];
  for (const id of prefer) {
    if (!providerConfigured(id)) continue;
    const model = defaultModel(id, speed);
    if (model) out.push({ provider: id, model });
  }
  return out;
}

function lockedChain(provider: ProviderKind, model: string, speed: AiSpeed): Array<{ provider: ProviderKind; model: string }> {
  const pick = model.trim();
  const rest = modelsForProvider(provider, speed, false).filter((id) => id !== pick);
  const models = pick ? [pick, ...rest] : rest;
  return models.map((m) => ({ provider, model: m }));
}

export function resolveAgentChain(speed: AiSpeed): Array<{ provider: ProviderKind; model: string }> {
  const ai = getSettings().ai;
  const provider = ai.provider ?? "auto";
  if (provider !== "auto") {
    if (!providerConfigured(provider)) {
      botWarn("ai", `${provider} selected but ${AI_CATALOG.find((r) => r.id === provider)?.envName} is empty — falling back`);
      return autoChain(speed);
    }
    return lockedChain(provider, ai.model ?? "", speed);
  }
  return autoChain(speed);
}

/** Per-try hang cap only — late replies are fine; gaps between providers are fine. */
export const AI_HANG_MS = 90_000;

type CompleteOpts = {
  system: string;
  prompt: string;
  timeoutMs?: number;
  tokens: number;
  temperature: number;
  speed: AiSpeed;
};

export async function completeAi(opts: CompleteOpts): Promise<string | null> {
  reloadEnv();
  const chain = resolveAgentChain(opts.speed);
  if (!chain.length) {
    botFail("ai", "No AI keys set (Gemini / Groq / OpenAI / OpenRouter)");
    return null;
  }
  const hangMs = Math.max(opts.timeoutMs ?? 0, AI_HANG_MS);
  const skip = new Set<ProviderKind>();
  for (const agent of chain) {
    if (skip.has(agent.provider)) continue;
    botThink("ai", `${agent.provider}/${agent.model} (wait up to ${hangMs}ms)`);
    const result =
      agent.provider === "gemini"
        ? await geminiOnce(agent.model, opts, hangMs)
        : await openAiCompatOnce(agent.provider, agent.model, opts, hangMs);
    if (result.ok) return result.text;
    if (result.skipProvider) {
      botWarn("ai", `Skipping rest of ${agent.provider} (${result.reason})`);
      skip.add(agent.provider);
    }
  }
  botFail("ai", "No AI reply after trying every agent");
  return null;
}

type Attempt = { ok: true; text: string } | { ok: false; skipProvider?: boolean; reason?: string };

function classifyFail(
  provider: ProviderKind | "gemini",
  status: number,
  detail: string,
): { skipProvider: boolean; reason: string } {
  const d = detail.toLowerCase();
  if (status === 401 || status === 403 || /invalid api key|incorrect api key/.test(d)) {
    return { skipProvider: true, reason: "auth" };
  }
  if (status === 404 || /does not exist|no longer available|no endpoints found|model_not_found/.test(d)) {
    return { skipProvider: false, reason: "bad model" };
  }
  if (status === 429 || /no credits remaining|insufficient_quota|billing|exceeded your current quota/.test(d)) {
    if (provider === "openai") return { skipProvider: true, reason: "paid / no credits" };
    if (provider === "gemini") return { skipProvider: false, reason: "quota on this model — try original lite" };
    return { skipProvider: true, reason: "rate limit" };
  }
  return { skipProvider: false, reason: `HTTP ${status}` };
}

async function geminiOnce(model: string, opts: CompleteOpts, timeoutMs: number): Promise<Attempt> {
  const key = envKey("GEMINI_API_KEY");
  if (!key) return { ok: false, skipProvider: true, reason: "no key" };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: { maxOutputTokens: Math.max(opts.tokens, 512), temperature: opts.temperature },
  });
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: ac.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 180);
      botWarn("ai", `Gemini ${model} HTTP ${res.status}: ${detail}`);
      const fail = classifyFail("gemini", res.status, detail);
      return { ok: false, ...fail };
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() || "";
    if (!text) return { ok: false, reason: "empty" };
    return { ok: true, text };
  } catch (err) {
    noteFetchFail("Gemini", model, timeoutMs, ac.signal.aborted, err);
    return { ok: false, reason: ac.signal.aborted ? "timeout" : "fail" };
  } finally {
    clearTimeout(timer);
  }
}

function compatEndpoint(id: ProviderKind): { url: string; key: string; extraHeaders?: Record<string, string> } | null {
  if (id === "openai") {
    const key = envKey("OPENAI_API_KEY");
    if (!key) return null;
    return { url: "https://api.openai.com/v1/chat/completions", key };
  }
  if (id === "groq") {
    const key = envKey("GROQ_API_KEY");
    if (!key) return null;
    return { url: "https://api.groq.com/openai/v1/chat/completions", key };
  }
  if (id === "openrouter") {
    const key = envKey("OPENROUTER_API_KEY");
    if (!key) return null;
    return {
      url: "https://openrouter.ai/api/v1/chat/completions",
      key,
      extraHeaders: {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "CamelBot",
      },
    };
  }
  return null;
}

async function openAiCompatOnce(
  provider: ProviderKind,
  model: string,
  opts: CompleteOpts,
  timeoutMs: number,
): Promise<Attempt> {
  const ep = compatEndpoint(provider);
  if (!ep) return { ok: false, skipProvider: true, reason: "no key" };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const payload: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
      temperature: opts.temperature,
    };
    if (provider === "groq") {
      payload.max_completion_tokens = Math.max(opts.tokens, 768);
      payload.reasoning_effort = "low";
    } else {
      payload.max_tokens = Math.max(opts.tokens, 400);
    }
    const res = await fetch(ep.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ep.key}`,
        ...(ep.extraHeaders ?? {}),
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 180);
      botWarn("ai", `${provider} ${model} HTTP ${res.status}: ${detail}`);
      const fail = classifyFail(provider, res.status, detail);
      return { ok: false, ...fail };
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim() || "";
    if (!text) return { ok: false, reason: "empty" };
    return { ok: true, text };
  } catch (err) {
    noteFetchFail(provider, model, timeoutMs, ac.signal.aborted, err);
    return { ok: false, reason: ac.signal.aborted ? "timeout" : "fail" };
  } finally {
    clearTimeout(timer);
  }
}

function noteFetchFail(who: string, model: string, timeoutMs: number, aborted: boolean, err: unknown): void {
  if (aborted) {
    botWarn("ai", `${who} timeout ${model} (${timeoutMs}ms)`);
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  botFail("ai", `${who} fail ${model}: ${msg}`);
}
