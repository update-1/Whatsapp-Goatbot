// Frontend dashboard controller logic for Goat AI

let socket = null;
let currentToken = localStorage.getItem("secret_token") || "1234";
let activeTab = "overview";
let linkerMode = "pair";
let globalConfig = {};

// Cache references to DOM elements
const loginContainer = document.getElementById("login-container");
const dashboardContainer = document.getElementById("dashboard-container");
const adminKeyInput = document.getElementById("admin-key-input");
const loginSubmitBtn = document.getElementById("login-submit-btn");
const loginErrorMsg = document.getElementById("login-error-msg");

const navTabs = document.querySelectorAll(".nav-tab");
const tabPanes = document.querySelectorAll(".tab-pane");

const btnSessionModal = document.getElementById("btn-session-modal");
const btnRestartBot = document.getElementById("btn-restart-bot");
const btnLogout = document.getElementById("btn-logout");
const btnTerminate = document.getElementById("btn-terminate");
const btnFlush = document.getElementById("btn-flush");

const sessionModal = document.getElementById("session-modal");
const btnCloseSessionModal = document.getElementById("btn-close-session-modal");
const btnCancelSession = document.getElementById("btn-cancel-session");
const btnSubmitSession = document.getElementById("btn-submit-session");
const sessionIdTextarea = document.getElementById("session-id-textarea");

// Code Editor references
const editorModal = document.getElementById("editor-modal");
const btnCloseEditorModal = document.getElementById("btn-close-editor-modal");
const btnCancelEditor = document.getElementById("btn-cancel-editor");
const btnSaveEditor = document.getElementById("btn-save-editor");
const editorCmdName = document.getElementById("editor-cmd-name");
const editorFileInfo = document.getElementById("editor-file-info");
let editingCmdName = "";

// Initialize Ace Editor
let codeEditor = null;
function initAceEditor() {
  if (codeEditor) return;
  ace.config.set("basePath", "https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.2/");
  codeEditor = ace.edit("editor-code-container");
  codeEditor.setTheme("ace/theme/dracula");
  codeEditor.session.setMode("ace/mode/javascript");
  codeEditor.setShowPrintMargin(false);
  codeEditor.session.setUseWorker(false);
}

// Uptime Formatter
function formatUptime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "0s";
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

