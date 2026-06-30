package platform

import "os"

type Config struct {
	DatabaseURL    string
	RedisURL       string
	MinioEndpoint  string
	MinioAccessKey string
	MinioSecretKey string
	MinioBucket    string
	Port           string

	AlphaVantageKey  string
	MediaCloudAPIKey string
}

func LoadConfig() Config {
	return Config{
		DatabaseURL:    getenv("DATABASE_URL", "postgres://earthsentinel:earthsentinel@localhost:5432/earthsentinel"),
		RedisURL:       getenv("REDIS_URL", "redis://localhost:6379"),
		MinioEndpoint:  getenv("MINIO_ENDPOINT", "localhost:9000"),
		MinioAccessKey: getenv("MINIO_ACCESS_KEY", "minio-access-key"),
		MinioSecretKey: getenv("MINIO_SECRET_KEY", "minio-secret-key"),
		MinioBucket:    getenv("MINIO_BUCKET", "earth-sentinel"),
		Port:           getenv("PORT", "8080"),

		AlphaVantageKey:  os.Getenv("ALPHA_VANTAGE_KEY"),
		MediaCloudAPIKey: os.Getenv("MEDIACLOUD_API_KEY"),
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
