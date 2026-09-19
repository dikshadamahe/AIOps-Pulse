// ==========================================================================
// AIOps-Pulse: Multi-Tab Enterprise APM Controller (Datadog/Dynatrace/BigPanda)
// ==========================================================================

let latencyChart, throughputChart, resourceChart;
let pollingInterval = null;
let currentTelemetry = null;
let currentBottlenecks = {
  db_exhaustion_enabled: false,
  memory_leak_enabled: false,
  cpu_lock_enabled: false
};
const MAX_CHART_SAMPLES = 30;

const workloadDescriptions = {
  baseline: "Steady 50 virtual users validating nominal SLO parameters.",
  spike: "Instantaneous surge from 50 to 500+ concurrent requests testing burst queues.",
  soak: "Sustained continuous load to uncover steady heap allocation and memory leak regressions.",
  stress: "Incremental ramp-up (100 -> 300 -> 700 -> 1000 VUs) to determine saturation point."
};

document.addEventListener("DOMContentLoaded", () => {
  initCharts();
  bindNavigationTabs();
  bindControlHandlers();
  bindCopilotDrawer();
  renderServiceMap();
  startTelemetryPolling();
});

// --------------------------------------------------------------------------
// 1. Navigation & Tab Switching (Multi-View Routing)
// --------------------------------------------------------------------------

function bindNavigationTabs() {
  const railItems = document.querySelectorAll(".rail-item");
  const tabViews = document.querySelectorAll(".tab-view");
  const activeBreadcrumb = document.getElementById("activeBreadcrumb");

  const tabTitles = {
    cockpit: "Cockpit Overview",
    servicemap: "Service Map Topology",
    aiops: "Davis AI Root Cause",
    profiler: "Continuous Profiler",
    loadlab: "Load & Capacity Lab",
    bigpanda: "Incident Intelligence"
  };

  railItems.forEach(item => {
    item.addEventListener("click", () => {
      const targetTab = item.dataset.tab;

      railItems.forEach(r => r.classList.remove("active"));
      tabViews.forEach(v => v.classList.remove("active"));

      item.classList.add("active");
      const activeView = document.getElementById(`tab-${targetTab}`);
      if (activeView) activeView.classList.add("active");

      activeBreadcrumb.textContent = tabTitles[targetTab] || "Overview";

      // Trigger chart resize if navigating back to cockpit
      if (targetTab === "cockpit" && latencyChart) {
        setTimeout(() => {
          latencyChart.resize();
          throughputChart.resize();
          resourceChart.resize();
        }, 50);
      }
    });
  });
}

// --------------------------------------------------------------------------
// 2. Chart.js Telemetry Initialization
// --------------------------------------------------------------------------

function initCharts() {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    scales: {
      x: {
        grid: { color: '#182438' },
        ticks: { color: '#64748b', font: { size: 10 } }
      },
      y: {
        grid: { color: '#182438' },
        ticks: { color: '#64748b', font: { size: 10 } },
        beginAtZero: true
      }
    },
    plugins: { legend: { display: false } }
  };

  // Latency Chart
  const ctxLatency = document.getElementById("latencyChart").getContext("2d");
  latencyChart = new Chart(ctxLatency, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "p50 (ms)", borderColor: "#38bdf8", data: [], tension: 0.3, borderWidth: 2, pointRadius: 2 },
        { label: "p95 (ms)", borderColor: "#f59e0b", data: [], tension: 0.3, borderWidth: 2, pointRadius: 2 },
        { label: "p99 (ms)", borderColor: "#f43f5e", data: [], tension: 0.3, borderWidth: 2, pointRadius: 3 },
        { label: "SLO Limit (200ms)", borderColor: "#94a3b8", borderDash: [5, 5], data: [], pointRadius: 0, borderWidth: 1.5, fill: false }
      ]
    },
    options: commonOptions
  });

  // Throughput Chart
  const ctxThroughput = document.getElementById("throughputChart").getContext("2d");
  throughputChart = new Chart(ctxThroughput, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "RPS", borderColor: "#10b981", backgroundColor: "rgba(16, 185, 129, 0.1)", fill: true, data: [], tension: 0.3, borderWidth: 2, pointRadius: 1 },
        { label: "VUs", borderColor: "#8b5cf6", borderDash: [3, 3], data: [], tension: 0.1, borderWidth: 1.5, pointRadius: 0 }
      ]
    },
    options: commonOptions
  });

  // Resource Chart
  const ctxResource = document.getElementById("resourceChart").getContext("2d");
  resourceChart = new Chart(ctxResource, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "Memory (MB)", borderColor: "#8b5cf6", backgroundColor: "rgba(139, 92, 246, 0.1)", fill: true, data: [], tension: 0.3, borderWidth: 2, pointRadius: 1 }
      ]
    },
    options: commonOptions
  });
}

