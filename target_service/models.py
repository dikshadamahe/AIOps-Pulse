from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from datetime import datetime, timezone

class Workspace(BaseModel):
    id: str
    name: str
    tenant_id: str
    device_count: int = Field(default=0)
    compliance_status: str = Field(default="compliant")
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class Device(BaseModel):
    id: str
    workspace_id: str
    os_type: str = Field(default="Windows 11")
    ip_address: str = Field(default="10.0.0.1")
    agent_version: str = Field(default="v24.08")
    last_heartbeat: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class BottleneckConfig(BaseModel):
    db_exhaustion_enabled: bool = False
    db_simulated_delay_ms: float = 120.0
    memory_leak_enabled: bool = False
    memory_leak_chunk_kb: int = 256
    cpu_lock_enabled: bool = False
    cpu_lock_iterations: int = 150000

class SystemStatus(BaseModel):
    status: str = "healthy"
    bottlenecks: BottleneckConfig
    active_requests: int = 0
    heap_retained_kb: int = 0
    uptime_seconds: float = 0.0
