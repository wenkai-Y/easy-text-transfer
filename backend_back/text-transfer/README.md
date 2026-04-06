# text-transfer backend

## 运行

```bash
go mod tidy
go run ./cmd/server
```

## 生成口令 hash

```bash
echo -n "你的口令" | sha256sum
```

把结果填到 `conf/config.yaml` 的 `auth.password_hash`。

## 接口

- `POST /api/access`
- `POST /api/room/create`
- `POST /api/room/join`
- `POST /api/room/destroy`
- `GET /api/room/status?room_id=xxxx`
- `GET /ws?room_id=xxxx&role=creator|joiner`
