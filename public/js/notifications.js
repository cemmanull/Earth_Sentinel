/**
 * Notificações — regras por localização + tipos de evento
 * Gerencia o modal de configuração e dispara browser Notifications.
 */
import { haversineKm } from './events.js'

const STORAGE_KEY  = 'es_notif_rules'
const NOTIFIED_KEY = 'es_notified_session'

const EVENT_TYPES_UI = [
  { type: 'earthquake',    icon: '🌍', name: 'Terremoto' },
  { type: 'volcano',       icon: '🌋', name: 'Vulcão' },
  { type: 'tsunami',       icon: '🌊', name: 'Tsunami' },
  { type: 'hurricane',     icon: '🌀', name: 'Furacão' },
  { type: 'tornado',       icon: '🌪️', name: 'Tornado' },
  { type: 'severe_storm',  icon: '⛈️', name: 'Tempestade' },
  { type: 'heat_wave',     icon: '🌡️', name: 'Onda de calor' },
  { type: 'cold_wave',     icon: '❄️', name: 'Onda de frio' },
  { type: 'flood',         icon: '💧', name: 'Inundação' },
  { type: 'drought',       icon: '🏜️', name: 'Seca' },
  { type: 'wildfire',      icon: '🔥', name: 'Incêndio' },
  { type: 'dust_storm',    icon: '💨', name: 'Temp. areia' },
  { type: 'air_pollution', icon: '🌫️', name: 'Poluição' },
]

// ── Persistência ──────────────────────────────────────────────────────────────

function loadRules() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}

function saveRules(rules) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules))
}

function loadNotifiedIds() {
  try { return new Set(JSON.parse(sessionStorage.getItem(NOTIFIED_KEY) ?? '[]')) } catch { return new Set() }
}

function saveNotifiedIds(ids) {
  sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify([...ids]))
}

function newRule(overrides = {}) {
  return {
    id:          'rule-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    label:       '',
    lat:         0,
    lng:         0,
    radiusKm:    300,
    types:       EVENT_TYPES_UI.map(t => t.type),
    minSeverity: 3,
    ...overrides,
  }
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderPermBanner(bannerEl) {
  if (!bannerEl) return
  if (!('Notification' in window)) {
    bannerEl.hidden = false
    bannerEl.innerHTML = '<p class="notif-perm-text">Notificações não suportadas neste navegador.</p>'
    return
  }
  if (Notification.permission === 'granted') { bannerEl.hidden = true; return }
  bannerEl.hidden = false
  const blocked = Notification.permission === 'denied'
  bannerEl.innerHTML =
    `<p class="notif-perm-text">${blocked
      ? 'Notificações bloqueadas. Habilite nas configurações do navegador.'
      : 'Permita notificações para receber alertas de eventos críticos.'
    }</p>` +
    (!blocked ? `<button class="notif-perm-btn" id="grantNotifBtn">Ativar</button>` : '')
  bannerEl.querySelector('#grantNotifBtn')?.addEventListener('click', async () => {
    await Notification.requestPermission()
    renderPermBanner(bannerEl)
  })
}

function makeRuleCard(rule, onUpdate, onRemove) {
  const card = document.createElement('div')
  card.className = 'notif-card'
  card.dataset.ruleId = rule.id

  const typesHtml = EVENT_TYPES_UI.map(({ type, icon, name }) => {
    const on = rule.types.includes(type)
    return `<label class="notif-type-cb${on ? ' notif-type-on' : ''}">` +
      `<input type="checkbox" data-t="${esc(type)}"${on ? ' checked' : ''}>${icon} ${esc(name)}` +
      `</label>`
  }).join('')

  const sevHtml = [1, 2, 3, 4, 5].map(s =>
    `<button class="notif-sev-btn${rule.minSeverity === s ? ' active' : ''}" data-sev="${s}">${s}</button>`
  ).join('')

  card.innerHTML =
    `<div class="notif-card-header">` +
      `<input class="notif-label-inp" type="text" placeholder="Nome do local (opcional)" value="${esc(rule.label)}" data-f="label">` +
      `<button class="notif-remove" title="Remover local">✕</button>` +
    `</div>` +
    `<div class="notif-coords-row">` +
      `<label class="notif-coord-lbl">Lat<input class="notif-coord" type="number" step="0.0001" min="-90"  max="90"   value="${rule.lat}"      data-f="lat"></label>` +
      `<label class="notif-coord-lbl">Lng<input class="notif-coord" type="number" step="0.0001" min="-180" max="180"  value="${rule.lng}"      data-f="lng"></label>` +
      `<label class="notif-coord-lbl">Raio km<input class="notif-coord" type="number" step="50" min="50" max="5000"  value="${rule.radiusKm}" data-f="radiusKm"></label>` +
    `</div>` +
    `<div class="notif-sev-row">` +
      `<span class="notif-field-lbl">Sev. mínima</span>` +
      `<div class="notif-sev-btns">${sevHtml}</div>` +
    `</div>` +
    `<div class="notif-types">${typesHtml}</div>` +
    `<div class="notif-types-actions">` +
      `<button class="notif-bulk-btn" data-bulk="all">Todos</button>` +
      `<button class="notif-bulk-btn" data-bulk="none">Nenhum</button>` +
    `</div>`

  // Remove
  card.querySelector('.notif-remove').addEventListener('click', () => onRemove(rule.id))

  // Text / number fields
  card.querySelectorAll('[data-f]').forEach(inp => {
    inp.addEventListener('change', () => {
      const f = inp.dataset.f
      const v = inp.type === 'number' ? parseFloat(inp.value) : inp.value
      if (f === 'lat'      && (isNaN(v) || v < -90  || v > 90))  return
      if (f === 'lng'      && (isNaN(v) || v < -180 || v > 180)) return
      if (f === 'radiusKm' && (isNaN(v) || v < 50))              return
      onUpdate(rule.id, { [f]: v })
    })
  })

  // Severity
  card.querySelectorAll('.notif-sev-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      card.querySelectorAll('.notif-sev-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      onUpdate(rule.id, { minSeverity: parseInt(btn.dataset.sev) })
    })
  })

  // Type checkboxes
  function syncTypes() {
    const checked = [...card.querySelectorAll('.notif-type-cb input:checked')].map(i => i.dataset.t)
    onUpdate(rule.id, { types: checked })
    card.querySelectorAll('.notif-type-cb').forEach(lbl => {
      lbl.classList.toggle('notif-type-on', lbl.querySelector('input').checked)
    })
  }
  card.querySelectorAll('.notif-type-cb input').forEach(cb => cb.addEventListener('change', syncTypes))
  card.querySelectorAll('.notif-bulk-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const all = btn.dataset.bulk === 'all'
      card.querySelectorAll('.notif-type-cb input').forEach(cb => { cb.checked = all })
      syncTypes()
    })
  })

  return card
}

