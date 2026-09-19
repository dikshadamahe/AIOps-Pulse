# ⚡ AIOps-Pulse: Autonomous Performance Engineering & Telemetry Anomaly Detection Platform

[![Python](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688.svg)](https://fastapi.tiangolo.com/)
[![Locust](https://img.shields.io/badge/Locust-2.46%2B-green.svg)](https://locust.io/)
[![Prometheus](https://img.shields.io/badge/Prometheus-Client-orange.svg)](https://prometheus.io/)
[![scikit-learn](https://img.shields.io/badge/scikit--learn-Isolation%20Forest-F7931E.svg)](https://scikit-learn.org/)
[![CI/CD](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-2088FF.svg)](https://github.com/features/actions)

An end-to-end performance benchmarking and AIOps observability platform designed to stress-test enterprise microservices under high concurrency, export real-time golden signals to Prometheus, detect anomalies using **rolling Z-Score and multivariate Isolation Forest**, and automatically generate **Root Cause Analysis (RCA)** incident diagnostics.

---

## 🏛️ Architecture Overview

```
                                  ┌───────────────────────────────┐
                                  │    Load Generation Engine     │
                                  │  (Baseline, Spike, Soak, Step)│
                                  │    Simulates 1k+ Virtual Users│
                                  └───────────────┬───────────────┘
                                                  │ Concurrent HTTP Requests
                                                  ▼
┌──────────────────────────────┐  HTTP Metrics   ┌───────────────────────────────┐
│   AIOps Interactive Console  │ ◄────────────── │       Target Microservice     │
│ - Live p50/p95/p99 Curves    │                 │ (FastAPI + Prometheus Exporter│
│ - Workload & Bottleneck Dials│                 │  + 3 Injected Regressions)    │
│ - Anomaly Event Stream       │                 └───────────────┬───────────────┘
│ - Flame Graph Hotspot Tree   │                                 │ Telemetry
│ - CI/CD Markdown RCA Export  │                                 ▼
└──────────────────────────────┘                 ┌───────────────────────────────┐
               ▲                                 │          AIOps Engine         │
               │                                 │ 1. Rolling Z-Score (Latency)  │
               └─────────────────────────────────┤ 2. Isolation Forest (Vector)  │
                    Root Cause Diagnostic Card   │ 3. Profiler & LLM RCA Agent   │
                                                 └───────────────────────────────┘
```

---

## 🎯 Key Engineering Pillars

### 1. Enterprise Microservice & Injected Regressions (`target_service/`)
A high-throughput API modeling an Omnissa Unified Endpoint Management (UEM) platform (`/workspaces`, `/devices`, `/telemetry`).
- **Prometheus Telemetry Middleware**: Tracks request rate, duration histograms (with fine-grained buckets for sub-millisecond p99 calculations), active concurrent requests, and heap memory bytes.
- **3 Production Regressions**:
  1. **DB Connection Pool Starvation**: Emulates unindexed sequential table scans with thread contention over a finite connection semaphore (5 connections).
  2. **Heap Memory Leak**: Simulates unbounded buffer growth in telemetry ingestion, triggering monotonic heap growth and eventual Out-Of-Memory (OOM).
  3. **Event-Loop CPU Lock**: Synchronous cryptographic hashing loop that starves non-blocking event-loop coroutines.

### 2. High-Throughput Load Benchmarking (`load_engine/`)
- **Async Concurrency Engine**: Native asynchronous worker pool generating configurable workload profiles:
  - **Baseline Test (50 VUs)**: Validates nominal SLOs during standard business traffic.
  - **Spike Test (500+ VUs)**: Tests queue contention, burst tolerance, and auto-recovery.
  - **Soak / Endurance Test (120 VUs)**: Sustained traffic to uncover slow-creeping memory leaks.
  - **Step-Stress Test (up to 1,000 VUs)**: Determines knee of the latency curve and maximum saturation throughput.
- **Locust Benchmark Suite**: Pre-configured `locustfile.py` for distributed headless or CLI benchmarking.

### 3. AIOps Anomaly Detection (`aiops_engine/detector.py`)
- **Statistical Detector (Rolling Z-Score)**:
  $$Z = \frac{x - \mu}{\sigma}$$
  Computes rolling mean and variance over a sliding window of p99 latency samples. Automatically triggers `WARNING` ($Z \ge 2.8\sigma$) or `CRITICAL` ($Z \ge 4.0\sigma$) alerts.
- **Multivariate ML Detector (Isolation Forest)**:
  Evaluates 6-dimensional telemetry vectors `[active_vus, rps, cpu_pct, memory_mb, p99_latency_ms, error_rate]`. Identifies subtle correlated degradation patterns *before* fatal service disruption.

### 4. Automated Root Cause Analysis (RCA) & Flame Graph Profiler
- Automatically attributes incidents to specific call-stack hotspots:
  - `DB_POOL_SEMAPHORE.acquire` (68% execution share)
  - `LEAKED_MEMORY_BUFFER.append` (74% allocation share)
  - `hashlib.sha256` (88.5% CPU spinlock)
- Generates prescriptive remediation action plans (indexing, connection pool sizing, background worker offloading) exportable as markdown audit reports.

---

## 🚀 Quickstart

### Prerequisites
- Python 3.10+
- (Optional) Docker and Docker Compose

### 1. Run with Python Local Environment
```bash
# 1. Clone or navigate to the repository
cd aiops-pulse

# 2. Activate virtual environment
source venv/bin/activate

# 3. Start the unified control center & target service
python server.py
```
Open your browser to: **`http://localhost:8000`**

### 2. Run with Docker Compose (Full Observability Stack)
```bash
docker-compose -f docker/docker-compose.yml up --build
```
- **AIOps-Pulse Web Console**: `http://localhost:8000`
- **Prometheus Metrics Scraper**: `http://localhost:9090`
- **Grafana Dashboard**: `http://localhost:3000` (admin/admin)

---

## 🧪 Interactive Testing Walkthrough

1. **Nominal State**: Open `http://localhost:8000`. Click **"Start Benchmark"** on *Nominal Baseline*. Notice p99 latency hovers around 15–30ms, RPS scales cleanly, and 0 anomalies are flagged.
2. **Simulate DB Contention**: Toggle **"DB Connection Pool Starvation"** ON. Notice p99 latency diverges beyond the 200ms SLO limit to 1,200ms+. The **Z-Score Detector** immediately flags a statistical anomaly ($Z > 3.5\sigma$), and the **RCA card** attributes the degradation to `DB_POOL_SEMAPHORE.acquire`.
3. **Simulate Memory Leak**: Toggle **"Heap Memory Leak"** ON during a *Soak Test*. Watch the memory footprint climb linearly. The **Isolation Forest** flags a multivariate anomaly even before request errors occur.
4. **Export Audit Report**: Click **"Export CI/CD Audit Report"** to download an executive incident breakdown.

---

## 💼 Omnissa Sr. Performance Engineer Interview Guide

When interviewing for Performance Engineering / SRE roles at Omnissa, reference this project directly:

### Q1: "How do you distinguish between application bottlenecks and infrastructure bottlenecks?"
> *"In AIOps-Pulse, I correlated application-level latency percentiles (p50/p95/p99) with infrastructure metrics (CPU %, RSS memory, thread saturation). When p50 remained low but p99 diverged sharply under high concurrency, our Isolation Forest and flame-graph profiler attributed the root cause to database connection semaphore starvation rather than host CPU saturation. Profiling revealed 68% of thread time was spent in `acquire()` waits on an unindexed query."*

### Q2: "Why use p99 latency instead of average response time?"
> *"Averages hide the long-tail latency experienced by enterprise customers. In our baseline tests, an average response time of 45ms concealed a p99 latency spike of 1,800ms caused by connection pool queue delays. For strict SLO compliance, p99 and p99.9 provide the true measure of user experience and system capacity."*

### Q3: "How do you incorporate AI/ML into modern Performance Engineering?"
> *"Static alert thresholds (e.g. CPU > 80%) generate high false-positive rates during benign traffic spikes. In AIOps-Pulse, I implemented rolling Z-scoring to adaptively detect abnormal latency variance, combined with multivariate Isolation Forest to detect cross-metric anomalies (such as linear heap accumulation during steady VU loads) before SLO degradation becomes catastrophic."*
