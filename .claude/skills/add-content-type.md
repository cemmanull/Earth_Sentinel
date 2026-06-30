# Skill: Adicionar Novo Tipo de Conteúdo

Use este guia para registrar um novo tipo de dado dentro de um tema existente.
Um tipo de conteúdo (`type`) é uma string que classifica o `ContentItem` dentro do tema.

> Exemplos: `earthquake`, `article`, `price_alert`, `security_advisory`, `power_outage`.
> Esta skill funciona para qualquer tema — não é específica de eventos, notícias ou finanças.

## Quando usar esta skill

- Você está adicionando suporte a um novo tipo de dado de um provider existente.
- O novo provider retorna um tipo de dado que não está mapeado em `ContentTypeMeta`.
- Você precisa que o mapa/globo exiba um ícone específico para o novo tipo.

Se você está adicionando uma **fonte nova inteira**, use `.claude/skills/add-provider.md`.
Se você está adicionando um **tema inteiro novo**, use `.claude/skills/add-topic.md`.

---

## Passo 1 — Definir o tipo no domínio (Go)

```go
// backend/internal/domain/content_types.go
// (ou no arquivo de constantes do tema específico)

const (
    // Adicionar a constante do tipo
    TypeMeuTipo = "meu_tipo"   // snake_case, único globalmente
)
```

---

## Passo 2 — Registrar metadados no frontend

O frontend usa `ContentTypeMeta` para saber como exibir o tipo no mapa e nos painéis.

```javascript
// public/js/shared/content-type-meta.js

export const CONTENT_TYPE_META = {
  // tipos existentes...

  meu_tipo: {
    icon:     '🔬',        // emoji exibido no mapa (zoom ≥ 3)
    color:    '#88ddff',   // cor do círculo no mapa (zoom < 3) + cor do badge
    label:    'Meu Tipo',  // label em pt-BR (exibido nos painéis)
    category: 'minha-categoria',  // usado para agrupar no painel de legenda
  },
}
```

**Convenção de cores por severidade padrão:**
```
#00ff88 — severity 1 (baixo, verde)
#88ddff — severity 2 (moderado, azul claro)
#ffcc00 — severity 3 (alto, amarelo)
#ff6600 — severity 4 (crítico, laranja)
#ff2244 — severity 5 (extremo, vermelho)
```

---

## Passo 3 — Registrar ciclo de vida (apenas temas com decay)

Apenas para temas que gerenciam expiração automática por tipo (ex: `extreme-events`):

```go
// backend/internal/theme/[tema]/domain/lifecycle.go

var ContentLifespan = map[string][2]float64{
    // [halfLifeH, maxAgeH]
    "meu_tipo": {24, 168},  // meia-vida 24h, expiração 7 dias
}
```

Se o tipo não aparece no mapa após o `maxAgeH`, está funcionando corretamente.

**Para temas sem decay** (news, finance), não há `ContentLifespan` — o ciclo de vida é gerenciado por `published_at` e paginação.

---

## Passo 4 — Mapear no provider

O provider que gera este tipo deve retornar `ContentItem.Type = "meu_tipo"`:

```go
// backend/internal/theme/[tema]/sources/[provider].go

func MapMeuTipo(rawCategory string) string {
    switch rawCategory {
    case "CATEGORY_A", "CATEGORY_B": return "meu_tipo"
    default:                          return "unknown"
    }
}
```

A função de mapeamento deve ser **exportada** (inicial maiúscula) para ser testável.

---

## Passo 5 — Testes

```go
// backend/internal/theme/[tema]/sources/[provider]_test.go

func TestMapMeuTipo(t *testing.T) {
    if MapMeuTipo("CATEGORY_A") != "meu_tipo" { t.Error("mapping failed") }
    if MapMeuTipo("UNKNOWN")    != "unknown"  { t.Error("no fallback") }
}
```

```javascript
// tests/unit/shared/content-type-meta.test.js

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CONTENT_TYPE_META } from '../../../public/js/shared/content-type-meta.js'

describe('CONTENT_TYPE_META', () => {
  it('meu_tipo tem icon, color, label e category', () => {
    const m = CONTENT_TYPE_META['meu_tipo']
    assert.ok(m?.icon)
    assert.ok(m?.color)
    assert.ok(m?.label)
    assert.ok(m?.category)
  })
})
```

---

## Checklist de Qualidade

- [ ] `type` está em `snake_case`
- [ ] Constante Go definida em `domain/content_types.go` (ou no pacote do tema)
- [ ] `CONTENT_TYPE_META` tem icon, color, label, category
- [ ] Mapeamento no provider exportado e testado
- [ ] Se o tema usa lifecycle: entrada adicionada em `ContentLifespan`
- [ ] Remoção do tipo = remove a constante, a entrada em `CONTENT_TYPE_META` e o mapeamento. Zero resíduos em outras camadas?

---

## Tipos sem ícone no mapa

Se um tipo não tem entrada em `CONTENT_TYPE_META`, o comportamento é:
- Mapa/globo: marcador com ícone fallback `⚠️` e cor `#888888`
- Painel: label substituta `"Desconhecido"`
- Nenhum erro — comportamento degradado gracioso
