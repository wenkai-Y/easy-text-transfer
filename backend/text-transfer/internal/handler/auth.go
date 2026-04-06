package handler

import (
	"net/http"
	"time"

	"text-transfer/internal/config"
	"text-transfer/internal/service"
	"text-transfer/internal/utils"

	"github.com/gin-gonic/gin"
)

type AuthHandler struct {
	cfg         *config.Config
	authService *service.AuthService
}

func NewAuthHandler(cfg *config.Config, authService *service.AuthService) *AuthHandler {
	return &AuthHandler{
		cfg:         cfg,
		authService: authService,
	}
}

type AccessRequest struct {
	Password string `json:"password"`
}

func (h *AuthHandler) Access(c *gin.Context) {
	var req AccessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Fail(c, http.StatusBadRequest, "invalid request")
		return
	}

	if !h.authService.VerifyPassword(req.Password) {
		utils.Fail(c, http.StatusUnauthorized, "password incorrect")
		return
	}

	expireAt := time.Now().Add(time.Duration(h.cfg.Auth.CookieMaxAge) * time.Second).Unix()
	cookieValue := utils.BuildSignedCookieValue(h.cfg.Auth.CookieSecret, expireAt)
	c.SetCookie(
		h.cfg.Auth.CookieName,
		cookieValue,
		h.cfg.Auth.CookieMaxAge,
		"/",
		"",
		false,
		true,
	)

	utils.OK(c, gin.H{
		"authorized": true,
	})
}
