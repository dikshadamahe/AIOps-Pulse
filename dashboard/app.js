// ==========================================================================
// AIOps-Pulse: Parca.dev Interactive Controller
// ==========================================================================

let parcaLatencyChart, parcaThroughputChart;
let pollingInterval = null;
let currentTelemetry = null;
let activeCodeMode = "db";
let activeBottlenecks = {
  db_exhaustion_enabled: false,
  memory_leak_enabled: false,
  cpu_lock_enabled: false
};
const MAX_SAMPLES = 30;

// Code Snippets for Parca Interactive Code Inspector (Screenshots 4 & 5)
const codeSnippets = {
  db: {
    title: "target_service/app.py",
    lang: "Python 3.11",
    actionTitle: "Active Bottleneck: Database Pool Semaphore Starvation",
    actionDesc: "Simulates unindexed sequential table scan causing 68% of worker coroutines to stall in DB_POOL_SEMAPHORE.acquire.",
    cpuVal: "24%",
    memVal: "68 MB",
    ioVal: "68%",
    isDegraded: true,
    lines: [
      { ln: 75, code: "async def list_workspaces():", slow: false },
      { ln: 76, code: '    """Lists workspaces with optional DB pool starvation."""', slow: false },
      { ln: 77, code: "    if BOTTLENECK_CONFIG.db_exhaustion_enabled:", slow: false },
      { ln: 78, code: "        wait_start = time.perf_counter()", slow: false },
      { ln: 79, code: "        async with DB_POOL_SEMAPHORE:  # Thread Pool Lock Contention (5 limit)", slow: true },
      { ln: 80, code: "            await asyncio.sleep(BOTTLENECK_CONFIG.db_delay_sec) # Unindexed scan", slow: true },
      { ln: 81, code: "    return list(WORKSPACES_DB.values())", slow: false }
    ]
  },
  mem: {
    title: "target_service/app.py",
    lang: "Python 3.11",
    actionTitle: "Active Bottleneck: Heap Memory Leak in Telemetry Ingestion",
    actionDesc: "Appends uncollected byte arrays to a global buffer on every request, triggering monotonic memory bloat.",
    cpuVal: "18%",
    memVal: "94%",
    ioVal: "12%",
    isDegraded: true,
    lines: [
      { ln: 110, code: "async def submit_device_telemetry(payload: Dict):", slow: false },
      { ln: 111, code: '    """Ingests high-frequency device telemetry."""', slow: false },
      { ln: 112, code: "    if BOTTLENECK_CONFIG.memory_leak_enabled:", slow: false },
      { ln: 113, code: "        chunk = os.urandom(512 * 1024)  # 512KB uncollected buffer", slow: false },
      { ln: 114, code: "        LEAKED_MEMORY_BUFFER.append(chunk)  # Monotonic Heap Growth (OOM Risk)", slow: true },
      { ln: 115, code: "        HEAP_ALLOCATION_BYTES.set(sum(len(c) for c in LEAKED_MEMORY_BUFFER))", slow: true },
      { ln: 116, code: '    return {"status": "ingested", "device_id": payload.get("id")}', slow: false }
    ]
  },
  cpu: {
    title: "target_service/app.py",
    lang: "Python 3.11",
    actionTitle: "Active Bottleneck: Event-Loop Synchronous CPU Spinlock",
    actionDesc: "A synchronous cryptographic loop blocks the event loop thread, monopolizing 88.5% of CPU cycles.",
    cpuVal: "88%",
    memVal: "62 MB",
    ioVal: "5%",
    isDegraded: true,
    lines: [
      { ln: 85, code: "if BOTTLENECK_CONFIG.cpu_lock_enabled:", slow: false },
      { ln: 86, code: '    dummy = b"omnissa-workload-data"', slow: false },
      { ln: 87, code: "    # Synchronous cryptographic hashing blocking async event loop:", slow: false },
      { ln: 88, code: "    for _ in range(120000):", slow: true },
      { ln: 89, code: "        dummy = hashlib.sha256(dummy).digest()  # Consumes 88.5% CPU time", slow: true },
      { ln: 90, code: "    return list(WORKSPACES_DB.values())", slow: false }
    ]
  },
  nominal: {
    title: "target_service/app.py",
    lang: "Python 3.11",
    actionTitle: "Nominal System State: Non-blocking Clean Execution",
    actionDesc: "Zero bottlenecks injected. Database queries use indexed lookups; memory allocations are GC-collected.",
    cpuVal: "14%",
    memVal: "58 MB",
    ioVal: "2%",
    isDegraded: false,
    lines: [
      { ln: 75, code: "async def list_workspaces():", slow: false },
      { ln: 76, code: '    """Nominal non-blocking workspace retrieval."""', slow: false },
      { ln: 77, code: "    # B-tree indexed fast memory lookup:", slow: false },
      { ln: 78, code: "    return list(WORKSPACES_DB.values())  # Sub-15ms p99 execution", slow: false }
    ]
  }
};

