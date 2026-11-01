import '../weather_conditions.js';

const ASPHALT_PROFILE = Object.freeze({
  id: 'tarmac-pro',
  label: 'Asphalt Pro',
  lateralGripScale: 1,
  longitudinalGripScale: 1,
  lateralPeakSlip: 0.14,
  lateralSlidingGrip: 1,
  longitudinalSlidingGrip: 1,
  rollingResistanceScale: 1,
  surfaceDragK: 0,
  yawDampingScale: 1,
  steeringScale: 1,
  powerOversteerScale: 0.35,
  brakeForceScale: 1,
});

// These values are relative to each vehicle's existing road-tire setup rather than
// absolute real-world coefficients. The profile shape follows the same split used by
// vehicle simulators: peak/static grip, sliding grip, slip at the peak, rolling loss,
// and deformable-surface drag are independently tunable.
// Competition tires on packed racing surfaces: earlier lateral force buildup keeps
// turn-in responsive, while broad post-peak grip lets slides carry momentum. Peak
// lateral grip remains lower than asphalt; forward bite is independently tuned.
const TRACK_SURFACE_PROFILES = Object.freeze({
  'tarmac-pro': ASPHALT_PROFILE,
  'concrete-oval': Object.freeze({
    id: 'concrete-oval',
    label: 'Concrete Oval',
    lateralGripScale: 0.98,
    longitudinalGripScale: 0.98,
    lateralPeakSlip: 0.125,
    lateralSlidingGrip: 0.94,
    longitudinalSlidingGrip: 0.94,
    rollingResistanceScale: 1.05,
    surfaceDragK: 0.00002,
    yawDampingScale: 0.98,
    steeringScale: 0.98,
    powerOversteerScale: 0.33,
    brakeForceScale: 0.98,
  }),
  'dirt-oval': Object.freeze({
    id: 'dirt-oval',
    label: 'Dirt Oval',
    lateralGripScale: 0.74,
    longitudinalGripScale: 0.74,
    lateralPeakSlip: 0.225,
    lateralSlidingGrip: 0.88,
    longitudinalSlidingGrip: 0.92,
    rollingResistanceScale: 1.18,
    surfaceDragK: 0.00004,
    yawDampingScale: 0.92,
    steeringScale: 1,
    powerOversteerScale: 0.28,
    brakeForceScale: 0.88,
  }),
  'gravel-rally': Object.freeze({
    id: 'gravel-rally',
    label: 'Gravel Rally',
    lateralGripScale: 0.69,
    longitudinalGripScale: 0.68,
    lateralPeakSlip: 0.23,
    lateralSlidingGrip: 0.94,
    longitudinalSlidingGrip: 0.9,
    rollingResistanceScale: 1.26,
    surfaceDragK: 0.00006,
    yawDampingScale: 0.88,
    steeringScale: 0.98,
    powerOversteerScale: 0.23,
    brakeForceScale: 0.82,
  }),
  'snow-ice': Object.freeze({
    id: 'snow-ice',
    label: 'Snow & Ice',
    lateralGripScale: 0.58,
    longitudinalGripScale: 0.57,
    lateralPeakSlip: 0.235,
    lateralSlidingGrip: 0.92,
    longitudinalSlidingGrip: 0.88,
    rollingResistanceScale: 1.2,
    surfaceDragK: 0.000045,
    yawDampingScale: 0.84,
    steeringScale: 0.96,
    powerOversteerScale: 0.18,
    brakeForceScale: 0.72,
  }),
});

const SURFACE_ALIASES = Object.freeze({
  default: 'tarmac-pro',
  tarmac: 'tarmac-pro',
  asphalt: 'tarmac-pro',
  'tarmac-fresh': 'tarmac-pro',
  'tarmac-worn': 'tarmac-pro',
  vintage: 'tarmac-pro',
  modern: 'tarmac-pro',
  night: 'tarmac-pro',
  concrete: 'concrete-oval',
  dirt: 'dirt-oval',
  gravel: 'gravel-rally',
  snow: 'snow-ice',
  ice: 'snow-ice',
});

const WEATHER_API = globalThis.RacerWeatherConditions;
const WEATHER_CONDITIONS = WEATHER_API
  ? WEATHER_API.conditions
  : Object.freeze({ dry: Object.freeze({ id: 'dry' }) });
const WEATHER_ADJUSTED_PROFILE_CACHE = new Map();
const BLENDED_PROFILE_CACHE = new Map();
const BLEND_STEPS = 16;
const BLENDED_PROFILE_FIELDS = Object.freeze([
  'lateralGripScale',
  'longitudinalGripScale',
  'lateralPeakSlip',
  'lateralSlidingGrip',
  'longitudinalSlidingGrip',
  'rollingResistanceScale',
  'surfaceDragK',
  'yawDampingScale',
  'steeringScale',
  'powerOversteerScale',
  'brakeForceScale',
]);

