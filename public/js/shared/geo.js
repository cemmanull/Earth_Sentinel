// geo.js — reexporta utilitários geográficos puros. events.js permanece a
// fonte canônica de haversineKm e getDecayFactor; este módulo apenas oferece um
// ponto de import estável sob shared/ para temas e shell.
export { haversineKm, getDecayFactor } from '../events.js';
