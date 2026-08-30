from dataclasses import dataclass
from typing import List, Dict, Any
from enum import Enum

class WorkloadType(str, Enum):
    BASELINE = "baseline"
    SPIKE = "spike"
    SOAK = "soak"
    STRESS = "stress"

@dataclass
class WorkloadStage:
    duration_seconds: int
    target_vus: int

@dataclass
class WorkloadConfig:
    name: str
    workload_type: WorkloadType
    description: str
    stages: List[WorkloadStage]
    target_endpoints: List[str]

WORKLOAD_PRESETS: Dict[str, WorkloadConfig] = {
    WorkloadType.BASELINE: WorkloadConfig(
        name="Baseline SLO Validation",
        workload_type=WorkloadType.BASELINE,
        description="Steady 50 virtual users simulating typical nominal business hours.",
        stages=[
            WorkloadStage(duration_seconds=5, target_vus=20),
            WorkloadStage(duration_seconds=15, target_vus=50),
            WorkloadStage(duration_seconds=5, target_vus=10)
        ],
        target_endpoints=["/api/v1/workspaces", "/api/v1/devices"]
    ),
    WorkloadType.SPIKE: WorkloadConfig(
        name="Sudden Traffic Surge (Spike)",
        workload_type=WorkloadType.SPIKE,
        description="Instantaneous traffic spike from 50 to 500+ concurrent requests.",
        stages=[
            WorkloadStage(duration_seconds=3, target_vus=50),
            WorkloadStage(duration_seconds=8, target_vus=500),
            WorkloadStage(duration_seconds=10, target_vus=600),
            WorkloadStage(duration_seconds=4, target_vus=50)
        ],
        target_endpoints=["/api/v1/workspaces", "/api/v1/devices"]
    ),
    WorkloadType.SOAK: WorkloadConfig(
        name="Endurance / Soak Test",
        workload_type=WorkloadType.SOAK,
        description="Sustained continuous load to uncover steady heap allocation and memory leak regressions.",
        stages=[
            WorkloadStage(duration_seconds=5, target_vus=80),
            WorkloadStage(duration_seconds=25, target_vus=120),
            WorkloadStage(duration_seconds=5, target_vus=40)
        ],
        target_endpoints=["/api/v1/devices/telemetry", "/api/v1/workspaces"]
    ),
    WorkloadType.STRESS: WorkloadConfig(
        name="Capacity Limit (Step-Stress)",
        workload_type=WorkloadType.STRESS,
        description="Incremental ramp-up to determine knee of latency curve and saturation point.",
        stages=[
            WorkloadStage(duration_seconds=5, target_vus=100),
            WorkloadStage(duration_seconds=7, target_vus=300),
            WorkloadStage(duration_seconds=8, target_vus=700),
            WorkloadStage(duration_seconds=6, target_vus=1000)
        ],
        target_endpoints=["/api/v1/workspaces", "/api/v1/devices"]
    )
}
