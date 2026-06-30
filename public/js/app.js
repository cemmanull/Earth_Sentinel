// app.js — SHELL multi-tema (Fase 5).
// Responsabilidades do shell: inicializar mapa/globo compartilhados, ler
// /api/themes, montar o tema ativo e gerenciar controles compartilhados
// (troca 2D/3D, camadas GIBS, geolocalização, seletor de tema, notificações).
//
// A UI de domínio (legenda, clima espacial, risco, ticker) NÃO mora aqui — ela é
// montada pelo tema ativo em #themePanelSlot via mount(container, ctx).

import { WorldMap } from './map.js';
import { Globe } from './globe.js';
import { ThemeRegistry } from './themes/registry.js';
import './shared/components/detail-panel.js';   // registra <detail-panel>
import * as api from './shared/api-client.js';
import { initNotifications } from './notifications.js';
import {
  nextScheme, resolveInitialScheme, schemeButtonIcon, schemeThemeColor,
} from './shared/color-scheme.js';
import { dateInputToStartMs, dateInputToEndMs } from './shared/date-range.js';

import extremeEvents from './themes/extreme-events/index.js';

// ── Registro de temas ───────────────────────────────────────────────────────
ThemeRegistry.register(extremeEvents);

// ── Refs do shell ───────────────────────────────────────────────────────────
const statusEl        = document.getElementById('status');
const loaderEl        = document.getElementById('loader');
const mapContainer    = document.getElementById('mapContainer');
const globeCanvas     = document.getElementById('globeCanvas');
const viewMapBtn      = document.getElementById('viewMap');
const viewGlobeBtn    = document.getElementById('viewGlobe');
const geoBtnEl        = document.getElementById('geoBtn');
const schemeBtnEl     = document.getElementById('schemeBtn');
const themeSelectorEl = document.getElementById('themeSelector');
const layersBtnEl     = document.getElementById('layersBtn');
const layersPopoverEl = document.getElementById('layersPopover');
const tickerTrack     = document.getElementById('tickerTrack');
const themePanelSlot  = document.getElementById('themePanelSlot');
const detailPanel     = document.getElementById('detailPanel');
const sidePanelEl     = document.getElementById('sidePanel');
const sideToggleBtn   = document.getElementById('sideToggle');
const dateRangeEl     = document.getElementById('dateRange');
const dateStartEl     = document.getElementById('dateStart');
const dateEndEl       = document.getElementById('dateEnd');
const dateClearEl     = document.getElementById('dateClear');

// ── Estado compartilhado ────────────────────────────────────────────────────
let worldMap     = null;
let globe        = null;
let currentView  = '2d';
let userLocation = null;          // { lat, lng } ou null
let colorScheme  = 'light';       // 'light' | 'dark' — resolvido no boot
const activeLayers = new Set();   // persiste entre trocas de view

// ── Helpers ─────────────────────────────────────────────────────────────────
function hideLoader() {
  if (loaderEl) loaderEl.style.display = 'none';
}

function setStatus(value) {
  if (statusEl) statusEl.textContent = value;
}

// applyLayer aplica uma camada ao mapa/globo conforme a regra de nomes do contrato:
// 'realistic' → satellite (2D) / setRealistic (3D); demais → setLayer direto.
function applyLayer(layer, enabled) {
  if (layer === 'realistic') {
    if (worldMap) worldMap.setLayer('satellite', enabled);
    if (globe)    globe.setRealistic(enabled);
  } else {
    if (worldMap) worldMap.setLayer(layer, enabled);
    if (globe)    globe.setLayer(layer, enabled);
  }
}

function applyActiveLayers() {
  for (const layer of activeLayers) applyLayer(layer, true);
}

// ── Esquema de cor — aplicação ──────────────────────────────────────────────
// Token swap no <html> + propagação às paletas do canvas + meta theme-color.
function applyColorScheme(scheme) {
  colorScheme = scheme;

  if (scheme === 'dark') document.documentElement.dataset.colorScheme = 'dark';
  else                   delete document.documentElement.dataset.colorScheme;

  worldMap?.setColorScheme?.(scheme);
  globe?.setColorScheme?.(scheme);

  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', schemeThemeColor(scheme));

  const schemeIcon = schemeBtnEl?.querySelector('i');
  if (schemeIcon) schemeIcon.className = schemeButtonIcon(scheme);
}

