package service

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"text-transfer/internal/config"
	"text-transfer/internal/model"
	"text-transfer/internal/utils"

	"github.com/gorilla/websocket"
)

type RoomService struct {
	cfg   *config.Config
	rooms map[string]*model.Room
	mu    sync.RWMutex
}

type JoinableRoom struct {
	ID               string
	Status           string
	ExpiresAt        time.Time
	RemainingSeconds int64
}

func NewRoomService(cfg *config.Config) *RoomService {
	return &RoomService{
		cfg:   cfg,
		rooms: make(map[string]*model.Room),
	}
}

func (s *RoomService) CreateRoom() (*model.Room, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var roomID string
	var err error

	for i := 0; i < 20; i++ {
		roomID, err = utils.Random4DigitString()
		if err != nil {
			return nil, err
		}
		if _, exists := s.rooms[roomID]; !exists {
			break
		}
	}
	if _, exists := s.rooms[roomID]; exists {
		return nil, errors.New("failed to generate unique room id")
	}

	now := time.Now()
	room := &model.Room{
		ID:        roomID,
		Status:    model.RoomStatusWaiting,
		Creator:   &model.Peer{Role: model.RoleCreator, Online: false},
		Joiner:    nil,
		CreatedAt: now,
		ExpiresAt: now.Add(time.Duration(s.cfg.Room.WaitTimeoutSeconds) * time.Second),
	}

	room.WaitTimer = time.AfterFunc(
		time.Duration(s.cfg.Room.WaitTimeoutSeconds)*time.Second,
		func() {
			s.DestroyRoom(roomID, "waiting timeout")
		},
	)

	s.rooms[roomID] = room
	return room, nil
}

func (s *RoomService) JoinRoom(roomID string) (*model.Room, string, error) {
	s.mu.RLock()
	room, ok := s.rooms[roomID]
	s.mu.RUnlock()
	if !ok {
		return nil, "", errors.New("room not found")
	}

	room.Mu.Lock()
	defer room.Mu.Unlock()

	if room.Status == model.RoomStatusDestroyed {
		return nil, "", errors.New("room destroyed")
	}

	assignedRole := ""
	if room.Creator == nil || (!room.Creator.Online && room.Creator.Conn == nil) {
		room.Creator = &model.Peer{Role: model.RoleCreator, Online: false}
		assignedRole = model.RoleCreator
	} else if room.Joiner == nil || (!room.Joiner.Online && room.Joiner.Conn == nil) {
		room.Joiner = &model.Peer{Role: model.RoleJoiner, Online: false}
		assignedRole = model.RoleJoiner
	} else {
		return nil, "", errors.New("room is full")
	}

	wasActive := room.Status == model.RoomStatusActive
	if room.Creator != nil && room.Joiner != nil {
		now := time.Now()
		room.Status = model.RoomStatusActive
		if !wasActive {
			room.ActivatedAt = &now
			room.ExpiresAt = now.Add(time.Duration(s.cfg.Room.ActiveTimeoutSeconds) * time.Second)

			if room.WaitTimer != nil {
				room.WaitTimer.Stop()
			}

			room.ActiveTimer = time.AfterFunc(
				time.Duration(s.cfg.Room.ActiveTimeoutSeconds)*time.Second,
				func() {
					s.DestroyRoom(roomID, "active timeout")
				},
			)

			payload := map[string]any{
				"type":       "system",
				"event":      "room_activated",
				"message":    "房间已配对成功",
				"room_id":    room.ID,
				"expires_at": room.ExpiresAt.Unix(),
			}

			if room.Creator != nil && room.Creator.Conn != nil && room.Creator.Online {
				_ = room.Creator.Conn.WriteJSON(payload)
			}
			if room.Joiner != nil && room.Joiner.Conn != nil && room.Joiner.Online {
				_ = room.Joiner.Conn.WriteJSON(payload)
			}
		}
	} else {
		room.Status = model.RoomStatusWaiting
	}

	return room, assignedRole, nil
}

