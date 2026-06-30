import { fetchUSGSEarthquakes }  from './api/usgs.js'
import { fetchGDACSEvents }      from './api/gdacs.js'
import { fetchNOAAEvents }       from './api/noaa.js'
import { fetchEONETEvents }      from './api/eonet.js'
import { fetchOpenMeteoEvents }  from './api/openmeteo.js'
import { fetchAirQualityEvents } from './api/airquality.js'

export const DATA_SOURCES = [
  {
    id:         'noaa-swpc',
    name:       'NOAA SWPC',
    critical:   true,
    loadEvents: async () => fetchNOAAEvents(),   // retorna { events, clima }
  },
  {
    id:         'usgs',
    name:       'USGS',
    critical:   true,
    loadEvents: async () => ({ events: await fetchUSGSEarthquakes() }),
  },
  {
    id:         'gdacs',
    name:       'GDACS',
    critical:   false,
    loadEvents: async () => ({ events: await fetchGDACSEvents() }),
  },
  {
    id:         'nasa-eonet',
    name:       'NASA EONET',
    critical:   false,
    loadEvents: async () => ({ events: await fetchEONETEvents() }),
  },
  {
    id:         'open-meteo',
    name:       'Open-Meteo',
    critical:   false,
    loadEvents: async () => ({ events: await fetchOpenMeteoEvents() }),
  },
  {
    id:         'open-meteo-aq',
    name:       'Open-Meteo AQ',
    critical:   false,
    loadEvents: async () => ({ events: await fetchAirQualityEvents() }),
  },
]
