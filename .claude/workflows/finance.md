# Workflow: Finance

## Objetivo

Implementar o tema `finance` com dados de mercado financeiro via Alpha Vantage
e Stooq, respeitando rate limits estritos, sem visualização geográfica.

**Pré-condição:** `.claude/workflows/infrastructure.md` concluído.
Pode rodar em paralelo com `weather.md` e `news.md`.

---

## Agentes Envolvidos

| Agente | Papel neste workflow |
|--------|----------------------|
| Tech Lead | Coordena; define lista de símbolos e rate limit strategy |
| Data Ingestion Engineer | AlphaVantageSource + StooqSource |
| Backend Engineer | FinanceTheme struct, handler |
| Frontend Engineer | finance-panel Web Component, CSS |
| Database Engineer | Migration + índice por símbolo |
| QA Engineer | Testes unitários + integração |

---

## Grafo de Tarefas

```
PARALELO — Fase 1:
  [A] Data Ingestion   → AlphaVantageSource (com Redis rate limiter)
  [B] Data Ingestion   → StooqSource (sem auth, sem rate limit)
  [C] Backend Eng.     → FinanceTheme struct
  [D] Database Eng.    → migration + índice por symbol
  [E] Frontend Eng.    → finance-panel Web Component + CSS

PARALELO — Fase 2 (depende de A + B + C):
  [F] Backend Eng.     → registrar Sources no FinanceTheme
  [G] QA Engineer      → testes unitários A + B (incluindo rate limit)

SEQUENCIAL — Fase 3:
  [H] QA Engineer      → smoke test
  [I] Tech Lead        → validação final
```

---

## Fase 1A — AlphaVantageSource

```
Endpoint: https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=X
Auth: ALPHA_VANTAGE_KEY
Rate limit: 5 req/min (crítico — usar Redis sliding window)
Interval: 1min (mas processar apenas N símbolos por ciclo conforme rate limit)

Tipos ContentItem produzidos: price_update
  id = "alpha-vantage-" + symbol + "-" + tradingDay
  geo = nil
  severity = nil
  confidence = nil
  metadata: { symbol, price, change_percent, volume, trading_day }
```

### Rate Limiting — OBRIGATÓRIO

```go
func (s *AlphaVantageSource) Fetch(ctx context.Context) ([]domain.ContentItem, error) {
    for _, symbol := range s.symbols {
        // Verificar ANTES de cada request
        if !s.rateLimiter.Allow(ctx, "alpha-vantage", 5, 60*time.Second) {
            slog.Warn("alpha-vantage rate limit reached",
                "processed", len(items), "total", len(s.symbols))
            break
        }
        item, err := s.fetchSymbol(ctx, symbol)
        if err != nil {
            slog.Warn("alpha-vantage symbol failed", "symbol", symbol, "error", err)
            continue
        }
        items = append(items, item)
    }
    return items, nil
}
```

Função exportada:
```go
AlphaVantageQuoteToItem(q AlphaVantageQuote, symbol string) (ContentItem, error)
```

---

## Fase 1B — StooqSource

```
Endpoint: https://stooq.com/q/l/?s=[SYMBOL]&f=sd2t2ohlcv&h&e=csv
Auth: nenhuma
Rate limit: sem limite formal — usar interval de 5min e 1 req/símbolo
Interval: 5min

Tipos ContentItem produzidos: price_update
  id = "stooq-" + symbol + "-" + date
  Formato de resposta: CSV (sem JSON)
  geo = nil, severity = nil, confidence = nil
```

Função exportada:
```go
StooqCSVRowToItem(row []string, symbol string) (ContentItem, error)
```

---

## Fase 1C — FinanceTheme Struct

```go
// backend/internal/theme/finance/theme.go
// Score() retorna 0 — finanças não têm score de risco
// Configuração de símbolos via variável de ambiente ou config file

var defaultSymbols = []string{
    "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA",  // US tech
    "IBOV.SA", "VALE3.SA", "PETR4.SA",          // Brasil
    "^GSPC", "^DJI", "^IXIC",                   // Índices US
    "BTC-USD", "ETH-USD",                         // Crypto
    "GC=F", "CL=F",                              // Commodities: ouro, petróleo
}
```

---

## Fase 1D — Database Engineer

```sql
-- backend/migrations/00N_add_finance.sql
INSERT INTO themes (id, label) VALUES ('finance', 'Mercado Financeiro')
ON CONFLICT DO NOTHING;

-- Índice para buscar cotações por símbolo
CREATE INDEX IF NOT EXISTS idx_finance_symbol
    ON content_items ((metadata->>'symbol'), published_at DESC)
    WHERE theme_id = 'finance';
```

---

## Fase 1E — Frontend Engineer

```
public/js/themes/finance/
├── index.js              ← { id: 'finance', hasGeoView: false }
└── components/
    └── finance-panel.js  ← tabela de cotações, variação %, sparklines simples

public/css/themes/finance.css
```

CONTENT_TYPE_META:
```javascript
price_update:       { icon: '📈', color: '#00ff88', label: 'Cotação',    category: 'mercado' }
price_alert:        { icon: '🚨', color: '#ff6600', label: 'Alerta',     category: 'mercado' }
economic_indicator: { icon: '📊', color: '#88ddff', label: 'Indicador', category: 'mercado' }
```

---

## Testes de Rate Limit (QA)

```go
func TestAlphaVantageRateLimit_StopsAfter5(t *testing.T) {
    // Mock rate limiter que retorna false após 5 chamadas
    // Verificar que o Source para de processar símbolos ao atingir o limite
    // Verificar que retorna os items processados antes do limite (não vazio)
}

func TestAlphaVantageRateLimit_LogsWarning(t *testing.T) {
    // Verificar que slog.Warn é chamado quando o rate limit é atingido
}
```

---

## Atenção: Chave de API Alpha Vantage

- `ALPHA_VANTAGE_KEY` em variável de ambiente do Go backend
- Nunca expor em logs, frontend ou `public/`
- Se a chave não estiver configurada: `AlphaVantageSource.Fetch()` retorna `nil, nil` com `slog.Warn`
- Rate limit aplica-se ao servidor inteiro (não por usuário) — o Redis limiter garante isso

---

## Critérios de Conclusão

- [ ] `GET /api/themes/finance/feed` retorna cotações de Alpha Vantage e Stooq
- [ ] Rate limit de 5 req/min respeitado — testado explicitamente
- [ ] Nenhuma cotação tem `geo` preenchido
- [ ] IDs estáveis: `alpha-vantage-[SYMBOL]-[tradingDay]`
- [ ] Frontend exibe tabela de cotações sem mapa (hasGeoView: false)
- [ ] `go test ./internal/theme/finance/...` passa
- [ ] QA relatório: APROVADO
