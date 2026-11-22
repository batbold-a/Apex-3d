import { CarSpec, SurfaceType } from '../types/vehicle';

interface CarSoundProfile {
  primaryType: OscillatorType;
  subType: OscillatorType;
  harmType: OscillatorType;
  bankType: OscillatorType;
  subRatio: number;
  harmRatio: number;
  bankRatio: number;
  subLevel: number;
  harmLevel: number;
  bankLevel: number;
  pitchSpan: number;
  chestHz: number;
  formantBaseHz: number;
  formantSpanHz: number;
  formantQ: number;
  airNoiseLevel: number;
  lopeDepth: number;
  lopeRateHz: number;
  shaperDrive: number;
  whineType: 'none' | 'turbo' | 'supercharger';
  whineBaseHz: number;
  whineSpanHz: number;
  whineMaxGain: number;
  shiftFreqUp: number;
  shiftFreqDown: number;
  allowsBackfire: boolean;
}

const SOUND_PROFILES: Record<string, CarSoundProfile> = {
  // Porsche 911 GT3 RS — High-revving 9,000 RPM naturally aspirated Flat-6 metallic howl
  'gt3-rs': {
    primaryType: 'sawtooth',
    subType: 'triangle',
    harmType: 'sawtooth',
    bankType: 'triangle',
    subRatio: 0.5,
    harmRatio: 1.5,
    bankRatio: 3.0,
    subLevel: 0.45,
    harmLevel: 0.38,
    bankLevel: 0.25,
    pitchSpan: 3.9,
    chestHz: 145,
    formantBaseHz: 260,
    formantSpanHz: 1950,
    formantQ: 2.3,
    airNoiseLevel: 0.12,
    lopeDepth: 0.018,
    lopeRateHz: 18,
    shaperDrive: 1.5,
    whineType: 'none',
    whineBaseHz: 0,
    whineSpanHz: 0,
    whineMaxGain: 0,
    shiftFreqUp: 245,
    shiftFreqDown: 185,
    allowsBackfire: false,
  },

  // Subaru WRX STI Rally — Deep unequal-length Boxer rumble + turbo spool & BOV flutter
  'wrx-rally': {
    primaryType: 'sawtooth',
    subType: 'triangle',
    harmType: 'triangle',
    bankType: 'sawtooth',
    subRatio: 0.5,
    harmRatio: 1.016,
    bankRatio: 0.75,
    subLevel: 0.88,
    harmLevel: 0.28,
    bankLevel: 0.46,
    pitchSpan: 3.0,
    chestHz: 115,
    formantBaseHz: 175,
    formantSpanHz: 1150,
    formantQ: 2.0,
    airNoiseLevel: 0.14,
    lopeDepth: 0.085,
    lopeRateHz: 12.5,
    shaperDrive: 2.1,
    whineType: 'turbo',
    whineBaseHz: 1950,
    whineSpanHz: 3200,
    whineMaxGain: 0.055,
    shiftFreqUp: 180,
    shiftFreqDown: 130,
    allowsBackfire: true,
  },

  // Land Rover Defender 110 — Smooth refined 5.0L Supercharged V8 low-end burble
  'defender-v8': {
    primaryType: 'triangle',
    subType: 'sine',
    harmType: 'sawtooth',
    bankType: 'triangle',
    subRatio: 0.5,
    harmRatio: 1.5,
    bankRatio: 0.992,
    subLevel: 0.95,
    harmLevel: 0.22,
    bankLevel: 0.28,
    pitchSpan: 2.55,
    chestHz: 105,
    formantBaseHz: 140,
    formantSpanHz: 850,
    formantQ: 1.4,
    airNoiseLevel: 0.1,
    lopeDepth: 0.05,
    lopeRateHz: 9.2,
    shaperDrive: 1.4,
    whineType: 'supercharger',
    whineBaseHz: 1400,
    whineSpanHz: 1950,
    whineMaxGain: 0.036,
    shiftFreqUp: 125,
    shiftFreqDown: 95,
    allowsBackfire: false,
  },

  // Mercedes-AMG G63 4x4² — Throaty AMG 4.0L Biturbo V8 side-pipe growl
  'g63-4x4': {
    primaryType: 'sawtooth',
    subType: 'sine',
    harmType: 'triangle',
    bankType: 'sawtooth',
    subRatio: 0.5,
    harmRatio: 1.495,
    bankRatio: 0.986,
    subLevel: 0.96,
    harmLevel: 0.28,
    bankLevel: 0.45,
    pitchSpan: 2.7,
    chestHz: 100,
    formantBaseHz: 155,
    formantSpanHz: 1050,
    formantQ: 1.85,
    airNoiseLevel: 0.13,
    lopeDepth: 0.095,
    lopeRateHz: 8.6,
    shaperDrive: 2.3,
    whineType: 'turbo',
    whineBaseHz: 1700,
    whineSpanHz: 2250,
    whineMaxGain: 0.042,
    shiftFreqUp: 145,
    shiftFreqDown: 105,
    allowsBackfire: true,
  },

  // Ford Mustang Shelby GT500 — Choppy cross-plane Predator V8 + supercharger
  'shelby-gt500': {
    primaryType: 'sawtooth',
    subType: 'triangle',
    harmType: 'sawtooth',
    bankType: 'triangle',
    subRatio: 0.5,
    harmRatio: 2.0,
    bankRatio: 0.984,
    subLevel: 0.85,
    harmLevel: 0.34,
    bankLevel: 0.5,
    pitchSpan: 3.3,
    chestHz: 115,
    formantBaseHz: 185,
    formantSpanHz: 1450,
    formantQ: 2.1,
    airNoiseLevel: 0.14,
    lopeDepth: 0.11,
    lopeRateHz: 10.4,
    shaperDrive: 2.5,
    whineType: 'supercharger',
    whineBaseHz: 1200,
    whineSpanHz: 3200,
    whineMaxGain: 0.08,
    shiftFreqUp: 165,
    shiftFreqDown: 120,
    allowsBackfire: true,
  },
};

function createSaturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const samples = 256;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

export class EngineAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private oscPrimary: OscillatorNode | null = null;
  private oscSub: OscillatorNode | null = null;
  private oscHarmonic: OscillatorNode | null = null;
  private oscBank: OscillatorNode | null = null;
  private subGain: GainNode | null = null;
  private harmGain: GainNode | null = null;
  private bankGain: GainNode | null = null;

  private lopeOsc: OscillatorNode | null = null;
  private lopeGain: GainNode | null = null;
  private engineShaper: WaveShaperNode | null = null;
  private chestFilter: BiquadFilterNode | null = null;
  private formantFilter: BiquadFilterNode | null = null;
  private airFilter: BiquadFilterNode | null = null;
  private airGain: GainNode | null = null;
  private engineGain: GainNode | null = null;

  private oscWhine: OscillatorNode | null = null;
  private whineGain: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;
  private screechGain: GainNode | null = null;
  private screechFilter: BiquadFilterNode | null = null;
  private rumbleGain: GainNode | null = null;
  private rumbleFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  private activeCarId = '';
  private prevThrottle = 0;
  private backfireCooldown = 0;
  private lastTickTime = 0;
  private initialized = false;
  private muted = false;
  private paused = false;

  public init(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    // Master dynamics compressor prevents harsh clipping when revs + impacts layer
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.12;
    compressor.connect(ctx.destination);

    const masterGain = ctx.createGain();
    masterGain.gain.value = this.muted ? 0 : 0.34;
    masterGain.connect(compressor);
    this.masterGain = masterGain;

    // Soft saturation -> Parallel Muffler Chest Lowpass + Exhaust Formant Bandpass -> Engine Gain
    const engineShaper = ctx.createWaveShaper();
    engineShaper.curve = createSaturationCurve(1.8);
    engineShaper.oversample = '2x';

    const chestFilter = ctx.createBiquadFilter();
    chestFilter.type = 'lowpass';
    chestFilter.frequency.value = 120;
    chestFilter.Q.value = 1.1;

    const chestGain = ctx.createGain();
    chestGain.gain.value = 0.85;

    const formantFilter = ctx.createBiquadFilter();
    formantFilter.type = 'bandpass';
    formantFilter.frequency.value = 260;
    formantFilter.Q.value = 1.8;

    const formantGain = ctx.createGain();
    formantGain.gain.value = 0.9;

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.0;

    engineShaper.connect(chestFilter);
    chestFilter.connect(chestGain);
    chestGain.connect(engineGain);

    engineShaper.connect(formantFilter);
    formantFilter.connect(formantGain);
    formantGain.connect(engineGain);

    engineGain.connect(masterGain);

    this.engineShaper = engineShaper;
    this.chestFilter = chestFilter;
    this.formantFilter = formantFilter;
    this.engineGain = engineGain;

    // 4-oscillator engine core
    const oscPrimary = ctx.createOscillator();
    oscPrimary.type = 'sawtooth';
    oscPrimary.frequency.value = 48;

    const oscSub = ctx.createOscillator();
    oscSub.type = 'triangle';
    oscSub.frequency.value = 24;

    const oscHarmonic = ctx.createOscillator();
    oscHarmonic.type = 'sawtooth';
    oscHarmonic.frequency.value = 96;

    const oscBank = ctx.createOscillator();
    oscBank.type = 'triangle';
    oscBank.frequency.value = 48;

    const subGain = ctx.createGain();
    subGain.gain.value = 0.7;
    const harmGain = ctx.createGain();
    harmGain.gain.value = 0.25;
    const bankGain = ctx.createGain();
    bankGain.gain.value = 0.3;

    oscPrimary.connect(engineShaper);
    oscSub.connect(subGain);
    subGain.connect(engineShaper);
    oscHarmonic.connect(harmGain);
    harmGain.connect(engineShaper);
    oscBank.connect(bankGain);
    bankGain.connect(engineShaper);

    // Idle cam lope / firing-order pulse modulation
    const lopeOsc = ctx.createOscillator();
    lopeOsc.type = 'sine';
    lopeOsc.frequency.value = 12;
    const lopeGain = ctx.createGain();
    lopeGain.gain.value = 0.02;
    lopeOsc.connect(lopeGain);
    lopeGain.connect(engineGain.gain);

    // Supercharger / Turbo whistle
    const oscWhine = ctx.createOscillator();
    oscWhine.type = 'sine';
    oscWhine.frequency.value = 1500;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    oscWhine.connect(whineGain);
    whineGain.connect(masterGain);

    oscPrimary.start();
    oscSub.start();
    oscHarmonic.start();
    oscBank.start();
    lopeOsc.start();
    oscWhine.start();

    this.oscPrimary = oscPrimary;
    this.oscSub = oscSub;
    this.oscHarmonic = oscHarmonic;
    this.oscBank = oscBank;
    this.subGain = subGain;
    this.harmGain = harmGain;
    this.bankGain = bankGain;
    this.lopeOsc = lopeOsc;
    this.lopeGain = lopeGain;
    this.oscWhine = oscWhine;
    this.whineGain = whineGain;

    // Pink-filtered noise buffer (warmer & much more natural than harsh white noise)
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
    }
    this.noiseBuffer = noiseBuffer;

    // Intake & Exhaust Combustion Breath Layer (adds mechanical air realism)
    const airSrc = ctx.createBufferSource();
    airSrc.buffer = noiseBuffer;
    airSrc.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 420;
    airFilter.Q.value = 1.2;
    const airGain = ctx.createGain();
    airGain.gain.value = 0;
    airSrc.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(masterGain);
    airSrc.start();
    this.airFilter = airFilter;
    this.airGain = airGain;

    // Asphalt Tire Squeal
    const screechSource = ctx.createBufferSource();
    screechSource.buffer = noiseBuffer;
    screechSource.loop = true;
    const screechFilter = ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.frequency.value = 1380;
    screechFilter.Q.value = 7.5;
    const screechGain = ctx.createGain();
    screechGain.gain.value = 0;
    screechSource.connect(screechFilter);
    screechFilter.connect(screechGain);
    screechGain.connect(masterGain);
    screechSource.start();
    this.screechFilter = screechFilter;
    this.screechGain = screechGain;

    // Dirt / Gravel / Cobble Suspension & Tire Spray Texture
    const rumbleSource = ctx.createBufferSource();
    rumbleSource.buffer = noiseBuffer;
    rumbleSource.loop = true;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'bandpass';
    rumbleFilter.frequency.value = 240;
    rumbleFilter.Q.value = 0.9;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleSource.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(masterGain);
    rumbleSource.start();
    this.rumbleFilter = rumbleFilter;
    this.rumbleGain = rumbleGain;

    // Aerodynamic Wind Rush Layer proportional to vehicle speed^2
    const windSource = ctx.createBufferSource();
    windSource.buffer = noiseBuffer;
    windSource.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 340;
    windFilter.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(masterGain);
    windSource.start();
    this.windFilter = windFilter;
    this.windGain = windGain;

    this.lastTickTime = ctx.currentTime;
    this.initialized = true;
  }

  private getProfile(car: CarSpec): CarSoundProfile {
    return SOUND_PROFILES[car.id] ?? SOUND_PROFILES['gt3-rs'];
  }

  private applyCarCharacter(car: CarSpec, profile: CarSoundProfile): void {
    if (!this.ctx || this.activeCarId === car.id) return;
    this.activeCarId = car.id;
    const now = this.ctx.currentTime;

    if (this.oscPrimary) this.oscPrimary.type = profile.primaryType;
    if (this.oscSub) this.oscSub.type = profile.subType;
    if (this.oscHarmonic) this.oscHarmonic.type = profile.harmType;
    if (this.oscBank) this.oscBank.type = profile.bankType;

    this.subGain?.gain.setTargetAtTime(profile.subLevel, now, 0.04);
    this.harmGain?.gain.setTargetAtTime(profile.harmLevel, now, 0.04);
    this.bankGain?.gain.setTargetAtTime(profile.bankLevel, now, 0.04);
    this.chestFilter?.frequency.setTargetAtTime(profile.chestHz, now, 0.05);
    this.formantFilter?.Q.setTargetAtTime(profile.formantQ, now, 0.05);
    this.lopeOsc?.frequency.setTargetAtTime(profile.lopeRateHz, now, 0.05);

    if (this.engineShaper) {
      this.engineShaper.curve = createSaturationCurve(profile.shaperDrive);
    }
    if (this.oscWhine) {
      this.oscWhine.type = profile.whineType === 'supercharger' ? 'triangle' : 'sine';
    }
  }

  private syncMasterVolume(): void {
    if (this.masterGain && this.ctx) {
      const target = this.muted || this.paused ? 0 : 0.34;
      this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04);
    }
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    this.syncMasterVolume();
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    this.syncMasterVolume();
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public update(
    car: CarSpec,
    rpm: number,
    throttle: number,
    maxSlip: number,
    roughness: number,
    speedMs: number,
    isAirborne: boolean,
    surfaceType: SurfaceType = 'asphalt',
    engineLoad = throttle,
    boostBar = 0
  ): void {
    if (!this.initialized || !this.ctx) return;
    if (this.ctx.state === 'suspended') return;

    const now = this.ctx.currentTime;
    const dt = Math.max(0.001, now - this.lastTickTime);
    this.lastTickTime = now;
    if (this.backfireCooldown > 0) this.backfireCooldown = Math.max(0, this.backfireCooldown - dt);

    const profile = this.getProfile(car);
    this.applyCarCharacter(car, profile);

    const rpmNorm = Math.max(0, Math.min(1, rpm / car.maxRpm));
    const load = Math.max(0, Math.min(1, engineLoad));
    const baseFreq = car.engineBaseFreq * (0.62 + rpmNorm * profile.pitchSpan);

    this.oscPrimary?.frequency.setTargetAtTime(baseFreq, now, 0.025);
    this.oscSub?.frequency.setTargetAtTime(baseFreq * profile.subRatio, now, 0.025);
    this.oscHarmonic?.frequency.setTargetAtTime(baseFreq * profile.harmRatio, now, 0.025);
    this.oscBank?.frequency.setTargetAtTime(baseFreq * profile.bankRatio, now, 0.025);

    // Formant opens sharply with actual combustion load & throttle; chest deepens under high torque load
    const formantHz =
      profile.formantBaseHz + rpmNorm * profile.formantSpanHz + throttle * 220 + load * 260;
    this.formantFilter?.frequency.setTargetAtTime(formantHz, now, 0.03);
    this.chestFilter?.frequency.setTargetAtTime(profile.chestHz + load * 65, now, 0.04);

    const overrun = throttle < 0.12 && rpmNorm > 0.35 ? 0.06 : 0;
    const engVol = 0.14 + load * 0.16 + throttle * 0.08 + rpmNorm * 0.14 + overrun;
    this.engineGain?.gain.setTargetAtTime(engVol, now, 0.03);

    // Intake/exhaust breath noise follows throttle + actual load + RPM
    const airVol =
      profile.airNoiseLevel * (0.2 + throttle * 0.45 + load * 0.45) * (0.35 + rpmNorm * 0.65);
    this.airGain?.gain.setTargetAtTime(airVol, now, 0.04);
    this.airFilter?.frequency.setTargetAtTime(
      260 + rpmNorm * 950 + load * 320 + throttle * 160,
      now,
      0.04
    );

    // Stronger firing-order lope at low RPM / high load
    const lopeAmount = profile.lopeDepth * (1 - rpmNorm * 0.65) * (0.85 + load * 0.35);
    this.lopeGain?.gain.setTargetAtTime(lopeAmount, now, 0.04);

    // Forced induction whistle driven by real manifold boost pressure
    const posBoost = Math.max(0, boostBar);
    if (profile.whineType === 'supercharger') {
      const whineFreq = profile.whineBaseHz + rpmNorm * profile.whineSpanHz;
      const whineVol =
        profile.whineMaxGain *
        Math.pow(rpmNorm, 0.85) *
        (0.3 + Math.min(1, posBoost + throttle * 0.5) * 0.7);
      this.oscWhine?.frequency.setTargetAtTime(whineFreq, now, 0.03);
      this.whineGain?.gain.setTargetAtTime(whineVol, now, 0.04);
    } else if (profile.whineType === 'turbo') {
      const spoolNorm = Math.min(1.15, posBoost / 1.35);
      const spoolFreq = profile.whineBaseHz + spoolNorm * profile.whineSpanHz;
      const spoolVol = profile.whineMaxGain * Math.max(0, spoolNorm);
      this.oscWhine?.frequency.setTargetAtTime(spoolFreq, now, 0.045);
      this.whineGain?.gain.setTargetAtTime(spoolVol, now, 0.05);
    } else {
      this.whineGain?.gain.setTargetAtTime(0, now, 0.04);
    }

    // Deceleration exhaust crackle/pop
    if (
      profile.allowsBackfire &&
      !this.muted &&
      this.prevThrottle > 0.55 &&
      throttle < 0.22 &&
      rpmNorm > 0.48 &&
      this.backfireCooldown <= 0
    ) {
      this.backfireCooldown = 0.65;
      this.playBackfirePop(car.id === 'wrx-rally');
    }
    this.prevThrottle = throttle;

    // Tire squeal on asphalt vs loose gravel/sand/dirt spray
    const isAsphalt = surfaceType === 'asphalt';
    const screechTarget =
      isAsphalt && !isAirborne && maxSlip > 0.26 ? Math.min(0.22, (maxSlip - 0.26) * 0.34) : 0;
    this.screechGain?.gain.setTargetAtTime(screechTarget, now, 0.04);
    this.screechFilter?.frequency.setTargetAtTime(1250 + Math.min(1, maxSlip) * 520, now, 0.05);

    const looseBoost = !isAsphalt ? 1.45 + Math.min(0.8, maxSlip * 0.7) : 0.45;
    const rumbleTarget = !isAirborne
      ? Math.min(0.38, roughness * Math.min(1, speedMs / 16) * 0.26 * looseBoost)
      : 0;
    this.rumbleGain?.gain.setTargetAtTime(rumbleTarget, now, 0.04);
    this.rumbleFilter?.frequency.setTargetAtTime(
      isAsphalt ? 160 : surfaceType === 'sand' ? 540 : 340 + roughness * 220,
      now,
      0.04
    );

    // Aerodynamic wind rush proportional to v^2 above 55 km/h
    const windSpeedNorm = Math.max(0, (speedMs - 12) / 68);
    const windTarget = Math.min(0.14, windSpeedNorm * windSpeedNorm * 0.14);
    this.windGain?.gain.setTargetAtTime(windTarget, now, 0.06);
    this.windFilter?.frequency.setTargetAtTime(280 + speedMs * 7.5, now, 0.06);
  }

  private playBackfirePop(isRallyAntiLag: boolean): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    const bursts = isRallyAntiLag ? 2 : 1;
    for (let i = 0; i < bursts; i++) {
      const t = now + i * 0.075;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(isRallyAntiLag ? 780 : 520, t);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      src.connect(lp);
      lp.connect(g);
      g.connect(this.masterGain);
      src.start(t);
      src.stop(t + 0.1);
    }
  }

  public playShiftClunk(isUpshift: boolean, car?: CarSpec): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    if (this.ctx.state === 'suspended') return;

    const profile = car ? this.getProfile(car) : SOUND_PROFILES['gt3-rs'];
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isUpshift ? profile.shiftFreqUp : profile.shiftFreqDown, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.075);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.09);

    if (isUpshift && profile.whineType === 'turbo' && this.noiseBuffer) {
      for (let pulse = 0; pulse < 3; pulse++) {
        const t = now + pulse * 0.055;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(3400 - pulse * 450, t);
        bp.Q.value = 4.2;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.09 / (pulse + 1), t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.connect(bp);
        bp.connect(g);
        g.connect(this.masterGain);
        src.start(t);
        src.stop(t + 0.055);
      }
    } else if (isUpshift && car?.id === 'gt3-rs' && this.noiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1400, now);
      bp.Q.value = 1.8;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.09, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.masterGain);
      src.start(now);
      src.stop(now + 0.065);
    }
  }

  public playImpact(severity: number): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    if (this.ctx.state === 'suspended') return;

    const inten = Math.max(0.15, Math.min(1, severity));
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110 + inten * 50, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.18);
    oscGain.gain.setValueAtTime(0.42 * inten, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.24);

    if (this.noiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(950 + inten * 600, now);
      bp.Q.value = 1.6;
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.36 * inten, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16 + inten * 0.12);
      src.connect(bp);
      bp.connect(nGain);
      nGain.connect(this.masterGain);
      src.start(now);
      src.stop(now + 0.3);
    }
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }
}
