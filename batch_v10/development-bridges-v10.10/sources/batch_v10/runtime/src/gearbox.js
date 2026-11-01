// RacerVibes gearbox core: shared pure-JS drivetrain model matching DevTools keys (redlineRpm, tireRadiusM, etc.).
const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
const clamp01 = (value) => clamp(value, 0, 1);
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const numberOr = (value, fallback) => (isFiniteNumber(value) ? value : fallback);
const rpmToFrac = (rpm, redline) => (isFiniteNumber(rpm) && redline > 0 ? clamp(rpm / redline, 0, 1) : undefined);
const resolveShiftFrac = (fraction, derived, fallback) => {
	const source = isFiniteNumber(fraction) ? fraction : derived;
	if (!isFiniteNumber(source)) return fallback;
	return clamp(source, 0, 1);
};

const firstNumber = (a, b, c, d, e) => {
	let num = Number(a);
	if (Number.isFinite(num)) return num;
	num = Number(b);
	if (Number.isFinite(num)) return num;
	num = Number(c);
	if (Number.isFinite(num)) return num;
	num = Number(d);
	if (Number.isFinite(num)) return num;
	num = Number(e);
	return Number.isFinite(num) ? num : undefined;
};

const deriveTorqueIdle = (peak) => {
	if (!Number.isFinite(peak) || peak <= 0) return 120;
	const lower = Math.max(40, peak * 0.35);
	const upper = Math.max(lower, peak * 0.55);
	const candidate = peak - 40;
	return Math.max(lower, Math.min(candidate, upper));
};

const ensureTorqueParams = (state, result = null) => {
	const peak = Math.max(0, firstNumber(state?.torquePeak, state?.torqueCurveParams?.torquePeak, 260) ?? 0);
	const idleCandidate = firstNumber(state?.torqueIdle, state?.torqueCurveParams?.torqueIdle);
	const idle = Math.max(0, Math.min(peak, idleCandidate != null ? idleCandidate : deriveTorqueIdle(peak)));
	const peakRpm = Math.max(1000, firstNumber(state?.torquePeakRpm, state?.torqueCurveParams?.peakRpm, 5000) ?? 5000);
	const redline = Math.max(1000, firstNumber(state?.redlineRpm, state?.torqueCurveParams?.redlineRpm, GEARBOX_CONFIG.redlineRpm) ?? GEARBOX_CONFIG.redlineRpm);
	const engineBrake = Math.max(0, firstNumber(state?.engineBrakePeak, state?.torqueCurveParams?.engineBrakePeak, 0) ?? 0);
	const params = result || {};
	params.torquePeak = peak;
	params.torqueIdle = idle;
	params.peakRpm = peakRpm;
	params.redlineRpm = redline;
	params.engineBrakePeak = engineBrake;
	return params;
};

function freeRevRpmTarget(idle, redline, throttle, throttleDead) {
	const dead = clamp(numberOr(throttleDead, 0.05), 0, 0.95);
	const pedal = clamp01(throttle ?? 0);
	const pedalEff = pedal <= dead ? 0 : (pedal - dead) / Math.max(1e-6, 1 - dead);
	const pedalCurve = Math.pow(pedalEff, 1.25);
	const freeRevMax = Math.max(idle, redline * 0.985);
	return idle + (freeRevMax - idle) * pedalCurve;
}

export const GEARBOX_CONFIG = {
	redlineRpm: 7200,
	upshiftFrac: 0.93,
	downshiftFrac: 0.70,
	downshiftReentryMargin: 0.08,
	shiftCutMs: 90,
	minShiftGapMs: 220,
	effortMargin: 0.03,
	drivelineEff: 0.90,
	tireRadiusM: 0.33,
	finalDrive: 3.90,
	rpmRiseGain: 10.0,
	rpmFallGain: 5.0,
	idleRpm: 900
};

export function rpmFromSpeed(speedMps, gearRatio, finalDrive, tireRadiusM) {
	const radius = Math.max(1e-6, numberOr(tireRadiusM, GEARBOX_CONFIG.tireRadiusM));
	const totalRatio = numberOr(gearRatio, 0) * numberOr(finalDrive, GEARBOX_CONFIG.finalDrive);
	if (!isFiniteNumber(totalRatio) || Math.abs(totalRatio) < 1e-6) return 0;
	const wheelRps = numberOr(speedMps, 0) / (2 * Math.PI * radius);
	return Math.abs(wheelRps * totalRatio * 60);
}