function normalizeSurfaceId(surfaceId) {
  if (typeof surfaceId === 'string' && TRACK_SURFACE_PROFILES[surfaceId]) return surfaceId;
  const raw = String(surfaceId || 'default').trim().toLowerCase();
  const canonical = SURFACE_ALIASES[raw] || raw;
  return TRACK_SURFACE_PROFILES[canonical] ? canonical : 'tarmac-pro';
}

function normalizeWeatherId(weatherId) {
  if (typeof weatherId === 'string' && WEATHER_CONDITIONS[weatherId]) return weatherId;
  return WEATHER_API && typeof WEATHER_API.normalizeWeatherId === 'function'
    ? WEATHER_API.normalizeWeatherId(weatherId)
    : 'dry';
}

function getWeatherCondition(weatherId) {
  const normalized = normalizeWeatherId(weatherId);
  return WEATHER_CONDITIONS[normalized] || WEATHER_CONDITIONS.dry;
}

function getWeatherIdFromState(surface) {
  if (!surface || typeof surface !== 'object') return 'dry';
  return normalizeWeatherId(surface.weatherId || surface.weather || surface.condition);
}

function getTrackSurfaceProfile(surfaceId, weatherId = 'dry') {
  const base = TRACK_SURFACE_PROFILES[normalizeSurfaceId(surfaceId)] || ASPHALT_PROFILE;
  const condition = getWeatherCondition(weatherId);
  if (!condition || condition.id === 'dry') return base;

  const cacheKey = `${base.id}:${condition.id}`;
  const cached = WEATHER_ADJUSTED_PROFILE_CACHE.get(cacheKey);
  if (cached) return cached;

  const overrideId = condition.surfaceOverride
    ? normalizeSurfaceId(condition.surfaceOverride)
    : null;
  const source = overrideId ? TRACK_SURFACE_PROFILES[overrideId] : base;
  const adjusted = Object.freeze({
    ...source,
    id: overrideId || base.id,
    trackSurfaceId: base.id,
    weatherId: condition.id,
    lateralGripScale: source.lateralGripScale * (condition.lateralGripScale || 1),
    longitudinalGripScale:
      source.longitudinalGripScale * (condition.longitudinalGripScale || 1),
    lateralPeakSlip: source.lateralPeakSlip * (condition.lateralPeakSlipScale || 1),
    lateralSlidingGrip:
      source.lateralSlidingGrip * (condition.lateralSlidingGripScale || 1),
    longitudinalSlidingGrip:
      source.longitudinalSlidingGrip * (condition.longitudinalSlidingGripScale || 1),
    rollingResistanceScale:
      source.rollingResistanceScale * (condition.rollingResistanceScale || 1),
    surfaceDragK: source.surfaceDragK + (condition.surfaceDragK || 0),
    yawDampingScale: source.yawDampingScale * (condition.yawDampingScale || 1),
    steeringScale: source.steeringScale * (condition.steeringScale || 1),
    powerOversteerScale:
      source.powerOversteerScale * (condition.powerOversteerScale || 1),
    brakeForceScale: source.brakeForceScale * (condition.brakeForceScale || 1),
  });
  WEATHER_ADJUSTED_PROFILE_CACHE.set(cacheKey, adjusted);
  return adjusted;
}

function getSurfaceIdFromState(surface) {
  if (typeof surface === 'string') return normalizeSurfaceId(surface);
  if (!surface || typeof surface !== 'object') return 'tarmac-pro';
  return normalizeSurfaceId(
    surface.surfaceType || surface.trackSurfaceId || surface.textureId || surface.id,
  );
}

function getWeightedTrackSurfaceProfile(weights, weatherId) {
  const amounts = new Map();
  for (const entry of weights) {
    const id = normalizeSurfaceId(entry.surfaceId), amount = Math.max(0, Number(entry.weight) || 0);
    if (amount > 0) amounts.set(id, (amounts.get(id) || 0) + amount);
  }
  const sum = [...amounts.values()].reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return null;
  const components = [...amounts].map(([id, weight]) => [id, Math.round(weight / sum * BLEND_STEPS)])
    .filter(([, amount]) => amount > 0).sort((a, b) => a[0].localeCompare(b[0]));
  const total = components.reduce((value, [, amount]) => value + amount, 0);
  const key = `weights:${normalizeWeatherId(weatherId)}:${components.map(entry => entry.join(':')).join('|')}`;
  const cached = BLENDED_PROFILE_CACHE.get(key);
  if (cached) return cached;
  const dominant = components.reduce((best, entry) => entry[1] > best[1] ? entry : best);
  const blended = { ...getTrackSurfaceProfile(dominant[0], weatherId) };
  for (const field of BLENDED_PROFILE_FIELDS) blended[field] = components.reduce((value, [id, amount]) =>
    value + getTrackSurfaceProfile(id, weatherId)[field] * amount / total, 0);
  const frozen = Object.freeze(blended);
  BLENDED_PROFILE_CACHE.set(key, frozen);
  return frozen;
}

