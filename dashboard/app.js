// ==========================================================================
// AIOps-Pulse: Datadog Interactive Host Map & Multi-Product Controller
// ==========================================================================

let apmLatencyChart, apmThroughputChart, apmResourceChart;
let pollingInterval = null;
let currentTelemetry = null;
let currentBottlenecks = {
  db_exhaustion_enabled: false,
  memory_leak_enabled: false,
  cpu_lock_enabled: false
};
const MAX_SAMPLES = 30;

// Host Map Clusters Data
const hostClusters = {
  "1a": { zone: "us-east-1a", role: "UEM API Core", count: 18, prefix: "api-core" },
  "1c": { zone: "us-east-1c", role: "PostgreSQL & Redis Pool", count: 14, prefix: "db-pool" },
  "west": { zone: "us-west-1", role: "Telemetry Ingress", count: 16, prefix: "worker-ingest" }
};

document.addEventListener("DOMContentLoaded", () => {
  initApmCharts();
  buildHoneycombHostMap();
  bindProductAccordionTabs();
  bindChaosToggles();
  bindHeroActions();
  bindBitsAICopilot();
  startTelemetryPolling();
});

// --------------------------------------------------------------------------
// 1. Honeycomb Host Map Generation (Screenshots 2 & 4)
// --------------------------------------------------------------------------

function buildHoneycombHostMap() {
  Object.keys(hostClusters).forEach(clusterKey => {
    const cluster = hostClusters[clusterKey];
    const container = document.getElementById(`hexGrid-${clusterKey}`);
    if (!container) return;
    container.innerHTML = "";

    for (let i = 1; i <= cluster.count; i++) {
      const hex = document.createElement("div");
      const hostId = `${cluster.prefix}-${String(i).padStart(2, "0")}`;
      hex.className = "hexagon healthy";
      hex.id = `hex-${hostId}`;
      hex.dataset.host = hostId;
      hex.dataset.zone = cluster.zone;
      hex.dataset.role = cluster.role;

      hex.innerHTML = `<span class="hex-inner-label">${i}</span>`;

      hex.addEventListener("click", () => openHostCard(cluster, hostId, i));
      container.appendChild(hex);
    }
  });

  document.getElementById("closeHostCard").addEventListener("click", () => {
    document.getElementById("hostDetailCard").classList.remove("open");
  });
}

function openHostCard(cluster, hostId, index) {
  const card = document.getElementById("hostDetailCard");
  const isDbIssue = cluster.prefix.includes("db") && currentBottlenecks.db_exhaustion_enabled;
  const isMemIssue = cluster.prefix.includes("worker") && currentBottlenecks.memory_leak_enabled;
  const isCpuIssue = cluster.prefix.includes("api") && currentBottlenecks.cpu_lock_enabled;
  const isDegraded = isDbIssue || isMemIssue || isCpuIssue;

  document.getElementById("hostCardName").textContent = `host: ${hostId}`;
  document.getElementById("hostCardZone").textContent = `zone: ${cluster.zone} | IP: 10.20.${cluster.prefix.length}.${index * 4}`;

  const p99 = currentTelemetry ? currentTelemetry.p99_ms : 22.0;
  const cpu = isCpuIssue ? "94.2%" : (isDegraded ? "78.0%" : `${(15 + (index % 12)).toFixed(1)}%`);
  const mem = isMemIssue ? "480 MB" : `${(60 + (index % 15))} MB`;

  document.getElementById("hostCardCpu").textContent = cpu;
  document.getElementById("hostCardP99").textContent = `${p99} ms`;
  document.getElementById("hostCardMem").textContent = mem;

  const statusBadge = document.getElementById("hostCardStatus");
  statusBadge.textContent = isDegraded ? "CRITICAL" : "HEALTHY";
  statusBadge.className = `badge ${isDegraded ? "CRITICAL" : "HEALTHY"}`;

  const logBox = document.getElementById("hostCardLog");
  if (isDbIssue) {
    logBox.textContent = "🚨 CRITICAL: Thread blocked in DB_POOL_SEMAPHORE.acquire. Connection timeout after 120ms unindexed query.";
  } else if (isMemIssue) {
    logBox.textContent = "🚨 WARNING: Monotonic heap leak detected in telemetry ingestion buffer. GC pressure increasing.";
  } else if (isCpuIssue) {
    logBox.textContent = "🚨 CRITICAL: CPU spinlock in hashlib.sha256 starving event loop. Throughput throttled.";
  } else {
    logBox.textContent = "Nominal execution. All connection pools and thread workers operating within healthy bounds.";
  }

  card.classList.add("open");
}

