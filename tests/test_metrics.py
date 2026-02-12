import asyncio

from app.services.metrics import MetricsStore, record_dependency_call, record_dependency_call_async


class _Response:
    def __init__(self, status_code: int):
        self.status_code = status_code


def test_metrics_store_percentiles_and_prometheus_output():
    store = MetricsStore(max_samples=10)
    for value in [10, 20, 30, 40, 50]:
        store.observe_ms("http.request_latency", value)
    store.inc("http.request_count")

    assert store.percentile_ms("http.request_latency", 50) == 30
    assert store.percentile_ms("http.request_latency", 95) == 50

    output = store.render_prometheus()
    assert "http_request_count" in output
    assert 'http_request_latency_milliseconds{quantile="0.95"}' in output


def test_record_dependency_call_tracks_failures_from_status_codes():
    result = record_dependency_call("upstash", lambda: _Response(500))
    assert result.status_code == 500


async def _ok_async_call():
    return _Response(200)


async def _bad_async_call():
    raise RuntimeError("boom")


def test_record_dependency_call_async_success_and_exception_paths():
    ok = asyncio.run(record_dependency_call_async("supabase", _ok_async_call))
    assert ok.status_code == 200

    try:
        asyncio.run(record_dependency_call_async("supabase", _bad_async_call))
    except RuntimeError as exc:
        assert str(exc) == "boom"
    else:
        raise AssertionError("Expected RuntimeError")