document.addEventListener("DOMContentLoaded", () => {
  initHexMatrixCanvas();
  renderCodeInspector("db");
  initParcaCharts();
  bindCodeTabs();
  bindHeroControls();
  bindCopilotDrawer();
  startTelemetryPolling();
});

// --------------------------------------------------------------------------
// 0. Live Hexadecimal Matrix Background (Changing Numbers & Alphabets)
// --------------------------------------------------------------------------
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
  const charSpacingX = 32; // horizontal space between hex byte columns
  const charSpacingY = 22; // vertical line height
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
          alpha: 0.16 + Math.random() * 0.18, // subtle readable contrast
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

    // Update interval: ~30-40ms for active, dynamic byte changing
    if (time - lastUpdate > 35) {
      lastUpdate = time;

      // Morph 5% to 8% of the hex characters each tick (both numbers and alphabets change continuously)
      const totalCells = rows * cols;
      const count = Math.max(16, Math.floor(totalCells * 0.07));
      for (let i = 0; i < count; i++) {
        const r = Math.floor(Math.random() * rows);
        const c = Math.floor(Math.random() * cols);
        if (grid[r] && grid[r][c]) {
          grid[r][c].val = getRandomByte();
          // Occasional highlight flash
          if (Math.random() < 0.04) {
            grid[r][c].glow = 1.0;
          }
        }
      }
    }

    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);

    ctx.font = `${fontSize}px "SF Mono", "Fira Code", Monaco, Consolas, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c];
        const x = c * charSpacingX;
        const y = r * charSpacingY + (charSpacingY / 2);

        if (cell.glow > 0) {
          ctx.fillStyle = `rgba(168, 85, 247, ${0.4 + cell.glow * 0.5})`;
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

// --------------------------------------------------------------------------
// 1. Code Inspector (Parca Screenshots 4 & 5)
// --------------------------------------------------------------------------

function renderCodeInspector(mode) {
  activeCodeMode = mode;
  const snippet = codeSnippets[mode] || codeSnippets.db;

  document.getElementById("activeEditorTitle").textContent = snippet.title;
  document.getElementById("activeEditorLang").textContent = snippet.lang;
  document.getElementById("actionTitle").textContent = snippet.actionTitle;
  document.getElementById("actionDesc").textContent = snippet.actionDesc;

  document.getElementById("badgeCpuVal").textContent = snippet.cpuVal;
  document.getElementById("badgeMemVal").textContent = snippet.memVal;
  document.getElementById("badgeIoVal").textContent = snippet.ioVal;

  const btn = document.getElementById("toggleActiveBottleneckBtn");
  if (mode === "nominal") {
    btn.textContent = "Reset to Baseline";
  } else {
    const isCurrentlyActive = (mode === "db" && activeBottlenecks.db_exhaustion_enabled) ||
                              (mode === "mem" && activeBottlenecks.memory_leak_enabled) ||
                              (mode === "cpu" && activeBottlenecks.cpu_lock_enabled);
    btn.textContent = isCurrentlyActive ? "Deactivate Bottleneck" : "Inject This Bottleneck";
    btn.style.background = isCurrentlyActive ? "#ef4444" : "#090d16";
  }

  const container = document.getElementById("editorCodeContent");
  container.innerHTML = snippet.lines.map(l => `
    <div class="code-row ${l.slow ? 'slow-hotspot' : ''}">
      <span class="ln">${l.ln}</span>
      <code>${escapeHtml(l.code)}</code>
    </div>
  `).join("");
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bindCodeTabs() {
  const tabs = document.querySelectorAll(".code-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderCodeInspector(tab.dataset.mode);
    });
  });

  const toggleBtn = document.getElementById("toggleActiveBottleneckBtn");
  toggleBtn.addEventListener("click", async () => {
    if (activeCodeMode === "nominal") {
      await fetch("/api/v1/admin/reset", { method: "POST" });
      activeBottlenecks = { db_exhaustion_enabled: false, memory_leak_enabled: false, cpu_lock_enabled: false };
    } else if (activeCodeMode === "db") {
      activeBottlenecks.db_exhaustion_enabled = !activeBottlenecks.db_exhaustion_enabled;
      await postBottlenecks();
    } else if (activeCodeMode === "mem") {
      activeBottlenecks.memory_leak_enabled = !activeBottlenecks.memory_leak_enabled;
      await postBottlenecks();
    } else if (activeCodeMode === "cpu") {
      activeBottlenecks.cpu_lock_enabled = !activeBottlenecks.cpu_lock_enabled;
      await postBottlenecks();
    }
    renderCodeInspector(activeCodeMode);
  });
}

async function postBottlenecks() {
  await fetch("/api/v1/admin/bottlenecks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      db_exhaustion_enabled: activeBottlenecks.db_exhaustion_enabled,
      db_simulated_delay_ms: 120.0,
      memory_leak_enabled: activeBottlenecks.memory_leak_enabled,
      memory_leak_chunk_kb: 512,
      cpu_lock_enabled: activeBottlenecks.cpu_lock_enabled,
      cpu_lock_iterations: 120000
    })
  });
}

// --------------------------------------------------------------------------
// 2. Hero Controls & Reset
// --------------------------------------------------------------------------

function bindHeroControls() {
  const tryBtn = document.getElementById("heroTryNowBtn");
  const navTry = document.getElementById("navTryBtn");
  const runBtn = document.getElementById("runBenchmarkBtn") || document.getElementById("heroRunTestBtn");
  const stopBtn = document.getElementById("stopBenchmarkBtn");
  const workloadSelect = document.getElementById("workloadSelect");
  const topReset = document.getElementById("topResetBtn");

  const handleTryClick = (e) => {
    e.preventDefault();
    const target = document.getElementById("code-inspection");
    if (target) {
      target.scrollIntoView({ behavior: "smooth" });
    }
  };

  tryBtn?.addEventListener("click", handleTryClick);
  navTry?.addEventListener("click", handleTryClick);

  runBtn?.addEventListener("click", async () => {
    const selectedWorkload = workloadSelect?.value || "spike";
    runBtn.disabled = true;
    runBtn.textContent = "Running Load...";
    if (stopBtn) stopBtn.disabled = false;

    try {
      await fetch("/api/v1/load/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workload_type: selectedWorkload })
      });
    } catch (err) {
      console.error("Load start error:", err);
      runBtn.disabled = false;
      runBtn.textContent = "⚡ Run Benchmark";
    }
  });

  stopBtn?.addEventListener("click", async () => {
    stopBtn.disabled = true;
    try {
      await fetch("/api/v1/load/stop", { method: "POST" });
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = "⚡ Run Benchmark";
      }
    } catch (err) {
      console.error("Load stop error:", err);
    }
  });

  topReset?.addEventListener("click", async () => {
    if (!confirm("Reset all active bottlenecks and memory buffers?")) return;
    await fetch("/api/v1/admin/reset", { method: "POST" });
    activeBottlenecks = { db_exhaustion_enabled: false, memory_leak_enabled: false, cpu_lock_enabled: false };
    renderCodeInspector(activeCodeMode);
  });

  document.getElementById("downloadRcaMarkdown")?.addEventListener("click", () => {
    window.open("/api/v1/aiops/report/download", "_blank");
  });
}

// --------------------------------------------------------------------------
// 3. Floating Copilot Drawer
// --------------------------------------------------------------------------

function bindCopilotDrawer() {
  const drawer = document.getElementById("copilotDrawer");
  const openBtn = document.getElementById("openCopilotTop");
  const floatingBtn = document.getElementById("floatingCopilotBtn");
  const closeBtn = document.getElementById("closeCopilotBtn");
  const sendBtn = document.getElementById("sendCopilotBtn");
  const input = document.getElementById("copilotInput");
  const stream = document.getElementById("copilotChatStream");
  const chips = document.querySelectorAll(".prompt-chip");

  const openDrawer = () => drawer?.classList.add("open");
  const closeDrawer = () => drawer?.classList.remove("open");

  openBtn?.addEventListener("click", openDrawer);
  floatingBtn?.addEventListener("click", openDrawer);
  closeBtn?.addEventListener("click", closeDrawer);

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
        if (activeBottlenecks.db_exhaustion_enabled) {
          reply = `🚨 **p99 latency is currently ${p99}ms** due to **Database Connection Pool Starvation**. Workers are stalled in \`async with DB_POOL_SEMAPHORE:\` on line 79 of \`app.py\` while executing unindexed sequential table scans.`;
        } else if (activeBottlenecks.cpu_lock_enabled) {
          reply = `🚨 **p99 latency is spiking** because a synchronous cryptographic loop (\`hashlib.sha256\`) on line 89 is monopolizing 88% of CPU cycles, blocking the non-blocking event loop.`;
        } else if (activeBottlenecks.memory_leak_enabled) {
          reply = `⚠️ Latency degradation is driven by memory allocation overhead. An uncollected byte buffer on line 114 in \`submit_device_telemetry\` is bloating the heap.`;
        } else {
          reply = `✅ **System is nominal.** Current p99 latency is **${p99}ms**, well below your contractual 200ms SLO limit.`;
        }
      } else if (q.includes("DB pool") || q.includes("database")) {
        if (activeBottlenecks.db_exhaustion_enabled) {
          reply = `🔍 **DB Pool Analysis**: Active connections saturated at 5/5. Average wait duration in pool queue is **${Math.round(p99 * 0.7)}ms**. Recommend scaling pool to 50 connections with index optimization.`;
        } else {
          reply = `✅ **DB Pool Analysis**: Connection pool is healthy with 0 connection wait time.`;
        }
      } else if (q.includes("memory leak") || q.includes("leak")) {
        if (activeBottlenecks.memory_leak_enabled) {
          reply = `🧪 **Memory Leak Alert**: Linear heap accumulation detected in \`LEAKED_MEMORY_BUFFER\`. Allocation rate is ~512KB per telemetry payload.`;
        } else {
          reply = `✅ **Memory State**: Heap is stable. Garbage collection cycles are healthy.`;
        }
      } else {
        reply = `🛠️ **3-Step Remediation Plan**:\n1. **Index Database**: Add compound B-tree index on \`workspace_id\` and \`tenant_id\`.\n2. **Resize Pool**: Increase DB pool capacity from 5 to 50 connections.\n3. **Circuit Breaker**: Implement 500ms connection timeout to fail fast.`;
      }

      appendMsg("ai", reply.replace(/\n/g, "<br>"));
    }, 300);
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
// 4. Parca Charts & Live Telemetry Polling
// --------------------------------------------------------------------------

