import time
import hashlib
import asyncio
import uuid
import os
import psutil
from typing import List, Dict
from fastapi import FastAPI, Request, Response, HTTPException, status
from fastapi.responses import PlainTextResponse, JSONResponse

from target_service.models import Workspace, Device, BottleneckConfig, SystemStatus
from target_service.metrics import (
    REQUEST_COUNT,
    REQUEST_LATENCY,
    ACTIVE_REQUESTS,
    HEAP_ALLOCATION_BYTES,
    DB_POOL_WAIT_SECONDS,
    BOTTLENECK_ACTIVE,
    get_latest_metrics
)

app = FastAPI(
    title="Omnissa UEM Target Microservice",
    description="Instrumented microservice simulating an enterprise Unified Endpoint Management service with deliberate performance regressions.",
    version="1.0.0"
)

# In-memory storage & state
START_TIME = time.time()
BOTTLENECK_CONFIG = BottleneckConfig()
LEAKED_MEMORY_BUFFER: List[bytes] = []

# Mock databases representing UEM Workspaces and Endpoints
WORKSPACES_DB: Dict[str, Workspace] = {
    f"ws-{i}": Workspace(
        id=f"ws-{i}",
        name=f"Enterprise-Workspace-{i}",
        tenant_id=f"tenant-{(i % 5) + 1}",
        device_count=50 + (i * 3)
    ) for i in range(1, 25)
}

DEVICES_DB: Dict[str, Device] = {
    f"dev-{i:04d}": Device(
        id=f"dev-{i:04d}",
        workspace_id=f"ws-{(i % 24) + 1}",
        os_type=["Windows 11", "macOS Sonoma", "Ubuntu 22.04", "iOS 17", "Android 14"][i % 5],
        ip_address=f"10.20.{i // 256}.{i % 256}",
        agent_version="v24.08.1"
    ) for i in range(1, 150)
}

# Concurrency lock to simulate database connection pool limit (e.g., 5 connections max)
DB_POOL_SEMAPHORE = asyncio.Semaphore(5)

@app.middleware("http")
async def prometheus_telemetry_middleware(request: Request, call_next):
    """Measures latency, updates active request gauges, and exports to Prometheus."""
    # Skip metrics and admin endpoints from polluting golden signals
    path = request.url.path
    if path in ["/metrics", "/api/v1/admin/status"]:
        return await call_next(request)

    method = request.method
    ACTIVE_REQUESTS.inc()
    start_t = time.perf_counter()
    status_code = 500

    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    except Exception as exc:
        status_code = 500
        raise exc
    finally:
        duration = time.perf_counter() - start_t
        ACTIVE_REQUESTS.dec()
        REQUEST_COUNT.labels(endpoint=path, method=method, status=str(status_code)).inc()
        REQUEST_LATENCY.labels(endpoint=path, method=method).observe(duration)

@app.get("/metrics", response_class=PlainTextResponse)
def metrics_endpoint():
    """Exposes native Prometheus metrics for scraping."""
    data, content_type = get_latest_metrics()
    return Response(content=data, media_type=content_type)

@app.get("/api/v1/health")
def health_check():
    return {"status": "ok", "service": "omnissa-uem-target", "timestamp": time.time()}

@app.get("/api/v1/workspaces", response_model=List[Workspace])
async def list_workspaces():
    """Lists enterprise workspaces, with optional DB pool starvation regression."""
    if BOTTLENECK_CONFIG.db_exhaustion_enabled:
        wait_start = time.perf_counter()
        # Contend for limited DB connection pool (semaphore of 5)
        async with DB_POOL_SEMAPHORE:
            wait_time = time.perf_counter() - wait_start
            DB_POOL_WAIT_SECONDS.observe(wait_time)
            # Simulate high-latency unindexed sequential table scan
            delay_sec = BOTTLENECK_CONFIG.db_simulated_delay_ms / 1000.0
            await asyncio.sleep(delay_sec)

    if BOTTLENECK_CONFIG.memory_leak_enabled:
        # Leak memory by appending uncollected garbage to global buffer
        chunk_bytes = os.urandom(BOTTLENECK_CONFIG.memory_leak_chunk_kb * 1024)
        LEAKED_MEMORY_BUFFER.append(chunk_bytes)
        retained = sum(len(c) for c in LEAKED_MEMORY_BUFFER)
        HEAP_ALLOCATION_BYTES.set(retained)

    if BOTTLENECK_CONFIG.cpu_lock_enabled:
        # Simulate synchronous CPU-bound cryptographic hash loop blocking the event thread
        dummy = b"omnissa-uem-workload-data"
        for _ in range(BOTTLENECK_CONFIG.cpu_lock_iterations):
            dummy = hashlib.sha256(dummy).digest()

    return list(WORKSPACES_DB.values())

