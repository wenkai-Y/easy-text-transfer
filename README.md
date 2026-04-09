# Easy Text Transfer（文字 / 图片 / 视频互传）

一个极简的双端互传项目：
- 一端创建房间
- 另一端加入房间
- 双方通过 WebSocket 实时互发文本、图片和视频
- 房间有等待/激活超时机制

---

## 功能概览

- 口令访问控制（Cookie 会话）
- 创建房间、加入房间、销毁房间
- 可加入房间列表（展示剩余秒数）
- 房间状态查询（在线状态、剩余时间）
- WebSocket 实时消息收发（文本/图片/视频）
- 支持粘贴图片发送（支持时也可粘贴视频）
- 图片/视频消息可点击单独预览
- 视频消息默认展示封面，点击后在预览层播放
- 预览层支持上一条/下一条切换（移动端支持左右滑动）
- 媒体加载完成后自动滚动到最新消息
- 对方上下线提示
- 房间二维码分享（前端）

---

## 项目结构

```text
.
├── backend/text-transfer/        # Go 后端（Gin + WebSocket）
│   ├── cmd/server/               # 服务入口
│   ├── conf/config.yaml          # 配置文件
│   └── internal/                 # 业务代码
├── frontend/                     # 前端静态页面（HTML/CSS/JS）
├── nginx/                        # Nginx 配置与证书目录
├── docker-compose.yml            # Nginx 容器编排（生产/部署参考）
├── backend_back/                 # 备份目录
└── frontend_back/                # 备份目录
```

---

## 本地开发（推荐）

### 1）启动后端

```bash
cd backend/text-transfer
go mod tidy
go run ./cmd/server
```

默认监听 `:8080`（以 `conf/config.yaml` 为准）。

### 2）启动前端静态服务

在仓库根目录执行（任选一种）：

```bash
# 方式 A：Python
cd frontend
python3 -m http.server 5173

# 方式 B：Node（如果你装了 serve）
# npx serve frontend -l 5173
```

然后访问：

- `http://localhost:5173`

> 前端默认通过同域名请求 `/api` 与 `/ws`。本地联调时建议通过 Nginx 反代，或把前端和后端放在同一域下。

---

## 配置说明

配置文件：`backend/text-transfer/conf/config.yaml`

```yaml
server:
  port: 8080
  mode: debug

auth:
  password_hash: "<sha256-hex>"
  cookie_name: "tt_access"
  cookie_secret: "<random-secret>"
  cookie_max_age: 86400

room:
  wait_timeout_seconds: 300
  active_timeout_seconds: 600
  message_max_length: 1000
  media_max_bytes: 8388608
```

### 生成口令哈希

```bash
echo -n "你的口令" | sha256sum
```

将输出填入 `auth.password_hash`。

---

## 接口一览

### 访问鉴权

- `POST /api/access`
  - body: `{ "password": "123456" }`
  - 成功后写入访问 Cookie

### 房间接口（需要已鉴权）

- `POST /api/room/create`
- `GET /api/room/list`
- `POST /api/room/join`
  - body: `{ "room_id": "1234" }`
- `POST /api/room/destroy`
  - body: `{ "room_id": "1234" }`
- `GET /api/room/status?room_id=1234`

### WebSocket（需要已鉴权）

- `GET /ws?room_id=1234&role=creator|joiner`

客户端发送：

```json
{ "type": "chat", "content": "hello" }
```

客户端发送媒体：

```json
{
  "type": "media",
  "media_kind": "image",
  "file_name": "demo.png",
  "mime_type": "image/png",
  "size_bytes": 12345,
  "data_url": "data:image/png;base64,..."
}
```

服务端系统事件示例：

- `connected`
- `room_activated`
- `peer_online`
- `peer_offline`
- `room_destroyed`
- `send_failed`
- `bind_failed`

---

## Docker / Nginx 说明

仓库中提供了 `docker-compose.yml` 与 `nginx/` 目录作为部署参考。

注意：`docker-compose.yml` 里当前挂载的是**绝对路径**（如 `/home/ywk/code/text-transfer/...`），你需要按自己的机器路径修改后再启动。

---

## 常见问题

### 1）“RoomService has no field or method ListJoinableRooms”

这是后端未实现房间列表方法导致的编译错误。当前代码已包含该方法。

### 2）状态显示与在线状态不一致

前端已处理 `peer_online` 与 `connected` 事件顺序可能导致的状态覆盖问题，避免错误地一直显示“等待对方上线”。

---

## License

如需开源发布，请自行补充许可证（例如 MIT）。