function initParcaCharts() {
  const common = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 200 },
    scales: {
      x: { grid: { color: '#f1f5f9' }, ticks: { color: '#64748b', font: { size: 10 } } },
      y: { grid: { color: '#f1f5f9' }, ticks: { color: '#64748b', font: { size: 10 } }, beginAtZero: true }
    },
    plugins: { legend: { display: false } }
  };

  const ctxLat = document.getElementById("parcaLatencyChart").getContext("2d");
  parcaLatencyChart = new Chart(ctxLat, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "p50", borderColor: "#0284c7", data: [], tension: 0.3, borderWidth: 2, pointRadius: 2 },
        { label: "p95", borderColor: "#d97706", data: [], tension: 0.3, borderWidth: 2, pointRadius: 2 },
        { label: "p99", borderColor: "#dc2626", data: [], tension: 0.3, borderWidth: 2.5, pointRadius: 3 },
        { label: "SLO", borderColor: "#94a3b8", borderDash: [5, 5], data: [], pointRadius: 0, borderWidth: 1.5, fill: false }
      ]
    },
    options: common
  });

  const ctxRps = document.getElementById("parcaThroughputChart").getContext("2d");
  parcaThroughputChart = new Chart(ctxRps, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "RPS", borderColor: "#10b981", backgroundColor: "rgba(16, 185, 129, 0.1)", fill: true, data: [], tension: 0.3, borderWidth: 2, pointRadius: 1 },
        { label: "Memory (MB)", borderColor: "#8b5cf6", borderDash: [3, 3], data: [], tension: 0.2, borderWidth: 1.5, pointRadius: 0 }
      ]
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
    } catch (err) {
      console.error("Telemetry sync error:", err);
    }
  }, 1000);
}