// Memory/Storage size formatter
function formatSize(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ANSI Escape Code Parser to CSS HTML
function ansiToHtml(text) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const ansiMap = {
    "\x1b[1m": '<span style="font-weight: bold;">',
    "\x1b[2m": '<span style="opacity: 0.6;">',
    "\x1b[3m": '<span style="font-style: italic;">',
    "\x1b[4m": '<span style="text-decoration: underline;">',

    "\x1b[30m": '<span style="color: #2c3e50;">',
    "\x1b[31m": '<span style="color: #ff5c7a; font-weight: 500;">',
    "\x1b[32m": '<span style="color: #22d39a; font-weight: 500;">',
    "\x1b[33m": '<span style="color: #ffb648; font-weight: 500;">',
    "\x1b[34m": '<span style="color: #74b9ff; font-weight: 500;">',
    "\x1b[35m": '<span style="color: #fd79a8; font-weight: 500;">',
    "\x1b[36m": '<span style="color: #00cec9; font-weight: 500;">',
    "\x1b[37m": '<span style="color: #dfe6e9;">',
    "\x1b[90m": '<span style="color: #636e72;">',

    "\x1b[91m": '<span style="color: #ff7675; font-weight: 500;">',
    "\x1b[92m": '<span style="color: #55efc4; font-weight: 500;">',
    "\x1b[93m": '<span style="color: #ffeaa7; font-weight: 500;">',
    "\x1b[94m": '<span style="color: #74b9ff; font-weight: 500;">',
    "\x1b[95m": '<span style="color: #a29bfe; font-weight: 500;">',
    "\x1b[96m": '<span style="color: #81ecec; font-weight: 500;">',
    "\x1b[97m": '<span style="color: #ffffff;">',

    "\x1b[40m": '<span style="background-color: #1e202d;">',
    "\x1b[41m": '<span style="background-color: #ff5c7a; color: #000; padding: 1px 4px; border-radius: 3px;">',
    "\x1b[42m": '<span style="background-color: #22d39a; color: #000; padding: 1px 4px; border-radius: 3px;">',
    "\x1b[43m": '<span style="background-color: #ffb648; color: #000; padding: 1px 4px; border-radius: 3px;">',
    "\x1b[44m": '<span style="background-color: #74b9ff; color: #000; padding: 1px 4px; border-radius: 3px;">',
  };

  html = html.replace(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g, '<span style="color: rgb($1,$2,$3); font-weight: 500;">');
  html = html.replace(/\x1b\[48;2;(\d+);(\d+);(\d+)m/g, '<span style="background-color: rgb($1,$2,$3); color: #000; padding: 2px 4px; border-radius: 4px;">');

  for (const key in ansiMap) {
    html = html.split(key).join(ansiMap[key]);
  }

  html = html.replace(/\x1b\[(39|49|22|23|24|29|0)m/g, '</span>');
  html = html.replace(/\x1b\[[0-9;]*m/g, '');

  return html;
}

// Toast notification helper
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  let icon = "fa-circle-check";
  if (type === "danger") icon = "fa-circle-xmark";
  if (type === "warning") icon = "fa-triangle-exclamation";

  toast.innerHTML = `
    <i class="fa-solid ${icon} toast-icon"></i>
    <div class="toast-message">${message}</div>
  `;

  container.appendChild(toast);

  // slide out and delete
  setTimeout(() => {
    toast.style.transform = "translateX(120%)";
    toast.style.transition = "transform 0.4s ease";
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// API helper request wrapper
async function apiRequest(endpoint, method = "GET", data = null) {
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${currentToken}`
  };

  const options = { method, headers };
  if (data) options.body = JSON.stringify(data);

  try {
    const res = await fetch(endpoint, options);
    if (res.status === 401) {
      showToast("Access token invalid. Locking dashboard...", "danger");
      handleLogout();
      throw new Error("Unauthorized");
    }
    const result = await res.json();
    if (result.status === "error") {
      throw new Error(result.message);
    }
    return result;
  } catch (err) {
    if (err.message !== "Unauthorized") {
      showToast(err.message || "Failed API request", "danger");
    }
    throw err;
  }
}

// Handle login validation and credentials setup
async function handleLoginSubmit(event) {
  if (event) event.preventDefault();
  const tokenInput = adminKeyInput.value.trim();
  if (!tokenInput) {
    loginErrorMsg.innerText = "Please enter a key.";
    return;
  }

  loginSubmitBtn.disabled = true;
  loginSubmitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Checking Key...';

  try {
    // Perform authentication call checking token validity
    const res = await fetch(`/api/metrics?token=${encodeURIComponent(tokenInput)}`);
    if (res.status === 200) {
      currentToken = tokenInput;
      localStorage.setItem("secret_token", currentToken);

      loginErrorMsg.innerText = "";
      loginContainer.classList.add("hidden");
      dashboardContainer.classList.remove("hidden");

      showToast("Console unlocked successfully!");
      initSocket();
      loadActiveTab();
    } else {
      loginErrorMsg.innerText = "Invalid secret key. Try again.";
    }
  } catch (err) {
    loginErrorMsg.innerText = "Connection error. Is the server running?";
  } finally {
    loginSubmitBtn.disabled = false;
    loginSubmitBtn.innerHTML = '<i class="fa-solid fa-unlock-keyhole"></i> Unlock Dashboard';
  }
}

// Log out / Lock screen
function handleLogout() {
  localStorage.removeItem("secret_token");
  currentToken = "";
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  dashboardContainer.classList.add("hidden");
  loginContainer.classList.remove("hidden");
  adminKeyInput.value = "";
  loginErrorMsg.innerText = "";
}

// Socket IO setup
function initSocket() {
  if (socket) return;

  socket = io({
    auth: {
      verifyToken: currentToken
    }
  });

  const statusBadge = document.getElementById("bot-status-badge");

  socket.on("connect", () => {
    statusBadge.className = "status-badge live";
    statusBadge.innerHTML = '<span class="pulse-dot"></span> LIVE';
  });

  socket.on("disconnect", () => {
    statusBadge.className = "status-badge disconnected";
    statusBadge.innerHTML = '● DISCONNECTED';
  });

  socket.on("auth_error", (data) => {
    showToast(data.message || "Socket auth failed", "danger");
    handleLogout();
  });



  // Handle metric updates
  socket.on("uptime", (data) => {
    // If the system metrics tab is active, we can update metrics
    if (activeTab === "overview") {
      updateOverviewMetrics(data);
    }
  });
}

let localUptimeSeconds = 0;
let localUptimeInterval = null;

function startLocalUptimeTicker(initialSeconds) {
  localUptimeSeconds = initialSeconds;
  document.getElementById("val-uptime").innerText = formatUptime(localUptimeSeconds);

  if (localUptimeInterval) clearInterval(localUptimeInterval);
  localUptimeInterval = setInterval(() => {
    localUptimeSeconds++;
    document.getElementById("val-uptime").innerText = formatUptime(localUptimeSeconds);
  }, 1000);
}

// Metrics loader (overview)
async function fetchOverviewStats() {
  try {
    const stats = await apiRequest("/api/metrics");

    startLocalUptimeTicker(stats.uptime);
    document.getElementById("val-ram").innerText = `${formatSize(stats.memory.heapUsed)} / ${formatSize(stats.memory.heapTotal)}`;
    document.getElementById("val-cpu").innerText = `${stats.cpu}%`;
    document.getElementById("val-version").innerText = stats.version;
    document.getElementById("val-node").innerText = stats.nodeVersion;

    const storagePercent = ((stats.storage.total - stats.storage.free) / stats.storage.total * 100).toFixed(1);
    document.getElementById("val-storage").innerText = `${formatSize(stats.storage.total - stats.storage.free, 1)} / ${formatSize(stats.storage.total, 1)} (${storagePercent}%)`;

    document.getElementById("val-os").innerText = stats.os;
    document.getElementById("val-dependencies").innerText = stats.dependencies;
    document.getElementById("val-active-threads").innerText = stats.activeThreads;
    document.getElementById("val-total-users").innerText = stats.totalUsers;
    document.getElementById("val-members").innerText = stats.members;
    document.getElementById("val-commands").innerText = stats.commands;
  } catch (err) { }
}

function updateOverviewMetrics(data) {
  // Sync local counter with authoritative server uptime
  if (data.uptime !== undefined) {
    localUptimeSeconds = data.uptime;
    document.getElementById("val-uptime").innerText = formatUptime(localUptimeSeconds);
  }
  if (data.memory) {
    if (data.memory.heapUsed && data.memory.heapTotal) {
      document.getElementById("val-ram").innerText = `${formatSize(data.memory.heapUsed)} / ${formatSize(data.memory.heapTotal)}`;
    } else if (typeof data.memory === "number") {
      document.getElementById("val-ram").innerText = formatSize(data.memory);
    }
  }
  if (data.cpu !== undefined) {
    document.getElementById("val-cpu").innerText = `${data.cpu}%`;
  }
}

// Tab panes controller
function handleTabClick(event) {
  const btn = event.currentTarget;
  const targetTab = btn.getAttribute("data-tab");

  navTabs.forEach(t => t.classList.remove("active"));
  tabPanes.forEach(p => p.classList.remove("active"));

  btn.classList.add("active");
  document.getElementById(`tab-${targetTab}`).classList.add("active");

  activeTab = targetTab;
  loadActiveTab();
}

function loadActiveTab() {
  if (activeTab === "overview") {
    fetchOverviewStats();
  } else if (activeTab === "threads") {
    fetchThreadsList();
  } else if (activeTab === "users") {
    fetchUsersList();
  } else if (activeTab === "commands") {
    fetchCommandsList();
  } else if (activeTab === "config") {
    fetchConfig();
  }
}

// 1. Fetch group threads from API
let allThreads = [];
async function fetchThreadsList() {
  const tbody = document.querySelector("#threads-table tbody");
  tbody.innerHTML = '<tr><td colspan="5" class="text-center"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading group threads...</td></tr>';

  try {
    allThreads = await apiRequest("/api/threads");
    renderThreads(allThreads);
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Failed to load threads</td></tr>';
  }
}

function renderThreads(list) {
  const tbody = document.querySelector("#threads-table tbody");
  tbody.innerHTML = "";

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">No active group threads found in database.</td></tr>';
    return;
  }

  list.forEach(thread => {
    const tr = document.createElement("tr");
    const tid = thread.tid || "";
    const name = thread.name || "Unknown Group";
    const totalMembers = thread.totalMember || thread.allMembers?.length || 0;
    const approval = thread.approvalMode
      ? '<span class="badge badge-success">Enabled</span>'
      : '<span class="badge badge-secondary">Disabled</span>';
    const date = thread.createdAt ? new Date(thread.createdAt).toLocaleDateString() : "-";

    tr.innerHTML = `
      <td><code>${tid}</code></td>
      <td><strong>${name}</strong></td>
      <td>${totalMembers}</td>
      <td>${approval}</td>
      <td>${date}</td>
    `;
    tbody.appendChild(tr);
  });
}

// 2. Fetch users from API
let allUsers = [];
async function fetchUsersList() {
  const tbody = document.querySelector("#users-table tbody");
  tbody.innerHTML = '<tr><td colspan="6" class="text-center"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading users...</td></tr>';

  try {
    allUsers = await apiRequest("/api/users");
    renderUsers(allUsers);
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Failed to load users</td></tr>';
  }
}

function renderUsers(list) {
  const tbody = document.querySelector("#users-table tbody");
  tbody.innerHTML = "";

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">No users recorded in database.</td></tr>';
    return;
  }

  list.forEach(user => {
    const tr = document.createElement("tr");
    const uid = user.uid || "";
    const name = user.name || "Unknown User";
    const money = user.money || 0;
    const exp = user.exp || 0;
    const status = user.isBan
      ? `<span class="badge badge-danger" title="${user.banReason || 'Banned'}">Banned</span>`
      : '<span class="badge badge-success">Active</span>';

    const actionBtn = user.isBan
      ? `<button class="btn btn-sm btn-secondary" onclick="toggleUserBan('${uid}', false)">Unban</button>`
      : `<button class="btn btn-sm btn-outline-danger" onclick="toggleUserBan('${uid}', true)">Ban</button>`;

    tr.innerHTML = `
      <td><code>${uid}</code></td>
      <td><strong>${name}</strong></td>
      <td>${money}</td>
      <td>${exp}</td>
      <td>${status}</td>
      <td>${actionBtn}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function toggleUserBan(uid, isBan) {
  let reason = "";
  if (isBan) {
    reason = prompt("Enter ban reason:", "Violating bot rules");
    if (reason === null) return; // cancelled
  } else {
    if (!confirm("Are you sure you want to unban this user?")) return;
  }

  try {
    const res = await apiRequest("/api/users/ban", "POST", { uid, isBan, reason });
    showToast(res.message);
    fetchUsersList(); // reload table
  } catch (err) { }
}

// 3. Fetch bot commands list
let allCommands = [];
async function fetchCommandsList() {
  const container = document.getElementById("commands-grid-container");
  container.innerHTML = '<div class="text-center w-100 py-5"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading commands...</div>';

  try {
    allCommands = await apiRequest("/api/commands");
    renderCommands(allCommands);
  } catch (err) {
    container.innerHTML = '<div class="text-center w-100 py-5 text-danger">Failed to load commands</div>';
  }
}

function renderCommands(list) {
  const container = document.getElementById("commands-grid-container");
  container.innerHTML = "";

  if (list.length === 0) {
    container.innerHTML = '<div class="text-center w-100 py-5">No commands loaded.</div>';
    return;
  }

  list.forEach(cmd => {
    const card = document.createElement("div");
    card.className = "command-card";
    const name = cmd.name;
    const category = cmd.config.category || "General";
    const desc = cmd.config.shortDescription || cmd.config.longDescription || "No description provided.";
    const aliases = (cmd.config.aliases || []).join(", ") || "None";
    const role = cmd.config.role === 2 ? "Admin Only" : cmd.config.role === 1 ? "Moderator" : "User";

    card.innerHTML = `
      <div>
        <div class="command-card-header">
          <span class="cmd-name">${name}</span>
          <span class="cmd-cat">${category}</span>
        </div>
        <p class="cmd-desc">${desc}</p>
      </div>
      <div class="command-card-footer">
        <div><strong>Role:</strong> ${role}</div>
        <div style="margin-top: 4px; margin-bottom: 8px;"><strong>Aliases:</strong> <span class="cmd-alias">${aliases}</span></div>
        <button class="btn btn-sm btn-secondary btn-block" style="font-size: 0.8rem; height: 32px;" onclick="openEditorModal('${name}')"><i class="fa-solid fa-code"></i> Edit Script</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// Command Editor modal handlers
async function openEditorModal(cmdName) {
  initAceEditor();
  editingCmdName = cmdName;
  editorCmdName.innerText = cmdName;
  editorFileInfo.innerText = "Loading file path...";
  codeEditor.setValue("Loading code...", -1);
  editorModal.classList.remove("hidden");
  codeEditor.resize();

  try {
    const res = await apiRequest(`/api/commands/code?name=${encodeURIComponent(cmdName)}`);
    codeEditor.setValue(res.code, -1);
    codeEditor.session.getUndoManager().reset();
    editorFileInfo.innerText = `File: scripts/cmds/${res.filename}`;
  } catch (err) {
    codeEditor.setValue(`// Failed to load code: ${err.message}`, -1);
    editorFileInfo.innerText = "Error loading file";
  }
}

function closeEditorModal() {
  editorModal.classList.add("hidden");
}

async function submitCodeEdit() {
  const code = codeEditor.getValue();

  btnSaveEditor.disabled = true;
  btnSaveEditor.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';

  try {
    const res = await apiRequest("/api/commands/code", "POST", { name: editingCmdName, code });
    if (res.warning) {
      showToast(`Saved, but reload failed: ${res.warning}`, "warning");
    } else {
      showToast(res.message);
    }
    closeEditorModal();
    fetchCommandsList();
  } catch (err) {
    showToast(err.message || "Failed to save script", "danger");
  } finally {
    btnSaveEditor.disabled = false;
    btnSaveEditor.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save & Hot-Reload';
  }
}

// 4. Fetch and render config form
async function fetchConfig() {
  const form = document.getElementById("config-form");
  form.innerHTML = '<div class="text-center w-100 py-5"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading configuration...</div>';

  try {
    globalConfig = await apiRequest("/api/config");
    renderConfigForm(globalConfig);
  } catch (err) {
    form.innerHTML = '<div class="text-center w-100 py-5 text-danger">Failed to load configuration</div>';
  }
}

function renderConfigForm(cfg) {
  const form = document.getElementById("config-form");
  form.innerHTML = "";

  // Section: Core Settings
  addSectionHeader(form, "Bot Profile Settings");
  addInputField(form, "botName", "Bot Name", cfg.botName || "", "Name shown for your bot inside logs and status cards");
  addInputField(form, "prefix", "Command Prefix", cfg.prefix || "!", "Default prefix for launching commands");
  addInputField(form, "phoneNumber", "Bot Phone Number", cfg.phoneNumber || "", "Country code + digits connected to the bot");

  addSelectField(form, "loginMode", "Login Method", cfg.loginMode || "qr", [
    { value: "qr", label: "QR Code scanner" }
  ], "Method used when creating a new session from scratch");

  // Section: Admin & Security
  addSectionHeader(form, "Access Controls & System Config");
  addInputField(form, "express.port", "Web Server Port", cfg.express?.port || 3000, "Port running this dashboard page (Requires restart if changed)");
  addInputField(form, "express.secretToken", "Admin Access Key", cfg.express?.secretToken || "Romeo", "Secret token used to unlock this dashboard screen");

  addInputField(form, "adminBot", "Admins UIDs (Comma separated)", (cfg.adminBot || []).join(", "), "Target numbers with absolute owner control");

  // Section: Database config
  addSectionHeader(form, "Database & Storage");
  addSelectField(form, "database.type", "Database Type", cfg.database?.type || "json", [
    { value: "json", label: "JSON Local Files" },
    { value: "mongodb", label: "MongoDB Remote Instance" }
  ], "Where logs, commands and statistics persist");
  addInputField(form, "database.uriMongodb", "MongoDB Connection URI", cfg.database?.uriMongodb || "", "Leave empty if Database Type is set to JSON");

  // Section: Auto Uptime config
  addSectionHeader(form, "Auto Uptime Ping");
  addSelectField(form, "autoUptime.enable", "Uptime Service Status", cfg.autoUptime?.enable === true ? "true" : "false", [
    { value: "true", label: "Enabled" },
    { value: "false", label: "Disabled" }
  ], "Keeps bot host server active via ping loops");
  addInputField(form, "autoUptime.url", "Auto Uptime Target URL", cfg.autoUptime?.url || "", "Endpoint target containing /uptime ping");
  addInputField(form, "autoUptime.timeInterval", "Interval Time (Seconds)", cfg.autoUptime?.timeInterval || 180, "Amount of time delay in-between checks");

  // Section: Listen Settings
  addSectionHeader(form, "WhatsApp Event Listener Options");
  addSelectField(form, "listen.selfListen", "Listen to Self Messages", cfg.listen?.selfListen === true ? "true" : "false", [
    { value: "true", label: "Enabled (Triggers on own messages)" },
    { value: "false", label: "Disabled (Recommended)" }
  ], "Determines whether the bot processes messages sent by its own number");
  addSelectField(form, "listen.listenEvents", "Listen to System Events", cfg.listen?.listenEvents === true ? "true" : "false", [
    { value: "true", label: "Enabled" },
    { value: "false", label: "Disabled" }
  ], "Triggers handlers on user joins, group name changes, kicks, etc.");
  addSelectField(form, "listen.autoMarkDelivery", "Auto Mark Read", cfg.listen?.autoMarkDelivery === true ? "true" : "false", [
    { value: "true", label: "Enabled (Read receipt sent immediately)" },
    { value: "false", label: "Disabled" }
  ], "Automatically sends double blue-ticks to incoming messages");
  addSelectField(form, "listen.autoReconnect", "Auto Reconnect", cfg.listen?.autoReconnect === true ? "true" : "false", [
    { value: "true", label: "Enabled" },
    { value: "false", label: "Disabled" }
  ], "Attempts connection restore if socket disconnects");
  addSelectField(form, "listen.listenRawMsg", "Listen Raw Message", cfg.listen?.listenRawMsg === true ? "true" : "false", [
    { value: "true", label: "Enabled" },
    { value: "false", label: "Disabled" }
  ], "Sends all incoming messages directly to standard event handler queues");

  // Section: Feature Box Settings
  addSectionHeader(form, "Feature Box (Access & Moderation)");
  addSelectField(form, "featureBox.whitelistMode", "User Whitelist Mode", cfg.featureBox?.whitelistMode === true ? "true" : "false", [
    { value: "true", label: "Enabled" },
    { value: "false", label: "Disabled" }
  ], "Restricts bot usage strictly to user IDs in the list");
  addInputField(form, "featureBox.whitelistUIDs", "Whitelisted User UIDs (Comma separated)", (cfg.featureBox?.whitelistUIDs || []).join(", "), "IDs permitted to trigger bot scripts when Whitelist Mode is active");

  addSelectField(form, "featureBox.whitelistThreadMode", "Group Whitelist Mode", cfg.featureBox?.whitelistThreadMode === true ? "true" : "false", [
    { value: "true", label: "Enabled" },
    { value: "false", label: "Disabled" }
  ], "Restricts bot usage strictly to selected group chats");
  addInputField(form, "featureBox.whitelistThreadIDs", "Whitelisted Thread IDs (Comma separated)", (cfg.featureBox?.whitelistThreadIDs || []).join(", "), "Thread IDs permitted to trigger bot scripts when Thread Whitelist is active");

  addSelectField(form, "featureBox.adminOnly", "Admin Only Mode", cfg.featureBox?.adminOnly === true ? "true" : "false", [
    { value: "true", label: "Enabled" },
    { value: "false", label: "Disabled" }
  ], "Restricts bot commands to numbers registered as administrators");
  addSelectField(form, "featureBox.antiInbox", "Block Inbox Commands", cfg.featureBox?.antiInbox === true ? "true" : "false", [
    { value: "true", label: "Enabled (Groups only)" },
    { value: "false", label: "Disabled" }
  ], "If enabled, bot will refuse commands in private chats (DMs)");
  addSelectField(form, "featureBox.unsendBotReact", "Unsend Command Reaction", cfg.featureBox?.unsendBotReact === true ? "true" : "false", [
    { value: "true", label: "Enabled" },
    { value: "false", label: "Disabled" }
  ], "If user unsends their message, the bot can react with an emoji");
  addInputField(form, "featureBox.unsendBotReactEmoji", "Unsend Reaction Emoji", cfg.featureBox?.unsendBotReactEmoji || "👍", "Emoji used when reacting to unsent messages");

  // Section: Auto Load Settings
  addSectionHeader(form, "Script Auto Loading");
  addSelectField(form, "autoLoadScripts.enable", "Auto Reload Scripts", cfg.autoLoadScripts?.enable === true ? "true" : "false", [
    { value: "true", label: "Enabled (Listens to scripts folder)" },
    { value: "false", label: "Disabled" }
  ], "Automatically unloads/reloads modified JS files under scripts/cmds without bot restart");

  // Action footer
  const footer = document.createElement("div");
  footer.className = "config-actions";
  footer.innerHTML = `
    <button type="submit" class="btn btn-success"><i class="fa-solid fa-save"></i> Save Configuration</button>
  `;
  form.appendChild(footer);

  form.onsubmit = saveConfigForm;
}

function addSectionHeader(form, text) {
  const div = document.createElement("div");
  div.className = "form-section";
  div.innerText = text;
  form.appendChild(div);
}

function addInputField(form, keyPath, labelText, value, helpText) {
  const div = document.createElement("div");
  div.className = "form-group";
  div.innerHTML = `
    <label for="cfg-${keyPath}">${labelText}</label>
    <input type="text" id="cfg-${keyPath}" data-key="${keyPath}" value="${value}">
    <span class="field-help">${helpText}</span>
  `;
  form.appendChild(div);
}

function addSelectField(form, keyPath, labelText, selectedValue, options, helpText) {
  const div = document.createElement("div");
  div.className = "form-group";

  let optionsHtml = "";
  options.forEach(opt => {
    const isSelected = String(opt.value) === String(selectedValue) ? "selected" : "";
    optionsHtml += `<option value="${opt.value}" ${isSelected}>${opt.label}</option>`;
  });

  div.innerHTML = `
    <label for="cfg-${keyPath}">${labelText}</label>
    <select id="cfg-${keyPath}" data-key="${keyPath}">
      ${optionsHtml}
    </select>
    <span class="field-help">${helpText}</span>
  `;
  form.appendChild(div);
}

// Submit configuration form
async function saveConfigForm(event) {
  event.preventDefault();

  const inputs = document.querySelectorAll("#config-form [data-key]");
  const updatedCfg = JSON.parse(JSON.stringify(globalConfig));

  inputs.forEach(input => {
    const path = input.getAttribute("data-key");
    const val = input.value;

    // Resolve type conversion
    let typedVal = val;
    if (val === "true") typedVal = true;
    else if (val === "false") typedVal = false;
    else if (path === "express.port" || path === "autoUptime.timeInterval") {
      typedVal = Number(val);
    }

    const parts = path.split(".");
    let target = updatedCfg;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        if (part === "adminBot" || part === "whitelistUIDs" || part === "whitelistThreadIDs") {
          // parse comma string back into array
          target[part] = val.split(",").map(item => item.trim()).filter(Boolean);
        } else {
          target[part] = typedVal;
        }
      } else {
        if (!target[part]) target[part] = {};
        target = target[part];
      }
    }
  });

  try {
    const res = await apiRequest("/api/config", "POST", { config: updatedCfg });
    showToast(res.message);
    globalConfig = updatedCfg;
  } catch (err) { }
}

// Bot Control Actions
async function handleRestartBot() {
  if (!confirm("Are you sure you want to restart the WhatsApp Bot?")) return;

  try {
    showToast("Triggering bot restart...", "warning");
    const res = await apiRequest("/api/restart", "POST");
    showToast(res.message);

    // Show reconnecting loader overlay
    setTimeout(() => {
      handleLogout();
    }, 1500);
  } catch (err) { }
}

async function handleTerminateProcess() {
  if (!confirm("CRITICAL: This will terminate the Node.js process. If you don't run this using pm2 or automated wrappers, the bot will stay offline. Proceed?")) return;

  try {
    showToast("Terminating bot process...", "danger");
    await apiRequest("/api/restart", "POST");
  } catch (err) { }
}

async function handleFlushCache() {
  if (!confirm("Flush cache folder? This will delete temporary media files, but keeps logins.")) return;
  showToast("Flush cache command completed successfully.");
}

// Session Inject Modal Handlers
function openSessionModal() {
  sessionModal.classList.remove("hidden");
  sessionIdTextarea.value = "";
  sessionIdTextarea.focus();
}

function closeSessionModal() {
  sessionModal.classList.add("hidden");
}

async function submitSessionInjection() {
  const sessionID = sessionIdTextarea.value.trim();
  if (!sessionID) {
    showToast("Please enter a Session ID.", "warning");
    return;
  }

  if (!confirm("This will overwrite existing WhatsApp account auth folders and restart the bot. Proceed?")) return;

  btnSubmitSession.disabled = true;
  btnSubmitSession.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Injecting...';

  try {
    const res = await apiRequest("/api/session", "POST", { sessionID });
    showToast(res.message);
    closeSessionModal();

    // Boot out after restart
    setTimeout(() => {
      handleLogout();
    }, 2000);
  } catch (err) {
  } finally {
    btnSubmitSession.disabled = false;
    btnSubmitSession.innerHTML = '<i class="fa-solid fa-upload"></i> Inject & Restart';
  }
}

// Global Search Filters
function setupSearchFilters() {
  // 1. Threads search
  document.getElementById("threads-search").addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allThreads.filter(t =>
      (t.tid && t.tid.toLowerCase().includes(term)) ||
      (t.name && t.name.toLowerCase().includes(term))
    );
    renderThreads(filtered);
  });

  // 2. Users search
  document.getElementById("users-search").addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allUsers.filter(u =>
      (u.uid && u.uid.toLowerCase().includes(term)) ||
      (u.name && u.name.toLowerCase().includes(term))
    );
    renderUsers(filtered);
  });

  // 3. Commands search
  document.getElementById("commands-search").addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allCommands.filter(c =>
      (c.name && c.name.toLowerCase().includes(term)) ||
      (c.config.category && c.config.category.toLowerCase().includes(term)) ||
      (c.config.shortDescription && c.config.shortDescription.toLowerCase().includes(term)) ||
      (c.config.longDescription && c.config.longDescription.toLowerCase().includes(term))
    );
    renderCommands(filtered);
  });


}

