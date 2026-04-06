package main

import (
	"fmt"
	"log"

	"text-transfer/internal/config"
	"text-transfer/internal/handler"
	"text-transfer/internal/middleware"
	"text-transfer/internal/service"

	"github.com/gin-gonic/gin"
)

func main() {
	cfg, err := config.Load("conf/config.yaml")
	if err != nil {
		log.Fatalf("load config failed: %v", err)
	}

	gin.SetMode(cfg.Server.Mode)

	authService := service.NewAuthService(cfg)
	roomService := service.NewRoomService(cfg)

	authHandler := handler.NewAuthHandler(cfg, authService)
	roomHandler := handler.NewRoomHandler(roomService)
	wsHandler := handler.NewWSHandler(roomService)

	r := gin.Default()

	r.GET("/ping", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "pong"})
	})

	api := r.Group("/api")
	{
		api.POST("/access", authHandler.Access)
	}

	protected := api.Group("/")
	protected.Use(middleware.RequireAccess(cfg))
	{
		protected.POST("/room/create", roomHandler.CreateRoom)
		protected.POST("/room/join", roomHandler.JoinRoom)
		protected.POST("/room/destroy", roomHandler.DestroyRoom)
		protected.GET("/room/status", roomHandler.RoomStatus)
	}

	r.GET("/ws", middleware.RequireAccess(cfg), wsHandler.ServeWS)

	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	log.Printf("server listening on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("server run failed: %v", err)
	}
}
