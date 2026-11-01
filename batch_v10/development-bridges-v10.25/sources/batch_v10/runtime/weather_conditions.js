(function (root) {
  'use strict';

  // Weather is deliberately separate from the track's saved surface ID. Rain
  // scales the selected surface's existing characteristics, while snow borrows
  // the established snow/ice material and handling profile at race time.
  const CONDITIONS = Object.freeze({
    dry: Object.freeze({
      id: 'dry',
      label: 'Dry',
      precipitation: 'none',
      precipitationDensity: 0,
      wetness: 0,
      lateralGripScale: 1,
      longitudinalGripScale: 1,
      lateralPeakSlipScale: 1,
      lateralSlidingGripScale: 1,
      longitudinalSlidingGripScale: 1,
      rollingResistanceScale: 1,
      surfaceDragK: 0,
      yawDampingScale: 1,
      steeringScale: 1,
      powerOversteerScale: 1,
      brakeForceScale: 1,
    }),
    'light-rain': Object.freeze({
      id: 'light-rain',
      label: 'Light Rain',
      precipitation: 'rain',
      precipitationDensity: 0.48,
      wetness: 0.58,
      lateralGripScale: 0.91,
      longitudinalGripScale: 0.88,
      lateralPeakSlipScale: 1.06,
      lateralSlidingGripScale: 0.97,
      longitudinalSlidingGripScale: 0.95,
      rollingResistanceScale: 1.005,
      surfaceDragK: 0.000006,
      yawDampingScale: 0.98,
      steeringScale: 0.99,
      powerOversteerScale: 0.88,
      brakeForceScale: 0.9,
    }),
    'heavy-rain': Object.freeze({
      id: 'heavy-rain',
      label: 'Heavy Rain',
      precipitation: 'rain',
      precipitationDensity: 1,
      wetness: 1,
      lateralGripScale: 0.79,
      longitudinalGripScale: 0.72,
      lateralPeakSlipScale: 1.16,
      lateralSlidingGripScale: 0.92,
      longitudinalSlidingGripScale: 0.88,
      rollingResistanceScale: 1.015,
      surfaceDragK: 0.000014,
      yawDampingScale: 0.94,
      steeringScale: 0.96,
      powerOversteerScale: 0.7,
      brakeForceScale: 0.78,
    }),
    snow: Object.freeze({
      id: 'snow',
      label: 'Snow',
      precipitation: 'snow',
      precipitationDensity: 0.72,
      wetness: 0,
      surfaceOverride: 'snow-ice',
      lateralGripScale: 1,
      longitudinalGripScale: 1,
      lateralPeakSlipScale: 1,
      lateralSlidingGripScale: 1,
      longitudinalSlidingGripScale: 1,
      rollingResistanceScale: 1,
      surfaceDragK: 0,
      yawDampingScale: 1,
      steeringScale: 1,
      powerOversteerScale: 1,
      brakeForceScale: 1,
    }),
  });

  const ALIASES = Object.freeze({
    clear: 'dry',
    none: 'dry',
    light: 'light-rain',
    rain: 'light-rain',
    drizzle: 'light-rain',
    heavy: 'heavy-rain',
    storm: 'heavy-rain',
    downpour: 'heavy-rain',
    snowy: 'snow',
    winter: 'snow',
  });

  function normalizeWeatherId(value) {
    if (typeof value === 'string' && CONDITIONS[value]) return value;
    const raw = String(value || 'dry').trim().toLowerCase().replace(/[_\s]+/g, '-');
    const normalized = ALIASES[raw] || raw;
    return CONDITIONS[normalized] ? normalized : 'dry';
  }

  function getCondition(value) {
    return CONDITIONS[normalizeWeatherId(value)] || CONDITIONS.dry;
  }

  function getEffectiveSurfaceId(surfaceId, weatherId) {
    const condition = getCondition(weatherId);
    return condition.surfaceOverride || surfaceId || 'tarmac-pro';
  }

  root.RacerWeatherConditions = Object.freeze({
    version: 1,
    conditions: CONDITIONS,
    normalizeWeatherId,
    getCondition,
    getEffectiveSurfaceId,
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
