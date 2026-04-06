const API_BASE = "";
let ws = null;
let reconnectTimer = null;
let countdownTimer = null;
let roomListTimer = null;

const state = {
  roomId: localStorage.getItem("tt_room_id") || "",
  role: localStorage.getItem("tt_role") || "",
  expiresAt: Number(localStorage.getItem("tt_expires_at") || 0),
  connected: false,
  displayStatus: "未连接",
  peerOnline: false,
};

const accessSection = document.getElementById("access-section");
const mainSection = document.getElementById("main-section");

const passwordInput = document.getElementById("password-input");
const accessBtn = document.getElementById("access-btn");
const accessMsg = document.getElementById("access-msg");

const roomIdEl = document.getElementById("room-id");
const roomStatusEl = document.getElementById("room-status");
const countdownEl = document.getElementById("countdown");
const systemMsgEl = document.getElementById("system-msg");

const createRoomBtn = document.getElementById("create-room-btn");
const joinRoomSelect = document.getElementById("join-room-select");
const refreshRoomListBtn = document.getElementById("refresh-room-list-btn");
const joinRoomBtn = document.getElementById("join-room-btn");
const destroyRoomBtn = document.getElementById("destroy-room-btn");

const chatList = document.getElementById("chat-list");
const chatInput = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");

const qrModal = document.getElementById("qr-modal");
const closeQrBtn = document.getElementById("close-qr-btn");
const qrCanvas = document.getElementById("qr-canvas");
const qrLinkInput = document.getElementById("qr-link-input");
const copyQrLinkBtn = document.getElementById("copy-qr-link-btn");

function setSystemMessage(msg) {
  systemMsgEl.textContent = msg || "";
}

function setDisplayStatus(status) {
  state.displayStatus = status || "未连接";
  updateTopInfo();
}

