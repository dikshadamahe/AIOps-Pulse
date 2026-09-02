from locust import HttpUser, task, between, events
import random
import logging

class OmnissaPlatformUser(HttpUser):
    """
    Locust user class simulating Omnissa UEM platform workloads:
    - Workspace listings
    - Device inventory querying
    - Endpoint telemetry ingestion
    """
    wait_time = between(0.05, 0.2)  # High frequency concurrency

    @task(4)
    def list_workspaces(self):
        with self.client.get("/api/v1/workspaces", catch_response=True) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Failed with HTTP {response.status_code}")

    @task(3)
    def get_devices(self):
        with self.client.get("/api/v1/devices?limit=25", catch_response=True) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Failed with status {response.status_code}")

    @task(2)
    def send_agent_telemetry(self):
        payload = {
            "device_id": f"dev-{random.randint(1, 150):04d}",
            "status": "healthy",
            "cpu_usage": round(random.uniform(5.0, 45.0), 1),
            "memory_usage": round(random.uniform(20.0, 80.0), 1)
        }
        with self.client.post("/api/v1/devices/telemetry", json=payload, catch_response=True) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Telemetry POST failed: {response.status_code}")
