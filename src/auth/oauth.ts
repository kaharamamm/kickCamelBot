import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import type { TokenSet } from "../types.js";

type PendingAuth = {
  verifier: string;
  createdAt: number;
  kind: "streamer" | "bot";
};

const pending = new Map<string, PendingAuth>();

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createAuthUrl(kind: "streamer" | "bot" = "streamer"): string {
  const state = base64Url(randomBytes(24));
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  pending.set(state, { verifier, createdAt: Date.now(), kind });

  const scopes =
    kind === "bot"
      ? ["user:read", "chat:write"]
      : config.kick.scopes;

  const url = new URL(`${config.kick.idBase}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.kick.clientId);
  url.searchParams.set("redirect_uri", config.kick.redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(code: string, state: string): Promise<{ tokens: TokenSet; kind: "streamer" | "bot" }> {
  const found = pending.get(state);
  pending.delete(state);
  if (!found || Date.now() - found.createdAt > 10 * 60 * 1000) {
    throw new Error("OAuth state expired. Open /login again.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.kick.clientId,
    client_secret: config.kick.clientSecret,
    redirect_uri: config.kick.redirectUri,
    code_verifier: found.verifier,
    code,
  });

  return { tokens: await requestToken(body), kind: found.kind };
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.kick.clientId,
    client_secret: config.kick.clientSecret,
    refresh_token: refreshToken,
  });
  return requestToken(body);
}

async function requestToken(body: URLSearchParams): Promise<TokenSet> {
  const res = await fetch(`${config.kick.idBase}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description ?? json.error ?? `Token request failed (${res.status})`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? "",
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    scope: json.scope ?? "",
  };
}
