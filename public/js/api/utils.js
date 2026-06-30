export function fetchJSON(url, options = {}) {
  return fetch(url, options).then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  })
}

export function truncate(str, max) {
  const s = String(str)
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

const CATEGORY_MAP = {
  hurricane:         'meteorológico',
  tornado:           'meteorológico',
  severe_storm:      'meteorológico',
  heat_wave:         'meteorológico',
  cold_wave:         'meteorológico',
  flood:             'meteorológico',
  drought:           'meteorológico',
  earthquake:        'geológico',
  volcano:           'geológico',
  tsunami:           'geológico',
  wildfire:          'atmosférico',
  dust_storm:        'atmosférico',
  air_pollution:     'atmosférico',
  solar_flare:       'espacial',
  cme:               'espacial',
  geomagnetic_storm: 'espacial',
  radiation_storm:   'espacial',
  radio_blackout:    'espacial',
}

export function mapCategory(type) {
  return CATEGORY_MAP[type] ?? 'outro'
}
