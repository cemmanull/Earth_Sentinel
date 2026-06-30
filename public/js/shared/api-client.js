// api-client.js — cliente HTTP para o backend Go (via proxy /api do Node.js).
// O browser NUNCA chama APIs externas: toda ingestão acontece no backend.
//
// O backend serve o modelo canônico ContentItem (snake_case, geo aninhado).
// map.js / globe.js / events.js consomem o modelo legado "event" (camelCase, lat/lng
// no topo). `contentItemToEvent` é o adapter puro entre os dois — assim a camada de
// visualização permanece intacta.

// ── Adapter (função pura, testável) ─────────────────────────────────────────

// contentItemToEvent converte um ContentItem do backend no shape "event" que
// map.js, globe.js e events.js esperam. Itens sem geo resultam em lat/lng
// undefined — o chamador deve filtrar (a camada de mapa ignora marcadores sem coords).
export function contentItemToEvent(item) {
  const geo = item.geo ?? null
  return {
    id:          item.id,
    type:        item.type,
    severity:    item.severity ?? 1,
    confidence:  item.confidence ?? undefined,
    latitude:    geo ? geo.lat : undefined,
    longitude:   geo ? geo.lng : undefined,
    radiusKm:    geo ? geo.radius_km : 300,
    startTime:   new Date(item.published_at),
    endTime:     item.expires_at ? new Date(item.expires_at) : undefined,
    source:      item.source_id,
    title:       item.title ?? '',
    description: item.description ?? '',
    metadata:    item.metadata ?? {},
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────

async function fetchJSON(url, { timeoutMs = 20_000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`)
  return res.json()
}

// getThemes lista os temas disponíveis no backend.
// → [{ id, label, has_geo_view }]
export async function getThemes() {
  return fetchJSON('/api/themes')
}

// getThemeFeed retorna o feed bruto (ContentItem[]) de um tema.
// `params` aceita { limit, since, type } e vira query string.
export async function getThemeFeed(themeID, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  ).toString()
  const url = `/api/themes/${encodeURIComponent(themeID)}/feed${qs ? `?${qs}` : ''}`
  return fetchJSON(url)
}

// getThemeEvents retorna o feed já adaptado para o shape "event" da camada de mapa.
export async function getThemeEvents(themeID, params = {}) {
  const items = await getThemeFeed(themeID, params)
  return (Array.isArray(items) ? items : []).map(contentItemToEvent)
}
