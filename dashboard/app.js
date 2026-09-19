// ==========================================================================
// AIOps-Pulse: Parca.dev UI Controller
// 100% Preserved Original Project Options & Telemetry Engines
// ==========================================================================

let latencyChart = null;
let throughputChart = null;
let resourceChart = null;
let pollingInterval = null;
const MAX_DATA_POINTS = 30;

const workloadDescriptions = {
  baseline: "Steady 50 virtual users validating nominal SLO parameters.",
  spike: "Instantaneous surge from 50 to 500+ concurrent requests testing burst queues.",
  soak: "Sustained continuous load to uncover steady heap allocation and memory leak regressions.",
  stress: "Incremental ramp-up (100 -> 300 -> 700 -> 1000 VUs) to determine saturation point."
};

let currentState = {
  isRunning: false,
  activeVus: 0,
  p99: 0.0,
  p95: 0.0,
  p50: 0.0,
  rps: 0.0,
  errorRate: 0.0,
  totalRequests: 0,
  failedRequests: 0,
  memMb: 0.0,
  heapKb: 0,
  cpuPct: 0.0,
  bottlenecks: {
    db_exhaustion_enabled: false,
    memory_leak_enabled: false,
    cpu_lock_enabled: false
  }
};

// ==========================================================================
// Initialization on DOM Load
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  initHexMatrixCanvas();
  initCharts();
  bindEventHandlers();
  startTelemetryPolling();
});