export function torqueCurve(rpm, throttle, params = {}) {
	const rl = Math.max(1000, firstNumber(params.redlineRpm, GEARBOX_CONFIG.redlineRpm) ?? GEARBOX_CONFIG.redlineRpm);
	const peakRpm = Math.max(1000, firstNumber(params.peakRpm, params.torquePeakRpm, 5000) ?? 5000);
	const torquePeak = Math.max(0, firstNumber(params.torquePeak, 260) ?? 0);
	const idleCandidate = firstNumber(params.torqueIdle, params.torqueBase);
	const idleTorque = Math.max(0, Math.min(torquePeak, idleCandidate != null ? idleCandidate : deriveTorqueIdle(torquePeak)));
	const throttleCmd = clamp01(throttle ?? 0);
	const r = clamp(rpm ?? 0, 0, rl);
	let tq;
	if (torquePeak <= 0) {
		tq = 0;
	} else if (r < 1000) {
		const riseTarget = Math.max(idleTorque, torquePeak * 0.6);
		tq = idleTorque + (riseTarget - idleTorque) * (r / 1000);
	} else if (r < peakRpm) {
		const span = Math.max(1, peakRpm - 1000);
		tq = idleTorque + (torquePeak - idleTorque) * ((r - 1000) / span);
	} else {
		const falloffTarget = Math.max(idleTorque, torquePeak * 0.65);
		const span = Math.max(1, rl - peakRpm);
		tq = torquePeak - (torquePeak - falloffTarget) * ((r - peakRpm) / span);
	}
	tq = clamp(tq, 0, torquePeak);
	tq *= throttleCmd;
	const brakePeak = Math.max(0, firstNumber(params.engineBrakePeak, 0) ?? 0);
	if (brakePeak > 0) {
		// Pumping/friction losses rise with engine speed. A constant peak coast
		// torque at idle can overwhelm part throttle and stall a rolling car.
		const brakeTorque = brakePeak * (1 - throttleCmd) * (r / rl);
		tq = Math.max(-brakePeak, tq - brakeTorque);
	}
	return tq;
}

export function wheelForceAt(speedMps, gearRatio, finalDrive, tireRadiusM, rpm, throttle, drivelineEff, powerMult = 1, torqueFn = torqueCurve, torqueParams) {
	const radius = Math.max(1e-6, numberOr(tireRadiusM, GEARBOX_CONFIG.tireRadiusM));
	const fd = numberOr(finalDrive, GEARBOX_CONFIG.finalDrive);
	const ratio = numberOr(gearRatio, 0);
	if (!isFiniteNumber(ratio) || Math.abs(ratio) < 1e-6) return 0;
	const rpmEff = numberOr(rpm, rpmFromSpeed(speedMps, Math.abs(ratio), fd, radius));
	const eff = numberOr(drivelineEff, GEARBOX_CONFIG.drivelineEff);
	const tqRaw = torqueFn(Math.max(0, rpmEff), clamp01(throttle ?? 0), torqueParams);
	const tq = tqRaw * numberOr(powerMult, 1);
	const wheelTorque = tq * ratio * fd * eff;
	return wheelTorque / radius;
}

function sanitizeRatios(list) {
	if (!Array.isArray(list)) return [];
	const ratios = [];
	for (const raw of list) {
		const val = Number(raw);
		if (Number.isFinite(val) && Math.abs(val) > 1e-4) ratios.push(Math.abs(val));
	}
	return ratios;
}

function arraysEqual(a, b) {
	if (a === b) return true;
	if (!Array.isArray(a) || !Array.isArray(b)) return false;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (Math.abs(a[i] - b[i]) > 1e-6) return false;
	}
	return true;
}

let msAccumulator = 0;

function clampGear(gear, state, maxForward) {
	const allowReverse = state && state.enableReverse !== false;
	const minGear = allowReverse ? -1 : 0;
	const maxGear = Math.max(0, Math.round(maxForward || 0));
	const g = Math.round(numberOr(gear, 0));
	return clamp(g, minGear, maxGear);
}

function resolveCurrentRatio(state) {
	if (!state) return 0;
	const ratios = state.gearRatios || [];
	if (!ratios.length) return 0;
	if (state.gear >= 1) {
		const idx = Math.min(ratios.length - 1, state.gear - 1);
		return ratios[idx] || 0;
	}
	if (state.gear === -1) {
		const rev = numberOr(state.reverseRatio, ratios[0] || 0);
		return rev ? -Math.abs(rev) : 0;
	}
	return 0;
}