function updateHoneycombStates() {
  const isDbDown = currentBottlenecks.db_exhaustion_enabled;
  const isMemDown = currentBottlenecks.memory_leak_enabled;
  const isCpuDown = currentBottlenecks.cpu_lock_enabled;

  // 1. Update DB cluster (us-east-1c)
  const cluster1c = document.getElementById("cluster-us-east-1c");
  if (cluster1c) {
    cluster1c.classList.toggle("degraded", isDbDown);
  }
  for (let i = 1; i <= 14; i++) {
    const hex = document.getElementById(`hex-db-pool-${String(i).padStart(2, "0")}`);
    if (hex) {
      if (isDbDown) {
        hex.className = (i % 3 === 0) ? "hexagon critical" : "hexagon warning";
      } else {
        hex.className = "hexagon healthy";
      }
    }
  }

  // 2. Update Ingress/Worker cluster (us-west-1)
  const clusterWest = document.getElementById("cluster-us-west-1");
  if (clusterWest) {
    clusterWest.classList.toggle("degraded", isMemDown);
  }
  for (let i = 1; i <= 16; i++) {
    const hex = document.getElementById(`hex-worker-ingest-${String(i).padStart(2, "0")}`);
    if (hex) {
      if (isMemDown) {
        hex.className = (i % 2 === 0) ? "hexagon critical" : "hexagon warning";
      } else {
        hex.className = "hexagon healthy";
      }
    }
  }

  // 3. Update API cluster (us-east-1a)
  const cluster1a = document.getElementById("cluster-us-east-1a");
  if (cluster1a) {
    cluster1a.classList.toggle("degraded", isCpuDown);
  }
  for (let i = 1; i <= 18; i++) {
    const hex = document.getElementById(`hex-api-core-${String(i).padStart(2, "0")}`);
    if (hex) {
      if (isCpuDown) {
        hex.className = "hexagon critical";
      } else {
        hex.className = "hexagon healthy";
      }
    }
  }
}

// --------------------------------------------------------------------------
// 2. Interactive Product Accordion & Navigation
// --------------------------------------------------------------------------

function bindProductAccordionTabs() {
  const tabs = document.querySelectorAll(".accordion-tab");
  const views = document.querySelectorAll(".product-view");
  const navDropdowns = document.querySelectorAll(".nav-link-dropdown");

  const activateView = (viewKey) => {
    tabs.forEach(t => t.classList.toggle("active", t.dataset.view === viewKey));
    views.forEach(v => v.classList.toggle("active", v.id === `view-${viewKey}`));
    navDropdowns.forEach(d => d.classList.toggle("active", d.dataset.target === viewKey));

    if (viewKey === "apm" && apmLatencyChart) {
      setTimeout(() => {
        apmLatencyChart.resize();
        apmThroughputChart.resize();
        apmResourceChart.resize();
      }, 50);
    }
  };

  tabs.forEach(tab => {
    tab.addEventListener("click", () => activateView(tab.dataset.view));
  });

  navDropdowns.forEach(item => {
    item.addEventListener("click", () => activateView(item.dataset.target));
  });
}

// --------------------------------------------------------------------------
// 3. Chaos Regressions & Hero Actions
// --------------------------------------------------------------------------

function bindChaosToggles() {
  const toggleDb = document.getElementById("sidebarToggleDb");
  const toggleMem = document.getElementById("sidebarToggleMem");
  const toggleCpu = document.getElementById("sidebarToggleCpu");
  const resetBtn = document.getElementById("navResetBtn");

  const applyBottlenecks = async () => {
    currentBottlenecks = {
      db_exhaustion_enabled: toggleDb.checked,
      db_simulated_delay_ms: 120.0,
      memory_leak_enabled: toggleMem.checked,
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
      updateHoneycombStates();
    } catch (err) {
      console.error("Failed to update bottlenecks:", err);
    }
  };

  toggleDb.addEventListener("change", applyBottlenecks);
  toggleMem.addEventListener("change", applyBottlenecks);
  toggleCpu.addEventListener("change", applyBottlenecks);

  resetBtn.addEventListener("click", async () => {
    if (!confirm("Reset all active regressions and memory buffers?")) return;
    try {
      await fetch("/api/v1/admin/reset", { method: "POST" });
      toggleDb.checked = false;
      toggleMem.checked = false;
      toggleCpu.checked = false;
      currentBottlenecks = { db_exhaustion_enabled: false, memory_leak_enabled: false, cpu_lock_enabled: false };
      updateHoneycombStates();
    } catch (err) {
      console.error("Reset failed:", err);
    }
  });
}

