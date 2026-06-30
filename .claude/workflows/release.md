# Workflow: Release

## Objetivo

Publicar uma nova versão da plataforma Earth Sentinel com qualidade garantida:
testes passando, build limpo, tag de versão e deploy.

**Pré-condição:** Branch `main` com todos os critérios de conclusão do TODO.md
para a fase sendo liberada.

---

## Agentes Envolvidos

| Agente | Papel neste workflow |
|--------|----------------------|
| Tech Lead | Coordena, aprova release, define tag |
| QA Engineer | Executa bateria completa de testes, valida contratos |
| DevOps Engineer | Build Docker, tag git, pipeline de deploy |

---

## Grafo de Tarefas

```
SEQUENCIAL — obrigatório:
  [A] QA Engineer     → bateria completa de testes
  [B] Tech Lead       → validação de schematics + aprovação
  [C] DevOps Engineer → build + tag + deploy (apenas após B)
```

Nenhuma fase pode ser pulada. Qualquer falha em A reinicia o ciclo.

---

## Fase A — QA Engineer: Bateria Completa

```bash
# Backend Go
cd backend
go test -race -count=1 ./...
go vet ./...
# golangci-lint run (se disponível)

# Frontend JS
npm test
npm run test:int  # requer servidor rodando

# Smoke test end-to-end
curl http://localhost:3000/api/health
curl http://localhost:3000/api/themes
curl http://localhost:3000/api/sources/status
```

### Checklist de contrato (por cada provider em produção)

- [ ] Todos os providers retornam `ContentItem` com `id` estável
- [ ] Nenhum provider produz `geo: {0,0}`
- [ ] Todas as funções puras exportadas têm teste unitário
- [ ] `GET /api/themes/:id/feed` retorna array JSON válido para cada tema

### Relatório obrigatório

```
RELEASE QA REPORT — v[semver]
Data: [ISO 8601]

Testes Go:   N passing / 0 failing
Testes JS:   N passing / 0 failing
Contratos:   N providers validados / 0 violações
Regressões:  nenhuma

STATUS: APROVADO PARA RELEASE
```

---

## Fase B — Tech Lead: Aprovação

Verificar contra TODO.md:

- [ ] Todos os critérios da fase sendo liberada estão marcados como concluídos
- [ ] Nenhuma violação de schematics nos arquivos modificados nesta versão
- [ ] Separação de camadas respeitada (sources sem regras, domain sem I/O)
- [ ] QA aprovou (relatório gerado na Fase A)

Definir versão semântica:
- Breaking change (nova interface, schema migration): `MAJOR`
- Nova feature (novo tema, novo provider): `MINOR`
- Bugfix, otimização: `PATCH`

---

## Fase C — DevOps Engineer: Build e Tag

```bash
# 1. Confirmar que CI passou no último commit de main
gh run list --branch main --limit 1

# 2. Tag de versão
git tag -a v[MAJOR.MINOR.PATCH] -m "Release v[MAJOR.MINOR.PATCH]: [descrição]"
git push origin v[MAJOR.MINOR.PATCH]

# 3. Build Docker final
docker build -f backend/Dockerfile backend/ \
  -t ghcr.io/[org]/earth-sentinel-backend:v[MAJOR.MINOR.PATCH]

docker build -f Dockerfile.frontend . \
  -t ghcr.io/[org]/earth-sentinel-frontend:v[MAJOR.MINOR.PATCH]

# 4. Push imagens
docker push ghcr.io/[org]/earth-sentinel-backend:v[MAJOR.MINOR.PATCH]
docker push ghcr.io/[org]/earth-sentinel-frontend:v[MAJOR.MINOR.PATCH]
```

### Checklist pós-deploy

- [ ] `GET /api/health` → `{ "status": "ok" }` em produção
- [ ] `GET /api/themes` retorna todos os temas esperados
- [ ] Primeiro ciclo de ingestão completou sem erro (`slog.Warn` de provider ausente)
- [ ] Migrations aplicadas sem erro no boot

---

## Política de Rollback

Se health check falhar após deploy:

```bash
# Reverter para imagem anterior
docker pull ghcr.io/[org]/earth-sentinel-backend:v[VERSAO_ANTERIOR]
docker compose -f docker-compose.prod.yml up -d backend

# Verificar
curl https://earth-sentinel.app/api/health
```

Rollback de migration: nunca reverter migration — criar migration de correção.

---

## Critérios de Conclusão

- [ ] Tag `v[x.y.z]` criada e pushed
- [ ] Imagens Docker publicadas no registry
- [ ] Health check de produção retorna `{ "status": "ok" }`
- [ ] Nenhum `slog.Error` nos primeiros 5 minutos de operação
- [ ] Release notes criadas (via `gh release create`)
