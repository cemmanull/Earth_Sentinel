/**
 * Globe — globo 3D com aparência idêntica ao mapa 2D (WorldMap).
 *
 * Rotação real: inicializa no ângulo UTC atual e gira a 2π/86400 rad/s.
 * Dia/noite:    esfera ShaderMaterial r=1.04, sol fixo em +X (mundo),
 *               normal do fragmento (world-space) determina dia/noite.
 *
 * Marcadores equivalentes ao map.js _drawMarkers():
 *   • camera afastada (z ≥ 2.1 ↔ zoom < 3):  ponto colorido + halo pulsante
 *   • camera próxima  (z < 2.1 ↔ zoom ≥ 3):  emoji + halo pulsante
 *   • depthTest: true → marcadores atrás do globo ocultados automaticamente
 *
 * API pública:
 *   addMarker(lat, lng, color, icon, severity)
 *   clearMarkers()
 *   setLayer(name, enabled)   — wireframe | graticule | atmosphere | night
 *   setRealistic(enabled)
 *   setColorScheme(scheme)    — 'light' | 'dark' (paleta cartográfica)
 *   focusOn(lat, lng)
 *   destroy()
 *   onClickCallback           — ({type:'map', lat, lng})
 */

const WORLD_TOPO_URL   = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const EARTH_TEX_URL    = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/planets/earth_atmos_2048.jpg';
const EMOJI_Z_THRESHOLD = 2.1;             // camera.z < X → modo emoji (≡ zoom ≥ 3 no 2D)
const EARTH_RAD_PER_SEC = (2 * Math.PI) / 86400;  // 1 rotação completa em 24 h

