/**
 * WorldMap — projeção de Mercator 2D via Canvas API
 * Substitui o globo Three.js por um mapa interativo leve, sem dependências de bundler.
 *
 * Dados geográficos: world-atlas@2 via jsDelivr (TopoJSON 110m)
 * Camadas satélite:  NASA GIBS WMTS/XYZ (EPSG:3857)
 * Decodificador:     topojson-client@3 via jsDelivr (window.topojson, carregado em index.html)
 *
 * GIBS XYZ tile URL:
 *   https://gibs.earthdata.nasa.gov/wmts/epsg3857/best
 *   /{layer}/default/{YYYY-MM-DD}/{TileMatrixSet}/{z}/{y}/{x}.png
 *
 * Convenção de coordenadas: Y=0 no norte (Google/XYZ), igual ao Web Mercator padrão.
 */

const WORLD_TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'
const GIBS_BASE      = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'

/**
 * Definição das camadas GIBS disponíveis.
 * layer:   identificador GIBS
 * tms:     TileMatrixSet (define o zoom máximo suportado pela camada)
 * maxZ:    zoom máximo de tile a solicitar
 * opacity: opacidade no canvas (0–1)
 * daysAgo: quantos dias atrás buscar (NRT = 1, produtos diários = 2)
 */
const GIBS_LAYERS = {
  satellite: {
    layer:   'BlueMarble_ShadedRelief_Bathymetry',
    tms:     'GoogleMapsCompatible_Level8',
    maxZ:    8,
    opacity: 1.0,
    date:    '2004-09-01',  // composição mensal fixa — sem núvens
    ext:     'jpg',
  },
  fires: {
    layer:   'VIIRS_SNPP_Fires_All',
    tms:     'GoogleMapsCompatible_Level8',
    maxZ:    8,
    minZ:    3,   // tiles abaixo de zoom 3 retornam 400 (layer esparsa)
    opacity: 0.85,
    daysAgo: 2,   // NRT VIIRS tem ~24h de lag; dia -2 garante dados completos
  },
  temperature: {
    layer:   'MODIS_Terra_Land_Surface_Temp_Day',
    tms:     'GoogleMapsCompatible_Level7',
    maxZ:    7,
    opacity: 0.65,
    daysAgo: 2,
  },
  clouds: {
    layer:   'MODIS_Terra_Cloud_Top_Pressure_Day',
    tms:     'GoogleMapsCompatible_Level6',
    maxZ:    6,
    opacity: 0.5,
    daysAgo: 2,
  },
  aerosols: {
    layer:   'MODIS_Terra_Aerosol',
    tms:     'GoogleMapsCompatible_Level6',
    maxZ:    6,
    opacity: 0.7,
    daysAgo: 2,
  },
  dust: {
    layer:   'MODIS_Terra_Aerosol',
    tms:     'GoogleMapsCompatible_Level6',
    maxZ:    6,
    opacity: 0.55,
    daysAgo: 2,
  },
}

// Fallback por severidade — espelha a escala dos tokens --sev-* (base.css) em
// versões dual-mode: cada cor tem contraste ≥ 3:1 sobre os oceanos claro (#f7fdfd)
// e escuro (#0a1010). sev-1 neutro · sev-2 info · sev-3 warn · sev-4 hi · sev-5 crit.
const SEV_COLOR = ['', '#767f7f', '#528ac4', '#a77e39', '#fa0013', '#d4434f']

/**
 * Cartografia clara — valores derivados da paleta Aegis Sentinel (DESIGN.md).
 * background #f7fdfd · muted #e0e8e8 · primary #00575c · focus #0d9297 · foreground #020202
 */
