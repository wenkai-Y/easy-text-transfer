const API_BASE = "";
let ws = null;
let reconnectTimer = null;
let countdownTimer = null;

const state = {
  roomId: localStorage.getItem("tt_room_id") || "",
  role: localStorage.getItem("tt_role") || "",
  expiresAt: Number(localStorage.getItem("tt_expires_at") || 0),
  connected: false,
  displayStatus: "未连接",
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
const joinRoomInput = document.getElementById("join-room-input");
const joinRoomBtn = document.getElementById("join-room-btn");
const destroyRoomBtn = document.getElementById("destroy-room-btn");

const chatList = document.getElementById("chat-list");
const chatInput = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");

function setSystemMessage(msg) {
  systemMsgEl.textContent = msg || "";
}

function setDisplayStatus(status) {
  state.displayStatus = status || "未连接";
  updateTopInfo();
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
  saveState();
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
    tryRestoreRoom();
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
    startCountdown();
    setSystemMessage(`房间 ${data.room_id} 已创建，等待对方加入`);
    appendMessage("system", `房间 ${data.room_id} 已创建`);
    connectWS();
  } catch (err) {
    setSystemMessage(err.message);
  }
}

async function joinRoom() {
  const roomId = joinRoomInput.value.trim();
  if (!/^\d{4}$/.test(roomId)) {
    setSystemMessage("请输入4位数字房间号");
    return;
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
    setDisplayStatus("已配对");
    startCountdown();
    setSystemMessage(`已加入房间 ${data.room_id}`);
    appendMessage("system", `已加入房间 ${data.room_id}`);
    connectWS();
  } catch (err) {
    setSystemMessage(err.message);
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
    if (state.roomId) {
      setDisplayStatus(state.displayStatus === "未连接" ? "等待对方加入" : state.displayStatus);
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
          } else if (data.status === "active") {
            setDisplayStatus("已配对");
          }
          appendMessage("system", `连接成功，房间 ${data.room_id}`);
          break;
        case "room_activated":
          state.expiresAt = data.expires_at || state.expiresAt;
          saveState();
          startCountdown();
          setDisplayStatus("已配对");
          appendMessage("system", "房间已配对成功，倒计时已更新为10分钟");
          setSystemMessage("房间已配对成功");
          break;
        case "peer_online":
          setDisplayStatus("已配对");
          appendMessage("system", "对方已上线");
          setSystemMessage("对方已上线");
          break;
        case "peer_offline":
          setDisplayStatus("对方离线");
          appendMessage("system", "对方已离线，可等待重连");
          setSystemMessage("对方已离线，可等待重连");
          break;
        case "room_destroyed":
          appendMessage("system", data.message || "房间已销毁");
          setSystemMessage(data.message || "房间已销毁");
          clearRoomState();
          updateTopInfo();
          startCountdown();
          break;
        case "send_failed":
          appendMessage("system", `发送失败：${data.message || "未知错误"}`);
          setSystemMessage(data.message || "发送失败");
          break;
        case "bind_failed":
          appendMessage("system", `连接失败：${data.message || "未知错误"}`);
          setSystemMessage(data.message || "连接失败");
          setDisplayStatus("连接失败");
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
    }
  };
}

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) {
    setSystemMessage("请输入消息");
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
    } else if (data.status === "active") {
      if (data.creator?.online && data.joiner?.online) {
        setDisplayStatus("已配对");
      } else {
        setDisplayStatus("对方离线");
      }
    } else if (data.status === "destroyed") {
      setDisplayStatus("已销毁");
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
joinRoomBtn.addEventListener("click", joinRoom);
destroyRoomBtn.addEventListener("click", destroyRoom);
sendBtn.addEventListener("click", sendMessage);

passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") access();
});

passwordInput.addEventListener("input", () => {
  passwordInput.value = passwordInput.value.replace(/\D/g, "");
});

joinRoomInput.addEventListener("input", () => {
  joinRoomInput.value = joinRoomInput.value.replace(/\D/g, "").slice(0, 4);
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

updateTopInfo();
startCountdown();