async function pollLoadHistory() {
  const res = await fetch("/api/v1/load/history");
  const data = await res.json();
  const history = data.history || [];

  if (history.length === 0) return;
  const latest = history[history.length - 1];
  currentTelemetry = latest;

  // Hero Pill
  document.getElementById("pillRps").innerHTML = `${latest.rps} <small>RPS</small>`;
  document.getElementById("pillP99").innerHTML = `${latest.p99_ms} <small>ms</small>`;
  document.getElementById("pillVus").innerHTML = `${latest.active_vus} <small>VUs</small>`;

  // Update Latency Chart
  const recent = history.slice(-MAX_SAMPLES);
  const labels = recent.map(s => `${s.elapsed_seconds}s`);

  parcaLatencyChart.data.labels = labels;
  parcaLatencyChart.data.datasets[0].data = recent.map(s => s.p50_ms);
  parcaLatencyChart.data.datasets[1].data = recent.map(s => s.p95_ms);
  parcaLatencyChart.data.datasets[2].data = recent.map(s => s.p99_ms);
  parcaLatencyChart.data.datasets[3].data = recent.map(() => 200);
  parcaLatencyChart.update();

  parcaThroughputChart.data.labels = labels;
  parcaThroughputChart.data.datasets[0].data = recent.map(s => s.rps);
  parcaThroughputChart.update();
}

