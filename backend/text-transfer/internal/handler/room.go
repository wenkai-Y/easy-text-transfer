package handler

import (
	"net/http"
	"regexp"

	"text-transfer/internal/model"
	"text-transfer/internal/service"
	"text-transfer/internal/utils"

	"github.com/gin-gonic/gin"
)

var roomIDRegexp = regexp.MustCompile(`^\d{4}$`)

type RoomHandler struct {
	roomService *service.RoomService
}

func NewRoomHandler(roomService *service.RoomService) *RoomHandler {
	return &RoomHandler{
		roomService: roomService,
	}
}

func (h *RoomHandler) CreateRoom(c *gin.Context) {
	room, err := h.roomService.CreateRoom()
	if err != nil {
		utils.Fail(c, http.StatusInternalServerError, err.Error())
		return
	}

	utils.OK(c, gin.H{
		"room_id":    room.ID,
		"role":       model.RoleCreator,
		"status":     room.Status,
		"expires_at": room.ExpiresAt.Unix(),
	})
}

type JoinRoomRequest struct {
	RoomID string `json:"room_id"`
}

func (h *RoomHandler) JoinRoom(c *gin.Context) {
	var req JoinRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Fail(c, http.StatusBadRequest, "invalid request")
		return
	}

	if !roomIDRegexp.MatchString(req.RoomID) {
		utils.Fail(c, http.StatusBadRequest, "invalid room id")
		return
	}

	room, role, err := h.roomService.JoinRoom(req.RoomID)
	if err != nil {
		utils.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	utils.OK(c, gin.H{
		"room_id":    room.ID,
		"role":       role,
		"status":     room.Status,
		"expires_at": room.ExpiresAt.Unix(),
	})
}

type DestroyRoomRequest struct {
	RoomID string `json:"room_id"`
}

func (h *RoomHandler) DestroyRoom(c *gin.Context) {
	var req DestroyRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Fail(c, http.StatusBadRequest, "invalid request")
		return
	}

	if !roomIDRegexp.MatchString(req.RoomID) {
		utils.Fail(c, http.StatusBadRequest, "invalid room id")
		return
	}

	h.roomService.DestroyRoom(req.RoomID, "manual destroy")
	utils.OK(c, gin.H{
		"destroyed": true,
	})
}

func (h *RoomHandler) RoomStatus(c *gin.Context) {
	roomID := c.Query("room_id")
	if !roomIDRegexp.MatchString(roomID) {
		utils.Fail(c, http.StatusBadRequest, "invalid room id")
		return
	}

	room, ok := h.roomService.GetRoom(roomID)
	if !ok {
		utils.Fail(c, http.StatusNotFound, "room not found")
		return
	}

	room.Mu.RLock()
	defer room.Mu.RUnlock()

	utils.OK(c, gin.H{
		"room_id":    room.ID,
		"status":     room.Status,
		"expires_at": room.ExpiresAt.Unix(),
		"creator": gin.H{
			"online": room.Creator != nil && room.Creator.Online,
		},
		"joiner": gin.H{
			"online": room.Joiner != nil && room.Joiner.Online,
		},
	})
}

func (h *RoomHandler) ListRooms(c *gin.Context) {
	rooms := h.roomService.ListJoinableRooms()

	result := make([]gin.H, 0, len(rooms))
	for _, room := range rooms {
		result = append(result, gin.H{
			"room_id":           room.ID,
			"status":            room.Status,
			"expires_at":        room.ExpiresAt.Unix(),
			"remaining_seconds": room.RemainingSeconds,
		})
	}

	utils.OK(c, gin.H{
		"rooms": result,
	})
}
