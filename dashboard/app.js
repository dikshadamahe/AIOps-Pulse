// State and Chart instances
let latencyChart, throughputChart, resourceChart;
let pollingInterval = null;
const MAX_DATA_POINTS = 30;

const workloadDescriptions = {
  baseline: "Steady 50 virtual users validating nominal SLO parameters.",
  spike: "Instantaneous surge from 50 to 500+ concurrent requests testing burst queues.",
  soak: "Sustained continuous load to uncover steady heap allocation and memory leak regressions.",
  stress: "Incremental ramp-up (100 -> 300 -> 700 -> 1000 VUs) to determine saturation point."
};

// Initialize on DOM Ready
document.addEventListener("DOMContentLoaded", () => {
  initCharts();
  bindEventHandlers();
  startTelemetryPolling();
});

function initCharts() {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    scales: {
      x: {
        grid: { color: '#1c263c' },
        ticks: { color: '#64748b', font: { size: 10 } }
      },
      y: {
        grid: { color: '#1c263c' },
        ticks: { color: '#64748b', font: { size: 10 } },
        beginAtZero: true
      }
    },
    plugins: {
      legend: { display: false }
    }
  };

  // 1. Latency Percentiles Chart
  const ctxLatency = document.getElementById("latencyChart").getContext("2d");
  latencyChart = new Chart(ctxLatency, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "p50 (ms)",
          borderColor: "#38bdf8",
          backgroundColor: "rgba(56, 189, 248, 0.1)",
          data: [],
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 2
        },
        {
          label: "p95 (ms)",
          borderColor: "#f59e0b",
          backgroundColor: "transparent",
          data: [],
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 2
        },
        {
          label: "p99 (ms)",
          borderColor: "#ef4444",
          backgroundColor: "transparent",
          data: [],
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 3
        },
        {
          label: "SLO Limit (200ms)",
          borderColor: "#94a3b8",
          borderDash: [5, 5],
          data: [],
          pointRadius: 0,
          borderWidth: 1.5,
          fill: false
        }
      ]
    },
    options: commonOptions
  });

  // 2. Throughput & VUs Chart
  const ctxThroughput = document.getElementById("throughputChart").getContext("2d");
  throughputChart = new Chart(ctxThroughput, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "RPS",
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          fill: true,
          data: [],
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 1
        },
        {
          label: "VUs",
          borderColor: "#818cf8",
          borderDash: [3, 3],
          data: [],
          tension: 0.1,
          borderWidth: 1.5,
          pointRadius: 0
        }
      ]
    },
    options: commonOptions
  });

  // 3. Resource Saturation Chart
  const ctxResource = document.getElementById("resourceChart").getContext("2d");
  resourceChart = new Chart(ctxResource, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Memory RSS (MB)",
          borderColor: "#a855f7",
          backgroundColor: "rgba(168, 85, 247, 0.1)",
          fill: true,
          data: [],
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 1
        }
      ]
    },
    options: commonOptions
  });
}