// ── Camadas GIBS — sobreposição de tiles Mercator reprojetados ────────────────
const GIBS_BASE_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const GIBS_DEFS = {
  satellite:   { layer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor', tms: 'GoogleMapsCompatible_Level9', opacity: 0.80, daysAgo: 2 },
  fires:       { layer: 'VIIRS_SNPP_Fires_All',                       tms: 'GoogleMapsCompatible_Level8', opacity: 0.90, daysAgo: 2 },
  temperature: { layer: 'MODIS_Terra_Land_Surface_Temp_Day',           tms: 'GoogleMapsCompatible_Level7', opacity: 0.70, daysAgo: 2 },
  clouds:      { layer: 'MODIS_Terra_Cloud_Top_Pressure_Day',          tms: 'GoogleMapsCompatible_Level6', opacity: 0.55, daysAgo: 2 },
  aerosols:    { layer: 'MODIS_Terra_Aerosol',                         tms: 'GoogleMapsCompatible_Level6', opacity: 0.75, daysAgo: 2 },
};

/**
 * Cartografia clara — valores derivados da paleta Aegis Sentinel (DESIGN.md).
 * Espelha PALETTE_LIGHT de map.js (formas hex Three.js e CSS canvas conforme o uso).
 * background #f7fdfd · muted #e0e8e8 · primary #00575c · focus #0d9297 · foreground #020202
 */
const PALETTE_LIGHT = {
  ocean:         0xf7fdfd,           // background — esfera base / fallback sem textura
  oceanCss:      '#f7fdfd',          // oceano na textura equiretangular
  landCss:       '#dde6e3',          // terra base — neutro esverdeado derivado de muted
  countryCss:    '#e0e8e8',          // muted — preenchimento de países
  borders:       0x020202,           // fronteiras — foreground (opacity 0.18 no material)
  graticule:     0x020202,           // grade lat/lng — foreground (opacity 0.05)
  equator:       0x00575c,           // equador — primary (opacity 0.16)
  atmosphere:    0x0d9297,           // glow atmosférico — teal sutil (focus)
  dotOutlineCss: 'rgba(2,2,2,0.25)', // contorno de dots sobre fundo claro
  user:          0x0d9297,           // focus — marcador do usuário
};

/**
 * Cartografia escura — valores do DESIGN.md (Dark Mode Variant).
 * Espelha PALETTE_DARK de map.js.
 * background #0a1010 · muted #1a2626 · foreground #f2f8f8 · focus #0d9297
 */
const PALETTE_DARK = {
  ocean:         0x0a1010,                 // background dark — esfera base / fallback sem textura
  oceanCss:      '#0a1010',                // oceano na textura equiretangular
  landCss:       '#1f2b28',                // terra base — muted com leve viés verde
  countryCss:    '#1a2626',                // muted dark — preenchimento de países
  borders:       0xf2f8f8,                 // fronteiras — foreground (opacity 0.18 no material)
  graticule:     0xf2f8f8,                 // grade lat/lng — foreground (opacity 0.05)
  equator:       0x0d9297,                 // equador — teal focus (primary é ilegível no escuro)
  atmosphere:    0x0d9297,                 // glow atmosférico — teal sutil (focus)
  dotOutlineCss: 'rgba(242,248,248,0.30)', // contorno de dots sobre fundo escuro
  user:          0x0d9297,                 // focus — marcador do usuário
};

// ── Shaders do ciclo dia/noite ────────────────────────────────────────────────

const NIGHT_VERT = `
  varying vec3 vLocalNormal;
  void main() {
    vLocalNormal = normalize(normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NIGHT_FRAG = `
  uniform vec3 uSunDir;   // ponto subsolar em espaço geográfico local
  varying vec3 vLocalNormal;
  void main() {
    float cosA = dot(vLocalNormal, uSunDir);
    // Zona de crepúsculo: ≈12° de transição suave
    float night = 1.0 - smoothstep(-0.12, 0.10, cosA);
    // Noite: véu teal escuro (primary #00575c) sobre o tema claro; dia: transparente
    gl_FragColor = vec4(0.0, 0.341, 0.361, night * 0.35);
  }
`;

export class Globe {
  constructor(canvas) {
    this.canvas          = canvas;
    this.onClickCallback = null;

    this._palette      = PALETTE_LIGHT;
    this._topo         = null;   // TopoJSON bruto — permite regenerar a textura por esquema
    this._tc           = null;   // referência a window.topojson
    this._renderer     = null;
    this._scene        = null;
    this._camera       = null;
    this._earthGroup   = null;
    this._baseSphere   = null;
    this._borderMesh   = null;
    this._gratMesh     = null;
    this._eqMesh       = null;
    this._atmMesh      = null;
    this._nightMesh    = null;
    this._markers      = [];
    this._userMarkers  = [];   // marcadores de localização do usuário (persistem em clearMarkers)
    this._haloTexture  = null;
    this._baseTexture  = null;
    this._earthTexture = null;
    this._useEmoji     = false;

    this._rotX = 0.18;
    this._rotY = this._initRotY();   // sincroniza com hora UTC atual
    this._velX = 0;
    this._velY = 0;                  // apenas inércia pós-drag; auto-rot é real

    this._isDragging  = false;
    this._hasDragged  = false;
    this._prevMouse   = { x: 0, y: 0 };
    this._animId      = null;
    this._lastFrame   = 0;
    this._lastSunUpd  = 0;

    this._isTargeting = false;
    this._targetRotX  = 0;
    this._targetRotY  = 0;
    this._targetZ     = 2.8;

    this._layers = { wireframe: true, graticule: true, atmosphere: true, night: true, realistic: false };

    this._gibsMesh         = null;
    this._gibsActiveLayers = new Set();
    this._gibsBuilding     = false;
    this._gibsPending      = false;

    this._init();
  }

  // Orientação visual inicial: posiciona a linha do terminador no centro da vista.
  // O ciclo dia/noite é calculado em espaço local (veja _getSunDir) e é correto
  // independentemente deste valor; _initRotY é apenas estética.
  _initRotY() {
    const now = new Date();
    const utcH = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
    return (utcH / 24 - 0.5) * 2 * Math.PI;
  }

  // Ponto subsolar em espaço geográfico local (independente da rotação do globo).
  // dot(localNormal, localSunDir) > 0 → dia; invariante a qualquer _rotY.
  _getSunDir() {
    const now    = new Date();
    const utcH   = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
    const doy    = Math.floor((now - new Date(Date.UTC(now.getUTCFullYear(), 0, 1))) / 86400000);
    const decl   = -23.45 * Math.cos(2 * Math.PI * (doy + 10) / 365) * Math.PI / 180;
    const lngSun = (0.5 - utcH / 24) * 360;
    return this._ll2v3(decl, lngSun, 1);
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  _init() {
    const w = this.canvas.width  || this.canvas.clientWidth  || 800;
    const h = this.canvas.height || this.canvas.clientHeight || 600;

    this._renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this._renderer.setSize(w, h);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setClearColor(0x000000, 0);

    this._scene  = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    this._camera.position.z = 2.8;

    // Base clara: ambient + directional somam ~1.0 para não estourar a textura
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.88));
    const sun = new THREE.DirectionalLight(0xffffff, 0.14);
    sun.position.set(5, 3, 5);
    this._scene.add(sun);

    this._earthGroup = new THREE.Group();
    this._scene.add(this._earthGroup);

    this._buildBase();
    this._buildGraticule();
    this._buildAtmosphere();
    this._buildNightOverlay();
    this._loadGeoData();
    this._bindEvents();
    this._startLoop();

    this._resizeFn = () => this._onResize();
    window.addEventListener('resize', this._resizeFn);
  }

  _buildBase() {
    const geo = new THREE.SphereGeometry(1, 64, 48);
    const mat = new THREE.MeshPhongMaterial({
      color: this._palette.ocean, emissive: 0x000000, shininess: 2,
    });
    this._baseSphere = new THREE.Mesh(geo, mat);
    this._earthGroup.add(this._baseSphere);
  }

  // Grade lat/lng — cores idênticas ao map.js _drawGrid()
  _buildGraticule() {
    const r   = 1.003;
    const pts = [], eqPt = [];

    for (let lat = -60; lat <= 60; lat += 30) {
      if (lat === 0) continue;
      for (let lng = -180; lng < 180; lng += 2) {
        const a = this._ll2v3(lat, lng, r), b = this._ll2v3(lat, lng + 2, r);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    for (let lng = -180; lng < 180; lng += 30) {
      for (let lat = -80; lat < 80; lat += 2) {
        const a = this._ll2v3(lat, lng, r), b = this._ll2v3(lat + 2, lng, r);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    this._gratMesh = new THREE.LineSegments(geo,
      new THREE.LineBasicMaterial({ color: this._palette.graticule, transparent: true, opacity: 0.05 }));
    this._gratMesh.visible = this._layers.graticule;
    this._gratMesh.renderOrder = 1;
    this._earthGroup.add(this._gratMesh);

    for (let lng = -180; lng < 180; lng += 2) {
      const a = this._ll2v3(0, lng, r), b = this._ll2v3(0, lng + 2, r);
      eqPt.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const eqGeo = new THREE.BufferGeometry();
    eqGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(eqPt), 3));
    this._eqMesh = new THREE.LineSegments(eqGeo,
      new THREE.LineBasicMaterial({ color: this._palette.equator, transparent: true, opacity: 0.16 }));
    this._eqMesh.visible = this._layers.graticule;
    this._eqMesh.renderOrder = 1;
    this._earthGroup.add(this._eqMesh);
  }

  _buildAtmosphere() {
    const geo = new THREE.SphereGeometry(1.12, 32, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: this._palette.atmosphere, transparent: true, opacity: 0.10, side: THREE.BackSide,
    });
    this._atmMesh = new THREE.Mesh(geo, mat);
    this._atmMesh.visible = this._layers.atmosphere;
    this._earthGroup.add(this._atmMesh);
  }

  // Esfera de noite — ShaderMaterial, r=1.04 (fora dos marcadores em r=1.03)
  // uSunDir em espaço geográfico local → correto independente de drag/focusOn.
  // renderOrder=5: desenhada antes dos marcadores (6/7) — depthTest nos sprites
  // oculta os atrás do globo mas deixa os do lado noturno visíveis sobre o overlay.
  _buildNightOverlay() {
    const geo = new THREE.SphereGeometry(1.04, 64, 48);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: this._getSunDir() },
      },
      vertexShader:   NIGHT_VERT,
      fragmentShader: NIGHT_FRAG,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.FrontSide,
    });
    this._nightMesh = new THREE.Mesh(geo, mat);
    this._nightMesh.visible     = this._layers.night;
    this._nightMesh.renderOrder = 5;
    this._earthGroup.add(this._nightMesh);
  }

  // ── Dados geográficos ─────────────────────────────────────────────────────

  async _loadGeoData() {
    try {
      const res  = await fetch(WORLD_TOPO_URL, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const topo = await res.json();
      const tc   = window.topojson;

      this._baseTexture = this._buildBaseTexture(topo, tc);
      this._topo = topo;
      this._tc   = tc;
      if (!this._layers.realistic) {
        this._baseSphere.material.map = this._baseTexture;
        this._baseSphere.material.color.setHex(0xffffff);
        this._baseSphere.material.needsUpdate = true;
      }
      this._buildBorders(topo, tc);
    } catch (err) {
      console.warn('[Globe] Dados geográficos não carregados:', err.message);
    }
  }

  // Textura equiretangular 2048×1024 — cores idênticas ao map.js
  _buildBaseTexture(topo, tc) {
    const W = 2048, H = 1024;
    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = H;
    const ctx = cvs.getContext('2d');

    const px = lng => (lng + 180) / 360 * W;
    const py = lat => (90 - lat) / 180 * H;

    const traceLine = (coords) => {
      let prev = null;
      for (const [lng, lat] of coords) {
        const x = px(lng), y = py(lat);
        if (prev === null || Math.abs(lng - prev) > 170) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        prev = lng;
      }
    };

    const traceGeom = (g) => {
      if (!g) return;
      if      (g.type === 'Polygon')         g.coordinates.forEach(r => { traceLine(r); ctx.closePath(); });
      else if (g.type === 'MultiPolygon')    g.coordinates.forEach(p => p.forEach(r => { traceLine(r); ctx.closePath(); }));
      else if (g.type === 'LineString')      traceLine(g.coordinates);
      else if (g.type === 'MultiLineString') g.coordinates.forEach(traceLine);
      else if (g.type === 'GeometryCollection') g.geometries?.forEach(traceGeom);
    };

    ctx.fillStyle = this._palette.oceanCss;          // oceano
    ctx.fillRect(0, 0, W, H);

    const land = tc.feature(topo, topo.objects.land);
    ctx.beginPath(); traceGeom(land.geometry);
    ctx.fillStyle = this._palette.landCss; ctx.fill('evenodd');  // terra base

    const countries = tc.feature(topo, topo.objects.countries);
    ctx.fillStyle = this._palette.countryCss;
    for (const f of countries.features) {
      ctx.beginPath(); traceGeom(f.geometry); ctx.fill('evenodd');  // países
    }

    return new THREE.CanvasTexture(cvs);
  }

  _buildBorders(topo, tc) {
    const borders = tc.mesh(topo, topo.objects.countries, (a, b) => a !== b);
    const pts = [], r = 1.005;
    for (const line of borders.coordinates) {
      for (let i = 0; i < line.length - 1; i++) {
        const [lng0, lat0] = line[i], [lng1, lat1] = line[i + 1];
        if (Math.abs(lng0 - lng1) > 170) continue;
        const a = this._ll2v3(lat0, lng0, r), b = this._ll2v3(lat1, lng1, r);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    this._borderMesh = new THREE.LineSegments(geo,
      new THREE.LineBasicMaterial({ color: this._palette.borders, transparent: true, opacity: 0.18 }));
    this._borderMesh.visible = this._layers.wireframe;
    this._borderMesh.renderOrder = 2;
    this._earthGroup.add(this._borderMesh);
  }

  // ── Coordenadas ───────────────────────────────────────────────────────────

  _ll2v3(lat, lng, r = 1) {
    const phi   = (90 - lat) * Math.PI / 180;
    const theta = (lng + 180) * Math.PI / 180;
    return new THREE.Vector3(
      -Math.sin(phi) * Math.cos(theta) * r,
       Math.cos(phi) * r,
       Math.sin(phi) * Math.sin(theta) * r,
    );
  }

  _v3ToLatLng(v) {
    const len = v.length();
    const lat = 90 - Math.acos(Math.max(-1, Math.min(1, v.y / len))) * 180 / Math.PI;
    const lng = ((Math.atan2(v.z, -v.x) * 180 / Math.PI - 180 + 540) % 360) - 180;
    return { lat, lng };
  }

  // ── Texturas de marcadores ────────────────────────────────────────────────

  // Máscara branca — tintada pela cor do SpriteMaterial (cor do marcador); nunca renderiza branco puro
  _getHaloTexture() {
    if (this._haloTexture) return this._haloTexture;
    const S = 64, cvs = document.createElement('canvas');
    cvs.width = S; cvs.height = S;
    const ctx = cvs.getContext('2d');
    const g = ctx.createRadialGradient(S/2, S/2, S*.08, S/2, S/2, S/2);
    g.addColorStop(0,   'rgba(255,255,255,0.85)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.30)');
    g.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    this._haloTexture = new THREE.CanvasTexture(cvs);
    return this._haloTexture;
  }

  // Ponto colorido + contorno escuro — idêntico ao map.js zoom < 3
  _makeDotTexture(color) {
    const S = 64, cvs = document.createElement('canvas');
    cvs.width = S; cvs.height = S;
    const ctx = cvs.getContext('2d');
    ctx.beginPath();
    ctx.arc(S/2, S/2, S * .34, 0, Math.PI * 2);
    ctx.fillStyle   = '#' + color.toString(16).padStart(6, '0');
    ctx.fill();
    ctx.strokeStyle = this._palette.dotOutlineCss;
    ctx.lineWidth   = S * .06;
    ctx.stroke();
    return new THREE.CanvasTexture(cvs);
  }

  // Emoji puro — idêntico ao map.js zoom ≥ 3
  _makeIconTexture(icon) {
    const S = 72, cvs = document.createElement('canvas');
    cvs.width = S; cvs.height = S;
    const ctx = cvs.getContext('2d');
    ctx.font = `${Math.round(S * .58)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(icon, S/2, S/2 + 1);
    return new THREE.CanvasTexture(cvs);
  }

  // ── API pública ───────────────────────────────────────────────────────────

  // Default dual-mode: telemetry-2 #528ac4 (DESIGN.md) — ≥ 3:1 nos dois oceanos.
  addMarker(lat, lng, color = 0x528ac4, icon = '⚠️', severity = 1, scaleMul = 1.0) {
    const pos       = this._ll2v3(lat, lng, 1.03);
    // baseR_2d = 3 + (sev-1)*0.9 px → scale = baseR / (0.34 * pxPerUnit)
    const baseScale = (3 + (severity - 1) * 0.9) * 0.0054 * scaleMul;
    const opts      = { depthTest: true, depthWrite: false, transparent: true };

    // Halo (renderOrder 3) — menor para avisos
    const haloMat = new THREE.SpriteMaterial({
      ...opts, map: this._getHaloTexture(), color: new THREE.Color(color),
      opacity: scaleMul < 0.8 ? 0.12 : 0.28,
    });
    const haloSpr = new THREE.Sprite(haloMat);
    haloSpr.position.copy(pos); haloSpr.renderOrder = 6;
    this._earthGroup.add(haloSpr);

    // Ponto (renderOrder 7, visível quando camera afastada)
    const dotMat = new THREE.SpriteMaterial({ ...opts, map: this._makeDotTexture(color) });
    const dotSpr = new THREE.Sprite(dotMat);
    dotSpr.scale.set(baseScale, baseScale, baseScale);
    dotSpr.position.copy(pos); dotSpr.visible = !this._useEmoji; dotSpr.renderOrder = 7;
    this._earthGroup.add(dotSpr);

    // Emoji (renderOrder 7, visível quando camera próxima)
    const emojiMat = new THREE.SpriteMaterial({ ...opts, map: this._makeIconTexture(icon) });
    const emojiSpr = new THREE.Sprite(emojiMat);
    const es = baseScale * 1.35;
    emojiSpr.scale.set(es, es, es);
    emojiSpr.position.copy(pos); emojiSpr.visible = this._useEmoji; emojiSpr.renderOrder = 7;
    this._earthGroup.add(emojiSpr);

    this._markers.push({ dot: dotSpr, emoji: emojiSpr, halo: haloSpr, severity, baseScale });
  }

  clearMarkers() {
    for (const { dot, emoji, halo } of this._markers) {
      this._earthGroup.remove(dot); this._earthGroup.remove(emoji); this._earthGroup.remove(halo);
      dot.material.map?.dispose();   dot.material.dispose();
      emoji.material.map?.dispose(); emoji.material.dispose();
      halo.material.dispose();
    }
    this._markers = [];
  }

  setUserLocation(lat, lng) {
    // Remove marcador anterior do usuário
    for (const { dot, emoji, halo } of this._userMarkers) {
      this._earthGroup.remove(dot); this._earthGroup.remove(emoji); this._earthGroup.remove(halo);
      dot.material.map?.dispose();   dot.material.dispose();
      emoji.material.map?.dispose(); emoji.material.dispose();
      halo.material.dispose();
    }
    this._userMarkers = [];

    const pos  = this._ll2v3(lat, lng, 1.031);
    const opts = { depthTest: true, depthWrite: false, transparent: true };

    const haloMat = new THREE.SpriteMaterial({
      ...opts, map: this._getHaloTexture(), color: new THREE.Color(this._palette.user), opacity: 0.45,
    });
    const haloSpr = new THREE.Sprite(haloMat);
    haloSpr.position.copy(pos); haloSpr.renderOrder = 8;
    this._earthGroup.add(haloSpr);

    const dotMat = new THREE.SpriteMaterial({ ...opts, map: this._makeDotTexture(this._palette.user) });
    const dotSpr = new THREE.Sprite(dotMat);
    const s = 0.030;
    dotSpr.scale.set(s, s, s);
    dotSpr.position.copy(pos); dotSpr.renderOrder = 9;
    this._earthGroup.add(dotSpr);

    const emojiMat = new THREE.SpriteMaterial({ ...opts, map: this._makeIconTexture('🚩') });
    const emojiSpr = new THREE.Sprite(emojiMat);
    const es = s * 1.5;
    emojiSpr.scale.set(es, es, es);
    emojiSpr.position.copy(pos); emojiSpr.renderOrder = 9;
    this._earthGroup.add(emojiSpr);

    this._userMarkers.push({ dot: dotSpr, emoji: emojiSpr, halo: haloSpr,
      severity: 3, baseScale: s });
  }

  setLayer(name, enabled) {
    this._layers[name] = enabled;

    if (name in GIBS_DEFS) {
      if (enabled) this._gibsActiveLayers.add(name);
      else         this._gibsActiveLayers.delete(name);
      this._refreshGibs();
      return;
    }

    if (name === 'wireframe'  && this._borderMesh) this._borderMesh.visible = enabled;
    if (name === 'graticule') {
      if (this._gratMesh) this._gratMesh.visible = enabled;
      if (this._eqMesh)   this._eqMesh.visible   = enabled;
    }
    if (name === 'atmosphere' && this._atmMesh)  this._atmMesh.visible  = enabled;
    if (name === 'night'      && this._nightMesh) this._nightMesh.visible = enabled;
  }

  // Carrega tiles GIBS (Mercator z=2) e reprojetar para equiretangular como textura
  async _refreshGibs() {
    if (this._gibsBuilding) { this._gibsPending = true; return; }
    this._gibsBuilding = true;
    this._gibsPending  = false;

    try {
      if (this._gibsActiveLayers.size === 0) {
        if (this._gibsMesh) this._gibsMesh.visible = false;
        return;
      }

      if (!this._gibsMesh) {
        const geo = new THREE.SphereGeometry(1.002, 64, 48);
        const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
        this._gibsMesh = new THREE.Mesh(geo, mat);
        this._gibsMesh.renderOrder = 3;
        this._earthGroup.add(this._gibsMesh);
      }

      const tex = await this._buildGibsTexture();
      if (tex) {
        this._gibsMesh.material.map?.dispose();
        this._gibsMesh.material.map = tex;
        this._gibsMesh.material.needsUpdate = true;
        this._gibsMesh.visible = true;
      }
    } catch (err) {
      console.warn('[Globe GIBS] Erro ao carregar camadas:', err.message);
    } finally {
      this._gibsBuilding = false;
      if (this._gibsPending) this._refreshGibs();
    }
  }

  _gibsDate(daysAgo) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return d.toISOString().slice(0, 10);
  }

  _loadTileImage(url) {
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async _buildGibsTexture() {
    const W = 2048, H = 1024;
    const Z = 2, N = 1 << Z, TILE = 256;   // z=2 → 4×4 tiles cobrindo o mundo

    const activeDefs = [...this._gibsActiveLayers].map(n => GIBS_DEFS[n]).filter(Boolean);
    if (!activeDefs.length) return null;

    // Carrega cada camada em seu próprio canvas Mercator (N*TILE × N*TILE)
    const layerData = [];
    for (const def of activeDefs) {
      const date = this._gibsDate(def.daysAgo);
      const MW   = N * TILE;
      const mercCvs = document.createElement('canvas');
      mercCvs.width = MW; mercCvs.height = MW;
      const mercCtx = mercCvs.getContext('2d');

      const tileLoads = [];
      for (let ty = 0; ty < N; ty++) {
        for (let tx = 0; tx < N; tx++) {
          const url = `${GIBS_BASE_URL}/${def.layer}/default/${date}/${def.tms}/${Z}/${ty}/${tx}.png`;
          tileLoads.push(this._loadTileImage(url).then(img => ({ img, tx, ty })));
        }
      }
      const results = await Promise.allSettled(tileLoads);
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.img)
          mercCtx.drawImage(r.value.img, r.value.tx * TILE, r.value.ty * TILE, TILE, TILE);
      }
      layerData.push({ idata: mercCtx.getImageData(0, 0, MW, MW), opacity: def.opacity, size: MW });
    }

    if (!layerData.length) return null;

    // Pré-computa mercYNorm por linha (H cálculos caros, não 2M)
    const mercYByRow = new Float32Array(H);
    for (let ey = 0; ey < H; ey++) {
      const lat = (0.5 - ey / H) * 180;
      if (Math.abs(lat) >= 85.05) {
        mercYByRow[ey] = lat > 0 ? 0.001 : 0.999;
      } else {
        const latRad = lat * Math.PI / 180;
        mercYByRow[ey] = 0.5 - Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / (2 * Math.PI);
      }
    }

    // Reprojeção Mercator → equiretangular pixel-a-pixel
    const out = new Uint8ClampedArray(W * H * 4);
    for (let ey = 0; ey < H; ey++) {
      const mercYNorm = mercYByRow[ey];
      for (let ex = 0; ex < W; ex++) {
        const mercXNorm = ex / W;
        const di = (ey * W + ex) * 4;
        for (const { idata, opacity, size } of layerData) {
          const sx = Math.min(mercXNorm * size | 0, size - 1);
          const sy = Math.min(mercYNorm * size | 0, size - 1);
          const si = (sy * size + sx) * 4;
          const srcA = idata.data[si + 3] / 255;
          if (srcA <= 0) continue;
          const alpha = srcA * opacity;
          const ia    = 1 - alpha;
          out[di]     = out[di]     * ia + idata.data[si]     * alpha;
          out[di + 1] = out[di + 1] * ia + idata.data[si + 1] * alpha;
          out[di + 2] = out[di + 2] * ia + idata.data[si + 2] * alpha;
          out[di + 3] = Math.max(out[di + 3], alpha * 255 | 0);
        }
      }
    }

    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = H;
    cvs.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
    const tex = new THREE.CanvasTexture(cvs);
    console.log(`[Globe GIBS] ${layerData.length} camada(s) aplicada(s): ${[...this._gibsActiveLayers].join(', ')}`);
    return tex;
  }

  setRealistic(enabled) {
    this._layers.realistic = enabled;
    if (enabled && !this._earthTexture) {
      new THREE.TextureLoader().load(
        EARTH_TEX_URL,
        tex => { this._earthTexture = tex; if (this._layers.realistic) this._applyTexture(tex); },
        undefined,
        () => console.warn('[Globe] Textura realista indisponível'),
      );
    } else if (enabled && this._earthTexture) {
      this._applyTexture(this._earthTexture);
    } else {
      if (this._baseTexture) this._applyTexture(this._baseTexture);
      else { this._baseSphere.material.map = null; this._baseSphere.material.color.setHex(this._palette.ocean); this._baseSphere.material.needsUpdate = true; }
    }
  }

  /**
   * Troca a paleta de cartografia ('light' | 'dark'):
   * regenera a textura procedural e atualiza os materiais derivados da paleta.
   * Com a textura realista NASA ativa, só o que não é textura muda.
   */
  setColorScheme(scheme) {
    const next = scheme === 'dark' ? PALETTE_DARK : PALETTE_LIGHT;
    if (next === this._palette) return;
    this._palette = next;

    if (this._borderMesh) { this._borderMesh.material.color.setHex(next.borders); }
    if (this._gratMesh)   { this._gratMesh.material.color.setHex(next.graticule); }
    if (this._eqMesh)     { this._eqMesh.material.color.setHex(next.equator); }
    if (this._atmMesh)    { this._atmMesh.material.color.setHex(next.atmosphere); }

    if (this._topo && this._tc) {
      const old = this._baseTexture;
      this._baseTexture = this._buildBaseTexture(this._topo, this._tc);
      if (!this._layers.realistic) this._applyTexture(this._baseTexture);
      old?.dispose();
    } else if (!this._layers.realistic) {
      // Topology ainda não carregou — esfera sólida segue o oceano da paleta.
      this._baseSphere.material.map = null;
      this._baseSphere.material.color.setHex(next.ocean);
      this._baseSphere.material.needsUpdate = true;
    }
  }

  _applyTexture(tex) {
    this._baseSphere.material.map = tex;
    this._baseSphere.material.color.setHex(0xffffff);
    this._baseSphere.material.needsUpdate = true;
  }

  // focusOn: calcula caminho mínimo a partir da rotação atual
  focusOn(lat, lng) {
    const absTarget = ((-90 - lng) * Math.PI) / 180;
    let   dy        = absTarget - this._rotY;
    dy = ((dy + Math.PI) % (2 * Math.PI)) - Math.PI;  // normaliza para [−π, π]
    this._targetRotX  = (lat * Math.PI) / 180;
    this._targetRotY  = this._rotY + dy;
    this._targetZ     = 1.85;
    this._isTargeting = true;
    this._velX = 0;
    this._velY = 0;
  }

  destroy() {
    if (this._animId)   cancelAnimationFrame(this._animId);
    if (this._resizeFn) window.removeEventListener('resize', this._resizeFn);
    if (this._renderer) this._renderer.dispose();
    if (this._gibsMesh) {
      this._gibsMesh.material.map?.dispose();
      this._gibsMesh.material.dispose();
      this._gibsMesh.geometry.dispose();
    }
    for (const { dot, emoji, halo } of this._userMarkers) {
      dot.material.map?.dispose();   dot.material.dispose();
      emoji.material.map?.dispose(); emoji.material.dispose();
      halo.material.dispose();
    }
  }

  // ── Interação ─────────────────────────────────────────────────────────────

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('mousedown',  e => this._onDown(e.clientX, e.clientY));
    c.addEventListener('mousemove',  e => this._onMove(e.clientX, e.clientY));
    c.addEventListener('mouseup',    e => this._onUp(e.clientX, e.clientY));
    c.addEventListener('mouseleave', () => { this._isDragging = false; });
    c.addEventListener('wheel',      e => this._onWheel(e), { passive: false });

    c.addEventListener('touchstart', e => {
      if (e.touches.length === 1) this._onDown(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    c.addEventListener('touchmove', e => {
      if (e.touches.length === 1) { e.preventDefault(); this._onMove(e.touches[0].clientX, e.touches[0].clientY); }
    }, { passive: false });
    c.addEventListener('touchend', e => { const t = e.changedTouches[0]; this._onUp(t.clientX, t.clientY); });
  }

  _onDown(cx, cy) {
    this._isDragging = true; this._hasDragged = false; this._isTargeting = false;
    this._prevMouse = { x: cx, y: cy }; this._velX = 0; this._velY = 0;
  }

  _onMove(cx, cy) {
    if (!this._isDragging) return;
    const dx = cx - this._prevMouse.x, dy = cy - this._prevMouse.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) this._hasDragged = true;
    this._velX = this._velX * .4 + dy * .005 * .6;
    this._velY = this._velY * .4 + dx * .005 * .6;
    this._rotX = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, this._rotX + dy * .005));
    this._rotY += dx * .005;
    this._prevMouse = { x: cx, y: cy };
  }

  _onUp(cx, cy) {
    const wasDragging = this._isDragging; this._isDragging = false;
    if (!this._hasDragged && wasDragging) this._handleClick(cx, cy);
  }

  _handleClick(cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    const nx   = ((cx - rect.left) / rect.width)  * 2 - 1;
    const ny   = -((cy - rect.top) / rect.height) * 2 + 1;
    const ray  = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), this._camera);
    const hits = ray.intersectObject(this._baseSphere);
    if (hits.length && this.onClickCallback) {
      const { lat, lng } = this._v3ToLatLng(this._earthGroup.worldToLocal(hits[0].point.clone()));
      this.onClickCallback({ type: 'map', lat, lng });
    }
  }

  _onWheel(e) {
    e.preventDefault();
    this._camera.position.z = Math.max(1.4, Math.min(6, this._camera.position.z + (e.deltaY > 0 ? 0.18 : -0.18)));
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  _startLoop() {
    const loop = (ts) => {
      this._animId = requestAnimationFrame(loop);

      // dt independente de frame-rate, limitado a 100 ms para evitar saltos
      const dt = Math.min((ts - (this._lastFrame || ts)) / 1000, 0.1);
      this._lastFrame = ts;

      const earthRad = EARTH_RAD_PER_SEC * dt;  // rotação terrestre real neste frame

      if (this._isTargeting && !this._isDragging) {
        const dx = this._targetRotX - this._rotX;
        let   dy = this._targetRotY - this._rotY;
        dy = ((dy + Math.PI) % (2 * Math.PI)) - Math.PI;
        this._rotX += dx * 0.12;
        this._rotY += dy * 0.12 + earthRad;   // rotação real somada mesmo durante foco
        this._camera.position.z += (this._targetZ - this._camera.position.z) * 0.12;
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) this._isTargeting = false;
      } else if (!this._isDragging) {
        this._velX *= 0.92;
        this._velY *= 0.97;   // inércia pós-drag decai para 0; auto-rot é via earthRad
        this._rotX  = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, this._rotX + this._velX));
        this._rotY += this._velY + earthRad;
      }

      if (this._earthGroup) {
        this._earthGroup.rotation.x = this._rotX;
        this._earthGroup.rotation.y = this._rotY;
      }

      // Atualiza direção do sol a cada segundo (declinação muda lentamente)
      const nowSec = Math.floor(ts / 1000);
      if (nowSec !== this._lastSunUpd && this._nightMesh) {
        this._lastSunUpd = nowSec;
        this._nightMesh.material.uniforms.uSunDir.value.copy(this._getSunDir());
      }

      // Troca dot ↔ emoji ao cruzar limiar de zoom (eventos + usuário)
      const allMarkers = [...this._markers, ...this._userMarkers];
      if (allMarkers.length > 0) {
        const useEmoji = this._camera.position.z < EMOJI_Z_THRESHOLD;
        if (useEmoji !== this._useEmoji) {
          this._useEmoji = useEmoji;
          for (const { dot, emoji } of allMarkers) {
            dot.visible = !useEmoji; emoji.visible = useEmoji;
          }
        }

        // Halos pulsantes — fórmula idêntica ao map.js _drawMarkers()
        const phase = (Date.now() * 0.001) % (Math.PI * 2);
        const pulse  = Math.abs(Math.sin(phase));
        for (const { halo, severity, baseScale } of this._markers) {
          const hs = baseScale * (1.8 + pulse * (0.5 + severity * 0.15));
          halo.scale.set(hs, hs, hs);
          halo.material.opacity = (0.12 + pulse * 0.22) * (0.7 + severity * 0.06);
        }
        for (const { halo, baseScale } of this._userMarkers) {
          const hs = baseScale * (2.0 + pulse * 1.2);
          halo.scale.set(hs, hs, hs);
          halo.material.opacity = 0.25 + pulse * 0.30;
        }
      }

      this._renderer.render(this._scene, this._camera);
    };
    requestAnimationFrame(loop);
  }

  _onResize() {
    if (!this.canvas.parentElement) return;
    const w = this.canvas.parentElement.clientWidth, h = this.canvas.parentElement.clientHeight;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
  }
}