// --------------------------------------------------------------------------
// 3. Service Map Renderer (Dynatrace Smartscape Topology)
// --------------------------------------------------------------------------

const serviceNodes = [
  { id: "client", name: "Client Agents", role: "500+ Devices", x: 60, y: 220, type: "client" },
  { id: "gateway", name: "Edge Ingress", role: "HTTP/2 Proxy", x: 250, y: 220, type: "gateway" },
  { id: "core", name: "UEM Core API", role: "FastAPI / .NET", x: 480, y: 220, type: "service" },
  { id: "db", name: "PostgreSQL DB", role: "Workspaces Registry", x: 740, y: 110, type: "database" },
  { id: "redis", name: "Redis Cache", role: "Session & Auth", x: 740, y: 220, type: "cache" },
  { id: "workers", name: "Worker Pool", role: "Telemetry Ingest", x: 740, y: 330, type: "queue" }
];

const serviceEdges = [
  { from: "client", to: "gateway" },
  { from: "gateway", to: "core" },
  { from: "core", to: "db" },
  { from: "core", to: "redis" },
  { from: "core", to: "workers" }
];

function renderServiceMap() {
  const svg = document.getElementById("serviceMapSvg");
  if (!svg) return;
  svg.innerHTML = "";

  // Draw Edges
  serviceEdges.forEach(edge => {
    const src = serviceNodes.find(n => n.id === edge.from);
    const dst = serviceNodes.find(n => n.id === edge.to);
    if (!src || !dst) return;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const midX = (src.x + dst.x) / 2;
    const d = `M ${src.x + 110} ${src.y + 35} C ${midX} ${src.y + 35}, ${midX} ${dst.y + 35}, ${dst.x} ${dst.y + 35}`;
    
    path.setAttribute("d", d);
    path.setAttribute("id", `edge-${src.id}-${dst.id}`);
    path.setAttribute("class", "edge-path active-flow");
    svg.appendChild(path);
  });

  // Draw Nodes
  serviceNodes.forEach(node => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "node-group");
    g.setAttribute("transform", `translate(${node.x}, ${node.y})`);
    g.setAttribute("data-id", node.id);

    g.innerHTML = `
      <rect class="node-box healthy" id="node-box-${node.id}" width="140" height="70" />
      <text class="node-title" x="14" y="28">${node.name}</text>
      <text class="node-sub" x="14" y="48">${node.role}</text>
      <circle cx="122" cy="22" r="5" id="node-status-${node.id}" fill="#10b981" />
    `;

    g.addEventListener("click", () => inspectNode(node));
    svg.appendChild(g);
  });
}

