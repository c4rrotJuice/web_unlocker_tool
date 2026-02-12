from app.services.metrics import MetricsStore
from app.services.priority_limiter import PriorityLimiter


def test_metrics_store_renders_gauge_callbacks():
    store = MetricsStore()
    store.set_gauge_callback("process.memory_rss_mb", lambda: 123.456)

    output = store.render_prometheus()

    assert "# TYPE process_memory_rss_mb gauge" in output
    assert "process_memory_rss_mb 123.456" in output


def test_priority_limiter_exposes_queue_depth_and_in_flight():
    limiter = PriorityLimiter(3)

    assert limiter.queue_depth == 0
    assert limiter.in_flight == 0
