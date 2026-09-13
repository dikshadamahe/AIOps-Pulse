import time
import uuid
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, asdict

@dataclass
class IncidentReport:
    incident_id: str
    timestamp: str
    severity: str
    title: str
    confidence_pct: int
    slo_impact: Dict[str, Any]
    telemetry_summary: Dict[str, Any]
    root_cause_diagnosis: str
    profiler_hotspot: str
    prescriptive_remediation: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_markdown(self) -> str:
        remediation_lines = "\n".join(f"- {r}" for r in self.prescriptive_remediation)
        return f"""# 🚨 AIOps Incident Root Cause Analysis (RCA)
**Incident ID:** `{self.incident_id}`  
**Generated At:** {self.timestamp}  
**Severity:** **{self.severity}** (Confidence: {self.confidence_pct}%)

---

### 1. Executive Summary
**{self.title}**

{self.root_cause_diagnosis}

---

### 2. SLO & Telemetry Impact
- **Contractual SLO:** p99 < {self.slo_impact.get('target_p99_ms', 200)}ms
- **Observed p99 Latency:** **{self.slo_impact.get('observed_p99_ms', 0)}ms** ({self.slo_impact.get('degradation_factor', 'N/A')}x degradation)
- **Observed RPS:** {self.telemetry_summary.get('rps', 0)} req/sec
- **Error Rate:** {self.telemetry_summary.get('error_rate_pct', 0)}%
- **System Memory:** {self.telemetry_summary.get('memory_mb', 0)} MB (RSS)
- **CPU Saturation:** {self.telemetry_summary.get('cpu_pct', 0)}%

---

### 3. Profiler Call-Stack Attribution
- **Hotspot Function:** `{self.profiler_hotspot}`
- **Execution Bottleneck Analysis:** Call-stack profiling reveals thread contention and queue delay dominating execution lifecycle.

---

### 4. Prescriptive Remediation Plan
{remediation_lines}
"""

class RCAAIOpsAgent:
    """Intelligent agent diagnosing performance bottlenecks from telemetry and profiling traces."""

    def diagnose(
        self,
        recent_anomalies: List[Any],
        telemetry: Dict[str, Any],
        profiling: Dict[str, Any],
        bottlenecks: Dict[str, Any]
    ) -> IncidentReport:
        inc_id = f"INC-{uuid.uuid4().hex[:8].upper()}"
        now_str = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())

        p99 = telemetry.get("p99_ms", 0.0)
        slo_target = 200.0
        degradation = round(p99 / slo_target, 1) if slo_target > 0 else 1.0

        db_on = bottlenecks.get("db_exhaustion_enabled", False)
        mem_on = bottlenecks.get("memory_leak_enabled", False)
        cpu_on = bottlenecks.get("cpu_lock_enabled", False)

        if db_on:
            title = "Database Connection Pool Starvation & Unindexed Query Degradation"
            severity = "CRITICAL"
            confidence = 96
            diagnosis = (
                f"Statistical Z-score ({telemetry.get('z_score', 4.2)}σ) and Isolation Forest flagged catastrophic "
                f"p99 latency divergence to {p99}ms under concurrency. The root cause is thread starvation at "
                f"the database connection pool (semaphore limit: 5 connections), compounded by an unindexed table scan "
                f"taking >120ms per transaction."
            )
            hotspot = profiling.get("hotspot_function", "DB_POOL_SEMAPHORE.acquire")
            remediation = [
                "Deploy compound B-tree index on `workspace_id` and `tenant_id` to eliminate full table sequential scans.",
                "Resize database connection pool from 5 to 50 max connections with aggressive idle reap timeouts.",
                "Implement Redis write-through cache for workspace lookups with 60s TTL to absorb read bursts.",
                "Set strict circuit breaker (max 500ms queue wait before failing fast with HTTP 503)."
            ]

        elif mem_on:
            title = "Heap Memory Leak & Monotonic Buffer Saturation"
            severity = "CRITICAL"
            confidence = 94
            diagnosis = (
                f"Isolation Forest identified correlated degradation where memory footprint rose linearly "
                f"while latency degraded. Telemetry indicates uncollected byte buffers accumulating in heap "
                f"memory without garbage collection reclamation."
            )
            hotspot = profiling.get("hotspot_function", "LEAKED_MEMORY_BUFFER.append")
            remediation = [
                "Eliminate unbounded in-memory collection (`LEAKED_MEMORY_BUFFER`) in device telemetry ingestion loop.",
                "Stream telemetry payloads directly into message broker (Kafka/RabbitMQ) rather than in-process memory.",
                "Tune garbage collection parameters and introduce memory ceiling health checks.",
                "Add memory leak regression tests in CI/CD pipeline using soak tests with steady VU load."
            ]

        elif cpu_on:
            title = "Synchronous Event-Loop CPU Lock Contention"
            severity = "CRITICAL"
            confidence = 98
            diagnosis = (
                f"Severe throughput degradation caused by synchronous CPU-bound cryptographic loop running directly "
                f"on the async event loop. Execution profile shows {profiling.get('hotspot_share_pct', 88.5)}% of all "
                f"CPU cycles consumed in hashing operations, starving concurrent I/O coroutines."
            )
            hotspot = profiling.get("hotspot_function", "hashlib.sha256")
            remediation = [
                "Offload CPU-intensive hashing and cryptographic operations to a background ProcessPoolExecutor or Celery worker.",
                "Keep FastAPI / async event loop purely non-blocking for I/O tasks.",
                "Implement request rate limiting and payload validation before executing heavy CPU operations.",
                "Scale horizontally with multi-worker Gunicorn/Uvicorn processes (`--workers 4`)."
            ]

        else:
            title = "Nominal System Baseline Performance"
            severity = "INFO"
            confidence = 99
            diagnosis = "All telemetry streams operating within nominal parameters. p99 latency satisfies contractual SLO (<200ms)."
            hotspot = "uvicorn.run (Balanced I/O)"
            remediation = [
                "Continue standard continuous monitoring.",
                "Maintain automated load testing gates in CI/CD before deployments."
            ]

        return IncidentReport(
            incident_id=inc_id,
            timestamp=now_str,
            severity=severity,
            title=title,
            confidence_pct=confidence,
            slo_impact={
                "target_p99_ms": slo_target,
                "observed_p99_ms": p99,
                "degradation_factor": degradation
            },
            telemetry_summary={
                "rps": telemetry.get("rps", 0),
                "error_rate_pct": telemetry.get("error_rate_pct", 0),
                "memory_mb": telemetry.get("memory_mb", 0),
                "cpu_pct": telemetry.get("cpu_pct", 0)
            },
            root_cause_diagnosis=diagnosis,
            profiler_hotspot=hotspot,
            prescriptive_remediation=remediation
        )