const PALETTE_LIGHT = {
  ocean:         '#f7fdfd',                // background — mapa contínuo com a UI
  land:          '#dde6e3',                // terra base — neutro esverdeado derivado de muted
  country:       '#e0e8e8',                // muted — preenchimento de países
  border:        'rgba(2,2,2,0.18)',       // fronteiras — foreground em alpha baixo
  graticule:     'rgba(2,2,2,0.05)',       // grade lat/lng — foreground em alpha mínimo
  equator:       'rgba(0,87,92,0.16)',     // equador — primary em alpha baixo
  loadingText:   'rgba(2,2,2,0.45)',       // hint "Carregando mapa…"
  markerOutline: 'rgba(2,2,2,0.25)',       // contorno de dots sobre fundo claro
  user:          '#0d9297',                // focus — marcador do usuário
  userHalo:      'rgba(13,146,151,0.45)',  // halo pulsante do usuário (focus)
  userHaloEnd:   'rgba(13,146,151,0)',
  userOutline:   'rgba(252,252,252,0.95)', // on-primary — anel de separação do dot
}

/**
 * Cartografia escura — valores do DESIGN.md (Dark Mode Variant).
 * background #0a1010 · muted #1a2626 · foreground #f2f8f8 · focus #0d9297
 */
const PALETTE_DARK = {
  ocean:         '#0a1010',                  // background dark — mapa contínuo com a UI
  land:          '#1f2b28',                  // terra base — muted com leve viés verde
  country:       '#1a2626',                  // muted dark — preenchimento de países
  border:        'rgba(242,248,248,0.18)',   // fronteiras — foreground em alpha baixo
  graticule:     'rgba(242,248,248,0.05)',   // grade lat/lng — foreground em alpha mínimo
  equator:       'rgba(13,146,151,0.16)',    // equador — teal focus (primary é ilegível no escuro)
  loadingText:   'rgba(242,248,248,0.45)',   // hint "Carregando mapa…"
  markerOutline: 'rgba(242,248,248,0.30)',   // contorno de dots sobre fundo escuro
  user:          '#0d9297',                  // focus — marcador do usuário
  userHalo:      'rgba(13,146,151,0.45)',    // halo pulsante do usuário (focus)
  userHaloEnd:   'rgba(13,146,151,0)',
  userOutline:   'rgba(252,252,252,0.95)',   // on-primary — anel de separação do dot
}

export class WorldMap {
  constructor(container) {
    this._container    = container
    this._palette      = PALETTE_LIGHT
    this._canvas       = null
    this._ctx          = null
    this._land         = null
    this._countries    = null
    this._borders      = null
    this._markers      = []
    this._userPos      = null   // { lat, lng } | null
    this._zoom         = 1.0
    this._offsetX      = 0
    this._offsetY      = 0
    this._width        = 0
    this._height       = 0
    this._raf          = null
    this._phase        = 0
    this._activeLayers = new Set()
    this._tileCache    = new Map()  // key → HTMLImageElement | null (error)
    this.onClickCallback      = null
    this.onViewChangeCallback = null   // ({zoom, bounds}) → void
    this._viewChangeTimer     = null
  }

  init() {
    this._canvas = document.createElement('canvas')
    Object.assign(this._canvas.style, { display: 'block', width: '100%', height: '100%', cursor: 'crosshair' })
    this._container.appendChild(this._canvas)

    this._resize()
    window.addEventListener('resize', () => this._resize())
    this._bindEvents()

    const loop = (ts) => {
      this._phase = (ts * 0.001) % (Math.PI * 2)
      this._draw()
      this._raf = requestAnimationFrame(loop)
    }
    this._raf = requestAnimationFrame(loop)

    // Topology carrega async; render loop já funciona antes com placeholder
    this._loadWorldData()
  }

  // ── Dados geográficos ──────────────────────────────────────────────────────