function bindEventHandlers() {
  const workloadSelect = document.getElementById("workloadSelect");
  const workloadDesc = document.getElementById("workloadDesc");
  const startBtn = document.getElementById("startLoadBtn");
  const stopBtn = document.getElementById("stopLoadBtn");
  const resetBtn = document.getElementById("resetBtn");
  const downloadBtn = document.getElementById("downloadRcaBtn");

  const toggleDb = document.getElementById("toggleDb");
  const toggleMemory = document.getElementById("toggleMemory");
  const toggleCpu = document.getElementById("toggleCpu");

  workloadSelect.addEventListener("change", () => {
    workloadDesc.textContent = workloadDescriptions[workloadSelect.value] || "";
  });

  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    try {
      await fetch("/api/v1/load/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workload_type: workloadSelect.value })
      });
    } catch (err) {
      console.error("Failed to start load test:", err);
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  });

  stopBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/v1/load/stop", { method: "POST" });
    } catch (err) {
      console.error("Failed to stop load:", err);
    }
  });

  resetBtn.addEventListener("click", async () => {
    if (!confirm("Reset all state, memory buffers, and active bottlenecks?")) return;
    try {
      await fetch("/api/v1/admin/reset", { method: "POST" });
      toggleDb.checked = false;
      toggleMemory.checked = false;
      toggleCpu.checked = false;
      resetCharts();
    } catch (err) {
      console.error("Failed to reset:", err);
    }
  });

  const sendBottleneckConfig = async () => {
    const config = {
      db_exhaustion_enabled: toggleDb.checked,
      db_simulated_delay_ms: 150.0,
      memory_leak_enabled: toggleMemory.checked,
      memory_leak_chunk_kb: 512,
      cpu_lock_enabled: toggleCpu.checked,
      cpu_lock_iterations: 120000
    };
    try {
      await fetch("/api/v1/admin/bottlenecks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
    } catch (err) {
      console.error("Failed to update bottlenecks:", err);
    }
  };

  toggleDb.addEventListener("change", sendBottleneckConfig);
  toggleMemory.addEventListener("change", sendBottleneckConfig);
  toggleCpu.addEventListener("change", sendBottleneckConfig);

  downloadBtn.addEventListener("click", () => {
    window.open("/api/v1/aiops/report/download", "_blank");
  });
}

function resetCharts() {
  [latencyChart, throughputChart, resourceChart].forEach(chart => {
    chart.data.labels = [];
    chart.data.datasets.forEach(ds => ds.data = []);
    chart.update();
  });
}

function startTelemetryPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(async () => {
    try {
      await Promise.all([
        fetchLoadHistory(),
        fetchAdminStatus(),
        fetchAIOpsAnomalies(),
        fetchRCA(),
        fetchFlameGraph()
      ]);
    } catch (err) {
      console.error("Telemetry polling error:", err);
    }
  }, 1000);
}

async function fetchLoadHistory() {
  const res = await fetch("/api/v1/load/history");
  const data = await res.json();
  const history = data.history || [];
  const isRunning = data.is_running;

  document.getElementById("startLoadBtn").disabled = isRunning;
  document.getElementById("stopLoadBtn").disabled = !isRunning;
  document.getElementById("kpiStatus").textContent = isRunning ? "Engine: Running" : "Engine: Idle";

  if (history.length === 0) return;

  const latest = history[history.length - 1];

  // Update KPI Cards
  document.getElementById("kpiRps").innerHTML = `${latest.rps} <span class="kpi-unit">RPS</span>`;
  document.getElementById("kpiTotalReq").textContent = `Total: ${latest.total_requests} requests`;

  document.getElementById("kpiP99").innerHTML = `${latest.p99_ms} <span class="kpi-unit">ms</span>`;
  document.getElementById("kpiP50").textContent = `p50: ${latest.p50_ms}ms | p95: ${latest.p95_ms}ms`;

  document.getElementById("kpiVus").innerHTML = `${latest.active_vus} <span class="kpi-unit">VUs</span>`;
  document.getElementById("kpiError").innerHTML = `${latest.error_rate_pct} <span class="kpi-unit">%</span>`;
  document.getElementById("kpiFailed").textContent = `${latest.failed_requests} failed requests`;

  // SLO indicator check
  const sloBadge = document.getElementById("sloBadge");
  if (latest.p99_ms > 200.0) {
    sloBadge.textContent = "SLO: Breached (>200ms)";
    sloBadge.className = "slo-badge breach";
  } else {
    sloBadge.textContent = "SLO: Healthy";
    sloBadge.className = "slo-badge";
  }

  // Update Chart Data Points
  const recent = history.slice(-MAX_DATA_POINTS);
  const labels = recent.map(s => `${s.elapsed_seconds}s`);

  // Latency
  latencyChart.data.labels = labels;
  latencyChart.data.datasets[0].data = recent.map(s => s.p50_ms);
  latencyChart.data.datasets[1].data = recent.map(s => s.p95_ms);
  latencyChart.data.datasets[2].data = recent.map(s => s.p99_ms);
  latencyChart.data.datasets[3].data = recent.map(() => 200); // SLO limit line
  latencyChart.update();

  // Throughput
  throughputChart.data.labels = labels;
  throughputChart.data.datasets[0].data = recent.map(s => s.rps);
  throughputChart.data.datasets[1].data = recent.map(s => s.active_vus);
  throughputChart.update();
}