function updateServiceMapState() {
  const isDbDown = currentBottlenecks.db_exhaustion_enabled;
  const isMemDown = currentBottlenecks.memory_leak_enabled;
  const isCpuDown = currentBottlenecks.cpu_lock_enabled;
  const isDegraded = isDbDown || isMemDown || isCpuDown;

  // Update Core node
  const coreBox = document.getElementById("node-box-core");
  const coreDot = document.getElementById("node-status-core");
  if (coreBox && coreDot) {
    if (isDegraded) {
      coreBox.className.baseVal = "node-box breach";
      coreDot.setAttribute("fill", "#f43f5e");
    } else {
      coreBox.className.baseVal = "node-box healthy";
      coreDot.setAttribute("fill", "#10b981");
    }
  }

  // Update DB node
  const dbBox = document.getElementById("node-box-db");
  const dbDot = document.getElementById("node-status-db");
  const dbEdge = document.getElementById("edge-core-db");
  if (dbBox && dbDot) {
    if (isDbDown) {
      dbBox.className.baseVal = "node-box breach";
      dbDot.setAttribute("fill", "#f43f5e");
      if (dbEdge) dbEdge.setAttribute("class", "edge-path degraded-flow");
    } else {
      dbBox.className.baseVal = "node-box healthy";
      dbDot.setAttribute("fill", "#10b981");
      if (dbEdge) dbEdge.setAttribute("class", "edge-path active-flow");
    }
  }

  // Update Workers node (Telemetry leak)
  const workerBox = document.getElementById("node-box-workers");
  const workerDot = document.getElementById("node-status-workers");
  const workerEdge = document.getElementById("edge-core-workers");
  if (workerBox && workerDot) {
    if (isMemDown) {
      workerBox.className.baseVal = "node-box breach";
      workerDot.setAttribute("fill", "#f43f5e");
      if (workerEdge) workerEdge.setAttribute("class", "edge-path degraded-flow");
    } else {
      workerBox.className.baseVal = "node-box healthy";
      workerDot.setAttribute("fill", "#10b981");
      if (workerEdge) workerEdge.setAttribute("class", "edge-path active-flow");
    }
  }
}

function inspectNode(node) {
  document.getElementById("inspectNodeName").textContent = node.name;
  document.getElementById("inspectNodeRole").textContent = node.role;

  const isDegraded = (node.id === "db" && currentBottlenecks.db_exhaustion_enabled) ||
                     (node.id === "workers" && currentBottlenecks.memory_leak_enabled) ||
                     (node.id === "core" && (currentBottlenecks.cpu_lock_enabled || currentBottlenecks.db_exhaustion_enabled));

  const statusBadge = document.getElementById("inspectNodeStatus");
  statusBadge.textContent = isDegraded ? "CRITICAL" : "HEALTHY";
  statusBadge.className = `badge ${isDegraded ? "CRITICAL" : "HEALTHY"}`;

  const rps = currentTelemetry ? currentTelemetry.rps : 120.0;
  const p99 = currentTelemetry ? currentTelemetry.p99_ms : 18.2;

  document.getElementById("inspectNodeRps").textContent = `${rps} req/sec`;
  document.getElementById("inspectNodeP99").textContent = `${p99} ms`;

  const notes = document.getElementById("inspectNodeNotes");
  if (node.id === "db" && currentBottlenecks.db_exhaustion_enabled) {
    notes.textContent = "🚨 Bottleneck: Connection pool semaphore locked. Full sequential table scans triggering high queue wait.";
  } else if (node.id === "workers" && currentBottlenecks.memory_leak_enabled) {
    notes.textContent = "🚨 Bottleneck: Monotonic memory leak in device telemetry ingestion buffer. Threat of OOM crash.";
  } else if (isDegraded) {
    notes.textContent = "⚠️ Downstream contention detected. Call latencies degraded beyond acceptable thresholds.";
  } else {
    notes.textContent = "Operating nominally with zero active bottle-necking. Connection pool healthy.";
  }
}

// --------------------------------------------------------------------------
// 4. Control Handlers (Workloads & Bottlenecks)
// --------------------------------------------------------------------------