  async _loadWorldData() {
    try {
      const res = await fetch(WORLD_TOPO_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const topo = await res.json()
      const tc = window.topojson
      if (!tc) throw new Error('topojson-client não carregado')
      this._land      = tc.feature(topo, topo.objects.land)
      this._countries = tc.feature(topo, topo.objects.countries)
      this._borders   = tc.mesh(topo, topo.objects.countries, (a, b) => a !== b)
    } catch (err) {
      console.warn('[WorldMap] Dados geográficos indisponíveis:', err.message)
    }
  }

  // ── Projeção ───────────────────────────────────────────────────────────────

  _mercX(lng) {
    return (lng + 180) / 360
  }

  _mercY(lat) {
    if (lat >=  85) return 0
    if (lat <= -85) return 1
    const r = Math.PI / 180
    return 0.5 - Math.log(Math.tan(Math.PI / 4 + lat * r / 2)) / (2 * Math.PI)
  }

  /**
   * Coordenadas normalizadas [0,1] → pixel no canvas.
   * Usa this._width como referência para AMBOS os eixos, garantindo
   * proporção correta da projeção em qualquer aspect ratio de tela.
   */
  _toCanvas(nx, ny) {
    const scale = this._width * this._zoom
    return {
      x: this._width  / 2 + (nx - 0.5) * scale + this._offsetX,
      y: this._height / 2 + (ny - 0.5) * scale + this._offsetY,
    }
  }

  _project(lat, lng) {
    return this._toCanvas(this._mercX(lng), this._mercY(lat))
  }

  _unproject(px, py) {
    const scale = this._width * this._zoom
    const nx    = (px - this._width  / 2 - this._offsetX) / scale + 0.5
    const ny    = (py - this._height / 2 - this._offsetY) / scale + 0.5
    const lng   = nx * 360 - 180
    const mercN = (0.5 - ny) * 2 * Math.PI
    const lat   = (2 * Math.atan(Math.exp(mercN)) - Math.PI / 2) * (180 / Math.PI)
    return { lat, lng }
  }

  // ── Desenho ────────────────────────────────────────────────────────────────

  _resize() {
    const r = this._container.getBoundingClientRect()
    this._width  = r.width  || window.innerWidth
    this._height = r.height || window.innerHeight
    if (this._canvas) {
      this._canvas.width  = this._width
      this._canvas.height = this._height
      this._ctx = this._canvas.getContext('2d')
    }
  }

  _draw() {
    const { _ctx: ctx, _width: W, _height: H } = this
    if (!ctx) return

    // Ocean
    ctx.fillStyle = this._palette.ocean
    ctx.fillRect(0, 0, W, H)

    this._drawGrid(ctx)

    // Terra base (sem bordas)
    if (this._land) {
      this._drawFeature(ctx, this._land, this._palette.land, null)
    }
    if (this._countries) {
      for (const f of this._countries.features) {
        this._drawFeature(ctx, f, this._palette.country, null)
      }
    }

    // Camadas GIBS (sobre base, sob bordas e marcadores)
    this._drawTileLayers(ctx)

    // Bordas de países
    if (this._borders) {
      this._drawFeature(ctx, this._borders, null, this._palette.border, 0.5)
    }

    if (!this._land && !this._countries) {
      this._drawPlaceholder(ctx)
    }

    this._drawMarkers(ctx)
    this._drawUserMarker(ctx)
  }

  _drawGrid(ctx) {
    ctx.save()
    ctx.lineWidth = 0.5

    ctx.strokeStyle = this._palette.graticule
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath()
      let first = true
      for (let lng = -180; lng <= 180; lng += 4) {
        const p = this._project(lat, lng)
        first ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
        first = false
      }
      ctx.stroke()
    }
    for (let lng = -150; lng <= 180; lng += 30) {
      ctx.beginPath()
      let first = true
      for (let lat = -80; lat <= 80; lat += 4) {
        const p = this._project(lat, lng)
        first ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
        first = false
      }
      ctx.stroke()
    }

    // Equador em destaque
    ctx.strokeStyle = this._palette.equator
    ctx.lineWidth = 1
    ctx.beginPath()
    let first = true
    for (let lng = -180; lng <= 180; lng += 4) {
      const p = this._project(0, lng)
      first ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
      first = false
    }
    ctx.stroke()

    ctx.restore()
  }

