#!/usr/bin/env bash
# Earth Sentinel — Developer Setup
#
# Uso:
#   bash install.sh          → instala deps + sobe apenas infra (workflow dev local)
#   bash install.sh --full   → instala deps + sobe stack completa em Docker
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FULL_STACK=false
[[ "${1:-}" == "--full" ]] && FULL_STACK=true

# ── Helpers ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC}  $*" >&2; exit 1; }
info() { echo -e "${BLUE}→${NC}  $*"; }
sep()  { echo -e "${BLUE}──────────────────────────────────────────${NC}"; }

echo ""; echo -e "${BLUE}  ⚡ Earth Sentinel — Setup${NC}"; sep; echo ""

# ── 1. Pré-requisitos ─────────────────────────────────────────────────────────
info "Verificando pré-requisitos..."

command -v docker &>/dev/null || err "Docker não encontrado"
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

command -v node &>/dev/null || err "Node.js não encontrado (requer 18+)"
ok "Node.js $(node --version)"

command -v npm &>/dev/null || err "npm não encontrado"
ok "npm $(npm --version)"

# Docker Compose — plugin v2 (preferido) ou standalone v1
if docker compose version &>/dev/null 2>&1; then
  DC="docker compose"
  ok "docker compose (plugin v2)"
elif command -v docker-compose &>/dev/null; then
  DC="docker-compose"
  ok "docker-compose (standalone)"
else
  err "docker compose não encontrado — instale o Docker Desktop ou o plugin Compose"
fi

# Go — necessário apenas para dev local (desnecessário com --full)
GO_CMD=""
for candidate in go \
    "/c/Program Files/Go/bin/go" \
    "/usr/local/go/bin/go" \
    "/mnt/c/Program Files/Go/bin/go"; do
  if command -v "$candidate" &>/dev/null 2>/dev/null || [[ -x "$candidate" ]]; then
    GO_CMD="$candidate"; break
  fi
done

if [[ -n "$GO_CMD" ]]; then
  ok "Go $("$GO_CMD" version | awk '{print $3}')"
else
  if $FULL_STACK; then
    warn "Go não encontrado — desnecessário no modo --full (build ocorre no Docker)"
  else
    warn "Go não encontrado no PATH"
    warn "Binário esperado em /c/Program Files/Go/bin/go (Windows + Git Bash)"
    warn "Ou use: bash install.sh --full  para rodar tudo via Docker"
  fi
fi

echo ""

# ── 2. Variáveis de ambiente ──────────────────────────────────────────────────
info "Configurando variáveis de ambiente..."
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  warn ".env criado a partir de .env.example"
  warn "Edite .env e preencha ALPHA_VANTAGE_KEY e MEDIACLOUD_API_KEY antes de iniciar"
else
  ok ".env já existe"
fi

echo ""

# ── 3. Dependências Node.js ───────────────────────────────────────────────────
info "Instalando dependências Node.js..."
npm install --silent
ok "node_modules prontos"
echo ""

# ── 4. Módulos Go ─────────────────────────────────────────────────────────────
if [[ -n "$GO_CMD" ]]; then
  info "Baixando módulos Go..."
  cd "$SCRIPT_DIR/backend"
  "$GO_CMD" mod download
  ok "módulos Go em cache local"
  cd "$SCRIPT_DIR"
  echo ""
fi

# ── 5. Docker ─────────────────────────────────────────────────────────────────
COMPOSE_ARGS=""
$FULL_STACK || COMPOSE_ARGS="-f docker-compose.dev.yml"

if $FULL_STACK; then
  info "Construindo e iniciando stack completa em Docker..."
  $DC up --build -d
else
  info "Iniciando infraestrutura Docker (PostgreSQL · Redis · MinIO)..."
  $DC -f docker-compose.dev.yml up -d
fi

echo ""
info "Aguardando serviços ficarem prontos..."

# Espera um serviço ficar pronto (máx ~60s)
wait_for() {
  local label="$1"; shift   # rótulo legível
  local n=0
  until "$@" &>/dev/null; do
    [[ $n -ge 30 ]] && { warn "$label demorou — verifique: $DC $COMPOSE_ARGS logs"; return; }
    sleep 2; ((n++))
  done
  ok "$label pronto"
}

wait_for "PostgreSQL" $DC $COMPOSE_ARGS exec -T postgres pg_isready -U earthsentinel
wait_for "Redis"      bash -c "$DC $COMPOSE_ARGS exec -T redis redis-cli ping | grep -q PONG"

if $FULL_STACK; then
  info "Aguardando backend Go passar no health check..."
  wait_for "Backend Go" curl -sf http://localhost:8080/api/health
fi

echo ""

# ── 6. Resumo ─────────────────────────────────────────────────────────────────
sep; echo -e "${GREEN}  ✓ Setup concluído!${NC}"; sep; echo ""

if $FULL_STACK; then
  cat <<EOF
  Stack completa rodando em Docker:

    Frontend  → http://localhost:3000
    Backend   → http://localhost:8080/api/health
    MinIO UI  → http://localhost:9001  (minio-access-key / minio-secret-key)

  Comandos úteis:
    $DC logs -f backend     # logs do Go
    $DC logs -f frontend    # logs do Node.js
    $DC down                # parar tudo
    $DC up --build -d       # rebuild e reiniciar

EOF
else
  GO_HINT="${GO_CMD:-/c/Program Files/Go/bin/go} run ./cmd/api"
  cat <<EOF
  Infra Docker rodando:
    PostgreSQL  → localhost:5432
    Redis       → localhost:6379
    MinIO API   → localhost:9000
    MinIO UI    → http://localhost:9001  (minio-access-key / minio-secret-key)

  Para iniciar a aplicação (dois terminais):

    Terminal 1 — Backend Go:
      cd backend && $GO_HINT

    Terminal 2 — Frontend Node.js:
      npm start

    Frontend  → http://localhost:3000
    Backend   → http://localhost:8080/api/health

  Para rodar tudo em Docker (sem processos locais):
    bash install.sh --full

EOF
fi
