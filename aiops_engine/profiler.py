import time
from typing import List, Dict, Any

class FlameNode:
    def __init__(self, name: str, value: float, children: List['FlameNode'] = None):
        self.name = name
        self.value = value  # percentage or execution samples
        self.children = children or []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "value": self.value,
            "children": [child.to_dict() for child in self.children]
        }

class ProfilerDiagnosticEngine:
    """Generates call-stack profiling traces and flame graph trees."""

    def generate_flame_graph(self, bottlenecks: Dict[str, Any], is_degraded: bool) -> Dict[str, Any]:
        """Synthesizes flame graph call tree reflecting active bottleneck state."""
        
        db_on = bottlenecks.get("db_exhaustion_enabled", False)
        mem_on = bottlenecks.get("memory_leak_enabled", False)
        cpu_on = bottlenecks.get("cpu_lock_enabled", False)

        if cpu_on:
            root = FlameNode("uvicorn.run", 100.0, [
                FlameNode("FastAPI.__call__", 98.5, [
                    FlameNode("dispatch_request", 97.2, [
                        FlameNode("list_workspaces", 94.0, [
                            FlameNode("hashlib.sha256 (CPU-bound spinlock)", 88.5, [
                                FlameNode("_hashlib.openssl_sha256", 86.2)
                            ]),
                            FlameNode("db_serialize", 5.5)
                        ]),
                        FlameNode("prometheus_middleware", 3.2)
                    ])
                ])
            ])
            return {
                "bottleneck_type": "CPU_CONTENTION",
                "hotspot_function": "hashlib.sha256",
                "hotspot_share_pct": 88.5,
                "tree": root.to_dict()
            }

        elif db_on:
            root = FlameNode("uvicorn.run", 100.0, [
                FlameNode("FastAPI.__call__", 98.8, [
                    FlameNode("dispatch_request", 97.5, [
                        FlameNode("list_workspaces", 95.0, [
                            FlameNode("asyncio.Semaphore.acquire (Connection Wait)", 68.0, [
                                FlameNode("DB_POOL_SEMAPHORE.wait_for_connection", 65.5)
                            ]),
                            FlameNode("postgres_seq_scan (Unindexed query)", 24.5),
                            FlameNode("json_response_render", 2.5)
                        ]),
                        FlameNode("prometheus_middleware", 2.5)
                    ])
                ])
            ])
            return {
                "bottleneck_type": "DB_POOL_STARVATION",
                "hotspot_function": "DB_POOL_SEMAPHORE.acquire",
                "hotspot_share_pct": 68.0,
                "tree": root.to_dict()
            }

        elif mem_on:
            root = FlameNode("uvicorn.run", 100.0, [
                FlameNode("FastAPI.__call__", 98.2, [
                    FlameNode("dispatch_request", 96.5, [
                        FlameNode("submit_device_telemetry", 91.0, [
                            FlameNode("LEAKED_MEMORY_BUFFER.append (Heap Retain)", 74.0, [
                                FlameNode("os.urandom / alloc_raw_bytes", 69.5)
                            ]),
                            FlameNode("json_parse", 17.0)
                        ]),
                        FlameNode("prometheus_middleware", 5.5)
                    ])
                ])
            ])
            return {
                "bottleneck_type": "HEAP_MEMORY_LEAK",
                "hotspot_function": "LEAKED_MEMORY_BUFFER.append",
                "hotspot_share_pct": 74.0,
                "tree": root.to_dict()
            }

        else:
            # Nominal, healthy flame graph
            root = FlameNode("uvicorn.run", 100.0, [
                FlameNode("FastAPI.__call__", 98.0, [
                    FlameNode("dispatch_request", 95.0, [
                        FlameNode("list_workspaces", 45.0, [
                            FlameNode("fastapi.routing.solve_dependencies", 18.0),
                            FlameNode("db_in_memory_lookup", 15.0),
                            FlameNode("json_serialization", 12.0)
                        ]),
                        FlameNode("list_devices", 35.0, [
                            FlameNode("db_query_indexed", 20.0),
                            FlameNode("response_encode", 15.0)
                        ]),
                        FlameNode("prometheus_middleware", 15.0)
                    ])
                ])
            ])
            return {
                "bottleneck_type": "NONE_NOMINAL",
                "hotspot_function": "None (Balanced distribution)",
                "hotspot_share_pct": 0.0,
                "tree": root.to_dict()
            }
