import { createWorld, stepWorld, meters, pixels, PPM_DEFAULT } from './physics/planckWorld.js';
import { buildTrackBodies } from './trackCollision.js';
import { Gearbox, gearboxDefaults, updateGearbox, getDriveForce, GEARBOX_CONFIG, suggestGearRatios } from './gearbox.js';
import {
  TRACK_SURFACE_PROFILES,
  applyTrackSurfaceToVehicleDefaults,
  getSurfaceIdFromState,
  getTrackSurfaceProfile,
  getTrackSurfaceProfileFromState,
  getWeatherIdFromState,
  normalizeWeatherId,
  WEATHER_CONDITIONS,
} from './physics/trackSurface.js?v=loose-surface-response-20260924-1';

(function () {
  "use strict";
  const DEV_TOOLS_ENABLED = globalThis.RACING_VIBES_BUILD?.devToolsEnabled !== false;
  /*
   Summary of physics changes (2025-10):
   - Longitudinal slip-ratio response replaces hard traction clamp (smooth build-up/peak/falloff)
   - Combined-slip ellipse applied to front axle (rear already existed); rear ellipse now uses wheel-originated Fx
   - Tire load sensitivity: effective mu decreases slightly as Fz increases
   - Downforce (downforceK) contributes to axle loads based on speed
   - Analog throttle/brake inputs supported (0..1)
   New params per vehicle (with defaults):
     longSlipPeak: 0.14, longSlipFalloff: 0.65,
     frontCircle: 0.50, brakeFrontShare: 0.60,
     loadSenseK: 0.08
  */
  // Gravity in pixel-units. Scale up so tire traction (mu*Fz) matches engineForce magnitudes
  // This fixes cars feeling like "slow motion" due to tiny normal loads.
  const PHYS_CONST = {
    GRAVITY_MIN: 100,
    GRAVITY_MAX: 1500,
    GRAVITY_DEFAULT: 750
  };
  const { GRAVITY_MIN, GRAVITY_MAX, GRAVITY_DEFAULT } = PHYS_CONST;
  let g = GRAVITY_DEFAULT; // px/s^2 (tuned so GT tops ~330-350 px/s on road)
  const SPEED_PX_PER_MPH = PPM_DEFAULT / 2.23694;
  const mphToPx = (mph) => mph * SPEED_PX_PER_MPH;
  const pxToMph = (px) => px / SPEED_PX_PER_MPH;

  // Default per-vehicle physical parameters (pixel-space, tuned empirically)
  const PLANCK_DEFAULTS = {
    usePlanck: true,
    pixelsPerMeter: PPM_DEFAULT,
    linearDamp: 0.00,
    angularDamp: 6.50,
    restitution: 1.0,
    velIters: 20,
    posIters: 8,
    planckDoSleep: true
  };

  // === PERFORMANCE: Mobile-aware physics quality ===
  const isMobilePhysics = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const MOBILE_PHYSICS_QUALITY = {
    velIters: isMobilePhysics ? 12 : PLANCK_DEFAULTS.velIters,
    posIters: isMobilePhysics ? 6 : PLANCK_DEFAULTS.posIters
  };
  const MOBILE_BULLET_SPEED_PX = 1800;
  if (isMobilePhysics) {
    PLANCK_DEFAULTS.velIters = MOBILE_PHYSICS_QUALITY.velIters;
    PLANCK_DEFAULTS.posIters = MOBILE_PHYSICS_QUALITY.posIters;
  }

  const VEHICLE_LABELS = {
    F1: 'Selvara F160',
    ApexStudent: 'Nerovan R2',
    VeyraF3: 'Veyra F3',
    SolsticeV8: 'Solstice V8',
    GT: 'Velnoric GT',
    BlackfinGT3: 'Blackfin GT3',
    StratusGT: 'Stratus GT',
    LynxGT: 'Lynx GT',
    Rallycross: 'Rovekar RX',
    RallycrossViper: 'Rallycross Viper',
    RallycrossTempest: 'Rallycross Tempest',
    RallycrossKestrel: 'Rallycross Kestrel',
    RallycrossForge: 'Rallycross Forge',
    RookRS: 'Rook RS',
    CinderR: 'Cinder R',
    DuneraX1: 'Dunera X1',
    RavikR: 'Ravik R',
    Truck: 'Brontrel T8',
    MastiffST: 'Mastiff ST',
    JackalXT: 'Jackal XT',
    Bubble: 'Bubble',
  };

  function getVehicleLabel(kind) {
    return VEHICLE_LABELS[kind] || kind;
  }

  const VEHICLE_DEFAULTS = {
    F1: {
      ...PLANCK_DEFAULTS,
      mass: 2.00,
      wheelbase: 40,
      cgToFront: 19,
      cgToRear: 21,
      enginePowerMult: 2.00,
      accelDurationMult: 6.35,
      maxSpeed: mphToPx(140),
      gearCount: 4,
      gearTopSpeedMph: 136,
      gearUpshiftFracs: { 2: 0.985 },
      gearFirstRatio: 2.55,
      brakeForce: 560,
      maxSteer: 0.42,
      steerSpeed: 4.2,
      muLatRoad: 1.35,
      muLongRoad: 1.55,
      muLatGrass: 1.00,
      muLongGrass: 0.45,
      dragK: 0.0002,
      rollK: 0.06,
      downforceK: 0.00012,
      longSlipPeak: 0.18,
      longSlipFalloff: 0.80,
      frontCircle: 0.50,
      brakeFrontShare: 0.64,
      loadSenseK: 0.08,
      muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
      vKineBlend: 1.8,
      cgHeight: 2,
      yawDampK: 0.22,
      reverseEntrySpeed: 40, // px/s threshold below which brake engages reverse
      reverseTorqueScale: 0.50, // fraction of engineForce when reversing
      touchSteer: {
        maxSteerLowSpeed: 0.60,
        maxSteerHighSpeed: 0.10,
        falloffSpeed: 300,
        baseSteerRate: 4.8,
        steerRateFalloff: 0.0045,
        returnGain: 4.0,
        filterTau: 0.18
      }
    },
    ApexStudent: {
      ...PLANCK_DEFAULTS,
      mass: 1.65,
      wheelbase: 34,
      cgToFront: 16,
      cgToRear: 18,
      enginePowerMult: 2.00,
      accelDurationMult: 5.0,
      maxSpeed: mphToPx(85),
      gearCount: 5,
      gearTopSpeedMph: 82,
      gearFirstRatio: 3.50,
      brakeForce: 720,
      maxSteer: 0.64,
      steerSpeed: 7.4,
      muLatRoad: 1.72,
      muLongRoad: 1.90,
      muLatGrass: 1.00,
      muLongGrass: 0.45,
      dragK: 0.00120,
      rollK: 0.10,
      downforceK: 0.00036,
      longSlipPeak: 0.18,
      longSlipFalloff: 0.80,
      frontCircle: 0.50,
      brakeFrontShare: 0.80,
      loadSenseK: 0.08,
      muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
      vKineBlend: 1.8,
      cgHeight: 2,
      yawDampK: 0.02,
      reverseEntrySpeed: 40,
      reverseTorqueScale: 0.50,
      touchSteer: {
        maxSteerLowSpeed: 0.82,
        maxSteerHighSpeed: 0.14,
        falloffSpeed: 300,
        baseSteerRate: 12.0,
        steerRateFalloff: 0.0060,
        returnGain: 6.0,
        filterTau: 0.40
      }
    },
    GT: {
      ...PLANCK_DEFAULTS,
      restitution: 0.40,
      mass: 2.20,
      wheelbase: 36,
      cgToFront: 17,
      cgToRear: 19,
      enginePowerMult: 1.65,
      accelDurationMult: 3.5,
      maxSpeed: 10000, // px/s - top speed cap (default: effectively unlimited)
      gearCount: 6, // number of forward gears
      brakeForce: 500,
      maxSteer: 0.50,
      steerSpeed: 5.0,
      muLatRoad: 1.40,
      muLongRoad: 1.80,
      muLatGrass: 1.00,
      muLongGrass: 0.40,
      dragK: 0.0010,
      rollK: 0.10,
      downforceK: 0.00025,
      longSlipPeak: 0.18,
      longSlipFalloff: 0.80,
      frontCircle: 0.50,
      brakeFrontShare: 0.80,
      loadSenseK: 0.08,
      muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
      vKineBlend: 1.8,
      cgHeight: 3,
      yawDampK: 0.30,
      reverseEntrySpeed: 40,
      reverseTorqueScale: 0.50,
      touchSteer: {
        maxSteerLowSpeed: 0.75,
        maxSteerHighSpeed: 0.10,
        falloffSpeed: 350,
        baseSteerRate: 12.0,
        steerRateFalloff: 0.0100,
        returnGain: 6.0,
        filterTau: 0.40
      }
    },
    BlackfinGT3: {
      ...PLANCK_DEFAULTS,
      restitution: 0.40,
      // Pixel-space GT3 calibration. The 43:57 static balance comes from the
      // CG distances; power and grip are game units, not horsepower or g.
      mass: 2.09,
      wheelbase: 37,
      cgToFront: 21,
      cgToRear: 16,
      driveFrontShare: 0,
      enginePowerMult: 3.10,
      accelDurationMult: 4.75,
      maxSpeed: mphToPx(285 / 1.609344),
      gearCount: 6,
      gearTopSpeedMps: 285 / 3.6,
      gearFirstRatio: 2.9,
      brakeForce: 850,
      maxSteer: 0.48,
      steerSpeed: 5.4,
      muLatRoad: 1.48,
      muLongRoad: 1.85,
      muLatGrass: 1.00,
      muLongGrass: 0.40,
      dragK: 0.00010,
      rollK: 0.05,
      downforceK: 0.00018,
      longSlipPeak: 0.18,
      longSlipFalloff: 0.80,
      frontCircle: 0.50,
      brakeFrontShare: 0.62,
      loadSenseK: 0.08,
      muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
      vKineBlend: 1.8,
      cgHeight: 2.5,
      yawDampK: 0.34,
      reverseEntrySpeed: 40,
      reverseTorqueScale: 0.50,
      touchSteer: {
        maxSteerLowSpeed: 0.75,
        maxSteerHighSpeed: 0.10,
        falloffSpeed: 350,
        baseSteerRate: 12.0,
        steerRateFalloff: 0.0100,
        returnGain: 6.0,
        filterTau: 0.40
      }
    },
    Rallycross: {
      ...PLANCK_DEFAULTS,
      restitution: 0.40,
      angularDamp: 8.00,
      mass: 1.75,
      wheelbase: 34,
      cgToFront: 16,
      cgToRear: 18,
      enginePowerMult: 2.00,
      accelDurationMult: 3.5,
      maxSpeed: 10000, // px/s - top speed cap (default: effectively unlimited)
      gearCount: 6, // number of forward gears
      brakeForce: 600,
      maxSteer: 0.58,
      steerSpeed: 6.5,
      muLatRoad: 1.80,
      muLongRoad: 1.80,
      muLatGrass: 1.00,
      muLongGrass: 0.38,
      dragK: 0.0010,
      rollK: 0.10,
      downforceK: 0.00025,
      longSlipPeak: 0.18,
      longSlipFalloff: 0.80,
      frontCircle: 0.50,
      brakeFrontShare: 0.60,
      loadSenseK: 0.08,
      muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
      vKineBlend: 1.8,
      cgHeight: 2,
      yawDampK: 0.00,
      reverseEntrySpeed: 40,
      reverseTorqueScale: 0.50,
      touchSteer: {
        maxSteerLowSpeed: 0.75,
        maxSteerHighSpeed: 0.10,
        falloffSpeed: 350,
        baseSteerRate: 12.0,
        steerRateFalloff: 0.0100,
        returnGain: 6.0,
        filterTau: 0.40
      }
    },
    Truck: {
      ...PLANCK_DEFAULTS,
      angularDamp: 5.00,
      restitution: 0.40,
      mass: 2.20,
      wheelbase: 57,
      cgToFront: 27,
      cgToRear: 30,
      enginePowerMult: 1.85,
      accelDurationMult: 3.5,
      maxSpeed: 10000, // px/s - top speed cap (default: effectively unlimited)
      gearCount: 6, // number of forward gears
      brakeForce: 850,
      maxSteer: 0.40,
      steerSpeed: 3.5,
      muLatRoad: 1.45,
      muLongRoad: 1.80,
      muLatGrass: 1.00,
      muLongGrass: 0.34,
      dragK: 0.0010,
      rollK: 0.10,
      downforceK: 0.00025,
      longSlipPeak: 0.18,
      longSlipFalloff: 0.80,
      frontCircle: 0.50,
      brakeFrontShare: 0.80,
      loadSenseK: 0.08,
      muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
      vKineBlend: 1.8,
      cgHeight: 2,
      yawDampK: 0.30,
      reverseEntrySpeed: 40,
      reverseTorqueScale: 0.50,
      touchSteer: {
        maxSteerLowSpeed: 0.90,
        maxSteerHighSpeed: 0.10,
        falloffSpeed: 350,
        baseSteerRate: 12.0,
        steerRateFalloff: 0.0100,
        returnGain: 6.0,
        filterTau: 0.40
      }
    },
    Bubble: {
      ...PLANCK_DEFAULTS,
      restitution: 0.14,
      angularDamp: 5.50,
      mass: 0.60,
      wheelbase: 28,
      cgToFront: 14,
      cgToRear: 14,
      enginePowerMult: 0.50,
      accelDurationMult: 5.0,
      maxSpeed: 10000, // px/s - top speed cap (default: effectively unlimited)
      gearCount: 6, // number of forward gears
      brakeForce: 150,
      maxSteer: 0.52,
      steerSpeed: 5.5,
      muLatRoad: 0.80,
      muLongRoad: 1.80,
      muLatGrass: 1.00,
      muLongGrass: 0.40,
      dragK: 0.0010,
      rollK: 0.10,
      downforceK: 0.00025,
      longSlipPeak: 0.18,
      longSlipFalloff: 0.80,
      frontCircle: 0.50,
      brakeFrontShare: 0.80,
      loadSenseK: 0.08,
      muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
      vKineBlend: 1.8,
      cgHeight: 2,
      yawDampK: 0.00,
      reverseEntrySpeed: 40,
      reverseTorqueScale: 0.50,
      touchSteer: {
        maxSteerLowSpeed: 0.60,
        maxSteerHighSpeed: 0.15,
        falloffSpeed: 185,
        baseSteerRate: 12.0,
        steerRateFalloff: 0.0100,
        returnGain: 6.0,
        filterTau: 0.40
      }
    }
  };

  // Pixel-space calibration at Realistic pace; mass preserves the 1300:1190
  // reference ratio. These are game setup values, not SI horsepower or tire mu.
  VEHICLE_DEFAULTS.RallycrossViper = {
    ...cloneVehicleDefaults(VEHICLE_DEFAULTS.Rallycross),
    mass: 1.75, wheelbase: 36, cgToFront: 17, cgToRear: 19,
    driveFrontShare: 0.45,
    enginePowerMult: 3.2, accelDurationMult: 3.9,
    maxSpeed: mphToPx(203 / 1.609344), gearTopSpeedMps: 203 / 3.6,
    gearFirstRatio: 3.9,
    brakeForce: 800, brakeFrontShare: 0.62,
    muLatRoad: 1.80, muLongRoad: 1.0,
    dragK: 0.0010, downforceK: 0.00006,
    cgHeight: 2.5, yawDampK: 0.24,
    maxSteer: 0.54, steerSpeed: 6.5,
  };
  VEHICLE_DEFAULTS.RallycrossTempest = {
    ...cloneVehicleDefaults(VEHICLE_DEFAULTS.Rallycross),
    // Fiesta WRC reference: compact 1190 kg AWD / six-speed turbo rally car.
    // Game-space calibration, not literal SI power or factory differential maps.
    mass: 1.75 * 1190 / 1300, wheelbase: 34, cgToFront: 16, cgToRear: 18,
    // Both axles pull through the slide; retain a modest rear drive bias.
    driveFrontShare: 0.45,
    // Broad mid-range and closer overall spacing carry the newer tyre model's
    // real cornering scrub. A taller first gear avoids a launch-only power fix.
    enginePowerMult: 3.1, accelDurationMult: 5.0,
    maxSpeed: mphToPx(192 / 1.609344), gearTopSpeedMps: 192 / 3.6,
    gearFirstRatio: 3.4, gearTorquePeakRpm: 4400, gearTorqueIdle: 160,
    gearEngineBrakePeak: 40,
    brakeForce: 690, brakeFrontShare: 0.60,
    muLatRoad: 1.64, muLongRoad: 1.10,
    dragK: 0.0001, rollK: 0.03, downforceK: 0.000045,
    cgHeight: 3.5, angularDamp: 5.8, yawDampK: 0.18,
    // Light, responsive chassis with a progressive catch, not a heavy yaw filter.
    // Moderate base damping also avoids excessive inferred loose-road assistance.
    yawInertiaScale: 1.12, steerResponseTime: 0.025,
    countersteerResponseTime: 0.14, throttleRiseTime: 0.04, throttleSlideRiseTime: 0.075,
    lateralPeakSlipScale: 1.15,
    // Keep the complete contact-force transform and shared friction budget.
    // Roll, braking and engine drag produce pedal-dependent weight transfer.
    trackWidth: 23, rollStiffnessRearShare: 0.56, tireLoadExponent: 0.82,
    combinedAxleGrip: true, forceSpaceFallback: true,
    // Loose-road braking unloads the rear progressively, with less breakaway.
    rearBrakeSlipStrength: 0.88, rearBrakeSlipRiseTime: 0.18,
    touchSteer: { ...VEHICLE_DEFAULTS.Rallycross.touchSteer,
      maxSteerLowSpeed: 0.70, maxSteerHighSpeed: 0.12,
      // Digital presses build and release lock progressively; slide catches
      // retain their separate response and rate authority.
      baseSteerRate: 9.0, steerRateFalloff: 0.010, responseTime: 0.075,
      returnGain: 18.0, // Compensate rack compliance so released opposite lock clears.
      filterTau: 0.28, countersteerRate: 5.0 },
    maxSteer: 0.56, steerSpeed: 6.5,
  };

  // Original bodies, reference-based drivetrains. Volland's A1 Super1600:
  // 240 PS / 1000 kg / six gears / FWD / 9900 RPM. Fabia T16 4x4:
  // 550 PS / 1110 kg / four gears / AWD / 8500 RPM. See rallycross-reference.md.
  // Power and mass remain pixel-space values; torque magnitudes are normalized.
  VEHICLE_DEFAULTS.RallycrossKestrel = {
    ...cloneVehicleDefaults(VEHICLE_DEFAULTS.Rallycross),
    mass: 1.75 * 1000 / 1300, wheelbase: 33, cgToFront: 13, cgToRear: 20,
    driveFrontShare: 1,
    // Stronger front-axle pull; rotation still comes from lift/brake load transfer.
    enginePowerMult: 2.2, accelDurationMult: 4.5,
    maxSpeed: mphToPx(185 / 1.609344), gearTopSpeedMps: 185 / 3.6,
    gearCount: 6, gearFirstRatio: 4.6, gearRedlineRpm: 9900,
    gearTorquePeakRpm: 7600, gearTorqueIdle: 95, gearEngineBrakePeak: 75,
    brakeForce: 610, brakeFrontShare: 0.68, frontCircle: 1.00,
    rearBrakeSlipStrength: 1.0,
    // Keep useful turn-in at speed instead of inheriting the slow rally rack.
    touchSteer: { ...VEHICLE_DEFAULTS.Rallycross.touchSteer,
      maxSteerHighSpeed: 0.18, falloffSpeed: 230, steerRateFalloff: 0.007,
      filterTau: 0.30, countersteerRate: 4.5 },
    muLatRoad: 1.52, muLongRoad: 1.26,
    dragK: 0.00012, rollK: 0.035, downforceK: 0.000035,
    cgHeight: 4.3, angularDamp: 5.0, yawDampK: 0.12, lateralPeakSlipScale: 1.12,
    trackWidth: 23, rollStiffnessRearShare: 0.64, tireLoadExponent: 0.82,
    combinedAxleGrip: true,
    forceSpaceFallback: true,
    maxSteer: 0.61, steerSpeed: 7.3,
  };
  VEHICLE_DEFAULTS.RallycrossForge = {
    ...cloneVehicleDefaults(VEHICLE_DEFAULTS.Rallycross),
    mass: 1.75 * 1110 / 1300, wheelbase: 37, cgToFront: 17, cgToRear: 20,
    driveFrontShare: 0.42,
    enginePowerMult: 3.2 * 550 / 600, accelDurationMult: 5.6,
    maxSpeed: mphToPx(185 / 1.609344), gearTopSpeedMps: 185 / 3.6,
    gearCount: 4, gearFirstRatio: 4.1, gearRedlineRpm: 8500,
    gearTorquePeakRpm: 4400, gearTorqueIdle: 140,
    brakeForce: 710, brakeFrontShare: 0.61,
    muLatRoad: 1.74, muLongRoad: 1.04,
    dragK: 0.00035, rollK: 0.055, downforceK: 0.00007,
    cgHeight: 3.3, yawDampK: 0.21, lateralPeakSlipScale: 1.12,
    maxSteer: 0.55, steerSpeed: 6.1,
  };

  // Original RWD Rally bodies. Historic BDG/037 layouts inform these authored
  // game-space values; weights, grip and power multipliers are not SI specs.
  // See docs/ai/vehicle-physics/rwd-rally-reference.md for sources and measurements.
  VEHICLE_DEFAULTS.RookRS = {
    ...cloneVehicleDefaults(VEHICLE_DEFAULTS.Rallycross),
    mass: 1.36, wheelbase: 35, cgToFront: 17.5, cgToRear: 17.5,
    driveFrontShare: 0,
    // Rally pull with a rev-hungry delivery; retain forward bite during power slides.
    enginePowerMult: 1.95, accelDurationMult: 5.0,
    maxSpeed: mphToPx(192 / 1.609344), gearTopSpeedMps: 192 / 3.6,
    gearCount: 5, gearFirstRatio: 4.15, gearRedlineRpm: 9500,
    gearTorquePeakRpm: 7700, gearTorqueIdle: 92, gearEngineBrakePeak: 68,
    brakeForce: 600, brakeFrontShare: 0.62,
    muLatRoad: 1.75, muLongRoad: 1.5,
    dragK: 0.00016, rollK: 0.04, downforceK: 0.000025,
    cgHeight: 4.3, angularDamp: 6.2, yawDampK: 0.14, lateralPeakSlipScale: 1.08,
    // Tempest-style progressive rotation, with a lighter chassis and quicker rack.
    yawInertiaScale: 1.08, steerResponseTime: 0.02, countersteerResponseTime: 0.12,
    trackWidth: 23, rollStiffnessRearShare: 0.56, tireLoadExponent: 0.82,
    combinedAxleGrip: true, forceSpaceFallback: true,
    rearBrakeSlipStrength: 0.90, rearBrakeSlipRiseTime: 0.15,
    maxSteer: 0.6, steerSpeed: 7.2,
    touchSteer: { maxSteerLowSpeed: 0.75, maxSteerHighSpeed: 0.12,
      falloffSpeed: 350, baseSteerRate: 9.5, steerRateFalloff: 0.009,
      responseTime: 0.06, returnGain: 15, filterTau: 0.16, countersteerRate: 5.0 },
  };
  VEHICLE_DEFAULTS.CinderR = {
    ...cloneVehicleDefaults(VEHICLE_DEFAULTS.Rallycross),
    mass: 1.29, wheelbase: 34, cgToFront: 19.7, cgToRear: 14.3,
    driveFrontShare: 0,
    // Broad supercharged pull; rearward load gives a stronger exit than Rook.
    enginePowerMult: 2.55, accelDurationMult: 4.8,
    maxSpeed: mphToPx(205 / 1.609344), gearTopSpeedMps: 205 / 3.6,
    gearCount: 5, gearFirstRatio: 3.85, gearRedlineRpm: 8200,
    gearTorquePeakRpm: 5400, gearTorqueIdle: 135, gearEngineBrakePeak: 62,
    brakeForce: 650, brakeFrontShare: 0.6,
    muLatRoad: 1.8, muLongRoad: 1.38,
    dragK: 0.00015, rollK: 0.04, downforceK: 0.000055,
    cgHeight: 3.4, angularDamp: 6.0, yawDampK: 0.1, lateralPeakSlipScale: 1.1,
    trackWidth: 25, rollStiffnessRearShare: 0.55, tireLoadExponent: 0.83,
    combinedAxleGrip: true, forceSpaceFallback: true, rearBrakeSlipStrength: 0.9,
    maxSteer: 0.57, steerSpeed: 6.9,
    touchSteer: { maxSteerLowSpeed: 0.73, maxSteerHighSpeed: 0.11,
      falloffSpeed: 350, baseSteerRate: 11.2, steerRateFalloff: 0.005,
      returnGain: 6, filterTau: 0.16, countersteerRate: 5.2 },
  };

  // Buggy references and game-space choices: docs/ai/vehicle-physics/buggy-reference.md.
  // Long, wide mid-engine V8 desert racer: progressive rear-drive power slides.
  VEHICLE_DEFAULTS.DuneraX1 = {
    ...cloneVehicleDefaults(VEHICLE_DEFAULTS.Rallycross),
    mass: 2223 / 600, wheelbase: 40, cgToFront: 23.2, cgToRear: 16.8,
    driveFrontShare: 0,
    enginePowerMult: 3.6, accelDurationMult: 4.8,
    maxSpeed: mphToPx(210 / 1.609344), gearTopSpeedMps: 210 / 3.6,
    gearCount: 5, gearFirstRatio: 3.8, gearRedlineRpm: 7200,
    gearTorquePeakRpm: 4900, gearTorqueIdle: 175, gearEngineBrakePeak: 48,
    brakeForce: 1080, brakeFrontShare: 0.59,
    muLatRoad: 1.32, muLongRoad: 1.63,
    dragK: 0.00032, rollK: 0.075, downforceK: 0.000015,
    cgHeight: 5.6, angularDamp: 5.2, yawDampK: 0.14, lateralPeakSlipScale: 1.24,
    trackWidth: 29, rollStiffnessRearShare: 0.54, tireLoadExponent: 0.83,
    combinedAxleGrip: true, forceSpaceFallback: true, rearBrakeSlipStrength: 0.84,
    maxSteer: 0.56, steerSpeed: 6.1,
    touchSteer: { maxSteerLowSpeed: 0.74, maxSteerHighSpeed: 0.105,
      falloffSpeed: 350, baseSteerRate: 10.8, steerRateFalloff: 0.005,
      returnGain: 6, filterTau: 0.16, countersteerRate: 5.3 },
  };
  // Compact, tall turbo triple side-by-side, operated in rear-biased 4WD high range.
  VEHICLE_DEFAULTS.RavikR = {
    ...cloneVehicleDefaults(VEHICLE_DEFAULTS.Rallycross),
    mass: 1016 / 600, wheelbase: 34.5, cgToFront: 20, cgToRear: 14.5,
    driveFrontShare: 0.35,
    enginePowerMult: 1.50, accelDurationMult: 4.9,
    maxSpeed: mphToPx(160 / 1.609344), gearTopSpeedMps: 160 / 3.6,
    gearCount: 7, gearFirstRatio: 4.4, gearRedlineRpm: 8500,
    gearTorquePeakRpm: 6500, gearTorqueIdle: 118, gearEngineBrakePeak: 40,
    gearShiftCutMs: 45,
    brakeForce: 570, brakeFrontShare: 0.61,
    muLatRoad: 1.28, muLongRoad: 1.48,
    dragK: 0.00028, rollK: 0.08, downforceK: 0.00001,
    cgHeight: 6.1, angularDamp: 5.0, yawDampK: 0.13, lateralPeakSlipScale: 1.21,
    trackWidth: 25, rollStiffnessRearShare: 0.56, tireLoadExponent: 0.82,
    combinedAxleGrip: true, forceSpaceFallback: true, rearBrakeSlipStrength: 0.86,
    maxSteer: 0.61, steerSpeed: 7.0,
    touchSteer: { maxSteerLowSpeed: 0.76, maxSteerHighSpeed: 0.115,
      falloffSpeed: 335, baseSteerRate: 11.4, steerRateFalloff: 0.005,
      returnGain: 6, filterTau: 0.15, countersteerRate: 5.1 },
  };

  // Original GT bodies; real GT3 engine/gear layouts guide these game-space setups.
  // Vantage GT3: 4.0 TT V8, >400 kW, >700 Nm, RWD / six sequential gears.
  VEHICLE_DEFAULTS.StratusGT = {
    ...cloneVehicleDefaults(VEHICLE_DEFAULTS.BlackfinGT3),
    mass: 2.17, wheelbase: 37, cgToFront: 18.5, cgToRear: 18.5,
    driveFrontShare: 0,
    enginePowerMult: 3.02, accelDurationMult: 4.85,
    maxSpeed: mphToPx(285 / 1.609344), gearTopSpeedMps: 285 / 3.6,
    gearCount: 6, gearFirstRatio: 2.95, gearRedlineRpm: 7600,
    gearTorquePeakRpm: 5000, gearTorqueIdle: 150, gearEngineBrakePeak: 35,
    brakeForce: 865, brakeFrontShare: 0.64,
    muLatRoad: 1.49, muLongRoad: 1.86,
    dragK: 0.00011, rollK: 0.055, downforceK: 0.00020,
    maxSteer: 0.47, steerSpeed: 5.1, cgHeight: 2.6, yawDampK: 0.38,
  };
  // 992 GT3 R: 4,194 cc NA flat-six, 416 kW, 1,265 kg, 9,250 RPM, six gears.
  VEHICLE_DEFAULTS.LynxGT = {
    ...cloneVehicleDefaults(VEHICLE_DEFAULTS.BlackfinGT3),
    mass: 1265 / 600, wheelbase: 34.5, cgToFront: 20.7, cgToRear: 13.8,
    driveFrontShare: 0,
    enginePowerMult: 2.30, accelDurationMult: 4.55,
    maxSpeed: mphToPx(280 / 1.609344), gearTopSpeedMps: 280 / 3.6,
    gearCount: 6, gearFirstRatio: 3.15, gearRedlineRpm: 9250,
    gearTorquePeakRpm: 7800, gearTorqueIdle: 110, gearEngineBrakePeak: 48,
    brakeForce: 840, brakeFrontShare: 0.58,
    muLatRoad: 1.52, muLongRoad: 1.90,
    dragK: 0.000105, rollK: 0.05, downforceK: 0.000185,
    maxSteer: 0.51, steerSpeed: 5.9, cgHeight: 2.4, yawDampK: 0.28,
  };

  // Original Super Truck bodies. Reference specs and game-space choices are
  // documented in docs/ai/vehicle-physics/super-truck-reference.md.
  // Stadium truck: 600 hp EFI V8, 3,000 lb, RWD, three forward gears.
  VEHICLE_DEFAULTS.MastiffST = {
    ...cloneVehicleDefaults(VEHICLE_DEFAULTS.Truck),
    mass: 1360.8 / 600, wheelbase: 40, cgToFront: 21, cgToRear: 19,
    driveFrontShare: 0,
    enginePowerMult: 3.25, accelDurationMult: 4.8,
    maxSpeed: mphToPx(210 / 1.609344), gearTopSpeedMps: 210 / 3.6,
    gearCount: 3, gearFirstRatio: 2.8, gearRedlineRpm: 7400,
    gearTorquePeakRpm: 5800, gearTorqueIdle: 155, gearEngineBrakePeak: 30,
    brakeForce: 810, brakeFrontShare: 0.61,
    muLatRoad: 1.35, muLongRoad: 1.65,
    dragK: 0.00029, rollK: 0.075, downforceK: 0.00006,
    cgHeight: 4.3, yawDampK: 0.23, lateralPeakSlipScale: 1.12,
    maxSteer: 0.48, steerSpeed: 4.8,
  };
  // 2025 rally-raid reference: 5.0 NA V8, 360 PS / 540 Nm, 2,010 kg,
  // permanent four-wheel drive and six sequential gears.
  VEHICLE_DEFAULTS.JackalXT = {
    ...cloneVehicleDefaults(VEHICLE_DEFAULTS.Truck),
    mass: 2010 / 600, wheelbase: 41, cgToFront: 21, cgToRear: 20,
    // Rear-biased permanent 4WD: the rear can rotate while the front pulls it out.
    driveFrontShare: 0.36,
    // Stronger midrange/exit drive, retaining the 120 mph gearing target.
    enginePowerMult: 4.25, accelDurationMult: 4.7,
    maxSpeed: mphToPx(120), gearTopSpeedMps: 120 * 0.44704,
    gearCount: 6, gearFirstRatio: 4.2, gearRedlineRpm: 6500,
    gearTorquePeakRpm: 4250, gearTorqueIdle: 165, gearEngineBrakePeak: 45,
    brakeForce: 1030, brakeFrontShare: 0.62,
    muLatRoad: 1.30, muLongRoad: 1.76,
    dragK: 0.00039, rollK: 0.085, downforceK: 0.00008,
    // Taller chassis transfers load under braking and rolls onto the outside
    // tires. Use solved tire forces for transfer and a shared axle grip budget.
    cgHeight: 6.2, angularDamp: 4.5, yawDampK: 0.18, lateralPeakSlipScale: 1.14,
    trackWidth: 27, rollStiffnessRearShare: 0.58, tireLoadExponent: 0.82,
    combinedAxleGrip: true, forceSpaceFallback: true,
    maxSteer: 0.50, steerSpeed: 5.1,
  };

  // Original Open Wheel cars. Published engine references and authored game-space
  // choices are separated in docs/ai/vehicle-physics/open-wheel-reference.md.
  VEHICLE_DEFAULTS.VeyraF3 = {
    ...cloneVehicleDefaults(VEHICLE_DEFAULTS.BlackfinGT3),
    mass: 1.25, wheelbase: 39, cgToFront: 21, cgToRear: 18,
    driveFrontShare: 0,
    enginePowerMult: 2.75, accelDurationMult: 6.4,
    maxSpeed: mphToPx(275 / 1.609344), gearTopSpeedMps: 275 / 3.6,
    gearCount: 6, gearFirstRatio: 3.05, gearRedlineRpm: 8500,
    gearTorquePeakRpm: 7400, gearTorqueIdle: 105, gearEngineBrakePeak: 32,
    brakeForce: 1040, brakeFrontShare: 0.66,
    muLatRoad: 1.72, muLongRoad: 1.88,
    dragK: 0.000075, rollK: 0.045, downforceK: 0.00030,
    maxSteer: 0.44, steerSpeed: 6.8, cgHeight: 1.45,
    angularDamp: 5.2, yawDampK: 0.24, lateralPeakSlipScale: 0.82,
    trackWidth: 25, rollStiffnessRearShare: 0.51,
    // Keep aero axle loads when longitudinal weight transfer is solved. Legacy
    // setups retain their calibrated static-load transfer path.
    aeroLoadTransfer: true, loadSenseK: 0.035, muLongLoadSenseK: 0.025,
    combinedAxleGrip: true, forceSpaceFallback: true, tireLoadExponent: 0.88,
    touchSteer: { maxSteerLowSpeed: 0.67, maxSteerHighSpeed: 0.055,
      falloffSpeed: 320, baseSteerRate: 8.8, steerRateFalloff: 0.0045,
      returnGain: 6.0, filterTau: 0.12 },
  };
  VEHICLE_DEFAULTS.SolsticeV8 = {
    ...cloneVehicleDefaults(VEHICLE_DEFAULTS.BlackfinGT3),
    mass: 1.42, wheelbase: 41, cgToFront: 24, cgToRear: 17,
    driveFrontShare: 0,
    enginePowerMult: 3.75, accelDurationMult: 6.3,
    maxSpeed: mphToPx(300 / 1.609344), gearTopSpeedMps: 300 / 3.6,
    gearCount: 6, gearFirstRatio: 3.15, gearRedlineRpm: 9500,
    gearTorquePeakRpm: 7900, gearTorqueIdle: 135, gearEngineBrakePeak: 40,
    brakeForce: 1200, brakeFrontShare: 0.64,
    muLatRoad: 1.69, muLongRoad: 1.96,
    dragK: 0.00008, rollK: 0.05, downforceK: 0.00038,
    maxSteer: 0.42, steerSpeed: 6.2, cgHeight: 1.55,
    angularDamp: 5.7, yawDampK: 0.32, lateralPeakSlipScale: 0.86,
    trackWidth: 27, rollStiffnessRearShare: 0.47,
    aeroLoadTransfer: true, loadSenseK: 0.035, muLongLoadSenseK: 0.025,
    combinedAxleGrip: true, forceSpaceFallback: true, tireLoadExponent: 0.88,
    touchSteer: { maxSteerLowSpeed: 0.80, maxSteerHighSpeed: 0.052,
      falloffSpeed: 340, baseSteerRate: 8.0, steerRateFalloff: 0.0045,
      returnGain: 6.0, filterTau: 0.14 },
  };

  const fallbackClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const clamp = window.RacerUtils && typeof window.RacerUtils.clamp === 'function'
    ? window.RacerUtils.clamp
    : fallbackClamp;
  const fallbackSign = (x) => (x < 0 ? -1 : x > 0 ? 1 : 0);
  const sign = window.RacerUtils && typeof window.RacerUtils.sign === 'function'
    ? window.RacerUtils.sign
    : fallbackSign;

  function clonePhysicsValue(value) {
    if (Array.isArray(value)) return value.slice();
    if (value && typeof value === 'object') return { ...value };
    return value;
  }

  function cloneVehicleDefaults(defaults) {
    const clone = {};
    for (const key of Object.keys(defaults || {})) {
      clone[key] = clonePhysicsValue(defaults[key]);
    }
    return clone;
  }

  function getLooseSurfaceStabilityMetrics(params) {
    const reference = VEHICLE_DEFAULTS.GT;
    if (!params || !reference) {
      return {
        curvatureDeficit: 0,
        responseDeficit: 0,
        yawDampingDeficit: 0,
        excessDriveDemand: 0,
        recoveryScale: 0,
      };
    }
    const safePositive = (value, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : fallback;
    };
    const curvatureAuthority = (setup) => {
      const steer = safePositive(setup.maxSteer, 0.5);
      const wheelbase = safePositive(setup.wheelbase, 36);
      return Math.tan(steer) / wheelbase;
    };
    const steeringResponse = (setup) =>
      safePositive(setup.steerSpeed, 5) / safePositive(setup.maxSteer, 0.5);
    const driveDemand = (setup) =>
      getVehiclePowerMult(setup) / safePositive(setup.mass, 2.2);

    const curvatureDeficit = clamp(
      1 - curvatureAuthority(params) / Math.max(0.0001, curvatureAuthority(reference)),
      0,
      1,
    );
    const responseDeficit = clamp(
      1 - steeringResponse(params) / Math.max(0.01, steeringResponse(reference)),
      0,
      1,
    );
    const referenceYawDamping = safePositive(reference.yawDampK, 0.3);
    const yawDamping = Math.max(0, Number(params.yawDampK) || 0);
    const yawDampingDeficit = clamp(1 - yawDamping / referenceYawDamping, 0, 1);
    const driveDemandRatio =
      driveDemand(params) / Math.max(0.0001, driveDemand(reference));
    const excessDriveDemand = clamp(driveDemandRatio - 1, 0, 1.5);

    const recoveryScale = clamp(
      curvatureDeficit * 1.25 +
        responseDeficit * 0.35 +
        yawDampingDeficit * 0.65 +
        excessDriveDemand * 0.30,
      0,
      1.5,
    );

    return {
      curvatureDeficit,
      responseDeficit,
      yawDampingDeficit,
      excessDriveDemand,
      recoveryScale,
    };
  }

  function getCountersteerRecoveryScale(params) {
    // Even the GT reference can exceed the catchable yaw range on a loose
    // surface. Keep a baseline recovery path for reference-like setups, then
    // scale above it when geometry or power demand needs more authority.
    return Math.max(0.36, getLooseSurfaceStabilityMetrics(params).recoveryScale);
  }

  function getSurfaceRotationSetup(params, surfaceProfile) {
    const profile = surfaceProfile || TRACK_SURFACE_PROFILES['tarmac-pro'];
    const metrics = getLooseSurfaceStabilityMetrics(params);
    const slipperySurfaceFactor = clamp(
      (0.98 - Number(profile.lateralGripScale || 1)) / 0.26,
      0,
      1,
    );
    const reference = VEHICLE_DEFAULTS.GT;
    const safePositive = (value, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : fallback;
    };
    const curvatureAuthority = (setup) =>
      Math.tan(safePositive(setup && setup.maxSteer, 0.5)) /
      safePositive(setup && setup.wheelbase, 36);
    const lateralGripSurplus = clamp(
      (safePositive(params && params.muLatRoad, reference.muLatRoad) /
        safePositive(reference.muLatRoad, 1.4) -
        1) /
        0.30,
      0,
      1,
    );
    const steeringAptitude = clamp(
      (curvatureAuthority(params) /
        Math.max(0.0001, curvatureAuthority(reference)) -
        1) /
        0.35,
      0,
      1,
    );
    // High base lateral grip is the primary signal that a setup is naturally
    // suited to loose surfaces. Steering authority refines that signal but
    // cannot make an otherwise low-grip vehicle count as a specialist.
    const looseSurfaceAptitude = clamp(
      lateralGripSurplus * (0.80 + steeringAptitude * 0.20),
      0,
      1,
    );
    const capabilityLateralGripScale =
      1 - looseSurfaceAptitude * slipperySurfaceFactor * 0.07;
    const capabilityAssistScale =
      1 - looseSurfaceAptitude * slipperySurfaceFactor * 0.10;
    const countersteerRecoveryScale = Math.max(
      0.32,
      getCountersteerRecoveryScale(params) * capabilityAssistScale,
    );
    const rotationEnvelopeScale = Math.max(
      0.32,
      Math.max(0.36, metrics.recoveryScale) * capabilityAssistScale,
    );
    const frontYawReleaseScale = clamp(1 - metrics.recoveryScale / 1.20, 0.25, 1);
    // These weights reproduce the useful rear-load behavior of a taller CG for
    // vehicles whose geometry, damping, or drive demand makes loose-surface
    // power oversteer difficult to catch. The boost is applied dynamically below;
    // base vehicle tuning and asphalt behavior remain unchanged.
    const maximumCgHeightBoost =
      (metrics.curvatureDeficit * 7.5 +
        metrics.yawDampingDeficit * 1.5 +
        metrics.excessDriveDemand) *
      capabilityAssistScale;
    const baseCgHeight = params && params.cgHeight != null ? params.cgHeight : 8;

    return {
      ...metrics,
      countersteerRecoveryScale,
      rotationEnvelopeScale,
      frontYawReleaseScale,
      looseSurfaceAptitude,
      capabilityLateralGripScale,
      capabilityAssistScale,
      slipperySurfaceFactor,
      baseCgHeight,
      maximumCgHeightBoost,
      targetCgHeight:
        baseCgHeight + maximumCgHeightBoost * slipperySurfaceFactor,
    };
  }

  function getSurfaceAdjustedVehicleDefaults(params, surfaceId, weatherId = 'dry') {
    const adjusted = applyTrackSurfaceToVehicleDefaults(params, surfaceId, weatherId);
    if (!adjusted) return null;
    const surfaceProfile =
      surfaceId && typeof surfaceId === 'object'
        ? getTrackSurfaceProfileFromState({
            ...surfaceId,
            weatherId: surfaceId.weatherId || weatherId,
          })
        : getTrackSurfaceProfile(surfaceId, weatherId);
    const setup = getSurfaceRotationSetup(
      params,
      surfaceProfile,
    );
    if (Number.isFinite(Number(adjusted.muLatRoad))) {
      adjusted.muLatRoad =
        Number(adjusted.muLatRoad) * setup.capabilityLateralGripScale;
    }
    adjusted.looseSurfaceAptitude = setup.looseSurfaceAptitude;
    adjusted.surfaceCapabilityLateralGripScale = setup.capabilityLateralGripScale;
    adjusted.surfaceCapabilityAssistScale = setup.capabilityAssistScale;
    return adjusted;
  }

  function applyPhysicsDeltaValue(target, key, delta) {
    if (!target || !key || delta == null) return;

    if (Number.isFinite(delta)) {
      const current = Number(target[key]);
      if (Number.isFinite(current)) target[key] = current * delta;
      return;
    }

    if (typeof delta !== 'object' || Array.isArray(delta)) return;

    const hasOperator =
      Object.prototype.hasOwnProperty.call(delta, 'scale') ||
      Object.prototype.hasOwnProperty.call(delta, 'add') ||
      Object.prototype.hasOwnProperty.call(delta, 'offset') ||
      Object.prototype.hasOwnProperty.call(delta, 'min') ||
      Object.prototype.hasOwnProperty.call(delta, 'max') ||
      Object.prototype.hasOwnProperty.call(delta, 'set');

    if (!hasOperator) {
      const nextTarget =
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
          ? { ...target[key] }
          : {};
      target[key] = nextTarget;
      applyPhysicsDeltas(nextTarget, delta);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(delta, 'set')) {
      target[key] = clonePhysicsValue(delta.set);
      return;
    }

    const current = Number(target[key]);
    if (!Number.isFinite(current)) return;

    let next = current;
    if (Number.isFinite(delta.scale)) next *= delta.scale;
    if (Number.isFinite(delta.add)) next += delta.add;
    if (Number.isFinite(delta.offset)) next += delta.offset;
    if (Number.isFinite(delta.min)) next = Math.max(delta.min, next);
    if (Number.isFinite(delta.max)) next = Math.min(delta.max, next);
    target[key] = next;
  }

  function applyPhysicsDeltas(target, deltas) {
    if (!target || !deltas || typeof deltas !== 'object') return target;
    for (const key of Object.keys(deltas)) {
      applyPhysicsDeltaValue(target, key, deltas[key]);
    }
    return target;
  }

  function getVehicleVariant(kind, variantId) {
    const registry = window.RacingVibesVehicleAssets;
    if (!registry || typeof registry.getVehicleVariant !== 'function') return null;
    try {
      return registry.getVehicleVariant(kind, variantId);
    } catch (_) {
      return null;
    }
  }

  function resolveVehicleSetup(kind, variantId) {
    const requestedKind = kind || 'GT';
    const resolvedKind = VEHICLE_DEFAULTS[requestedKind] ? requestedKind : 'GT';
    const defaults = cloneVehicleDefaults(VEHICLE_DEFAULTS[resolvedKind] || VEHICLE_DEFAULTS.GT);
    const variant = getVehicleVariant(resolvedKind, variantId);
    if (variant && variant.physicsDeltas) {
      applyPhysicsDeltas(defaults, variant.physicsDeltas);
    }
    return { kind: resolvedKind, defaults, variant };
  }

  const VARIANT_TWEAK_PRESENTATION = {
    accelDurationMult: { higherIsBuff: false, format: (value) => `${Number(value).toFixed(2)}s` },
    brakeForce: { higherIsBuff: true, format: (value) => String(Math.round(Number(value))) },
    brakeFrontShare: { higherIsBuff: true, format: (value) => Number(value).toFixed(2) },
    cgToFront: { higherIsBuff: null, format: (value) => String(Math.round(Number(value))) },
    cgToRear: { higherIsBuff: null, format: (value) => String(Math.round(Number(value))) },
    downforceK: { higherIsBuff: true, format: (value) => Number(value).toFixed(6) },
    dragK: { higherIsBuff: false, format: (value) => Number(value).toFixed(5) },
    enginePowerMult: { higherIsBuff: true, format: (value) => Number(value).toFixed(2) },
    gearCount: { higherIsBuff: null, format: (value) => String(Math.round(Number(value))) },
    mass: { higherIsBuff: false, format: (value) => Number(value).toFixed(2) },
    maxSpeed: { higherIsBuff: true, format: (value) => `${Math.round(pxToMph(Number(value)))} mph` },
    maxSteer: { higherIsBuff: true, format: (value) => Number(value).toFixed(2) },
    muLatRoad: { higherIsBuff: true, format: (value) => Number(value).toFixed(2) },
    muLongRoad: { higherIsBuff: true, format: (value) => Number(value).toFixed(2) },
    steerSpeed: { higherIsBuff: true, format: (value) => Number(value).toFixed(1) },
    wheelbase: { higherIsBuff: null, format: (value) => String(Math.round(Number(value))) },
    yawDampK: { higherIsBuff: true, format: (value) => Number(value).toFixed(2) },
  };

  const DEVTOOLS_VARIANT_CONTROL_PROPS = {
    'rv-brk': 'brakeForce',
    'rv-brkfs': 'brakeFrontShare',
    'rv-df': 'downforceK',
    'rv-drag': 'dragK',
    'rv-eng': 'enginePowerMult',
    'rv-mass': 'mass',
    'rv-mulr': 'muLatRoad',
    'rv-muor': 'muLongRoad',
    'rv-steer': 'maxSteer',
    'rv-steers': 'steerSpeed',
    'rv-yawd': 'yawDampK',
  };

  const VEHICLE_TWEAKER_VARIANT_CONTROL_PROPS = {
    'rv-veh-accel': 'accelDurationMult',
    'rv-veh-cgf': 'cgToFront',
    'rv-veh-cgr': 'cgToRear',
    'rv-veh-gears': 'gearCount',
    'rv-veh-maxspeed': 'maxSpeed',
    'rv-veh-wheel': 'wheelbase',
  };

  function findVariantReferenceCar(kind, getCars) {
    if (!kind || typeof getCars !== 'function') return null;
    const carSet = getCars() || {};
    const player = carSet.player;
    if (player && player.kind === kind && player.vehicleVariant) return player;
    if (Array.isArray(carSet.ai)) {
      return carSet.ai.find((car) => car && car.kind === kind && car.vehicleVariant) || null;
    }
    return null;
  }

  function buildVariantTweakDisplay(kind, variantId, prop) {
    if (!kind || !variantId || !prop || !VEHICLE_DEFAULTS[kind]) return null;
    const setup = resolveVehicleSetup(kind, variantId);
    const variant = setup.variant;
    if (!variant || !setup.defaults) return null;

    const baseValue = Number(VEHICLE_DEFAULTS[kind][prop]);
    const effectiveValue = Number(setup.defaults[prop]);
    if (!Number.isFinite(baseValue) || !Number.isFinite(effectiveValue)) return null;
    const diff = effectiveValue - baseValue;
    if (Math.abs(diff) <= Math.max(0.000001, Math.abs(baseValue) * 0.000001)) return null;

    const meta = VARIANT_TWEAK_PRESENTATION[prop] || {};
    const higherIsBuff =
      typeof meta.higherIsBuff === 'boolean' ? meta.higherIsBuff : null;
    const isBuff =
      higherIsBuff === null
        ? diff > 0
        : higherIsBuff
          ? diff > 0
          : diff < 0;
    const formatValue =
      typeof meta.format === 'function'
        ? meta.format
        : (value) => {
            const abs = Math.abs(Number(value));
            if (abs >= 100) return String(Math.round(Number(value)));
            if (abs >= 1) return Number(value).toFixed(2);
            return Number(value).toFixed(4);
          };
    const signedDiff = `${diff > 0 ? '+' : ''}${formatValue(diff)}`;
    const variantLabel = variant.variantLabel || variantId;
    const tuneName = variant.name ? ` ${variant.name}` : '';
    return {
      className: isBuff ? 'buff' : 'nerf',
      text: formatValue(effectiveValue),
      title: `${variantLabel}${tuneName}: base ${formatValue(baseValue)} → tuned ${formatValue(effectiveValue)} (${signedDiff})`,
    };
  }

  function installVariantDeltaReadouts(wrap, controlProps) {
    const readouts = {};
    if (!wrap || !controlProps) return readouts;
    for (const controlId of Object.keys(controlProps)) {
      const input = wrap.querySelector(`#${controlId}`);
      if (!input) continue;
      const row = input.closest('.rv-row');
      const valueEl = row && row.querySelector('.val');
      if (!row || !valueEl) continue;
      const delta = document.createElement('div');
      delta.className = 'variant-delta hidden';
      delta.setAttribute('aria-label', 'Variant tuned value');
      valueEl.insertAdjacentElement('afterend', delta);
      readouts[controlId] = delta;
    }
    return readouts;
  }

  function updateVariantDeltaReadouts(readouts, controlProps, kind, variantId) {
    if (!readouts || !controlProps) return;
    for (const controlId of Object.keys(readouts)) {
      const deltaEl = readouts[controlId];
      const prop = controlProps[controlId];
      const display = buildVariantTweakDisplay(kind, variantId, prop);
      if (!display) {
        deltaEl.textContent = '';
        deltaEl.className = 'variant-delta hidden';
        deltaEl.removeAttribute('title');
        continue;
      }
      deltaEl.textContent = display.text;
      deltaEl.className = `variant-delta ${display.className}`;
      deltaEl.title = display.title;
    }
  }

  function inferIzz(mass, length, width, yawInertiaScale = 1) {
    // Rectangular body moment around vertical (top-down)
    return mass * (length * length + width * width) / 12 *
      (Number.isFinite(yawInertiaScale) && yawInertiaScale > 0 ? yawInertiaScale : 1);
  }

  function recordColliderHull(car, widthPx, lengthPx) {
    if (!car) return;
    const resolvedWidth = Number.isFinite(widthPx)
      ? widthPx
      : (car.colliderWidth || car.width || 18);
    const resolvedLength = Number.isFinite(lengthPx)
      ? lengthPx
      : (car.colliderLength || car.length || 36);
    if (!car.physics) car.physics = {};
    car.physics.colliderHull = {
      width: resolvedWidth,
      length: resolvedLength,
      polygons: car.colliderPolygons
    };
  }

  let sharedPlanckRefresh = null;

  function injectVehicleTweaker(bridge = {}, getCars) {
    const existing = document.getElementById('rv-vehicle-tweaker');
    if (existing) {
      // Check version - v1.4+ has variant delta readouts
      const version = existing.dataset.version;
      if (version === '1.4') return; // Current version, no upgrade needed
      // Old version detected, remove and re-inject
      console.log('[Vehicle Tweaker] Upgrading from version', version || 'unknown', 'to 1.4');
      existing.remove();
    }
    ensureDevPanelStyles();
    const listKinds = typeof bridge.listKinds === 'function'
      ? bridge.listKinds
      : (() => Object.keys(VEHICLE_DEFAULTS));
    const kinds = (listKinds() || []).filter((k) => VEHICLE_DEFAULTS[k]);
    // Ensure Bubble is included if defined (fixes missing Bubble issue)
    if (!kinds.includes('Bubble') && VEHICLE_DEFAULTS['Bubble']) {
      kinds.push('Bubble');
    }
    if (!kinds.length) return;
    const getCarSet = () => {
      if (typeof getCars !== 'function') return {};
      return getCars() || {};
    };
    const getActiveVehicleKind = () => {
      const cars = getCarSet();
      const playerKind = cars.player && cars.player.kind;
      if (playerKind && kinds.includes(playerKind)) return playerKind;
      if (Array.isArray(cars.ai)) {
        const aiCar = cars.ai.find((car) => car && car.kind && kinds.includes(car.kind));
        if (aiCar) return aiCar.kind;
      }
      return kinds[0];
    };
    const activeVehicleKind = getActiveVehicleKind();
    const artState = {};
    const artDefaults = {};
    const colliderState = {};
    const colliderDefaults = {};
    const fetchArt = typeof bridge.getArtDimensions === 'function'
      ? bridge.getArtDimensions
      : (() => null);
    const fetchCollider = typeof bridge.getColliderDimensions === 'function'
      ? bridge.getColliderDimensions
      : (() => null);
    for (const kind of kinds) {
      const dims = fetchArt(kind) || {};
      const width = Number.isFinite(dims.width) ? dims.width : 30;
      const length = Number.isFinite(dims.length) ? dims.length : 50;
      artState[kind] = { width, length };
      artDefaults[kind] = { width, length };
      const colliderDims = fetchCollider(kind) || {};
      const colliderWidth = Number.isFinite(colliderDims.width) ? colliderDims.width : width;
      const colliderLength = Number.isFinite(colliderDims.length) ? colliderDims.length : length;
      colliderState[kind] = { width: colliderWidth, length: colliderLength };
      colliderDefaults[kind] = { width: colliderWidth, length: colliderLength };
    }
    const physDefaults = JSON.parse(JSON.stringify(VEHICLE_DEFAULTS));
    let colliderVisible = typeof bridge.getColliderVisibility === 'function'
      ? !!bridge.getColliderVisibility()
      : false;
    const DESCRIPTIONS = {
      vehSelect: 'Choose which vehicle these edits affect. Global applies the same edit to every vehicle.',
      lockAspect: 'Keeps the vehicle image from being stretched. When this is on, changing length also changes width to keep the same shape.',
      artWidth: 'How wide the vehicle looks on screen, in pixels. This changes the picture size, not just the crash box.',
      artLength: 'How long the vehicle looks on screen, in pixels. This changes the picture size, not just the crash box.',
      colliderWidth: 'Width of the vehicle collision silhouette. Changing this scales all contact shapes sideways.',
      colliderLength: 'Length of the vehicle collision silhouette. Changing this scales all contact shapes front to rear.',
      colliderVisible: 'Shows every collision shape over the vehicle artwork.',
      wheelbase: 'Distance between the front and rear wheels. Longer usually feels steadier but turns more slowly; shorter usually turns more sharply.',
      cgFront: 'How far the vehicle balance point is from the front wheels. Changing this shifts how the vehicle behaves while braking and turning.',
      cgRear: 'How far the vehicle balance point is from the rear wheels. Changing this shifts how the vehicle behaves while accelerating and turning.',
      accelDuration: 'Estimated seconds for the vehicle to accelerate from stopped to its top speed. Lower values accelerate faster; higher values accelerate slower.',
      topSpeed: 'Maximum speed in miles per hour. The vehicle will not keep accelerating past this cap; very high values behave like no practical cap.',
      gearCount: 'Number of forward gears. Fewer gears make bigger jumps between shifts; more gears make smaller jumps.',
      syncActive: 'Rebuilds currently spawned vehicles so your latest size, crash box, and physics edits take effect immediately.',
      resetSelection: 'Restores the selected vehicle or all vehicles to their original Vehicle Tweaker values.'
    };
    const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const tipAttr = (key) => (DESCRIPTIONS[key] ? ` title="${escapeAttr(DESCRIPTIONS[key])}"` : '');

    const wrap = document.createElement('div');
    wrap.id = 'rv-vehicle-tweaker';
    wrap.className = 'rv-devtools rv-veh';
    wrap.dataset.version = '1.4'; // Version with variant delta readouts
    wrap.innerHTML = `
      <button class="toggle">Vehicle Tweaker ▾</button>
      <div class="rv-panel" role="dialog" aria-label="Vehicle Tweaker">
        <div class="rv-row"><label for="rv-veh-kind"><span${tipAttr('vehSelect')}>Vehicle</span></label>
          <select id="rv-veh-kind">
            <option value="Global">Global</option>
            ${kinds.map((k) => `<option value="${k}"${k === activeVehicleKind ? ' selected' : ''}>${getVehicleLabel(k)}</option>`).join('')}
          </select>
        </div>
        <div class="rv-row"><label for="rv-veh-lock"><span${tipAttr('lockAspect')}>Lock aspect</span></label><input type="checkbox" id="rv-veh-lock"></div>
        <div class="rv-section vehicle">
          <h4>Visual Footprint</h4>
          <div class="rv-row"><label for="rv-veh-width"><span${tipAttr('artWidth')}>Width (px)</span></label><input id="rv-veh-width" type="range" min="10" max="80" step="1"><div class="val" id="rv-veh-width-v"></div></div>
          <div class="rv-row"><label for="rv-veh-length"><span${tipAttr('artLength')}>Length (px)</span></label><input id="rv-veh-length" type="range" min="30" max="140" step="1"><div class="val" id="rv-veh-length-v"></div></div>
        </div>
        <div class="rv-section vehicle">
          <h4>Collider</h4>
          <div class="rv-row"><label for="rv-veh-colw"><span${tipAttr('colliderWidth')}>Width (px)</span></label><input id="rv-veh-colw" type="range" min="10" max="80" step="1"><div class="val" id="rv-veh-colw-v"></div></div>
          <div class="rv-row"><label for="rv-veh-coll"><span${tipAttr('colliderLength')}>Length (px)</span></label><input id="rv-veh-coll" type="range" min="30" max="140" step="1"><div class="val" id="rv-veh-coll-v"></div></div>
          <div class="rv-row"><label for="rv-veh-colshow"><span${tipAttr('colliderVisible')}>Show collider</span></label><input type="checkbox" id="rv-veh-colshow"></div>
        </div>
        <div class="rv-section vehicle">
          <h4>Physics Footprint</h4>
          <div class="rv-row"><label for="rv-veh-wheel"><span${tipAttr('wheelbase')}>Wheelbase</span></label><input id="rv-veh-wheel" type="range" min="20" max="140" step="1"><div class="val" id="rv-veh-wheel-v"></div></div>
          <div class="rv-row"><label for="rv-veh-cgf"><span${tipAttr('cgFront')}>CG → front</span></label><input id="rv-veh-cgf" type="range" min="5" max="120" step="1"><div class="val" id="rv-veh-cgf-v"></div></div>
          <div class="rv-row"><label for="rv-veh-cgr"><span${tipAttr('cgRear')}>CG → rear</span></label><input id="rv-veh-cgr" type="range" min="5" max="120" step="1"><div class="val" id="rv-veh-cgr-v"></div></div>
          <div class="rv-row"><label for="rv-veh-accel"><span${tipAttr('accelDuration')}>0-top sec</span></label><input id="rv-veh-accel" type="range" min="1.0" max="10.0" step="0.1"><div class="val" id="rv-veh-accel-v"></div></div>
          <div class="rv-row"><label for="rv-veh-maxspeed"><span${tipAttr('topSpeed')}>Top mph</span></label><input id="rv-veh-maxspeed" type="range" min="10" max="750" step="1"><div class="val" id="rv-veh-maxspeed-v"></div></div>
          <div class="rv-row"><label for="rv-veh-gears"><span${tipAttr('gearCount')}>Gears amount</span></label><input id="rv-veh-gears" type="range" min="3" max="10" step="1"><div class="val" id="rv-veh-gears-v"></div></div>
        </div>
        <div class="rv-row rv-btns">
          <button id="rv-veh-sync" class="rv-mini"${tipAttr('syncActive')}>Sync active cars</button>
          <button id="rv-veh-reset" class="rv-mini"${tipAttr('resetSelection')}>Reset selection</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const els = {
      panel: wrap.querySelector('.rv-panel'),
      toggle: wrap.querySelector('.toggle'),
      kind: document.getElementById('rv-veh-kind'),
      lock: document.getElementById('rv-veh-lock'),
      width: document.getElementById('rv-veh-width'),
      widthVal: document.getElementById('rv-veh-width-v'),
      length: document.getElementById('rv-veh-length'),
      lengthVal: document.getElementById('rv-veh-length-v'),
      colWidth: document.getElementById('rv-veh-colw'),
      colWidthVal: document.getElementById('rv-veh-colw-v'),
      colLength: document.getElementById('rv-veh-coll'),
      colLengthVal: document.getElementById('rv-veh-coll-v'),
      colShow: document.getElementById('rv-veh-colshow'),
      wheel: document.getElementById('rv-veh-wheel'),
      wheelVal: document.getElementById('rv-veh-wheel-v'),
      cgf: document.getElementById('rv-veh-cgf'),
      cgfVal: document.getElementById('rv-veh-cgf-v'),
      cgr: document.getElementById('rv-veh-cgr'),
      cgrVal: document.getElementById('rv-veh-cgr-v'),
      accel: document.getElementById('rv-veh-accel'),
      accelVal: document.getElementById('rv-veh-accel-v'),
      maxSpeed: document.getElementById('rv-veh-maxspeed'),
      maxSpeedVal: document.getElementById('rv-veh-maxspeed-v'),
      gears: document.getElementById('rv-veh-gears'),
      gearsVal: document.getElementById('rv-veh-gears-v'),
      sync: document.getElementById('rv-veh-sync'),
      reset: document.getElementById('rv-veh-reset')
    };
    const variantDeltaEls = installVariantDeltaReadouts(
      wrap,
      VEHICLE_TWEAKER_VARIANT_CONTROL_PROPS,
    );

    function targetKinds() {
      if (!els.kind) return [];
      const sel = els.kind.value;
      return sel === 'Global' ? kinds.slice() : [sel];
    }

    function anchorKind() {
      if (!els.kind) return kinds[0];
      return els.kind.value === 'Global' ? kinds[0] : els.kind.value;
    }

    function refreshFields() {
      const anchor = anchorKind();
      const art = artState[anchor];
      const collider = colliderState[anchor];
      const phys = VEHICLE_DEFAULTS[anchor];
      if (art) {
        if (els.width) {
          els.width.value = art.width;
          if (els.widthVal) els.widthVal.textContent = `${Math.round(art.width)}`;
        }
        if (els.length) {
          els.length.value = art.length;
          if (els.lengthVal) els.lengthVal.textContent = `${Math.round(art.length)}`;
        }
      }
      if (collider) {
        if (els.colWidth) {
          els.colWidth.value = collider.width;
          if (els.colWidthVal) els.colWidthVal.textContent = `${Math.round(collider.width)}`;
        }
        if (els.colLength) {
          els.colLength.value = collider.length;
          if (els.colLengthVal) els.colLengthVal.textContent = `${Math.round(collider.length)}`;
        }
      }
      if (els.colShow) {
        els.colShow.checked = !!colliderVisible;
      }
      if (phys) {
        if (els.wheel) {
          els.wheel.value = phys.wheelbase;
          if (els.wheelVal) els.wheelVal.textContent = `${Math.round(phys.wheelbase)}`;
        }
        if (els.cgf) {
          els.cgf.value = phys.cgToFront;
          if (els.cgfVal) els.cgfVal.textContent = `${Math.round(phys.cgToFront)}`;
        }
        if (els.cgr) {
          els.cgr.value = phys.cgToRear;
          if (els.cgrVal) els.cgrVal.textContent = `${Math.round(phys.cgToRear)}`;
        }
        if (els.accel) {
          const accelSeconds = phys.accelDurationMult != null ? phys.accelDurationMult : 1.0;
          els.accel.value = accelSeconds;
          if (els.accelVal) els.accelVal.textContent = `${accelSeconds.toFixed(1)}s`;
        }
        if (els.maxSpeed) {
          const maxSpeedPx = phys.maxSpeed != null ? phys.maxSpeed : 10000;
          const maxSpeedMph = clamp(Math.round(pxToMph(maxSpeedPx)), 10, 750);
          els.maxSpeed.value = maxSpeedMph;
          if (els.maxSpeedVal) els.maxSpeedVal.textContent = `${maxSpeedMph} mph`;
        }
        if (els.gears) {
          const gearCount = phys.gearCount != null ? phys.gearCount : 6;
          els.gears.value = gearCount;
          if (els.gearsVal) els.gearsVal.textContent = `${gearCount}`;
        }
      }
      const selectedKind = els.kind && els.kind.value;
      const variantKind = selectedKind === 'Global' ? null : anchor;
      const variantCar = variantKind ? findVariantReferenceCar(variantKind, getCarSet) : null;
      updateVariantDeltaReadouts(
        variantDeltaEls,
        VEHICLE_TWEAKER_VARIANT_CONTROL_PROPS,
        variantKind,
        variantCar && variantCar.vehicleVariant,
      );
    }

    function refreshActiveCarPhysics(kindsToRefresh) {
      if (typeof getCars !== 'function') return;
      const listKinds = Array.isArray(kindsToRefresh) ? kindsToRefresh : [kindsToRefresh];
      const cset = getCars() || {};
      const cars = [];
      if (cset.player && listKinds.includes(cset.player.kind)) cars.push(cset.player);
      if (Array.isArray(cset.ai)) {
        for (const car of cset.ai) {
          if (car && listKinds.includes(car.kind)) cars.push(car);
        }
      }
      if (!cars.length) return;
      for (const car of cars) {
        const baseDefaults = VEHICLE_DEFAULTS[car.kind];
        const setup = resolveVehicleSetup(car.kind, car.vehicleVariant);
        const base = setup.defaults;
        if (!baseDefaults || !base) continue;

        // Ensure physics is initialized
        if (!car.physics || !car.physics.params) {
          initCar(car, car.kind);
        }

        if (car.physics && car.physics.params) {
          const touchSteerDefaults = base.touchSteer
            ? { ...base.touchSteer }
            : car.physics.params.touchSteer;
          car.physics.params = {
            ...car.physics.params,
            ...base,
            touchSteer: touchSteerDefaults,
          };
          car.physics.params.accelDurationMult = base.accelDurationMult != null ? base.accelDurationMult : 1.0;
          car.physics.params.maxSpeed = base.maxSpeed != null ? base.maxSpeed : 10000;
          car.physics.a = base.cgToFront;
          car.physics.b = base.cgToRear;

          // Ensure gearbox exists
          if (!car.gearbox) {
            car.gearbox = new Gearbox(getVehicleGearboxConfig(base));
          }

          applyVehicleGearboxDefaults(car.gearbox, base);
          const art = artState[car.kind];
          const collider = colliderState[car.kind];
          const mass = car.physics.params.mass || base.mass || 1;
          const Lpx = Number.isFinite(car.colliderLength) ? car.colliderLength
            : (collider ? collider.length : Number.isFinite(car.length) ? car.length : (art ? art.length : 50));
          const Wpx = Number.isFinite(car.colliderWidth) ? car.colliderWidth
            : (collider ? collider.width : Number.isFinite(car.width) ? car.width : (art ? art.width : 20));
          recordColliderHull(car, Wpx, Lpx);
          car.physics.Izz = inferIzz(mass, car.inertiaLength || Lpx, car.inertiaWidth || Wpx, car.physics.params.yawInertiaScale);
        }
        removePlanckBody(car);
      }
      registerPlanckCars(cars);

      // If clone physics is enabled, sync changes to all AI cars through the clone system
      if (els.clonePhysics && els.clonePhysics.checked) {
        applyClonePhysicsToAI();
      }
      if (typeof window !== 'undefined' && window.GearboxTuner && typeof window.GearboxTuner.refresh === 'function') {
        try {
          window.GearboxTuner.refresh();
        } catch (_) {
          /* ignore dev-panel refresh errors */
        }
      }
    }
    sharedPlanckRefresh = refreshActiveCarPhysics;

    function applyArtChange(prop, value, opts = {}) {
      const targets = targetKinds();
      let changed = false;
      for (const kind of targets) {
        const entry = artState[kind];
        if (!entry) continue;
        const prevRatio = entry.length ? entry.width / entry.length : 1;
        if (prop === 'length') {
          entry.length = value;
          if (opts.lockAspect) {
            entry.width = clamp(value * prevRatio, 10, 80);
          }
        } else {
          entry.width = value;
        }
        if (typeof bridge.setArtDimensions === 'function') {
          bridge.setArtDimensions(kind, { ...entry });
        }
        changed = true;
      }
      if (changed) {
        refreshActiveCarPhysics(targets);
        refreshFields();
      }
    }

    function applyColliderChange(prop, value) {
      const targets = targetKinds();
      let changed = false;
      for (const kind of targets) {
        const entry = colliderState[kind];
        if (!entry) continue;
        entry[prop] = value;
        if (typeof bridge.setColliderDimensions === 'function') {
          bridge.setColliderDimensions(kind, { ...entry });
        }
        changed = true;
      }
      if (changed) {
        refreshActiveCarPhysics(targets);
        refreshFields();
      }
    }

    function applyColliderVisibilityChange(next) {
      const enabled = !!next;
      colliderVisible = enabled;
      if (els.colShow) els.colShow.checked = enabled;
      if (typeof bridge.setColliderVisibility === 'function') {
        bridge.setColliderVisibility(enabled);
      }
    }

    function applyPhysChange(prop, value, opts = {}) {
      const targets = Array.isArray(opts.targets)
        ? opts.targets
        : opts.singleKind
          ? [opts.singleKind]
          : targetKinds();
      for (const kind of targets) {
        const base = VEHICLE_DEFAULTS[kind];
        if (!base) continue;
        if (prop === 'wheelbase') {
          const total = Math.max(1, base.cgToFront + base.cgToRear);
          const ratio = total > 0 ? base.cgToFront / total : 0.5;
          base.wheelbase = value;
          base.cgToFront = clamp(value * ratio, 1, 140);
          base.cgToRear = clamp(value - base.cgToFront, 1, 140);
        } else if (prop === 'cgToFront') {
          base.cgToFront = value;
          base.wheelbase = clamp(base.cgToFront + base.cgToRear, 5, 180);
        } else if (prop === 'cgToRear') {
          base.cgToRear = value;
          base.wheelbase = clamp(base.cgToFront + base.cgToRear, 5, 180);
        } else if (prop === 'accelDurationMult') {
          base.accelDurationMult = value;
        } else if (prop === 'maxSpeed') {
          base.maxSpeed = value;
        } else if (prop === 'gearCount') {
          base.gearCount = value;
        }
      }
      refreshActiveCarPhysics(targets);
      refreshFields();
    }

    function resetSelection() {
      const targets = targetKinds();
      for (const kind of targets) {
        if (artDefaults[kind]) {
          artState[kind] = { ...artDefaults[kind] };
          if (typeof bridge.setArtDimensions === 'function') {
            bridge.setArtDimensions(kind, { ...artState[kind] });
          }
        }
        if (colliderDefaults[kind]) {
          colliderState[kind] = { ...colliderDefaults[kind] };
          if (typeof bridge.setColliderDimensions === 'function') {
            bridge.setColliderDimensions(kind, { ...colliderState[kind] });
          }
        }
        if (physDefaults[kind]) {
          VEHICLE_DEFAULTS[kind].wheelbase = physDefaults[kind].wheelbase;
          VEHICLE_DEFAULTS[kind].cgToFront = physDefaults[kind].cgToFront;
          VEHICLE_DEFAULTS[kind].cgToRear = physDefaults[kind].cgToRear;
          VEHICLE_DEFAULTS[kind].accelDurationMult = physDefaults[kind].accelDurationMult != null ? physDefaults[kind].accelDurationMult : 1.0;
          VEHICLE_DEFAULTS[kind].maxSpeed = physDefaults[kind].maxSpeed != null ? physDefaults[kind].maxSpeed : 10000;
          VEHICLE_DEFAULTS[kind].gearCount = physDefaults[kind].gearCount != null ? physDefaults[kind].gearCount : 6;
          VEHICLE_DEFAULTS[kind].gearTopSpeedMph = physDefaults[kind].gearTopSpeedMph;
          VEHICLE_DEFAULTS[kind].gearTopSpeedMps = physDefaults[kind].gearTopSpeedMps;
          VEHICLE_DEFAULTS[kind].gearFirstRatio = physDefaults[kind].gearFirstRatio;
          VEHICLE_DEFAULTS[kind].gearSpacing = physDefaults[kind].gearSpacing;
        }
      }
      refreshActiveCarPhysics(targets);
      refreshFields();
    }

    if (els.toggle && els.panel) {
      els.toggle.addEventListener('click', () => {
        els.panel.classList.toggle('open');
        els.toggle.textContent = els.panel.classList.contains('open') ? 'Vehicle Tweaker ▴' : 'Vehicle Tweaker ▾';
      });
    }
    if (els.kind) {
      els.kind.addEventListener('change', () => refreshFields());
    }
    if (els.width) {
      els.width.addEventListener('input', () => {
        const v = clamp(+els.width.value || 0, 10, 80);
        applyArtChange('width', v);
      });
    }
    if (els.length) {
      els.length.addEventListener('input', () => {
        const v = clamp(+els.length.value || 0, 30, 140);
        applyArtChange('length', v, { lockAspect: !!(els.lock && els.lock.checked) });
      });
    }
    if (els.colWidth) {
      els.colWidth.addEventListener('input', () => {
        const v = clamp(+els.colWidth.value || 0, 10, 80);
        applyColliderChange('width', v);
      });
    }
    if (els.colLength) {
      els.colLength.addEventListener('input', () => {
        const v = clamp(+els.colLength.value || 0, 30, 140);
        applyColliderChange('length', v);
      });
    }
    if (els.colShow) {
      els.colShow.addEventListener('change', () => {
        applyColliderVisibilityChange(!!els.colShow.checked);
      });
    }
    if (els.wheel) {
      els.wheel.addEventListener('input', () => {
        const v = clamp(+els.wheel.value || 0, 20, 140);
        applyPhysChange('wheelbase', v);
      });
    }
    if (els.cgf) {
      els.cgf.addEventListener('input', () => {
        const v = clamp(+els.cgf.value || 0, 5, 120);
        applyPhysChange('cgToFront', v);
      });
    }
    if (els.cgr) {
      els.cgr.addEventListener('input', () => {
        const v = clamp(+els.cgr.value || 0, 5, 120);
        applyPhysChange('cgToRear', v);
      });
    }
    if (els.accel) {
      els.accel.addEventListener('input', () => {
        const seconds = clamp(+els.accel.value || 1.0, 1.0, 10.0);
        applyPhysChange('accelDurationMult', seconds, { singleKind: anchorKind() });
      });
    }
    if (els.maxSpeed) {
      els.maxSpeed.addEventListener('input', () => {
        const mph = clamp(+els.maxSpeed.value || 10, 10, 750);
        applyPhysChange('maxSpeed', mphToPx(mph));
      });
    }
    if (els.gears) {
      els.gears.addEventListener('input', () => {
        const v = Math.round(clamp(+els.gears.value || 6, 3, 10));
        applyPhysChange('gearCount', v);
      });
    }
    if (els.reset) els.reset.addEventListener('click', resetSelection);
    if (els.sync) els.sync.addEventListener('click', () => {
      refreshActiveCarPhysics(targetKinds());
    });

    refreshFields();
  }

  function forcePlanckRefresh(kinds) {
    if (!sharedPlanckRefresh) return;
    const list = Array.isArray(kinds) ? kinds : [kinds];
    sharedPlanckRefresh(list);
  }

  // -- Reverse stability knobs (single source of truth) --
  const REVERSE_CFG_DEFAULTS = {
    vxHyst: 18,   // hysteresis band (px/s) for forward/backward direction
    steerScale: 0.55, // steering scale when reversing (0.3..1.0)
    yawMul: 1.30  // yaw damping multiplier when reversing (1.0..2.0)
  };
  let REVERSE_CFG = { ...REVERSE_CFG_DEFAULTS };

  function loadReverseCfg() {
    if (!DEV_TOOLS_ENABLED) return;
    try {
      if (typeof localStorage === 'undefined') return;
      const j = JSON.parse(localStorage.getItem('RacingVibesReverseCfg.json') || '{}');
      REVERSE_CFG = { ...REVERSE_CFG, ...j };
    } catch (_) { }
  }
  function saveReverseCfg() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem('RacingVibesReverseCfg.json', JSON.stringify(REVERSE_CFG));
    } catch (_) { }
  }
  loadReverseCfg();
  // -------------------------------------------------------------

  const DEVTOOLS_SAVE_KEY = 'RacingVibesSavedDevTools.json';
  let DEVTOOLS_SAVED = {};
  function loadDevtoolsSaved() {
    if (!DEV_TOOLS_ENABLED) return;
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(DEVTOOLS_SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          DEVTOOLS_SAVED = parsed;
        }
      }
    } catch (_) { }
  }
  function saveDevtoolsSaved() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(DEVTOOLS_SAVE_KEY, JSON.stringify(DEVTOOLS_SAVED));
    } catch (_) { }
  }
  loadDevtoolsSaved();

  async function ensureStoragePersistence() {
    try {
      if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) return;
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    } catch (_) {/* ignore */ }
  }
  ensureStoragePersistence();


  const PRESET_DB_NAME = 'RacingVibesDevPresets';
  const PRESET_DB_STORE = 'presets';
  const PRESET_FALLBACK_KEY = 'RacingVibesDevPresetsFallback';
  let presetDBPromise = null;

  function loadPresetFallbackMap() {
    try {
      const raw = localStorage.getItem(PRESET_FALLBACK_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {/* ignore */ }
    return {};
  }

  function savePresetFallbackMap(map) {
    try {
      localStorage.setItem(PRESET_FALLBACK_KEY, JSON.stringify(map));
    } catch (_) {/* ignore */ }
  }

  function hasIndexedDB() {
    try {
      return typeof indexedDB !== 'undefined';
    } catch (_) {
      return false;
    }
  }

  function openPresetDB() {
    if (!hasIndexedDB()) return Promise.resolve(null);
    if (presetDBPromise) return presetDBPromise;
    presetDBPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(PRESET_DB_NAME, 1);
      request.onerror = () => reject(request.error || new Error('Preset DB open failed'));
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(PRESET_DB_STORE)) {
          db.createObjectStore(PRESET_DB_STORE, { keyPath: 'name' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
    }).catch((err) => {
      console.warn('[DevTools] Unable to open preset storage', err);
      presetDBPromise = null;
      return null;
    });
    return presetDBPromise;
  }

  async function listPresetEntries() {
    try {
      const db = await openPresetDB();
      if (!db) {
        const map = loadPresetFallbackMap();
        const arr = Object.values(map);
        arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return arr;
      }
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(PRESET_DB_STORE, 'readonly');
        const store = tx.objectStore(PRESET_DB_STORE);
        const request = store.getAll();
        request.onsuccess = () => {
          const arr = Array.isArray(request.result) ? request.result : [];
          arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          resolve(arr);
        };
        request.onerror = () => reject(request.error || new Error('Preset getAll failed'));
        tx.onerror = () => reject(tx.error || new Error('Preset transaction failed'));
      });
    } catch (err) {
      console.warn('[DevTools] Failed to read presets', err);
      const map = loadPresetFallbackMap();
      return Object.values(map);
    }
  }

  async function savePresetRecord(entry) {
    try {
      const db = await openPresetDB();
      entry.updatedAt = Date.now();
      if (!db) {
        const map = loadPresetFallbackMap();
        map[entry.name] = entry;
        savePresetFallbackMap(map);
        return entry;
      }
      await new Promise((resolve, reject) => {
        const tx = db.transaction(PRESET_DB_STORE, 'readwrite');
        tx.objectStore(PRESET_DB_STORE).put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Preset save failed'));
        tx.onabort = () => reject(tx.error || new Error('Preset save aborted'));
      });
      return entry;
    } catch (err) {
      console.error('[DevTools] Failed to save preset', err);
      const map = loadPresetFallbackMap();
      map[entry.name] = entry;
      savePresetFallbackMap(map);
      return entry;
    }
  }

  async function deletePresetRecord(name) {
    try {
      const db = await openPresetDB();
      if (!db) {
        const map = loadPresetFallbackMap();
        if (map[name]) {
          delete map[name];
          savePresetFallbackMap(map);
        }
        return;
      }
      await new Promise((resolve, reject) => {
        const tx = db.transaction(PRESET_DB_STORE, 'readwrite');
        tx.objectStore(PRESET_DB_STORE).delete(name);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Preset delete failed'));
        tx.onabort = () => reject(tx.error || new Error('Preset delete aborted'));
      });
    } catch (err) {
      console.error('[DevTools] Failed to delete preset', err);
      const map = loadPresetFallbackMap();
      if (map[name]) {
        delete map[name];
        savePresetFallbackMap(map);
      }
    }
  }

  let DEVTOOLS_PRESETS = {};
  async function loadDevtoolsPresets() {
    if (!DEV_TOOLS_ENABLED) return {};
    const entries = await listPresetEntries();
    DEVTOOLS_PRESETS = {};
    for (const entry of entries) {
      if (entry && entry.name) DEVTOOLS_PRESETS[entry.name] = entry;
    }
    return DEVTOOLS_PRESETS;
  }
  loadDevtoolsPresets().catch(() => { });

  function worldToBody(vx, vy, angle, result = null) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const out = result || { x: 0, y: 0 };
    out.x = c * vx + s * vy;
    out.y = -s * vx + c * vy;
    return out;
  }
  function bodyToWorld(vx, vy, angle, result = null) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const out = result || { x: 0, y: 0 };
    out.x = c * vx - s * vy;
    out.y = s * vx + c * vy;
    return out;
  }

  function axleNormalLoads(mass, a, b) {
    // Static distribution across front (at distance a from CG) and rear (b)
    const L = a + b; const Fzf = mass * g * (b / L); const Fzr = mass * g * (a / L); // per axle (aggregate of 2 tires)
    return { Fzf, Fzr };
  }

  const planckState = {
    world: null,
    trackBody: null,
    trackSegments: [],
    decorWallSegments: [], // All wall segments (inner + outer)
    stadiumSegments: [],   // Stadium polygons
    decorWallBodies: [],   // Planck bodies for walls
    stadiumBodies: [],     // Planck bodies for stadiumPerimeter
    ppm: PLANCK_DEFAULTS.pixelsPerMeter,
    velIters: PLANCK_DEFAULTS.velIters,
    posIters: PLANCK_DEFAULTS.posIters,
    gravityY: 0,
    doSleep: PLANCK_DEFAULTS.planckDoSleep,
    pendingDt: 0,
    steppedThisFrame: false,
    carEntries: new Map(),
    bodyCars: new Map(),
    restitution: PLANCK_DEFAULTS.restitution,
    needsWorldBuild: false
  };

  // Keep sustained car-to-car rubbing less "grabby" than wall contacts so
  // side-by-side traffic can separate without a tangential impulse hooking either car.
  // Linear and angular impact momentum are otherwise left to Planck's mass/inertia
  // solver; do not rewrite either velocity after the contact has been solved.
  const CAR_TO_CAR_CONTACT = Object.freeze({
    restitution: 0.02,
    friction: 0.015,
    // Chassis mass is distributed toward the axles, rather than uniformly
    // through a small rectangle. More yaw inertia slows the initial impact
    // rotation; authored tire moments are calibrated to this inertia below.
    yawInertiaScale: 1.65
  });

  // A brief, capped restoring torque catches front-quarter and nose-to-rear clips. Keep the
  // solver's initial impact and linear momentum intact; large hits can still spin.
  const QUARTER_CONTACT_STABILITY = Object.freeze({
    duration: 0.3,
    yawDamping: 20,
    maxAcceleration: 16,
    minHeadingDot: 0.7
  });

  function markQuarterContactStability(contact, carA, carB) {
    const bodyA = carA.physics.planckBody;
    const bodyB = carB.physics.planckBody;
    if (Math.cos(bodyA.getAngle() - bodyB.getAngle()) < QUARTER_CONTACT_STABILITY.minHeadingDot) return;
    const manifold = contact.getWorldManifold(null);
    if (!manifold || !manifold.points) return;
    const count = contact.getManifold().pointCount;
    const ppm = planckState.ppm || PPM_DEFAULT;
    const rearA = -(carA.colliderLength || carA.length || 36) * 0.25 / ppm;
    const rearB = -(carB.colliderLength || carB.length || 36) * 0.25 / ppm;
    for (let i = 0; i < count; i++) {
      const localA = bodyA.getLocalPoint(manifold.points[i]);
      const localB = bodyB.getLocalPoint(manifold.points[i]);
      // A nose-to-rear clip supports both cars; a front-to-side clip also
      // supports the front-contacted car. Multiple points share one timer.
      const supportA = localA.x > -rearA || (localA.x < rearA && localB.x > -rearB);
      const supportB = localB.x > -rearB || (localB.x < rearB && localA.x > -rearA);
      if (supportA) markContactYawSupport(planckState.carEntries.get(carA));
      if (supportB) markContactYawSupport(planckState.carEntries.get(carB));
    }
  }

  function markContactYawSupport(entry) {
    // Catch impact-induced yaw around the turn already in progress. Do not
    // continually reset the reference to the struck car's new spin rate.
    if (!(entry.quarterContactTime > 0)) entry.contactReferenceYaw = entry.preContactYaw || 0;
    entry.quarterContactTime = QUARTER_CONTACT_STABILITY.duration;
  }

  // Tag recent car-to-car contacts so AI steering/recovery can be delayed briefly.
  const AI_CONTACT_RECOVERY_DELAY = Object.freeze({
    baseDelayMs: 180,
    maxImpactExtraDelayMs: 620,
    // Impulse / reduced mass is the relative velocity change, in m/s. Unlike
    // raw impulse, this describes the same severity for a Bubble and a Truck.
    impactScaleRef: 12
  });

  function clamp01(value) {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
  }

  function getNowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  function markCarContactRecoveryDelay(car, impactUnit, otherCar) {
    if (!car) return;
    const now = getNowMs();
    const impact = clamp01(impactUnit);
    const durationMs =
      AI_CONTACT_RECOVERY_DELAY.baseDelayMs +
      impact * AI_CONTACT_RECOVERY_DELAY.maxImpactExtraDelayMs;
    // Resting pressure/rubbing must not keep restarting an impact reaction.
    if (impact > 0.08) {
      car.aiContactRecoveryStart = now;
      car.aiContactRecoveryUntil = Math.max(Number(car.aiContactRecoveryUntil) || 0, now + durationMs);
      car.aiContactImpact = impact;
    }
    if (otherCar && otherCar !== car) {
      const angle = Number.isFinite(Number(car.angle)) ? Number(car.angle) : 0;
      const dx = (Number(otherCar.x) || 0) - (Number(car.x) || 0);
      const dy = (Number(otherCar.y) || 0) - (Number(car.y) || 0);
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const lateral = dx * -s + dy * c;
      const longitudinal = dx * c + dy * s;
      car.aiContactOther = otherCar;
      car.aiContactUpdatedAt = now;
      car.aiContactLateral = Number.isFinite(lateral) ? lateral : 0;
      car.aiContactLongitudinal = Number.isFinite(longitudinal) ? longitudinal : 0;
      car.aiContactSide = Math.abs(lateral) > 1 ? Math.sign(lateral) : 0;
    }
  }

  function findCarForBody(body) {
    return planckState.bodyCars.get(body) || null;
  }

  function destroyPlanckWorld() {
    if (!planckState.world) return;
    for (const { body } of planckState.carEntries.values()) {
      try { planckState.world.destroyBody(body); } catch (_) { }
    }
    planckState.carEntries.clear();
    planckState.bodyCars.clear();
    if (planckState.trackBody) {
      try { planckState.world.destroyBody(planckState.trackBody); } catch (_) { }
    }
    planckState.trackBody = null;
    // Destroy decor wall bodies
    for (const b of planckState.decorWallBodies) {
      try { planckState.world.destroyBody(b); } catch (_) { }
    }
    planckState.decorWallBodies = [];
    // Destroy stadium bodies
    for (const b of planckState.stadiumBodies) {
      try { planckState.world.destroyBody(b); } catch (_) { }
    }
    planckState.stadiumBodies = [];
    planckState.world = null;
  }

  function configureTrackCollision(trackSegments, opts = {}) {
    planckState.trackSegments = Array.isArray(trackSegments) ? trackSegments.slice() : [];
    if (typeof opts.ppm === 'number' && Number.isFinite(opts.ppm) && opts.ppm > 0) {
      planckState.ppm = opts.ppm;
    }
    if (typeof opts.restitution === 'number') {
      planckState.restitution = opts.restitution;
    }
    if (typeof opts.gravityY === 'number') {
      planckState.gravityY = opts.gravityY;
    }
    if (typeof opts.doSleep === 'boolean') {
      planckState.doSleep = opts.doSleep;
    }
    planckState.needsWorldBuild = true;
  }

  function configureDecorCollision(wallSegments, stadiumSegments) {
    planckState.decorWallSegments = Array.isArray(wallSegments) ? wallSegments.slice() : [];
    planckState.stadiumSegments = Array.isArray(stadiumSegments) ? stadiumSegments.slice() : [];
    planckState.needsWorldBuild = true;
  }

  // Deprecated alias
  function configureInnerWalls(wallSegments) {
    configureDecorCollision(wallSegments, []);
  }

  function rebuildPlanckWorld({ cars } = {}) {
    const carList = Array.isArray(cars) ? cars.slice() : Array.from(planckState.carEntries.keys());
    destroyPlanckWorld();
    const world = createWorld({ gravityY: planckState.gravityY, doSleep: planckState.doSleep });
    planckState.world = world;

    world.on('pre-solve', function (contact) {
      if (!contact) return;
      const fixtureA = contact.getFixtureA();
      const fixtureB = contact.getFixtureB();
      if (!fixtureA || !fixtureB) return;
      const carA = findCarForBody(fixtureA.getBody());
      if (!carA) return;
      const carB = findCarForBody(fixtureB.getBody());
      if (!carB || carA === carB) return;
      contact.setRestitution(CAR_TO_CAR_CONTACT.restitution);
      contact.setFriction(CAR_TO_CAR_CONTACT.friction);
    });

    // Track collisions for SFX
    world.on('post-solve', function(contact, contactImpulse) {
      if (!contact || !contactImpulse || !contactImpulse.normalImpulses) return;
      const impulses = contactImpulse.normalImpulses;
      let rawImpulse = 0;
      if (impulses && typeof impulses.length === 'number') {
        for (let i = 0; i < impulses.length; i++) {
          const value = impulses[i];
          if (Number.isFinite(value)) rawImpulse += value;
        }
      }
      if (!(rawImpulse > 0)) return;
      const fixtureA = contact.getFixtureA();
      const fixtureB = contact.getFixtureB();
      if (!fixtureA || !fixtureB) return;
      const bA = fixtureA.getBody();
      const bB = fixtureB.getBody();
      const carA = findCarForBody(bA);
      const carB = findCarForBody(bB);
      const carToCar = !!(carA && carB && carA !== carB);
      if (carToCar) {
        const relativeDeltaSpeed = rawImpulse * (1 / bA.getMass() + 1 / bB.getMass());
        // Sustained small tire/bumper pressure is not a new impact. Let the
        // support expire so it cannot hold down normal cornering indefinitely.
        if (relativeDeltaSpeed > 0.5) markQuarterContactStability(contact, carA, carB);
        const impactUnit = clamp01(relativeDeltaSpeed / AI_CONTACT_RECOVERY_DELAY.impactScaleRef);
        markCarContactRecoveryDelay(carA, impactUnit, carB);
        markCarContactRecoveryDelay(carB, impactUnit, carA);
      }
      if (rawImpulse > 0.5) {
        const impactScale = Math.min(1, rawImpulse * 0.05);
        if (carA) {
          carA.sfxImpact = Math.max(carA.sfxImpact || 0, impactScale);
        }
        if (carB && carB !== carA) {
          carB.sfxImpact = Math.max(carB.sfxImpact || 0, impactScale);
        }
      }
    });

    // Wall behavior permanently disabled - cars can freely drive over curbs onto grass
    planckState.trackBody = null;

    // Create decor wall physics bodies (inner + outer walls)
    planckState.decorWallBodies = [];
    planckState.stadiumBodies = [];

    const pl = window.planck;
    if (pl && world) {
      const ppm = planckState.ppm || PPM_DEFAULT;
      // Walls are rigid, slightly bouncy
      const wallRestitution = 0.2;
      // Stadiums are concrete, solid
      const stadiumRestitution = 0.1;

      // 1. Build Walls. One static body with many fixtures is cheaper for Planck
      // than many one-fixture bodies and behaves the same for edge contacts.
      if (planckState.decorWallSegments && planckState.decorWallSegments.length > 0) {
        const wallBody = world.createBody({ type: 'static' });
        let wallFixtures = 0;
        for (const seg of planckState.decorWallSegments) {
          try {
            // Check for valid segment
            if (!Number.isFinite(seg.x1) || !Number.isFinite(seg.y1) ||
              !Number.isFinite(seg.x2) || !Number.isFinite(seg.y2)) continue;

            const v1 = pl.Vec2(meters(seg.x1, ppm), meters(seg.y1, ppm));
            const v2 = pl.Vec2(meters(seg.x2, ppm), meters(seg.y2, ppm));
            const edgeShape = pl.Edge(v1, v2);
            wallBody.createFixture(edgeShape, {
              friction: 0.5,
              restitution: wallRestitution
            });
            wallFixtures++;
          } catch (_) { /* Skip invalid wall segments */ }
        }
        if (wallFixtures > 0) {
          planckState.decorWallBodies.push(wallBody);
        } else {
          try { world.destroyBody(wallBody); } catch (_) { }
        }
      }

      // 2. Build Stadiums. Batch loop fixtures onto one static body as well.
      if (planckState.stadiumSegments && planckState.stadiumSegments.length > 0) {
        const stadiumBody = world.createBody({ type: 'static' });
        let stadiumFixtures = 0;
        for (const stadium of planckState.stadiumSegments) {
          if (!stadium || !Array.isArray(stadium.points) || stadium.points.length < 3) continue;

          try {
            const verts = stadium.points.map(p => pl.Vec2(meters(p.x, ppm), meters(p.y, ppm)));

            // Use Chain shape for the perimeter
            // Create a loop (closed chain)
            const chain = pl.Chain(verts, true); // true = loop

            stadiumBody.createFixture(chain, {
              friction: 0.6,
              restitution: stadiumRestitution
            });
            stadiumFixtures++;
          } catch (err) {
            console.warn('Failed to create stadium body', err);
          }
        }
        if (stadiumFixtures > 0) {
          planckState.stadiumBodies.push(stadiumBody);
        } else {
          try { world.destroyBody(stadiumBody); } catch (_) { }
        }
      }
    }

    planckState.needsWorldBuild = false;
    planckState.steppedThisFrame = false;
    planckState.pendingDt = 0;
    if (carList.length) {
      registerPlanckCars(carList);
    }
  }

  function removePlanckBody(car) {
    if (!car) return;
    const entry = planckState.carEntries.get(car);
    if (entry && planckState.world) {
      try { planckState.world.destroyBody(entry.body); } catch (_) { }
    }
    planckState.carEntries.delete(car);
    if (entry) planckState.bodyCars.delete(entry.body);
    if (car.physics) {
      car.physics.planckBody = null;
    }
  }

  function updateBodyPose(body, car, ppm) {
    if (!body || !car) return;
    const pl = window.planck;
    if (!pl) return;
    const pos = pl.Vec2(meters(car.x || 0, ppm), meters(car.y || 0, ppm));
    body.setTransform(pos, car.angle || 0);
    body.setLinearVelocity(pl.Vec2(0, 0));
    body.setAngularVelocity(0);
  }

  function createCarBody(world, car, P, ppmOverride) {
    const pl = window.planck;
    if (!world || !car || !pl) return null;
    const ppm = ppmOverride || planckState.ppm || PPM_DEFAULT;
    const visualWidthPx = car.width || (car.dim && car.dim.widthPx) || 18;
    const visualLengthPx = car.length || (car.dim && car.dim.lengthPx) || 36;
    const colliderWidthPx = car.colliderWidth || visualWidthPx;
    const colliderLengthPx = car.colliderLength || visualLengthPx;
    recordColliderHull(car, colliderWidthPx, colliderLengthPx);
    const lengthMeters = meters(car.inertiaLength || colliderLengthPx, ppm);
    const widthMeters = meters(car.inertiaWidth || colliderWidthPx, ppm);
    const halfLength = Math.max(0.01, meters(colliderLengthPx, ppm) * 0.5);
    const halfWidth = Math.max(0.01, meters(colliderWidthPx, ppm) * 0.5);
    const desiredMass = (P && typeof P.mass === 'number') ? Math.max(0.01, P.mass) : 1.0;
    const area = Math.max(1e-6, lengthMeters * widthMeters);
    const density = desiredMass / area;
    const body = world.createBody({
      type: 'dynamic',
      position: pl.Vec2(meters(car.x || 0, ppm), meters(car.y || 0, ppm)),
      angle: car.angle || 0,
      linearDamping: P && typeof P.linearDamp === 'number' ? P.linearDamp : 0,
      angularDamping: P && typeof P.angularDamp === 'number' ? P.angularDamp : 0,
      bullet: !isMobilePhysics,
      allowSleep: P && typeof P.planckDoSleep === 'boolean' ? P.planckDoSleep : planckState.doSleep
    });
    // Keep a bevelled fallback for synthetic/test cars without sprite traces.
    // Race cars use the offline-traced convex components below; all fixtures
    // share one body with the original authored mass and driving inertia.
    const bevelX = Math.min(halfLength * 0.22, halfWidth * 0.5);
    const bevelY = halfWidth * 0.3;
    const vertices = [
      pl.Vec2(-halfLength + bevelX, -halfWidth),
      pl.Vec2(halfLength - bevelX, -halfWidth),
      pl.Vec2(halfLength, -halfWidth + bevelY),
      pl.Vec2(halfLength, halfWidth - bevelY),
      pl.Vec2(halfLength - bevelX, halfWidth),
      pl.Vec2(-halfLength + bevelX, halfWidth),
      pl.Vec2(-halfLength, halfWidth - bevelY),
      pl.Vec2(-halfLength, -halfWidth + bevelY)
    ];
    const polygons = car.colliderPolygons || [vertices.map(point => ({x: point.x * ppm, y: point.y * ppm}))];
    car.physics.colliderHull.polygons = polygons;
    car.physics.colliderHull.vertices = car.colliderPolygons ? null : polygons[0];
    for (const polygon of polygons) {
      body.createFixture(pl.Polygon(polygon.map(point => pl.Vec2(point.x / ppm, point.y / ppm))), {
        density,
        friction: 0.45,
        restitution: P && typeof P.restitution === 'number' ? P.restitution : planckState.restitution
      });
    }
    body.setMassData({ mass: desiredMass, center: pl.Vec2(0, 0),
      I: inferIzz(desiredMass, lengthMeters, widthMeters, P.yawInertiaScale) * CAR_TO_CAR_CONTACT.yawInertiaScale });
    car.physics.planckBody = body;
    return body;
  }

  function ensurePlanckBody(car, P) {
    if (!car || !P || !P.usePlanck) {
      removePlanckBody(car);
      return null;
    }
    if (planckState.needsWorldBuild || !planckState.world) {
      rebuildPlanckWorld();
    }
    if (!planckState.world) return null;
    const desiredPpm = P.pixelsPerMeter || planckState.ppm || PPM_DEFAULT;
    if (desiredPpm > 0 && desiredPpm !== planckState.ppm) {
      planckState.ppm = desiredPpm;
    }
    if (typeof P.velIters === 'number') planckState.velIters = P.velIters;
    if (typeof P.posIters === 'number') planckState.posIters = P.posIters;
    if (typeof P.planckDoSleep === 'boolean') planckState.doSleep = P.planckDoSleep;
    let entry = planckState.carEntries.get(car);
    if (entry && entry.ppm !== planckState.ppm) {
      removePlanckBody(car);
      entry = null;
    }
    if (!entry) {
      const body = createCarBody(planckState.world, car, P, planckState.ppm);
      if (!body) return null;
      entry = { body, ppm: planckState.ppm, bullet: !isMobilePhysics };
      planckState.carEntries.set(car, entry);
      planckState.bodyCars.set(body, car);
    }
    return entry.body;
  }

  function registerPlanckCars(cars) {
    if (!cars) return;
    const arr = Array.isArray(cars) ? cars : [cars];
    for (const car of arr) {
      if (!car || !car.physics) continue;
      const P = car.physics.params || car.physics;
      if (P && P.usePlanck) {
        ensurePlanckBody(car, P);
      } else {
        removePlanckBody(car);
      }
    }
  }

  function planckBeginStep(dt, cars) {
    if (dt <= 0) { planckState.pendingDt = 0; planckState.steppedThisFrame = false; return; }
    if (cars) registerPlanckCars(cars);
    for (const entry of planckState.carEntries.values()) {
      entry.preContactYaw = entry.body.getAngularVelocity();
      if (!(entry.quarterContactTime > 0)) continue;
      const fade = entry.quarterContactTime / QUARTER_CONTACT_STABILITY.duration;
      // The free yaw reference follows ordinary chassis damping; support only
      // removes the excess rotation while both rates still point the same way.
      entry.contactReferenceYaw /= 1 + dt * entry.body.getAngularDamping();
      const yaw = entry.body.getAngularVelocity();
      const excess = yaw - entry.contactReferenceYaw;
      const acceleration = clamp(
        yaw * excess > 0 ? -excess * QUARTER_CONTACT_STABILITY.yawDamping : 0,
        -QUARTER_CONTACT_STABILITY.maxAcceleration,
        QUARTER_CONTACT_STABILITY.maxAcceleration
      );
      entry.body.applyTorque(acceleration * fade * entry.body.getInertia());
      entry.quarterContactTime = Math.max(0, entry.quarterContactTime - dt);
    }
    if (isMobilePhysics) {
      for (const [car, entry] of planckState.carEntries.entries()) {
        const body = entry && entry.body;
        if (!body || typeof body.setBullet !== 'function') continue;
        const vx = (car && car.physics && car.physics.vx) || (car && car.vx) || 0;
        const vy = (car && car.physics && car.physics.vy) || (car && car.vy) || 0;
        const shouldBullet = Math.hypot(vx, vy) > MOBILE_BULLET_SPEED_PX;
        if (entry.bullet !== shouldBullet) {
          body.setBullet(shouldBullet);
          entry.bullet = shouldBullet;
        }
      }
    }
    planckState.pendingDt = dt;
    planckState.steppedThisFrame = false;
  }

  function syncCarFromBody(car, entry) {
    if (!car || !entry) return;
    const body = entry.body;
    if (!body) return;
    const ppm = entry.ppm || planckState.ppm || PPM_DEFAULT;
    const pos = body.getPosition();
    const vel = body.getLinearVelocity();
    const angle = body.getAngle();
    const omega = body.getAngularVelocity();
    car.x = pixels(pos.x, ppm);
    car.y = pixels(pos.y, ppm);
    car.angle = angle;
    if (car.physics) {
      car.physics.vx = pixels(vel.x, ppm);
      car.physics.vy = pixels(vel.y, ppm);
      car.physics.r = omega;
      car.vx = car.physics.vx;
      car.vy = car.physics.vy;
      car.physics.planckBody = body;
    }
    car.speed = Math.hypot(car.vx || 0, car.vy || 0);
  }

  function planckStep() {
    if (!planckState.world || planckState.steppedThisFrame) return;
    const dt = planckState.pendingDt;
    if (!dt || dt <= 0) return;
    try {
      stepWorld(planckState.world, dt, planckState.velIters, planckState.posIters);
    } catch (err) {
      console.warn('[RacerPhysics] Planck world step failed', err);
    }
    planckState.steppedThisFrame = true;
    planckState.pendingDt = 0;
    for (const [car, entry] of planckState.carEntries.entries()) {
      syncCarFromBody(car, entry);
    }
  }

  function usesPlanckWorld() {
    if (!planckState.world) return false;
    if (!planckState.carEntries.size) return false;
    for (const car of planckState.carEntries.keys()) {
      const params = car && car.physics && car.physics.params;
      if (params && params.usePlanck) {
        return true;
      }
    }
    return false;
  }

  function initCar(car, kind) {
    const k = kind || car.kind || 'GT';
    const setup = resolveVehicleSetup(k, car && car.vehicleVariant);
    const base = setup.defaults;
    const previousParams = car.physics && car.physics.params;
    const engineReferenceChanged = previousParams &&
      ['gearRedlineRpm', 'gearTorquePeakRpm', 'gearTorqueIdle', 'gearEngineBrakePeak', 'gearShiftCutMs'].some(
        (key) => previousParams[key] !== base[key],
      );
    const touchSteerDefaults = base.touchSteer ? { ...base.touchSteer } : {
      maxSteerLowSpeed: base.maxSteer,
      maxSteerHighSpeed: base.maxSteer * 0.6,
      falloffSpeed: 240,
      baseSteerRate: base.steerSpeed,
      steerRateFalloff: 0.003,
      returnGain: 0,
      filterTau: 0.12
    };
    const params = { ...PLANCK_DEFAULTS, ...base, touchSteer: touchSteerDefaults };
    // If the art length/width differs, adapt wheelbase slightly to fit
    const Lpx = car.colliderLength || car.length || 36;
    const Wpx = car.colliderWidth || car.width || 18;
    // Keep cg distances proportional to given wheelbase
    const scale = params.wheelbase / Math.max(1, (params.cgToFront + params.cgToRear));
    const a = params.cgToFront, b = params.cgToRear; // already sum to wheelbase
    const Izz = inferIzz(params.mass, car.inertiaLength || Lpx, car.inertiaWidth || Wpx, params.yawInertiaScale);
    car.physics = {
      vx: 0, vy: 0, r: 0, // world-frame velocity and yaw rate
      vxb: 0, vyb: 0,     // body-frame velocity (cached)
      steer: 0,           // actual steer angle applied (rad)
      steeringState: { filteredSpeed: 0 },
      steeringMode:
        car && car.steeringMode === 'touch'
          ? 'touch'
          : car && car.steeringMode === 'analogue'
            ? 'analogue'
            : 'manual',
      params,
      a, b,
      Izz,
      dir: 1,           // +1 forward, -1 backward (persistent direction)
      skid: 0,            // last computed skid intensity 0..1
      wheelspin: 0,       // smoothed powered tire slip, shared with drivetrain
      rearWheelspin: 0,   // driven rear axle only, for lateral grip response
      planckBody: null
    };
    car.physicsVariant = setup.variant
      ? {
          variantId: setup.variant.variantId,
          variantLabel: setup.variant.variantLabel,
          name: setup.variant.name
        }
      : null;
    recordColliderHull(car, Wpx, Lpx);
    if (!car.gearbox || engineReferenceChanged) {
      car.gearbox = new Gearbox(getVehicleGearboxConfig(base));
    } else {
      applyVehicleGearboxDefaults(car.gearbox, base);
    }
    return car.physics;
  }

  function tireLateralForce(
    muLat,
    Fz,
    Calpha,
    slipAngle,
    peakSlip = 0.14,
    slidingGrip = 1,
  ) {
    // Linear force builds to the peak, then loose/slippery surfaces fall toward
    // their lower sliding-friction limit as slip angle increases.
    const Fy_lin = -Calpha * slipAngle; // negative: resists slip
    const Fy_max = muLat * Fz;
    const absSlip = Math.abs(slipAngle);
    const safePeakSlip = Math.max(0.01, Number(peakSlip) || 0.14);
    const slideRatio = clamp(Number(slidingGrip) || 0, 0.05, 1);
    if (absSlip <= safePeakSlip || slideRatio >= 0.999) {
      return clamp(Fy_lin, -Fy_max, Fy_max);
    }
    const transitionRange = Math.max(0.01, 0.7 - safePeakSlip);
    const rawBlend = clamp((absSlip - safePeakSlip) / transitionRange, 0, 1);
    const blend = rawBlend * rawBlend * (3 - 2 * rawBlend);
    const slidingLimit = Fy_max * lerp(1, slideRatio, blend);
    return clamp(Fy_lin, -slidingLimit, slidingLimit);
  }

  // Requested tire force is linear below the traction limit. Beyond that peak,
  // loose surfaces fall toward their sliding-friction limit instead of remaining
  // pinned to peak grip during wheelspin or a locked-wheel skid.
  function slipRatioResponse(requestRatio, slidingGrip = 1) {
    if (!Number.isFinite(requestRatio)) return 0;
    const magnitude = Math.abs(requestRatio);
    if (magnitude <= 1) return requestRatio;
    const rawBlend = clamp((magnitude - 1) / 1.5, 0, 1);
    const blend = rawBlend * rawBlend * (3 - 2 * rawBlend);
    const slidingRatio = clamp(Number(slidingGrip) || 0, 0.05, 1);
    return sign(requestRatio) * lerp(1, slidingRatio, blend);
  }

  function axleRollGrip(load, transfer, exponent) {
    const split = clamp(2 * transfer / Math.max(1, load), 0, 1);
    return ((1 + split) ** exponent + (1 - split) ** exponent) / 2;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function getVehiclePowerMult(base) {
    const basePowerMult = base && base.enginePowerMult != null ? base.enginePowerMult : 1;
    const accelDurMult = base && base.accelDurationMult != null ? base.accelDurationMult : 1.0;
    const accelDurMultSq = accelDurMult * accelDurMult;
    return basePowerMult / Math.max(0.0001, accelDurMultSq);
  }

  function getVehicleGearRatios(base, currentConfig) {
    const cfg = currentConfig || gearboxDefaults;
    const explicit = base && Array.isArray(base.gearRatios)
      ? base.gearRatios
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && Math.abs(value) > 0.0001)
      : null;
    if (explicit && explicit.length) return explicit;

    const gearCount = Math.round(clamp(base && base.gearCount != null ? base.gearCount : 6, 3, 10));
    const defaultRatios = Array.isArray(gearboxDefaults.ratios) ? gearboxDefaults.ratios : [];
    const hasVehicleTarget =
      base &&
      (Number.isFinite(base.gearTopSpeedMph) ||
        Number.isFinite(base.gearTopSpeedMps) ||
        Number.isFinite(base.gearFirstRatio) ||
        Number.isFinite(base.gearSpacing));
    if (!hasVehicleTarget && gearCount === defaultRatios.length) {
      return defaultRatios.slice();
    }

    const redlineRpm = Number(cfg.redlineRPM ?? cfg.redlineRpm ?? GEARBOX_CONFIG.redlineRpm);
    const finalDrive = Number(cfg.finalDrive ?? GEARBOX_CONFIG.finalDrive);
    const tireRadiusM = Number(cfg.tireRadiusM ?? cfg.wheelRadius ?? GEARBOX_CONFIG.tireRadiusM);
    let targetTopSpeedMps = Number(base && base.gearTopSpeedMps);
    if (!Number.isFinite(targetTopSpeedMps) || targetTopSpeedMps <= 0) {
      const topMph = Number(base && base.gearTopSpeedMph);
      targetTopSpeedMps = Number.isFinite(topMph) && topMph > 0 ? topMph / 2.23694 : 54;
    }

    return suggestGearRatios({
      redlineRpm,
      finalDrive,
      tireRadiusM,
      targetTopSpeedMps,
      gears: gearCount,
      spacing: Number(base && base.gearSpacing) || 1.28,
      firstGearRatio: Number(base && base.gearFirstRatio),
    });
  }

  function vehicleHasGearTarget(base) {
    return !!(
      base &&
      (Array.isArray(base.gearRatios) ||
        Number.isFinite(base.gearTopSpeedMph) ||
        Number.isFinite(base.gearTopSpeedMps) ||
        Number.isFinite(base.gearFirstRatio) ||
        Number.isFinite(base.gearSpacing))
    );
  }

  function gearboxRatiosDiffer(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return true;
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(Number(a[i]) - Number(b[i])) > 0.0001) return true;
    }
    return false;
  }

  function getVehicleGearboxConfig(base) {
    const config = { ...gearboxDefaults };
    applyVehicleEngineConfig(config, base);
    config.ratios = getVehicleGearRatios(base, config);
    config.powerMult = getVehiclePowerMult(base);
    return config;
  }

  function applyVehicleEngineConfig(config, base) {
    // Opt-in engine characteristics; existing vehicles retain shared Dev Tools values.
    const fields = {
      gearShiftCutMs: 'shiftCutMs',
      gearRedlineRpm: 'redlineRPM',
      gearTorquePeakRpm: 'torquePeakRPM',
      gearTorqueIdle: 'torqueIdle',
      gearEngineBrakePeak: 'engineBrakePeak',
    };
    for (const [key, target] of Object.entries(fields)) {
      if (Number.isFinite(base && base[key])) config[target] = base[key];
    }
  }

  function getVehicleGearboxDefaults(kind, variantId) {
    const setup = resolveVehicleSetup(kind || 'GT', variantId);
    const base = setup.defaults;
    const config = getVehicleGearboxConfig(base);
    return {
      ...config,
      ratios: Array.isArray(config.ratios) ? config.ratios.slice() : []
    };
  }

  const driveForceProbeStates = new WeakMap();
  function sampleDriveForces(car, speed, out = {}, planGear = false) {
    const state = car && car.gearbox && car.gearbox.state;
    if (!state) return null;
    let probe = driveForceProbeStates.get(car);
    if (!probe) {
      probe = { state: {}, torqueParams: {} };
      driveForceProbeStates.set(car, probe);
    }
    Object.assign(probe.state, state);
    Object.assign(probe.torqueParams, state.torqueCurveParams);
    probe.state.torqueCurveParams = probe.torqueParams;
    const ppm = car.physics?.params?.pixelsPerMeter || PPM_DEFAULT;
    const speedMps = Math.max(0, speed) / ppm;
    if (planGear) {
      const ratios = probe.state.gearRatios;
      if (!ratios?.length) return null;
      let gear = 0, rpm = 0;
      for (; gear < ratios.length; gear++) {
        rpm = speedMps * ratios[gear] * probe.state.finalDrive /
          probe.state.tireRadiusM * 60 / (2 * Math.PI);
        if (rpm <= probe.state.redlineRpm * probe.state.upshiftFrac ||
            gear === ratios.length - 1) break;
      }
      probe.state.gear = gear + 1;
      probe.state.rpm = Math.max(probe.state.idleRpm, rpm);
      probe.state.cutRemainingMs = 0;
    }
    // getDriveForce writes diagnostic fields; probe an independent state so
    // planning cannot alter the running gearbox or its torque parameters.
    out.coast = getDriveForce(probe.state, speedMps, 0);
    out.drive = getDriveForce(probe.state, speedMps, 1);
    out.resistance = Number(car.physics?.lastLongitudinalResistance) || 0;
    return out;
  }

  function applyVehicleGearboxDefaults(gearbox, base, options = {}) {
    if (!gearbox || !gearbox.c || !base) return;
    applyVehicleEngineConfig(gearbox.c, base);
    gearbox.c.powerMult = getVehiclePowerMult(base);
    const expectedRatios = getVehicleGearRatios(base, gearbox.c);
    const currentRatios = gearbox.c.ratios || (gearbox.state && gearbox.state.gearRatios);
    const currentGearCount = Array.isArray(currentRatios) ? currentRatios.length : 0;
    const preserveTunedRatios = !!gearbox._rvPreserveTunedRatios && currentGearCount === Math.round(base.gearCount || 0);
    const shouldUpdateRatios =
      options.forceRatios ||
      Math.round(base.gearCount || 0) !== currentGearCount ||
      (!preserveTunedRatios && vehicleHasGearTarget(base) && gearboxRatiosDiffer(currentRatios, expectedRatios));
    if (shouldUpdateRatios) {
      gearbox.c.ratios = expectedRatios.slice();
    }
    if (typeof gearbox.refreshFromConfig === 'function') {
      gearbox.refreshFromConfig();
    } else if (gearbox.state) {
      gearbox.state.gearRatios = (gearbox.c.ratios || []).slice();
      gearbox.state.maxGear = gearbox.state.gearRatios.length;
      gearbox.state.powerMult = gearbox.c.powerMult;
    }
  }

  function updateCar(car, input, surface, dt, resultBuffer = null) {
    // input: {throttle:0..1, brake:0..1, steer:-1..1}
    // surface: {onRoad:boolean, surfaceType:string, weatherId:string}
    if (!car.physics) initCar(car, car.kind);
    const P = car.physics.params;
    if (car.gearbox) {
      if (input && input.shiftUp) car.gearbox.shiftUp();
      if (input && input.shiftDown) car.gearbox.shiftDown();
      if (input && typeof input.manual === 'boolean') car.gearbox.setManual(input.manual);
      if (typeof car.gearbox.refreshFromConfig === 'function') {
        const refreshInterval = 0.25;
        car.physics._gearboxConfigRefreshElapsed =
          (Number(car.physics._gearboxConfigRefreshElapsed) || refreshInterval) +
          Math.max(0, Number(dt) || 0);
        if (car.physics._gearboxConfigRefreshElapsed >= refreshInterval) {
          car.gearbox.refreshFromConfig();
          car.physics._gearboxConfigRefreshElapsed %= refreshInterval;
        }
      }
    }
    let usePlanck = !!(P && P.usePlanck);
    let ppm = P.pixelsPerMeter || planckState.ppm || PPM_DEFAULT;
    let planckBody = null;
    const mass = P.mass;
    if (usePlanck) {
      planckBody = ensurePlanckBody(car, P);
      if (!planckBody) {
        usePlanck = false;
      } else {
        ppm = planckState.ppm || ppm;
        const vel = planckBody.getLinearVelocity();
        const angle = planckBody.getAngle();
        const omega = planckBody.getAngularVelocity();
        car.physics.vx = pixels(vel.x, ppm);
        car.physics.vy = pixels(vel.y, ppm);
        car.physics.r = omega;
        car.vx = car.physics.vx;
        car.vy = car.physics.vy;
        car.angle = angle;
        car.physics.planckBody = planckBody;
      }
    } else if (car.physics.planckBody) {
      removePlanckBody(car);
    }
    const inertiaLength = car.colliderLength || car.length || 36;
    const inertiaWidth = car.colliderWidth || car.width || 18;
    const Izz = car.physics.Izz || inferIzz(P.mass, inertiaLength, inertiaWidth, P.yawInertiaScale);
    const a = car.physics.a, b = car.physics.b, L = a + b;
    const onRoad = surface && surface.onRoad !== false;
    const trackSurfaceId = getSurfaceIdFromState(surface);
    const weatherId = getWeatherIdFromState(surface);
    const trackSurface = getTrackSurfaceProfileFromState(surface);
    const surfaceRotationSetup = getSurfaceRotationSetup(P, trackSurface);
    const currentSurfaceId = trackSurface.trackSurfaceId || trackSurface.id;
    const pavedWheelspin = onRoad &&
      (currentSurfaceId === 'tarmac-pro' || currentSurfaceId === 'concrete-oval');
    const muLat = onRoad
      ? P.muLatRoad *
        trackSurface.lateralGripScale *
        surfaceRotationSetup.capabilityLateralGripScale
      : P.muLatGrass;
    const muLong = onRoad
      ? P.muLongRoad * trackSurface.longitudinalGripScale
      : P.muLongGrass;
    const accelDurMult = (P.accelDurationMult != null) ? P.accelDurationMult : 1.0;
    const accelDurMultSq = accelDurMult * accelDurMult;
    const dragK = (P.dragK / accelDurMultSq) * (onRoad ? 1 : 0.7); // slightly less aero on grass due to lower speeds
    const rollK = P.rollK * (onRoad ? trackSurface.rollingResistanceScale : 1.6);
    const surfaceDragK = onRoad ? trackSurface.surfaceDragK : 0.0015;

    // Body-frame velocity
    const vectorScratch =
      car.physics._vectorScratch ||
      (car.physics._vectorScratch = { body: { x: 0, y: 0 }, world: { x: 0, y: 0 } });
    const vb = worldToBody(car.physics.vx, car.physics.vy, car.angle, vectorScratch.body);
    let vx = vb.x, vy = vb.y;
    const vxBody = vx;
    const gb = car.gearbox instanceof Gearbox ? car.gearbox : null;
    const VX_HYST = REVERSE_CFG.vxHyst;
    let dir = (car.physics.dir == null ? 1 : car.physics.dir);
    if (vxBody > VX_HYST) dir = 1;
    else if (vxBody < -VX_HYST) dir = -1;
    car.physics.dir = dir;
    const fwd = dir;
    const vxAbs = Math.max(12, Math.abs(vxBody));
    const vxSigned = vxAbs * fwd;
    let reversing = (gb && gb.gearIndex === -1) || (fwd < 0);
    let yawDamp = (P.yawDampK != null ? P.yawDampK : 0.12);
    if (onRoad) yawDamp *= trackSurface.yawDampingScale;
    if (reversing) yawDamp *= REVERSE_CFG.yawMul;

    // Steering mode and filtered speed for adaptive touch steering
    const steeringMode =
      car && car.steeringMode === 'touch'
        ? 'touch'
        : car && car.steeringMode === 'analogue'
          ? 'analogue'
          : 'manual';
    const usesTouchSteerLimit = steeringMode === 'touch' || steeringMode === 'analogue';
    car.physics.steeringMode = steeringMode;
    const steeringState = car.physics.steeringState || (car.physics.steeringState = { filteredSpeed: 0 });
    const speedWorld = Math.hypot(car.physics.vx, car.physics.vy);
    if (steeringState.filteredSpeed == null || !Number.isFinite(steeringState.filteredSpeed)) {
      steeringState.filteredSpeed = speedWorld;
    }
    if (usesTouchSteerLimit) {
      const cfg = P.touchSteer || {};
      const tau = Math.max(0.05, cfg.filterTau || 0.12);
      const alpha = clamp(1 - Math.exp(-dt / tau), 0, 1);
      steeringState.filteredSpeed += (speedWorld - steeringState.filteredSpeed) * alpha;
    } else {
      steeringState.filteredSpeed = speedWorld;
    }

    // Steer target and rate limit
    const steerNormTarget = clamp(((input && input.steer) || 0), -1, 1);
    const requestedThrottle = clamp(+((input && input.throttle) || 0), 0, 1);
    const slipperySurfaceFactor = onRoad
      ? surfaceRotationSetup.slipperySurfaceFactor
      : 0;
    const signedBodySlip = Math.atan2(vy, Math.max(12, Math.abs(vx)));
    const bodySlipAngle = Math.abs(signedBodySlip);
    // Use yaw magnitude as well as direction: assistance must fade through
    // zero yaw instead of switching between two force/steering regimes.
    const yawCountersteerIntent = clamp(
      (-steerNormTarget * Math.tanh((car.physics.r || 0) / 0.25) - 0.05) / 0.95,
      0, 1,
    );
    // A sliding car can stop yawing before its heading and travel realign.
    // Retain the tire recovery path while the driver steers toward that travel.
    const slipCountersteerIntent = !reversing && vx > 12
      ? clamp((steerNormTarget * sign(signedBodySlip) - 0.05) / 0.95, 0, 1) *
        clamp((bodySlipAngle - 0.06) / 0.18, 0, 1)
      : 0;
    const countersteerIntent = Math.max(yawCountersteerIntent, slipCountersteerIntent);
    const rotationSeverity = Math.max(
      clamp((Math.abs(car.physics.r || 0) - 0.06) / 0.9, 0, 1),
      clamp((bodySlipAngle - 0.04) / 0.32, 0, 1),
    );
    const runawayYawSeverity = clamp(
      (Math.abs(car.physics.r || 0) - 0.35) / 0.75,
      0,
      1,
    );
    const countersteerRecoveryScale = surfaceRotationSetup.countersteerRecoveryScale;
    const countersteerCommandStrength = clamp(
      slipperySurfaceFactor * countersteerRecoveryScale * countersteerIntent,
      0,
      1.5,
    );
    const countersteerAssist = clamp(
      countersteerCommandStrength * (0.35 + 0.65 * rotationSeverity),
      0,
      1.5,
    );
    const targetPowerRotationControl = clamp(
      slipperySurfaceFactor *
        surfaceRotationSetup.rotationEnvelopeScale *
        clamp((requestedThrottle - 0.15) / 0.75, 0, 1) *
        runawayYawSeverity,
      0,
      1.5,
    );
    const previousPowerRotationControl = Number.isFinite(
      car.physics.lastPowerRotationControl,
    )
      ? car.physics.lastPowerRotationControl
      : 0;
    const rotationControlTau = targetPowerRotationControl > previousPowerRotationControl
      ? 0.05
      : 0.20;
    const rotationControlAlpha = clamp(
      1 - Math.exp(-clamp(dt, 1 / 400, 0.25) / rotationControlTau),
      0,
      1,
    );
    const powerRotationControl =
      previousPowerRotationControl +
      (targetPowerRotationControl - previousPowerRotationControl) * rotationControlAlpha;
    car.physics.steeringDt = dt;
    let steerMax = P.maxSteer;
    let steerRate = P.steerSpeed;
    let returnGain = 0;
    if (usesTouchSteerLimit) {
      const cfg = P.touchSteer || {};
      const low = cfg.maxSteerLowSpeed != null ? cfg.maxSteerLowSpeed : P.maxSteer;
      const high = cfg.maxSteerHighSpeed != null ? cfg.maxSteerHighSpeed : (P.maxSteer * 0.6);
      const falloff = Math.max(1, cfg.falloffSpeed || 240);
      const filtered = steeringState.filteredSpeed;
      const blend = Math.exp(-filtered / falloff);
      steerMax = high + (low - high) * blend;
      if (steeringMode === 'touch') {
        const baseRate = cfg.baseSteerRate != null ? cfg.baseSteerRate : P.steerSpeed;
        const falloffScale = cfg.steerRateFalloff != null ? cfg.steerRateFalloff : 0;
        steerRate = baseRate / (1 + filtered * falloffScale);
        if (!Number.isFinite(steerRate) || steerRate <= 0) steerRate = baseRate;
        returnGain = Math.max(0, cfg.returnGain || 0);
      }
    }
    if (onRoad) {
      // Loose-surface tyres use a little less steering lock so large inputs build
      // a controllable drift instead of immediately saturating the front axle.
      steerMax *= trackSurface.steeringScale;
    }
    const catchSteeringFactor = P.touchSteer?.countersteerRate > 0 ? 1 : slipperySurfaceFactor;
    if (usesTouchSteerLimit && catchSteeringFactor > 0) {
      // High-speed turn-in limits must not prevent the wheels from pointing
      // into an existing slide. Restore low-speed lock progressively for a catch.
      const lowSpeedLock = (P.touchSteer?.maxSteerLowSpeed ?? P.maxSteer) *
        trackSurface.steeringScale;
      // Digital buttons need some of that authority to initiate a slide too.
      const turnInAuthority = !reversing && steeringMode === 'touch'
        ? slipperySurfaceFactor * 0.12 * Math.abs(steerNormTarget) *
          (1 - countersteerIntent)
        : 0;
      steerMax = lerp(steerMax, Math.max(steerMax, lowSpeedLock), turnInAuthority);
      steerMax = lerp(steerMax, Math.max(steerMax, lowSpeedLock),
        catchSteeringFactor * clamp((bodySlipAngle - 0.06) / 0.24, 0, 1) *
          (1 - Math.exp(-countersteerIntent * 5)));
    }
    if (countersteerAssist > 0) {
      // A long-wheelbase, low-yaw-damping, or high-power vehicle needs more
      // response to reverse steering lock during a loose-surface rotation.
      // This exists only while the driver is actively catching yaw or body slip.
      steerRate *= 1 + 1.5 * countersteerCommandStrength;
    }
    // Digital opposite lock must cross centre before a short button pulse ends.
    // Opted-in racks retain their normal turn-in rate; only a genuine catch
    // restores this rate, progressively with slip, on paved and loose roads.
    if (usesTouchSteerLimit && P.touchSteer?.countersteerRate > 0) {
      const catchRateBlend = countersteerIntent * clamp(bodySlipAngle / 0.25, 0, 1);
      steerRate = lerp(steerRate, Math.max(steerRate, P.touchSteer.countersteerRate), catchRateBlend);
    }
    steerRate = Math.max(1e-3, steerRate);
    const steerTarget = steerNormTarget * steerMax;
    // A compliant steering rack builds lock continuously. Never clip the
    // driver's target to a slip/yaw-dependent angle: that creates detents and
    // makes stronger opposite lock produce the same response as a small input.
    const looseRackResponse = lerp(1, 1 - Math.exp(-dt / 0.10),
      slipperySurfaceFactor * clamp(bodySlipAngle / 0.20, 0, 1));
    const steerResponseTime = steeringMode === 'touch'
      ? (P.touchSteer?.responseTime ?? P.steerResponseTime ?? 0)
      : (P.steerResponseTime || 0);
    const rackTime = lerp(steerResponseTime,
      P.countersteerResponseTime || steerResponseTime, countersteerIntent);
    const rackResponse = rackTime > 0
      ? Math.min(looseRackResponse, 1 - Math.exp(-dt / rackTime))
      : looseRackResponse;
    const steerStep = clamp((steerTarget - car.physics.steer) * rackResponse,
      -steerRate * dt, steerRate * dt);
    car.physics.steer += steerStep;
    if (returnGain > 0) {
      // Touch self-centering otherwise fights a held button, especially once
      // the compliant drift rack engages. Let the driver hold useful loose-road
      // lock; releasing the button still receives the full centering response.
      const activeLock = slipperySurfaceFactor * Math.abs(steerNormTarget) *
        (reversing ? 0 : 0.65);
      const alignStep = clamp(-car.physics.steer * returnGain * (1 - activeLock) * dt *
        (steerResponseTime > 0 ? rackResponse : 1), -steerRate * dt, steerRate * dt);
      car.physics.steer += alignStep;
    }
    if (usesTouchSteerLimit) {
      const physicalLock = catchSteeringFactor > 0 ? Math.max(steerMax,
        (P.touchSteer?.maxSteerLowSpeed ?? P.maxSteer) * trackSurface.steeringScale) : steerMax;
      car.physics.steer = clamp(car.physics.steer, -physicalLock, physicalLock);
    }
    let steerEff = car.physics.steer;
    if (reversing) steerEff *= REVERSE_CFG.steerScale;
    const delta = steerEff;
    const deltaEff = delta; // body-frame wheel angle; reverse handled in slipF
    car.physics.visualSteerTarget = deltaEff;
    car.physics.visualSteerLimit = Math.max(1e-3, Math.max(steerMax || 0, Math.abs(car.physics.steer)) * (reversing ? REVERSE_CFG.steerScale : 1));
    const visualTarget = deltaEff;
    const prevVisual = (car.steerVis == null || !Number.isFinite(car.steerVis)) ? visualTarget : car.steerVis;
    const blend = Math.min(1, dt * 12);
    const blendedVisual = prevVisual + (visualTarget - prevVisual) * blend;
    const visLimit = car.physics.visualSteerLimit;
    car.steerVis = clamp(blendedVisual, -visLimit, visLimit);
    car.physics.lastCountersteerAssist = countersteerAssist;
    car.physics.lastCountersteerCommandStrength = countersteerCommandStrength;
    car.physics.lastCountersteerIntent = countersteerIntent;
    car.physics.lastCountersteerRecoveryScale = countersteerRecoveryScale;
    car.physics.lastSurfaceSlipperyFactor = slipperySurfaceFactor;
    car.physics.lastPowerRotationControl = powerRotationControl;

    // Normal loads per axle (static baseline)
    const staticLoadTotal = mass * g;
    const staticFzf = staticLoadTotal * (b / L);
    const staticFzr = staticLoadTotal * (a / L);
    let Fzf = staticFzf, Fzr = staticFzr;

    // Speed-based downforce split by static distribution
    {
      const vDF = Math.hypot(car.physics.vx, car.physics.vy);
      const DF = (P.downforceK != null ? P.downforceK : 0) * vDF * vDF;
      const frontShare = b / (a + b);
      const rearShare = a / (a + b);
      Fzf += DF * frontShare;
      Fzr += DF * rearShare;
    }

    // Cornering stiffness proportional to available grip (linear range roughly at ~8 deg)
    const slip0 = (onRoad ? trackSurface.lateralPeakSlip : 0.14) *
      (P.lateralPeakSlipScale || 1);
    const lateralSlidingGrip = onRoad ? trackSurface.lateralSlidingGrip : 1;
    // Define reference loads for load sensitivity
    const Fzf_ref = staticFzf, Fzr_ref = staticFzr;
    const loadSenseK = (P.loadSenseK != null ? P.loadSenseK : 0.08);
    let muLatF = muLat * (1 - loadSenseK * (Fzf / Math.max(1e-6, Fzf_ref) - 1));
    let muLatR = muLat * (1 - loadSenseK * (Fzr / Math.max(1e-6, Fzr_ref) - 1));
    let Cf = muLatF * Fzf / slip0;
    let Cr = muLatR * Fzr / slip0;

    // Avoid singularity at very low speed
    const eps = 0.001;
    const vyFront = vy + a * car.physics.r;
    const vyRear = vy - b * car.physics.r;
    // IMPORTANT: Reverse is handled by fwd*delta in slipF. Do NOT also flip vy or multiply delta again elsewhere.
    let slipF = Math.atan2(vyFront, vxAbs) - fwd * delta;
    let slipR = Math.atan2(vyRear, vxAbs);
    const slipLimit = 0.7; // cap extreme slip angles to avoid runaway forces at very low speed
    slipF = clamp(slipF, -slipLimit, slipLimit);
    slipR = clamp(slipR, -slipLimit, slipLimit);
    const devReverseCheckEnabled = ((typeof window !== 'undefined' && window.__DEV__) || (typeof DEBUG !== 'undefined' && DEBUG));
    if (devReverseCheckEnabled) {
      if (Math.abs(vxBody) < 1 && Math.abs(delta) > 0.02) {
        const expected = Math.sign(-fwd * delta) || 0;
        const got = Math.sign(slipF) || 0;
        if (expected && got && expected !== got) {
          console.warn('[ReverseCheck] Slip sign mismatch near vx≈0', { vxBody, fwd, delta, slipF });
        }
      }

    }

    // Lateral forces will be computed after load transfer adjustments
    let FyF = 0;
    let FyR_unc = 0;

    // Longitudinal forces (drive on rear axle), limited by traction; analog inputs 0..1
    let throttle = clamp(+((input && input.throttle) || 0), 0, 1);
    let brake = clamp(+((input && input.brake) || 0), 0, 1);
    if (P.throttleRiseTime > 0) {
      // Engine pickup is progressive; lift, engine braking and the gearbox's
      // torque cuts still act immediately. Holding the pedal through an upshift
      // does not restart this throttle response.
      // Countdown pre-rev already holds an open throttle in the gearbox.
      const previousThrottle = car.physics.driveThrottle ?? gb?.state?.throttle ?? 0;
      if (throttle > previousThrottle) {
        // Hooked-up pickup is sharp; a developed slide retains a progressive
        // force build so the extra response cannot yank the heading straight.
        const slidePickup = clamp((bodySlipAngle - 0.04) / 0.14, 0, 1);
        const pickupBlend = slidePickup * slidePickup * (3 - 2 * slidePickup);
        const pickupTime = lerp(P.throttleRiseTime,
          P.throttleSlideRiseTime || P.throttleRiseTime, pickupBlend);
        throttle = lerp(previousThrottle, throttle,
          1 - Math.exp(-dt / pickupTime));
      }
      car.physics.driveThrottle = throttle;
    }
    if (car.physics.prevDriveSlip == null) car.physics.prevDriveSlip = 0;
    const throttlePressedGlobal = throttle > 0.05;
    const brakePressedGlobal = brake > 0.05;
    const vForward = vx / Math.max(1e-3, ppm); // m/s forward velocity (body X projected)
    if (gb) {
      if (gb.state) gb.state.vForwardMps = vForward;
      if (car.physics.exitReverseHold == null) car.physics.exitReverseHold = false;
      let exitReverseHold = !!car.physics.exitReverseHold;
      const forwardSpeedBody = vx;
      const reverseEntrySpeed = (P.reverseEntrySpeed != null ? P.reverseEntrySpeed : 40);
      const reverseDeadband = Math.max(6, VX_HYST * 0.5);
      const reverseShiftReady = Math.max(4, reverseDeadband * 0.6);
      const reverseBrakeRamp = Math.max(30, reverseEntrySpeed);
      const rollingBackwardForInput = forwardSpeedBody < -reverseShiftReady;
      const brakeReverseIntent = rollingBackwardForInput && brakePressedGlobal && !throttlePressedGlobal;
      if (brakeReverseIntent) {
        if (gb.gearIndex > -1) {
          if (gb.gearIndex > 0) gb.shiftDown();
          if (gb.gearIndex > -1) gb.shiftDown();
        }
        throttle = (gb.gearIndex === -1) ? Math.max(throttle, brake) : 0;
        brake = 0;
        exitReverseHold = false;
      }
      if (throttlePressedGlobal && (forwardSpeedBody < -reverseShiftReady || exitReverseHold)) {
        exitReverseHold = true;
      } else if (!throttlePressedGlobal) {
        exitReverseHold = false;
      }

      if (exitReverseHold) {
        const backwardSpeed = Math.max(0, -forwardSpeedBody);
        const brakeRamp = backwardSpeed > 0
          ? Math.min(1, backwardSpeed / reverseBrakeRamp)
          : 0.35;
        const requestedBrake = Math.max(throttle, brakeRamp);
        brake = Math.max(brake, requestedBrake);
        throttle = 0;

        if (backwardSpeed <= reverseShiftReady) {
          if (gb.gearIndex < 1) {
            const before = gb.gearIndex;
            gb.shiftUp();
            if (gb.gearIndex === before && gb.state) {
              gb.state.manualShiftUp = true;
            }
          } else {
            exitReverseHold = false;
          }
        }
      }
      car.physics.exitReverseHold = exitReverseHold;

      if (gb.c.auto) {
        const throttlePressed = throttlePressedGlobal;
        const brakePressed = brakePressedGlobal;
        const speedMag = Math.hypot(car.physics.vx, car.physics.vy);
        const forwardSpeed = vx;

        if (brakePressed && !throttlePressed) {
          if (gb.gearIndex > -1 && (rollingBackwardForInput || (Math.abs(forwardSpeed) < 35 && speedMag < 45))) {
            if (gb.gearIndex > 0) gb.shiftDown();
            if (gb.gearIndex > -1) gb.shiftDown();
          }
        } else if (throttlePressed) {
          if (gb.gearIndex <= 0 && Math.abs(forwardSpeed) < 35 && speedMag < 45) {
            if (gb.gearIndex < 1) {
              const before = gb.gearIndex;
              gb.shiftUp();
              if (gb.gearIndex === before && gb.state) {
                gb.state.manualShiftUp = true;
              }
            }
          }
        }

        if (gb.gearIndex === 1 && throttlePressed && forwardSpeed < -12) {
          brake = Math.max(brake, Math.min(1, Math.abs(forwardSpeed) / 60));
          throttle = 0;
        }
        if (gb.gearIndex === -1 && throttlePressed && forwardSpeed > 12) {
          brake = Math.max(brake, Math.min(1, forwardSpeed / 60));
          throttle = 0;
        }

        if (gb.gearIndex === -1) {
          if (brakePressed && !throttlePressed) {
            throttle = Math.max(throttle, brake);
            brake = 0;
          }
        } else if (gb.gearIndex >= 1) {
          if (throttlePressed && forwardSpeed < -12) {
            const ramp = Math.min(1, Math.abs(forwardSpeed) / 60);
            brake = Math.max(brake, ramp);
            throttle = 0;
          }
        }

      }

      // --- universal anti-reverse assist (runs for auto & manual) ---
      const throttlePressed = throttle > 0.05;
      const forwardSpeed = vxBody;
      if (gb.gearIndex >= 1 && throttlePressed && fwd < 0 && forwardSpeed < -12) {
        const ramp = Math.min(1, Math.abs(forwardSpeed) / 60);
        brake = Math.max(brake, ramp);
        throttle = 0;
      }
      if (gb.gearIndex === -1 && throttlePressed && fwd > 0 && forwardSpeed > 12) {
        const ramp = Math.min(1, forwardSpeed / 60);
        brake = Math.max(brake, ramp);
        throttle = 0;
      }
      // --------------------------------------------------------------
    }
    const gbState = gb ? gb.state : null;
    let Fx_drive = 0;
    if (gbState && gb) {
      const speedForGearbox = Math.max(0, Math.abs(vForward));
      const gbInputs =
        car.physics._gearboxInputScratch ||
        (car.physics._gearboxInputScratch = {
          throttle: 0,
          brake: 0,
          wheelspin: 0,
          speedMps: 0,
          vForwardMps: 0,
          auto: true,
          upshiftFrac: undefined,
          shiftUp: false,
          shiftDown: false
        });
      gbInputs.throttle = throttle;
      gbInputs.brake = brake;
      // Feed tire saturation back into the drivetrain, not just the sound/HUD.
      gbInputs.wheelspin = !reversing && throttle > 0.05 &&
        (pavedWheelspin ? gbState.gear === 1 : slipperySurfaceFactor > 0)
        ? (car.physics.wheelspin || 0) : 0;
      gbInputs.speedMps = speedForGearbox;
      gbInputs.vForwardMps = vForward;
      gbInputs.auto = gb.c.auto !== false;
      const gearUpshiftFracs = P && P.gearUpshiftFracs;
      const gearUpshiftFrac =
        gearUpshiftFracs && Number.isFinite(Number(gearUpshiftFracs[gbState.gear]))
          ? Number(gearUpshiftFracs[gbState.gear])
          : null;
      gbInputs.upshiftFrac = gearUpshiftFrac == null ? undefined : gearUpshiftFrac;
      gbInputs.shiftUp = !!gbState.manualShiftUp;
      gbInputs.shiftDown = !!gbState.manualShiftDown;
      updateGearbox(gbState, dt, gbInputs);
      if (typeof gb.applyState === 'function') {
        gb.applyState();
      }
      Fx_drive = getDriveForce(gbState, speedForGearbox, throttle);
      if (P.gearEngineBrakePeak > 0 && gbState.lastEngineTorque < 0) {
        // The coupled engine resists rolling in gear; its idle control/clutch
        // releases near a stop. Closed throttle must never propel a parked car
        // or push it further in the wrong direction for the selected gear.
        // Gear ratio still sets the coast torque at racing speed, in reverse too.
        const coupledSpeed = vxBody * Math.sign(gbState.currentRatio);
        Fx_drive *= clamp((coupledSpeed - 4) / 80, 0, 1);
      }
      gb.lastRequestedForce = Fx_drive;
      const wheelRadius = gbState.tireRadiusM ?? gbState.wheelRadius ?? GEARBOX_CONFIG.tireRadiusM;
      const lastGb = car.physics.lastGb || (car.physics.lastGb = {});
      lastGb.gear = gb.gear;
      lastGb.gearIndex = gbState.gear;
      lastGb.rpm = gb.rpm;
      lastGb.smoothedRpm = gbState.smoothedRpm ?? gb.rpm;
      lastGb.requestedForce = Fx_drive;
      lastGb.requestedForceRaw = gbState.lastDriveForce ?? Fx_drive;
      lastGb.cutRemainingMs = gbState.cutRemainingMs ?? 0;
      lastGb.ratio = gbState.currentRatio ?? 0;
      lastGb.totalRatio = gbState.totalRatio ?? 0;
      lastGb.engineTorque = gbState.lastEngineTorque ?? 0;
      lastGb.wheelTorque = gbState.lastWheelTorque ?? Fx_drive * wheelRadius;
      lastGb.isReverse = gbState.isReverse;
      lastGb.isNeutral = gbState.isNeutral;
      reversing = reversing || !!gbState.isReverse;
    } else {
      car.physics.lastGb = null;
      Fx_drive = 0;
    }
    const surfaceBrakeForce = P.brakeForce * (onRoad ? trackSurface.brakeForceScale : 1);
    const brakeForceCmd = brake * surfaceBrakeForce;
    let Fx_brake = 0;
    if (brakeForceCmd > 0) {
      const velSign = (Math.abs(vxBody) > 2)
        ? fwd
        : ((Math.abs(vxBody) > 0.25) ? fwd : clamp(-vx / 0.25, -1, 1));
      Fx_brake = brakeForceCmd * velSign;
    }
    // Body X resistances (drag/roll) oppose motion
    const vmag = Math.max(eps, Math.hypot(vx, vy));
    const ux_bx = vx / vmag; // projection of velocity direction on body X
    const F_drag = dragK * vmag * vmag * ux_bx;
    const F_roll = rollK * vmag * ux_bx;
    // Deformable/loose surfaces dissipate extra energy. Grass keeps the stronger
    // legacy penalty that discourages corner cutting.
    const F_surfaceDrag = surfaceDragK * vmag * vmag * ux_bx;

    // Legacy setups estimate transfer from commands; combined-grip setups use solved forces.
    const Fx_cmd = Fx_drive - Fx_brake;
    const requestedAx = (Fx_cmd - F_drag - F_roll -
      (Number.isFinite(P.rollStiffnessRearShare) ? F_surfaceDrag : 0)) / mass;
    // Tire-limited acceleration, not requested engine torque, transfers weight.
    // Use the previous solved force to avoid a circular load/grip dependency.
    const ax_cmd = P.combinedAxleGrip ? (car.physics.lastAx || 0) : requestedAx;
    const prevAx = Number.isFinite(car.physics.axLongFiltered) ? car.physics.axLongFiltered : 0;
    const dtClamp = clamp(dt, 1 / 400, 0.25);
    const tauAx = 0.10;
    const alphaAx = clamp(1 - Math.exp(-dtClamp / tauAx), 0, 1);
    const ax_est = prevAx + (ax_cmd - prevAx) * alphaAx;
    car.physics.axLongFiltered = ax_est;
    car.physics.axLongRaw = ax_cmd;

    // Longitudinal load transfer update. On loose surfaces, unstable vehicle
    // setups progressively gain rear load while accelerating into a slide. This
    // keeps the initial rotation available, then gives the rear axle enough
    // lateral authority for opposite lock to catch it before the yaw runs away.
    const accelerationLoadBlend = clamp(ax_est / 120, 0, 1);
    const steeringRotationDemand = clamp(
      (Math.abs(steerNormTarget) - 0.20) / 0.80,
      0,
      1,
    );
    const rotationLoadBlend = clamp(
      rotationSeverity * 1.25 +
        steeringRotationDemand * 0.20 +
        countersteerIntent * 0.35,
      0,
      1,
    );
    const targetSurfaceCgHeightBoost =
      surfaceRotationSetup.maximumCgHeightBoost *
      slipperySurfaceFactor *
      accelerationLoadBlend *
      rotationLoadBlend;
    const previousSurfaceCgHeightBoost = Number.isFinite(
      car.physics.lastSurfaceCgHeightBoost,
    )
      ? car.physics.lastSurfaceCgHeightBoost
      : 0;
    const cgBoostTau = targetSurfaceCgHeightBoost > previousSurfaceCgHeightBoost
      ? 0.05
      : 0.20;
    const cgBoostAlpha = clamp(1 - Math.exp(-dtClamp / cgBoostTau), 0, 1);
    const surfaceCgHeightBoost =
      previousSurfaceCgHeightBoost +
      (targetSurfaceCgHeightBoost - previousSurfaceCgHeightBoost) * cgBoostAlpha;
    const cgH = surfaceRotationSetup.baseCgHeight + surfaceCgHeightBoost;
    car.physics.lastSurfaceCgHeightBoost = surfaceCgHeightBoost;
    car.physics.lastEffectiveCgHeight = cgH;
    car.physics.lastSurfaceRotationLoadBlend = rotationLoadBlend;
    if (cgH > 0) {
      const dF = mass * cgH * ax_est / L; // shift proportional to accel (filtered)
      const totalLoad = Math.max(1e-3, staticFzf + staticFzr);
      const maxTransfer = totalLoad * 0.30; // limit realistic forward/backward weight shift
      const limited = clamp(dF, -maxTransfer, maxTransfer);
      const minShare = 0.28;
      const maxShare = 0.72;
      let frontLoad = clamp(staticFzf - limited, totalLoad * minShare, totalLoad * maxShare);
      const aeroFront = P.aeroLoadTransfer ? Math.max(0, Fzf - staticFzf) : 0;
      const aeroRear = P.aeroLoadTransfer ? Math.max(0, Fzr - staticFzr) : 0;
      Fzf = frontLoad + aeroFront;
      Fzr = totalLoad - frontLoad + aeroRear;
      car.physics.lastLoadFront = Fzf;
      car.physics.lastLoadRear = Fzr;
      // Recompute load-sensitive mu and cornering stiffness with updated loads
      muLatF = muLat * (1 - loadSenseK * (Fzf / Math.max(1e-6, Fzf_ref) - 1));
      muLatR = muLat * (1 - loadSenseK * (Fzr / Math.max(1e-6, Fzr_ref) - 1));
      Cf = muLatF * Fzf / slip0;
      Cr = muLatR * Fzr / slip0;
    }
    car.physics.lastFzf = Fzf; car.physics.lastFzr = Fzr;

    // Optional roll-balance approximation. A bicycle contact normally has no
    // inside/outside load difference. Resolve that difference only for authored
    // roll setups: load-sensitive tires lose total axle grip as the inside
    // contact unloads. A stiff rear roll balance becomes more rotation-prone
    // under lift/braking, when longitudinal transfer has reduced rear load.
    // The previous tire acceleration drives roll continuously, without a pedal
    // trigger or yaw impulse. Existing vehicles retain their exact force path.
    const rollRearShare = P.rollStiffnessRearShare;
    let rollGripFront = 1, rollGripRear = 1;
    if (Number.isFinite(rollRearShare) && P.trackWidth > 0) {
      const targetAy = Math.abs(car.physics.lastAy || 0);
      const previousAy = car.physics.rollAcceleration || 0;
      const rollAy = lerp(previousAy, targetAy, 1 - Math.exp(-dtClamp / 0.12));
      car.physics.rollAcceleration = rollAy;
      const lateralTransfer = mass * rollAy * surfaceRotationSetup.baseCgHeight / P.trackWidth;
      const rearShare = clamp(rollRearShare, 0, 1);
      const exponent = clamp(P.tireLoadExponent ?? 0.8, 0.5, 1);
      rollGripFront = axleRollGrip(Fzf, lateralTransfer * (1 - rearShare), exponent);
      rollGripRear = axleRollGrip(Fzr, lateralTransfer * rearShare, exponent);
      muLatF *= rollGripFront;
      muLatR *= rollGripRear;
      Cf *= rollGripFront;
      Cr *= rollGripRear;
    }
    car.physics.lastRollGripFront = rollGripFront;
    car.physics.lastRollGripRear = rollGripRear;

    // Asphalt/tarmac/concrete allows powered slip only in first, including wet weather.
    // Recheck after the gearbox update so an upshift clears tire feedback now.
    const wheelspinSurfaceFactor = pavedWheelspin
      ? (gbState?.gear === 1 ? 1 : 0) : slipperySurfaceFactor;
    if (pavedWheelspin && gbState && gbState.gear !== 1) gbState.wheelspin = 0;
    const driveFrontShare = clamp(Number(P.driveFrontShare) || 0, 0, 1);
    // Hard launches break traction on loose ground or in first on paved roads.
    // The launch aid fades with speed; axle saturation can sustain wheelspin.
    const launchSpeedBlend = 1 - clamp((speedWorld - 180) / 170, 0, 1);
    const launchDemand = !reversing && brake < 0.05
      ? wheelspinSurfaceFactor * launchSpeedBlend * clamp((throttle - 0.85) / 0.15, 0, 1)
      : 0;
    const frontDriveRequest = driveFrontShare * Math.max(0, Fx_drive) / Math.max(1, muLong * Fzf);
    const rearDriveRequest = (1 - driveFrontShare) * Math.max(0, Fx_drive) / Math.max(1, muLong * Fzr);
    // Engines already beyond the launch breakaway demand need no grip penalty.
    const breakawayScale = clamp(Math.max(frontDriveRequest, rearDriveRequest) / 1.25, pavedWheelspin ? 0.40 : 0.45, 1);
    const launchTractionScale = lerp(1, breakawayScale, launchDemand);
    // A sliding loose-road tire still digs forward. Approach the lateral limit
    // smoothly and retain a longitudinal reserve instead of collapsing to 20%
    // as soon as slip crosses the lateral peak. Mild drift must remain loaded.
    // Full pedal in an established slide can unload the engine much further.
    // Ease into that response with slide angle so a small Touch steering tap
    // stays loaded; opposite lock restores the progressive catch response.
    const driftAngleBlend = clamp((bodySlipAngle - 0.08) / 0.18, 0, 1);
    const driftSpinBlend = driftAngleBlend * driftAngleBlend * (3 - 2 * driftAngleBlend) *
      clamp((throttle - 0.85) / 0.15, 0, 1) * (1 - countersteerIntent * 0.65);
    const lateralTractionShare = lerp(0.70, 0.90, driftSpinBlend);
    const frontLateralUse = Math.tanh(Math.abs(slipF) / Math.max(0.01, slip0));
    const rearLateralUse = Math.tanh(Math.abs(slipR) / Math.max(0.01, slip0));
    const frontPowerCapacity = muLong * Fzf * launchTractionScale *
      Math.sqrt(1 - lateralTractionShare * frontLateralUse * frontLateralUse);
    const rearPowerCapacity = muLong * Fzr * launchTractionScale *
      Math.sqrt(1 - lateralTractionShare * rearLateralUse * rearLateralUse);
    const brakeFrontFraction = clamp(P.brakeFrontShare ?? 0.6, 0, 1);
    const frontPowerForce = Math.max(0, driveFrontShare * Fx_drive - brakeFrontFraction * brakeForceCmd);
    const rearPowerForce = Math.max(0, (1 - driveFrontShare) * Fx_drive - (1 - brakeFrontFraction) * brakeForceCmd);
    const spinEnabled = !reversing && wheelspinSurfaceFactor > 0 && throttle > 0.05;
    const spinThrottle = clamp((throttle - 0.35) / 0.65, 0, 1);
    // Hard launches retain their quick breakaway. At racing speed, excess axle
    // torque builds slip across a broad range. Established full-power slides
    // reach saturation sooner; surface, load and gear still set the demand.
    const launchSpinBlend = !reversing && brake < 0.05
      ? launchSpeedBlend * clamp((throttle - 0.85) / 0.15, 0, 1) : 0;
    const spinOverloadRange = lerp(lerp(1.20, 0.50, driftSpinBlend), 0.15, launchSpinBlend);
    const frontPowerUse = frontPowerForce / Math.max(1, frontPowerCapacity);
    const rearPowerUse = rearPowerForce / Math.max(1, rearPowerCapacity);
    // Small tire slip also transmits useful drive below breakaway. It grows
    // with cornering load instead of treating every loaded contact as a burnout.
    const frontWorkingSlip = Math.min(1, frontPowerUse) * frontLateralUse * frontLateralUse * 0.12;
    const rearWorkingSlip = Math.min(1, rearPowerUse) * rearLateralUse * rearLateralUse * 0.12;
    const frontSpinDemand = spinEnabled ? wheelspinSurfaceFactor * spinThrottle *
      clamp(frontWorkingSlip + (frontPowerUse - 1) / spinOverloadRange, frontWorkingSlip, 1) : 0;
    const rearSpinDemand = spinEnabled ? wheelspinSurfaceFactor * spinThrottle *
      clamp(rearWorkingSlip + (rearPowerUse - 1) / spinOverloadRange, rearWorkingSlip, 1) : 0;
    // AWD's gripping axle still loads the engine during turn-in. As a powered
    // slide develops, the slipping axle has more influence on engine revs.
    // Hard launches retain the strongest axle's breakaway response.
    const sharedSpinDemand = frontSpinDemand * driveFrontShare + rearSpinDemand * (1 - driveFrontShare);
    const wheelspinDemand = lerp(sharedSpinDemand, Math.max(frontSpinDemand, rearSpinDemand), lerp(0.55 * driftSpinBlend, 1, launchSpinBlend));
    const previousWheelspin = car.physics.wheelspin || 0;
    const spinBuildTime = lerp(lerp(0.18, 0.14, driftSpinBlend), 0.06, launchSpinBlend);
    const spinResponse = 1 - Math.exp(-dt / (wheelspinDemand > previousWheelspin ? spinBuildTime : 0.16));
    car.physics.wheelspin = spinEnabled ? lerp(previousWheelspin, wheelspinDemand, spinResponse) : 0;
    const previousRearWheelspin = car.physics.rearWheelspin || 0;
    car.physics.rearWheelspin = spinEnabled ? lerp(previousRearWheelspin, rearSpinDemand,
      1 - Math.exp(-dt / (rearSpinDemand > previousRearWheelspin ? spinBuildTime : 0.16))) : 0;
    car.physics.lastWheelspinDemand = wheelspinDemand;
    // A driven rear tire builds slip under power before reaching its lateral peak.
    // Keep peak force available to catch the slide, but soften the initial slope
    // according to actual rear drive demand, surface and the driver's turn input.
    const rearDriveUtilization = clamp(
      (1 - driveFrontShare) * Math.max(0, Fx_drive) / Math.max(1, muLong * Fzr),
      0, 1,
    );
    const powerSlipDemand = slipperySurfaceFactor * requestedThrottle *
      Math.sqrt(rearDriveUtilization) * clamp((Math.abs(steerNormTarget) - 0.08) / 0.42, 0, 1) *
      (1 - countersteerIntent * 0.8) * (reversing ? 0 : 1);
    const rearSpinningSlip = car.physics.rearWheelspin * Math.sqrt(1 - driveFrontShare) *
      clamp(Math.abs(steerNormTarget) / 0.5, 0, 1) * (1 - countersteerIntent) *
      (1 - clamp((bodySlipAngle - 0.20) / 0.25, 0, 1));
    // The driven rear axle loses lateral bite while spinning. Taper the extra
    // loss as the slide grows, and restore bite with opposite lock. Retain more
    // stiffness while the engine is loaded so power can pull through the slide.
    // Straight launches stay symmetric; front-only spin cannot loosen the rear.
    const rearPowerSlip = Math.min(0.82, powerSlipDemand * (0.48 + 0.14 * car.physics.rearWheelspin) + rearSpinningSlip * 0.20);
    const rearWheelspinGrip = 1 - rearSpinningSlip * 0.25;
    car.physics.lastRearPowerSlip = rearPowerSlip;

    // Model the rear contact's braking slip during a loose-road turn alongside
    // the existing load transfer, rather than adding an artificial yaw kick.
    // Opposite lock restores rear bite, and straight stops/reverse stay stable.
    const brakeRotationDemand = slipperySurfaceFactor * brake *
      clamp((vxBody - 80) / 220, 0, 1) * (reversing ? 0 : 1) *
      clamp(Math.abs(steerNormTarget) / 0.5, 0, 1) *
      (1 - countersteerIntent);
    const previousBrakeRotation = car.physics.brakeRotation || 0;
    const brakeSlipRiseTime = Math.max(0.01, P.rearBrakeSlipRiseTime ?? 0.08);
    const brakeRotation = lerp(previousBrakeRotation, brakeRotationDemand,
      1 - Math.exp(-dt / (brakeRotationDemand > previousBrakeRotation ? brakeSlipRiseTime : 0.12)));
    car.physics.brakeRotation = brakeRotation;
    const rearLoadRetention = clamp(Fzr / Math.max(1, staticFzr), 0, 1);
    const rearBrakeShare = 1 - (P.brakeFrontShare ?? 0.6);
    // Front-biased setups and already-unloaded rear axles need less extra slip.
    const rearBrakeSlip = brakeRotation * slipperySurfaceFactor *
      rearLoadRetention * clamp(rearBrakeShare / 0.4, 0, 1) ** 2 *
      (reversing ? 0 : clamp(P.rearBrakeSlipStrength ?? 0.70, 0, 1));
    car.physics.lastRearBrakeSlip = rearBrakeSlip;
    // Touch pedals can overlap: do not compound two losses at the same contact.
    Cr *= 1 - Math.max(rearPowerSlip, rearBrakeSlip);
    // Once sliding, the braking rear axle also gives up some lateral capacity.
    // Fade this with body slip and countersteering so a tap tightens the arc,
    // while ordinary turn-in and the subsequent catch keep their rear grip.
    const rearBrakeGrip = 1 - rearBrakeSlip * 0.35 *
      clamp((bodySlipAngle - 0.08) / 0.20, 0, 1) * (1 - countersteerIntent);

    // Loaded front tires should build cornering force promptly during trail
    // braking on loose roads. Change response, not the peak/sliding grip ceiling.
    Cf *= 1 + slipperySurfaceFactor * brake * (reversing ? 0 : 0.25);

    // Now compute lateral forces with updated loads (mu load-sensitive per axle)
    if (reversing) {
      Cf *= 0.9;
      Cr *= 0.9;
    }
    let FyF_unc = tireLateralForce(
      muLatF,
      Fzf,
      Cf,
      slipF,
      slip0,
      lateralSlidingGrip,
    );
    FyR_unc = tireLateralForce(
      muLatR * rearBrakeGrip * rearWheelspinGrip,
      Fzr,
      Cr,
      slipR,
      slip0,
      lateralSlidingGrip,
    );

    // Longitudinal load-sensitivity for grip (effective muLong per axle)
    const kL = (P.muLongLoadSenseK != null ? P.muLongLoadSenseK : 0.04);
    const muLongEffF = muLong * (1 - kL * (Fzf / Math.max(1e-6, Fzf_ref) - 1)) * launchTractionScale;
    const muLongEffR = muLong * (1 - kL * (Fzr / Math.max(1e-6, Fzr_ref) - 1)) * launchTractionScale;

    // Front combined-slip ellipse (trail-braking reduces lateral)
    const frontCircle = (P.frontCircle != null ? P.frontCircle : (P.rearCircle != null ? P.rearCircle : 0.5));
    const brakeFrontShare = (P.brakeFrontShare != null ? P.brakeFrontShare : 0.6);
    // Opt-in axle distribution: legacy vehicles retain their existing force path.
    const FxF_cmd = driveFrontShare > 0
      ? driveFrontShare * Fx_drive - brakeFrontShare * Fx_brake
      : -brakeFrontShare * (brake * surfaceBrakeForce) * fwd;
    if (frontCircle > 0 && !P.combinedAxleGrip) {
      const frontRequest = (muLongEffF * Fzf > 1e-6) ? (FxF_cmd / (muLongEffF * Fzf)) : 0;
      // Saturated wheelspin cannot consume an unbounded force budget. Match
      // the rear axle's bounded drive AND brake demand, including mixed blends.
      const uxF = lerp(frontRequest, clamp(frontRequest, -1, 1), slipperySurfaceFactor);
      const uyF = (muLatF * Fzf > 1e-6) ? (FyF_unc / (muLatF * Fzf)) : 0;
      const lambdaF = Math.hypot(uxF, uyF);
      if (lambdaF > 1) {
        FyF_unc = FyF_unc / (1 + frontCircle * (lambdaF - 1));
      }
      car.physics._dbgLambdaF = lambdaF;
    } else {
      car.physics._dbgLambdaF = 0;
    }
    FyF = FyF_unc;
    const frontYawMoment = a * FyF * Math.cos(deltaEff);
    const countersteerFrontRelease =
      clamp(countersteerAssist * 1.10 * surfaceRotationSetup.frontYawReleaseScale,
        0, 0.55) * yawCountersteerIntent *
      clamp(frontYawMoment * (car.physics.r || 0) /
        Math.max(1, a * muLatF * Fzf * 0.15), 0, 1);
    if (countersteerFrontRelease > 0) {
      // At very high body slip the front tires can still reinforce the current
      // yaw even though the driver has applied opposite lock. Progressively
      // release only that reinforcing moment so rear lateral force can catch
      // and align the vehicle; ordinary turn-in force remains untouched.
      FyF *= 1 - countersteerFrontRelease;
    }
    car.physics.lastCountersteerFrontRelease = countersteerFrontRelease;

    // Mild rear combined slip limiting (scale only lateral)
    const rearCircle = (P.rearCircle != null ? P.rearCircle : 0.5);
    let lambda = 0;
    if (rearCircle > 0 && !P.combinedAxleGrip) {
      // Use wheel-originated longitudinal at rear contact for combined slip
      const brakeFrontShare = (P.brakeFrontShare != null ? P.brakeFrontShare : 0.6);
      const brakeRearShare = 1 - brakeFrontShare;
      const FxR_cmd_raw = (1 - driveFrontShare) * Fx_drive - brakeRearShare * (brake * surfaceBrakeForce) * (reversing ? -1 : fwd);
      const Fr_cap = Math.max(1e-6, muLongEffR * Fzr);
      const FxR_cmd = Math.max(-Fr_cap, Math.min(Fr_cap, FxR_cmd_raw));
      const uxR = FxR_cmd / Fr_cap;
      const uy = (muLatR * Fzr > 1e-6) ? (FyR_unc / (muLatR * Fzr)) : 0;
      lambda = Math.hypot(uxR, uy);
      if (lambda > 1) {
        FyR_unc = FyR_unc / (1 + rearCircle * (lambda - 1));
      }
      car.physics._dbgLambda = lambda;
    } else car.physics._dbgLambda = 0;
    let FyR = FyR_unc;

    // Now compute post-transfer longitudinal traction using slip ratio
    const Fr_max = muLongEffR * Fzr;
    const sPeak = (P.longSlipPeak != null ? P.longSlipPeak : 0.18);
    // Combined-grip RWD cars still brake at BOTH axles. The legacy rear-only
    // force path would ignore brake balance and unload rear cornering grip.
    const splitAxleForces = driveFrontShare > 0 || P.combinedAxleGrip;
    const s_req = Fr_max > 1e-6 ?
      ((splitAxleForces ? (1 - driveFrontShare) * Fx_drive - (1 - brakeFrontShare) * Fx_brake : Fx_cmd) / Fr_max) : 0;
    if (Math.abs(s_req) > sPeak && !P.combinedAxleGrip) {
      const overPeak = Math.min(1, Math.abs(s_req) - sPeak);
      const powerOversteerScale = onRoad ? trackSurface.powerOversteerScale : 0.35;
      const recoveryPreservation = clamp(
        Math.max(countersteerAssist * 0.75, powerRotationControl * 0.30),
        0,
        0.7,
      );
      const latScale = Math.max(
        0,
        1 - powerOversteerScale * overPeak * (1 - recoveryPreservation),
      );
      FyR *= latScale;
    }
    const longitudinalSlidingGrip = onRoad
      ? trackSurface.longitudinalSlidingGrip
      : 1;
    const tractionRatio = slipRatioResponse(s_req, longitudinalSlidingGrip);
    let FxRear = Fr_max * tractionRatio;
    const Ff_max = Math.max(1e-6, muLongEffF * Fzf);
    let FxFront = splitAxleForces && FxF_cmd !== 0
      ? Ff_max * slipRatioResponse(FxF_cmd / Ff_max, longitudinalSlidingGrip)
      : 0;
    // An opted-in contact shares ONE force budget between drive/brake and
    // cornering. Project both components, so cornering also costs acceleration.
    // Surface/weather and normal load set the ellipse; no pedal-triggered yaw.
    if (P.combinedAxleGrip) {
      const frontUse = Math.max(1, Math.hypot(FxFront / Ff_max,
        FyF / Math.max(1e-6, muLatF * Fzf)));
      const rearUse = Math.max(1, Math.hypot(FxRear / Math.max(1e-6, Fr_max),
        FyR / Math.max(1e-6, muLatR * Fzr)));
      FxFront /= frontUse;
      FyF /= frontUse;
      FxRear /= rearUse;
      FyR /= rearUse;
      car.physics.lastCombinedFrontUse = Math.hypot(FxFront / Ff_max,
        FyF / Math.max(1e-6, muLatF * Fzf));
      car.physics.lastCombinedRearUse = Math.hypot(FxRear / Math.max(1e-6, Fr_max),
        FyR / Math.max(1e-6, muLatR * Fzr));
    }
    // Combined-grip setups rotate the complete front contact on every surface.
    // Legacy setups retain their loose-surface-only propulsion rotation.
    const frontDriveAngle = P.combinedAxleGrip ? deltaEff
      : (FxFront > 0 && !reversing ? deltaEff * slipperySurfaceFactor : 0);
    const frontDriveForward = FxFront * Math.cos(frontDriveAngle) -
      (P.combinedAxleGrip ? FyF * Math.sin(deltaEff) : 0);
    const frontCorneringLateral = P.combinedAxleGrip ? FyF * Math.cos(deltaEff) : FyF;
    const frontDriveLateral = FxFront * Math.sin(frontDriveAngle);
    let Fx_trac = FxRear + frontDriveForward;
    car.physics.lastFrontDriveLateral = frontDriveLateral;
    car.physics.lastFxFront = FxFront;
    car.physics.lastFxRear = FxRear;
    car.physics.lastSlipReq = s_req;
    car.physics.prevDriveSlip = Math.max(0, Math.abs(s_req) - sPeak);
    let Fx_long = Fx_trac - F_drag - F_roll - F_surfaceDrag;
    car.physics.lastLongitudinalResistance = FxFront + FxRear - Fx_long;
    const ax = Fx_long / mass;
    car.physics.lastAx = ax;
    car.physics.lastAy = (FyF * Math.cos(deltaEff) + frontDriveLateral + FyR) / mass;
    car.physics._dbgFyR_avail = muLatR * Fzr;
    car.physics._dbgUx = Math.min(1, Math.abs(Fx_long) / Math.max(1e-6, Fr_max));
    car.physics._dbgFyR = FyR;

    const referenceYawDamping = Math.max(0.05, VEHICLE_DEFAULTS.GT.yawDampK || 0.3);
    // Do not damp yaw that is already turning the heading back toward travel.
    const countersteerYawDamping = referenceYawDamping * 7.5 * countersteerAssist *
      yawCountersteerIntent;
    const totalYawDamping = yawDamp + countersteerYawDamping;
    const rotationEnvelopeStrength = clamp(
      slipperySurfaceFactor *
        surfaceRotationSetup.rotationEnvelopeScale *
        clamp((requestedThrottle - 0.15) / 0.75, 0, 1),
      0,
      1.5,
    );
    // Reference scale for progressive drag, not a target or a yaw-rate limit.
    const controllableYawRate = clamp(
      0.90 +
        Math.abs(steerNormTarget) * 0.40 +
        clamp(vxAbs / 500, 0, 1) * 0.15 +
        (1 - slipperySurfaceFactor) * 0.18,
      0.98,
      1.48,
    );
    // Progressive rotational drag has no target yaw-rate shelf. It is tiny
    // during ordinary cornering and grows smoothly as rotation runs away.
    const yawRate = car.physics.r || 0;
    // During a catch, progressively dissipate rapid corrective rotation rather
    // than hiding wheel lock. This also works while trail braking, without power.
    const targetCatchDrag = slipCountersteerIntent *
      clamp(steerNormTarget * yawRate / 0.4, 0, 1) * 18;
    const previousCatchDrag = car.physics.catchDrag || 0;
    const catchDragTau = targetCatchDrag > previousCatchDrag ? 0.04 : 0.18;
    const catchDragState = slipperySurfaceFactor > 0
      ? lerp(previousCatchDrag, targetCatchDrag, 1 - Math.exp(-dt / catchDragTau))
      : 0;
    car.physics.catchDrag = catchDragState;
    const catchDrag = catchDragState * slipperySurfaceFactor;
    const rotationDragRate = (rotationEnvelopeStrength * 1.8 + catchDrag) *
      (yawRate / controllableYawRate) ** 2;
    // Semi-implicit drag cannot reverse yaw by itself, even after a collision
    // or a long tick. Tire forces and the driver remain free to change direction.
    const rotationEnvelopeAcceleration = -yawRate * rotationDragRate /
      (1 + rotationDragRate * Math.max(0, dt));
    car.physics.lastRotationEnvelopeStrength = rotationEnvelopeStrength;
    car.physics.lastControllableYawRate = controllableYawRate;
    car.physics.lastRotationEnvelopeAcceleration = rotationEnvelopeAcceleration;

    if (usePlanck && planckBody) {
      const pl = window.planck;
      if (pl) {
        // Wake up the body if there's any input - sleeping bodies don't respond to forces
        const hasInput = throttle > 0.01 || brake > 0.01 || Math.abs(steerNormTarget) > 0.01;
        if (hasInput && typeof planckBody.setAwake === 'function') {
          planckBody.setAwake(true);
        }
        const cosA = Math.cos(car.angle);
        const sinA = Math.sin(car.angle);
        const aM = meters(a, ppm);
        const bM = meters(b, ppm);
        const forceScratch =
          car.physics._planckForceScratch ||
          (car.physics._planckForceScratch = {
            frontForce: { x: 0, y: 0 },
            rearForce: { x: 0, y: 0 },
            resistanceForce: { x: 0, y: 0 },
            frontPoint: { x: 0, y: 0 },
            rearPoint: { x: 0, y: 0 },
          });
        const frontForce = forceScratch.frontForce;
        frontForce.x = (frontDriveForward * cosA - (frontCorneringLateral + frontDriveLateral) * sinA) / ppm;
        frontForce.y = (frontDriveForward * sinA + (frontCorneringLateral + frontDriveLateral) * cosA) / ppm;
        const rearForce = forceScratch.rearForce;
        rearForce.x = (FxRear * cosA - FyR * sinA) / ppm;
        rearForce.y = (FxRear * sinA + FyR * cosA) / ppm;
        const resistanceForce = forceScratch.resistanceForce;
        const resistance = -(F_drag + F_roll + F_surfaceDrag) / ppm;
        resistanceForce.x = resistance * cosA;
        resistanceForce.y = resistance * sinA;
        const bodyCenter = planckBody.getWorldCenter();
        const frontPoint = forceScratch.frontPoint;
        frontPoint.x = bodyCenter.x + cosA * aM;
        frontPoint.y = bodyCenter.y + sinA * aM;
        const rearPoint = forceScratch.rearPoint;
        rearPoint.x = bodyCenter.x - cosA * bM;
        rearPoint.y = bodyCenter.y - sinA * bM;
        planckBody.applyForce(frontForce, frontPoint);
        planckBody.applyForce(rearForce, rearPoint);
        planckBody.applyForce(resistanceForce, bodyCenter);
        // Preserve each vehicle's authored steering response with the heavier
        // chassis inertia. Only road/tire moments receive this calibration;
        // Planck solves contact impulses against the actual chassis inertia.
        const tireMoment = aM * (cosA * frontForce.y - sinA * frontForce.x) -
          bM * (cosA * rearForce.y - sinA * rearForce.x);
        planckBody.applyTorque(tireMoment * (CAR_TO_CAR_CONTACT.yawInertiaScale - 1));
        if (totalYawDamping || rotationEnvelopeAcceleration) {
          const torquePx =
            (-totalYawDamping * car.physics.r + rotationEnvelopeAcceleration) * Izz * CAR_TO_CAR_CONTACT.yawInertiaScale;
          planckBody.applyTorque(torquePx / (ppm * ppm));
        }
      }
    }

    // Dynamic derivatives (force-based)
    const dvx_dyn = (Fx_long - (P.combinedAxleGrip ? 0 : FyF * Math.sin(deltaEff)) + vy * car.physics.r) / mass;
    const dvy_dyn = (FyF * Math.cos(deltaEff) + frontDriveLateral + FyR - vx * car.physics.r) / mass;
    let dr_dyn = (a * (FyF * Math.cos(deltaEff) + frontDriveLateral) - b * FyR) / Izz;
    // Yaw damping
    dr_dyn += -totalYawDamping * car.physics.r + rotationEnvelopeAcceleration;

    // Kinematic fallback
    const vKineBlend = (P.vKineBlend != null ? P.vKineBlend : 40);
    const speedBody2 = Math.hypot(vx, vy);
    let dvx_kine = 0, dvy_kine = 0, dr_kine = 0;
    if (vKineBlend > 0) {
      dr_kine = (vxSigned / L) * Math.tan(deltaEff);
      dvy_kine = dr_kine * vxSigned; // rotate forward velocity into lateral
    }
    let alphaBlend = 1;
    if (vKineBlend > 0) {
      const t = clamp(speedBody2 / vKineBlend, 0, 1);
      alphaBlend = t * t * (3 - 2 * t);
    }
    // IMPORTANT: do NOT blend longitudinal acceleration; previous version blended dvx
    // which zeroed propulsion at low speed (alphaBlend~0) causing cars to stay frozen.
    const dvx = dvx_dyn;
    const dvy = dvy_kine + (dvy_dyn - dvy_kine) * alphaBlend;
    let dr = dr_kine + (dr_dyn - dr_kine) * alphaBlend;
    car.physics.lastAlphaBlend = alphaBlend;

    if (!usePlanck) {
      if (P.forceSpaceFallback) {
        // Match the Planck axle forces in world space. The older fallback
        // transforms rotating-frame derivatives before advancing heading, which
        // adds spurious lateral deceleration in a sustained turn. Keep that
        // legacy route for existing setups; authored roll setups can opt in to
        // the same contact forces and chassis damping as the production solver.
        const lateralForce = frontCorneringLateral + frontDriveLateral + FyR;
        const worldForce = bodyToWorld(Fx_long, lateralForce, car.angle, vectorScratch.world);
        car.physics.vx += worldForce.x / mass * dt;
        car.physics.vy += worldForce.y / mass * dt;
        const yawAcceleration = (a * (frontCorneringLateral + frontDriveLateral) - b * FyR) / Izz -
          totalYawDamping * car.physics.r + rotationEnvelopeAcceleration;
        car.physics.r += yawAcceleration * dt;
        car.physics.r /= 1 + Math.max(0, P.angularDamp || 0) * dt;
      } else {
        vx += dvx * dt;
        vy += dvy * dt;
        car.physics.r += dr * dt;
        const vw = bodyToWorld(vx, vy, car.angle, vectorScratch.world);
        car.physics.vx = vw.x;
        car.physics.vy = vw.y;
      }
      car.vx = car.physics.vx;
      car.vy = car.physics.vy;
      car.x += car.physics.vx * dt;
      car.y += car.physics.vy * dt;
      car.angle += car.physics.r * dt;
    }

    // Cache debug values
    car.physics.lastSlipF = slipF;
    car.physics.lastSlipR = slipR;
    car.physics.lastFx_long = Fx_long;
    car.physics.lastFwd = fwd;
    car.physics.lastDeltaEff = deltaEff;
    car.physics.lastLambda = car.physics._dbgLambda || 0;
    car.physics.lastReversing = reversing;
    car.physics.lastSurfaceId = onRoad ? trackSurface.id : 'grass';
    car.physics.lastWeatherId = weatherId;

    // Apply top speed cap
    const maxSpeed = P.maxSpeed != null ? P.maxSpeed : 10000;
    const currentSpeed = Math.hypot(car.physics.vx, car.physics.vy);
    if (currentSpeed > maxSpeed) {
      const scale = maxSpeed / currentSpeed;
      car.physics.vx *= scale;
      car.physics.vy *= scale;
      car.vx = car.physics.vx;
      car.vy = car.physics.vy;
      // Also clamp Planck body velocity if using Planck
      if (usePlanck && car.physics.planckBody && typeof car.physics.planckBody.setLinearVelocity === 'function') {
        const pl = (typeof window !== 'undefined' && window.planck) ? window.planck : null;
        if (pl && typeof pl.Vec2 === 'function') {
          const ppm = planckState.pixelsPerMeter || 30;
          car.physics.planckBody.setLinearVelocity(pl.Vec2(car.physics.vx / ppm, car.physics.vy / ppm));
        }
      }
    }

    // Additional damping at very low speeds to prevent runaway spin/creep
    const speedMag = Math.hypot(car.physics.vx, car.physics.vy);
    const angMax = 7.5;
    if (Math.abs(car.physics.r) > angMax) {
      car.physics.r = clamp(car.physics.r, -angMax, angMax);
      if (usePlanck && car.physics.planckBody && typeof car.physics.planckBody.getAngularVelocity === 'function' && typeof car.physics.planckBody.setAngularVelocity === 'function') {
        const omega = car.physics.planckBody.getAngularVelocity();
        const clampedOmega = Math.max(-angMax, Math.min(angMax, omega));
        car.physics.planckBody.setAngularVelocity(clampedOmega);
      }
    }
    const lowInput = Math.abs(throttle) < 0.04 && brake < 0.04;
    const neutralHold = gbState && gbState.isNeutral && speedMag < 10;
    if (neutralHold) {
      car.physics.vx = 0;
      car.physics.vy = 0;
      car.physics.r = 0;
      car.vx = 0;
      car.vy = 0;
      if (usePlanck && car.physics.planckBody) {
        if (typeof car.physics.planckBody.setLinearVelocity === "function") {
          const pl = (typeof window !== "undefined" && window.planck) ? window.planck : null;
          if (pl && typeof pl.Vec2 === "function") {
            car.physics.planckBody.setLinearVelocity(pl.Vec2(0, 0));
          } else if (typeof car.physics.planckBody.getLinearVelocity === "function") {
            const lv = car.physics.planckBody.getLinearVelocity();
            if (lv && typeof lv === "object" && "x" in lv && "y" in lv) {
              lv.x = 0;
              lv.y = 0;
              car.physics.planckBody.setLinearVelocity(lv);
            }
          }
        }
        if (typeof car.physics.planckBody.setAngularVelocity === "function") {
          car.physics.planckBody.setAngularVelocity(0);
        }
      }
    } else if (speedMag < 35 && lowInput) {
      const linDamp = Math.exp(-dt * 18);
      const angDamp = Math.exp(-dt * 22);
      car.physics.vx *= linDamp;
      car.physics.vy *= linDamp;
      car.physics.r *= angDamp;
      const body = car.physics.planckBody;
      if (usePlanck && body) {
        if (typeof body.getLinearVelocity === 'function' && typeof body.setLinearVelocity === 'function') {
          const lv = body.getLinearVelocity();
          if (lv && typeof lv === 'object') {
            lv.x *= linDamp;
            lv.y *= linDamp;
            body.setLinearVelocity(lv);
          }
        }
        if (typeof body.getAngularVelocity === 'function' && typeof body.setAngularVelocity === 'function') {
          body.setAngularVelocity(body.getAngularVelocity() * angDamp);
        }
      }
    }

    // Derived properties for compatibility
    car.speed = Math.hypot(car.physics.vx, car.physics.vy);
    // Rovekar RX, Velnoric GT and the buggies mirror the existing upshift torque cut as a
    // brief pedal lift in the engine sound.
    const engineUpshiftLift =
      ['Rallycross', 'GT', 'DuneraX1', 'RavikR'].includes(car.kind) && gbState && gbState.cutRemainingMs > 0 &&
      gbState.prevGear >= 1 && gbState.gear > gbState.prevGear;
    car.sfxThrottle = engineUpshiftLift ? 0 : throttle;
    car.sfxRPM = gb ? gb.rpm : 0;
    car.sfxGear = gb ? gb.gear : 0;
    car.sfxDriveForce = gb ? (gb.lastRequestedForce ?? 0) : 0;
    car.sfxGrass = !onRoad;
    car.sfxSurfaceId = onRoad ? trackSurface.id : 'grass';
    car.sfxOffTrackSurfaceId = trackSurface.id;
    car.weatherId = weatherId;

    // Skid intensity from combined slip
    const skidLatRaw = Math.max(0, Math.min(1, (Math.abs(slipF) + Math.abs(slipR)) / (2 * 0.35)));
    const forceUtilizationSlip = Math.max(
      0,
      Math.min(1, Math.abs(Fx_long) / Math.max(1, muLong * Fzr) - 0.85),
    );
    const tractionDemandSlip = clamp((Math.abs(s_req) - 1) / 1.5, 0, 1);
    const driveSlipRaw = Math.max(forceUtilizationSlip, tractionDemandSlip, car.physics.wheelspin || 0);
    const skidSpeedThreshold = (P.skidSpeedThreshold != null ? P.skidSpeedThreshold : 120);
    const skidEligible = (fwd > 0) && ((vxAbs > 60 && car.speed > skidSpeedThreshold) ||
      (car.physics.wheelspin || 0) > 0.1);
    const skid = skidEligible ? clamp(0.5 * skidLatRaw + 0.5 * driveSlipRaw, 0, 1) : 0;
    car.physics.skid = skid;
    car.sfxSlip = (car.sfxSlip || 0) * 0.85 + skid * 0.15;

    const result = resultBuffer || {};
    result.skid = skid;
    result.steerAngle = delta;
    result.onGrass = !onRoad;
    result.Fx_long = Fx_long;
    result.FyR = car.physics._dbgFyR;
    result.FyR_avail = car.physics._dbgFyR_avail;
    result.ux = car.physics._dbgUx;
    result.slipF = slipF;
    result.slipR = slipR;
    result.speed = car.speed;
    result.fwd = fwd;
    result.reversing = reversing;
    result.skidEligible = skidEligible;
    result.surfaceId = onRoad ? trackSurface.id : 'grass';
    result.trackSurfaceId = trackSurface.trackSurfaceId || trackSurfaceId;
    result.weatherId = weatherId;
    result.countersteerAssist = countersteerAssist;
    result.countersteerRecoveryScale = countersteerRecoveryScale;
    result.countersteerFrontRelease = countersteerFrontRelease;
    result.powerRotationControl = powerRotationControl;
    result.effectiveCgHeight = cgH;
    result.surfaceCgHeightBoost = surfaceCgHeightBoost;
    result.surfaceRotationLoadBlend = rotationLoadBlend;
    result.rotationEnvelopeStrength = rotationEnvelopeStrength;
    result.controllableYawRate = controllableYawRate;
    result.looseSurfaceAptitude = surfaceRotationSetup.looseSurfaceAptitude;
    result.capabilityLateralGripScale =
      surfaceRotationSetup.capabilityLateralGripScale;
    result.capabilityAssistScale = surfaceRotationSetup.capabilityAssistScale;
    return result;
  }

  function wheelPositions(car, output) {
    const halfW = (car.width || 18) * 0.45;
    const nx = -Math.sin(car.angle), ny = Math.cos(car.angle);
    const result = output || {};
    const left = result.left || (result.left = { x: 0, y: 0 });
    const right = result.right || (result.right = { x: 0, y: 0 });
    left.x = car.x + nx * halfW;
    left.y = car.y + ny * halfW;
    right.x = car.x - nx * halfW;
    right.y = car.y - ny * halfW;
    return result;
  }

  // Simple debug draw: velocity vector and slip
  let DEBUG = false;
  let CHECKPOINTS_VISIBLE = false;
  window.__CHECKPOINTS_ENABLED = false;

  function setDebugEnabled(v) { DEBUG = !!v; }
  function setCheckpointsEnabled(v) {
    CHECKPOINTS_VISIBLE = !!v;
    window.__CHECKPOINTS_ENABLED = !!v;
  }
  function getCheckpointsEnabled() { return !!window.__CHECKPOINTS_ENABLED; }
  function drawDebug(ctx, car) {
    if (!DEBUG) return;
    ctx.save();
    ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 1.5; // velocity
    ctx.beginPath(); ctx.moveTo(car.x, car.y); ctx.lineTo(car.x + car.physics.vx * 0.25, car.y + car.physics.vy * 0.25); ctx.stroke();
    ctx.strokeStyle = '#ff4081'; // heading
    ctx.beginPath(); ctx.moveTo(car.x, car.y); ctx.lineTo(car.x + Math.cos(car.angle) * 18, car.y + Math.sin(car.angle) * 18); ctx.stroke();

    // Compact physics line (player-oriented). Expect prior updateCar to have stored debug fields.
    try {
      const p = car.physics || {};
      if (p._dbgFyR_avail != null) {
        const lambda = p.lastLambda != null ? p.lastLambda : 0;
        const speedMag = Math.hypot(car.physics.vx || 0, car.physics.vy || 0);
        const gbState = car.physics.lastGb || (car.gearbox ? {
          gear: car.gearbox.gear,
          rpm: car.gearbox.rpm,
          requestedForce: car.gearbox.lastRequestedForce ?? 0
        } : null);
        const slipReq = car.physics.lastSlipReq != null ? car.physics.lastSlipReq : 0;
        const gbLine = gbState ? ` G${gbState.gear} ${Math.round(gbState.rpm || 0)}rpm ReqF=${Math.round(gbState.requestedForce || 0)} Slip=${Math.round(Math.abs(slipReq) * 100)}%` : '';
        const line = `fwd=${(p.lastFwd != null ? p.lastFwd : 1)} ${(p.lastReversing ? 'REV ' : '')}|v|=${speedMag.toFixed(1)} vx=${(car.physics.vx || 0).toFixed(1)} vy=${(car.physics.vy || 0).toFixed(1)} dEff=${(p.lastDeltaEff || 0).toFixed(3)} slipF=${(p.lastSlipF || 0).toFixed(3)} slipR=${(p.lastSlipR || 0).toFixed(3)} lambda=${lambda.toFixed(2)} ax=${(p.lastAx || 0).toFixed(2)} FzF=${(p.lastFzf || 0).toFixed(0)} FzR=${(p.lastFzr || 0).toFixed(0)} ${(p.lastAlphaBlend < 0.999) ? 'KIN' : ''}${gbLine}`;
        ctx.font = '11px monospace';
        ctx.textBaseline = 'top';
        const x = car.x + 20, y = car.y - 30;
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; const w = ctx.measureText(line).width + 8; ctx.fillRect(x - 4, y - 2, w, 16);
        ctx.fillStyle = (lambda > 1.01) ? '#ff5050' : '#e0f2f1';
        ctx.fillText(line, x, y);
      }
    } catch (_) { }
    ctx.restore();
  }
  const DEVTOOLS_STYLE = `
    .rv-devtools{position:fixed;top:var(--dev-panel-top, 56px);left:12px;z-index:35;font:11px system-ui;}
    .rv-devtools .toggle{display:none !important;} /* Hidden - now accessed through Dev dropdown menu */
    .rv-panel{display:none; margin-top:6px; padding:10px; border:1px solid rgba(71,85,105,0.6); background:rgba(15,23,42,0.94); color:#e6eef6; border-radius:10px; width:min(350px, calc(100vw - 24px)); box-shadow:0 8px 24px rgba(0,0,0,.5); max-height:calc(100vh - 100px); overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; touch-action:pan-y; -webkit-overflow-scrolling:touch}
    .rv-panel.open{display:block;}
    .rv-row{display:flex; align-items:center; gap:6px; margin:5px 0; min-width:0}
    .rv-row label{width:104px;flex:0 0 104px;min-width:0;opacity:.9; font-size:11px}
    .rv-row input[type=range]{flex:1 1 92px;min-width:64px}
    .rv-row input[type=number]{width:60px;flex:0 0 60px;background:#0b1322;color:#e6eef6;border:1px solid #334;border-radius:6px;padding:3px;font-size:10px}
    .rv-row select{flex:1 1 auto;min-width:0;background:#0b1322;color:#e6eef6;border:1px solid #334;border-radius:6px;padding:4px 6px;font-size:10px}
    .rv-row .val{width:44px;flex:0 0 44px;text-align:right; opacity:.8; font-size:10px}
    .rv-row .variant-delta{width:62px;flex:0 0 62px;min-width:0;text-align:left;font-size:10px;font-weight:800;line-height:1;letter-spacing:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .rv-row .variant-delta.hidden{display:none}
    .rv-row .variant-delta.buff{color:#4ade80;text-shadow:0 0 8px rgba(74,222,128,.25)}
    .rv-row .variant-delta.nerf{color:#fb7185;text-shadow:0 0 8px rgba(251,113,133,.25)}
    .rv-row .rv-btns{display:flex;flex-direction:column;gap:3px}
    .rv-row .rv-mini{appearance:none;border:1px solid #334;background:#18253c;color:#e6eef6;font-size:10px;padding:2px 5px;border-radius:4px;cursor:pointer}
    .rv-row .rv-mini:hover{background:#223454}
    .rv-row.preset-row{justify-content:space-between;align-items:flex-start}
    .rv-row.preset-row .rv-mini{font-size:11px;padding:5px 8px}
    .rv-preset-chooser{position:relative;flex:1;display:flex;flex-direction:column;gap:4px}
    .rv-preset-chooser .toggle{width:100%}
    .rv-preset-menu{position:absolute;top:100%;left:0;right:0;background:#0b1322;border:1px solid #334;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.45);margin-top:4px;max-height:200px;overflow-y:auto;display:none;z-index:60}
    .rv-preset-menu.open{display:block}
    .rv-preset-menu button{width:100%;text-align:left;padding:5px 8px;border:none;background:transparent;color:#e6eef6;font-size:11px;cursor:pointer}
    .rv-preset-menu button:hover{background:#1a2640}
    .rv-preset-menu .rv-empty{padding:6px 8px;font-size:11px;opacity:.75}
    .rv-row .small{opacity:.75;font-size:10px}
    .rv-section{margin:10px 0;padding:6px 8px;border-radius:8px;border:1px solid rgba(148,163,184,0.35);background:rgba(15,23,42,0.65)}
    .rv-section h4{margin:0 0 5px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#cbd5f5}
    .rv-section-note{margin:0 0 7px;color:#cbd5e1;font-size:10px;line-height:1.35}
    .rv-section.planck{border-color:rgba(34,197,94,0.45);background:rgba(21,128,61,0.25)}
    .rv-section.planck h4{color:#34d399}
    .rv-section.legacy{border-color:rgba(251,146,60,0.45);background:rgba(180,83,9,0.25)}
    .rv-section.legacy h4{color:#fb923c}
    .rv-section .rv-row{margin:5px 0}
    .rv-devtools.rv-veh{left:12px;right:auto;top:var(--dev-panel-top, 56px)}
    .rv-caution{display:none;margin-left:4px;font-size:12px;cursor:help}
    .rv-panel.clone-active .rv-row[data-no-ai-clone] .rv-caution{display:inline}
    @media (max-width: 600px) {
      .rv-devtools{font-size:10px}
      .rv-panel{width:min(320px, calc(100vw - 16px));padding:8px}
      .rv-row{gap:4px}
      .rv-row label{width:82px;flex-basis:82px;font-size:10px}
      .rv-row input[type=range]{min-width:50px}
      .rv-row input[type=number]{width:48px;flex-basis:48px;font-size:9px}
      .rv-row .val{width:38px;flex-basis:38px;font-size:9px}
      .rv-row .variant-delta{width:54px;flex-basis:54px;font-size:9px}
    }
  `;

  function ensureDevPanelStyles() {
    if (document.getElementById('rv-devtools-style')) return;
    const style = document.createElement('style');
    style.id = 'rv-devtools-style';
    style.textContent = DEVTOOLS_STYLE;
    document.head.appendChild(style);
  }

  // Dev tools UI
  async function injectDevTools(getCars) {
    if (document.getElementById('rv-devtools')) return; // once
    ensureDevPanelStyles();

    const DESCRIPTIONS = {
      vehicle: "Select which vehicle preset you are tuning.",
      applyToAI: "Apply the current tuning to AI cars as well.",
      debugOverlay: "Show on-screen debug info (forces, slip, etc.).",
      usePlanck: "Use Planck (Box2D) for integration/collisions. Off = legacy integrator.",
      pixelsPerMeter: "Scale from pixels to physics meters. Affects body sizes in the solver.",
      linearDamp: "Planck: global damping on linear velocity. Prefer Drag/Rolling for coasting.",
      angularDamp: "Planck: damping on yaw (rotational) velocity. Prefer Yaw damp for tuning feel.",
      gravity: "World gravity in px/s². Higher values increase weight transfer and available grip.",
      restitution: "Bounciness on wall impacts.",
      velIters: "Solver velocity iterations. Higher = more accurate contacts (slower).",
      posIters: "Solver position iterations. Higher = fewer penetrations (slower).",
      mass: "Car mass & inertia. Higher = more planted, harder to spin; may need more Brake.",
      enginePowerMult: "Multiplier on gearbox drive torque. >1 = more power, <1 = detuned.",
      brakeForce: "Peak braking force. Higher = shorter stops; too high can overwhelm grip.",
      maxSteer: "Modes: Manual only. Sets the largest wheel turn the car can use. Raise it for tighter low-speed turns; too much can make fast driving twitchy.",
      steerSpeed: "Modes: Manual and Analogue. Sets how quickly the wheels move when you steer. Higher reacts sooner; lower feels smoother and slower.",
      steerMode: "Choose how you steer: Manual uses left/right button-style input; Touch automatically limits steering more as speed rises; Analogue lets you drag across the wheel for partial steering.",
      touchMaxLow: "Modes: Touch and Analogue. Sets the largest wheel turn when the car is moving slowly. Higher makes tight, slow corners easier, but can feel sharper.",
      touchMaxHigh: "Modes: Touch and Analogue. Sets the largest wheel turn when the car is moving fast. Lower helps prevent sudden turns and spins at speed.",
      touchFalloff: "Modes: Touch and Analogue. Sets how quickly the game changes from the low-speed turn limit to the high-speed turn limit as the car speeds up. Higher keeps stronger steering for longer.",
      touchBaseRate: "Modes: Touch only. Sets how quickly the wheels begin turning after you press left or right. Higher feels more immediate; lower feels gentler.",
      touchRateFalloff: "Modes: Touch only. Sets how much the wheel-turning speed slows down as the car speeds up. Higher makes high-speed steering calmer.",
      touchReturn: "Modes: Touch only. Sets how strongly the wheels straighten themselves when you let go. Higher returns to straight ahead more quickly.",
      touchFilter: "Modes: Touch and Analogue. Smooths the game’s reading of your speed before it changes the steering limit. Higher makes the change more gradual; lower reacts sooner.",
      muLatRoad: "Sideways (lateral) grip on road. Raises cornering limit before slide.",
      muLongRoad: "Forward/back (longitudinal) grip on road. Affects traction & braking.",
      muLatGrass: "Sideways grip on grass (usually much lower than road).",
      muLongGrass: "Forward/back grip on grass (usually lower than road).",
      dragK: "Aerodynamic drag (~speed²). Higher = more lift-off decel & lower top speed.",
      rollK: "Rolling resistance (~speed). Higher = more coasting loss at any speed.",
      rearCircle: "Rear combined-slip blend. Higher = rear loses lateral sooner under drive/brake (stabilizes on throttle).",
      frontCircle: "Front combined-slip blend. Higher = front loses lateral sooner under braking (reduces trail-brake bite).",
      brakeFrontShare: "Front brake bias (0.50 = 50% front). Higher = more front braking, less rear lock.",
      longSlipPeak: "Slip ratio at which drive/brake force peaks. Higher = peak at larger slip (strong bite).",
      longSlipFalloff: "How gently force falls after the peak. Higher = softer, more forgiving breakaway.",
      loadSenseK: "Lateral load sensitivity. Higher = diminishing returns with load (tames extremes).",
      muLongLoadSenseK: "Longitudinal load sensitivity. Higher = traction/braking gain less with load.",
      downforceK: "Speed-based downforce. Higher = more high-speed grip without changing low-speed feel.",
      vKineBlend: "Low-speed kinematic blend (legacy helper). Often inactive when Planck is on.",
      cgHeight: "CG height for accel/brake weight transfer. Higher = stronger lift-off oversteer.",
      yawDampK: "Extra yaw damping torque. Higher = rotations settle faster.",
      reverseEntry: "Speed threshold/window to allow reverse mode.",
      reverseTorque: "Percent of engine torque available in reverse.",
      rebuildWorld: "Rebuild the Planck physics world/bodies with current settings.",
      resetDefaults: "Reset this vehicle’s sliders to default values.",
      showCheckpoints: "Toggle visibility of track checkpoints."
    };
    DESCRIPTIONS.vxHyst = "Hysteresis around 0 px/s before direction flips (prevents sign flapping).";
    DESCRIPTIONS.reverseSteer = "Steering scale when reversing (lower = calmer).";
    DESCRIPTIONS.yawReverseMul = "Yaw damping multiplier when reversing.";
    DESCRIPTIONS.clonePhysics = "Continuously sync player physics (engine, grip, mass, etc.) to all AI cars of the same vehicle type. Each vehicle type gets its own physics from the player driving that type.";


    const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const tipAttr = (key) => {
      const desc = DESCRIPTIONS[key];
      return desc ? ` title="${escapeAttr(desc)}"` : '';
    };

    const getCarSet = () => {
      if (typeof getCars !== 'function') return {};
      return getCars() || {};
    };
    const normalizeVehicleKind = (kind, fallback = 'GT') => {
      if (kind && VEHICLE_DEFAULTS[kind]) return kind;
      return VEHICLE_DEFAULTS[fallback] ? fallback : Object.keys(VEHICLE_DEFAULTS)[0];
    };
    const getActiveVehicleKind = () => {
      const cars = getCarSet();
      const playerKind = cars.player && cars.player.kind;
      if (playerKind && VEHICLE_DEFAULTS[playerKind]) return playerKind;
      if (Array.isArray(cars.ai)) {
        const aiCar = cars.ai.find((car) => car && car.kind && VEHICLE_DEFAULTS[car.kind]);
        if (aiCar) return aiCar.kind;
      }
      return normalizeVehicleKind('GT');
    };
    const activeVehicleKind = getActiveVehicleKind();

    const wrap = document.createElement('div');
    wrap.id = 'rv-devtools';
    wrap.className = 'rv-devtools';
    wrap.innerHTML = `
      <button class="toggle">Dev tools ▾</button>
      <div class="rv-panel" role="dialog" aria-label="Dev tools">
        <div class="rv-row preset-row">
          <button id="rv-preset-save" class="rv-mini">Save Preset</button>
          <div class="rv-preset-chooser">
            <button id="rv-preset-load" class="rv-mini toggle">Choose Preset ▾</button>
            <div id="rv-preset-menu" class="rv-preset-menu"></div>
          </div>
        </div>
        <div class="rv-row"><label for="rv-kind"><span class="rv-name"${tipAttr('vehicle')}>Vehicle</span></label>
          <select id="rv-kind">
            ${Object.keys(VEHICLE_DEFAULTS).map(k => `<option value="${k}"${k === activeVehicleKind ? ' selected' : ''}>${getVehicleLabel(k)}</option>`).join('')}
          </select>
          <label class="small" for="rv-apply-ai"><input type="checkbox" id="rv-apply-ai"> <span class="rv-name"${tipAttr('applyToAI')}>Apply to AI</span></label>
        </div>
        <div class="rv-row"><label class="small" for="rv-clone-physics"><input type="checkbox" id="rv-clone-physics"> <span class="rv-name"${tipAttr('clonePhysics')}>Clone player physics to AI (per vehicle)</span></label></div>
        <div class="rv-row"><label for="rv-debug"><span class="rv-name"${tipAttr('debugOverlay')}>Debug overlay</span></label><input type="checkbox" id="rv-debug"></div>
        <div class="rv-row"><label for="rv-checkpoints"><span class="rv-name"${tipAttr('showCheckpoints')}>Show checkpoints</span></label><input type="checkbox" id="rv-checkpoints"></div>
        <div class="rv-section planck">
          <h4>Planck</h4>
          <div class="rv-row" data-no-ai-clone><label for="rv-planck"><span class="rv-name"${tipAttr('usePlanck')}>Use Planck</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input type="checkbox" id="rv-planck"></div>
          <div class="rv-row" data-no-ai-clone><label for="rv-ppm"><span class="rv-name"${tipAttr('pixelsPerMeter')}>Pixels / m</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-ppm" type="number" min="5" max="200" step="1"></div>
          <div class="rv-row"><label for="rv-gravity"><span class="rv-name"${tipAttr('gravity')}>Gravity</span></label><input id="rv-gravity" type="range" min="${GRAVITY_MIN}" max="${GRAVITY_MAX}" step="10"><div class="val" id="rv-gravity-v"></div></div>
          <div class="rv-row"><label for="rv-ldamp"><span class="rv-name"${tipAttr('linearDamp')}>Linear damp</span></label><input id="rv-ldamp" type="range" min="0" max="5" step="0.05"><div class="val" id="rv-ldamp-v"></div></div>
          <div class="rv-row"><label for="rv-adamp"><span class="rv-name"${tipAttr('angularDamp')}>Angular damp</span></label><input id="rv-adamp" type="range" min="0" max="8" step="0.05"><div class="val" id="rv-adamp-v"></div></div>
          <div class="rv-row"><label for="rv-rest"><span class="rv-name"${tipAttr('restitution')}>Restitution</span></label><input id="rv-rest" type="range" min="0" max="1" step="0.02"><div class="val" id="rv-rest-v"></div></div>
          <div class="rv-row" data-no-ai-clone><label for="rv-veliters"><span class="rv-name"${tipAttr('velIters')}>Vel iters</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-veliters" type="number" min="1" max="50" step="1"></div>
          <div class="rv-row" data-no-ai-clone><label for="rv-positers"><span class="rv-name"${tipAttr('posIters')}>Pos iters</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-positers" type="number" min="1" max="50" step="1"></div>
          <div class="rv-row"><button id="rv-planck-rebuild"${tipAttr('rebuildWorld')}>Rebuild physics world</button></div>

        </div>
        <div class="rv-row"><label for="rv-mass"><span class="rv-name"${tipAttr('mass')}>Mass</span></label><input id="rv-mass" type="range" min="0.6" max="2.2" step="0.05"><div class="val" id="rv-mass-v"></div></div>
  <div class="rv-row"><label for="rv-eng"><span class="rv-name"${tipAttr('enginePowerMult')}>Engine</span></label><input id="rv-eng" type="range" min="0.5" max="6" step="0.05"><div class="val" id="rv-eng-v"></div></div>
        <div class="rv-row"><label for="rv-brk"><span class="rv-name"${tipAttr('brakeForce')}>Brake</span></label><input id="rv-brk" type="range" min="100" max="1100" step="10"><div class="val" id="rv-brk-v"></div></div>
        <div class="rv-row"><label for="rv-steer"><span class="rv-name"${tipAttr('maxSteer')}>Max steer</span></label><input id="rv-steer" type="range" min="0.25" max="0.85" step="0.01"><div class="val" id="rv-steer-v"></div></div>
        <div class="rv-row"><label for="rv-steers"><span class="rv-name"${tipAttr('steerSpeed')}>Steer speed</span></label><input id="rv-steers" type="range" min="2" max="10" step="0.1"><div class="val" id="rv-steers-v"></div></div>
        <div class="rv-section">
          <h4>Steering</h4>
          <p class="rv-section-note">Mode guide: <b>Manual</b> uses Max steer and Steer speed. <b>Touch</b> uses every setting below. <b>Analogue</b> uses Touch max, Falloff speed, and Filter tau; its turn speed uses Steer speed.</p>
          <div class="rv-row" data-no-ai-clone><label for="rv-steerMode"><span class="rv-name"${tipAttr('steerMode')}>Steering mode</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label>
            <select id="rv-steerMode">
              <option value="manual">Manual</option>
              <option value="touch">Touch</option>
              <option value="analogue">Analogue</option>
            </select>
          </div>
          <div class="rv-row"><label for="rv-touchMaxLow"><span class="rv-name"${tipAttr('touchMaxLow')}>Touch max (low)</span></label><input id="rv-touchMaxLow" type="range" min="0.30" max="0.90" step="0.01"><div class="val" id="rv-touchMaxLow-v"></div></div>
          <div class="rv-row"><label for="rv-touchMaxHigh"><span class="rv-name"${tipAttr('touchMaxHigh')}>Touch max (high)</span></label><input id="rv-touchMaxHigh" type="range" min="0.10" max="0.60" step="0.01"><div class="val" id="rv-touchMaxHigh-v"></div></div>
          <div class="rv-row"><label for="rv-touchFalloff"><span class="rv-name"${tipAttr('touchFalloff')}>Falloff speed</span></label><input id="rv-touchFalloff" type="range" min="80" max="460" step="5"><div class="val" id="rv-touchFalloff-v"></div></div>
          <div class="rv-row"><label for="rv-touchBaseRate"><span class="rv-name"${tipAttr('touchBaseRate')}>Base steer rate</span></label><input id="rv-touchBaseRate" type="range" min="2" max="12" step="0.1"><div class="val" id="rv-touchBaseRate-v"></div></div>
          <div class="rv-row"><label for="rv-touchRateFalloff"><span class="rv-name"${tipAttr('touchRateFalloff')}>Rate falloff</span></label><input id="rv-touchRateFalloff" type="range" min="0" max="0.0100" step="0.0001"><div class="val" id="rv-touchRateFalloff-v"></div></div>
          <div class="rv-row"><label for="rv-touchReturn"><span class="rv-name"${tipAttr('touchReturn')}>Return gain</span></label><input id="rv-touchReturn" type="range" min="0" max="6" step="0.1"><div class="val" id="rv-touchReturn-v"></div></div>
          <div class="rv-row"><label for="rv-touchFilter"><span class="rv-name"${tipAttr('touchFilter')}>Filter tau</span></label><input id="rv-touchFilter" type="range" min="0.05" max="0.40" step="0.01"><div class="val" id="rv-touchFilter-v"></div></div>
        </div>
        <div class="rv-row"><label for="rv-mulr"><span class="rv-name"${tipAttr('muLatRoad')}>Grip lat (road)</span></label><input id="rv-mulr" type="range" min="0.8" max="2.2" step="0.05"><div class="val" id="rv-mulr-v"></div></div>
        <div class="rv-row"><label for="rv-muor"><span class="rv-name"${tipAttr('muLongRoad')}>Grip long (road)</span></label><input id="rv-muor" type="range" min="0.6" max="2.2" step="0.05"><div class="val" id="rv-muor-v"></div></div>
        <div class="rv-row"><label for="rv-mulg"><span class="rv-name"${tipAttr('muLatGrass')}>Grip lat (grass)</span></label><input id="rv-mulg" type="range" min="0.3" max="1.0" step="0.02"><div class="val" id="rv-mulg-v"></div></div>
        <div class="rv-row"><label for="rv-muog"><span class="rv-name"${tipAttr('muLongGrass')}>Grip long (grass)</span></label><input id="rv-muog" type="range" min="0.25" max="0.9" step="0.02"><div class="val" id="rv-muog-v"></div></div>
        <div class="rv-row"><label for="rv-drag"><span class="rv-name"${tipAttr('dragK')}>Drag</span></label><input id="rv-drag" type="range" min="0.0001" max="0.0035" step="0.0001"><div class="val" id="rv-drag-v"></div></div>
        <div class="rv-row"><label for="rv-roll"><span class="rv-name"${tipAttr('rollK')}>Rolling</span></label><input id="rv-roll" type="range" min="0.10" max="0.35" step="0.005"><div class="val" id="rv-roll-v"></div></div>
        <div class="rv-row"><label for="rv-rearc"><span class="rv-name"${tipAttr('rearCircle')}>Rear circle</span></label><input id="rv-rearc" type="range" min="0.00" max="1.00" step="0.05"><div class="val" id="rv-rearc-v"></div></div>
        <div class="rv-row"><label for="rv-frontc"><span class="rv-name"${tipAttr('frontCircle')}>Front circle</span></label><input id="rv-frontc" type="range" min="0.00" max="1.00" step="0.05"><div class="val" id="rv-frontc-v"></div></div>
        <div class="rv-row"><label for="rv-brkfs"><span class="rv-name"${tipAttr('brakeFrontShare')}>Brake F share</span></label><input id="rv-brkfs" type="range" min="0.30" max="0.80" step="0.02"><div class="val" id="rv-brkfs-v"></div></div>
        <div class="rv-row"><label for="rv-lspe"><span class="rv-name"${tipAttr('longSlipPeak')}>Long slip peak</span></label><input id="rv-lspe" type="range" min="0.08" max="0.30" step="0.01"><div class="val" id="rv-lspe-v"></div></div>
        <div class="rv-row"><label for="rv-lsfo"><span class="rv-name"${tipAttr('longSlipFalloff')}>Long falloff</span></label><input id="rv-lsfo" type="range" min="0.40" max="1.00" step="0.01"><div class="val" id="rv-lsfo-v"></div></div>
        <div class="rv-row"><label for="rv-llat"><span class="rv-name"${tipAttr('loadSenseK')}>Lat load K</span></label><input id="rv-llat" type="range" min="0.00" max="0.20" step="0.01"><div class="val" id="rv-llat-v"></div></div>
        <div class="rv-row"><label for="rv-llong"><span class="rv-name"${tipAttr('muLongLoadSenseK')}>Long load K</span></label><input id="rv-llong" type="range" min="0.00" max="0.20" step="0.01"><div class="val" id="rv-llong-v"></div></div>
        <div class="rv-row"><label for="rv-df"><span class="rv-name"${tipAttr('downforceK')}>DownforceK</span></label><input id="rv-df" type="range" min="0.0000" max="0.0050" step="0.00005"><div class="val" id="rv-df-v"></div></div>
        <div class="rv-row"><label for="rv-cgh"><span class="rv-name"${tipAttr('cgHeight')}>cgHeight</span></label><input id="rv-cgh" type="range" min="0" max="14" step="1"><div class="val" id="rv-cgh-v"></div></div>
        <div class="rv-row"><label for="rv-yawd"><span class="rv-name"${tipAttr('yawDampK')}>Yaw damp</span></label><input id="rv-yawd" type="range" min="0" max="0.30" step="0.02"><div class="val" id="rv-yawd-v"></div></div>
        <div class="rv-section legacy">
          <h4>Legacy</h4>
          <div class="rv-row" data-no-ai-clone><label for="rv-vkine"><span class="rv-name"${tipAttr('vKineBlend')}>vKineBlend</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-vkine" type="range" min="0.0" max="5.0" step="0.1"><div class="val" id="rv-vkine-v"></div></div>
          <div class="rv-row" data-no-ai-clone>
            <label for="rv-vxhyst" title="Hysteresis band around 0 px/s before direction flips">VX hysteresis<span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label>
            <input id="rv-vxhyst" type="range" min="6" max="40" step="1"><div class="val" id="rv-vxhyst-v"></div>
          </div>
          <div class="rv-row" data-no-ai-clone>
            <label for="rv-rsteer" title="Steering scale when reversing (lower = calmer)">Reverse steer<span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label>
            <input id="rv-rsteer" type="range" min="0.30" max="1.00" step="0.01"><div class="val" id="rv-rsteer-v"></div>
          </div>
          <div class="rv-row" data-no-ai-clone>
            <label for="rv-yawmul" title="Yaw damping multiplier when reversing">Yaw reverse×<span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label>
            <input id="rv-yawmul" type="range" min="1.00" max="2.00" step="0.05"><div class="val" id="rv-yawmul-v"></div>
          </div>
          <div class="rv-row"><label for="rv-reventry"><span class="rv-name"${tipAttr('reverseEntry')}>Reverse entry</span></label><input id="rv-reventry" type="range" min="0" max="120" step="5"><div class="val" id="rv-reventry-v"></div></div>
          <div class="rv-row"><label for="rv-revtorque"><span class="rv-name"${tipAttr('reverseTorque')}>Reverse torque</span></label><input id="rv-revtorque" type="range" min="0.30" max="1.00" step="0.05"><div class="val" id="rv-revtorque-v"></div></div>
        </div>
        <div class="rv-row"><button id="rv-reset"${tipAttr('resetDefaults')}>Reset defaults</button></div>
      </div>`;
    document.body.appendChild(wrap);

    const panel = wrap.querySelector('.rv-panel');
    const toggle = wrap.querySelector('.toggle');
    toggle.addEventListener('click', () => { panel.classList.toggle('open'); });

    const els = {
      kind: wrap.querySelector('#rv-kind'),
      applyAI: wrap.querySelector('#rv-apply-ai'),
      clonePhysics: wrap.querySelector('#rv-clone-physics'),
      debug: wrap.querySelector('#rv-debug'),
      checkpoints: wrap.querySelector('#rv-checkpoints'),
      planck: wrap.querySelector('#rv-planck'),
      ppm: wrap.querySelector('#rv-ppm'),
      gravity: wrap.querySelector('#rv-gravity'), gravityV: wrap.querySelector('#rv-gravity-v'),
      ldamp: wrap.querySelector('#rv-ldamp'), ldampV: wrap.querySelector('#rv-ldamp-v'),
      adamp: wrap.querySelector('#rv-adamp'), adampV: wrap.querySelector('#rv-adamp-v'),
      rest: wrap.querySelector('#rv-rest'), restV: wrap.querySelector('#rv-rest-v'),
      veliters: wrap.querySelector('#rv-veliters'),
      positers: wrap.querySelector('#rv-positers'),
      mass: wrap.querySelector('#rv-mass'), massV: wrap.querySelector('#rv-mass-v'),
      eng: wrap.querySelector('#rv-eng'), engV: wrap.querySelector('#rv-eng-v'),
      brk: wrap.querySelector('#rv-brk'), brkV: wrap.querySelector('#rv-brk-v'),
      steer: wrap.querySelector('#rv-steer'), steerV: wrap.querySelector('#rv-steer-v'),
      steers: wrap.querySelector('#rv-steers'), steersV: wrap.querySelector('#rv-steers-v'),
      steerMode: wrap.querySelector('#rv-steerMode'),
      touchMaxLow: wrap.querySelector('#rv-touchMaxLow'), touchMaxLowV: wrap.querySelector('#rv-touchMaxLow-v'),
      touchMaxHigh: wrap.querySelector('#rv-touchMaxHigh'), touchMaxHighV: wrap.querySelector('#rv-touchMaxHigh-v'),
      touchFalloff: wrap.querySelector('#rv-touchFalloff'), touchFalloffV: wrap.querySelector('#rv-touchFalloff-v'),
      touchBaseRate: wrap.querySelector('#rv-touchBaseRate'), touchBaseRateV: wrap.querySelector('#rv-touchBaseRate-v'),
      touchRateFalloff: wrap.querySelector('#rv-touchRateFalloff'), touchRateFalloffV: wrap.querySelector('#rv-touchRateFalloff-v'),
      touchReturn: wrap.querySelector('#rv-touchReturn'), touchReturnV: wrap.querySelector('#rv-touchReturn-v'),
      touchFilter: wrap.querySelector('#rv-touchFilter'), touchFilterV: wrap.querySelector('#rv-touchFilter-v'),
      mulr: wrap.querySelector('#rv-mulr'), mulrV: wrap.querySelector('#rv-mulr-v'),
      muor: wrap.querySelector('#rv-muor'), muorV: wrap.querySelector('#rv-muor-v'),
      mulg: wrap.querySelector('#rv-mulg'), mulgV: wrap.querySelector('#rv-mulg-v'),
      muog: wrap.querySelector('#rv-muog'), muogV: wrap.querySelector('#rv-muog-v'),
      drag: wrap.querySelector('#rv-drag'), dragV: wrap.querySelector('#rv-drag-v'),
      roll: wrap.querySelector('#rv-roll'), rollV: wrap.querySelector('#rv-roll-v'),
      rearc: wrap.querySelector('#rv-rearc'), rearcV: wrap.querySelector('#rv-rearc-v'),
      frontc: wrap.querySelector('#rv-frontc'), frontcV: wrap.querySelector('#rv-frontc-v'),
      brkfs: wrap.querySelector('#rv-brkfs'), brkfsV: wrap.querySelector('#rv-brkfs-v'),
      lspe: wrap.querySelector('#rv-lspe'), lspeV: wrap.querySelector('#rv-lspe-v'),
      lsfo: wrap.querySelector('#rv-lsfo'), lsfoV: wrap.querySelector('#rv-lsfo-v'),
      llat: wrap.querySelector('#rv-llat'), llatV: wrap.querySelector('#rv-llat-v'),
      llong: wrap.querySelector('#rv-llong'), llongV: wrap.querySelector('#rv-llong-v'),
      df: wrap.querySelector('#rv-df'), dfV: wrap.querySelector('#rv-df-v'),
      vkine: wrap.querySelector('#rv-vkine'), vkineV: wrap.querySelector('#rv-vkine-v'),
      cgh: wrap.querySelector('#rv-cgh'), cghV: wrap.querySelector('#rv-cgh-v'),
      yawd: wrap.querySelector('#rv-yawd'), yawdV: wrap.querySelector('#rv-yawd-v'),
      reventry: wrap.querySelector('#rv-reventry'), reventryV: wrap.querySelector('#rv-reventry-v'),
      revtorque: wrap.querySelector('#rv-revtorque'), revtorqueV: wrap.querySelector('#rv-revtorque-v'),
      planckRebuild: wrap.querySelector('#rv-planck-rebuild'),
      reset: wrap.querySelector('#rv-reset'),
      curbwall: wrap.querySelector('#rv-curbwall')
    };
    const variantDeltaEls = installVariantDeltaReadouts(wrap, DEVTOOLS_VARIANT_CONTROL_PROPS);

    const vxh = document.getElementById('rv-vxhyst');
    const rsteer = document.getElementById('rv-rsteer');
    const yawm = document.getElementById('rv-yawmul');
    const vxhv = document.getElementById('rv-vxhyst-v');
    const rsteerv = document.getElementById('rv-rsteer-v');
    const yawmv = document.getElementById('rv-yawmul-v');

    const syncReverseUI = () => {
      if (!vxh || !rsteer || !yawm) return;
      vxh.value = REVERSE_CFG.vxHyst;
      rsteer.value = REVERSE_CFG.steerScale;
      yawm.value = REVERSE_CFG.yawMul;
      if (vxhv) vxhv.textContent = String(REVERSE_CFG.vxHyst);
      if (rsteerv) rsteerv.textContent = REVERSE_CFG.steerScale.toFixed(2);
      if (yawmv) yawmv.textContent = REVERSE_CFG.yawMul.toFixed(2);
    };


    const onReverseInput = () => {
      if (!vxh || !rsteer || !yawm) return;
      REVERSE_CFG.vxHyst = Math.round(Number(vxh.value));
      REVERSE_CFG.steerScale = Math.max(0.3, Math.min(1.0, Number(rsteer.value)));
      REVERSE_CFG.yawMul = Math.max(1.0, Math.min(2.0, Number(yawm.value)));
      saveReverseCfg();
      syncReverseUI();
    };
    if (vxh) vxh.addEventListener('input', onReverseInput);
    if (rsteer) rsteer.addEventListener('input', onReverseInput);
    if (yawm) yawm.addEventListener('input', onReverseInput);
    if (toggle) toggle.addEventListener('click', syncReverseUI);
    const fmtInt = (v) => String(Math.round(Number(v)));
    const fmtTwo = (v) => (+v).toFixed(2);
    const fmtOne = (v) => (+v).toFixed(1);
    const fmtFour = (v) => (+v).toFixed(4);
    const fmtFive = (v) => (+v).toFixed(5);

    const controlHandlers = {};
    const CONTROL_META = {};
    const STEERING_MODES = new Set(['manual', 'touch', 'analogue']);
    const getStoredSteeringMode = () => {
      try {
        const stored = (typeof localStorage !== 'undefined') ? localStorage.getItem('steeringMode') : null;
        if (stored === 'smooth') return 'analogue';
        return STEERING_MODES.has(stored) ? stored : 'touch';
      } catch (_) {
        return 'touch';
      }
    };
    const applySteeringModeSelection = (mode, carSet) => {
      const chosen = STEERING_MODES.has(mode) ? mode : 'touch';
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem('steeringMode', chosen);
      } catch (_) {/* ignore */ }
      let set = carSet;
      if (!set && typeof getCars === 'function') {
        set = getCars() || {};
      }
      if (set) {
        const player = set.player;
        if (player) {
          player.steeringMode = chosen;
          if (player.physics) player.physics.steeringMode = chosen;
        }
      }
    };

    function attachControlButtons(input, id) {
      if (!input) return;
      const row = input.closest('.rv-row');
      if (!row) return;
      if (row.querySelector(`.rv-btns[data-for="${id}"]`)) return;
      const btns = document.createElement('div');
      btns.className = 'rv-btns';
      btns.dataset.for = id;
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'rv-mini';
      saveBtn.textContent = 'Save';
      const defaultBtn = document.createElement('button');
      defaultBtn.type = 'button';
      defaultBtn.className = 'rv-mini';
      defaultBtn.textContent = 'Default';
      btns.append(saveBtn, defaultBtn);
      row.appendChild(btns);
      saveBtn.addEventListener('click', () => handleSave(id));
      defaultBtn.addEventListener('click', () => handleDefault(id));
    }

    function handleSave(id) {
      const handler = controlHandlers[id];
      if (!handler) return;
      const meta = CONTROL_META[id] || {};
      const value = handler.get();
      if (meta.skipStorage) {
        if (typeof meta.onSave === 'function') meta.onSave(value);
        return;
      }
      DEVTOOLS_SAVED[id] = value;
      saveDevtoolsSaved();
      if (typeof meta.onSave === 'function') meta.onSave(value);
    }

    function handleDefault(id) {
      const handler = controlHandlers[id];
      if (!handler) return;
      const meta = CONTROL_META[id] || {};
      if (meta.skipStorage) {
        if (typeof meta.getDefault === 'function') {
          const val = meta.getDefault();
          if (val != null) handler.set(val);
        }
        if (typeof meta.onDefault === 'function') meta.onDefault(handler.get());
        return;
      }
      const kind = els.kind.value;
      const defaultVal = typeof handler.getDefault === 'function' ? handler.getDefault(kind) : undefined;
      if (defaultVal == null) return;
      handler.set(defaultVal);
      delete DEVTOOLS_SAVED[id];
      saveDevtoolsSaved();
      if (typeof meta.onDefault === 'function') meta.onDefault(defaultVal);
      if (typeof handler.applyChange === 'function') handler.applyChange();
    }

    function registerControl(id, meta) {
      const input = document.getElementById(id);
      if (!input) return;
      CONTROL_META[id] = meta || {};
      const effectiveMeta = CONTROL_META[id];
      const valueEl = effectiveMeta.valueEl || document.getElementById(`${id}-v`);
      const type = effectiveMeta.type || input.type || 'range';
      const parser = effectiveMeta.parse || ((value) => Number(value));
      const formatter = effectiveMeta.format || ((value) => {
        if (type === 'checkbox') return value ? 'On' : 'Off';
        if (typeof value === 'number') {
          if (Number.isInteger(value)) return String(value);
          return value.toFixed(2);
        }
        return String(value);
      });
      controlHandlers[id] = {
        get: () => {
          if (type === 'checkbox') return !!input.checked;
          if (type === 'number' || type === 'range') return parser(input.value);
          return input.value;
        },
        set: (value) => {
          if (type === 'checkbox') {
            input.checked = !!value;
          } else {
            ensureRangeRepresents(input, value);
            input.value = `${value}`;
          }
          if (valueEl) valueEl.textContent = type === 'range' ? input.value : formatter(value);
          if (typeof effectiveMeta.afterSet === 'function') effectiveMeta.afterSet(value);
        },
        getDefault: effectiveMeta.getDefault,
        applyChange: effectiveMeta.apply === false
          ? (typeof effectiveMeta.onApply === 'function' ? effectiveMeta.onApply : undefined)
          : (() => apply())
      };
      attachControlButtons(input, id);
    }

    function applySavedControlValues() {
      for (const [id, handler] of Object.entries(controlHandlers)) {
        const meta = CONTROL_META[id] || {};
        if (meta.skipStorage) continue;
        if (!Object.prototype.hasOwnProperty.call(DEVTOOLS_SAVED, id)) continue;
        handler.set(DEVTOOLS_SAVED[id]);
      }
    }

    const vehicleDefault = (prop, fallback) => (kind) => {
      const defaults = defaultSnapshot[kind] || {};
      let val = defaults[prop];
      if ((val === undefined || val === null) && fallback !== undefined) {
        val = typeof fallback === 'function' ? fallback(defaults) : fallback;
      }
      return val;
    };
    const vehicleTouchDefault = (prop, fallback) => (kind) => {
      const defaults = defaultSnapshot[kind] || {};
      const touch = defaults.touchSteer || {};
      let val = touch[prop];
      if ((val === undefined || val === null) && fallback !== undefined) {
        val = typeof fallback === 'function' ? fallback(defaults, touch) : fallback;
      }
      return val;
    };

    const CONTROL_SETUP = [
      ['rv-debug', { kind: 'global', type: 'checkbox', getDefault: () => false, apply: false, afterSet: () => setDebugEnabled(!!els.debug.checked) }],
      ['rv-checkpoints', { kind: 'global', type: 'checkbox', getDefault: () => false, apply: false, afterSet: () => setCheckpointsEnabled(!!els.checkpoints.checked) }],
      ['rv-planck', {
        kind: 'vehicle', type: 'checkbox', getDefault: (kind) => {
          const defaults = defaultSnapshot[kind] || {};
          return defaults.usePlanck !== false;
        }
      }],
      ['rv-apply-ai', { kind: 'global', type: 'checkbox', getDefault: () => false, apply: false }],
      ['rv-clone-physics', { kind: 'global', type: 'checkbox', getDefault: () => true, apply: false, afterSet: () => applyClonePhysicsToAI() }],

      ['rv-ppm', {
        kind: 'vehicle', type: 'number', format: fmtInt, getDefault: (kind) => {
          const defaults = defaultSnapshot[kind] || {};
          return defaults.pixelsPerMeter != null ? defaults.pixelsPerMeter : PLANCK_DEFAULTS.pixelsPerMeter;
        }
      }],
      ['rv-gravity', { kind: 'global', valueEl: els.gravityV, format: fmtInt, getDefault: () => GRAVITY_DEFAULT }],
      ['rv-ldamp', { kind: 'vehicle', valueEl: els.ldampV, format: fmtTwo, getDefault: vehicleDefault('linearDamp', 0) }],
      ['rv-adamp', { kind: 'vehicle', valueEl: els.adampV, format: fmtTwo, getDefault: vehicleDefault('angularDamp', 0) }],
      ['rv-rest', { kind: 'vehicle', valueEl: els.restV, format: fmtTwo, getDefault: vehicleDefault('restitution', 0) }],
      ['rv-veliters', { kind: 'vehicle', type: 'number', parse: (v) => parseInt(v, 10) || 0, format: fmtInt, getDefault: vehicleDefault('velIters', PLANCK_DEFAULTS.velIters) }],
      ['rv-positers', { kind: 'vehicle', type: 'number', parse: (v) => parseInt(v, 10) || 0, format: fmtInt, getDefault: vehicleDefault('posIters', PLANCK_DEFAULTS.posIters) }],
      ['rv-mass', { kind: 'vehicle', valueEl: els.massV, format: fmtTwo, getDefault: vehicleDefault('mass') }],
      ['rv-eng', { kind: 'vehicle', valueEl: els.engV, format: fmtTwo, getDefault: vehicleDefault('enginePowerMult', 1) }],
      ['rv-brk', { kind: 'vehicle', valueEl: els.brkV, format: fmtInt, getDefault: vehicleDefault('brakeForce') }],
      ['rv-steer', { kind: 'vehicle', valueEl: els.steerV, format: fmtTwo, getDefault: vehicleDefault('maxSteer') }],
      ['rv-steers', { kind: 'vehicle', valueEl: els.steersV, format: fmtOne, getDefault: vehicleDefault('steerSpeed') }],
      ['rv-steerMode', { kind: 'global', type: 'select', getDefault: getStoredSteeringMode, format: (value) => value === 'manual' ? 'Manual' : (value === 'analogue' ? 'Analogue' : 'Touch'), afterSet: (value) => applySteeringModeSelection(value) }],
      ['rv-touchMaxLow', { kind: 'vehicle', valueEl: els.touchMaxLowV, format: fmtTwo, getDefault: vehicleTouchDefault('maxSteerLowSpeed', (defaults) => (defaults.maxSteer != null ? defaults.maxSteer : 0.60)) }],
      ['rv-touchMaxHigh', {
        kind: 'vehicle', valueEl: els.touchMaxHighV, format: fmtTwo, getDefault: vehicleTouchDefault('maxSteerHighSpeed', (defaults) => {
          const base = defaults.maxSteer != null ? defaults.maxSteer : 0.50;
          return base * 0.6;
        })
      }],
      ['rv-touchFalloff', { kind: 'vehicle', valueEl: els.touchFalloffV, format: fmtInt, getDefault: vehicleTouchDefault('falloffSpeed', 260) }],
      ['rv-touchBaseRate', { kind: 'vehicle', valueEl: els.touchBaseRateV, format: fmtOne, getDefault: vehicleTouchDefault('baseSteerRate', (defaults) => (defaults.steerSpeed != null ? defaults.steerSpeed : 5)) }],
      ['rv-touchRateFalloff', { kind: 'vehicle', valueEl: els.touchRateFalloffV, format: fmtFour, getDefault: vehicleTouchDefault('steerRateFalloff', 0.0035) }],
      ['rv-touchReturn', { kind: 'vehicle', valueEl: els.touchReturnV, format: fmtOne, getDefault: vehicleTouchDefault('returnGain', 0) }],
      ['rv-touchFilter', { kind: 'vehicle', valueEl: els.touchFilterV, format: fmtTwo, getDefault: vehicleTouchDefault('filterTau', 0.12) }],
      ['rv-mulr', { kind: 'vehicle', valueEl: els.mulrV, format: fmtTwo, getDefault: vehicleDefault('muLatRoad') }],
      ['rv-muor', { kind: 'vehicle', valueEl: els.muorV, format: fmtTwo, getDefault: vehicleDefault('muLongRoad') }],
      ['rv-mulg', { kind: 'vehicle', valueEl: els.mulgV, format: fmtTwo, getDefault: vehicleDefault('muLatGrass') }],
      ['rv-muog', { kind: 'vehicle', valueEl: els.muogV, format: fmtTwo, getDefault: vehicleDefault('muLongGrass') }],
      ['rv-drag', { kind: 'vehicle', valueEl: els.dragV, format: fmtFour, getDefault: vehicleDefault('dragK') }],
      ['rv-roll', { kind: 'vehicle', valueEl: els.rollV, format: fmtTwo, getDefault: vehicleDefault('rollK') }],
      ['rv-rearc', { kind: 'vehicle', valueEl: els.rearcV, format: fmtTwo, getDefault: vehicleDefault('rearCircle', 0.50) }],
      ['rv-frontc', { kind: 'vehicle', valueEl: els.frontcV, format: fmtTwo, getDefault: vehicleDefault('frontCircle', 0.50) }],
      ['rv-brkfs', { kind: 'vehicle', valueEl: els.brkfsV, format: fmtTwo, getDefault: vehicleDefault('brakeFrontShare', 0.60) }],
      ['rv-lspe', { kind: 'vehicle', valueEl: els.lspeV, format: fmtTwo, getDefault: vehicleDefault('longSlipPeak', 0.18) }],
      ['rv-lsfo', { kind: 'vehicle', valueEl: els.lsfoV, format: fmtTwo, getDefault: vehicleDefault('longSlipFalloff', 0.80) }],
      ['rv-llat', { kind: 'vehicle', valueEl: els.llatV, format: fmtTwo, getDefault: vehicleDefault('loadSenseK', 0.08) }],
      ['rv-llong', { kind: 'vehicle', valueEl: els.llongV, format: fmtTwo, getDefault: vehicleDefault('muLongLoadSenseK', 0.04) }],
      ['rv-df', { kind: 'vehicle', valueEl: els.dfV, format: fmtFive, getDefault: vehicleDefault('downforceK', 0.00025) }],
      ['rv-vkine', { kind: 'vehicle', valueEl: els.vkineV, format: fmtInt, getDefault: vehicleDefault('vKineBlend', 40) }],
      ['rv-cgh', { kind: 'vehicle', valueEl: els.cghV, format: fmtInt, getDefault: vehicleDefault('cgHeight', 8) }],
      ['rv-yawd', { kind: 'vehicle', valueEl: els.yawdV, format: fmtTwo, getDefault: vehicleDefault('yawDampK', 0.12) }],
      ['rv-reventry', { kind: 'vehicle', valueEl: els.reventryV, format: fmtInt, getDefault: vehicleDefault('reverseEntrySpeed', 40) }],
      ['rv-revtorque', { kind: 'vehicle', valueEl: els.revtorqueV, format: fmtTwo, getDefault: vehicleDefault('reverseTorqueScale', 0.60) }],
      ['rv-vxhyst', {
        kind: 'reverse', valueEl: vxhv, format: fmtInt, skipStorage: true, getDefault: () => REVERSE_CFG_DEFAULTS.vxHyst, afterSet: (value) => {
          REVERSE_CFG.vxHyst = Math.round(Number(value));
          saveReverseCfg();
        }, onSave: () => {
          saveReverseCfg();
        }
      }],
      ['rv-rsteer', {
        kind: 'reverse', valueEl: rsteerv, format: fmtTwo, skipStorage: true, getDefault: () => REVERSE_CFG_DEFAULTS.steerScale, afterSet: (value) => {
          REVERSE_CFG.steerScale = Math.max(0.3, Math.min(1.0, Number(value)));
          saveReverseCfg();
        }, onSave: () => {
          saveReverseCfg();
        }
      }],
      ['rv-yawmul', {
        kind: 'reverse', valueEl: yawmv, format: fmtTwo, skipStorage: true, getDefault: () => REVERSE_CFG_DEFAULTS.yawMul, afterSet: (value) => {
          REVERSE_CFG.yawMul = Math.max(1.0, Math.min(2.0, Number(value)));
          saveReverseCfg();
        }, onSave: () => {
          saveReverseCfg();
        }
      }]
    ];
    CONTROL_SETUP.forEach(([id, meta]) => registerControl(id, meta));
    const steerModeHandler = controlHandlers['rv-steerMode'];
    if (steerModeHandler && !Object.prototype.hasOwnProperty.call(DEVTOOLS_SAVED, 'rv-steerMode')) {
      els.steerMode.value = getStoredSteeringMode();
    }

    const presetChooser = wrap.querySelector('.rv-preset-chooser');
    const presetSaveBtn = document.getElementById('rv-preset-save');
    const presetLoadBtn = document.getElementById('rv-preset-load');
    const presetMenu = document.getElementById('rv-preset-menu');

    const closePresetMenu = () => { if (presetMenu) presetMenu.classList.remove('open'); };
    const gatherControlValues = () => {
      const values = {};
      for (const [id, handler] of Object.entries(controlHandlers)) {
        values[id] = handler.get();
      }
      return values;
    };

    let refreshPresetMenu;
    const applyPresetData = async (preset) => {
      if (!preset) return;
      closePresetMenu();
      const { name, kind, values, reverse, savedValues } = preset;
      if (kind) {
        els.kind.value = kind;
      }
      refresh(els.kind.value);
      DEVTOOLS_SAVED = savedValues ? { ...savedValues } : {};
      saveDevtoolsSaved();
      applySavedControlValues();
      if (values) {
        for (const [id, handler] of Object.entries(controlHandlers)) {
          if (Object.prototype.hasOwnProperty.call(values, id)) {
            handler.set(values[id]);
          }
        }
      }
      if (reverse) {
        REVERSE_CFG = { ...REVERSE_CFG, ...reverse };
        saveReverseCfg();
        syncReverseUI();
      } else {
        syncReverseUI();
      }
      if (name) {
        const existing = DEVTOOLS_PRESETS[name] || {};
        DEVTOOLS_PRESETS[name] = { ...existing, ...preset, updatedAt: preset.updatedAt ?? existing.updatedAt ?? Date.now() };
      }
      apply();
      if (refreshPresetMenu) await refreshPresetMenu();
    };

    refreshPresetMenu = async () => {
      if (!presetMenu) return;
      presetMenu.innerHTML = '';
      await loadDevtoolsPresets();
      const entries = Object.values(DEVTOOLS_PRESETS);
      entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'rv-empty';
        empty.textContent = 'No presets saved.';
        presetMenu.appendChild(empty);
        return;
      }
      for (const entry of entries) {
        if (!entry || !entry.name) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = entry.name;
        btn.addEventListener('click', () => {
          applyPresetData(entry);
        });
        presetMenu.appendChild(btn);
      }
    };

    await refreshPresetMenu();

    if (presetSaveBtn) {
      presetSaveBtn.addEventListener('click', async () => {
        const name = (window.prompt('Enter a name for this preset:') || '').trim();
        if (!name) return;
        if (DEVTOOLS_PRESETS[name] && !window.confirm(`Preset "${name}" exists. Overwrite?`)) return;
        const presetData = {
          name,
          kind: els.kind.value,
          values: gatherControlValues(),
          reverse: { ...REVERSE_CFG },
          savedValues: { ...DEVTOOLS_SAVED }
        };
        try {
          const savedEntry = await savePresetRecord({ ...presetData });
          DEVTOOLS_PRESETS[name] = savedEntry;
          await refreshPresetMenu();
          closePresetMenu();
        } catch (err) {
          console.error('[DevTools] Unable to save preset', err);
          window.alert('Failed to save preset. See console for details.');
        }
      });
    }

    if (presetLoadBtn && presetMenu) {
      presetLoadBtn.addEventListener('click', async () => {
        if (presetMenu.classList.contains('open')) {
          closePresetMenu();
        } else {
          await refreshPresetMenu();
          presetMenu.classList.add('open');
        }
      });
      document.addEventListener('click', (evt) => {
        if (!presetMenu.classList.contains('open')) return;
        if (!presetChooser || !presetChooser.contains(evt.target)) closePresetMenu();
      });
      document.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape') closePresetMenu();
      });
    }

    function refresh(kind) {
      const k = kind || els.kind.value;
      const d = VEHICLE_DEFAULTS[k];
      if (els.gravity) {
        const gv = Math.round(g);
        els.gravity.value = gv;
        if (els.gravityV) els.gravityV.textContent = els.gravity.value;
      }
      els.planck.checked = !!(d.usePlanck !== false);
      if (els.ppm) els.ppm.value = (d.pixelsPerMeter != null ? d.pixelsPerMeter : PPM_DEFAULT);
      const ld = d.linearDamp != null ? d.linearDamp : 0;
      els.ldamp.value = ld;
      els.ldampV.textContent = els.ldamp.value;
      const ad = d.angularDamp != null ? d.angularDamp : 0;
      els.adamp.value = ad;
      els.adampV.textContent = els.adamp.value;
      const rest = d.restitution != null ? d.restitution : 0;
      els.rest.value = rest;
      els.restV.textContent = els.rest.value;
      els.veliters.value = (d.velIters != null ? d.velIters : PLANCK_DEFAULTS.velIters);
      els.positers.value = (d.posIters != null ? d.posIters : PLANCK_DEFAULTS.posIters);
      els.mass.value = d.mass; els.massV.textContent = els.mass.value;
      const powerMult = (d.enginePowerMult != null ? d.enginePowerMult : 1);
      els.eng.value = powerMult;
      els.engV.textContent = els.eng.value;
      els.brk.value = d.brakeForce; els.brkV.textContent = els.brk.value;
      els.steer.value = d.maxSteer; els.steerV.textContent = els.steer.value;
      els.steers.value = d.steerSpeed; els.steersV.textContent = els.steers.value;
      if (els.steerMode) {
        els.steerMode.value = getStoredSteeringMode();
      }
      const ts = d.touchSteer || {};
      if (els.touchMaxLow) {
        const val = ts.maxSteerLowSpeed != null ? ts.maxSteerLowSpeed : (d.maxSteer != null ? d.maxSteer : 0.60);
        els.touchMaxLow.value = val;
        if (els.touchMaxLowV) els.touchMaxLowV.textContent = els.touchMaxLow.value;
      }
      if (els.touchMaxHigh) {
        const base = d.maxSteer != null ? d.maxSteer : 0.50;
        const val = ts.maxSteerHighSpeed != null ? ts.maxSteerHighSpeed : base * 0.6;
        els.touchMaxHigh.value = val;
        if (els.touchMaxHighV) els.touchMaxHighV.textContent = els.touchMaxHigh.value;
      }
      if (els.touchFalloff) {
        const val = ts.falloffSpeed != null ? ts.falloffSpeed : 260;
        els.touchFalloff.value = val;
        if (els.touchFalloffV) els.touchFalloffV.textContent = els.touchFalloff.value;
      }
      if (els.touchBaseRate) {
        const val = ts.baseSteerRate != null ? ts.baseSteerRate : (d.steerSpeed != null ? d.steerSpeed : 5);
        els.touchBaseRate.value = val;
        if (els.touchBaseRateV) els.touchBaseRateV.textContent = els.touchBaseRate.value;
      }
      if (els.touchRateFalloff) {
        const val = ts.steerRateFalloff != null ? ts.steerRateFalloff : 0.0035;
        els.touchRateFalloff.value = val;
        if (els.touchRateFalloffV) els.touchRateFalloffV.textContent = els.touchRateFalloff.value;
      }
      if (els.touchReturn) {
        const val = ts.returnGain != null ? ts.returnGain : 0;
        els.touchReturn.value = val;
        if (els.touchReturnV) els.touchReturnV.textContent = els.touchReturn.value;
      }
      if (els.touchFilter) {
        const val = ts.filterTau != null ? ts.filterTau : 0.12;
        els.touchFilter.value = val;
        if (els.touchFilterV) els.touchFilterV.textContent = els.touchFilter.value;
      }
      els.mulr.value = d.muLatRoad; els.mulrV.textContent = els.mulr.value;
      els.muor.value = d.muLongRoad; els.muorV.textContent = els.muor.value;
      els.mulg.value = d.muLatGrass; els.mulgV.textContent = els.mulg.value;
      els.muog.value = d.muLongGrass; els.muogV.textContent = els.muog.value;
      els.drag.value = d.dragK; els.dragV.textContent = els.drag.value;
      els.roll.value = d.rollK; els.rollV.textContent = els.roll.value;
      els.rearc.value = (d.rearCircle != null ? d.rearCircle : 0.50); els.rearcV.textContent = els.rearc.value;
      els.frontc.value = (d.frontCircle != null ? d.frontCircle : 0.50); els.frontcV.textContent = els.frontc.value;
      els.brkfs.value = (d.brakeFrontShare != null ? d.brakeFrontShare : 0.60); els.brkfsV.textContent = els.brkfs.value;
      els.lspe.value = (d.longSlipPeak != null ? d.longSlipPeak : 0.18); els.lspeV.textContent = els.lspe.value;
      els.lsfo.value = (d.longSlipFalloff != null ? d.longSlipFalloff : 0.80); els.lsfoV.textContent = els.lsfo.value;
      els.llat.value = (d.loadSenseK != null ? d.loadSenseK : 0.08); els.llatV.textContent = els.llat.value;
      els.llong.value = (d.muLongLoadSenseK != null ? d.muLongLoadSenseK : 0.04); els.llongV.textContent = els.llong.value;
      els.df.value = (d.downforceK != null ? d.downforceK : 0.00025); els.dfV.textContent = els.df.value;
      els.vkine.value = (d.vKineBlend != null ? d.vKineBlend : 40); els.vkineV.textContent = els.vkine.value;
      els.cgh.value = (d.cgHeight != null ? d.cgHeight : 8); els.cghV.textContent = els.cgh.value;
      els.yawd.value = (d.yawDampK != null ? d.yawDampK : 0.12); els.yawdV.textContent = els.yawd.value;
      els.reventry.value = (d.reverseEntrySpeed != null ? d.reverseEntrySpeed : 40); els.reventryV.textContent = els.reventry.value;
      els.revtorque.value = (d.reverseTorqueScale != null ? d.reverseTorqueScale : 0.60); els.revtorqueV.textContent = els.revtorque.value;
      const variantCar = findVariantReferenceCar(k, getCarSet);
      updateVariantDeltaReadouts(
        variantDeltaEls,
        DEVTOOLS_VARIANT_CONTROL_PROPS,
        k,
        variantCar && variantCar.vehicleVariant,
      );
    }
    // Preserve authored defaults and explicit presets; HTML range inputs otherwise
    // silently clamp out-of-range values and snap off-step values.
    function ensureRangeRepresents(input, value) {
      if (!input || input.type !== 'range') return;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      input.step = 'any';
      if (input.min !== '' && numeric < Number(input.min)) input.min = String(numeric);
      if (input.max !== '' && numeric > Number(input.max)) input.max = String(numeric);
    }
    // Expand controls to represent *every* vehicle's authored defaults, including
    // fractional mass, downforce, roll, CG height and steering parameters.
    for (const [id, meta] of CONTROL_SETUP) {
      const input = document.getElementById(id);
      if (!input || input.type !== 'range') continue;
      input.step = 'any';
      if (typeof meta.getDefault !== 'function') continue;
      const kinds = meta.kind === 'vehicle' ? Object.keys(defaultSnapshot) : [els.kind.value];
      for (const kind of kinds) ensureRangeRepresents(input, meta.getDefault(kind));
    }
    refresh(els.kind.value);

    function apply() {
      const k = els.kind.value;
      const steeringModeSelection = els.steerMode ? els.steerMode.value : getStoredSteeringMode();
      const carSet = getCarSet();
      const prevVehicle = VEHICLE_DEFAULTS[k] || {};
      const prevTouch = prevVehicle.touchSteer || {};
      const readTouch = (el, fallback) => {
        if (!el) return fallback;
        const num = Number(el.value);
        return Number.isFinite(num) ? num : fallback;
      };
      const parsedPowerMult = Number(els.eng.value);
      const powerMult = Number.isFinite(parsedPowerMult)
        ? parsedPowerMult
        : (prevVehicle.enginePowerMult ?? 1);
      let gravityValue = g;
      if (els.gravity) {
        gravityValue = clamp(+els.gravity.value || GRAVITY_DEFAULT, GRAVITY_MIN, GRAVITY_MAX);
        g = gravityValue;
        els.gravity.value = gravityValue;
        if (els.gravityV) {
          els.gravityV.textContent = String(Math.round(gravityValue));
        }
      }
      const touchSteerCfg = {
        ...prevTouch,
        maxSteerLowSpeed: readTouch(els.touchMaxLow, prevTouch.maxSteerLowSpeed ?? (prevVehicle.maxSteer ?? 0.60)),
        maxSteerHighSpeed: readTouch(els.touchMaxHigh, prevTouch.maxSteerHighSpeed ?? ((prevVehicle.maxSteer ?? 0.50) * 0.6)),
        falloffSpeed: readTouch(els.touchFalloff, prevTouch.falloffSpeed ?? 260),
        baseSteerRate: readTouch(els.touchBaseRate, prevTouch.baseSteerRate ?? (prevVehicle.steerSpeed ?? 5)),
        steerRateFalloff: readTouch(els.touchRateFalloff, prevTouch.steerRateFalloff ?? 0.0035),
        returnGain: readTouch(els.touchReturn, prevTouch.returnGain ?? 0),
        filterTau: readTouch(els.touchFilter, prevTouch.filterTau ?? 0.12)
      };
      const p = VEHICLE_DEFAULTS[k] = {
        ...prevVehicle,
        usePlanck: !!els.planck.checked,
        pixelsPerMeter: Math.max(1, +els.ppm.value || PLANCK_DEFAULTS.pixelsPerMeter),
        linearDamp: +els.ldamp.value,
        angularDamp: +els.adamp.value,
        restitution: +els.rest.value,
        velIters: clamp(+els.veliters.value || PLANCK_DEFAULTS.velIters, 1, 50),
        posIters: clamp(+els.positers.value || PLANCK_DEFAULTS.posIters, 1, 50),
        mass: +els.mass.value,
        enginePowerMult: powerMult,
        brakeForce: +els.brk.value,
        maxSteer: +els.steer.value,
        steerSpeed: +els.steers.value,
        muLatRoad: +els.mulr.value,
        muLongRoad: +els.muor.value,
        muLatGrass: +els.mulg.value,
        muLongGrass: +els.muog.value,
        dragK: +els.drag.value,
        rollK: +els.roll.value,
        rearCircle: +els.rearc.value,
        frontCircle: +els.frontc.value,
        brakeFrontShare: +els.brkfs.value,
        longSlipPeak: +els.lspe.value,
        longSlipFalloff: +els.lsfo.value,
        loadSenseK: +els.llat.value,
        muLongLoadSenseK: +els.llong.value,
        downforceK: +els.df.value,
        vKineBlend: +els.vkine.value,
        cgHeight: +els.cgh.value,
        yawDampK: +els.yawd.value,
        reverseEntrySpeed: +els.reventry.value,
        reverseTorqueScale: +els.revtorque.value,
        touchSteer: { ...touchSteerCfg }
      };
      const cars = carSet || {};
      const selectedKind = normalizeVehicleKind(k);
      const carMatchesSelection = (car) => car && normalizeVehicleKind(car.kind) === selectedKind;
      const applyTo = [];
      if (carMatchesSelection(cars.player)) applyTo.push(cars.player);
      if (els.applyAI.checked && Array.isArray(cars.ai)) {
        for (const car of cars.ai) {
          if (carMatchesSelection(car)) applyTo.push(car);
        }
      }
      applySteeringModeSelection(steeringModeSelection, cars);
      for (const c of applyTo) {
        if (!c) continue;
        const carKind = normalizeVehicleKind(c.kind, selectedKind);
        if (!c.physics) initCar(c, carKind);
        const resolvedParams = resolveVehicleSetup(carKind, c.vehicleVariant).defaults || p;
        c.physics.params = {
          ...c.physics.params,
          ...resolvedParams,
          touchSteer: resolvedParams.touchSteer
            ? { ...resolvedParams.touchSteer }
            : c.physics.params.touchSteer,
        };
        if (c.gearbox instanceof Gearbox) {
          applyVehicleGearboxDefaults(c.gearbox, resolvedParams);
        }
        if (c.physics.planckBody) {
          const body = c.physics.planckBody;
          try {
            body.setLinearDamping(p.linearDamp ?? 0);
            body.setAngularDamping(p.angularDamp ?? 0);
            for (let fix = body.getFixtureList(); fix; fix = fix.getNext()) {
              fix.setFriction(p.contactFriction != null ? p.contactFriction : 0.45);
              fix.setRestitution(p.restitution ?? planckState.restitution);
            }
          } catch (_) {/* ignore */ }
        }
      }
      registerPlanckCars(applyTo);
      if (p.usePlanck && applyTo.length) {
        planckState.ppm = p.pixelsPerMeter;
        planckState.velIters = p.velIters;
        planckState.posIters = p.posIters;
        planckState.restitution = p.restitution;
        planckState.doSleep = p.planckDoSleep != null ? !!p.planckDoSleep : planckState.doSleep;
        planckState.needsWorldBuild = true;
      }
      setDebugEnabled(!!els.debug.checked);
      setCheckpointsEnabled(!!els.checkpoints.checked);
      refresh(k);
      if (els.clonePhysics && els.clonePhysics.checked) {
        applyClonePhysicsToAI();
      }
    }

    // Clone player physics to all AI cars, matching by vehicle type
    // Each AI car gets the physics params from VEHICLE_DEFAULTS for its own kind
    function applyClonePhysicsToAI() {
      if (!els.clonePhysics || !els.clonePhysics.checked) return;
      const carSet = (typeof getCars === 'function') ? (getCars() || {}) : null;
      if (!carSet) return;
      const player = carSet.player;
      const aiCars = carSet.ai;
      if (!player || !Array.isArray(aiCars) || !aiCars.length) return;

      // Get player's vehicle kind and physics
      const playerKind = player.kind || 'GT';
      const playerParams = player.physics && player.physics.params;
      if (!playerParams) return;

      // Apply physics to each AI car based on its vehicle kind
      for (const car of aiCars) {
        if (!car) continue;
        const carKind = car.kind || 'GT';
        const samePlayerVariant =
          carKind === playerKind && (car.vehicleVariant || null) === (player.vehicleVariant || null);
        const sourceParams = samePlayerVariant
          ? { ...playerParams }
          : resolveVehicleSetup(carKind, car.vehicleVariant).defaults;
        if (!sourceParams) continue;

        if (!car.physics) initCar(car, carKind);

        // Always use the resolved setup for accelDurationMult so variants stay intact.
        const vehicleDefaults = sourceParams || {};
        const accelDurMultForKind = vehicleDefaults.accelDurationMult != null
          ? vehicleDefaults.accelDurationMult
          : (sourceParams.accelDurationMult != null ? sourceParams.accelDurationMult : 5.0);

        // Clone the steering capability too; the driver mode remains independent.
        const safeParams = {
          enginePowerMult: sourceParams.enginePowerMult,
          accelDurationMult: accelDurMultForKind,
          brakeForce: sourceParams.brakeForce,
          mass: sourceParams.mass,
          dragK: sourceParams.dragK,
          rollK: sourceParams.rollK,
          muLatRoad: sourceParams.muLatRoad,
          muLongRoad: sourceParams.muLongRoad,
          muLatGrass: sourceParams.muLatGrass,
          muLongGrass: sourceParams.muLongGrass,
          maxSteer: sourceParams.maxSteer,
          touchSteer: sourceParams.touchSteer ? { ...sourceParams.touchSteer } : undefined,
          steerSpeed: sourceParams.steerSpeed,
          downforceK: sourceParams.downforceK,
          rearCircle: sourceParams.rearCircle,
          frontCircle: sourceParams.frontCircle,
          brakeFrontShare: sourceParams.brakeFrontShare,
          longSlipPeak: sourceParams.longSlipPeak,
          longSlipFalloff: sourceParams.longSlipFalloff,
          loadSenseK: sourceParams.loadSenseK,
          muLongLoadSenseK: sourceParams.muLongLoadSenseK,
          cgHeight: sourceParams.cgHeight,
          yawDampK: sourceParams.yawDampK,
          reverseEntrySpeed: sourceParams.reverseEntrySpeed,
          reverseTorqueScale: sourceParams.reverseTorqueScale,
          // Planck params
          linearDamp: sourceParams.linearDamp,
          angularDamp: sourceParams.angularDamp,
          restitution: sourceParams.restitution
        };

        // Merge into car's physics params
        car.physics.params = { ...car.physics.params, ...safeParams };

        // Also sync gearbox power multiplier with accelDurationMult applied
        // Use the vehicle-specific accelDurationMult from VEHICLE_DEFAULTS
        if (car.gearbox instanceof Gearbox && safeParams.enginePowerMult != null) {
          const accelDurMult = accelDurMultForKind;
          const accelDurMultSq = accelDurMult * accelDurMult;
          car.gearbox.c.powerMult = safeParams.enginePowerMult / accelDurMultSq;
        }

        // Update Planck body properties if present
        if (car.physics.planckBody) {
          const body = car.physics.planckBody;
          try {
            body.setLinearDamping(safeParams.linearDamp ?? 0);
            body.setAngularDamping(safeParams.angularDamp ?? 0);
            for (let fix = body.getFixtureList(); fix; fix = fix.getNext()) {
              fix.setRestitution(safeParams.restitution ?? planckState.restitution);
            }
          } catch (_) {/* ignore */ }
        }
      }
    }

    for (const key of ['gravity', 'ldamp', 'adamp', 'rest', 'mass', 'eng', 'brk', 'steer', 'steers', 'touchMaxLow', 'touchMaxHigh', 'touchFalloff', 'touchBaseRate', 'touchRateFalloff', 'touchReturn', 'touchFilter', 'mulr', 'muor', 'mulg', 'muog', 'drag', 'roll', 'rearc', 'frontc', 'brkfs', 'lspe', 'lsfo', 'llat', 'llong', 'df', 'vkine', 'cgh', 'yawd', 'reventry', 'revtorque']) {
      const controlId = `rv-${key}`;
      els[key].addEventListener('input', () => {
        const v = els[key].value;
        const label = key + 'V';
        if (els[label]) {
          els[label].textContent = v;
        }
        apply();
        handleSave(controlId);
      });
    }
    if (els.steerMode) {
      els.steerMode.addEventListener('change', () => {
        apply();
        handleSave('rv-steerMode');
      });
    }
    els.kind.addEventListener('change', () => {
      refresh(els.kind.value);
    });
    if (els.planck) els.planck.addEventListener('change', () => { apply(); handleSave('rv-planck'); });
    if (els.ppm) els.ppm.addEventListener('change', () => { apply(); handleSave('rv-ppm'); });
    if (els.veliters) els.veliters.addEventListener('change', () => { apply(); handleSave('rv-veliters'); });
    if (els.positers) els.positers.addEventListener('change', () => { apply(); handleSave('rv-positers'); });
    if (els.planckRebuild) {
      els.planckRebuild.addEventListener('click', () => {
        apply();
        if (typeof rebuildPlanckWorld === 'function' && getCars) {
          const cset = getCars() || {};
          const list = [];
          if (cset.player) list.push(cset.player);
          if (Array.isArray(cset.ai)) list.push(...cset.ai);
          rebuildPlanckWorld({ cars: list });
        }
      });
    }
    els.reset.addEventListener('click', () => {
      VEHICLE_DEFAULTS[els.kind.value] = JSON.parse(JSON.stringify(defaultSnapshot[els.kind.value]));
      for (const [id, meta] of CONTROL_SETUP) {
        if (meta.kind === 'vehicle') delete DEVTOOLS_SAVED[id];
      }
      saveDevtoolsSaved();
      refresh(els.kind.value);
      apply();
    });
    els.debug.addEventListener('change', () => {
      setDebugEnabled(!!els.debug.checked);
      handleSave('rv-debug');
    });
    els.checkpoints.addEventListener('change', () => {
      setCheckpointsEnabled(!!els.checkpoints.checked);
      handleSave('rv-checkpoints');
    });
    if (els.applyAI) {
      els.applyAI.addEventListener('change', () => {
        handleSave('rv-apply-ai');
      });
    }
    if (els.clonePhysics) {
      els.clonePhysics.addEventListener('change', () => {
        handleSave('rv-clone-physics');
        // Toggle caution icons visibility
        if (els.clonePhysics.checked) {
          panel.classList.add('clone-active');
          applyClonePhysicsToAI();
        } else {
          panel.classList.remove('clone-active');
        }
      });
      // Initialize clone-active class on load if checkbox is already checked
      if (els.clonePhysics.checked) {
        panel.classList.add('clone-active');
      }
    }

    // Opening Dev Tools is read-only. Only explicit user edits or preset loads
    // call apply(); source defaults remain authoritative at race start.
  }

  // Snapshot factory defaults for reset
  const defaultSnapshot = JSON.parse(JSON.stringify(VEHICLE_DEFAULTS));

  const API = {
    initCar,
    updateCar,
    wheelPositions,
    drawDebug,
    setDebugEnabled,
    setCheckpointsEnabled,
    getCheckpointsEnabled,
    injectDevTools,
    injectVehicleTweaker,
    configureTrackCollision,
    configureDecorCollision,
    configureInnerWalls,
    rebuildPlanckWorld,
    registerPlanckCars,
    planckBeginStep,
    planckStep,
    usesPlanckWorld,
    forcePlanckRefresh,
    defaults: VEHICLE_DEFAULTS,
    getVehicleDefaults: (kind, variantId) => {
      const k = kind || 'GT';
      if (!VEHICLE_DEFAULTS[k]) return null;
      return cloneVehicleDefaults(resolveVehicleSetup(k, variantId).defaults);
    },
    getSurfaceAdjustedVehicleDefaults: (kind, surfaceId, variantId, weatherId = 'dry') => {
      const k = kind || 'GT';
      if (!VEHICLE_DEFAULTS[k]) return null;
      const defaults = resolveVehicleSetup(k, variantId).defaults;
      return getSurfaceAdjustedVehicleDefaults(defaults, surfaceId, weatherId);
    },
    // Planning must use the setup actually installed on the car, including
    // live edits, with the same surface/weather adjustment as the force model.
    getSurfaceAdjustedParams: getSurfaceAdjustedVehicleDefaults,
    getTrackSurfaceProfile,
    getTrackSurfaceProfileFromState,
    getWeatherCondition: (weatherId) =>
      WEATHER_CONDITIONS[normalizeWeatherId(weatherId)] || WEATHER_CONDITIONS.dry,
    getCountersteerRecoveryScale: (kind, variantId) => {
      const k = kind || 'GT';
      if (!VEHICLE_DEFAULTS[k]) return 0;
      return getCountersteerRecoveryScale(resolveVehicleSetup(k, variantId).defaults);
    },
    getSurfaceRotationSetup: (kind, surfaceId, variantId, weatherId = 'dry') => {
      const k = kind || 'GT';
      if (!VEHICLE_DEFAULTS[k]) return null;
      return getSurfaceRotationSetup(
        resolveVehicleSetup(k, variantId).defaults,
        getTrackSurfaceProfile(surfaceId, weatherId),
      );
    },
    trackSurfaceProfiles: TRACK_SURFACE_PROFILES,
    weatherConditions: WEATHER_CONDITIONS,
    getVehicleGearboxDefaults,
    sampleDriveForces,
    forceVehicleTweakerRefresh: () => {
      const existing = document.getElementById('rv-vehicle-tweaker');
      if (existing) {
        console.log('[Vehicle Tweaker] Force removing existing panel');
        existing.remove();
      }
      console.log('[Vehicle Tweaker] Panel will be re-injected on next call to injectVehicleTweaker');
      return 'Panel removed. Reload the page to see the updated version.';
    }
  };
  window.RacerPhysics = API;
})();
