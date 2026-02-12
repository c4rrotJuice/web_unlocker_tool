# Metrics dashboard + alert recommendations

This service now exposes a Prometheus-style endpoint at `GET /metrics`.

## Core API metrics

- `http_request_count`
- `http_error_count`
- `http_request_latency_milliseconds{quantile="0.50|0.95|0.99"}`
- `process_memory_rss_mb`

Recommended alerts:

- **High error rate**: `http_error_count / http_request_count > 0.03` for 5m.
- **Latency regression**:
  - p95 > 1500ms for 10m
  - p99 > 3000ms for 10m

## Dependency metrics

- Supabase:
  - `dependency_supabase_latency_milliseconds{quantile="0.95"}`
  - `dependency_supabase_failure_count`
- Upstash:
  - `dependency_upstash_latency_milliseconds{quantile="0.95"}`
  - `dependency_upstash_failure_count`
- Paddle:
  - `dependency_paddle_latency_milliseconds{quantile="0.95"}`
  - `dependency_paddle_failure_count`

Recommended alerts:

- **Dependency failures**: any dependency failure ratio > 2% over 10m.
- **Dependency latency**:
  - Supabase p95 > 800ms (10m)
  - Upstash p95 > 300ms (10m)
  - Paddle p95 > 1200ms (10m)

## Unlock pipeline metrics

- `unlock_pipeline_request_count`
- `unlock_pipeline_retry_count`
- `unlock_pipeline_blocked_count`
- `unlock_pipeline_queue_wait_milliseconds{quantile="0.50|0.95|0.99"}`
- `unlock_pipeline_queue_depth`
- `unlock_pipeline_in_flight`

Derived rates to chart:

- **Retry rate** = `unlock_pipeline_retry_count / unlock_pipeline_request_count`
- **Blocked rate** = `unlock_pipeline_blocked_count / unlock_pipeline_request_count`

Recommended alerts:

- Retry rate > 20% over 15m.
- Blocked rate > 15% over 15m.
- Queue wait p95 > 1000ms over 10m.