async function fetchAdminStatus() {
  const res = await fetch("/api/v1/admin/status");
  const data = await res.json();
  
  document.getElementById("kpiMemory").innerHTML = `${data.rss_memory_mb} <span class="kpi-unit">MB</span>`;
  document.getElementById("kpiHeap").textContent = `Heap Leaked: ${data.heap_retained_kb} KB`;

  // Resource chart
  const nowLabel = new Date().toLocaleTimeString().split(" ")[0];
  if (resourceChart.data.labels.length >= MAX_DATA_POINTS) {
    resourceChart.data.labels.shift();
    resourceChart.data.datasets[0].data.shift();
  }
  resourceChart.data.labels.push(nowLabel);
  resourceChart.data.datasets[0].data.push(data.rss_memory_mb);
  resourceChart.update();
}

async function fetchAIOpsAnomalies() {
  const res = await fetch("/api/v1/aiops/anomalies");
  const data = await res.json();
  const anomalies = data.anomalies || [];

  document.getElementById("anomalyCountBadge").textContent = `${data.total_anomalies} Flags`;
  const container = document.getElementById("anomalyFeed");

  if (anomalies.length === 0) {
    container.innerHTML = '<div class="empty-state">No anomalies detected. Telemetry operating within normal variance.</div>';
    return;
  }

  container.innerHTML = anomalies.slice(0, 8).map(a => `
    <div class="anomaly-item ${a.severity}">
      <div class="anomaly-item-header">
        <span class="badge ${a.severity}">${a.detector_type}</span>
        <span style="font-family:monospace; color:#64748b">${new Date(a.timestamp * 1000).toLocaleTimeString()}</span>
      </div>
      <div class="anomaly-item-desc">${a.description}</div>
    </div>
  `).join("");
}

async function fetchRCA() {
  const res = await fetch("/api/v1/aiops/rca");
  const rca = await res.json();
  if (!rca || !rca.incident_id) return;

  const sevElem = document.getElementById("rcaSeverity");
  sevElem.textContent = rca.severity;
  sevElem.className = `badge ${rca.severity}`;

  document.getElementById("rcaId").textContent = rca.incident_id;
  document.getElementById("rcaConfidence").textContent = `Confidence: ${rca.confidence_pct}%`;
  document.getElementById("rcaTitle").textContent = rca.title;
  document.getElementById("rcaDiagnosis").textContent = rca.root_cause_diagnosis;
  document.getElementById("rcaHotspot").textContent = rca.profiler_hotspot;

  const remList = document.getElementById("rcaRemediationList");
  remList.innerHTML = (rca.prescriptive_remediation || []).map(r => `<li>${r}</li>`).join("");
}

async function fetchFlameGraph() {
  const res = await fetch("/api/v1/aiops/profiling");
  const data = await res.json();
  if (!data || !data.tree) return;

  document.getElementById("hotspotBadge").textContent = data.hotspot_function;

  const container = document.getElementById("flamegraphView");
  const rows = [];

  function traverse(node, depth = 0) {
    const indent = "&nbsp;".repeat(depth * 4);
    const isHotspot = data.hotspot_function && node.name.includes(data.hotspot_function.split(".")[0]);
    rows.push(`
      <div class="flame-row ${isHotspot ? 'hotspot' : ''}">
        <span class="flame-name">${indent}↳ ${node.name}</span>
        <div style="width: 100px;">
          <div class="flame-bar" style="width: ${Math.min(node.value, 100)}%;"></div>
        </div>
        <span class="flame-val">${node.value}%</span>
      </div>
    `);
    if (node.children) {
      node.children.forEach(child => traverse(child, depth + 1));
    }
  }

  traverse(data.tree);
  container.innerHTML = rows.join("");
}