// Applies min-gap, overrev, and reverse guards before committing a shift.
function attemptShift(state, targetGear, ctx = {}) {
	if (!state) return false;
	const ratios = state.gearRatios || [];
	const gearCount = ratios.length;
	const cfg = ctx.cfg || GEARBOX_CONFIG;
	let next = clampGear(targetGear, state, gearCount);

	const allowNeutral = state.allowNeutral !== false;
	const manual = !!ctx.manual;
	if (next === 0 && state.auto && !manual && !allowNeutral) {
		next = next > state.gear ? clampGear(next + 1, state, gearCount) : clampGear(next - 1, state, gearCount);
	}
	if (next === state.gear) return false;

	const now = ctx.now ?? msAccumulator;
	const minGap = numberOr(state.minShiftGapMs, cfg.minShiftGapMs);
	const since = now - numberOr(state.lastShiftMs, -1e9);
	if (since < minGap) {
		if (ctx.queueOnFail) {
			if (next > state.gear) state.manualShiftUp = true;
			else if (next < state.gear) state.manualShiftDown = true;
		}
		return false;
	}

	const fd = numberOr(ctx.finalDrive, state.finalDrive ?? cfg.finalDrive);
	const tireR = Math.max(1e-6, numberOr(ctx.tireRadiusM, state.tireRadiusM ?? state.wheelRadius ?? cfg.tireRadiusM));
	const redline = numberOr(ctx.redline, state.redlineRpm ?? state.redlineRPM ?? cfg.redlineRpm);
	const idle = numberOr(state.idleRpm ?? state.idleRPM, cfg.idleRpm);
	const speed = Math.max(0, numberOr(ctx.speed, numberOr(state.speedMps, 0)));
	const vForwardMps = numberOr(ctx.vForwardMps, numberOr(state.vForwardMps, 0));
	const movingBackward = vForwardMps < -0.10;

	if (next >= 1 && next < state.gear) {
		const ratio = ratios[next - 1] || 0;
		if (ratio) {
			const rpm = rpmFromSpeed(speed, ratio, fd, tireR);
			if (rpm > redline * 0.995) {
				state.shiftDeniedReason = 'overrev';
				return false;
			}
		}
	}
	if (next === -1 && state.gear !== -1) {
		const revLimit = numberOr(ctx.reverseSpeedLimit, 2.5);
		if (!movingBackward && speed > revLimit) {
			state.shiftDeniedReason = 'reverse-speed';
			return false;
		}
	}

	// Engaging first from neutral at rest is a clutch launch, not an upshift.
	// Keep countdown revs and drive torque continuous while the clutch takes up.
	const standingLaunch = state.gear === 0 && next === 1 && speed < 0.5 && !movingBackward;
	const launchRpm = clamp(numberOr(state.rpm, idle), idle, redline);
	const cutMs = standingLaunch ? 0 : numberOr(state.shiftCutMs, cfg.shiftCutMs);
	state.prevGear = state.gear;
	state.gear = next;
	state.lastShiftMs = now;
	state.cutRemainingMs = cutMs;
	state.justShiftedAt = now;
	state.shiftDeniedReason = null;

	const ratioAfter = resolveCurrentRatio(state);
	const rpmAfter = ratioAfter ? rpmFromSpeed(speed, Math.abs(ratioAfter), fd, tireR) : idle;
	const rpmClamped = clamp(rpmAfter, idle, redline);
	state.rpm = standingLaunch ? launchRpm : rpmClamped;
	state.smoothedRpm = state.rpm;
	state.launchClutchRemainingMs = standingLaunch ? 180 : 0;
	state.launchClutchRpm = standingLaunch ? launchRpm : 0;
	if (standingLaunch) state.wheelspinRpmExcess = true;
	state.manualShiftUp = false;
	state.manualShiftDown = false;
	return true;
}

