// Fixtures reutilizáveis — representativos do formato real das APIs

export const FEATURE_USGS_M6 = {
  id: 'us2024abc123',
  type: 'Feature',
  properties: {
    mag:    6.2,
    place:  '50 km S of Santiago, Chile',
    time:   1700000000000,
    title:  'M 6.2 - 50 km S of Santiago, Chile',
    status: 'reviewed',
  },
  geometry: { type: 'Point', coordinates: [-70.6, -33.9, 15.0] },  // [lng, lat, depth]
}

export const FEATURE_USGS_M8 = {
  id: 'us2024def456',
  type: 'Feature',
  properties: {
    mag:    8.1,
    place:  '80 km NE de Sendai, Japão',
    time:   1700000000000,
    title:  'M 8.1 - 80 km NE de Sendai, Japão',
    status: 'reviewed',
  },
  geometry: { type: 'Point', coordinates: [142.0, 38.0, 30.0] },
}

export const FEATURE_USGS_M3 = {
  id: 'us2024ghi789',
  type: 'Feature',
  properties: { mag: 3.1, place: 'Oklahoma, USA', time: 1700000000000, title: 'M 3.1', status: 'automatic' },
  geometry: { type: 'Point', coordinates: [-97.0, 35.0, 5.0] },
}

export const EVENTO_TERREMOTO = {
  id:          'usgs-us2024abc',
  type:        'earthquake',
  category:    'geológico',
  severity:    4,
  confidence:  0.99,
  latitude:    -33.9,
  longitude:   -70.6,
  radiusKm:    200,
  startTime:   new Date(Date.now() - 3_600_000),
  source:      'USGS',
  title:       'M 6.2 - 50 km S of Santiago, Chile',
  description: 'Magnitude 6.2, profundidade 15 km.',
}

export const EVENTO_FURACAO = {
  id:          'mock-hurricane-001',
  type:        'hurricane',
  category:    'meteorológico',
  severity:    5,
  confidence:  0.92,
  latitude:    15.5,
  longitude:   -45.2,
  radiusKm:    300,
  startTime:   new Date(Date.now() - 7_200_000),
  source:      'NOAA SWPC',
  title:       'Furacão Categoria 4 - Atlântico',
  description: 'Sistema de baixa pressão intenso em movimento noroeste.',
}

export const EVENTO_EXPIRADO = {
  id:        'mock-old-001',
  type:      'earthquake',
  category:  'geológico',
  severity:  2,
  confidence:0.99,
  latitude:  0,
  longitude: 0,
  radiusKm:  100,
  startTime: new Date(Date.now() - 200 * 3_600_000),  // 200h atrás — além do maxAge de earthquake (168h)
  source:    'USGS',
  title:     'Evento expirado',
  description: '',
}

export function getMockEvents() {
  return [EVENTO_TERREMOTO, EVENTO_FURACAO]
}