function bindHeroActions() {
  const heroLaunchBtn = document.getElementById("heroLaunchBtn");
  const heroInjectBtn = document.getElementById("heroInjectBtn");

  heroLaunchBtn.addEventListener("click", async () => {
    heroLaunchBtn.disabled = true;
    heroLaunchBtn.textContent = "Running Benchmark (500 VUs)...";
    try {
      await fetch("/api/v1/load/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workload_type: "spike" })
      });
    } catch (err) {
      console.error("Launch error:", err);
    }
    setTimeout(() => {
      heroLaunchBtn.disabled = false;
      heroLaunchBtn.textContent = "▶ Run 500 VU Load Test";
    }, 25000);
  });

  heroInjectBtn.addEventListener("click", async () => {
    const toggleDb = document.getElementById("sidebarToggleDb");
    toggleDb.checked = !toggleDb.checked;
    toggleDb.dispatchEvent(new Event("change"));

    if (toggleDb.checked) {
      heroInjectBtn.textContent = "✅ DB Starvation Active";
      heroInjectBtn.className = "btn btn-danger btn-lg";
    } else {
      heroInjectBtn.textContent = "⚠️ Inject DB Starvation";
      heroInjectBtn.className = "btn btn-outline-white btn-lg";
    }
  });

  // Load lab controls
  const labSlider = document.getElementById("labVuSlider");
  const labVuDisplay = document.getElementById("labVuDisplay");
  const labExecBtn = document.getElementById("labExecBtn");
  const labHaltBtn = document.getElementById("labHaltBtn");
  const labSelect = document.getElementById("labStrategySelect");

  labSlider.addEventListener("input", () => {
    labVuDisplay.textContent = `${labSlider.value} Virtual Users`;
  });

  labExecBtn.addEventListener("click", async () => {
    labExecBtn.disabled = true;
    labHaltBtn.disabled = false;
    try {
      await fetch("/api/v1/load/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workload_type: labSelect.value })
      });
    } catch (err) {
      console.error(err);
    }
  });

  labHaltBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/v1/load/stop", { method: "POST" });
    } catch (err) {
      console.error(err);
    }
  });

  document.getElementById("bitsDownloadBtn").addEventListener("click", () => {
    window.open("/api/v1/aiops/report/download", "_blank");
  });
}

// --------------------------------------------------------------------------
// 4. Bits AI Copilot (Datadog Bits AI Style)
// --------------------------------------------------------------------------