func (s *RoomService) GetRoom(roomID string) (*model.Room, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	room, ok := s.rooms[roomID]
	return room, ok
}

func (s *RoomService) ListJoinableRooms() []JoinableRoom {
	now := time.Now()

	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]JoinableRoom, 0, len(s.rooms))
	for _, room := range s.rooms {
		room.Mu.RLock()
		isWaiting := room.Status == model.RoomStatusWaiting
		hasVacancy := room.Status == model.RoomStatusActive &&
			((room.Creator == nil || (!room.Creator.Online && room.Creator.Conn == nil)) ||
				(room.Joiner == nil || (!room.Joiner.Online && room.Joiner.Conn == nil)))

		if isWaiting || hasVacancy {
			remaining := int64(room.ExpiresAt.Sub(now).Seconds())
			if remaining < 0 {
				remaining = 0
			}
			result = append(result, JoinableRoom{
				ID:               room.ID,
				Status:           room.Status,
				ExpiresAt:        room.ExpiresAt,
				RemainingSeconds: remaining,
			})
		}
		room.Mu.RUnlock()
	}

	return result
}

func (s *RoomService) DestroyRoom(roomID string, reason string) {
	s.mu.Lock()
	room, ok := s.rooms[roomID]
	if !ok {
		s.mu.Unlock()
		return
	}
	delete(s.rooms, roomID)
	s.mu.Unlock()

	room.Mu.Lock()
	defer room.Mu.Unlock()

	if room.Status == model.RoomStatusDestroyed {
		return
	}

	room.Status = model.RoomStatusDestroyed
	room.DestroyReason = reason

	if room.WaitTimer != nil {
		room.WaitTimer.Stop()
	}
	if room.ActiveTimer != nil {
		room.ActiveTimer.Stop()
	}

	s.notifySystem(room.Creator, "room_destroyed", fmt.Sprintf("房间已销毁: %s", reason))
	s.notifySystem(room.Joiner, "room_destroyed", fmt.Sprintf("房间已销毁: %s", reason))

	s.closeConn(room.Creator)
	s.closeConn(room.Joiner)
}

func (s *RoomService) BindConn(roomID, role string, conn *websocket.Conn) error {
	room, ok := s.GetRoom(roomID)
	if !ok {
		return errors.New("room not found")
	}

	room.Mu.Lock()
	defer room.Mu.Unlock()

	if room.Status == model.RoomStatusDestroyed {
		return errors.New("room destroyed")
	}

	var currentPeer *model.Peer
	var otherPeer *model.Peer

	switch role {
	case model.RoleCreator:
		if room.Creator == nil {
			return errors.New("creator slot missing")
		}
		room.Creator.Conn = conn
		room.Creator.Online = true
		currentPeer = room.Creator
		otherPeer = room.Joiner

	case model.RoleJoiner:
		if room.Joiner == nil {
			return errors.New("joiner slot missing")
		}
		room.Joiner.Conn = conn
		room.Joiner.Online = true
		currentPeer = room.Joiner
		otherPeer = room.Creator

	default:
		return errors.New("invalid role")
	}

	// 通知对方：当前用户已上线
	s.notifyPeerStatus(room, role, true)

	// 如果对方本来就在线，则通知当前用户“对方已上线”
	if otherPeer != nil && otherPeer.Conn != nil && otherPeer.Online {
		_ = currentPeer.Conn.WriteJSON(map[string]any{
			"type":    "system",
			"event":   "peer_online",
			"message": "对方已上线",
		})
	}

	return nil
}

func (s *RoomService) UnbindConn(roomID, role string, conn *websocket.Conn) {
	room, ok := s.GetRoom(roomID)
	if !ok {
		return
	}

	room.Mu.Lock()
	defer room.Mu.Unlock()

	switch role {
	case model.RoleCreator:
		if room.Creator != nil && room.Creator.Conn == conn {
			room.Creator.Conn = nil
			room.Creator.Online = false
		}
	case model.RoleJoiner:
		if room.Joiner != nil && room.Joiner.Conn == conn {
			room.Joiner.Conn = nil
			room.Joiner.Online = false
		}
	}

	s.notifyPeerStatus(room, role, false)
}

