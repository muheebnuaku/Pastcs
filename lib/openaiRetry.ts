/**
 * Retries a transient OpenAI failure (rate limit, timeout, 5xx) with a
 * short backoff before giving up, so a momentary blip doesn't read to
 * the student as "the AI is broken". Does not retry a 4xx that won't
 * change on retry (bad request, invalid key, content policy) — those
 * fail fast, as before.
 */
export async function withOpenAIRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || i === attempts - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 300 * 2 ** i)); // 300ms, 600ms
    }
  }
  throw lastError;
}
