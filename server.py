import os
import time
import asyncio
import psutil
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, PlainTextResponse, JSONResponse
from pydantic import BaseModel

from target_service.app import app as target_app, BOTTLENECK_CONFIG
from load_engine.runner import LoadRunner, MetricSnapshot
from load_engine.workloads import WorkloadType
from aiops_engine.detector import AIOpsDetectorCoordinator, AnomalyEvent
from aiops_engine.profiler import ProfilerDiagnosticEngine
from aiops_engine.rca_agent import RCAAIOpsAgent, IncidentReport

# Master Application orchestrating Target Service, Load Engine, and AIOps Coordinator
server_app = target_app

# Core Singletons
load_runner = LoadRunner(base_url="http://127.0.0.1:8000")
aiops_coordinator = AIOpsDetectorCoordinator(p99_slo_ms=200.0)
profiler_engine = ProfilerDiagnosticEngine()
rca_agent = RCAAIOpsAgent()
latest_incident_report: IncidentReport = None

def handle_metric_snapshot(snapshot: MetricSnapshot):
    """Callback invoked by load runner on every 1-second metric tick."""
    global latest_incident_report
    process = psutil.Process()
    mem_info = process.memory_info()
    cpu_pct = process.cpu_percent(interval=None)
    mem_mb = round(mem_info.rss / (1024 * 1024), 2)

    # Ingest into AIOps anomaly coordinator
    anomalies = aiops_coordinator.process_telemetry(
        active_vus=snapshot.active_vus,
        rps=snapshot.rps,
        cpu_pct=cpu_pct,
        memory_mb=mem_mb,
        p99_latency_ms=snapshot.p99_ms,
        error_rate_pct=snapshot.error_rate_pct
    )

    # If anomalies or SLO breach occur, trigger automated RCA
    if anomalies or snapshot.p99_ms > 200.0:
        bottlenecks = BOTTLENECK_CONFIG.model_dump()
        flame_data = profiler_engine.generate_flame_graph(bottlenecks, is_degraded=True)
        telemetry_ctx = {
            "p99_ms": snapshot.p99_ms,
            "rps": snapshot.rps,
            "error_rate_pct": snapshot.error_rate_pct,
            "memory_mb": mem_mb,
            "cpu_pct": cpu_pct,
            "z_score": anomalies[0].anomaly_score if anomalies else 2.5
        }
        latest_incident_report = rca_agent.diagnose(
            recent_anomalies=anomalies,
            telemetry=telemetry_ctx,
            profiling=flame_data,
            bottlenecks=bottlenecks
        )

class StartLoadRequest(BaseModel):
    workload_type: WorkloadType = WorkloadType.BASELINE

@server_app.post("/api/v1/load/start")
async def start_load_test(payload: StartLoadRequest, background_tasks: BackgroundTasks):
    if load_runner.is_running:
        raise HTTPException(status_code=400, detail="A benchmark is already actively executing.")
    
    async def run_task():
        await load_runner.run_benchmark(
            workload_type=payload.workload_type,
            on_snapshot=handle_metric_snapshot
        )

    background_tasks.add_task(run_task)
    return {
        "status": "started",
        "workload_type": payload.workload_type,
        "message": f"Load benchmark '{payload.workload_type}' launched."
    }

@server_app.post("/api/v1/load/stop")
def stop_load_test():
    load_runner.stop()
    return {"status": "stopped", "message": "Load generation terminated."}

@server_app.get("/api/v1/load/status")
def get_load_status():
    latest = load_runner.get_latest_snapshot()
    return {
        "is_running": load_runner.is_running,
        "workload_type": load_runner.current_workload.workload_type if load_runner.current_workload else None,
        "active_vus": load_runner.active_vus,
        "latest_snapshot": latest.__dict__ if latest else None
    }

@server_app.get("/api/v1/load/history")
def get_load_history():
    return {
        "is_running": load_runner.is_running,
        "history": [s.__dict__ for s in load_runner.history]
    }

@server_app.get("/api/v1/aiops/anomalies")
def get_anomalies():
    return {
        "total_anomalies": len(aiops_coordinator.recent_anomalies),
        "anomalies": [a.__dict__ for a in reversed(aiops_coordinator.recent_anomalies)]
    }

@server_app.get("/api/v1/aiops/profiling")
def get_profiling_data():
    bottlenecks = BOTTLENECK_CONFIG.model_dump()
    is_deg = any([
        bottlenecks.get("db_exhaustion_enabled"),
        bottlenecks.get("memory_leak_enabled"),
        bottlenecks.get("cpu_lock_enabled")
    ])
    return profiler_engine.generate_flame_graph(bottlenecks, is_degraded=is_deg)

@server_app.get("/api/v1/aiops/rca")
def get_rca_report():
    global latest_incident_report
    if not latest_incident_report:
        # Generate baseline report
        bottlenecks = BOTTLENECK_CONFIG.model_dump()
        flame_data = profiler_engine.generate_flame_graph(bottlenecks, is_degraded=False)
        latest_incident_report = rca_agent.diagnose(
            recent_anomalies=[],
            telemetry={"p99_ms": 22.0, "rps": 120.0, "error_rate_pct": 0.0, "memory_mb": 65.0, "cpu_pct": 12.0},
            profiling=flame_data,
            bottlenecks=bottlenecks
        )
    return latest_incident_report.to_dict()

@server_app.get("/api/v1/aiops/report/download", response_class=PlainTextResponse)
def download_markdown_report():
    global latest_incident_report
    if not latest_incident_report:
        get_rca_report()
    return Response(content=latest_incident_report.to_markdown(), media_type="text/markdown")

# Static Dashboard UI Mount
DASHBOARD_DIR = os.path.join(os.path.dirname(__file__), "dashboard")
server_app.mount("/static", StaticFiles(directory=DASHBOARD_DIR), name="static")

@server_app.get("/")
def serve_dashboard():
    return FileResponse(os.path.join(DASHBOARD_DIR, "index.html"))

if __name__ == "__main__":
    import uvicorn
    print("Starting AIOps-Pulse Control Center on http://127.0.0.1:8000...")
    uvicorn.run("server:server_app", host="0.0.0.0", port=8000, reload=False)
