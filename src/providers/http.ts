// bagl/src/providers/http.ts — shared fetch with retry (bagl#05).
// BAML owns the policy (retry.baml: should_retry_status/backoff_ms,
// pinned by baml test); this file owns timers, jitter, and re-fetch.
// Callers keep their existing `if (!res.ok) throw` semantics — this only
// re-issues retryable statuses (429/5xx) before returning the response.

import { backoff_ms, max_retries, should_retry_status } from "../../baml_sdk/index.js";

export async function fetchWithRetry(label: string, url: string, init: RequestInit): Promise<Response> {
	const max = max_retries();
	let attempt = 0;
	for (;;) {
		const res = await fetch(url, init);
		if (res.ok || !should_retry_status(res.status, attempt)) return res;
		// Drain the body before retrying so the socket can be reused.
		try {
			await res.text();
		} catch {}
		const wait = Math.round(backoff_ms(attempt) * (0.75 + Math.random() / 2));
		console.error(`[bagl] retry ${attempt + 1}/${max} ${label} ${res.status} after ${wait}ms`);
		await new Promise((r) => setTimeout(r, wait));
		attempt += 1;
	}
}