// ── Filtro de período (map-overlay) ─────────────────────────────────────────
// O overlay é chrome do shell sobre o mapa compartilhado; a aplicação do filtro
// é delegada ao tema ativo via setDateRange(startMs, endMs) — mesmo padrão
// opcional de renderMarkers/onMapClick. Tema sem setDateRange esconde o controle.

// applyDateRange lê os inputs, mantém min/max coerentes (impede intervalo
// invertido no próprio input nativo) e empurra o intervalo ao tema ativo.
function applyDateRange() {
  const startMs = dateInputToStartMs(dateStartEl?.value ?? '');
  const endMs   = dateInputToEndMs(dateEndEl?.value ?? '');

  // Limita a seleção do input oposto para nunca formar um intervalo invertido.
  if (dateEndEl)   dateEndEl.min   = dateStartEl?.value || '';
  if (dateStartEl) dateStartEl.max = dateEndEl?.value   || '';

  if (dateClearEl) dateClearEl.hidden = !(dateStartEl?.value || dateEndEl?.value);

  ThemeRegistry.getActive()?.setDateRange?.(startMs, endMs);
}

// resetDateRange limpa os inputs e reaplica um intervalo ilimitado.
function resetDateRange() {
  if (dateStartEl) { dateStartEl.value = ''; dateStartEl.max = ''; }
  if (dateEndEl)   { dateEndEl.value   = ''; dateEndEl.min   = ''; }
  applyDateRange();
}

// syncDateRangeControl mostra o overlay só quando o tema ativo sabe filtrar por
// data; ao (re)mostrar, parte sempre de um estado limpo (sem período).
function syncDateRangeControl() {
  if (!dateRangeEl) return;
  const supported = typeof ThemeRegistry.getActive()?.setDateRange === 'function';
  dateRangeEl.hidden = !supported;
  if (supported) resetDateRange();
}

// ── Map / Globe init ────────────────────────────────────────────────────────
function initializeMap() {
  worldMap = new WorldMap(mapContainer);
  worldMap.init();
  worldMap.onViewChangeCallback = () => {};
  if (colorScheme === 'dark') worldMap.setColorScheme('dark');
  wireMapClick();
  applyActiveLayers();
}

function initializeGlobe() {
  if (!(globeCanvas instanceof HTMLCanvasElement)) return;
  const rect = mapContainer.getBoundingClientRect();
  globeCanvas.width  = rect.width  || window.innerWidth;
  globeCanvas.height = rect.height || (window.innerHeight - 70);
  globe = new Globe(globeCanvas);
  if (colorScheme === 'dark') globe.setColorScheme('dark');
  wireGlobeClick();
  applyActiveLayers();
}

// wireMapClick / wireGlobeClick encaminham cliques ao tema ativo (contrato:
// payload = { type:'event'|'map', event?, lat, lng }).
function wireMapClick() {
  if (!worldMap) return;
  worldMap.onClickCallback = (payload) => {
    ThemeRegistry.getActive()?.onMapClick?.(payload);
  };
}

function wireGlobeClick() {
  if (!globe) return;
  // globe.onClickCallback recebe { lat, lng }; normalizamos para o payload do contrato.
  globe.onClickCallback = ({ lat, lng }) => {
    ThemeRegistry.getActive()?.onMapClick?.({ type: 'map', lat, lng });
  };
}

// ── ctx para o tema ─────────────────────────────────────────────────────────
function buildThemeContext() {
  return {
    api,
    getMap:          () => worldMap,
    getGlobe:        () => globe,
    getActiveView:   () => currentView,
    getUserLocation: () => userLocation,
    setStatus,
    tickerSlot:      tickerTrack,
    detailPanel,
  };
}

