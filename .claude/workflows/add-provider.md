# Workflow: Add Provider

## Objetivo

Adicionar uma nova fonte de dados (Provider / Source) a qualquer tema existente
de forma isolada, sem afetar outros temas ou providers.

**Pré-condição:** O tema alvo já existe no `ThemeRegistry` Go e frontend.

---

## Agentes Envolvidos

| Agente | Papel neste workflow |
|--------|----------------------|
| Tech Lead | Coordena, define escopo, valida |
| Data Ingestion Engineer | Implementa `Source.Fetch` + normalização |
| Database Engineer | Migration SQL (se novo tipo de conteúdo) |
| QA Engineer | Testes unitários + mock HTTP |

---

## Entrada Necessária (Tech Lead define antes de delegar)

```
- Nome do provider: [nome]           ex: "openaq"
- Tema alvo: [tema]                  ex: "extreme-events"
- Endpoint base: [url]               ex: "https://api.openaq.gov/v3"
- Autenticação: [sim/não + variável] ex: "sim, OPENAQ_API_KEY"
- Rate limit: [N req / janela]       ex: "60 req/min"
- Intervalo de ingestão: [dur]       ex: "30min"
- Tipos de ContentItem produzidos:   ex: ["air_pollution"]
- Geo disponível? [sim/não]          ex: "sim, lat/lng por ponto de medição"
```

---

## Grafo de Tarefas

```
PARALELO — Fase 1 (sem dependências):
  [A] Data Ingestion Engineer → Source.Fetch + normalização
  [B] Database Engineer       → migration (se novo tipo de ContentItem)
  [C] QA Engineer             → criar fixtures da resposta real da API

SEQUENCIAL — Fase 2 (depende de A):
  [D] Data Ingestion Engineer → registrar Source em theme.Sources()
  [E] QA Engineer             → testes unitários + mock HTTP usando fixtures de C

SEQUENCIAL — Fase 3 (depende de D + E):
  [F] Tech Lead               → validar contrato ContentItem + aprovar
```

---

## Fase 1A — Data Ingestion Engineer

Consultar `.claude/skills/add-provider.md` para template completo.

Obrigatório antes de implementar:
1. Ler amostra real da API em `.claude/API/` (se existir)
2. Salvar nova amostra em `.claude/API/[nome].json` ao implementar
3. Seguir template de `Source` com construtor `WithURL` para testes

```
backend/internal/theme/[tema]/sources/[nome].go

Funções obrigatoriamente exportadas (testáveis sem I/O):
  [Nome]ItemToContent(raw) (ContentItem, error)
  Map[Nome]Type(category string) string
  Map[Nome]Severity(level string) int   ← se o provider tem severidade
```

---

## Fase 1B — Database Engineer

Apenas se o provider produz um `ContentItem.type` novo:

```sql
-- backend/migrations/00N_add_[nome]_type.sql
-- Geralmente apenas comentário/documentação — o tipo fica em código Go
-- Migration necessária se houver tabela de tipos ou enums no banco
```

Se o provider produz apenas tipos já existentes → fase 1B é no-op.

---

## Fase 1C — QA Engineer

Salvar fixture da resposta real para usar nos testes:

```go
// backend/internal/theme/[tema]/sources/testdata/[nome]_response.json
// Copiar amostra real da API (sanitizada de dados sensíveis)
```

---

## Fase 2D — Data Ingestion Engineer: Registro

```go
// backend/internal/theme/[tema]/theme.go

func (t *[Tema]Theme) Sources() []domain.Source {
    return []domain.Source{
        // providers existentes...
        sources.New[Nome](),   // ← adicionar aqui
    }
}
```

---

## Fase 2E — QA Engineer: Testes

Criar todos os testes do checklist em `.claude/agents/qa-engineer.md`:

```
Test[Nome]ToContentItem_ValidInput
Test[Nome]ToContentItem_MissingID
Test[Nome]ToContentItem_IDStability
Test[Nome]ToContentItem_TruncatesTitle
Test[Nome]Fetch_Success
Test[Nome]Fetch_HTTP503
Test[Nome]Fetch_Timeout
```

---

## Fase 3F — Tech Lead: Validação Final

Checklist obrigatório:

- [ ] `go test ./internal/theme/[tema]/sources/...` passa
- [ ] `ContentItem.id` é estável (verificado em `Test[Nome]ToContentItem_IDStability`)
- [ ] `ContentItem.geo` é `nil` quando a API não retorna coordenadas confiáveis
- [ ] Nenhuma coordenada `{0,0}` nos fixtures
- [ ] `Source.ID()` retorna kebab-case único — não colide com outros providers
- [ ] `Source.ThemeID()` corresponde ao tema correto
- [ ] Chave de API em `os.Getenv`, nunca hardcoded
- [ ] `.claude/API/[nome].json` existe com amostra real

---

## Critérios de Conclusão

- [ ] `go test ./...` passa sem falha
- [ ] Provider aparece em `GET /api/sources/status`
- [ ] Feed do tema inclui itens do novo provider após 1 ciclo de ingestão
- [ ] Nenhuma regressão em providers existentes do mesmo tema
