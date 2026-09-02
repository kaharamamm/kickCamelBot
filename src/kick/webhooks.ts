import { createPublicKey, createVerify } from "node:crypto";
import { config } from "../config.js";

const FALLBACK_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`;

let cachedKey = FALLBACK_KEY;

export async function refreshKickPublicKey(): Promise<void> {
  try {
    const res = await fetch(`${config.kick.apiBase}/public-key`);
    const json = (await res.json()) as { data?: { public_key?: string } };
    if (json.data?.public_key) cachedKey = json.data.public_key;
  } catch (err) {
    console.warn("[webhooks] could not fetch Kick public key, using bundled copy", err);
  }
}

export function verifyKickSignature(params: {
  messageId: string;
  timestamp: string;
  signature: string;
  rawBody: string;
}): boolean {
  try {
    const payload = `${params.messageId}.${params.timestamp}.${params.rawBody}`;
    const key = createPublicKey(cachedKey);
    const verifier = createVerify("SHA256");
    verifier.update(payload);
    verifier.end();
    return verifier.verify(key, params.signature, "base64");
  } catch {
    return false;
  }
}

const seen = new Map<string, number>();

export function isDuplicateEvent(messageId: string): boolean {
  const now = Date.now();
  for (const [id, ts] of seen) {
    if (now - ts > 10 * 60 * 1000) seen.delete(id);
  }
  if (seen.has(messageId)) return true;
  seen.set(messageId, now);
  return false;
}