function bindControlHandlers() {
  const cockpitSelect = document.getElementById("cockpitWorkloadSelect");
  const cockpitDesc = document.getElementById("cockpitWorkloadDesc");
  const cockpitStartBtn = document.getElementById("cockpitStartBtn");
  const cockpitStopBtn = document.getElementById("cockpitStopBtn");

  const labSelect = document.getElementById("labWorkloadType");
  const labStartBtn = document.getElementById("labStartBtn");
  const labStopBtn = document.getElementById("labStopBtn");
  const vuSlider = document.getElementById("vuSlider");
  const vuSliderVal = document.getElementById("vuSliderVal");

  const toggleDb = document.getElementById("cockpitToggleDb");
  const toggleMemory = document.getElementById("cockpitToggleMemory");
  const toggleCpu = document.getElementById("cockpitToggleCpu");

  const resetBtn = document.getElementById("resetStateBtn");

  // Sync workload selectors
  cockpitSelect.addEventListener("change", () => {
    cockpitDesc.textContent = workloadDescriptions[cockpitSelect.value] || "";
    labSelect.value = cockpitSelect.value;
  });

  labSelect.addEventListener("change", () => {
    cockpitSelect.value = labSelect.value;
    cockpitDesc.textContent = workloadDescriptions[labSelect.value] || "";
  });

  vuSlider.addEventListener("input", () => {
    vuSliderVal.textContent = `${vuSlider.value} VUs`;
  });

  const launchLoad = async (type) => {
    cockpitStartBtn.disabled = true;
    cockpitStopBtn.disabled = false;
    labStartBtn.disabled = true;
    labStopBtn.disabled = false;
    try {
      await fetch("/api/v1/load/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workload_type: type })
      });
    } catch (err) {
      console.error("Failed to start benchmark:", err);
      cockpitStartBtn.disabled = false;
      cockpitStopBtn.disabled = true;
      labStartBtn.disabled = false;
      labStopBtn.disabled = true;
    }
  };

  const stopLoad = async () => {
    try {
      await fetch("/api/v1/load/stop", { method: "POST" });
    } catch (err) {
      console.error("Failed to stop benchmark:", err);
    }
  };

  cockpitStartBtn.addEventListener("click", () => launchLoad(cockpitSelect.value));
  labStartBtn.addEventListener("click", () => launchLoad(labSelect.value));
  cockpitStopBtn.addEventListener("click", stopLoad);
  labStopBtn.addEventListener("click", stopLoad);

  // Bottleneck Sync
  const sendBottlenecks = async () => {
    currentBottlenecks = {
      db_exhaustion_enabled: toggleDb.checked,
      db_simulated_delay_ms: 120.0,
      memory_leak_enabled: toggleMemory.checked,
      memory_leak_chunk_kb: 512,
      cpu_lock_enabled: toggleCpu.checked,
      cpu_lock_iterations: 120000
    };
    try {
      await fetch("/api/v1/admin/bottlenecks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentBottlenecks)
      });
      updateServiceMapState();
    } catch (err) {
      console.error("Failed to update bottlenecks:", err);
    }
  };

  toggleDb.addEventListener("change", sendBottlenecks);
  toggleMemory.addEventListener("change", sendBottlenecks);
  toggleCpu.addEventListener("change", sendBottlenecks);

  resetBtn.addEventListener("click", async () => {
    if (!confirm("Reset all state, memory buffers, and active bottlenecks?")) return;
    try {
      await fetch("/api/v1/admin/reset", { method: "POST" });
      toggleDb.checked = false;
      toggleMemory.checked = false;
      toggleCpu.checked = false;
      currentBottlenecks = { db_exhaustion_enabled: false, memory_leak_enabled: false, cpu_lock_enabled: false };
      updateServiceMapState();
    } catch (err) {
      console.error("Failed to reset:", err);
    }
  });

  document.getElementById("downloadRcaBtnAIOps").addEventListener("click", () => {
    window.open("/api/v1/aiops/report/download", "_blank");
  });
}

// --------------------------------------------------------------------------
// 5. Floating AI Performance Copilot Drawer (Datadog Bits AI)
// --------------------------------------------------------------------------

