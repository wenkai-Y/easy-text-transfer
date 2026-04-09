package handler

import (
	"log"
	"net/http"
	"regexp"

	"text-transfer/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var roleRegexp = regexp.MustCompile(`^(creator|joiner)$`)

type WSHandler struct {
	roomService *service.RoomService
	upgrader    websocket.Upgrader
}

func NewWSHandler(roomService *service.RoomService) *WSHandler {
	return &WSHandler{
		roomService: roomService,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
	}
}

type WSMessage struct {
	Type      string `json:"type"`
	Content   string `json:"content"`
	MediaKind string `json:"media_kind"`
	FileName  string `json:"file_name"`
	MimeType  string `json:"mime_type"`
	SizeBytes int64  `json:"size_bytes"`
	DataURL   string `json:"data_url"`
}

func (h *WSHandler) ServeWS(c *gin.Context) {
	roomID := c.Query("room_id")
	role := c.Query("role")

	if !roomIDRegexp.MatchString(roomID) {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid room id"})
		return
	}
	if !roleRegexp.MatchString(role) {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid role"})
		return
	}

	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}

	if err := h.roomService.BindConn(roomID, role, conn); err != nil {
		_ = conn.WriteJSON(gin.H{
			"type":    "system",
			"event":   "bind_failed",
			"message": err.Error(),
		})
		_ = conn.Close()
		return
	}

	defer func() {
		h.roomService.UnbindConn(roomID, role, conn)
		_ = conn.Close()
	}()

	room, ok := h.roomService.GetRoom(roomID)
	if ok {
		room.Mu.RLock()
		_ = conn.WriteJSON(gin.H{
			"type":       "system",
			"event":      "connected",
			"message":    "websocket connected",
			"room_id":    roomID,
			"role":       role,
			"status":     room.Status,
			"expires_at": room.ExpiresAt.Unix(),
		})
		room.Mu.RUnlock()
	}

	for {
		var msg WSMessage
		if err := conn.ReadJSON(&msg); err != nil {
			log.Printf("ws read error: %v", err)
			break
		}

		switch msg.Type {
		case "ping":
			_ = conn.WriteJSON(gin.H{"type": "pong"})
		case "chat":
			if err := h.roomService.SendChat(roomID, role, msg.Content); err != nil {
				_ = conn.WriteJSON(gin.H{
					"type":    "system",
					"event":   "send_failed",
					"message": err.Error(),
				})
			}
		case "media":
			if err := h.roomService.SendMedia(roomID, role, msg.MediaKind, msg.FileName, msg.MimeType, msg.SizeBytes, msg.DataURL); err != nil {
				_ = conn.WriteJSON(gin.H{
					"type":    "system",
					"event":   "send_failed",
					"message": err.Error(),
				})
			}
		default:
			_ = conn.WriteJSON(gin.H{
				"type":    "system",
				"event":   "invalid_type",
				"message": "unsupported message type",
			})
		}
	}
}