// ── Montagem de tema ────────────────────────────────────────────────────────
function mountTheme(themeId) {
  const theme = ThemeRegistry.get(themeId);

  // Desmonta o tema anterior, se houver.
  const previous = ThemeRegistry.getActive();
  if (previous) {
    try { previous.unmount?.(); } catch (err) { console.warn(`[${previous.id}] unmount falhou:`, err.message); }
  }
  if (themePanelSlot) themePanelSlot.innerHTML = '';
  detailPanel?.hide?.();
  if (dateRangeEl) dateRangeEl.hidden = true;   // reexibido por syncDateRangeControl se suportado

  if (!theme) {
    console.warn(`[shell] tema desconhecido: ${themeId}`);
    return;
  }

  ThemeRegistry.setActive(theme.id);

  // Temas futuros sem implementação real expõem só metadados — mostramos um placeholder.
  if (typeof theme.mount !== 'function') {
    if (themePanelSlot) {
      themePanelSlot.innerHTML = '<div class="theme-placeholder">Tema em construção</div>';
    }
    return;
  }

  try {
    theme.mount(themePanelSlot, buildThemeContext());
  } catch (err) {
    console.warn(`[${theme.id}] mount falhou:`, err.message);
    if (themePanelSlot) {
      themePanelSlot.innerHTML = '<div class="theme-placeholder">Tema em construção</div>';
    }
    return;
  }

  // Cliques já apontam para getActive(); só garantimos que estão conectados.
  wireMapClick();
  wireGlobeClick();
  syncDateRangeControl();   // mostra/esconde o filtro de período conforme o tema
  theme.renderMarkers?.();
}

// ── View switching 2D ↔ 3D ──────────────────────────────────────────────────
function switchView(newView) {
  if (newView === currentView) return;

  if (newView === '3d') {
    if (worldMap) { worldMap.destroy(); worldMap = null; }
    globeCanvas.style.display = 'block';
    viewMapBtn?.classList.remove('active');
    viewGlobeBtn?.classList.add('active');
    currentView = '3d';
    if (!globe) initializeGlobe();
    if (userLocation) globe.setUserLocation(userLocation.lat, userLocation.lng);
  } else {
    if (globe) globeCanvas.style.display = 'none';
    viewGlobeBtn?.classList.remove('active');
    viewMapBtn?.classList.add('active');
    currentView = '2d';
    initializeMap();
    if (userLocation) worldMap.setUserLocation(userLocation.lat, userLocation.lng);
  }

  // Re-conecta cliques ao tema ativo e re-renderiza marcadores na nova vista.
  wireMapClick();
  wireGlobeClick();
  ThemeRegistry.getActive()?.renderMarkers?.();
}

// ── Geolocalização ──────────────────────────────────────────────────────────
function placeUserMarker(lat, lng) {
  if (worldMap) worldMap.setUserLocation(lat, lng);
  if (globe)    globe.setUserLocation(lat, lng);
}

function requestUserLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    ({ coords: { latitude: lat, longitude: lng } }) => {
      userLocation = { lat, lng };
      placeUserMarker(lat, lng);
      // O tema reage relendo ctx.getUserLocation() no seu próprio fluxo.
      ThemeRegistry.getActive()?.renderMarkers?.();
    },
    err => { console.warn('[Geo] Localização não obtida:', err.message); },
    { timeout: 10_000, maximumAge: 300_000 },
  );
}