function bindBitsAICopilot() {
  const drawer = document.getElementById("copilotDrawer");
  const navBtn = document.getElementById("navCopilotBtn");
  const closeBtn = document.getElementById("closeCopilotBtn");
  const sendBtn = document.getElementById("sendCopilotBtn");
  const input = document.getElementById("copilotInput");
  const stream = document.getElementById("copilotChatStream");
  const chips = document.querySelectorAll(".prompt-chip");

  navBtn.addEventListener("click", () => drawer.classList.add("open"));
  closeBtn.addEventListener("click", () => drawer.classList.remove("open"));

  const appendMsg = (sender, html) => {
    const msg = document.createElement("div");
    msg.className = `chat-msg ${sender}`;
    msg.innerHTML = `
      <div class="msg-avatar">${sender === 'ai' ? '🤖' : '👤'}</div>
      <div class="msg-content">${html}</div>
    `;
    stream.appendChild(msg);
    stream.scrollTop = stream.scrollHeight;
  };

  const answerQuery = (q) => {
    appendMsg("user", q);
    input.value = "";

    setTimeout(() => {
      const p99 = currentTelemetry ? currentTelemetry.p99_ms : 22.0;
      let reply = "";

      if (q.includes("Why is p99") || q.includes("spiking")) {
        if (currentBottlenecks.db_exhaustion_enabled) {
          reply = `🚨 **p99 latency is currently ${p99}ms** due to **Database Connection Pool Starvation**. Workers are blocked on a 5-connection semaphore while executing unindexed sequential scans on \`/api/v1/workspaces\`. Notice the orange/red hexagons in **us-east-1c** on the Host Map!`;
        } else if (currentBottlenecks.cpu_lock_enabled) {
          reply = `🚨 **p99 latency is spiking** because synchronous cryptographic hashing (\`hashlib.sha256\`) is monopolizing 88% of CPU cycles, blocking the FastAPI asynchronous event loop in **us-east-1a**.`;
        } else if (currentBottlenecks.memory_leak_enabled) {
          reply = `⚠️ Latency degradation is being driven by heap allocation overhead in \`worker-ingest\` (**us-west-1**). An uncollected byte buffer in telemetry ingestion is bloating memory.`;
        } else {
          reply = `✅ **System is nominal.** Current p99 latency is **${p99}ms**, well below your contractual 200ms SLO limit. All host hexagons are green.`;
        }
      } else if (q.includes("DB pool") || q.includes("database")) {
        if (currentBottlenecks.db_exhaustion_enabled) {
          reply = `🔍 **DB Pool Analysis**: Active connections are saturated at 5/5. Average wait duration in pool queue is **${Math.round(p99 * 0.7)}ms**. Recommend scaling pool to 50 connections with index optimization.`;
        } else {
          reply = `✅ **DB Pool Analysis**: Connection pool is healthy with 0 connection wait time.`;
        }
      } else if (q.includes("memory leak") || q.includes("leak")) {
        if (currentBottlenecks.memory_leak_enabled) {
          reply = `🧪 **Memory Leak Alert**: Linear heap accumulation detected in \`LEAKED_MEMORY_BUFFER\`. Allocation rate is ~512KB per telemetry payload.`;
        } else {
          reply = `✅ **Memory State**: Heap is stable. Garbage collection cycles are healthy.`;
        }
      } else {
        reply = `🛠️ **Prescriptive Remediation Action Plan**:\n1. **Index DB**: Add compound B-tree index on \`workspace_id\` and \`tenant_id\`.\n2. **Resize Pool**: Increase DB pool capacity from 5 to 50 connections.\n3. **Circuit Breaker**: Implement 500ms connection timeout to fail fast.`;
      }

      appendMsg("ai", reply.replace(/\n/g, "<br>"));
    }, 350);
  };

  sendBtn.addEventListener("click", () => {
    if (input.value.trim()) answerQuery(input.value.trim());
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) answerQuery(input.value.trim());
  });

  chips.forEach(chip => {
    chip.addEventListener("click", () => answerQuery(chip.dataset.query));
  });
}

// --------------------------------------------------------------------------
// 5. APM Charts Initialization & Polling
// --------------------------------------------------------------------------

