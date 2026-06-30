# Agente: DevOps Engineer

## Missão

Implementar e manter a infraestrutura de execução da plataforma Earth Sentinel:
ambientes Docker, pipelines CI/CD, observabilidade e healthchecks.

---

## Responsabilidades

- Criar e manter `docker-compose.dev.yml` e `docker-compose.prod.yml`
- Criar `Dockerfile` para Go backend e Node.js frontend
- Criar pipelines GitHub Actions (CI: test + build; CD: deploy)
- Configurar health checks para todos os serviços
- Configurar logging estruturado e coleta de métricas
- Gerenciar variáveis de ambiente e secrets
- Automatizar execução de migrations

---

## Escopo Permitido

```
docker-compose*.yml
Dockerfile*
.github/workflows/
scripts/
backend/cmd/api/main.go  (somente configuração de boot)
```

---

## Escopo Proibido

- `backend/internal/` — lógica de domínio, handlers, providers
- `public/` — qualquer arquivo frontend
- `backend/migrations/` — schema SQL (responsabilidade do database-engineer)
- Regras de negócio de qualquer tema

---

## Docker Compose — Dev

```yaml
# docker-compose.dev.yml

version: '3.9'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER:     earthsentinel
      POSTGRES_PASSWORD: earthsentinel
      POSTGRES_DB:       earthsentinel
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backend/migrations:/docker-entrypoint-initdb.d   # auto-executa migrations
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U earthsentinel"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER:     minio-access-key
      MINIO_ROOT_PASSWORD: minio-secret-key
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

---

## Dockerfile — Go Backend

```dockerfile
# backend/Dockerfile

FROM golang:1.21-alpine AS builder
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bin/api ./cmd/api

FROM scratch
COPY --from=builder /bin/api /bin/api
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

EXPOSE 8080
ENTRYPOINT ["/bin/api"]
```

---

## Dockerfile — Node.js Frontend

```dockerfile
# Dockerfile.frontend

FROM node:18-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js .
COPY public/ ./public/

EXPOSE 3000
ENV GO_BACKEND_URL=http://backend:8080
CMD ["node", "server.js"]
```

---

## GitHub Actions — CI

```yaml
# .github/workflows/ci.yml

name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  test-backend:
    name: Go Tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_USER:     earthsentinel
          POSTGRES_PASSWORD: earthsentinel
          POSTGRES_DB:       earthsentinel
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
        ports:
          - 5432:5432
      redis:
        image: redis:7-alpine
        options: --health-cmd "redis-cli ping" --health-interval 5s --health-retries 10
        ports:
          - 6379:6379
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.21' }
      - name: Run tests
        working-directory: backend
        run: go test -race -count=1 ./...
        env:
          DATABASE_URL: postgres://earthsentinel:earthsentinel@localhost:5432/earthsentinel
          REDIS_URL:    redis://localhost:6379

  test-frontend:
    name: Node.js Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '18' }
      - run: npm ci
      - run: npm test

  lint-backend:
    name: Go Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.21' }
      - uses: golangci/golangci-lint-action@v4
        with: { working-directory: backend }

  build:
    name: Build Docker Images
    needs: [test-backend, test-frontend]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build backend
        run: docker build -f backend/Dockerfile backend/ -t earth-sentinel-backend
      - name: Build frontend
        run: docker build -f Dockerfile.frontend . -t earth-sentinel-frontend
```

---

## Script de Setup Local

```bash
#!/usr/bin/env bash
# scripts/setup-dev.sh
set -euo pipefail

echo "→ Starting infrastructure..."
docker compose -f docker-compose.dev.yml up -d --wait

echo "→ Waiting for PostgreSQL..."
until docker compose -f docker-compose.dev.yml exec postgres pg_isready -U earthsentinel; do
  sleep 1
done

echo "→ Creating MinIO bucket..."
docker compose -f docker-compose.dev.yml exec minio \
  mc alias set local http://localhost:9000 minio-access-key minio-secret-key 2>/dev/null || true
docker compose -f docker-compose.dev.yml exec minio \
  mc mb local/earth-sentinel --ignore-existing

echo "→ Running Go backend..."
(cd backend && go run ./cmd/api) &

echo "→ Starting Node.js frontend..."
npm start &

echo "✓ Earth Sentinel running at http://localhost:3000"
```

---

## Observabilidade

### Logs estruturados (Go — já usa `slog`)

```go
// backend/cmd/api/main.go — configurar handler de log

slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level: slog.LevelInfo,
})))
```

### Health endpoint

O Go backend expõe `GET /api/health` com status dos serviços dependentes:

```go
// Verificar conectividade com PostgreSQL e Redis no health check
func (h *HealthHandler) Check(w http.ResponseWriter, r *http.Request) {
    dbOK  := h.db.PingContext(r.Context()) == nil
    cacheOK := h.cache.Ping(r.Context()) == nil

    status := "ok"
    code   := 200
    if !dbOK || !cacheOK {
        status = "degraded"
        code   = 503
    }

    w.WriteHeader(code)
    json.NewEncoder(w).Encode(map[string]any{
        "status":  status,
        "db":      dbOK,
        "cache":   cacheOK,
        "time":    time.Now().UTC(),
    })
}
```

---

## Variáveis de Ambiente — Referência

| Variável | Obrigatória | Exemplo |
|----------|-------------|---------|
| `DATABASE_URL` | ✅ | `postgres://user:pass@localhost:5432/earthsentinel` |
| `REDIS_URL` | ✅ | `redis://localhost:6379` |
| `MINIO_ENDPOINT` | ✅ | `localhost:9000` |
| `MINIO_ACCESS_KEY` | ✅ | `minio-access-key` |
| `MINIO_SECRET_KEY` | ✅ | `minio-secret-key` |
| `MINIO_BUCKET` | ✅ | `earth-sentinel` |
| `PORT` (Go) | — | `8080` |
| `PORT` (Node) | — | `3000` |
| `GO_BACKEND_URL` | — | `http://localhost:8080` |
| `ALPHA_VANTAGE_KEY` | API paga | — |
| `MEDIACLOUD_API_KEY` | API paga | — |

Nunca commitar valores de variáveis de ambiente. Usar `.env.example` como template.

---

## Critérios de Qualidade

- [ ] `docker compose -f docker-compose.dev.yml up -d --wait` sobe todos os serviços sem erro
- [ ] `GET /api/health` retorna 200 quando todos os serviços estão up
- [ ] Migrations executam automaticamente no primeiro `up`
- [ ] CI pipeline executa em menos de 5 minutos
- [ ] Sem secrets hardcoded em qualquer arquivo versionado
- [ ] `Dockerfile` usa multi-stage build (imagem final ≤ 20MB para Go)

## Critérios de Aprovação (pelo Tech Lead)

- [ ] `docker compose -f docker-compose.dev.yml up -d && curl localhost:3000` retorna `index.html`
- [ ] `curl localhost:3000/api/health` retorna `{ "status": "ok" }`
- [ ] GitHub Actions CI passa em PR de exemplo
- [ ] `scripts/setup-dev.sh` executa do zero sem intervenção manual
