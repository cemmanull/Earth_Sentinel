#!/usr/bin/env bash
set -euo pipefail

echo "→ Starting infrastructure (PostgreSQL, Redis, MinIO)..."
docker compose -f docker-compose.dev.yml up -d --wait

echo "→ Verifying services..."
docker compose -f docker-compose.dev.yml ps

echo ""
echo "✓ Infrastructure ready"
echo "  PostgreSQL : localhost:5432"
echo "  Redis      : localhost:6379"
echo "  MinIO      : localhost:9000  (console: localhost:9001)"
echo ""
echo "→ To start the backend:"
echo "  cd backend && go run ./cmd/api"
echo ""
echo "→ To start the frontend:"
echo "  npm start"
echo ""
echo "→ Health check:"
echo "  curl http://localhost:3000/api/health"