export function updateGearbox(state, dt, inputs = {}) {
	if (!state) return;
	const cfg = GEARBOX_CONFIG;
	const dtSec = Math.max(0, numberOr(dt, 0));
	msAccumulator += dtSec * 1000;
	const now = msAccumulator;

	if (!Array.isArray(state.gearRatios)) state.gearRatios = [];
	state.maxGear = state.gearRatios.length;
	state.gear = clampGear(state.gear, state, state.maxGear);

	const fd = numberOr(state.finalDrive, cfg.finalDrive);
	const tireR = Math.max(1e-6, numberOr(state.tireRadiusM ?? state.wheelRadius, cfg.tireRadiusM));
	const redline = numberOr(state.redlineRpm ?? state.redlineRPM, cfg.redlineRpm);
	const idleBase = numberOr(state.idleRpm ?? state.idleRPM, cfg.idleRpm);
	const idle = Math.min(redline * 0.25, Math.max(600, idleBase));
	state.finalDrive = fd;
	state.tireRadiusM = tireR;
	state.redlineRpm = redline;
	state.idleRpm = idle;

	const throttle = clamp01(inputs.throttle ?? state.throttle ?? 0);
	const brake = clamp01(inputs.brake ?? state.brake ?? 0);
	const speed = Math.max(0, numberOr(inputs.speedMps, numberOr(state.speedMps, 0)));
	const vForwardMps = numberOr(inputs.vForwardMps, 0);
	state.speedMps = speed;
	state.vForwardMps = vForwardMps;
	state.throttle = throttle;
	state.brake = brake;

	state.cutRemainingMs = Math.max(0, numberOr(state.cutRemainingMs, 0) - dtSec * 1000);

	const baseCtx = state._shiftContext || (state._shiftContext = {});
	baseCtx.cfg = cfg;
	baseCtx.now = now;
	baseCtx.redline = redline;
	baseCtx.speed = speed;
	baseCtx.vForwardMps = vForwardMps;
	baseCtx.finalDrive = fd;
	baseCtx.tireRadiusM = tireR;

	if (inputs.shiftUp || state.manualShiftUp) {
		const ok = attemptShift(state, state.gear + 1, { ...baseCtx, manual: true });
		state.manualShiftUp = ok ? false : true;
	}
	if (inputs.shiftDown || state.manualShiftDown) {
		const ok = attemptShift(state, state.gear - 1, { ...baseCtx, manual: true });
		state.manualShiftDown = ok ? false : true;
	}

	const ratio = resolveCurrentRatio(state);
	state.currentRatio = ratio;
	state.totalRatio = ratio * fd;

	const freeRev = Math.abs(ratio) < 1e-6;
	const roadRpm = rpmFromSpeed(speed, Math.abs(ratio), fd, tireR);
	const wheelspin = !freeRev && ratio > 0 && throttle > 0.05 && state.cutRemainingMs <= 0
		? clamp01(inputs.wheelspin ?? 0) : 0;
	// Tire-force saturation lets driven wheels outrun the road. Full throttle
	// reaches the limiter; lifting and regained traction reconnect RPM smoothly.
	const spinRpm = Math.max(roadRpm, freeRevRpmTarget(idle, redline, throttle, state.throttleDead));
	let rpmTarget = freeRev
		? freeRevRpmTarget(idle, redline, throttle, state.throttleDead)
		: roadRpm + (spinRpm - roadRpm) * wheelspin;
	const launchClutchBlend = ratio > 0 && state.gear === 1 && throttle > 0.05
		? clamp01(numberOr(state.launchClutchRemainingMs, 0) / 180) : 0;
	if (launchClutchBlend > 0) {
		rpmTarget = Math.max(rpmTarget, roadRpm +
			(Math.max(roadRpm, numberOr(state.launchClutchRpm, idle)) - roadRpm) * launchClutchBlend);
	}
	state.launchClutchRemainingMs = Math.max(0, numberOr(state.launchClutchRemainingMs, 0) - dtSec * 1000);
	state.wheelspin = wheelspin;
	state.roadRpm = roadRpm;
	const rpmCurrent = numberOr(state.rpm, idle);
	const riseGain = numberOr(state.rpmRiseGain, cfg.rpmRiseGain);
	const fallGain = numberOr(state.rpmFallGain, cfg.rpmFallGain);
	const gain = wheelspin > 0 && rpmTarget > rpmCurrent
		? Math.max(riseGain, 25)
		: freeRev
		? (rpmTarget >= rpmCurrent ? riseGain : fallGain)
		: (throttle > 0.05 ? riseGain : fallGain);
	const blend = clamp(dtSec * gain, 0, 1);
	const rpmNext = clamp(rpmCurrent + (rpmTarget - rpmCurrent) * blend, idle, redline);
	// A lift/brake clears powered spin immediately, but the unloaded engine
	// still needs time to settle. Do not mistake those falling revs for road speed.
	state.wheelspinRpmExcess = wheelspin > 0.05 ||
		(!!state.wheelspinRpmExcess && rpmNext > Math.max(idle, roadRpm) + 100);
	const shiftRpm = state.wheelspinRpmExcess ? roadRpm : rpmNext;
	state.rpm = rpmNext;
	state.smoothedRpm = rpmNext;
	state.rpmTarget = rpmTarget;

	const sinceLast = now - numberOr(state.lastShiftMs, -1e9);
	const autoEnabled = inputs.auto ?? state.auto ?? true;
	state.auto = !!autoEnabled;

	const torqueFn = state.torqueCurve || torqueCurve;
	const torqueParams = ensureTorqueParams(state, state.torqueCurveParams);
	state.torqueCurveParams = torqueParams;
	const canAutoShift = state.auto && state.cutRemainingMs <= 0 && sinceLast >= numberOr(state.minShiftGapMs, cfg.minShiftGapMs);
	if (canAutoShift && ratio !== 0) {
		const baseUpFrac = numberOr(state.upshiftFrac, cfg.upshiftFrac);
		const upshiftFrac = numberOr(inputs.upshiftFrac, baseUpFrac);
		const upThresh = upshiftFrac * redline;
		const downThresh = numberOr(state.downshiftFrac, cfg.downshiftFrac) * redline;
		const eff = numberOr(state.drivelineEff, cfg.drivelineEff);
		const powerMult = numberOr(state.powerMult, 1);
		const currRatio = state.gear >= 1 ? ratio : 0;
		const Fcurr = currRatio
			? wheelForceAt(speed, currRatio, fd, tireR, rpmNext, throttle, eff, powerMult, torqueFn, torqueParams)
			: 0;

		if (state.gear >= 1 && state.gear < state.gearRatios.length) {
			const nextRatio = state.gearRatios[state.gear] || 0;
			if (nextRatio) {
				const rpmNextGear = rpmFromSpeed(speed, nextRatio, fd, tireR);
				const Fnext = wheelForceAt(speed, nextRatio, fd, tireR, rpmNextGear, throttle, eff, powerMult, torqueFn, torqueParams);
				const margin = Math.max(0, numberOr(state.effortMargin, cfg.effortMargin));
				const lowDemand = throttle < 0.15;
				const rpmNearRedline = shiftRpm > redline * (lowDemand ? 0.965 : 0.985);
				const torqueReady = !currRatio || Fnext >= Fcurr * (1 - margin * 0.5);
				if ((shiftRpm > upThresh && torqueReady) || rpmNearRedline) {
					attemptShift(state, state.gear + 1, baseCtx);
				}
			}
		}

		if (state.gear > 1) {
			const prevRatio = state.gearRatios[state.gear - 2] || 0;
			if (prevRatio) {
				const rpmPrev = rpmFromSpeed(speed, prevRatio, fd, tireR);
				const upFrac = baseUpFrac;
				const reentryMargin = clamp(
					numberOr(state.downshiftReentryMargin, cfg.downshiftReentryMargin),
					0,
					0.4
				);
				const prevGearCeilingFrac = clamp(upFrac - reentryMargin, 0.5, 0.98);
				if (shiftRpm < downThresh && rpmPrev < redline * prevGearCeilingFrac) {
					attemptShift(state, state.gear - 1, baseCtx);
				}
			}
		}
	}

	const resolved = resolveCurrentRatio(state);
	state.currentRatio = resolved;
	state.totalRatio = resolved * fd;
	state.isNeutral = resolved === 0;
	state.isReverse = resolved < 0;
	state.lastUpdateMs = now;
}