function bindCopilotDrawer() {
  const drawer = document.getElementById("copilotDrawer");
  const openBtn = document.getElementById("openCopilotBtn");
  const topBtn = document.getElementById("toggleCopilotTopBtn");
  const closeBtn = document.getElementById("closeCopilotBtn");
  const sendBtn = document.getElementById("sendCopilotBtn");
  const input = document.getElementById("copilotInput");
  const stream = document.getElementById("copilotChatStream");
  const promptChips = document.querySelectorAll(".prompt-chip");

  const openDrawer = () => drawer.classList.add("open");
  const closeDrawer = () => drawer.classList.remove("open");

  openBtn.addEventListener("click", openDrawer);
  topBtn.addEventListener("click", openDrawer);
  closeBtn.addEventListener("click", closeDrawer);

  const appendMsg = (sender, text) => {
    const msg = document.createElement("div");
    msg.className = `chat-msg ${sender}`;
    msg.innerHTML = `
      <div class="msg-avatar">${sender === 'ai' ? '🤖' : '👤'}</div>
      <div class="msg-content">${text}</div>
    `;
    stream.appendChild(msg);
    stream.scrollTop = stream.scrollHeight;
  };

  const handleQuery = (query) => {
    appendMsg("user", query);
    input.value = "";

    // Generate intelligent contextual response
    setTimeout(() => {
      let reply = "";
      const p99 = currentTelemetry ? currentTelemetry.p99_ms : 22.0;

      if (query.includes("Why is p99") || query.includes("spiking")) {
        if (currentBottlenecks.db_exhaustion_enabled) {
          reply = `🚨 **p99 latency is currently ${p99}ms** due to **Database Connection Pool Starvation**. Workers are waiting on a 5-connection semaphore while executing unindexed sequential scans on \`/api/v1/workspaces\`.`;
        } else if (currentBottlenecks.cpu_lock_enabled) {
          reply = `🚨 **p99 latency is spiking** because a synchronous cryptographic loop (\`hashlib.sha256\`) is monopolizing 88% of CPU cycles, blocking the FastAPI asynchronous event loop.`;
        } else if (currentBottlenecks.memory_leak_enabled) {
          reply = `⚠️ Latency degradation is being driven by memory allocation overhead. An uncollected byte buffer in \`/api/v1/devices/telemetry\` is bloating the heap.`;
        } else {
          reply = `✅ **System is nominal.** Current p99 latency is **${p99}ms**, well below your contractual 200ms SLO limit.`;
        }
      } else if (query.includes("DB pool") || query.includes("database")) {
        if (currentBottlenecks.db_exhaustion_enabled) {
          reply = `🔍 **DB Pool Analysis**: Active connections are saturated at 5/5. Average wait duration in pool queue is **${Math.round(p99 * 0.7)}ms**. Recommend scaling pool to 50 connections.`;
        } else {
          reply = `✅ **DB Pool Analysis**: Connection pool is healthy with 0 connection wait time.`;
        }
      } else if (query.includes("memory leak") || query.includes("leak")) {
        if (currentBottlenecks.memory_leak_enabled) {
          reply = `🧪 **Memory Leak Alert**: Linear heap accumulation detected in \`LEAKED_MEMORY_BUFFER\`. Allocation rate is approximately 512KB per telemetry payload. Recommend moving to a streaming message broker (Kafka).`;
        } else {
          reply = `✅ **Memory State**: Heap is stable. Garbage collector cycles are healthy.`;
        }
      } else if (query.includes("remediation") || query.includes("action plan")) {
        reply = `🛠️ **3-Step Remediation Plan**:\n1. **Index Database**: Add compound B-tree index on \`workspace_id\`.\n2. **Resize Pool**: Increase DB pool capacity from 5 to 50 max connections.\n3. **Circuit Breaker**: Implement 500ms connection timeout to fail fast and prevent queue congestion.`;
      } else {
        reply = `I have analyzed telemetry streams: Throughput is **${currentTelemetry ? currentTelemetry.rps : 0} RPS**, with p99 latency at **${p99}ms**. All detectors (Z-score & Isolation Forest) are actively monitoring.`;
      }

      appendMsg("ai", reply.replace(/\n/g, "<br>"));
    }, 400);
  };

  sendBtn.addEventListener("click", () => {
    if (input.value.trim()) handleQuery(input.value.trim());
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) handleQuery(input.value.trim());
  });

  promptChips.forEach(chip => {
    chip.addEventListener("click", () => handleQuery(chip.dataset.query));
  });
}

