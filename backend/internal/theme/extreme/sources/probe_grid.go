package sources

// ProbePoint is a geographic probe location used by grid-based sources.
type ProbePoint struct {
	Name string
	Lat  float64
	Lng  float64
}

// PROBE_GRID is a set of 57 globally-distributed probe points used by
// Open-Meteo (weather extremes) and Open-Meteo Air Quality sources.
// Ported from public/js/api/openmeteo.js.
var PROBE_GRID = []ProbePoint{
	// América do Norte
	{Name: "Yukon", Lat: 60.0, Lng: -135.0},
	{Name: "BC Interior", Lat: 55.0, Lng: -120.0},
	{Name: "Great Plains", Lat: 45.0, Lng: -100.0},
	{Name: "Central US", Lat: 35.0, Lng: -95.0},
	{Name: "Gulf Coast", Lat: 30.0, Lng: -90.0},
	{Name: "SE US", Lat: 25.0, Lng: -80.0},
	{Name: "NE US", Lat: 45.0, Lng: -75.0},
	{Name: "Atlantic Canada", Lat: 50.0, Lng: -60.0},

	// América Central e Caribe
	{Name: "Caribbean", Lat: 20.0, Lng: -75.0},
	{Name: "Central America", Lat: 15.0, Lng: -85.0},
	{Name: "Venezuela Coast", Lat: 10.0, Lng: -65.0},

	// América do Sul
	{Name: "Amazon Basin", Lat: -5.0, Lng: -55.0},
	{Name: "Brazil Central", Lat: -15.0, Lng: -50.0},
	{Name: "São Paulo", Lat: -23.5, Lng: -46.6},
	{Name: "Santiago", Lat: -33.5, Lng: -70.7},
	{Name: "Patagonia", Lat: -40.0, Lng: -63.0},
	{Name: "Tierra del Fuego", Lat: -55.0, Lng: -68.0},
	{Name: "Lima", Lat: -12.0, Lng: -77.0},

	// Europa
	{Name: "Scandinavia", Lat: 65.0, Lng: 25.0},
	{Name: "Denmark", Lat: 55.0, Lng: 10.0},
	{Name: "London", Lat: 52.0, Lng: 0.0},
	{Name: "Paris", Lat: 48.0, Lng: 2.4},
	{Name: "Istanbul", Lat: 41.0, Lng: 29.0},
	{Name: "Madrid", Lat: 40.4, Lng: -3.7},
	{Name: "Tallinn", Lat: 59.0, Lng: 28.0},

	// África
	{Name: "Algiers", Lat: 36.0, Lng: 3.0},
	{Name: "Sudan", Lat: 15.0, Lng: 30.0},
	{Name: "Congo Basin", Lat: 0.0, Lng: 20.0},
	{Name: "Angola", Lat: -10.0, Lng: 25.0},
	{Name: "Johannesburg", Lat: -26.0, Lng: 28.0},
	{Name: "Cape Town", Lat: -34.0, Lng: 18.5},
	{Name: "Nairobi", Lat: -3.0, Lng: 37.0},

	// Oriente Médio e Ásia Central
	{Name: "Arabian Peninsula", Lat: 30.0, Lng: 45.0},
	{Name: "UAE", Lat: 25.0, Lng: 55.0},
	{Name: "Iran", Lat: 35.0, Lng: 60.0},
	{Name: "Kazakhstan", Lat: 40.0, Lng: 70.0},

	// Ásia do Sul
	{Name: "New Delhi", Lat: 28.6, Lng: 77.2},
	{Name: "India Central", Lat: 23.0, Lng: 80.0},
	{Name: "Chennai", Lat: 12.0, Lng: 80.0},
	{Name: "Sri Lanka", Lat: 7.0, Lng: 80.0},

	// Ásia Oriental
	{Name: "Tokyo", Lat: 35.7, Lng: 139.7},
	{Name: "Shanghai", Lat: 31.2, Lng: 121.5},
	{Name: "Hong Kong", Lat: 22.0, Lng: 114.0},
	{Name: "Novosibirsk", Lat: 55.0, Lng: 82.0},

	// Sudeste Asiático e Pacífico
	{Name: "Singapore", Lat: 1.3, Lng: 103.8},
	{Name: "Manila", Lat: 14.0, Lng: 120.0},
	{Name: "Jakarta", Lat: -6.0, Lng: 107.0},
	{Name: "Australia Interior", Lat: -25.0, Lng: 130.0},
	{Name: "Melbourne", Lat: -37.8, Lng: 145.0},

	// Oceano / Polos
	{Name: "Iceland", Lat: 70.0, Lng: -20.0},
	{Name: "Alaska", Lat: 65.0, Lng: -170.0},
	{Name: "Sub-Antarctic", Lat: -60.0, Lng: 10.0},
	{Name: "Antarctic Peninsula", Lat: -70.0, Lng: -60.0},

	// Zona tropical
	{Name: "Bali", Lat: -8.0, Lng: 115.0},
	{Name: "Indochina", Lat: 20.0, Lng: 100.0},
}