export function getDriveForce(state, speedMps, throttle) {
	if (!state) return 0;
	const cfg = GEARBOX_CONFIG;
	const ratio = resolveCurrentRatio(state);
	state.currentRatio = ratio;
	state.totalRatio = ratio * numberOr(state.finalDrive, cfg.finalDrive);
	const cutActive = numberOr(state.cutRemainingMs, 0) > 0;
	if (!ratio || cutActive) {
		state.lastWheelTorque = 0;
		state.lastEngineTorque = 0;
		state.lastDriveForce = 0;
		state.revLimiterActive = false;
		state.isNeutral = true;
		state.isReverse = ratio < 0;
		return 0;
	}
	const fd = numberOr(state.finalDrive, cfg.finalDrive);
	const tireR = Math.max(1e-6, numberOr(state.tireRadiusM ?? state.wheelRadius, cfg.tireRadiusM));
	const eff = numberOr(state.drivelineEff, cfg.drivelineEff);
	const throttleCmd = clamp01(throttle ?? state.throttle ?? 0);
	const wheelRpm = rpmFromSpeed(speedMps, Math.abs(ratio), fd, tireR);
	const redline = numberOr(state.redlineRpm ?? state.redlineRPM, cfg.redlineRpm);
	const over = Math.max(0, wheelRpm - redline);
	const limiterBand = Math.max(1, redline * 0.07);
	const limiter = clamp(1 - over / limiterBand, 0, 1);
	const throttleEff = throttleCmd * limiter;
	const rpmEff = numberOr(state.rpm, wheelRpm);
	const torqueFn = state.torqueCurve || torqueCurve;
	const torqueParams = ensureTorqueParams(state, state.torqueCurveParams);
	state.torqueCurveParams = torqueParams;
	const baseTorque = torqueFn(Math.max(0, rpmEff), throttleEff, torqueParams);
	const engineTorque = baseTorque * numberOr(state.powerMult, 1);
	const wheelTorque = engineTorque * ratio * fd * eff;
	const driveForce = wheelTorque / tireR;
	state.lastEngineTorque = engineTorque;
	state.lastWheelTorque = wheelTorque;
	state.lastDriveForce = driveForce;
	state.isNeutral = false;
	state.isReverse = ratio < 0;
	state.revLimiterActive = (limiter < 0.999 && throttleCmd > 0.05) ||
		(numberOr(state.wheelspin, 0) > 0.7 && rpmEff >= redline * 0.97 && throttleCmd > 0.95);
	return driveForce;
}

export function suggestGearRatios(params = {}) {
	const {
		redlineRpm = GEARBOX_CONFIG.redlineRpm,
		finalDrive = GEARBOX_CONFIG.finalDrive,
		tireRadiusM = GEARBOX_CONFIG.tireRadiusM,
		targetTopSpeedMps = 54,
		gears = 6,
		spacing = 1.28,
		firstGearRatio
	} = params;

	const gearCount = Math.max(1, Math.round(numberOr(gears, 6)));
	const radius = Math.max(1e-6, tireRadiusM);
	const totalTop = (redlineRpm / 60) / (targetTopSpeedMps / (2 * Math.PI * radius));
	const topGearRatio = totalTop / Math.max(1e-6, finalDrive);
	const firstRatio = Number.isFinite(firstGearRatio)
		? Math.max(topGearRatio, Math.abs(firstGearRatio))
		: topGearRatio * Math.pow(Math.max(1.01, spacing), Math.max(0, gearCount - 1));
	const spacingSafe = gearCount > 1
		? Math.pow(firstRatio / Math.max(1e-6, topGearRatio), 1 / (gearCount - 1))
		: 1;
	const ratios = [];
	for (let i = 0; i < gearCount; i++) {
		const exponent = gearCount - i - 1;
		const r = topGearRatio * Math.pow(spacingSafe, exponent);
		ratios.push(Number.isFinite(r) ? r : topGearRatio);
	}
	if (ratios.length) ratios[ratios.length - 1] = topGearRatio;
	return ratios;
}