// ==========================================================================
// 1. Live Hexadecimal Matrix Background (Changing Numbers & Alphabets)
// ==========================================================================
function initHexMatrixCanvas() {
  const canvas = document.getElementById("hexMatrixCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // Hexadecimal character set: numbers (0-9) and alphabets (A-F)
  const hexChars = "0123456789ABCDEF";
  function getRandomByte() {
    return hexChars[Math.floor(Math.random() * 16)] + hexChars[Math.floor(Math.random() * 16)];
  }

  let cols = 0;
  let rows = 0;
  let grid = [];
  const charSpacingX = 32;
  const charSpacingY = 22;
  const fontSize = 13;

  function resize() {
    const parent = canvas.parentElement;
    const width = parent.clientWidth || window.innerWidth;
    const height = parent.clientHeight || 720;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cols = Math.ceil(width / charSpacingX) + 2;
    rows = Math.ceil(height / charSpacingY) + 2;

    grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push({
          val: getRandomByte(),
          alpha: 0.16 + Math.random() * 0.18,
          glow: 0
        });
      }
      grid.push(row);
    }
  }

  window.addEventListener("resize", resize);
  resize();

  let lastUpdate = 0;
  function render(time) {
    requestAnimationFrame(render);

    // Dynamic morphing interval: ~35ms
    if (time - lastUpdate > 35) {
      lastUpdate = time;

      // Morph 6-8% of the hex cells to new random numbers and alphabets
      const totalCells = rows * cols;
      const count = Math.max(16, Math.floor(totalCells * 0.07));
      for (let i = 0; i < count; i++) {
        const r = Math.floor(Math.random() * rows);
        const c = Math.floor(Math.random() * cols);
        if (grid[r] && grid[r][c]) {
          grid[r][c].val = getRandomByte();
          if (Math.random() < 0.04) {
            grid[r][c].glow = 1.0;
          }
        }
      }
    }

    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);

    ctx.font = `${fontSize}px "JetBrains Mono", "SF Mono", Consolas, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c];
        const x = c * charSpacingX;
        const y = r * charSpacingY + (charSpacingY / 2);

        if (cell.glow > 0) {
          ctx.fillStyle = `rgba(139, 92, 246, ${0.4 + cell.glow * 0.4})`;
          cell.glow = Math.max(0, cell.glow - 0.06);
        } else {
          ctx.fillStyle = `rgba(255, 255, 255, ${cell.alpha})`;
        }

        ctx.fillText(cell.val, x, y);
      }
    }
  }

  requestAnimationFrame(render);
}

// ==========================================================================
// 2. Interactive Charts (Parca Non-Neon Styling)
// ==========================================================================
function initCharts() {
  const chartFont = { family: "'Inter', sans-serif", size: 11 };
  const gridColor = "rgba(226, 232, 240, 0.6)";
  const tickColor = "#64748b";

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    scales: {
      x: {
        grid: { color: gridColor },
        ticks: { color: tickColor, font: chartFont }
      },
      y: {
        grid: { color: gridColor },
        ticks: { color: tickColor, font: chartFont },
        beginAtZero: true
      }
    },
    plugins: {
      legend: { display: false }
    }
  };

  // 1. Latency Percentiles Chart (p50, p95, p99 vs 200ms SLO)
  const ctxLatency = document.getElementById("latencyChart")?.getContext("2d");
  if (ctxLatency) {
    latencyChart = new Chart(ctxLatency, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "p50 Latency (ms)",
            data: [],
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.05)",
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 2
          },
          {
            label: "p95 Latency (ms)",
            data: [],
            borderColor: "#f59e0b",
            backgroundColor: "transparent",
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 2
          },
          {
            label: "p99 Latency (ms)",
            data: [],
            borderColor: "#ef4444",
            backgroundColor: "transparent",
            borderWidth: 2.5,
            tension: 0.3,
            pointRadius: 3
          },
          {
            label: "SLO Limit (200ms)",
            data: [],
            borderColor: "#94a3b8",
            borderDash: [5, 5],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        ...commonOptions,
        scales: {
          ...commonOptions.scales,
          y: {
            ...commonOptions.scales.y,
            suggestedMax: 250,
            title: { display: true, text: "Milliseconds (ms)", color: tickColor, font: chartFont }
          }
        }
      }
    });
  }

  // 2. Throughput & VUs Chart
  const ctxThroughput = document.getElementById("throughputChart")?.getContext("2d");
  if (ctxThroughput) {
    throughputChart = new Chart(ctxThroughput, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Throughput (RPS)",
            data: [],
            borderColor: "#10b981",
            backgroundColor: "rgba(16, 185, 129, 0.08)",
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 2
          },
          {
            label: "VUs",
            data: [],
            borderColor: "#64748b",
            borderDash: [3, 3],
            borderWidth: 1.5,
            pointRadius: 0
          }
        ]
      },
      options: commonOptions
    });
  }

  // 3. Resource Saturation Chart (Memory RSS MB & CPU %)
  const ctxResource = document.getElementById("resourceChart")?.getContext("2d");
  if (ctxResource) {
    resourceChart = new Chart(ctxResource, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "RSS Memory (MB)",
            data: [],
            borderColor: "#8b5cf6",
            backgroundColor: "rgba(139, 92, 246, 0.08)",
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 2
          }
        ]
      },
      options: {
        ...commonOptions,
        scales: {
          ...commonOptions.scales,
          y: {
            ...commonOptions.scales.y,
            suggestedMax: 100
          }
        }
      }
    });
  }
}

// ==========================================================================
// 3. Event Handlers (Original Controls Preserved)
// ==========================================================================
function bindEventHandlers() {
  const workloadSelect = document.getElementById("workloadSelect");
  const workloadDesc = document.getElementById("workloadDesc");
  const startBtn = document.getElementById("startLoadBtn");
  const stopBtn = document.getElementById("stopLoadBtn");
  const tryNowBtn = document.getElementById("heroTryNowBtn");

  const toggleDb = document.getElementById("toggleDb");
  const toggleMemory = document.getElementById("toggleMemory");
  const toggleCpu = document.getElementById("toggleCpu");
  const resetBtn = document.getElementById("resetBtn");
  const resetBtnNav = document.getElementById("resetBtnNav");

  const downloadRcaBtn = document.getElementById("downloadRcaBtn");

  // Workload description updater
  workloadSelect?.addEventListener("change", (e) => {
    const val = e.target.value;
    if (workloadDesc) workloadDesc.textContent = workloadDescriptions[val] || "";
  });

  // Start Benchmark
  const handleStartLoad = async () => {
    const strategy = workloadSelect?.value || "spike";
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = "Running Benchmark...";
    }
    if (stopBtn) stopBtn.disabled = false;

    try {
      const resp = await fetch("/api/v1/load/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workload_type: strategy })
      });
      if (!resp.ok) {
        const err = await resp.json();
        alert(err.detail || "Failed to start benchmark.");
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.textContent = "Start Benchmark";
        }
      }
    } catch (e) {
      console.error("Start error:", e);
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.textContent = "Start Benchmark";
      }
    }
  };

  startBtn?.addEventListener("click", handleStartLoad);

  // Hero "Try it Now" starts load and smoothly scrolls to workspace
  tryNowBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    handleStartLoad();
    const target = document.getElementById("workload-section");
    if (target) {
      target.scrollIntoView({ behavior: "smooth" });
    }
  });

  // Stop Benchmark
  stopBtn?.addEventListener("click", async () => {
    stopBtn.disabled = true;
    try {
      await fetch("/api/v1/load/stop", { method: "POST" });
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.textContent = "Start Benchmark";
      }
    } catch (e) {
      console.error("Stop error:", e);
      stopBtn.disabled = false;
    }
  });

  // Chaos Regressions
  const updateChaosBottlenecks = async () => {
    const payload = {
      db_exhaustion_enabled: toggleDb?.checked || false,
      db_simulated_delay_ms: 120.0,
      memory_leak_enabled: toggleMemory?.checked || false,
      memory_leak_chunk_kb: 512,
      cpu_lock_enabled: toggleCpu?.checked || false,
      cpu_lock_iterations: 120000
    };

    try {
      await fetch("/api/v1/admin/bottlenecks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.error("Chaos error:", e);
    }
  };

  toggleDb?.addEventListener("change", updateChaosBottlenecks);
  toggleMemory?.addEventListener("change", updateChaosBottlenecks);
  toggleCpu?.addEventListener("change", updateChaosBottlenecks);

  // Reset System State
  const handleReset = async () => {
    if (!confirm("Reset all active regressions and memory buffers?")) return;
    try {
      await fetch("/api/v1/admin/reset", { method: "POST" });
      if (toggleDb) toggleDb.checked = false;
      if (toggleMemory) toggleMemory.checked = false;
      if (toggleCpu) toggleCpu.checked = false;
    } catch (e) {
      console.error("Reset error:", e);
    }
  };

  resetBtn?.addEventListener("click", handleReset);
  resetBtnNav?.addEventListener("click", handleReset);

  // Export Incident Report
  downloadRcaBtn?.addEventListener("click", () => {
    window.open("/api/v1/aiops/report/download", "_blank");
  });

  // AI Diagnostic Copilot Drawer Bindings
  bindCopilotDrawer();
}

// ==========================================================================
// 4. AI Diagnostic Copilot Slideover
// ==========================================================================
function bindCopilotDrawer() {
  const drawer = document.getElementById("copilotDrawer");
  const openTop = document.getElementById("openCopilotTop");
  const openFab = document.getElementById("floatingCopilotBtn");
  const closeBtn = document.getElementById("closeCopilotBtn");
  const sendBtn = document.getElementById("sendCopilotBtn");
  const input = document.getElementById("copilotInput");
  const stream = document.getElementById("copilotChatStream");
  const chips = document.querySelectorAll(".prompt-chip");

  const openDrawer = () => drawer?.classList.add("open");
  const closeDrawer = () => drawer?.classList.remove("open");

  openTop?.addEventListener("click", openDrawer);
  openFab?.addEventListener("click", openDrawer);
  closeBtn?.addEventListener("click", closeDrawer);

  const appendMessage = (sender, textHtml) => {
    const msg = document.createElement("div");
    msg.className = `chat-msg ${sender}`;
    msg.innerHTML = `
      <div class="msg-avatar">${sender === 'ai' ? '🤖' : '👤'}</div>
      <div class="msg-text">${textHtml}</div>
    `;
    stream?.appendChild(msg);
    if (stream) stream.scrollTop = stream.scrollHeight;
  };

  const handleQuery = (query) => {
    if (!query) return;
    appendMessage("user", escapeHtml(query));
    if (input) input.value = "";

    setTimeout(() => {
      const responseHtml = synthesizeCopilotReply(query);
      appendMessage("ai", responseHtml);
    }, 450);
  };

  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      const q = chip.getAttribute("data-query") || chip.textContent;
      handleQuery(q);
    });
  });

  sendBtn?.addEventListener("click", () => {
    handleQuery(input?.value?.trim());
  });

  input?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      handleQuery(input?.value?.trim());
    }
  });
}

function synthesizeCopilotReply(query) {
  const q = query.toLowerCase();
  const p99 = currentState.p99.toFixed(1);
  const rps = currentState.rps.toFixed(1);
  const vus = currentState.activeVus;
  const mem = currentState.memMb.toFixed(1);
  const b = currentState.bottlenecks;

  if (q.includes("p99") || q.includes("spik") || q.includes("latency") || q.includes("slow")) {
    if (b.db_exhaustion_enabled) {
      return `<strong>🚨 Bottleneck Identified: Database Pool Semaphore Starvation</strong><br/>
      Current p99 latency is <strong>${p99}ms</strong>, violating the 200ms SLO contract.<br/>
      Coroutines are blocking on <code>DB_POOL_SEMAPHORE.acquire</code> (5 connection cap) during unindexed scans.`;
    } else if (b.cpu_lock_enabled) {
      return `<strong>🚨 Bottleneck Identified: Event-Loop CPU Spinlock</strong><br/>
      Current p99 is <strong>${p99}ms</strong>. A synchronous cryptographic hashing loop is monopolizing the Python async event loop thread.`;
    } else if (currentState.p99 > 200) {
      return `<strong>⚠️ High Concurrency Saturation Detected</strong><br/>
      Current p99 latency is <strong>${p99}ms</strong> under ${vus} concurrent Virtual Users at ${rps} RPS. Worker pool is saturated.`;
    } else {
      return `<strong>✅ Systems Nominal</strong><br/>
      Current p99 latency is <strong>${p99}ms</strong>, comfortably inside the 200ms SLO budget (${vus} VUs active, ${rps} RPS).`;
    }
  }

  if (q.includes("db") || q.includes("pool") || q.includes("contention") || q.includes("database")) {
    if (b.db_exhaustion_enabled) {
      return `<strong>🔍 DB Pool Contention: ACTIVE</strong><br/>
      The database semaphore is hard-capped at 5 handles. Query queue times account for 68% of response latency. Recommend connection pool resizing.`;
    } else {
      return `<strong>🔍 DB Pool: HEALTHY</strong><br/>
      Zero semaphore queue stalls. All database lookups are resolving via memory indexes in sub-5ms.`;
    }
  }

  if (q.includes("memory") || q.includes("leak") || q.includes("heap")) {
    if (b.memory_leak_enabled) {
      return `<strong>🚨 Heap Memory Leak Detected</strong><br/>
      Telemetry buffer is appending 512KB uncollected byte chunks on incoming requests. Host RSS is now <strong>${mem} MB</strong>.`;
    } else {
      return `<strong>✅ Heap Memory: NOMINAL</strong><br/>
      RSS footprint is stable at <strong>${mem} MB</strong>. Python garbage collector is reclaiming all request allocations.`;
    }
  }

  if (q.includes("remediat") || q.includes("plan") || q.includes("step") || q.includes("action")) {
    return `<strong>🛠️ Prescriptive Remediation Plan</strong><br/>
    1. Trip API Gateway circuit breaker to shed 30% of non-essential endpoint telemetry.<br/>
    2. Expand async connection pool limits from 5 to 25 handles in <code>target_service/app.py</code>.<br/>
    3. Trigger Horizontal Pod Autoscaler (HPA) to spin up 2 replica workers.`;
  }

  return `<strong>⚡ AIOps Telemetry Summary</strong><br/>
  Current p99: <strong>${p99}ms</strong> | Throughput: <strong>${rps} RPS</strong> | Active VUs: <strong>${vus}</strong> | RSS Memory: <strong>${mem} MB</strong>.`;
}

// ==========================================================================
// 5. Telemetry Polling & Live Updates (Original Logic)
// ==========================================================================
function startTelemetryPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(fetchTelemetryData, 1500);
  fetchTelemetryData();
}

async function fetchTelemetryData() {
  try {
    const [adminResp, loadResp, anomalyResp, rcaResp, profileResp] = await Promise.all([
      fetch("/api/v1/admin/status"),
      fetch("/api/v1/load/history"),
      fetch("/api/v1/aiops/anomalies"),
      fetch("/api/v1/aiops/rca"),
      fetch("/api/v1/aiops/profiling")
    ]);

    if (!adminResp.ok || !loadResp.ok) return;

    const adminData = await adminResp.json();
    const loadData = await loadResp.json();
    const anomalyData = await anomalyResp.json();
    const rcaData = await rcaResp.json();
    const profileData = await profileResp.json();

    // Update state
    currentState.bottlenecks = adminData.bottlenecks || {};
    currentState.memMb = adminData.rss_memory_mb || 0;
    currentState.heapKb = adminData.heap_retained_kb || 0;
    currentState.cpuPct = adminData.cpu_percent || 0;
    currentState.isRunning = loadData.is_running;

    // Sync chaos toggles
    const toggleDb = document.getElementById("toggleDb");
    const toggleMemory = document.getElementById("toggleMemory");
    const toggleCpu = document.getElementById("toggleCpu");
    if (toggleDb && document.activeElement !== toggleDb) toggleDb.checked = currentState.bottlenecks.db_exhaustion_enabled;
    if (toggleMemory && document.activeElement !== toggleMemory) toggleMemory.checked = currentState.bottlenecks.memory_leak_enabled;
    if (toggleCpu && document.activeElement !== toggleCpu) toggleCpu.checked = currentState.bottlenecks.cpu_lock_enabled;

    // Start/Stop button states
    const startBtn = document.getElementById("startLoadBtn");
    const stopBtn = document.getElementById("stopLoadBtn");
    const kpiStatus = document.getElementById("kpiStatus");
    if (startBtn && stopBtn) {
      if (currentState.isRunning) {
        startBtn.disabled = true;
        startBtn.textContent = "Running Benchmark...";
        stopBtn.disabled = false;
        if (kpiStatus) {
          kpiStatus.textContent = "Active";
          kpiStatus.className = "badge-status-active";
        }
      } else {
        startBtn.disabled = false;
        startBtn.textContent = "Start Benchmark";
        stopBtn.disabled = true;
        if (kpiStatus) {
          kpiStatus.textContent = "Idle";
          kpiStatus.className = "badge-status-idle";
        }
      }

      const tryNowBtn = document.getElementById("heroTryNowBtn");
      if (tryNowBtn) {
        tryNowBtn.textContent = currentState.isRunning ? "Running Benchmark..." : "Run Benchmark";
      }
    }

    // Latest metric snapshot
    const history = loadData.history || [];
    const latest = history.length > 0 ? history[history.length - 1] : null;

    if (latest) {
      currentState.p99 = latest.p99_ms;
      currentState.p95 = latest.p95_ms;
      currentState.p50 = latest.p50_ms;
      currentState.rps = latest.rps;
      currentState.activeVus = latest.active_vus;
      currentState.errorRate = latest.error_rate_pct;
      currentState.totalRequests = latest.total_requests;
      currentState.failedRequests = latest.failed_requests;
    }

    // Update KPI Elements
    updateKPIs();

    // Update Charts
    updateCharts(history);

    // Update Flame Graph
    renderFlameGraph(profileData);

    // Update Anomalies
    renderAnomalies(anomalyData.anomalies || []);

    // Update RCA Card
    renderRCA(rcaData);

  } catch (err) {
    console.error("Telemetry fetch error:", err);
  }
}

function updateKPIs() {
  const kpiRps = document.getElementById("kpiRps");
  const kpiP99 = document.getElementById("kpiP99");
  const kpiP50 = document.getElementById("kpiP50");
  const kpiP95 = document.getElementById("kpiP95");
  const kpiVus = document.getElementById("kpiVus");
  const kpiError = document.getElementById("kpiError");
  const kpiMemory = document.getElementById("kpiMemory");
  const kpiHeap = document.getElementById("kpiHeap");
  const kpiTotalReq = document.getElementById("kpiTotalReq");
  const kpiFailed = document.getElementById("kpiFailed");
  const sloBadge = document.getElementById("sloBadge");

  if (kpiRps) kpiRps.innerHTML = `${currentState.rps.toFixed(1)} <small>RPS</small>`;
  if (kpiP99) kpiP99.innerHTML = `${currentState.p99.toFixed(1)} <small>ms</small>`;
  if (kpiP50) kpiP50.textContent = `p50: ${currentState.p50.toFixed(1)}ms`;
  if (kpiP95) kpiP95.textContent = `p95: ${currentState.p95.toFixed(1)}ms`;
  if (kpiVus) kpiVus.innerHTML = `${currentState.activeVus} <small>VUs</small>`;
  if (kpiError) kpiError.innerHTML = `${currentState.errorRate.toFixed(1)} <small>%</small>`;
  if (kpiMemory) kpiMemory.textContent = `${currentState.memMb.toFixed(1)} MB`;
  if (kpiHeap) kpiHeap.textContent = `${currentState.heapKb} KB`;
  if (kpiTotalReq) kpiTotalReq.textContent = `${currentState.totalRequests}`;
  if (kpiFailed) kpiFailed.textContent = `${currentState.failedRequests}`;

  // SLO Badge
  if (sloBadge) {
    if (currentState.p99 > 200.0) {
      sloBadge.textContent = "SLO BREACH";
      sloBadge.className = "pill-status-healthy pill-status-breach";
    } else {
      sloBadge.textContent = "HEALTHY";
      sloBadge.className = "pill-status-healthy";
    }
  }
}

function updateCharts(history) {
  const recent = history.slice(-MAX_DATA_POINTS);
  const labels = recent.map((_, i) => `${i + 1}s`);

  // Latency Chart
  if (latencyChart) {
    latencyChart.data.labels = labels;
    latencyChart.data.datasets[0].data = recent.map(s => s.p50_ms);
    latencyChart.data.datasets[1].data = recent.map(s => s.p95_ms);
    latencyChart.data.datasets[2].data = recent.map(s => s.p99_ms);
    latencyChart.data.datasets[3].data = recent.map(() => 200.0);
    latencyChart.update("none");
  }

  // Throughput Chart
  if (throughputChart) {
    throughputChart.data.labels = labels;
    throughputChart.data.datasets[0].data = recent.map(s => s.rps);
    throughputChart.data.datasets[1].data = recent.map(s => s.active_vus);
    throughputChart.update("none");
  }

  // Resource Chart
  if (resourceChart) {
    resourceChart.data.labels = labels;
    resourceChart.data.datasets[0].data = recent.map(() => currentState.memMb);
    resourceChart.update("none");
  }
}

function renderFlameGraph(profileData) {
  const container = document.getElementById("flamegraphView");
  const badge = document.getElementById("hotspotBadge");
  if (!container) return;

  const frames = profileData.frames || [];
  const hotspot = profileData.hotspot_method || "None (Balanced)";

  if (badge) {
    badge.textContent = hotspot;
    badge.className = hotspot.includes("None") ? "badge-hotspot-clean" : "badge-hotspot-clean hot";
  }

  container.innerHTML = frames.map(f => `
    <div style="margin-bottom: 8px;">
      <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px; font-family:var(--font-mono); color:#cbd5e1;">
        <span>${f.name}</span>
        <strong>${f.percentage.toFixed(1)}%</strong>
      </div>
      <div style="background:#1e293b; border-radius:4px; height:22px; overflow:hidden; border:1px solid #334155;">
        <div style="background:${f.is_bottleneck ? '#ef4444' : '#475569'}; width:${f.percentage}%; height:100%; display:flex; align-items:center; padding-left:8px; font-size:11px; font-weight:600; color:#ffffff;">
          ${f.percentage > 30 ? f.name : ''}
        </div>
      </div>
    </div>
  `).join("");
}

function renderAnomalies(anomalies) {
  const feed = document.getElementById("anomalyFeed");
  const badge = document.getElementById("anomalyCountBadge");
  if (!feed) return;

  if (badge) badge.textContent = `${anomalies.length} Flags`;

  if (anomalies.length === 0) {
    feed.innerHTML = `<div class="empty-state-text">No anomalies detected. Telemetry operating within normal variance.</div>`;
    return;
  }

  feed.innerHTML = anomalies.slice(0, 10).map(a => `
    <div class="anomaly-item">
      <strong>⚠️ ${escapeHtml(a.metric_name)} Anomaly</strong>
      <div>Observed: ${a.observed_value.toFixed(1)} (Threshold: ${a.threshold_value.toFixed(1)})</div>
    </div>
  `).join("");
}

function renderRCA(rca) {
  if (!rca) return;

  const sev = document.getElementById("rcaSeverity");
  const rcaId = document.getElementById("rcaId");
  const conf = document.getElementById("rcaConfidence");
  const title = document.getElementById("rcaTitle");
  const diag = document.getElementById("rcaDiagnosis");
  const hotspot = document.getElementById("rcaHotspot");
  const remList = document.getElementById("rcaRemediationList");

  if (sev) {
    sev.textContent = rca.severity || "NOMINAL";
    sev.className = rca.severity === "CRITICAL" ? "badge-severity breach" : "badge-severity";
  }
  if (rcaId) rcaId.textContent = rca.incident_id || "INC-BASELINE";
  if (conf) conf.textContent = `Confidence: ${(rca.confidence_score * 100).toFixed(0)}%`;
  if (title) title.textContent = rca.title || "Nominal System Performance";
  if (diag) diag.textContent = rca.summary || "Operating nominally.";
  if (hotspot) hotspot.textContent = rca.attributed_hotspot || "uvicorn.run (Balanced I/O)";

  if (remList && rca.prescriptive_remediation) {
    remList.innerHTML = rca.prescriptive_remediation.map(r => `<li>${escapeHtml(r)}</li>`).join("");
  }
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}
