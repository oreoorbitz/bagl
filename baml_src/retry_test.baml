testset "retry policy" {
    test "only 429 and 5xx retry" {
        assert.equal(should_retry_status(429, 0), true);
        assert.equal(should_retry_status(500, 0), true);
        assert.equal(should_retry_status(503, 0), true);
        assert.equal(should_retry_status(599, 0), true);
        assert.equal(should_retry_status(400, 0), false);
        assert.equal(should_retry_status(401, 0), false);
        assert.equal(should_retry_status(404, 0), false);
        assert.equal(should_retry_status(200, 0), false);
        assert.equal(should_retry_status(600, 0), false);
    }

    test "budget exhausts after max_retries" {
        assert.equal(should_retry_status(429, 0), true);
        assert.equal(should_retry_status(429, 1), true);
        assert.equal(should_retry_status(429, 2), true);
        assert.equal(should_retry_status(429, 3), false);
        assert.equal(should_retry_status(503, 99), false);
    }

    test "backoff doubles from base and caps" {
        assert.equal(backoff_ms(0), 500);
        assert.equal(backoff_ms(1), 1000);
        assert.equal(backoff_ms(2), 2000);
        assert.equal(backoff_ms(5), 10000);
        assert.equal(backoff_ms(100), 10000);
    }
}
