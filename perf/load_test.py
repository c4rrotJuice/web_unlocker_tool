#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import random
import statistics
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx


@dataclass
class Result:
    ok: bool
    status_code: int
    latency_ms: float
    error: str | None = None


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = int(round((p / 100.0) * (len(ordered) - 1)))
    idx = max(0, min(idx, len(ordered) - 1))
    return float(ordered[idx])


def _pick_weighted(endpoints: list[dict[str, Any]]) -> dict[str, Any]:
    choices = [max(1, int(ep.get("weight", 1))) for ep in endpoints]
    return random.choices(endpoints, weights=choices, k=1)[0]


def _extract_gauge(metrics_text: str, metric_name: str) -> float:
    for line in metrics_text.splitlines():
        if line.startswith(f"{metric_name} "):
            try:
                return float(line.split(" ", 1)[1].strip())
            except ValueError:
                return 0.0
    return 0.0


async def _run_user(
    *,
    client: httpx.AsyncClient,
    base_url: str,
    profile: dict[str, Any],
    end_at: float,
    started: float,
    user_idx: int,
    results: list[Result],
) -> None:
    ramp_seconds = max(0.0, float(profile.get("ramp_seconds", 0)))
    vus = max(1, int(profile.get("virtual_users", 1)))
    await asyncio.sleep((user_idx / vus) * ramp_seconds)

    while time.perf_counter() < end_at:
        ep = _pick_weighted(profile["endpoints"])
        method = ep.get("method", "GET").upper()
        path = ep["path"]
        headers = dict(ep.get("headers", {}))
        url = f"{base_url}{path}"
        kwargs: dict[str, Any] = {"headers": headers}
        if ep.get("content_type") == "form":
            kwargs["data"] = ep.get("data", {})
        elif "json" in ep:
            kwargs["json"] = ep.get("json", {})

        t0 = time.perf_counter()
        try:
            resp = await client.request(method, url, **kwargs)
            latency_ms = (time.perf_counter() - t0) * 1000
            ok = 200 <= resp.status_code < 400
            results.append(Result(ok=ok, status_code=resp.status_code, latency_ms=latency_ms, error=None if ok else resp.text[:120]))
        except Exception as exc:  # noqa: BLE001
            latency_ms = (time.perf_counter() - t0) * 1000
            results.append(Result(ok=False, status_code=0, latency_ms=latency_ms, error=str(exc)))

        # lightweight think time to avoid lockstep request storms
        elapsed = time.perf_counter() - started
        _ = elapsed  # preserve for future profile tuning
        await asyncio.sleep(random.uniform(0.01, 0.2))


async def run_profile(base_url: str, profile: dict[str, Any], duration_override: int | None) -> dict[str, Any]:
    duration_seconds = int(duration_override or profile.get("duration_seconds", 60))
    timeout_seconds = float(profile.get("request_timeout_seconds", 20))
    started = time.perf_counter()
    end_at = started + duration_seconds

    limits = httpx.Limits(max_connections=200, max_keepalive_connections=200)
    timeout = httpx.Timeout(timeout_seconds)
    results: list[Result] = []

    async with httpx.AsyncClient(limits=limits, timeout=timeout, verify=False) as client:
        workers = [
            asyncio.create_task(
                _run_user(
                    client=client,
                    base_url=base_url,
                    profile=profile,
                    end_at=end_at,
                    started=started,
                    user_idx=i,
                    results=results,
                )
            )
            for i in range(max(1, int(profile.get("virtual_users", 1))))
        ]
        await asyncio.gather(*workers)
        metrics_resp = await client.get(f"{base_url}/metrics")
        metrics_text = metrics_resp.text if metrics_resp.status_code == 200 else ""

    elapsed = max(1e-6, time.perf_counter() - started)
    latencies = [r.latency_ms for r in results]
    errors = [r for r in results if not r.ok]
    queue_depth = _extract_gauge(metrics_text, "unlock_pipeline_queue_depth")
    in_flight = _extract_gauge(metrics_text, "unlock_pipeline_in_flight")
    rss_mb = _extract_gauge(metrics_text, "process_memory_rss_mb")

    return {
        "profile": profile["name"],
        "duration_seconds": duration_seconds,
        "requests": len(results),
        "throughput_rps": len(results) / elapsed,
        "p50_latency_ms": _percentile(latencies, 50),
        "p95_latency_ms": _percentile(latencies, 95),
        "p99_latency_ms": _percentile(latencies, 99),
        "avg_latency_ms": statistics.fmean(latencies) if latencies else 0.0,
        "error_rate": (len(errors) / len(results)) if results else 0.0,
        "status_breakdown": _status_breakdown(results),
        "memory_rss_mb": rss_mb,
        "queue_depth": queue_depth,
        "in_flight": in_flight,
        "sample_errors": [e.error for e in errors[:5]],
    }


def _status_breakdown(results: list[Result]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for r in results:
        key = str(r.status_code)
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: int(item[0])))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Async load-test runner")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--profile", action="append", required=True, help="Path to profile JSON; can be repeated")
    parser.add_argument("--duration-override", type=int, default=None, help="Override profile duration seconds")
    parser.add_argument("--output", default="perf/results/latest-results.json")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    base_url = args.base_url.rstrip("/")
    profiles = [json.loads(Path(path).read_text(encoding="utf-8")) for path in args.profile]

    all_results: list[dict[str, Any]] = []
    for profile in profiles:
        result = asyncio.run(run_profile(base_url, profile, args.duration_override))
        all_results.append(result)
        print(json.dumps(result, indent=2))

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "base_url": base_url,
        "generated_at_epoch": int(time.time()),
        "results": all_results,
    }
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