// --------------------------------------------------------------------------
// 6. Real-Time Telemetry Polling & Dashboard Data Sync
// --------------------------------------------------------------------------

function startTelemetryPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(async () => {
    try {
      await Promise.all([
        pollLoadHistory(),
        pollAdminStatus(),
        pollAIOpsAnomalies(),
        pollRCA(),
        pollFlameGraph()
      ]);
      updateServiceMapState();
    } catch (err) {
      console.error("Telemetry sync error:", err);
    }
  }, 1000);
}

async function pollLoadHistory() {
  const res = await fetch("/api/v1/load/history");
  const data = await res.json();
  const history = data.history || [];
  const isRunning = data.is_running;

  // Sync button states
  document.getElementById("cockpitStartBtn").disabled = isRunning;
  document.getElementById("cockpitStopBtn").disabled = !isRunning;
  document.getElementById("labStartBtn").disabled = isRunning;
  document.getElementById("labStopBtn").disabled = !isRunning;
  document.getElementById("kpiEngineState").textContent = isRunning ? "Engine: Running" : "Engine: Idle";
  document.getElementById("labRunState").textContent = isRunning ? "STATUS: RUNNING BENCHMARK" : "STATUS: IDLE";
  document.getElementById("labRunState").className = `badge ${isRunning ? "WARNING" : "HEALTHY"}`;

  if (history.length === 0) return;
  const latest = history[history.length - 1];
  currentTelemetry = latest;

  // Update Cockpit KPI Boxes
  document.getElementById("kpiRps").innerHTML = `${latest.rps} <span class="unit">RPS</span>`;
  document.getElementById("kpiTotalReq").textContent = `Total: ${latest.total_requests} reqs`;
  document.getElementById("kpiP99").innerHTML = `${latest.p99_ms} <span class="unit">ms</span>`;
  document.getElementById("kpiP50").textContent = `p50: ${latest.p50_ms}ms | p95: ${latest.p95_ms}ms`;
  document.getElementById("kpiVus").innerHTML = `${latest.active_vus} <span class="unit">VUs</span>`;
  document.getElementById("kpiError").innerHTML = `${latest.error_rate_pct} <span class="unit">%</span>`;
  document.getElementById("kpiFailedReq").textContent = `${latest.failed_requests} failed`;

  // Global SLO Badge
  const globalSlo = document.getElementById("globalSloBadge");
  const globalSloText = document.getElementById("globalSloText");
  if (latest.p99_ms > 200.0) {
    globalSlo.className = "slo-health-badge breached";
    globalSloText.textContent = `SLO BREACH: ${latest.p99_ms}ms`;
  } else {
    globalSlo.className = "slo-health-badge healthy";
    globalSloText.textContent = "99.4% SLO Health";
  }

  // Update Percentiles Table (Load Lab)
  document.getElementById("tdP50").textContent = `${latest.p50_ms} ms`;
  document.getElementById("tdP75").textContent = `${latest.p75_ms} ms`;
  document.getElementById("tdP90").textContent = `${latest.p90_ms} ms`;
  document.getElementById("tdP95").textContent = `${latest.p95_ms} ms`;
  document.getElementById("tdP99").textContent = `${latest.p99_ms} ms`;
  document.getElementById("tdP999").textContent = `${latest.p999_ms} ms`;
  document.getElementById("tdPMax").textContent = `${latest.max_latency_ms} ms`;

  const p99Var = document.getElementById("tdP99Var");
  if (latest.p99_ms > 200.0) {
    p99Var.textContent = "BREACHED";
    p99Var.className = "bad";
  } else {
    p99Var.textContent = "Optimal";
    p99Var.className = "good";
  }

  // Update Charts
  const recent = history.slice(-MAX_CHART_SAMPLES);
  const labels = recent.map(s => `${s.elapsed_seconds}s`);

  latencyChart.data.labels = labels;
  latencyChart.data.datasets[0].data = recent.map(s => s.p50_ms);
  latencyChart.data.datasets[1].data = recent.map(s => s.p95_ms);
  latencyChart.data.datasets[2].data = recent.map(s => s.p99_ms);
  latencyChart.data.datasets[3].data = recent.map(() => 200);
  latencyChart.update();

  throughputChart.data.labels = labels;
  throughputChart.data.datasets[0].data = recent.map(s => s.rps);
  throughputChart.data.datasets[1].data = recent.map(s => s.active_vus);
  throughputChart.update();
}

