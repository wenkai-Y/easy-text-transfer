package utils

import "github.com/gin-gonic/gin"

func OK(c *gin.Context, data gin.H) {
	c.JSON(200, gin.H{
		"code":    0,
		"message": "ok",
		"data":    data,
	})
}

func Fail(c *gin.Context, httpCode int, msg string) {
	c.JSON(httpCode, gin.H{
		"code":    1,
		"message": msg,
	})
}