func (s *RoomService) SendChat(roomID, fromRole, content string) error {
	if len(content) == 0 {
		return errors.New("empty content")
	}
	if len([]rune(content)) > s.cfg.Room.MessageMaxLength {
		return errors.New("message too long")
	}

	msg := map[string]any{
		"type":    "chat",
		"from":    fromRole,
		"content": content,
		"time":    time.Now().Unix(),
	}

	return s.sendToPeer(roomID, fromRole, msg)
}

func (s *RoomService) SendMedia(roomID, fromRole, mediaKind, fileName, mimeType string, sizeBytes int64, dataURL string) error {
	if mediaKind != "image" && mediaKind != "video" {
		return errors.New("unsupported media kind")
	}

	if sizeBytes <= 0 {
		return errors.New("invalid media size")
	}

	maxBytes := int64(s.cfg.Room.MediaMaxBytes)
	if sizeBytes > maxBytes {
		return fmt.Errorf("media too large (max %d bytes)", s.cfg.Room.MediaMaxBytes)
	}

	mimePrefix := mediaKind + "/"
	if !strings.HasPrefix(mimeType, mimePrefix) {
		return errors.New("invalid mime type")
	}

	prefix := fmt.Sprintf("data:%s;base64,", mimeType)
	if !strings.HasPrefix(dataURL, prefix) {
		return errors.New("invalid data url")
	}

	encoded := strings.TrimPrefix(dataURL, prefix)
	decodedLen := int64(base64.StdEncoding.DecodedLen(len(encoded)))
	if decodedLen > maxBytes {
		return fmt.Errorf("media too large (max %d bytes)", s.cfg.Room.MediaMaxBytes)
	}

	msg := map[string]any{
		"type":       "media",
		"from":       fromRole,
		"media_kind": mediaKind,
		"file_name":  fileName,
		"mime_type":  mimeType,
		"size_bytes": sizeBytes,
		"data_url":   dataURL,
		"time":       time.Now().Unix(),
	}

	return s.sendToPeer(roomID, fromRole, msg)
}

func (s *RoomService) sendToPeer(roomID, fromRole string, payload map[string]any) error {
	room, ok := s.GetRoom(roomID)
	if !ok {
		return errors.New("room not found")
	}

	room.Mu.RLock()
	defer room.Mu.RUnlock()

	if room.Status != model.RoomStatusActive {
		return errors.New("room is not active")
	}

	var target *model.Peer
	if fromRole == model.RoleCreator {
		target = room.Joiner
	} else {
		target = room.Creator
	}

	if target == nil || target.Conn == nil || !target.Online {
		return errors.New("peer is offline")
	}

	return target.Conn.WriteJSON(payload)
}

func (s *RoomService) notifyPeerStatus(room *model.Room, changedRole string, online bool) {
	event := "peer_offline"
	message := "对方已离线，可等待其重连"
	if online {
		event = "peer_online"
		message = "对方已上线"
	}

	payload := map[string]any{
		"type":    "system",
		"event":   event,
		"role":    changedRole,
		"message": message,
	}

	if changedRole == model.RoleCreator {
		if room.Joiner != nil && room.Joiner.Conn != nil {
			_ = room.Joiner.Conn.WriteJSON(payload)
		}
	} else {
		if room.Creator != nil && room.Creator.Conn != nil {
			_ = room.Creator.Conn.WriteJSON(payload)
		}
	}
}

func (s *RoomService) notifySystem(peer *model.Peer, event, message string) {
	if peer == nil || peer.Conn == nil || !peer.Online {
		return
	}
	_ = peer.Conn.WriteJSON(map[string]any{
		"type":    "system",
		"event":   event,
		"message": message,
	})
}

func (s *RoomService) closeConn(peer *model.Peer) {
	if peer == nil || peer.Conn == nil {
		return
	}
	_ = peer.Conn.Close()
	peer.Conn = nil
	peer.Online = false
}
