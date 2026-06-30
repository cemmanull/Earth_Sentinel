# Agente: Geo Visualization Engineer

## Função

Especialista nas camadas de visualização geográfica da plataforma: `map.js` (Canvas 2D
Web Mercator), `globe.js` (Three.js 3D), tiles NASA GIBS, marcadores de `ContentItem`
com coordenadas e interação touch/mouse.

> **Contexto:** As visualizações geo são compartilhadas entre temas.
> Qualquer tema com `hasGeoView: true` usa o mesmo mapa e globo.
> Os módulos `map.js` e `globe.js` são autônomos — sem imports de outros módulos do projeto.

---

## map.js — WorldMap Canvas 2D

### Classe WorldMap

```javascript
new WorldMap(container)      // container: HTMLElement
```

### API Pública

```javascript
init()                             // cria canvas, binds de eventos, inicia loop RAF

// Marcadores
addEventMarker(item, icon, color)  // item: ContentItem com .geo, icon: emoji, color: '#rrggbb'
clearMarkers()                     // remove todos os marcadores

// Camadas GIBS
setLayer(name, enabled)            // ativa/desativa overlay de tile

// Navegação
getZoom()                          // float, padrão 1.0
getBounds()                        // { latMin, latMax, lngMin, lngMax }
getCenter()                        // { lat, lng }
focusOn(lat, lng, zoomHint?)       // centraliza e opcionalmente aumenta zoom
setUserLocation(lat, lng)          // marcador especial do usuário

destroy()                          // cancela RAF, remove canvas, limpa tile cache

// Callbacks (atribuídos por app.js)
worldMap.onClickCallback      = ({ type, lat, lng, item }) => ...
worldMap.onViewChangeCallback = ({ zoom, bounds }) => ...
```

### Projeção Web Mercator

```javascript
// Geográfico → normalizado [0,1]
mercX(lng) = (lng + 180) / 360
mercY(lat) = 0.5 - log(tan(π/4 + lat·π/180·0.5)) / (2π)

// Normalizado → pixel no canvas
toCanvas(nx, ny):
  scale = width × zoom
  x = width/2  + (nx - 0.5) × scale + offsetX
  y = height/2 + (ny - 0.5) × scale + offsetY
  // ⚠ usa width como referência para AMBOS os eixos (proporção Mercator)

// Limites: lat > 85° e lat < -85° bloqueados (mercY → 0 ou 1)
```

### Marcadores

```javascript
// Zoom < 3: círculo colorido por severidade
SEV_COLORS = ['', '#00ff88', '#88ddff', '#ffcc00', '#ff6600', '#ff2244']
// (severity 1=verde … 5=vermelho)

// Zoom ≥ 3: emoji + hitbox expandida
fontSize = Math.min(32, Math.round(12 + (zoom - 3) × 5))

// Halo pulsante: Math.abs(sin(ts × 0.001)) × (1 + severity × 0.6)

// Item sem severity: circle com cor padrão '#888888'
```

---

## globe.js — Globe Three.js

### Classe Globe

```javascript
new Globe(canvas)     // canvas: HTMLCanvasElement
```

### API Pública

```javascript
// Marcadores
addMarker(lat, lng, colorHex, icon, severity, scaleMul)
// colorHex: número inteiro 0xRRGGBB
// scaleMul: 0.45 para alertas menores, 1.0 para eventos principais
clearMarkers()

// Camadas
setLayer(name, enabled)
setRealistic(enabled)         // textura de satélite na superfície

// Navegação
setUserLocation(lat, lng)
focusOn(lat, lng)             // anima a câmera para o ponto

// Callback
globe.onClickCallback = ({ lat, lng }) => ...
```

---

## Tiles NASA GIBS

### Definição de camada

```javascript
// Em GIBS_LAYERS dentro de map.js:
{
  fires: {
    layer:   'VIIRS_SNPP_Fires_All',
    tms:     'GoogleMapsCompatible_Level8',
    maxZ:    8,
    minZ:    3,
    opacity: 0.85,
    daysAgo: 2,
  },
  temperature: {
    layer:   'MODIS_Terra_Land_Surface_Temp_Day',
    maxZ:    7, opacity: 0.65, daysAgo: 2,
  },
  // ...
}
```

