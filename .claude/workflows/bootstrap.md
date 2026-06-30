# Workflow: Bootstrap

## Objetivo

Criar a estrutura inicial do projeto Earth Sentinel a partir de um repositório vazio.
Ao final deste workflow, o projeto terá estrutura de diretórios, módulo Go inicializado,
`package.json`, `server.js` funcional, e infraestrutura local rodando.

**Pré-condição:** repositório git vazio ou apenas com `README.md`.

---

## Agentes Envolvidos

| Agente | Papel neste workflow |
|--------|----------------------|
| Tech Lead | Coordena, valida estrutura final |
| Backend Engineer | Scaffold Go: `go.mod`, `cmd/api/main.go`, interfaces `domain/` |
| Database Engineer | `docker-compose.dev.yml`, migration inicial `001_init.sql` |
| DevOps Engineer | `Dockerfile`, `docker-compose.dev.yml`, `scripts/setup-dev.sh` |

---

## Grafo de Tarefas

```
PARALELO — Fase 1 (sem dependências entre si):
  [A] Backend Engineer   → scaffold Go
  [B] Database Engineer  → schema SQL base + migration 001
  [C] DevOps Engineer    → docker-compose + Dockerfiles + setup script

SEQUENCIAL — Fase 2 (depende de A + B + C):
  [D] Tech Lead          → validar estrutura contra schematics
  [E] DevOps Engineer    → executar scripts/setup-dev.sh, verificar health
```

---

## Fase 1A — Backend Engineer: Scaffold Go

Criar estrutura de diretórios e arquivos base:

```
backend/
├── go.mod                           ← module github.com/earth-sentinel/backend
├── cmd/api/
│   └── main.go                      ← boot: router, registry, scheduler, HTTP
├── internal/
│   ├── domain/
│   │   ├── content_item.go          ← ContentItem, GeoPoint structs + Validate()
│   │   ├── interfaces.go            ← Source, Theme, ScoreContext interfaces
│   │   └── truncate.go              ← func Truncate(s string, max int) string
│   ├── theme/
│   │   └── registry.go              ← ThemeRegistry: Register, Get, All
│   ├── ingest/
│   │   └── scheduler.go             ← Scheduler: Start, goroutine por Source
│   ├── store/
│   │   ├── postgres/
│   │   │   └── content_items.go     ← UpsertItems, QueryByTheme
│   │   └── redis/
│   │       ├── feed_cache.go        ← GetFeed, SetFeed, InvalidateFeed
│   │       └── rate_limiter.go      ← Allow (sliding window)
│   ├── api/
│   │   └── handler/
│   │       ├── themes.go            ← GET /api/themes
│   │       ├── feed.go              ← GET /api/themes/:id/feed
│   │       └── health.go            ← GET /api/health
│   └── platform/
│       ├── config.go                ← lê variáveis de ambiente
│       └── minio.go                 ← cliente MinIO
```

**Entregável:** `go build ./...` sem erros. Sem providers, sem temas — só estrutura.

---

## Fase 1B — Database Engineer: Schema Base

```
backend/migrations/
└── 001_init.sql    ← content_items, themes, índices
```

Conteúdo mínimo: tabelas `content_items` e `themes` conforme
`.claude/agents/database-engineer.md` → seção Schema PostgreSQL.

---

## Fase 1C — DevOps Engineer: Infraestrutura

```
docker-compose.dev.yml     ← PostgreSQL, Redis, MinIO com healthchecks
backend/Dockerfile
Dockerfile.frontend
scripts/setup-dev.sh
.env.example               ← template de variáveis de ambiente
```

---

## Fase 2D — Tech Lead: Validação de Estrutura

Verificar contra `.claude/schematics/architecture.md`:

- [ ] `backend/internal/domain/` existe com `ContentItem`, `GeoPoint`, interfaces
- [ ] `backend/internal/store/` existe com interfaces `ContentItemRepository`
- [ ] `backend/internal/api/handler/` existe com os 3 handlers base
- [ ] `public/` existe com `index.html`, `js/app.js`, `js/map.js`, `js/globe.js`
- [ ] `server.js` serve estáticos e proxeia `/api/*` para Go `:8080`
- [ ] `migrations/001_init.sql` existe e cria as tabelas necessárias

---

## Fase 2E — DevOps: Smoke Test

```bash
docker compose -f docker-compose.dev.yml up -d --wait
cd backend && go run ./cmd/api &
npm start &
curl http://localhost:3000/api/health
# esperado: { "status": "ok" }
```

---

## Critérios de Conclusão

- [ ] `go build ./...` — sem erros de compilação
- [ ] `docker compose up -d --wait` — todos os serviços healthy
- [ ] `GET /api/health` → `{ "status": "ok" }`
- [ ] `GET /api/themes` → `[]` (array vazio — nenhum tema registrado ainda)
- [ ] Estrutura de diretórios corresponde exatamente ao alvo em `architecture.md`

---

## Próximo Workflow

Após bootstrap concluído → `.claude/workflows/infrastructure.md`