  _drawFeature(ctx, feature, fillColor, strokeColor, lineWidth = 0.6) {
    const geom = feature.geometry || feature
    ctx.beginPath()
    this._traceGeometry(ctx, geom)
    if (fillColor)   { ctx.fillStyle = fillColor;     ctx.fill('evenodd') }
    if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.lineWidth = lineWidth; ctx.stroke() }
  }

  _traceGeometry(ctx, geom) {
    if (!geom) return
    switch (geom.type) {
      case 'Polygon':
        geom.coordinates.forEach((ring) => this._traceRing(ctx, ring))
        break
      case 'MultiPolygon':
        geom.coordinates.forEach((poly) => poly.forEach((ring) => this._traceRing(ctx, ring)))
        break
      case 'LineString':
        this._traceLine(ctx, geom.coordinates)
        break
      case 'MultiLineString':
        geom.coordinates.forEach((line) => this._traceLine(ctx, line))
        break
      case 'GeometryCollection':
        geom.geometries.forEach((g) => this._traceGeometry(ctx, g))
        break
    }
  }

  _traceRing(ctx, coords) {
    if (!coords.length) return
    let prevLng = null
    for (let i = 0; i < coords.length; i++) {
      const [lng, lat] = coords[i]
      const p = this._project(lat, lng)
      if (i === 0 || (prevLng !== null && Math.abs(lng - prevLng) > 170)) {
        ctx.moveTo(p.x, p.y)
      } else {
        ctx.lineTo(p.x, p.y)
      }
      prevLng = lng
    }
    ctx.closePath()
  }

  _traceLine(ctx, coords) {
    if (!coords.length) return
    let prevLng = null
    for (let i = 0; i < coords.length; i++) {
      const [lng, lat] = coords[i]
      const p = this._project(lat, lng)
      if (i === 0 || (prevLng !== null && Math.abs(lng - prevLng) > 170)) {
        ctx.moveTo(p.x, p.y)
      } else {
        ctx.lineTo(p.x, p.y)
      }
      prevLng = lng
    }
  }

  _drawPlaceholder(ctx) {
    ctx.save()
    ctx.fillStyle = this._palette.loadingText
    ctx.font = '13px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('Carregando mapa…', this._width / 2, this._height / 2)
    ctx.restore()
  }

  // ── Camadas GIBS (XYZ tiles) ───────────────────────────────────────────────

  /** Retorna data ISO como YYYY-MM-DD com offset de dias */
  _isoDate(daysAgo) {
    const d = new Date(Date.now() - daysAgo * 86_400_000)
    return d.toISOString().slice(0, 10)
  }

  /**
   * Calcula o zoom de tile mais adequado para o zoom de canvas atual.
   * Alvo: ~256 px de tela por tile (tamanho nativo GIBS).
   */
  _calcTileZoom() {
    const raw = Math.log2((this._width * this._zoom) / 256)
    return Math.max(0, Math.min(8, Math.floor(raw)))
  }

  /**
   * Retorna o intervalo de tiles visíveis [x0,x1] × [y0,y1] para o zoom Z.
   * Coordenadas: Y=0 no norte, igual à convenção Google/XYZ usada pelo GIBS.
   */
  _visibleTileRange(tileZ) {
    const n     = 1 << tileZ   // 2^z
    const scale = this._width * this._zoom
    const nx0   = (0            - this._width  / 2 - this._offsetX) / scale + 0.5
    const nx1   = (this._width  - this._width  / 2 - this._offsetX) / scale + 0.5
    const ny0   = (0            - this._height / 2 - this._offsetY) / scale + 0.5
    const ny1   = (this._height - this._height / 2 - this._offsetY) / scale + 0.5
    return {
      x0: Math.max(0, Math.floor(nx0 * n)),
      x1: Math.min(n - 1, Math.ceil(nx1 * n) - 1),
      y0: Math.max(0, Math.floor(ny0 * n)),
      y1: Math.min(n - 1, Math.ceil(ny1 * n) - 1),
    }
  }

  /**
   * Retorna (ou inicia o carregamento de) uma imagem de tile do cache.
   * Retorna null se o tile ainda não carregou ou resultou em erro.
   */
  _getTile(key, url) {
    const cached = this._tileCache.get(key)
    if (cached !== undefined) return cached   // null = erro; Image = ok/carregando

    // Evicção simples: remove 100 entradas quando cache ultrapassa 600
    if (this._tileCache.size >= 600) {
      let i = 0
      for (const k of this._tileCache.keys()) {
        this._tileCache.delete(k)
        if (++i >= 100) break
      }
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onerror = () => this._tileCache.set(key, null)
    img.src = url
    this._tileCache.set(key, img)
    return img
  }

  _drawTileLayers(ctx) {
    if (!this._activeLayers.size) return

    const viewZ = this._calcTileZoom()

    for (const layerKey of this._activeLayers) {
      const def = GIBS_LAYERS[layerKey]
      if (!def) continue

      const z        = Math.min(viewZ, def.maxZ)
      if (z < (def.minZ ?? 0)) continue
      const n        = 1 << z
      const tileSize = (this._width * this._zoom) / n
      const date     = def.date ?? this._isoDate(def.daysAgo ?? 0)
      const ext      = def.ext ?? 'png'
      const { x0, x1, y0, y1 } = this._visibleTileRange(z)

      ctx.save()
      ctx.globalAlpha = def.opacity

      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const key = `${layerKey}|${date}|${z}|${ty}|${tx}`
          const url = `${GIBS_BASE}/${def.layer}/default/${date}/${def.tms}/${z}/${ty}/${tx}.${ext}`
          const img = this._getTile(key, url)

          if (!img || !img.complete || img.naturalWidth === 0) continue

          const { x: cx, y: cy } = this._toCanvas(tx / n, ty / n)
          // +1px evita seams entre tiles adjacentes
          ctx.drawImage(img, Math.round(cx), Math.round(cy),
                        Math.ceil(tileSize) + 1, Math.ceil(tileSize) + 1)
        }
      }

      ctx.restore()
    }
  }

  // ── Marcadores ─────────────────────────────────────────────────────────────

  _drawMarkers(ctx) {
    const pulse    = Math.abs(Math.sin(this._phase))
    const useEmoji = this._zoom >= 3

    for (const { event, icon, color } of this._markers) {
      const { x, y } = this._project(event.latitude, event.longitude)
      if (x < -40 || x > this._width + 40 || y < -40 || y > this._height + 40) continue

      // Use passed type color; fall back to severity color
      const dotColor = color || SEV_COLOR[event.severity] || SEV_COLOR[1]
      // Avisos Open-Meteo (warning=true) usam pontos menores sem halo pulsante
      const isWarn = event.metadata?.warning === true
      const baseR  = isWarn
        ? 1.2 + (event.severity - 1) * 0.3   // sev1=1.2 … sev2=1.5 px
        : 3   + (event.severity - 1) * 0.9   // sev1=3   … sev5=6.6 px

      // Halo pulsante (suprimido para avisos)
      const haloR = baseR + (isWarn ? 1 : 2 + pulse * (1 + event.severity * 0.6))
      const grad  = ctx.createRadialGradient(x, y, baseR * 0.4, x, y, haloR + 2)
      grad.addColorStop(0, dotColor + (isWarn ? '22' : '40'))
      grad.addColorStop(1, dotColor + '00')
      ctx.beginPath()
      ctx.arc(x, y, haloR, 0, Math.PI * 2)
      ctx.fillStyle = grad
      ctx.fill()

      if (useEmoji && icon) {
        const fontSize = Math.min(32, Math.round(12 + (this._zoom - 3) * 5))
        ctx.font = `${fontSize}px serif`
        ctx.textAlign    = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(icon, x, y)
      } else {
        ctx.beginPath()
        ctx.arc(x, y, baseR, 0, Math.PI * 2)
        ctx.fillStyle   = dotColor
        ctx.fill()
        ctx.strokeStyle = this._palette.markerOutline
        ctx.lineWidth   = 0.8
        ctx.stroke()
      }
    }
  }

  // ── Marcador do usuário ────────────────────────────────────────────────────

  _drawUserMarker(ctx) {
    if (!this._userPos) return
    const { x, y } = this._project(this._userPos.lat, this._userPos.lng)
    if (x < -40 || x > this._width + 40 || y < -40 || y > this._height + 40) return

    const pulse    = Math.abs(Math.sin(this._phase))
    const useEmoji = this._zoom >= 3

    // Halo pulsante teal (focus)
    const haloR = 8 + pulse * 6
    const grad  = ctx.createRadialGradient(x, y, 3, x, y, haloR + 2)
    grad.addColorStop(0, this._palette.userHalo)
    grad.addColorStop(1, this._palette.userHaloEnd)
    ctx.beginPath()
    ctx.arc(x, y, haloR, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()

    if (useEmoji) {
      const fontSize = Math.min(28, Math.round(14 + (this._zoom - 3) * 4))
      ctx.font = `${fontSize}px serif`
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText('🚩', x, y + fontSize * 0.15)
    } else {
      // Ponto teal sólido com anel claro de separação
      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fillStyle   = this._palette.user
      ctx.fill()
      ctx.strokeStyle = this._palette.userOutline
      ctx.lineWidth   = 1.5
      ctx.stroke()
    }
  }

  // ── Interação ──────────────────────────────────────────────────────────────

  _bindEvents() {
    const canvas = this._canvas
    let down = false, dragging = false
    let sx = 0, sy = 0, lx = 0, ly = 0

    canvas.addEventListener('mousedown', (e) => {
      down = true; dragging = false
      sx = lx = e.clientX
      sy = ly = e.clientY
    })

    canvas.addEventListener('mousemove', (e) => {
      if (!down) return
      if (Math.abs(e.clientX - sx) > 4 || Math.abs(e.clientY - sy) > 4) dragging = true
      if (dragging) { this._offsetX += e.clientX - lx; this._offsetY += e.clientY - ly }
      lx = e.clientX; ly = e.clientY
    })

    canvas.addEventListener('mouseup', (e) => {
      const wasDragging = dragging
      if (!dragging) this._handleClick(e.offsetX, e.offsetY)
      down = false; dragging = false
      if (wasDragging) this._scheduleViewChange()
    })

    canvas.addEventListener('mouseleave', () => { down = false; dragging = false })

    // Zoom centrado no cursor
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const f       = e.deltaY > 0 ? 0.85 : 1.18
      const newZoom = Math.max(0.7, Math.min(14, this._zoom * f))
      const rect    = canvas.getBoundingClientRect()
      const mx      = e.clientX - rect.left
      const my      = e.clientY - rect.top
      const zf      = newZoom / this._zoom
      this._offsetX = mx - this._width  / 2 - (mx - this._width  / 2 - this._offsetX) * zf
      this._offsetY = my - this._height / 2 - (my - this._height / 2 - this._offsetY) * zf
      this._zoom    = newZoom
      this._scheduleViewChange()
    }, { passive: false })

    // Touch
    let tDown = false, tDragging = false
    let tsx = 0, tsy = 0, tlx = 0, tly = 0, lastPinch = 0

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        tDown = true; tDragging = false
        tsx = tlx = e.touches[0].clientX
        tsy = tly = e.touches[0].clientY
      } else if (e.touches.length === 2) {
        lastPinch = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
      }
    }, { passive: true })

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault()
      if (e.touches.length === 1 && tDown) {
        const dx = e.touches[0].clientX - tlx
        const dy = e.touches[0].clientY - tly
        if (Math.abs(e.touches[0].clientX - tsx) > 4 || Math.abs(e.touches[0].clientY - tsy) > 4)
          tDragging = true
        if (tDragging) { this._offsetX += dx; this._offsetY += dy }
        tlx = e.touches[0].clientX; tly = e.touches[0].clientY
      } else if (e.touches.length === 2 && lastPinch > 0) {
        const d       = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
        const newZoom = Math.max(0.7, Math.min(14, this._zoom * (d / lastPinch)))
        const rect    = canvas.getBoundingClientRect()
        const mx      = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left
        const my      = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top
        const zf      = newZoom / this._zoom
        this._offsetX = mx - this._width  / 2 - (mx - this._width  / 2 - this._offsetX) * zf
        this._offsetY = my - this._height / 2 - (my - this._height / 2 - this._offsetY) * zf
        this._zoom    = newZoom
        lastPinch     = d
      }
    }, { passive: false })

    canvas.addEventListener('touchend', (e) => {
      if (e.changedTouches.length === 1 && !tDragging) {
        const t    = e.changedTouches[0]
        const rect = canvas.getBoundingClientRect()
        this._handleClick(t.clientX - rect.left, t.clientY - rect.top)
      }
      const wasDragging = tDragging || lastPinch > 0
      tDown = false; tDragging = false; lastPinch = 0
      if (wasDragging) this._scheduleViewChange()
    }, { passive: true })
  }

  _handleClick(px, py) {
    if (!this.onClickCallback) return

    // Hitbox maior em zoom alto (emoji ocupa mais espaço)
    const hitR = this._zoom >= 3 ? Math.min(22, 14 + (this._zoom - 3) * 2) : 14

    for (const { event } of this._markers) {
      const pos = this._project(event.latitude, event.longitude)
      if (Math.hypot(px - pos.x, py - pos.y) < hitR) {
        this.onClickCallback({ type: 'event', event, lat: event.latitude, lng: event.longitude })
        return
      }
    }

    const { lat, lng } = this._unproject(px, py)
    if (lat > -85 && lat < 85 && lng > -180 && lng < 180) {
      this.onClickCallback({ type: 'map', lat, lng })
    }
  }

  // ── Notificação de mudança de vista ───────────────────────────────────────

  _scheduleViewChange() {
    if (!this.onViewChangeCallback) return
    clearTimeout(this._viewChangeTimer)
    this._viewChangeTimer = setTimeout(() => {
      this.onViewChangeCallback({ zoom: this._zoom, bounds: this.getBounds() })
    }, 700)
  }

  // ── API pública ────────────────────────────────────────────────────────────

  clearMarkers() { this._markers = [] }

  /** Troca a paleta de cartografia ('light' | 'dark'). O loop RAF redesenha. */
  setColorScheme(scheme) {
    this._palette = scheme === 'dark' ? PALETTE_DARK : PALETTE_LIGHT
  }

  setUserLocation(lat, lng) { this._userPos = { lat, lng } }

  /** @param {object} event  GlobalEvent
   *  @param {string} icon   Emoji do tipo (ex: '🔥')
   *  @param {string} color  Hex color do tipo (ex: '#ff4444') */
  addEventMarker(event, icon = '⚠️', color = '') { this._markers.push({ event, icon, color }) }

  /** Ativa ou desativa uma camada GIBS pelo nome do data-layer. */
  setLayer(name, enabled) {
    if (enabled) {
      this._activeLayers.add(name)
    } else {
      this._activeLayers.delete(name)
      // Limpa tiles dessa camada do cache para liberar memória
      for (const k of this._tileCache.keys()) {
        if (k.startsWith(name + '|')) this._tileCache.delete(k)
      }
    }
  }

  getZoom() { return this._zoom }

  getCenter() {
    const b = this.getBounds()
    return { lat: (b.latMin + b.latMax) / 2, lng: (b.lngMin + b.lngMax) / 2 }
  }

  /** Retorna os limites lat/lng do viewport atual. */
  getBounds() {
    const corners = [
      this._unproject(0,           0),
      this._unproject(this._width, 0),
      this._unproject(0,           this._height),
      this._unproject(this._width, this._height),
    ]
    const lats = corners.map((c) => c.lat)
    const lngs = corners.map((c) => c.lng)
    return {
      latMin: Math.max(-85,  Math.min(...lats)),
      latMax: Math.min( 85,  Math.max(...lats)),
      lngMin: Math.max(-180, Math.min(...lngs)),
      lngMax: Math.min( 180, Math.max(...lngs)),
    }
  }

  focusOn(lat, lng, zoomHint = null) {
    if (zoomHint !== null) {
      this._zoom = Math.max(0.7, Math.min(14, zoomHint * 2.5))
    }
    const nx    = this._mercX(lng)
    const ny    = this._mercY(lat)
    const scale = this._width * this._zoom
    this._offsetX = -(nx - 0.5) * scale
    this._offsetY = -(ny - 0.5) * scale
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf)
    this._canvas?.remove()
    this._tileCache.clear()
  }
}
