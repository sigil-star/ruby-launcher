import { restrictionMessage } from "./accountType";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Call a method on the Rust dispatcher (src-tauri/src/commands/mod.rs). */
export function call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  return invoke<T>("launcher_invoke", { method, args });
}

export function on<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return listen<T>(event, (e) => handler(e.payload));
}

export class RobloxError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Roblox's response body, for callers that need more than the message. */
    public data?: unknown,
  ) {
    super(message);
  }
}

/** Called when any Roblox call returns 401 — the stored session is no longer valid. */
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

/** A verification Roblox wants before it accepts a request (captcha, proof of work, 2SV…). */
export type Challenge = { id: string; type: string; metadata: string };
export type ChallengeAnswer = { challengeId: string; metadataBase64: string };
/** Shows Roblox's own challenge UI in Ruby so the user can solve it; null = cancelled. */
let challengeHandler: ((c: Challenge) => Promise<ChallengeAnswer | null>) | null = null;
export function setChallengeHandler(fn: typeof challengeHandler) {
  challengeHandler = fn;
}

type ProxyResponse = { ok: boolean; status: number; statusText: string; headers: Record<string, string>; data: unknown };

/** Authenticated request to a Roblox web API through the native proxy (adds cookie + CSRF). */
export async function rbx<T = any>(
  url: string,
  opts?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; headers?: Record<string, string> },
): Promise<T> {
  const res = await call<ProxyResponse>("fetchRobloxAPI", url, opts ?? null);
  const chId = res.headers?.["rblx-challenge-id"];
  if (!res.ok && chId && challengeHandler && !opts?.headers?.["rblx-challenge-id"]) {
    const ch: Challenge = { id: chId, type: res.headers["rblx-challenge-type"] ?? "", metadata: res.headers["rblx-challenge-metadata"] ?? "" };
    const answer = await challengeHandler(ch);
    if (!answer) throw new RobloxError("Verification was cancelled.", res.status);
    // Same request again, carrying the solved challenge (as roblox.com does).
    return rbx<T>(url, {
      ...opts,
      headers: {
        ...(opts?.headers ?? {}),
        "rblx-challenge-id": answer.challengeId,
        "rblx-challenge-type": ch.type,
        "rblx-challenge-metadata": answer.metadataBase64,
      },
    });
  }
  if (!res.ok) {
    const d = res.data as { errors?: { message?: string }[]; errorMessage?: string } | undefined;
    const raw = d?.errors?.[0]?.message || d?.errorMessage || res.statusText || `HTTP ${res.status}`;
    // Account-based refusals (age check, parental controls, spend limits, region) in plain words.
    const msg = restrictionMessage(raw, res.status) ?? raw;
    if (res.status === 401) onSessionExpired?.();
    throw new RobloxError(msg, res.status, res.data);
  }
  return res.data as T;
}

export const win = {
  minimize: () => call("minimize"),
  maximize: () => call("maximize"),
  close: () => call("close"),
  openExternal: (url: string) => call("openExternal", url),
  /** A roblox.com page in an in-app popup, already signed in (checkout, redeem, report). */
  openRobloxWeb: (url: string, title = "Roblox") => call("openRobloxWeb", url, title),
  /** A roblox.com page shown inside Ruby's own window (Buy Robux, Redeem, Plus). */
  showRobloxPage: (url: string, title: string) => window.dispatchEvent(new CustomEvent("ruby-web", { detail: { url, title } })),
};
