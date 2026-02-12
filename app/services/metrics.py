from __future__ import annotations

from collections import defaultdict, deque
from threading import Lock
from time import perf_counter
from typing import Callable


GaugeCallback = Callable[[], float]


class MetricsStore:
    def __init__(self, max_samples: int = 2000) -> None:
        self._max_samples = max_samples
        self._lock = Lock()
        self._counters: dict[str, int] = defaultdict(int)
        self._latency_samples: dict[str, deque[float]] = defaultdict(
            lambda: deque(maxlen=self._max_samples)
        )
        self._gauges: dict[str, GaugeCallback] = {}

    def inc(self, name: str, value: int = 1) -> None:
        with self._lock:
            self._counters[name] += value

    def observe_ms(self, name: str, value_ms: float) -> None:
        with self._lock:
            self._latency_samples[name].append(max(0.0, float(value_ms)))

    def percentile_ms(self, name: str, percentile: float) -> float:
        with self._lock:
            samples = list(self._latency_samples.get(name, ()))
        if not samples:
            return 0.0
        samples.sort()
        idx = int(round((percentile / 100) * (len(samples) - 1)))
        idx = max(0, min(idx, len(samples) - 1))
        return float(samples[idx])

    def counter(self, name: str) -> int:
        with self._lock:
            return int(self._counters.get(name, 0))

    def render_prometheus(self) -> str:
        lines: list[str] = []
        with self._lock:
            counters = dict(self._counters)
            latencies = {k: list(v) for k, v in self._latency_samples.items()}
            gauges = dict(self._gauges)

        for key in sorted(counters):
            metric = _to_prom_metric_name(key)
            lines.append(f"# TYPE {metric} counter")
            lines.append(f"{metric} {counters[key]}")

        for key in sorted(latencies):
            samples = latencies[key]
            if not samples:
                continue
            metric = _to_prom_metric_name(key)
            sorted_samples = sorted(samples)
            p50 = _percentile_from_sorted(sorted_samples, 50)
            p95 = _percentile_from_sorted(sorted_samples, 95)
            p99 = _percentile_from_sorted(sorted_samples, 99)
            lines.append(f"# TYPE {metric}_milliseconds summary")
            lines.append(f'{metric}_milliseconds{{quantile="0.50"}} {p50:.3f}')
            lines.append(f'{metric}_milliseconds{{quantile="0.95"}} {p95:.3f}')
            lines.append(f'{metric}_milliseconds{{quantile="0.99"}} {p99:.3f}')
            lines.append(f"{metric}_milliseconds_count {len(sorted_samples)}")

        for key in sorted(gauges):
            metric = _to_prom_metric_name(key)
            try:
                value = float(gauges[key]())
            except Exception:
                value = 0.0
            lines.append(f"# TYPE {metric} gauge")
            lines.append(f"{metric} {value:.3f}")

        return "\n".join(lines) + "\n"

    def set_gauge_callback(self, name: str, callback: GaugeCallback) -> None:
        with self._lock:
            self._gauges[name] = callback


def _to_prom_metric_name(name: str) -> str:
    return (
        name.replace(".", "_")
        .replace("-", "_")
        .replace("/", "_")
        .replace(" ", "_")
    )


def _percentile_from_sorted(samples: list[float], percentile: float) -> float:
    if not samples:
        return 0.0
    idx = int(round((percentile / 100) * (len(samples) - 1)))
    idx = max(0, min(idx, len(samples) - 1))
    return float(samples[idx])


metrics = MetricsStore()


def record_dependency_call(dependency: str, call: Callable[[], object]) -> object:
    start = perf_counter()
    try:
        result = call()
    except Exception:
        metrics.inc(f"dependency.{dependency}.failure_count")
        raise
    finally:
        metrics.observe_ms(
            f"dependency.{dependency}.latency",
            (perf_counter() - start) * 1000,
        )

    status_code = getattr(result, "status_code", None)
    if isinstance(status_code, int) and status_code >= 400:
        metrics.inc(f"dependency.{dependency}.failure_count")
    return result


async def record_dependency_call_async(dependency: str, call: Callable[[], object]) -> object:
    start = perf_counter()
    try:
        result = await call()
    except Exception:
        metrics.inc(f"dependency.{dependency}.failure_count")
        raise
    finally:
        metrics.observe_ms(
            f"dependency.{dependency}.latency",
            (perf_counter() - start) * 1000,
        )

    status_code = getattr(result, "status_code", None)
    if isinstance(status_code, int) and status_code >= 400:
        metrics.inc(f"dependency.{dependency}.failure_count")
    return result