### URL de tile

```
https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/
  {layer}/default/{YYYY-MM-DD}/{TileMatrixSet}/{z}/{y}/{x}.png

z = floor(log2(width × zoom / 256))   clampado a [minZ, maxZ]
y = tile row (Y=0 no norte — convenção Google/XYZ)
x = tile column
```

### Cache de tiles

- `Map<key, HTMLImageElement|null>`
- `key = '<layerKey>|<date>|<z>|<ty>|<tx>'`
- `null` = erro de carga (não retentar na sessão)
- Evicção FIFO: ao atingir 600 entradas, remove 100 mais antigas

### Adicionando nova camada GIBS

1. Adicionar entrada em `GIBS_LAYERS` em `map.js`
2. Adicionar toggle em `index.html`:
```html
<button class="layer-toggle" data-layer="nomeCamada">Nome Visível</button>
```
3. Adicionar cor do dot em `panels.css`:
```css
.layer-dot.nomeCamada { background: #hex-cor; }
```

---

## Integrando ContentItem com o Mapa

O mapa aceita qualquer `ContentItem` que tenha `geo != null`:

```javascript
// Em app.js — ao receber items do tema ativo
function renderItemsOnMap(items) {
  worldMap.clearMarkers()
  for (const item of items) {
    if (!item.geo) continue                      // item sem geo → skip

    const meta = getItemMeta(item.type)          // icon + color por tipo
    worldMap.addEventMarker(
      {
        latitude:  item.geo.lat,
        longitude: item.geo.lng,
        radiusKm:  item.geo.radius_km,
        severity:  item.severity ?? 1,
      },
      meta.icon,
      meta.color,
    )
  }
}
```

O `WorldMap.addEventMarker` aceita qualquer objeto com `latitude`, `longitude`,
`radiusKm`, `severity` — não precisa ser um `GlobalEvent` completo.

---

## Camadas CSS (z-index)

```
9999  #loader
 200  #toasts
 100  #header
  95  .risk-panel / .detail-panel
  90  .side-panel
   0  #map-container (canvas 2D)
   0  #globe-canvas (canvas 3D)
```

---

## Diagnóstico

### Mapa preto / sem continentes

1. `window.topojson` carregado? `window.topojson?.feature` no console
2. CDN jsDelivr acessível? Verificar Network tab
3. `_loadWorldData()` silenciou erro? Ver `console.warn` no DevTools

### Tiles GIBS não aparecem

1. Network tab → filtrar `.png` → tiles retornando 400?
2. `maxZ` muito alto para a camada? Testar com `maxZ: 4`
3. `daysAgo: 2` — NRT pode ter 1-3 dias de lag

### Marcadores no lugar errado

1. `item.geo.lat` e `item.geo.lng` em WGS84?
2. GeoJSON usa `[lng, lat]` — verificar se ingestor não inverteu
3. Coordenadas `0,0` indicam bug de ingestão — nunca são válidas para eventos reais

### Clique não detecta item

1. `hitR` pequeno em zoom baixo (14px) — clicar exatamente sobre o marcador
2. Marcador fora da viewport? `_drawMarkers` ignora marcadores com margem de 40px
3. `onClickCallback` atribuído em `app.js`?

### Performance / FPS baixo

1. Muitos marcadores (>200)? Considerar clustering por nível de zoom
2. Tile cache cheio? Verificar limite em `_evictTiles()`
3. `devicePixelRatio` alto? Canvas em alta DPI tem mais pixels para renderizar

---

## Projeção — Limites e Edge Cases

```javascript
// Antimeridianos (±180°): _traceRing detecta salto de >170° de lng
// e usa moveTo() em vez de lineTo() para não desenhar linha através do mapa

// Zoom mínimo: 0.7 (mapa inteiro visível)
// Zoom máximo: 14 (nível de rua)

// Marcador polar: lat > 85° ou lat < -85°
// mercY retorna 0 ou 1 → marcador aparece no topo ou base do canvas
```
