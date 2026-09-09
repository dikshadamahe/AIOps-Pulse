import time
import numpy as np
from typing import List, Dict, Any, Optional
from collections import deque
from sklearn.ensemble import IsolationForest
from dataclasses import dataclass, field

@dataclass
class AnomalyEvent:
    timestamp: float
    detector_type: str  # "Z-SCORE" | "ISOLATION-FOREST" | "SLO-BREACH"
    severity: str        # "INFO" | "WARNING" | "CRITICAL"
    metric_name: str
    observed_value: float
    expected_value: float
    anomaly_score: float
    description: str

class RollingZScoreDetector:
    """Statistical detector computing dynamic rolling Z-Score on latency metrics."""

    def __init__(self, window_size: int = 30, z_threshold: float = 2.8):
        self.window_size = window_size
        self.z_threshold = z_threshold
        self.history: deque = deque(maxlen=window_size)

    def evaluate(self, metric_name: str, value: float) -> Optional[AnomalyEvent]:
        if len(self.history) < 8:
            self.history.append(value)
            return None

        arr = np.array(self.history)
        mean = float(np.mean(arr))
        std = float(np.std(arr))
        self.history.append(value)

        # Avoid zero division when latency is completely uniform
        if std < 1e-4:
            std = 1.0

        z_score = (value - mean) / std

        if z_score >= self.z_threshold:
            severity = "CRITICAL" if z_score >= 4.0 else "WARNING"
            return AnomalyEvent(
                timestamp=time.time(),
                detector_type="Z-SCORE",
                severity=severity,
                metric_name=metric_name,
                observed_value=round(value, 2),
                expected_value=round(mean, 2),
                anomaly_score=round(z_score, 2),
                description=f"Significant statistical deviation: {metric_name} spiked to {round(value, 1)}ms ({round(z_score, 2)}σ above rolling mean {round(mean, 1)}ms)."
            )
        return None

class TelemetryIsolationForestDetector:
    """Multivariate unsupervised anomaly detector trained on correlated telemetry signals."""

    def __init__(self, contamination: float = 0.08):
        self.contamination = contamination
        self.model = IsolationForest(
            n_estimators=100,
            contamination=contamination,
            random_state=42
        )
        self.is_fitted = False
        self.training_buffer: deque = deque(maxlen=120)
        self._initialize_nominal_baseline()

    def _initialize_nominal_baseline(self):
        """Pre-seeds the model with nominal healthy telemetry distribution."""
        np.random.seed(42)
        n_samples = 80
        # Nominal metrics: [active_vus, rps, cpu_pct, memory_mb, p99_latency_ms, error_rate]
        vus = np.random.uniform(20, 100, n_samples)
        rps = vus * np.random.uniform(10, 25, n_samples)
        cpu = np.random.uniform(10, 35, n_samples)
        mem = np.random.uniform(50, 75, n_samples)
        p99 = np.random.uniform(15, 60, n_samples)
        err = np.zeros(n_samples)

        X_baseline = np.column_stack([vus, rps, cpu, mem, p99, err])
        self.model.fit(X_baseline)
        self.is_fitted = True

    def evaluate(
        self,
        active_vus: int,
        rps: float,
        cpu_pct: float,
        memory_mb: float,
        p99_latency_ms: float,
        error_rate_pct: float
    ) -> Optional[AnomalyEvent]:
        features = np.array([[active_vus, rps, cpu_pct, memory_mb, p99_latency_ms, error_rate_pct]])
        
        # Buffer points for periodic re-fitting
        self.training_buffer.append(features[0])

        score = float(self.model.decision_function(features)[0])
        prediction = int(self.model.predict(features)[0])

        # Prediction: 1 is normal, -1 is anomaly
        if prediction == -1:
            severity = "CRITICAL" if score < -0.15 else "WARNING"
            return AnomalyEvent(
                timestamp=time.time(),
                detector_type="ISOLATION-FOREST",
                severity=severity,
                metric_name="Multivariate Telemetry Vector",
                observed_value=round(p99_latency_ms, 2),
                expected_value=0.0,
                anomaly_score=round(score, 3),
                description=f"Multivariate telemetry anomaly detected (Isolation score: {round(score, 3)}). Correlated degradation across CPU ({round(cpu_pct, 1)}%), Memory ({round(memory_mb, 1)}MB), and p99 ({round(p99_latency_ms, 1)}ms)."
            )
        return None

class AIOpsDetectorCoordinator:
    """Coordinating pipeline running both statistical and ML anomaly detection."""

    def __init__(self, p99_slo_ms: float = 200.0):
        self.p99_slo_ms = p99_slo_ms
        self.zscore_p99 = RollingZScoreDetector(window_size=25, z_threshold=2.8)
        self.zscore_mem = RollingZScoreDetector(window_size=20, z_threshold=3.0)
        self.iforest = TelemetryIsolationForestDetector(contamination=0.08)
        self.recent_anomalies: deque[AnomalyEvent] = deque(maxlen=50)

    def process_telemetry(
        self,
        active_vus: int,
        rps: float,
        cpu_pct: float,
        memory_mb: float,
        p99_latency_ms: float,
        error_rate_pct: float
    ) -> List[AnomalyEvent]:
        alerts: List[AnomalyEvent] = []

        # 1. Check SLO Breach
        if p99_latency_ms > self.p99_slo_ms:
            slo_alert = AnomalyEvent(
                timestamp=time.time(),
                detector_type="SLO-BREACH",
                severity="CRITICAL",
                metric_name="p99_latency_ms",
                observed_value=round(p99_latency_ms, 2),
                expected_value=self.p99_slo_ms,
                anomaly_score=round(p99_latency_ms / self.p99_slo_ms, 2),
                description=f"SLO VIOLATION: Observed p99 latency {round(p99_latency_ms, 1)}ms exceeds contractual SLO limit of {self.p99_slo_ms}ms."
            )
            alerts.append(slo_alert)
            self.recent_anomalies.append(slo_alert)

        # 2. Check Statistical Z-Score
        z_alert = self.zscore_p99.evaluate("p99_latency_ms", p99_latency_ms)
        if z_alert:
            alerts.append(z_alert)
            self.recent_anomalies.append(z_alert)

        mem_z_alert = self.zscore_mem.evaluate("memory_mb", memory_mb)
        if mem_z_alert:
            alerts.append(mem_z_alert)
            self.recent_anomalies.append(mem_z_alert)

        # 3. Check Multivariate Isolation Forest
        if_alert = self.iforest.evaluate(active_vus, rps, cpu_pct, memory_mb, p99_latency_ms, error_rate_pct)
        if if_alert:
            alerts.append(if_alert)
            self.recent_anomalies.append(if_alert)

        return alerts