function renderList(listEl, rules, onUpdate, onRemove) {
  listEl.innerHTML = ''
  if (rules.length === 0) {
    const p = document.createElement('p')
    p.className = 'notif-empty'
    p.textContent = 'Nenhum local configurado. Clique em "Adicionar local" para monitorar uma região.'
    listEl.appendChild(p)
    return
  }
  rules.forEach(r => listEl.appendChild(makeRuleCard(r, onUpdate, onRemove)))
}

// ── API pública ───────────────────────────────────────────────────────────────

export function checkNotifications(events) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const rules = loadRules()
  if (!rules.length) return

  const notified = loadNotifiedIds()
  const now      = Date.now()
  const TWO_H    = 2 * 3_600_000

  for (const rule of rules) {
    if (!rule.lat && !rule.lng) continue
    const matches = events.filter(e => {
      if (notified.has(e.id))                                       return false
      if (e.severity < (rule.minSeverity ?? 3))                     return false
      if (rule.types.length && !rule.types.includes(e.type))        return false
      if (e.startTime && (now - e.startTime.getTime()) > TWO_H)     return false
      return haversineKm(e.latitude, e.longitude, rule.lat, rule.lng) <= (rule.radiusKm ?? 300)
    })
    const label = rule.label || `${rule.lat.toFixed(2)}°, ${rule.lng.toFixed(2)}°`
    for (const e of matches) {
      notified.add(e.id)
      const icon = EVENT_TYPES_UI.find(t => t.type === e.type)?.icon ?? '⚠️'
      try {
        new Notification(`${icon} ${e.title}`, {
          body: `${label} · ${e.source} · severidade ${e.severity}`,
          icon: '/icons/icon.svg',
          tag:  e.id,
        })
      } catch { /* navegador sem suporte */ }
    }
  }
  saveNotifiedIds(notified)
}

export function initNotifications(getUserLocation) {
  const modal    = document.getElementById('notifModal')
  const notifBtn = document.getElementById('notifBtn')
  if (!modal || !notifBtn) return

  const bannerEl  = modal.querySelector('#notifPermBanner')
  const listEl    = modal.querySelector('#notifRulesList')
  const addBtn    = modal.querySelector('#addNotifRule')
  const closeBtn  = modal.querySelector('#closeNotifModal')

  let rules = loadRules()

  const saveBtn      = modal.querySelector('#saveNotifRules')
  const feedbackEl   = modal.querySelector('#notifSaveFeedback')
  let   feedbackTimer = null

  function persist() { saveRules(rules) }

  function onUpdate(id, patch) {
    const r = rules.find(r => r.id === id)
    if (r) Object.assign(r, patch)
    // Alterações ficam em memória até o botão Salvar ser clicado
  }

  function onRemove(id) {
    rules = rules.filter(r => r.id !== id)
    render()
  }

  function render() {
    renderPermBanner(bannerEl)
    renderList(listEl, rules, onUpdate, onRemove)
    notifBtn.classList.toggle('notif-btn-active', loadRules().length > 0)
  }

  function showFeedback(ok) {
    if (feedbackTimer) clearTimeout(feedbackTimer)
    feedbackEl.textContent = ok ? '✓ Configurações salvas' : ''
    feedbackEl.className   = 'notif-save-feedback' + (ok ? ' notif-save-ok' : '')
    feedbackTimer = setTimeout(() => { feedbackEl.textContent = '' }, 2000)
  }

  saveBtn.addEventListener('click', () => {
    persist()
    notifBtn.classList.toggle('notif-btn-active', rules.length > 0)
    saveBtn.disabled    = true
    saveBtn.textContent = 'Salvo ✓'
    showFeedback(true)
    setTimeout(() => {
      saveBtn.disabled    = false
      saveBtn.textContent = 'Salvar configurações'
    }, 1500)
  })

  addBtn.addEventListener('click', () => {
    const loc = getUserLocation?.()
    const r   = newRule(loc
      ? { lat: parseFloat(loc.lat.toFixed(4)), lng: parseFloat(loc.lng.toFixed(4)) }
      : {}
    )
    rules.push(r)
    render()
    listEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })

  const openModal = () => {
    rules = loadRules()   // descarta alterações não salvas da sessão anterior
    modal.hidden = false
    render()
  }
  closeBtn.addEventListener('click', () => { modal.hidden = true })
  modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true })
  notifBtn.addEventListener('click', openModal)

  render()
}