export const gearboxDefaults = {
	ratios:       [3.54, 2.77, 2.16, 1.69, 1.32, 1.03],
	reverseRatio: 3.40,
	finalDrive:   3.90,
	redlineRPM:   7200,
	idleRPM:      900,
	upshiftRPM:   Math.round(GEARBOX_CONFIG.redlineRpm * GEARBOX_CONFIG.upshiftFrac),
	downshiftRPM: Math.round(GEARBOX_CONFIG.redlineRpm * GEARBOX_CONFIG.downshiftFrac),
	upshiftFrac:  GEARBOX_CONFIG.upshiftFrac,
	downshiftFrac: GEARBOX_CONFIG.downshiftFrac,
	downshiftReentryMargin: GEARBOX_CONFIG.downshiftReentryMargin,
	shiftCutMs:   GEARBOX_CONFIG.shiftCutMs,
	minShiftGapMs: GEARBOX_CONFIG.minShiftGapMs,
	effortMargin: GEARBOX_CONFIG.effortMargin,
	wheelRadius:  GEARBOX_CONFIG.tireRadiusM,
	tireRadiusM:  GEARBOX_CONFIG.tireRadiusM,
	drivelineEff: GEARBOX_CONFIG.drivelineEff,
	rpmRiseGain:  GEARBOX_CONFIG.rpmRiseGain,
	rpmFallGain:  GEARBOX_CONFIG.rpmFallGain,
	torqueCurve:  null,
	torquePeak:   260,
	powerMult:    1.00,
	throttleDead: 0.05,
	auto: true,
	enableReverse: true,
	allowNeutral: true,
	engineBrakePeak: 0.0,
	engineInertia: 0.6,
	clutchEngageRate: 12.0,
	clutchSlipBoost: 0.0
};

function createStateFromConfig(cfg = {}) {
	const ratios = sanitizeRatios(cfg.ratios);
	const redline = numberOr(cfg.redlineRPM ?? cfg.redlineRpm, GEARBOX_CONFIG.redlineRpm);
	const idle = numberOr(cfg.idleRPM ?? cfg.idleRpm, GEARBOX_CONFIG.idleRpm);
	const upFrac = resolveShiftFrac(cfg.upshiftFrac, rpmToFrac(cfg.upshiftRPM, redline), GEARBOX_CONFIG.upshiftFrac);
	const downFrac = resolveShiftFrac(cfg.downshiftFrac, rpmToFrac(cfg.downshiftRPM, redline), GEARBOX_CONFIG.downshiftFrac);
	const torquePeak = Math.max(0, firstNumber(cfg.torquePeak, 260) ?? 260);
	const torqueIdleRaw = firstNumber(cfg.torqueIdle, cfg.torqueBase);
	const torqueIdle = Math.max(0, Math.min(torquePeak, torqueIdleRaw != null ? torqueIdleRaw : deriveTorqueIdle(torquePeak)));
	const torquePeakRpm = Math.max(1000, firstNumber(cfg.torquePeakRPM, cfg.torquePeakRpm, 5000) ?? 5000);
	const engineBrakePeak = Math.max(0, firstNumber(cfg.engineBrakePeak, 0) ?? 0);
	const state = {
		gearRatios: ratios,
		maxGear: ratios.length,
		gear: ratios.length ? 1 : 0,
		rpm: idle,
		smoothedRpm: idle,
		redlineRpm: redline,
		idleRpm: idle,
		finalDrive: numberOr(cfg.finalDrive, GEARBOX_CONFIG.finalDrive),
		tireRadiusM: numberOr(cfg.tireRadiusM ?? cfg.wheelRadius, GEARBOX_CONFIG.tireRadiusM),
		drivelineEff: numberOr(cfg.drivelineEff, GEARBOX_CONFIG.drivelineEff),
		upshiftFrac: upFrac,
		downshiftFrac: downFrac,
		downshiftReentryMargin: numberOr(
			cfg.downshiftReentryMargin,
			GEARBOX_CONFIG.downshiftReentryMargin
		),
		shiftCutMs: numberOr(cfg.shiftCutMs, GEARBOX_CONFIG.shiftCutMs),
		minShiftGapMs: numberOr(cfg.minShiftGapMs, GEARBOX_CONFIG.minShiftGapMs),
		effortMargin: numberOr(cfg.effortMargin, GEARBOX_CONFIG.effortMargin),
		rpmRiseGain: numberOr(cfg.rpmRiseGain, GEARBOX_CONFIG.rpmRiseGain),
		rpmFallGain: numberOr(cfg.rpmFallGain, GEARBOX_CONFIG.rpmFallGain),
		throttleDead: numberOr(cfg.throttleDead, 0.05),
		powerMult: numberOr(cfg.powerMult, 1),
		torqueCurve: typeof cfg.torqueCurve === 'function' ? cfg.torqueCurve : null,
		torquePeak,
		torqueIdle,
		torquePeakRpm,
		engineBrakePeak,
		torqueCurveParams: null,
		auto: cfg.auto !== false,
		allowNeutral: cfg.allowNeutral !== false,
		enableReverse: cfg.enableReverse !== false,
		reverseRatio: numberOr(cfg.reverseRatio, ratios[0] || 0),
		speedMps: 0,
		vForwardMps: 0,
		throttle: 0,
		brake: 0,
		lastShiftMs: -1e9,
		cutRemainingMs: 0,
		manualShiftUp: false,
		manualShiftDown: false
	};
	state.currentRatio = resolveCurrentRatio(state);
	state.totalRatio = state.currentRatio * state.finalDrive;
	state.isNeutral = state.currentRatio === 0;
	state.isReverse = state.currentRatio < 0;
	state.torqueCurveParams = ensureTorqueParams(state);
	return state;
}