// ── Seletor de tema ─────────────────────────────────────────────────────────
// Popula o <select> a partir da lista de temas (do backend quando disponível,
// senão do ThemeRegistry local). Garante que apenas temas registrados localmente
// possam ser montados.
function populateThemeSelector(themes) {
  if (!themeSelectorEl) return;
  themeSelectorEl.innerHTML = '';
  for (const t of themes) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.icon ? t.icon + ' ' : ''}${t.label}`;
    themeSelectorEl.appendChild(opt);
  }
}

// mergeThemes combina os metadados do backend (label, has_geo_view) com os temas
// registrados localmente. Só lista temas que existem no ThemeRegistry — temas do
// backend sem implementação frontend são ignorados.
function resolveThemeList(backendThemes) {
  const local = ThemeRegistry.all();
  if (!Array.isArray(backendThemes) || backendThemes.length === 0) {
    return local.map(t => ({ id: t.id, label: t.label, icon: t.icon, hasGeoView: t.hasGeoView }));
  }
  const byId = new Map(backendThemes.map(b => [b.id, b]));
  return local
    .filter(t => byId.has(t.id))
    .map(t => {
      const b = byId.get(t.id);
      return {
        id: t.id,
        label: t.label ?? b.label ?? t.id,
        icon: t.icon,
        hasGeoView: t.hasGeoView ?? b.has_geo_view ?? false,
      };
    });
}

function pickInitialTheme(themes) {
  const geo = themes.find(t => t.hasGeoView);
  if (geo) return geo.id;
  const extreme = themes.find(t => t.id === 'extreme-events');
  if (extreme) return extreme.id;
  return themes[0]?.id;
}

// ── Handlers do shell ───────────────────────────────────────────────────────
function setupShellHandlers() {
  viewMapBtn?.addEventListener('click',   () => switchView('2d'));
  viewGlobeBtn?.addEventListener('click', () => switchView('3d'));

  schemeBtnEl?.addEventListener('click', () => {
    const next = nextScheme(colorScheme);
    localStorage.setItem('color-scheme', next);
    applyColorScheme(next);
  });

  // Filtro de período sobre o mapa (delegado ao tema ativo)
  dateStartEl?.addEventListener('change', applyDateRange);
  dateEndEl?.addEventListener('change', applyDateRange);
  dateClearEl?.addEventListener('click', resetDateRange);

  // Recolher/expandir painel lateral (chrome compartilhado)
  sideToggleBtn?.addEventListener('click', () => {
    const collapsed = sidePanelEl?.classList.toggle('collapsed');
    if (sideToggleBtn) {
      sideToggleBtn.title     = collapsed ? 'Expandir painel' : 'Recolher painel';
      sideToggleBtn.ariaLabel = collapsed ? 'Expandir painel' : 'Recolher painel';
    }
  });

  themeSelectorEl?.addEventListener('change', () => {
    mountTheme(themeSelectorEl.value);
  });

  // Popover de camadas
  layersBtnEl?.addEventListener('click', (e) => {
    e.stopPropagation();
    layersPopoverEl?.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!layersPopoverEl?.classList.contains('open')) return;
    if (layersPopoverEl.contains(e.target) || layersBtnEl?.contains(e.target)) return;
    layersPopoverEl.classList.remove('open');
  });

  layersPopoverEl?.querySelectorAll('.layer-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const layer  = btn.dataset.layer;
      const active = btn.classList.toggle('active');
      if (active) activeLayers.add(layer);
      else        activeLayers.delete(layer);
      applyLayer(layer, active);
    });
  });

  // Geolocalização sob demanda
  geoBtnEl?.addEventListener('click', () => {
    if (!navigator.geolocation) return;
    geoBtnEl.classList.add('loading');
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude: lat, longitude: lng } }) => {
        geoBtnEl.classList.remove('loading');
        userLocation = { lat, lng };
        placeUserMarker(lat, lng);
        if (currentView === '2d' && worldMap) worldMap.focusOn(lat, lng, 5);
        else if (currentView === '3d' && globe) globe.focusOn(lat, lng);
        // O tema reage relendo ctx.getUserLocation() — só pedimos re-render.
        ThemeRegistry.getActive()?.renderMarkers?.();
      },
      err => {
        geoBtnEl.classList.remove('loading');
        console.warn('[Geo]', err.message);
      },
      { timeout: 10_000 },
    );
  });
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function boot() {
  setStatus('Inicializando');

  // Esquema de cor antes do primeiro paint do canvas (tokens + paleta).
  applyColorScheme(resolveInitialScheme(
    localStorage.getItem('color-scheme'),
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  ));

  // No mobile o drawer começa fechado para não encobrir o mapa.
  if (window.matchMedia('(max-width: 480px)').matches) {
    sidePanelEl?.classList.add('collapsed');
  }

  initializeMap();
  initNotifications(() => userLocation);
  setupShellHandlers();
  requestUserLocation();

  // Lista de temas: backend quando disponível; senão, fallback ao registry local.
  let backendThemes = [];
  try {
    backendThemes = await api.getThemes();
  } catch (err) {
    console.warn('[shell] /api/themes indisponível:', err.message);
  }

  const themes = resolveThemeList(backendThemes);
  populateThemeSelector(themes);

  const initialId = pickInitialTheme(themes);
  if (themeSelectorEl && initialId) themeSelectorEl.value = initialId;
  if (initialId) mountTheme(initialId);

  hideLoader();
  setStatus('Pronto');
}

boot();
