package middleware

import (
	"text-transfer/internal/config"
	"text-transfer/internal/utils"

	"github.com/gin-gonic/gin"
)

func RequireAccess(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		val, err := c.Cookie(cfg.Auth.CookieName)
		if err != nil || !utils.VerifySignedCookieValue(cfg.Auth.CookieSecret, val) {
			utils.Fail(c, 401, "unauthorized")
			c.Abort()
			return
		}
		c.Next()
	}
}
