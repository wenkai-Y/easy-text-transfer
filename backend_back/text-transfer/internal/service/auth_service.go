package service

import (
	"text-transfer/internal/config"
	"text-transfer/internal/utils"
)

type AuthService struct {
	cfg *config.Config
}

func NewAuthService(cfg *config.Config) *AuthService {
	return &AuthService{cfg: cfg}
}

func (s *AuthService) VerifyPassword(input string) bool {
	inputHash := utils.SHA256Hex(input)
	return inputHash == s.cfg.Auth.PasswordHash
}
