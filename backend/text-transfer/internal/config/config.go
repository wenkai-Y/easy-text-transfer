package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server ServerConfig `yaml:"server"`
	Auth   AuthConfig   `yaml:"auth"`
	Room   RoomConfig   `yaml:"room"`
}

type ServerConfig struct {
	Port int    `yaml:"port"`
	Mode string `yaml:"mode"`
}

type AuthConfig struct {
	PasswordHash string `yaml:"password_hash"`
	CookieName   string `yaml:"cookie_name"`
	CookieSecret string `yaml:"cookie_secret"`
	CookieMaxAge int    `yaml:"cookie_max_age"`
}

type RoomConfig struct {
	WaitTimeoutSeconds   int `yaml:"wait_timeout_seconds"`
	ActiveTimeoutSeconds int `yaml:"active_timeout_seconds"`
	MessageMaxLength     int `yaml:"message_max_length"`
	MediaMaxBytes        int `yaml:"media_max_bytes"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	if cfg.Room.MediaMaxBytes <= 0 {
		cfg.Room.MediaMaxBytes = 8 * 1024 * 1024
	}

	return &cfg, nil
}