async function pollAdminStatus() {
  const res = await fetch("/api/v1/admin/status");
  const data = await res.json();

  document.getElementById("kpiMemory").innerHTML = `${data.rss_memory_mb} <span class="unit">MB</span>`;
  document.getElementById("kpiHeap").textContent = `Heap Leaked: ${data.heap_retained_kb} KB`;

  // Update Resource Chart
  const nowLabel = new Date().toLocaleTimeString().split(" ")[0];
  if (resourceChart.data.labels.length >= MAX_CHART_SAMPLES) {
    resourceChart.data.labels.shift();
    resourceChart.data.datasets[0].data.shift();
  }
  resourceChart.data.labels.push(nowLabel);
  resourceChart.data.datasets[0].data.push(data.rss_memory_mb);
  resourceChart.update();
}

async function pollAIOpsAnomalies() {
  const res = await fetch("/api/v1/aiops/anomalies");
  const data = await res.json();
  const anomalies = data.anomalies || [];

  document.getElementById("aiopsAnomalyBadge").textContent = `${data.total_anomalies} Anomaly Flags`;
  const stream = document.getElementById("aiopsAnomalyStream");

  if (anomalies.length === 0) {
    stream.innerHTML = '<div class="empty-feed">No anomalies detected. Telemetry variance within normal distribution.</div>';
    return;
  }

  stream.innerHTML = anomalies.slice(0, 8).map(a => `
    <div class="anomaly-feed-item ${a.severity}">
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <span class="badge ${a.severity}">${a.detector_type}</span>
        <span style="font-family:monospace; color:#64748b; font-size:11px;">${new Date(a.timestamp * 1000).toLocaleTimeString()}</span>
      </div>
      <div style="color:#cbd5e1; font-size:12px;">${a.description}</div>
    </div>
  `).join("");
}

async function pollRCA() {
  const res = await fetch("/api/v1/aiops/rca");
  const rca = await res.json();
  if (!rca || !rca.incident_id) return;

  const sevBadge = document.getElementById("davisSeverity");
  sevBadge.textContent = rca.severity;
  sevBadge.className = `badge ${rca.severity}`;

  document.getElementById("davisIncId").textContent = rca.incident_id;
  document.getElementById("davisConfidence").textContent = `AI Confidence: ${rca.confidence_pct}%`;
  document.getElementById("davisTitle").textContent = rca.title;
  document.getElementById("davisDiagnosis").textContent = rca.root_cause_diagnosis;
  document.getElementById("causalHotspotNode").textContent = rca.profiler_hotspot;

  const remList = document.getElementById("davisRemediationList");
  remList.innerHTML = (rca.prescriptive_remediation || []).map(r => `<li>${r}</li>`).join("");

  // Update BigPanda Table
  const bpTable = document.getElementById("bigpandaIncidentTable");
  bpTable.innerHTML = `
    <tr>
      <td><code>${rca.incident_id}</code></td>
      <td>${rca.severity === 'CRITICAL' ? '42 raw alerts compressed' : '0 alerts (Nominal)'}</td>
      <td>${rca.title}</td>
      <td><span class="badge ${rca.severity}">${rca.severity}</span></td>
      <td>${rca.timestamp}</td>
    </tr>
  `;

  // Update SLO budget
  const isBreached = rca.severity === 'CRITICAL';
  document.getElementById("sloMeterFill").style.width = isBreached ? "54%" : "96%";
  document.getElementById("sloRemainingText").textContent = isBreached ? "54.2%" : "96.4%";
  document.getElementById("sloBurnRate").textContent = isBreached ? "4.8x (Fast Burn)" : "0.02x (Healthy)";
}

