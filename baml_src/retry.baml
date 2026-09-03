// bagl/baml_src/retry.baml — retry policy for provider fetch (bagl#05).
// BAML owns the pure policy: WHICH statuses retry, how many times, how
// long to wait. The host (src/providers/http.ts) owns timers, jitter, and
// the re-fetch loop. Mirrors bi's retry.baml, but status-based: BAGL
// providers throw host Errors, so there is no TurnFailure taxonomy here —
// the executor classifies on res.status before the caller throws.

function max_retries() -> int {
    3
}

function base_backoff_ms() -> int {
    500
}

function max_backoff_ms() -> int {
    10000
}

function should_retry_status(status: int, attempt: int) -> bool {
    // attempt counts retries already spent (0 = first retry after the
    // initial try); budget is max_retries() total retries.
    if (attempt >= max_retries()) {
        false
    } else {
        status == 429 || (status >= 500 && status < 600)
    }
}

function backoff_ms(attempt: int) -> int {
    // Guard the doubling itself: multiplying all the way to `attempt`
    // would overflow int64 long before the cap matters (cf. bi#16).
    let d = base_backoff_ms();
    let i = 0;
    while (i < attempt && d < max_backoff_ms()) {
        d = d * 2;
        i = i + 1
    }
    if (d > max_backoff_ms()) {
        max_backoff_ms()
    } else {
        d
    }
}