function getTrackSurfaceProfileFromState(surface) {
  const surfaceId = getSurfaceIdFromState(surface);
  const weatherId = getWeatherIdFromState(surface);
  if (Array.isArray(surface && surface.surfaceWeights)) {
    const weighted = getWeightedTrackSurfaceProfile(surface.surfaceWeights, weatherId);
    if (weighted) return weighted;
  }
  const primary = getTrackSurfaceProfile(surfaceId, weatherId);
  if (!surface || typeof surface !== 'object' || !surface.surfaceBlendTo) return primary;

  const blendToId = normalizeSurfaceId(surface.surfaceBlendTo);
  const blend = Math.max(0, Math.min(1, Number(surface.surfaceBlend) || 0));
  if (blend <= 0 || blendToId === surfaceId) return primary;
  if (blend >= 1) return getTrackSurfaceProfile(blendToId, weatherId);

  const step = Math.max(1, Math.min(BLEND_STEPS - 1, Math.round(blend * BLEND_STEPS)));
  const quantizedBlend = step / BLEND_STEPS;
  const cacheKey = `${surfaceId}:${blendToId}:${normalizeWeatherId(weatherId)}:${step}`;
  const cached = BLENDED_PROFILE_CACHE.get(cacheKey);
  if (cached) return cached;

  const secondary = getTrackSurfaceProfile(blendToId, weatherId);
  const current = quantizedBlend >= 0.5 ? secondary : primary;
  const blended = {
    ...current,
    id: current.id,
    trackSurfaceId: current.trackSurfaceId || (quantizedBlend >= 0.5 ? blendToId : surfaceId),
    blendFromSurfaceId: surfaceId,
    blendToSurfaceId: blendToId,
    surfaceBlend: quantizedBlend,
  };
  for (const field of BLENDED_PROFILE_FIELDS) {
    blended[field] = primary[field] + (secondary[field] - primary[field]) * quantizedBlend;
  }
  const frozen = Object.freeze(blended);
  BLENDED_PROFILE_CACHE.set(cacheKey, frozen);
  return frozen;
}

function applyTrackSurfaceToVehicleDefaults(defaults, surfaceId, weatherId = 'dry') {
  if (!defaults || typeof defaults !== 'object') return null;
  const profile =
    surfaceId && typeof surfaceId === 'object'
      ? getTrackSurfaceProfileFromState({
          ...surfaceId,
          weatherId: surfaceId.weatherId || weatherId,
        })
      : getTrackSurfaceProfile(surfaceId, weatherId);
  const adjusted = {
    ...defaults,
    touchSteer:
      defaults.touchSteer && typeof defaults.touchSteer === 'object'
        ? { ...defaults.touchSteer }
        : defaults.touchSteer,
  };

  if (Number.isFinite(Number(defaults.muLatRoad))) {
    adjusted.muLatRoad = Number(defaults.muLatRoad) * profile.lateralGripScale;
  }
  if (Number.isFinite(Number(defaults.muLongRoad))) {
    adjusted.muLongRoad = Number(defaults.muLongRoad) * profile.longitudinalGripScale;
  }
  if (Number.isFinite(Number(defaults.rollK))) {
    adjusted.rollK = Number(defaults.rollK) * profile.rollingResistanceScale;
  }
  if (Number.isFinite(Number(defaults.brakeForce))) {
    adjusted.brakeForce = Number(defaults.brakeForce) * profile.brakeForceScale;
  }
  if (Number.isFinite(Number(defaults.yawDampK))) {
    adjusted.yawDampK = Number(defaults.yawDampK) * profile.yawDampingScale;
  }
  if (Number.isFinite(Number(defaults.maxSteer))) {
    adjusted.maxSteer = Number(defaults.maxSteer) * profile.steeringScale;
  }
  if (adjusted.touchSteer && typeof adjusted.touchSteer === 'object') {
    if (Number.isFinite(Number(adjusted.touchSteer.maxSteerLowSpeed))) {
      adjusted.touchSteer.maxSteerLowSpeed =
        Number(adjusted.touchSteer.maxSteerLowSpeed) * profile.steeringScale;
    }
    if (Number.isFinite(Number(adjusted.touchSteer.maxSteerHighSpeed))) {
      adjusted.touchSteer.maxSteerHighSpeed =
        Number(adjusted.touchSteer.maxSteerHighSpeed) * profile.steeringScale;
    }
  }

  adjusted.surfaceDragK = profile.surfaceDragK;
  adjusted.trackSurfaceLateralGripScale = profile.lateralGripScale;
  adjusted.trackSurfaceLongitudinalGripScale = profile.longitudinalGripScale;
  adjusted.trackSurfaceId = profile.id;
  adjusted.baseTrackSurfaceId = profile.trackSurfaceId || profile.id;
  adjusted.weatherId = normalizeWeatherId(weatherId);
  return adjusted;
}

export {
  TRACK_SURFACE_PROFILES,
  WEATHER_CONDITIONS,
  applyTrackSurfaceToVehicleDefaults,
  getSurfaceIdFromState,
  getTrackSurfaceProfile,
  getTrackSurfaceProfileFromState,
  getWeatherCondition,
  getWeatherIdFromState,
  normalizeSurfaceId,
  normalizeWeatherId,
};