function initApmCharts() {
  const common = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 200 },
    scales: {
      x: { grid: { color: '#1c263c' }, ticks: { color: '#64748b', font: { size: 10 } } },
      y: { grid: { color: '#1c263c' }, ticks: { color: '#64748b', font: { size: 10 } }, beginAtZero: true }
    },
    plugins: { legend: { display: false } }
  };

  const ctxLat = document.getElementById("apmLatencyChart").getContext("2d");
  apmLatencyChart = new Chart(ctxLat, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "p50", borderColor: "#38bdf8", data: [], tension: 0.3, borderWidth: 2, pointRadius: 2 },
        { label: "p95", borderColor: "#f59e0b", data: [], tension: 0.3, borderWidth: 2, pointRadius: 2 },
        { label: "p99", borderColor: "#ef4444", data: [], tension: 0.3, borderWidth: 2.5, pointRadius: 3 },
        { label: "SLO", borderColor: "#94a3b8", borderDash: [5, 5], data: [], pointRadius: 0, borderWidth: 1.5, fill: false }
      ]
    },
    options: common
  });

  const ctxRps = document.getElementById("apmThroughputChart").getContext("2d");
  apmThroughputChart = new Chart(ctxRps, {
    type: "line",
    data: {
      labels: [],
      datasets: [{ label: "RPS", borderColor: "#10b981", backgroundColor: "rgba(16, 185, 129, 0.1)", fill: true, data: [], tension: 0.3, borderWidth: 2, pointRadius: 1 }]
    },
    options: common
  });

  const ctxMem = document.getElementById("apmResourceChart").getContext("2d");
  apmResourceChart = new Chart(ctxMem, {
    type: "line",
    data: {
      labels: [],
      datasets: [{ label: "RSS (MB)", borderColor: "#8b5cf6", backgroundColor: "rgba(139, 92, 246, 0.1)", fill: true, data: [], tension: 0.3, borderWidth: 2, pointRadius: 1 }]
    },
    options: common
  });
}

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
      updateHoneycombStates();
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

  document.getElementById("labExecBtn").disabled = isRunning;
  document.getElementById("labHaltBtn").disabled = !isRunning;
  document.getElementById("loadLabStatusBadge").textContent = isRunning ? "STATUS: BENCHMARK ACTIVE" : "STATUS: IDLE";
  document.getElementById("loadLabStatusBadge").className = `badge ${isRunning ? "WARNING" : "HEALTHY"}`;

  if (history.length === 0) return;
  const latest = history[history.length - 1];
  currentTelemetry = latest;

  // Hero Ticker
  document.getElementById("heroRps").innerHTML = `${latest.rps} <small>req/s</small>`;
  document.getElementById("heroP99").innerHTML = `${latest.p99_ms} <small>ms</small>`;
  document.getElementById("heroVus").innerHTML = `${latest.active_vus} <small>VUs</small>`;

  // Lab Matrix
  document.getElementById("mP50").textContent = `${latest.p50_ms} ms`;
  document.getElementById("mP95").textContent = `${latest.p95_ms} ms`;
  document.getElementById("mP99").textContent = `${latest.p99_ms} ms`;
  document.getElementById("mP999").textContent = `${latest.p999_ms} ms`;
  document.getElementById("mMax").textContent = `${latest.max_latency_ms} ms`;

  const mP99Health = document.getElementById("mP99Health");
  if (latest.p99_ms > 200.0) {
    mP99Health.textContent = "SLO BREACHED";
    mP99Health.className = "bad";
  } else {
    mP99Health.textContent = "Optimal";
    mP99Health.className = "good";
  }

  // APM Chart update
  const recent = history.slice(-MAX_SAMPLES);
  const labels = recent.map(s => `${s.elapsed_seconds}s`);

  apmLatencyChart.data.labels = labels;
  apmLatencyChart.data.datasets[0].data = recent.map(s => s.p50_ms);
  apmLatencyChart.data.datasets[1].data = recent.map(s => s.p95_ms);
  apmLatencyChart.data.datasets[2].data = recent.map(s => s.p99_ms);
  apmLatencyChart.data.datasets[3].data = recent.map(() => 200);
  apmLatencyChart.update();

  apmThroughputChart.data.labels = labels;
  apmThroughputChart.data.datasets[0].data = recent.map(s => s.rps);
  apmThroughputChart.update();
}

async function pollAdminStatus() {
  const res = await fetch("/api/v1/admin/status");
  const data = await res.json();

  const nowLabel = new Date().toLocaleTimeString().split(" ")[0];
  if (apmResourceChart.data.labels.length >= MAX_SAMPLES) {
    apmResourceChart.data.labels.shift();
    apmResourceChart.data.datasets[0].data.shift();
  }
  apmResourceChart.data.labels.push(nowLabel);
  apmResourceChart.data.datasets[0].data.push(data.rss_memory_mb);
  apmResourceChart.update();
}

async function pollAIOpsAnomalies() {
  const res = await fetch("/api/v1/aiops/anomalies");
  const data = await res.json();
  const anomalies = data.anomalies || [];

  document.getElementById("heroAnomalyCount").textContent = `${data.total_anomalies} Flags`;
  const stream = document.getElementById("bitsAnomalyStream");

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

  const sevBadge = document.getElementById("bitsSeverity");
  sevBadge.textContent = rca.severity;
  sevBadge.className = `badge ${rca.severity}`;

  document.getElementById("bitsIncId").textContent = rca.incident_id;
  document.getElementById("bitsConfidence").textContent = `${rca.confidence_pct}% Confidence`;
  document.getElementById("bitsTitle").textContent = rca.title;
  document.getElementById("bitsDiagnosis").textContent = rca.root_cause_diagnosis;
  document.getElementById("bitsHotspot").textContent = rca.profiler_hotspot;

  const list = document.getElementById("bitsRemediationList");
  list.innerHTML = (rca.prescriptive_remediation || []).map(r => `<li>${r}</li>`).join("");
}

async function pollFlameGraph() {
  const res = await fetch("/api/v1/aiops/profiling");
  const data = await res.json();
  if (!data || !data.tree) return;

  document.getElementById("profilerHotspotTitle").textContent = `Hotspot: ${data.hotspot_function}`;

  const container = document.getElementById("flameGraphBox");
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

  const tableBody = document.getElementById("profilerTableBody");
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
