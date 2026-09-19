import pytest
import numpy as np
from fastapi.testclient import TestClient
from target_service.app import app
from aiops_engine.detector import RollingZScoreDetector, TelemetryIsolationForestDetector, AIOpsDetectorCoordinator
from aiops_engine.profiler import ProfilerDiagnosticEngine
from aiops_engine.rca_agent import RCAAIOpsAgent

client = TestClient(app)

def test_health_and_endpoints():
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    res_ws = client.get("/api/v1/workspaces")
    assert res_ws.status_code == 200
    assert len(res_ws.json()) > 0

    res_dev = client.get("/api/v1/devices")
    assert res_dev.status_code == 200
    assert len(res_dev.json()) > 0

def test_prometheus_metrics_export():
    res = client.get("/metrics")
    assert res.status_code == 200
    assert "aiops_http_requests_total" in res.text
    assert "aiops_http_request_duration_seconds" in res.text
    assert "aiops_active_requests" in res.text

def test_bottleneck_toggling():
    # Enable DB starvation
    config = {
        "db_exhaustion_enabled": True,
        "db_simulated_delay_ms": 10.0,
        "memory_leak_enabled": False,
        "memory_leak_chunk_kb": 128,
        "cpu_lock_enabled": False,
        "cpu_lock_iterations": 1000
    }
    res = client.post("/api/v1/admin/bottlenecks", json=config)
    assert res.status_code == 200

    status_res = client.get("/api/v1/admin/status")
    assert status_res.json()["bottlenecks"]["db_exhaustion_enabled"] is True

    # Reset
    reset_res = client.post("/api/v1/admin/reset")
    assert reset_res.status_code == 200
    assert client.get("/api/v1/admin/status").json()["bottlenecks"]["db_exhaustion_enabled"] is False

def test_statistical_zscore_detector():
    detector = RollingZScoreDetector(window_size=20, z_threshold=2.8)
    # Feed 15 baseline samples around 20ms
    for _ in range(15):
        val = np.random.normal(20.0, 2.0)
        detector.evaluate("p99_latency_ms", val)

    # Now inject an extreme spike (150ms)
    spike_alert = detector.evaluate("p99_latency_ms", 150.0)
    assert spike_alert is not None
    assert spike_alert.detector_type == "Z-SCORE"
    assert spike_alert.severity in ["WARNING", "CRITICAL"]
    assert spike_alert.anomaly_score >= 2.8

def test_multivariate_isolation_forest():
    iforest = TelemetryIsolationForestDetector(contamination=0.1)
    assert iforest.is_fitted is True

    # Normal sample: 50 VUs, 100 RPS, 20% CPU, 60MB RAM, 25ms p99, 0% err
    normal_alert = iforest.evaluate(
        active_vus=50,
        rps=100.0,
        cpu_pct=20.0,
        memory_mb=60.0,
        p99_latency_ms=25.0,
        error_rate_pct=0.0
    )
    # Severe anomaly: 900 VUs, 88% CPU, 450MB RAM, 2400ms p99, 12% err
    severe_alert = iforest.evaluate(
        active_vus=900,
        rps=30.0,
        cpu_pct=95.0,
        memory_mb=650.0,
        p99_latency_ms=3500.0,
        error_rate_pct=15.0
    )
    assert severe_alert is not None
    assert severe_alert.detector_type == "ISOLATION-FOREST"

def test_rca_diagnostic_agent():
    rca = RCAAIOpsAgent()
    profiler = ProfilerDiagnosticEngine()
    bottlenecks = {"db_exhaustion_enabled": True, "memory_leak_enabled": False, "cpu_lock_enabled": False}
    flame = profiler.generate_flame_graph(bottlenecks, is_degraded=True)

    report = rca.diagnose(
        recent_anomalies=[],
        telemetry={"p99_ms": 1420.0, "rps": 35.0, "error_rate_pct": 2.5, "memory_mb": 95.0, "cpu_pct": 45.0},
        profiling=flame,
        bottlenecks=bottlenecks
    )

    assert report.severity == "CRITICAL"
    assert "Database Connection Pool Starvation" in report.title
    assert report.confidence_pct >= 90
    assert len(report.prescriptive_remediation) >= 3
    assert "p99" in report.to_markdown()