function setPeerOnline(online) {
  state.peerOnline = !!online;
  sendBtn.disabled = !state.peerOnline;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatRemain(seconds) {
  if (seconds <= 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function saveState() {
  localStorage.setItem("tt_room_id", state.roomId || "");
  localStorage.setItem("tt_role", state.role || "");
  localStorage.setItem("tt_expires_at", String(state.expiresAt || 0));
}

function clearRoomState() {
  state.roomId = "";
  state.role = "";
  state.expiresAt = 0;
  state.connected = false;
  state.displayStatus = "未连接";
  state.peerOnline = false;
  saveState();
  setPeerOnline(false);
  if (ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
  }
}

function updateTopInfo() {
  roomIdEl.textContent = state.roomId || "未加入";
  roomStatusEl.textContent = state.displayStatus || "未连接";
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);

  function tick() {
    if (!state.expiresAt) {
      countdownEl.textContent = "--:--";
      return;
    }
    const remain = Math.max(0, state.expiresAt - Math.floor(Date.now() / 1000));
    countdownEl.textContent = formatRemain(remain);
    if (remain <= 0) {
      setSystemMessage("房间已到期");
      setDisplayStatus("已到期");
      setPeerOnline(false);
    }
  }

  tick();
  countdownTimer = setInterval(tick, 1000);
}

function appendMessage(type, text, from = "") {
  const item = document.createElement("div");
  item.className = `chat-item ${type}`;

  const meta = document.createElement("div");
  meta.className = "meta";

  const now = new Date();
  const timeStr = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  meta.textContent = from ? `${from} · ${timeStr}` : timeStr;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  item.appendChild(meta);
  item.appendChild(bubble);
  chatList.appendChild(item);
  chatList.scrollTop = chatList.scrollHeight;
}

async function request(url, options = {}) {
  const res = await fetch(API_BASE + url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.code !== 0) {
    throw new Error(data.message || "请求失败");
  }
  return data.data;
}

function buildRoomEnterUrl(roomId) {
  const url = new URL(window.location.origin + "/");
  url.searchParams.set("room_id", roomId);
  url.searchParams.set("auto_join", "1");
  return url.toString();
}

async function openQrModal(roomId) {
  const link = buildRoomEnterUrl(roomId);
  qrLinkInput.value = link;
  qrModal.classList.remove("hidden");

  if (window.QRCode && qrCanvas) {
    try {
      await QRCode.toCanvas(qrCanvas, link, {
        width: 220,
        margin: 1,
      });
    } catch (err) {
      console.error(err);
    }
  }
}

function closeQrModal() {
  qrModal.classList.add("hidden");
}

async function copyQrLink() {
  try {
    await navigator.clipboard.writeText(qrLinkInput.value);
    setSystemMessage("房间链接已复制");
  } catch (_) {
    qrLinkInput.select();
    document.execCommand("copy");
    setSystemMessage("房间链接已复制");
  }
}

async function access() {
  const password = passwordInput.value.trim();
  if (!password) {
    accessMsg.textContent = "请输入口令";
    return;
  }

  accessBtn.disabled = true;
  accessMsg.textContent = "验证中...";
  try {
    await request("/api/access", {
      method: "POST",
      body: JSON.stringify({ password })
    });
    accessMsg.textContent = "验证成功";
    accessSection.classList.add("hidden");
    mainSection.classList.remove("hidden");
    updateTopInfo();
    await loadJoinableRooms();
    await tryRestoreRoom();
    await tryAutoJoinFromURL();
    startRoomListPolling();
  } catch (err) {
    accessMsg.textContent = err.message;
  } finally {
    accessBtn.disabled = false;
  }
}

async function createRoom() {
  try {
    const data = await request("/api/room/create", {
      method: "POST"
    });
    state.roomId = data.room_id;
    state.role = data.role;
    state.expiresAt = data.expires_at;
    saveState();
    setDisplayStatus("等待对方加入");
    setPeerOnline(false);
    startCountdown();
    setSystemMessage(`房间 ${data.room_id} 已创建，等待对方加入`);
    appendMessage("system", `房间 ${data.room_id} 已创建`);
    connectWS();
    await loadJoinableRooms();
    await openQrModal(data.room_id);
  } catch (err) {
    setSystemMessage(err.message);
  }
}

async function loadJoinableRooms(selectedRoomId = "") {
  try {
    const data = await request("/api/room/list", {
      method: "GET"
    });

    const rooms = Array.isArray(data.rooms) ? data.rooms : [];
    const previousValue = selectedRoomId || joinRoomSelect.value;

    joinRoomSelect.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = rooms.length > 0 ? "请选择可进入房间" : "当前暂无可进入房间";
    joinRoomSelect.appendChild(placeholder);

    rooms.forEach((room) => {
      const option = document.createElement("option");
      option.value = room.room_id;
      option.textContent = `${room.room_id}（剩余 ${room.remaining_seconds}s）`;
      joinRoomSelect.appendChild(option);
    });

    if (previousValue && rooms.some((r) => r.room_id === previousValue)) {
      joinRoomSelect.value = previousValue;
    } else {
      joinRoomSelect.value = "";
    }
  } catch (err) {
    setSystemMessage(err.message);
  }
}

function startRoomListPolling() {
  if (roomListTimer) clearInterval(roomListTimer);
  roomListTimer = setInterval(() => {
    if (!document.hidden) {
      loadJoinableRooms();
    }
  }, 5000);
}

async function joinSelectedRoom(roomIdFromParam = "") {
  const roomId = roomIdFromParam || joinRoomSelect.value;
  if (!/^\d{4}$/.test(roomId)) {
    setSystemMessage("请选择一个可进入房间");
    return false;
  }

  try {
    const data = await request("/api/room/join", {
      method: "POST",
      body: JSON.stringify({ room_id: roomId })
    });
    state.roomId = data.room_id;
    state.role = data.role;
    state.expiresAt = data.expires_at;
    saveState();
    setDisplayStatus("已配对，等待对方上线");
    setPeerOnline(false);
    startCountdown();
    setSystemMessage(`已加入房间 ${data.room_id}`);
    appendMessage("system", `已加入房间 ${data.room_id}`);
    connectWS();
    await loadJoinableRooms();
    return true;
  } catch (err) {
    setSystemMessage(err.message);
    return false;
  }
}

async function tryAutoJoinFromURL() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room_id");
  const autoJoin = params.get("auto_join");

  if (!roomId || autoJoin !== "1") {
    return;
  }

  if (state.roomId) {
    return;
  }

  await loadJoinableRooms(roomId);
  const success = await joinSelectedRoom(roomId);
  if (success) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

async function destroyRoom() {
  if (!state.roomId) {
    setSystemMessage("当前没有可销毁的房间");
    return;
  }

  try {
    await request("/api/room/destroy", {
      method: "POST",
      body: JSON.stringify({ room_id: state.roomId })
    });
    appendMessage("system", "房间已手动销毁");
    setSystemMessage("房间已销毁");
    clearRoomState();
    updateTopInfo();
    startCountdown();
    await loadJoinableRooms();
  } catch (err) {
    setSystemMessage(err.message);
  }
}

function wsURL() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws?room_id=${encodeURIComponent(state.roomId)}&role=${encodeURIComponent(state.role)}`;
}

function connectWS() {
  if (!state.roomId || !state.role) return;

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  ws = new WebSocket(wsURL());

  ws.onopen = () => {
    state.connected = true;
    if (state.roomId && state.displayStatus === "未连接") {
      setDisplayStatus("等待对方加入");
    }
    setSystemMessage("WebSocket 已连接");
  };

  ws.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === "chat") {
      const type = data.from === state.role ? "self" : "peer";
      const from = data.from === state.role ? "我" : "对方";
      appendMessage(type, data.content, from);
      return;
    }

    if (data.type === "system") {
      if (data.expires_at) {
        state.expiresAt = data.expires_at;
        saveState();
        startCountdown();
      }

      switch (data.event) {
        case "connected":
          state.expiresAt = data.expires_at || state.expiresAt;
          saveState();
          startCountdown();
          if (!state.roomId && data.room_id) {
            state.roomId = data.room_id;
          }
          if (data.status === "waiting") {
            setDisplayStatus("等待对方加入");
            setPeerOnline(false);
          } else if (data.status === "active") {
            setDisplayStatus("已配对，等待对方上线");
          }
          appendMessage("system", `连接成功，房间 ${data.room_id}`);
          break;
        case "room_activated":
          state.expiresAt = data.expires_at || state.expiresAt;
          saveState();
          startCountdown();
          setDisplayStatus("已配对，等待对方上线");
          appendMessage("system", "房间已配对成功，倒计时已更新为10分钟");
          setSystemMessage("房间已配对成功");
          loadJoinableRooms();
          break;
        case "peer_online":
          setDisplayStatus("对方在线");
          setPeerOnline(true);
          appendMessage("system", "对方已上线");
          setSystemMessage("对方已上线");
          break;
        case "peer_offline":
          setDisplayStatus("对方离线");
          setPeerOnline(false);
          appendMessage("system", "对方已离线，可等待重连");
          setSystemMessage("对方已离线，可等待重连");
          break;
        case "room_destroyed":
          appendMessage("system", data.message || "房间已销毁");
          setSystemMessage(data.message || "房间已销毁");
          clearRoomState();
          updateTopInfo();
          startCountdown();
          loadJoinableRooms();
          break;
        case "send_failed":
          appendMessage("system", `发送失败：${data.message || "未知错误"}`);
          setSystemMessage(data.message || "发送失败");
          break;
        case "bind_failed":
          appendMessage("system", `连接失败：${data.message || "未知错误"}`);
          setSystemMessage(data.message || "连接失败");
          setDisplayStatus("连接失败");
          setPeerOnline(false);
          break;
        default:
          if (data.message) {
            appendMessage("system", data.message);
          }
      }
    }
  };

  ws.onclose = () => {
    state.connected = false;

    if (state.roomId && state.role) {
      setDisplayStatus("连接中断");
      setPeerOnline(false);
      setSystemMessage("连接已断开，正在尝试重连...");
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        connectWS();
      }, 2000);
    } else {
      setDisplayStatus("未连接");
    }
  };

  ws.onerror = () => {
    setSystemMessage("连接异常");
    if (state.roomId) {
      setDisplayStatus("连接异常");
      setPeerOnline(false);
    }
  };
}

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) {
    setSystemMessage("请输入消息");
    return;
  }
  if (!state.peerOnline) {
    setSystemMessage("对方当前未在线");
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setSystemMessage("当前未连接");
    return;
  }

  ws.send(JSON.stringify({
    type: "chat",
    content: text
  }));

  appendMessage("self", text, "我");
  chatInput.value = "";
}

async function tryRestoreRoom() {
  if (!state.roomId) {
    startCountdown();
    return;
  }

  try {
    const data = await request(`/api/room/status?room_id=${encodeURIComponent(state.roomId)}`, {
      method: "GET"
    });
    state.expiresAt = data.expires_at || 0;
    saveState();

    if (data.status === "waiting") {
      setDisplayStatus("等待对方加入");
      setPeerOnline(false);
    } else if (data.status === "active") {
      if (data.creator?.online && data.joiner?.online) {
        setDisplayStatus("对方在线");
        setPeerOnline(true);
      } else {
        setDisplayStatus("已配对，等待对方上线");
        setPeerOnline(false);
      }
    } else if (data.status === "destroyed") {
      setDisplayStatus("已销毁");
      setPeerOnline(false);
    }

    startCountdown();
    setSystemMessage(`已恢复房间 ${state.roomId}`);
    connectWS();
  } catch {
    clearRoomState();
    updateTopInfo();
    startCountdown();
  }
}

accessBtn.addEventListener("click", access);
createRoomBtn.addEventListener("click", createRoom);
refreshRoomListBtn.addEventListener("click", () => loadJoinableRooms());
joinRoomBtn.addEventListener("click", () => joinSelectedRoom());
destroyRoomBtn.addEventListener("click", destroyRoom);
sendBtn.addEventListener("click", sendMessage);

closeQrBtn.addEventListener("click", closeQrModal);
copyQrLinkBtn.addEventListener("click", copyQrLink);
qrModal.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-mask")) {
    closeQrModal();
  }
});

passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") access();
});

passwordInput.addEventListener("input", () => {
  passwordInput.value = passwordInput.value.replace(/\D/g, "");
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

setPeerOnline(false);
updateTopInfo();
startCountdown();