async function pollFlameGraph() {
  const res = await fetch("/api/v1/aiops/profiling");
  const data = await res.json();
  if (!data || !data.tree) return;

  document.getElementById("profilerHotspotSummary").textContent = `Hotspot: ${data.hotspot_function}`;

  const container = document.getElementById("interactiveFlameView");
  const rows = [];

  function walk(node, depth = 0) {
    const isHot = data.hotspot_function && node.name.includes(data.hotspot_function.split(".")[0]);
    const indent = "&nbsp;".repeat(depth * 4);
    rows.push(`
      <div class="flame-bar-row ${isHot ? 'hotspot' : ''}">
        <span style="flex:1; color:#f8fafc;">${indent}↳ ${node.name}</span>
        <div style="width: 120px;">
          <div class="flame-visual-bar" style="width: ${Math.min(node.value, 100)}%;"></div>
        </div>
        <span style="color:#94a3b8; width:50px; text-align:right;">${node.value}%</span>
      </div>
    `);
    if (node.children) node.children.forEach(c => walk(c, depth + 1));
  }

  walk(data.tree);
  container.innerHTML = rows.join("");

  // Update Hotspot breakdown table
  const tableBody = document.getElementById("hotspotTableBody");
  if (data.bottleneck_type === "DB_POOL_STARVATION") {
    tableBody.innerHTML = `
      <tr><td><code>DB_POOL_SEMAPHORE.acquire</code></td><td>68.0%</td><td>Connection Wait</td><td><span class="pill-tag p99">Critical Lock</span></td></tr>
      <tr><td><code>postgres_seq_scan</code></td><td>24.5%</td><td>Unindexed Scan</td><td><span class="pill-tag p95">Warning</span></td></tr>
      <tr><td><code>uvicorn.run</code></td><td>100.0%</td><td>HTTP Server</td><td><span class="pill-tag p50">Nominal</span></td></tr>
    `;
  } else if (data.bottleneck_type === "HEAP_MEMORY_LEAK") {
    tableBody.innerHTML = `
      <tr><td><code>LEAKED_MEMORY_BUFFER.append</code></td><td>74.0%</td><td>Heap Retain</td><td><span class="pill-tag p99">Memory Leak</span></td></tr>
      <tr><td><code>os.urandom</code></td><td>69.5%</td><td>Buffer Alloc</td><td><span class="pill-tag p95">Warning</span></td></tr>
      <tr><td><code>uvicorn.run</code></td><td>100.0%</td><td>HTTP Server</td><td><span class="pill-tag p50">Nominal</span></td></tr>
    `;
  } else if (data.bottleneck_type === "CPU_CONTENTION") {
    tableBody.innerHTML = `
      <tr><td><code>hashlib.sha256</code></td><td>88.5%</td><td>CPU Spinlock</td><td><span class="pill-tag p99">Event Loop Block</span></td></tr>
      <tr><td><code>FastAPI.dispatch_request</code></td><td>97.2%</td><td>Dispatcher</td><td><span class="pill-tag p95">Starved</span></td></tr>
      <tr><td><code>uvicorn.run</code></td><td>100.0%</td><td>HTTP Server</td><td><span class="pill-tag p50">Nominal</span></td></tr>
    `;
  } else {
    tableBody.innerHTML = `
      <tr><td><code>uvicorn.run</code></td><td>100.0%</td><td>Process Entrypoint</td><td><span class="pill-tag p50">Nominal</span></td></tr>
      <tr><td><code>FastAPI.dispatch_request</code></td><td>95.0%</td><td>HTTP Router</td><td><span class="pill-tag p50">Nominal</span></td></tr>
      <tr><td><code>db_in_memory_lookup</code></td><td>15.0%</td><td>Indexed Lookup</td><td><span class="pill-tag p50">Nominal</span></td></tr>
    `;
  }
}
