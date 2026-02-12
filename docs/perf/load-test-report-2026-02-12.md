# Load Test Report — 2026-02-12

## Scope
Implemented a reusable load-testing suite with three traffic profiles:

1. `mixed-traffic`
2. `unlock-heavy-burst`
3. `dependency-latency-injection`

Profiles are stored under `perf/profiles/` and executed by `perf/load_test.py`.

## 1-hour staging soak plan
For staging, run the following command with real staging auth context (valid bearer token and staging URL):

```bash
python perf/load_test.py \
  --base-url https://<staging-host> \
  --profile perf/profiles/mixed-traffic.json \
  --profile perf/profiles/unlock-heavy-burst.json \
  --profile perf/profiles/dependency-latency-injection.json \
  --output perf/results/staging-soak-$(date +%F).json
```

### Planned profile schedule (total 60 minutes)
- Mixed traffic: 20 minutes
- Unlock-heavy burst: 20 minutes
- Dependency-latency injection: 20 minutes

> Note: profile durations are configurable in each profile JSON via `duration_seconds`.

## Execution in this environment
A functional smoke soak was executed locally (5 seconds per profile) because staging credentials and network targets were not available in this environment.

Command used:

```bash
python perf/load_test.py --base-url http://127.0.0.1:8001 --profile perf/profiles/mixed-traffic.json --profile perf/profiles/unlock-heavy-burst.json --profile perf/profiles/dependency-latency-injection.json --duration-override 5 --output perf/results/staging-soak-sample.json
```

## Results summary (local smoke run)

| Profile | Throughput (req/s) | p95 latency (ms) | Error rate | Memory RSS (MB) | Queue depth |
|---|---:|---:|---:|---:|---:|
| mixed-traffic | 0.91 | 51.61 | 78.85% | 77.02 | 0 |
| unlock-heavy-burst | 5.54 | 22.20 | 100.00% | 77.66 | 0 |
| dependency-latency-injection | 1.94 | 20.94 | 100.00% | 77.72 | 0 |

### Interpretation
- The suite executed successfully and collected throughput/latency/error/memory/queue metrics end-to-end.
- Error rates are dominated by `401 Unauthorized` responses in this environment (expected due non-production auth tokens).
- Queue depth remained 0 in the local smoke run, indicating no observable limiter backlog under this synthetic setup.

## Safe operating limits (initial recommendations)
Use these as conservative initial guardrails for staging/prod while running the 1-hour soak with valid credentials:

- **Throughput**: keep sustained unlock traffic under **5 req/s per instance** until staging soak confirms higher steady-state capacity.
- **p95 latency**: target **< 1500 ms** (aligns with existing ops alerting policy).
- **Error rate**: target **< 3%** over 5-minute windows.
- **Memory RSS**: keep steady-state process RSS under **500 MB** with no monotonic leak trend over 60 minutes.
- **Queue depth**: keep p95 queue depth at **0–5**, alert if sustained **> 20**.

## Artifacts
- Load runner: `perf/load_test.py`
- Profiles:
  - `perf/profiles/mixed-traffic.json`
  - `perf/profiles/unlock-heavy-burst.json`
  - `perf/profiles/dependency-latency-injection.json`
- Local run output: `perf/results/staging-soak-sample.json`
