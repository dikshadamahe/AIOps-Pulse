from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST

# Standard Web Golden Signals
REQUEST_COUNT = Counter(
    "aiops_http_requests_total",
    "Total HTTP requests processed by endpoint, method, and status code",
    ["endpoint", "method", "status"]
)

REQUEST_LATENCY = Histogram(
    "aiops_http_request_duration_seconds",
    "HTTP request latency histogram in seconds",
    ["endpoint", "method"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 10.0)
)

ACTIVE_REQUESTS = Gauge(
    "aiops_active_requests",
    "Current number of in-flight requests (Concurrency / Saturation)"
)

HEAP_ALLOCATION_BYTES = Gauge(
    "aiops_heap_allocated_bytes",
    "Current heap buffer allocation tracking memory leak behavior"
)

DB_POOL_WAIT_SECONDS = Histogram(
    "aiops_db_pool_wait_duration_seconds",
    "Simulated database connection pool wait duration",
    buckets=(0.001, 0.005, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 3.0)
)

BOTTLENECK_ACTIVE = Gauge(
    "aiops_bottleneck_flag",
    "Flag indicating whether a specific regression is injected (1=active, 0=inactive)",
    ["bottleneck_type"]
)

def get_latest_metrics() -> tuple[bytes, str]:
    """Returns serialized Prometheus metrics and content-type."""
    return generate_latest(), CONTENT_TYPE_LATEST
