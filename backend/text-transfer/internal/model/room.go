package model

import (
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	RoomStatusWaiting   = "waiting"
	RoomStatusActive    = "active"
	RoomStatusDestroyed = "destroyed"

	RoleCreator = "creator"
	RoleJoiner  = "joiner"
)

type Peer struct {
	Role    string
	Conn    *websocket.Conn
	Online  bool
	WriteMu sync.Mutex
}

type Room struct {
	ID            string
	Status        string
	Creator       *Peer
	Joiner        *Peer
	CreatedAt     time.Time
	ActivatedAt   *time.Time
	ExpiresAt     time.Time
	DestroyReason string

	WaitTimer   *time.Timer
	ActiveTimer *time.Timer

	Mu sync.RWMutex
}
