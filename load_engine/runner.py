import asyncio
import time
import math
import random
import httpx
import numpy as np
from typing import List, Dict, Any, Optional, Callable
from dataclasses import dataclass, field

from load_engine.workloads import WorkloadConfig, WorkloadType, WORKLOAD_PRESETS

@dataclass
class MetricSnapshot:
    timestamp: float
    elapsed_seconds: float
    active_vus: int
    rps: float
    total_requests: int
    successful_requests: int
    failed_requests: int
    error_rate_pct: float
    p50_ms: float
    p75_ms: float
    p90_ms: float
    p95_ms: float
    p99_ms: float
    p999_ms: float
    avg_latency_ms: float
    max_latency_ms: float

class LoadRunner:
    """High-throughput async load generator and performance benchmark executor."""

    def __init__(self, base_url: str = "http://127.0.0.1:8000"):
        self.base_url = base_url.rstrip("/")
        self.is_running: bool = False
        self.current_workload: Optional[WorkloadConfig] = None
        self.raw_latencies: List[float] = []
        self.interval_latencies: List[float] = []
        self.interval_successes: int = 0
        self.interval_failures: int = 0
        self.total_requests: int = 0
        self.total_failures: int = 0
        self.history: List[MetricSnapshot] = []
        self.active_vus: int = 0
        self.start_time: float = 0.0
        self._stop_event = asyncio.Event()

    def get_latest_snapshot(self) -> Optional[MetricSnapshot]:
        return self.history[-1] if self.history else None

    async def run_benchmark(
        self,
        workload_type: WorkloadType,
        on_snapshot: Optional[Callable[[MetricSnapshot], None]] = None
    ) -> List[MetricSnapshot]:
        """Runs the specified workload and computes time-series latency percentiles."""
        self.current_workload = WORKLOAD_PRESETS.get(workload_type, WORKLOAD_PRESETS[WorkloadType.BASELINE])
        self.is_running = True
        self._stop_event.clear()
        self.raw_latencies.clear()
        self.interval_latencies.clear()
        self.history.clear()
        self.interval_successes = 0
        self.interval_failures = 0
        self.total_requests = 0
        self.total_failures = 0
        self.start_time = time.time()

        # Limits for httpx connection pool
        limits = httpx.Limits(max_keepalive_connections=500, max_connections=1500)
        timeout = httpx.Timeout(10.0, connect=3.0)

        async with httpx.AsyncClient(limits=limits, timeout=timeout) as client:
            worker_tasks = []
            
            # Start background metric collector (every 1 second)
            collector_task = asyncio.create_task(self._metric_sampling_loop(on_snapshot))

            try:
                for stage in self.current_workload.stages:
                    if self._stop_event.is_set():
                        break
                    
                    target_vus = stage.target_vus
                    stage_duration = stage.duration_seconds
                    self.active_vus = target_vus
                    
                    # Launch workers to fulfill target_vus
                    stage_end = time.time() + stage_duration
                    semaphore = asyncio.Semaphore(target_vus)

                    async def worker():
                        while time.time() < stage_end and not self._stop_event.is_set():
                            async with semaphore:
                                endpoint = random.choice(self.current_workload.target_endpoints)
                                url = f"{self.base_url}{endpoint}"
                                req_start = time.perf_counter()
                                try:
                                    if endpoint.endswith("/telemetry"):
                                        res = await client.post(url, json={"device_id": f"dev-{random.randint(1, 100)}"})
                                    else:
                                        res = await client.get(url)
                                    
                                    dur_ms = (time.perf_counter() - req_start) * 1000.0
                                    self.interval_latencies.append(dur_ms)
                                    self.raw_latencies.append(dur_ms)

                                    if res.status_code < 400:
                                        self.interval_successes += 1
                                    else:
                                        self.interval_failures += 1
                                        self.total_failures += 1
                                except Exception:
                                    dur_ms = (time.perf_counter() - req_start) * 1000.0
                                    self.interval_latencies.append(dur_ms)
                                    self.raw_latencies.append(dur_ms)
                                    self.interval_failures += 1
                                    self.total_failures += 1
                                finally:
                                    self.total_requests += 1

                                # Pacing sleep (realistic think time between 10ms and 50ms)
                                await asyncio.sleep(random.uniform(0.01, 0.05))

                    workers = [asyncio.create_task(worker()) for _ in range(min(target_vus, 150))]
                    await asyncio.gather(*workers)

            finally:
                self.is_running = False
                self.active_vus = 0
                collector_task.cancel()
                try:
                    await collector_task
                except asyncio.CancelledError:
                    pass

        return self.history

    async def _metric_sampling_loop(self, callback: Optional[Callable[[MetricSnapshot], None]]):
        """Samples interval throughput and latency percentiles every 1 second."""
        prev_time = time.time()
        while not self._stop_event.is_set():
            await asyncio.sleep(1.0)
            now = time.time()
            elapsed_interval = now - prev_time
            prev_time = now

            cur_latencies = list(self.interval_latencies)
            self.interval_latencies.clear()
            req_count = len(cur_latencies)
            rps = req_count / elapsed_interval if elapsed_interval > 0 else 0.0

            cur_failures = self.interval_failures
            self.interval_failures = 0
            cur_successes = self.interval_successes
            self.interval_successes = 0

            err_pct = (cur_failures / req_count * 100.0) if req_count > 0 else 0.0

            if cur_latencies:
                arr = np.array(cur_latencies)
                p50 = float(np.percentile(arr, 50))
                p75 = float(np.percentile(arr, 75))
                p90 = float(np.percentile(arr, 90))
                p95 = float(np.percentile(arr, 95))
                p99 = float(np.percentile(arr, 99))
                p999 = float(np.percentile(arr, 99.9))
                avg_lat = float(np.mean(arr))
                max_lat = float(np.max(arr))
            else:
                p50 = p75 = p90 = p95 = p99 = p999 = avg_lat = max_lat = 0.0

            snapshot = MetricSnapshot(
                timestamp=now,
                elapsed_seconds=round(now - self.start_time, 1),
                active_vus=self.active_vus,
                rps=round(rps, 2),
                total_requests=self.total_requests,
                successful_requests=self.total_requests - self.total_failures,
                failed_requests=self.total_failures,
                error_rate_pct=round(err_pct, 2),
                p50_ms=round(p50, 2),
                p75_ms=round(p75, 2),
                p90_ms=round(p90, 2),
                p95_ms=round(p95, 2),
                p99_ms=round(p99, 2),
                p999_ms=round(p999, 2),
                avg_latency_ms=round(avg_lat, 2),
                max_latency_ms=round(max_lat, 2)
            )
            self.history.append(snapshot)
            if callback:
                try:
                    callback(snapshot)
                except Exception:
                    pass

    def stop(self):
        self._stop_event.set()
        self.is_running = False
        self.active_vus = 0