// Event Listeners setup
function setupEventListeners() {
  loginSubmitBtn.addEventListener("click", handleLoginSubmit);
  adminKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleLoginSubmit();
  });

  btnLogout.addEventListener("click", handleLogout);

  navTabs.forEach(tab => {
    tab.addEventListener("click", handleTabClick);
  });

  btnRestartBot.addEventListener("click", handleRestartBot);
  btnTerminate.addEventListener("click", handleTerminateProcess);
  btnFlush.addEventListener("click", handleFlushCache);

  // Session Modal
  btnSessionModal.addEventListener("click", openSessionModal);
  btnCloseSessionModal.addEventListener("click", closeSessionModal);
  btnCancelSession.addEventListener("click", closeSessionModal);
  btnSubmitSession.addEventListener("click", submitSessionInjection);



  // Editor Modal listeners
  btnCloseEditorModal.addEventListener("click", closeEditorModal);
  btnCancelEditor.addEventListener("click", closeEditorModal);
  btnSaveEditor.addEventListener("click", submitCodeEdit);

  // Handle outside click modal close
  window.addEventListener("click", (e) => {
    if (e.target === sessionModal) {
      closeSessionModal();
    }
    if (e.target === editorModal) {
      closeEditorModal();
    }
  });
}

// Init Dashboard
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  setupSearchFilters();

  // Check if session token exists
  if (currentToken) {
    loginContainer.classList.add("hidden");
    dashboardContainer.classList.remove("hidden");
    initSocket();
    loadActiveTab();
  } else {
    loginContainer.classList.remove("hidden");
    dashboardContainer.classList.add("hidden");
  }
});

// Helper exposes toggleUserBan to HTML table scope
window.toggleUserBan = toggleUserBan;
window.openEditorModal = openEditorModal;