async function pollAdminStatus() {
  const res = await fetch("/api/v1/admin/status");
  const data = await res.json();
  if (parcaThroughputChart && parcaThroughputChart.data.datasets.length > 1) {
    const recent = parcaThroughputChart.data.labels;
    parcaThroughputChart.data.datasets[1].data = recent.map(() => data.rss_memory_mb);
  }
}

async function pollAIOpsAnomalies() {
  const res = await fetch("/api/v1/aiops/anomalies");
  const data = await res.json();
  document.getElementById("pillAnomalies").textContent = `${data.total_anomalies} Flags`;
}

async function pollRCA() {
  const res = await fetch("/api/v1/aiops/rca");
  const rca = await res.json();
  if (!rca || !rca.incident_id) return;

  const badge = document.getElementById("rcaStatusBadge");
  badge.textContent = rca.severity;
  badge.className = `rca-badge ${rca.severity}`;

  document.getElementById("rcaIncidentId").textContent = rca.incident_id;
  document.getElementById("rcaConfidenceVal").textContent = `${rca.confidence_pct}% Confidence`;
  document.getElementById("rcaHeading").textContent = rca.title;
  document.getElementById("rcaSummary").textContent = rca.root_cause_diagnosis;
  document.getElementById("rcaHotspotCode").textContent = rca.profiler_hotspot;

  const ul = document.getElementById("rcaRemediationUl");
  ul.innerHTML = (rca.prescriptive_remediation || []).map(r => `<li>${r}</li>`).join("");
}

async function pollFlameGraph() {
  const res = await fetch("/api/v1/aiops/profiling");
  const data = await res.json();
  if (!data || !data.tree) return;

  document.getElementById("flameHotspotFlag").textContent = `Hotspot: ${data.hotspot_function}`;

  const container = document.getElementById("flameGraphCanvas");
  const rows = [];

  function walk(node, depth = 0) {
    const isHot = data.hotspot_function && node.name.includes(data.hotspot_function.split(".")[0]);
    const indent = "&nbsp;".repeat(depth * 4);
    rows.push(`
      <div class="flame-bar-row ${isHot ? 'hotspot' : ''}">
        <span style="flex:1; color:#f8fafc;">${indent}↳ ${node.name}</span>
        <div style="width: 140px;">
          <div class="flame-visual-bar" style="width: ${Math.min(node.value, 100)}%;"></div>
        </div>
        <span style="color:#94a3b8; width:50px; text-align:right;">${node.value}%</span>
      </div>
    `);
    if (node.children) node.children.forEach(c => walk(c, depth + 1));
  }

  walk(data.tree);
  container.innerHTML = rows.join("");
}
