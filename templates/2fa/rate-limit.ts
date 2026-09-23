// In-memory rate limiter, on purpose. Every running copy of the server keeps
// its own count and a restart resets it: under a real attack, a limit of 5 can
// let a few more attempts through. At this site's scale that still makes
// guessing a password or a code impractical, with no service, key or account
// to add. The security audit reports it as a known limit, not as a flaw. If a
// real attack ever shows up, its "Shared counter" moves the count into this
// project's own database: no new service.
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

const attempts = new Map<string, { count: number; firstAttempt: number }>();

// Auto-cleanup expired entries every 5 minutes
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of attempts) {
    if (now - value.firstAttempt > WINDOW_MS) attempts.delete(key);
  }
}, 5 * 60 * 1000);
cleanup.unref(); // Don't prevent serverless process from exiting

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = attempts.get(ip);

  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfterMs = WINDOW_MS - (now - entry.firstAttempt);
    return { allowed: false, retryAfterMs };
  }

  entry.count++;
  return { allowed: true };
}