@app.post("/api/v1/workspaces", status_code=status.HTTP_201_CREATED, response_model=Workspace)
async def create_workspace(ws: Workspace):
    WORKSPACES_DB[ws.id] = ws
    return ws

@app.get("/api/v1/devices", response_model=List[Device])
async def list_devices(limit: int = 50):
    """Returns enrolled devices under management."""
    if BOTTLENECK_CONFIG.db_exhaustion_enabled:
        async with DB_POOL_SEMAPHORE:
            await asyncio.sleep(BOTTLENECK_CONFIG.db_simulated_delay_ms / 1000.0)
    return list(DEVICES_DB.values())[:limit]

@app.get("/api/v1/devices/{device_id}", response_model=Device)
async def get_device(device_id: str):
    if device_id not in DEVICES_DB:
        raise HTTPException(status_code=404, detail="Device not found")
    return DEVICES_DB[device_id]

@app.post("/api/v1/devices/telemetry")
async def submit_device_telemetry(payload: Dict):
    """Simulates high-frequency endpoint agent heartbeat ingestion."""
    if BOTTLENECK_CONFIG.memory_leak_enabled:
        chunk_bytes = os.urandom(BOTTLENECK_CONFIG.memory_leak_chunk_kb * 1024)
        LEAKED_MEMORY_BUFFER.append(chunk_bytes)
        retained = sum(len(c) for c in LEAKED_MEMORY_BUFFER)
        HEAP_ALLOCATION_BYTES.set(retained)

    return {"status": "ingested", "device_id": payload.get("device_id", "unknown")}

# Admin & Performance Experiment Controls
@app.get("/api/v1/admin/status")
def get_system_status():
    retained_kb = sum(len(c) for c in LEAKED_MEMORY_BUFFER) // 1024
    process = psutil.Process()
    mem_info = process.memory_info()
    return {
        "status": "online",
        "uptime_seconds": round(time.time() - START_TIME, 2),
        "bottlenecks": BOTTLENECK_CONFIG.model_dump(),
        "heap_retained_kb": retained_kb,
        "rss_memory_mb": round(mem_info.rss / (1024 * 1024), 2),
        "cpu_percent": process.cpu_percent(interval=None)
    }

@app.post("/api/v1/admin/bottlenecks")
def update_bottlenecks(config: BottleneckConfig):
    global BOTTLENECK_CONFIG
    BOTTLENECK_CONFIG.db_exhaustion_enabled = config.db_exhaustion_enabled
    BOTTLENECK_CONFIG.db_simulated_delay_ms = config.db_simulated_delay_ms
    BOTTLENECK_CONFIG.memory_leak_enabled = config.memory_leak_enabled
    BOTTLENECK_CONFIG.memory_leak_chunk_kb = config.memory_leak_chunk_kb
    BOTTLENECK_CONFIG.cpu_lock_enabled = config.cpu_lock_enabled
    BOTTLENECK_CONFIG.cpu_lock_iterations = config.cpu_lock_iterations

    BOTTLENECK_ACTIVE.labels(bottleneck_type="db_exhaustion").set(1 if config.db_exhaustion_enabled else 0)
    BOTTLENECK_ACTIVE.labels(bottleneck_type="memory_leak").set(1 if config.memory_leak_enabled else 0)
    BOTTLENECK_ACTIVE.labels(bottleneck_type="cpu_lock").set(1 if config.cpu_lock_enabled else 0)

    return {"status": "updated", "config": BOTTLENECK_CONFIG}

@app.post("/api/v1/admin/reset")
def reset_state():
    global LEAKED_MEMORY_BUFFER, BOTTLENECK_CONFIG
    LEAKED_MEMORY_BUFFER.clear()
    HEAP_ALLOCATION_BYTES.set(0)
    BOTTLENECK_CONFIG.db_exhaustion_enabled = False
    BOTTLENECK_CONFIG.memory_leak_enabled = False
    BOTTLENECK_CONFIG.cpu_lock_enabled = False
    BOTTLENECK_ACTIVE.labels(bottleneck_type="db_exhaustion").set(0)
    BOTTLENECK_ACTIVE.labels(bottleneck_type="memory_leak").set(0)
    BOTTLENECK_ACTIVE.labels(bottleneck_type="cpu_lock").set(0)
    return {"status": "reset", "detail": "Memory buffers cleared and bottlenecks deactivated."}
