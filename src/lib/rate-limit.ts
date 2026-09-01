/**
 * Lightweight fixed-window rate limiter for the public token routes
 * (build plan §9). In-memory per serverless instance — not a hard global
 * guarantee, but combined with 256-bit unguessable tokens it makes
 * enumeration and hammering impractical. Swap for a shared store (e.g.
 * Upstash) if traffic ever warrants it.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const WINDOW_MS = 60_000;
const MAX_ENTRIES = 10_000;

export function isRateLimited(
  request: Request,
  bucket: string,
  maxPerMinute = 30
): boolean {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  const key = `${bucket}:${ip}`;
  const now = Date.now();

  // Bounded memory: drop expired entries opportunistically.
  if (windows.size > MAX_ENTRIES) {
    for (const [k, w] of windows) {
      if (w.resetAt <= now) windows.delete(k);
    }
  }

  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    // Fail closed at the cap: when purging freed nothing (a flood of
    // distinct keys within one window), refuse new keys rather than
    // growing without bound and scanning an ever-larger map.
    if (!current && windows.size >= MAX_ENTRIES) return true;
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > maxPerMinute;
}

export function rateLimitResponse(): Response {
  return Response.json({ error: "rate_limited" }, { status: 429 });
}
