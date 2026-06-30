# Workflow: Infrastructure

## Objetivo

Completar a infraestrutura de suporte da plataforma: finalizar configuração de
PostgreSQL, Redis e MinIO, garantir execução automática de migrations, configurar
observabilidade básica e preparar o ambiente para receber os primeiros temas.

**Pré-condição:** `.claude/workflows/bootstrap.md` concluído.

---

## Agentes Envolvidos

| Agente | Papel neste workflow |
|--------|----------------------|
| Tech Lead | Coordena e valida |
| Database Engineer | Repositórios completos, índices, connection pool |
| DevOps Engineer | Health check estendido, logs estruturados, CI pipeline |
| QA Engineer | Testes de repositório com banco real |

---

## Grafo de Tarefas

```
PARALELO — Fase 1:
  [A] Database Engineer   → repositórios completos + testes de integração de store
  [B] DevOps Engineer     → CI pipeline GitHub Actions + logs estruturados

SEQUENCIAL — Fase 2 (depende de A):
  [C] QA Engineer         → testes de store contra PostgreSQL real
  [D] Tech Lead           → validar health check + pipeline
```

---

## Fase 1A — Database Engineer

### Repositório completo

Implementar todos os métodos definidos em `.claude/agents/database-engineer.md`:

```go
// Obrigatório implementar:
UpsertItems(ctx, items)                        // idempotente por id
QueryByTheme(ctx, themeID, opts)               // com filtros since/limit/type
GetByID(ctx, id) (ContentItem, error)          // detalhe de item
DeleteExpired(ctx) (int64, error)              // limpeza de items expirados

// Cache Redis:
GetFeed(ctx, themeID) ([]ContentItem, bool)
SetFeed(ctx, themeID, items)
InvalidateFeed(ctx, themeID)
Allow(ctx, key, maxReqs, window) bool          // rate limiter sliding window
```

### Connection pool

```go
db, err := sql.Open("pgx", os.Getenv("DATABASE_URL"))
db.SetMaxOpenConns(25)
db.SetMaxIdleConns(5)
db.SetConnMaxLifetime(5 * time.Minute)
```

### Migration automática no boot

```go
// backend/cmd/api/main.go — executar migrations antes de iniciar
func runMigrations(db *sql.DB) error {
    entries, _ := os.ReadDir("migrations")
    for _, e := range entries {
        if !strings.HasSuffix(e.Name(), ".sql") { continue }
        data, _ := os.ReadFile(filepath.Join("migrations", e.Name()))
        if _, err := db.Exec(string(data)); err != nil {
            return fmt.Errorf("migration %s: %w", e.Name(), err)
        }
        slog.Info("migration applied", "file", e.Name())
    }
    return nil
}
```

---

## Fase 1B — DevOps Engineer

### CI Pipeline

Criar `.github/workflows/ci.yml` conforme `.claude/agents/devops-engineer.md`.

### Logs estruturados

```go
// backend/cmd/api/main.go
slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level: slog.LevelInfo,
})))
```

### Health check estendido

`GET /api/health` deve verificar PostgreSQL, Redis e MinIO:

```json
{
  "status": "ok",
  "db":     true,
  "cache":  true,
  "time":   "2026-06-10T14:32:00Z"
}
```

---

## Fase 2C — QA Engineer

Testes de integração de store (requerem banco real — rodam no CI com serviço postgres):

```go
// backend/internal/store/postgres/content_items_integration_test.go
// build tag: //go:build integration

func TestUpsertItems_Idempotent(t *testing.T) {
    // Inserir o mesmo item duas vezes → apenas um registro no banco
}

func TestQueryByTheme_FiltersExpired(t *testing.T) {
    // Items com expires_at no passado não aparecem no resultado
}

func TestDeleteExpired_RemovesCorrectItems(t *testing.T) {
    // Apenas items com expires_at < now() são removidos
}
```

---

## Fase 2D — Tech Lead: Validação

- [ ] `GET /api/health` → `{ "status": "ok", "db": true, "cache": true }`
- [ ] Migration 001 executou: `psql -c "\dt"` mostra `content_items` e `themes`
- [ ] `go test ./internal/store/...` passa (unitários sem banco)
- [ ] `go test -tags=integration ./internal/store/...` passa (com banco)
- [ ] CI pipeline passa em PR de exemplo
- [ ] `slog` emite JSON estruturado no stdout

---

## Critérios de Conclusão

- [ ] `UpsertItems` e `QueryByTheme` implementados e testados
- [ ] Cache Redis funcional com TTL de 2min
- [ ] Rate limiter Redis implementado e testado
- [ ] Health check retorna estado real dos serviços
- [ ] CI pipeline executa tests Go + tests JS em < 5min
- [ ] Migrations executam automaticamente no boot

---

## Próximo Workflow

Após infraestrutura concluída → `.claude/workflows/extreme-events.md`