export class Gearbox {
	constructor(cfg = {}) {
		this.c = { ...gearboxDefaults, ...cfg };
		this.state = createStateFromConfig(this.c);
		this.lastRequestedForce = 0;
		this._gearIndex = this.state.gear;
		this.gear = this._formatGearLabel(this.state.gear);
		this.rpm = this.state.rpm;
	}

	_formatGearLabel(gear) {
		if (gear === -1) return 'R';
		if (gear === 0) return 'N';
		return gear;
	}

	_syncConfigToState() {
		const c = this.c;
		const s = this.state;
		const ratios = sanitizeRatios(c.ratios);
		if (!arraysEqual(ratios, s.gearRatios)) {
			s.gearRatios = ratios;
			s.maxGear = ratios.length;
			s.gear = clampGear(s.gear, s, ratios.length);
		}
		s.finalDrive = numberOr(c.finalDrive, s.finalDrive ?? GEARBOX_CONFIG.finalDrive);
		s.tireRadiusM = numberOr(c.tireRadiusM ?? c.wheelRadius, s.tireRadiusM ?? GEARBOX_CONFIG.tireRadiusM);
		s.redlineRpm = numberOr(c.redlineRPM ?? c.redlineRpm, s.redlineRpm ?? GEARBOX_CONFIG.redlineRpm);
		s.idleRpm = numberOr(c.idleRPM ?? c.idleRpm, s.idleRpm ?? GEARBOX_CONFIG.idleRpm);
		const upFracFromRpm = rpmToFrac(c.upshiftRPM, s.redlineRpm);
		const downFracFromRpm = rpmToFrac(c.downshiftRPM, s.redlineRpm);
		s.upshiftFrac = resolveShiftFrac(c.upshiftFrac, upFracFromRpm, s.upshiftFrac ?? GEARBOX_CONFIG.upshiftFrac);
		s.downshiftFrac = resolveShiftFrac(c.downshiftFrac, downFracFromRpm, s.downshiftFrac ?? GEARBOX_CONFIG.downshiftFrac);
		s.downshiftReentryMargin = numberOr(
			c.downshiftReentryMargin,
			s.downshiftReentryMargin ?? GEARBOX_CONFIG.downshiftReentryMargin
		);
		s.shiftCutMs = numberOr(c.shiftCutMs, s.shiftCutMs ?? GEARBOX_CONFIG.shiftCutMs);
		s.minShiftGapMs = numberOr(c.minShiftGapMs, s.minShiftGapMs ?? GEARBOX_CONFIG.minShiftGapMs);
		s.effortMargin = numberOr(c.effortMargin, s.effortMargin ?? GEARBOX_CONFIG.effortMargin);
		s.rpmRiseGain = numberOr(c.rpmRiseGain, s.rpmRiseGain ?? GEARBOX_CONFIG.rpmRiseGain);
		s.rpmFallGain = numberOr(c.rpmFallGain, s.rpmFallGain ?? GEARBOX_CONFIG.rpmFallGain);
		s.drivelineEff = numberOr(c.drivelineEff, s.drivelineEff ?? GEARBOX_CONFIG.drivelineEff);
		s.powerMult = numberOr(c.powerMult, s.powerMult ?? 1);
		s.torqueCurve = typeof c.torqueCurve === 'function' ? c.torqueCurve : null;
		const torquePeak = Math.max(0, firstNumber(c.torquePeak, s.torquePeak, 260) ?? 260);
		const torqueIdleCandidate = firstNumber(c.torqueIdle, c.torqueBase, s.torqueIdle);
		s.torquePeak = torquePeak;
		s.torqueIdle = Math.max(0, Math.min(torquePeak, torqueIdleCandidate != null ? torqueIdleCandidate : deriveTorqueIdle(torquePeak)));
		s.torquePeakRpm = Math.max(1000, firstNumber(c.torquePeakRPM, c.torquePeakRpm, s.torquePeakRpm, 5000) ?? 5000);
		s.engineBrakePeak = Math.max(0, firstNumber(c.engineBrakePeak, s.engineBrakePeak, 0) ?? 0);
		s.torqueCurveParams = ensureTorqueParams(s, s.torqueCurveParams);
		s.throttleDead = numberOr(c.throttleDead, s.throttleDead ?? 0.05);
		s.auto = c.auto !== false;
		s.allowNeutral = c.allowNeutral !== false;
		s.enableReverse = c.enableReverse !== false;
		s.reverseRatio = numberOr(c.reverseRatio, s.reverseRatio ?? (s.gearRatios[0] || 0));
	}

	_syncOutputs() {
		this._gearIndex = this.state.gear;
		this.gear = this._formatGearLabel(this.state.gear);
		this.rpm = numberOr(this.state.smoothedRpm, this.state.rpm);
	}

	refreshFromConfig() {
		this._syncConfigToState();
		this._syncOutputs();
	}

	applyState() {
		this._syncOutputs();
	}

	get gearIndex() {
		return this._gearIndex;
	}

	get isReverse() {
		return this.state.gear === -1;
	}

	get isNeutral() {
		return !this.state.currentRatio;
	}

	setManual(on) {
		this.c.auto = !on;
		this.state.auto = !on;
	}

	_attemptImmediateShift(target) {
		const ok = attemptShift(this.state, target, {
			cfg: GEARBOX_CONFIG,
			manual: true,
			speed: this.state.speedMps,
			vForwardMps: this.state.vForwardMps,
			finalDrive: this.state.finalDrive,
			tireRadiusM: this.state.tireRadiusM,
			redline: this.state.redlineRpm
		});
		if (!ok) return false;
		this._syncOutputs();
		return true;
	}

	shiftUp() {
		this._syncConfigToState();
		const target = this.state.gear + 1;
		if (!this._attemptImmediateShift(target)) {
			this.state.manualShiftUp = true;
		}
		this._syncOutputs();
	}

	shiftDown() {
		this._syncConfigToState();
		const target = this.state.gear - 1;
		if (!this._attemptImmediateShift(target)) {
			this.state.manualShiftDown = true;
		}
		this._syncOutputs();
	}

	update(dt, opts = {}) {
		this._syncConfigToState();
		const speedMps = Math.max(0, numberOr(opts.speedMps, numberOr(this.state.speedMps, 0)));
		const vForwardMps = numberOr(opts.vForwardMps, speedMps);
		this.state.speedMps = speedMps;
		this.state.vForwardMps = vForwardMps;
		const throttle = clamp01(opts.throttle ?? this.state.throttle ?? 0);
		const inputs = {
			throttle,
			brake: clamp01(opts.brake ?? this.state.brake ?? 0),
			wheelspin: clamp01(opts.wheelspin ?? 0),
			speedMps,
			vForwardMps,
			auto: this.c.auto !== false,
			shiftUp: this.state.manualShiftUp,
			shiftDown: this.state.manualShiftDown
		};
		updateGearbox(this.state, dt, inputs);
		this._syncOutputs();
		const force = getDriveForce(this.state, speedMps, throttle);
		this.lastRequestedForce = force;
		return force;
	}

	step(dt, vForward, throttle/*, slipInfo*/) {
		const speed = Math.max(0, Math.abs(numberOr(vForward, 0)));
		const force = this.update(dt, { speedMps: speed, throttle });
		const s = this.state;
		const tireR = Math.max(1e-6, numberOr(s.tireRadiusM ?? s.wheelRadius, GEARBOX_CONFIG.tireRadiusM));
		const fd = numberOr(s.finalDrive, GEARBOX_CONFIG.finalDrive);
		const totalRatio = s.currentRatio * fd;
		const eff = numberOr(s.drivelineEff, GEARBOX_CONFIG.drivelineEff);
		const wheelTorque = numberOr(s.lastWheelTorque, force * tireR);
		const engineTorque = totalRatio ? wheelTorque / (totalRatio * eff || 1) : 0;

		const torqueFn = s.torqueCurve || torqueCurve;
		const tqMax = torqueFn(s.redlineRpm, 1) * numberOr(s.powerMult, 1);
		const maxWheelTorque = tqMax * totalRatio * eff;
		const maxForce = tireR > 0 ? maxWheelTorque / tireR : Math.abs(force) || 1;
		const forceNorm = maxForce > 1e-6 ? Math.min(1, Math.abs(force) / Math.max(1e-3, Math.abs(maxForce))) : 0;

		return {
			rpm: Math.round(this.rpm),
			gear: this.gear,
			requestedForce: force,
			clutchLock: 1,
			forceNorm,
			gearRatio: totalRatio,
			isReverse: this.isReverse,
			isNeutral: this.isNeutral,
			T_engine: engineTorque,
			T_wheel: wheelTorque,
			wheelRadius: tireR
		};
	}
}
