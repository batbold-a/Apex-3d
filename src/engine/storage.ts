import { DEFAULT_PINBALL_CONFIG, PinballConfig } from '../types/pinball';
import { CarSpec, HudMode, MapId, TimeOfDay, VehicleTuningSetup } from '../types/vehicle';
import { cloneTuning, createDefaultTuning } from './dynamics/tuning';

export interface BenchmarkMetricItem {
  id: string;
  name: string;
  measured: string;
  target: string;
  passed: boolean;
  notes?: string;
}

export interface BenchmarkSuiteSummary {
  carId: string;
  carName: string;
  timestampIso: string;
  passedCount: number;
  totalCount: number;
  results: BenchmarkMetricItem[];
}

export interface CarBuildRecord {
  paintHex: string;
  tuning: VehicleTuningSetup;
}

export type PinballStoredPrefs = Omit<PinballConfig, 'enabled'>;

export interface ApexDriveStore {
  version: number;
  hudMode: HudMode;
  debugOverlay: boolean;
  driftMode: boolean;
  replayRecordingEnabled: boolean;
  selectedCarId: string;
  selectedMapId: MapId;
  mapTimeOfDay: Partial<Record<MapId, TimeOfDay>>;
  pinballPrefs: PinballStoredPrefs;
  carBuilds: Record<string, CarBuildRecord>;
  benchmarkRecords: Record<string, BenchmarkSuiteSummary>;
}

const STORAGE_KEY = 'apex_drive_sim_v1';

function getDefaultPinballPrefs(): PinballStoredPrefs {
  const { enabled: _ignored, ...rest } = DEFAULT_PINBALL_CONFIG;
  return { ...rest };
}

function getDefaultStore(): ApexDriveStore {
  return {
    version: 1,
    hudMode: 'horizon',
    debugOverlay: false,
    driftMode: false,
    replayRecordingEnabled: true,
    selectedCarId: 'gt3-rs',
    selectedMapId: 'proving-valley',
    mapTimeOfDay: {},
    pinballPrefs: getDefaultPinballPrefs(),
    carBuilds: {},
    benchmarkRecords: {},
  };
}

export function loadStore(): ApexDriveStore {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return getDefaultStore();
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultStore();
    const parsed = JSON.parse(raw) as Partial<ApexDriveStore>;
    const defaults = getDefaultStore();
    const rawPb = parsed.pinballPrefs;
    const defPb = defaults.pinballPrefs;
    return {
      version: 1,
      hudMode: parsed.hudMode === 'beamng' ? 'beamng' : 'horizon',
      debugOverlay: Boolean(parsed.debugOverlay),
      driftMode: Boolean(parsed.driftMode),
      replayRecordingEnabled:
        typeof parsed.replayRecordingEnabled === 'boolean'
          ? parsed.replayRecordingEnabled
          : defaults.replayRecordingEnabled,
      selectedCarId: typeof parsed.selectedCarId === 'string' ? parsed.selectedCarId : defaults.selectedCarId,
      selectedMapId: typeof parsed.selectedMapId === 'string' ? (parsed.selectedMapId as MapId) : defaults.selectedMapId,
      mapTimeOfDay:
        parsed.mapTimeOfDay && typeof parsed.mapTimeOfDay === 'object'
          ? parsed.mapTimeOfDay
          : {},
      pinballPrefs: rawPb && typeof rawPb === 'object'
        ? {
            multiplier: typeof rawPb.multiplier === 'number' ? Math.max(1, Math.min(5, Math.round(rawPb.multiplier))) : defPb.multiplier,
            upwardLaunchScale: typeof rawPb.upwardLaunchScale === 'number' ? Math.max(0, Math.min(1, rawPb.upwardLaunchScale)) : defPb.upwardLaunchScale,
            barrierBounceScale: typeof rawPb.barrierBounceScale === 'number' ? Math.max(0, Math.min(0.6, rawPb.barrierBounceScale)) : defPb.barrierBounceScale,
            aiCount: typeof rawPb.aiCount === 'number' ? Math.max(0, Math.min(8, Math.round(rawPb.aiCount))) : defPb.aiCount,
            aiBehavior:
              rawPb.aiBehavior === 'cruise' || rawPb.aiBehavior === 'evade' || rawPb.aiBehavior === 'arena'
                ? rawPb.aiBehavior
                : defPb.aiBehavior,
            aiTargetSpeedKmh: typeof rawPb.aiTargetSpeedKmh === 'number' ? Math.max(25, Math.min(160, rawPb.aiTargetSpeedKmh)) : defPb.aiTargetSpeedKmh,
            aiAggression: typeof rawPb.aiAggression === 'number' ? Math.max(0, Math.min(1, rawPb.aiAggression)) : defPb.aiAggression,
            aiSpawnDistanceM: typeof rawPb.aiSpawnDistanceM === 'number' ? Math.max(24, Math.min(140, rawPb.aiSpawnDistanceM)) : defPb.aiSpawnDistanceM,
          }
        : defPb,
      carBuilds: parsed.carBuilds && typeof parsed.carBuilds === 'object' ? parsed.carBuilds : {},
      benchmarkRecords:
        parsed.benchmarkRecords && typeof parsed.benchmarkRecords === 'object' ? parsed.benchmarkRecords : {},
    };
  } catch {
    return getDefaultStore();
  }
}

export function saveStore(store: ApexDriveStore): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota / private mode restrictions
  }
}

export function getSavedCarBuild(store: ApexDriveStore, car: CarSpec): CarBuildRecord {
  const existing = store.carBuilds[car.id];
  const baseTuning = createDefaultTuning(car);
  if (!existing) {
    return {
      paintHex: car.defaultColor,
      tuning: baseTuning,
    };
  }
  return {
    paintHex: typeof existing.paintHex === 'string' ? existing.paintHex : car.defaultColor,
    tuning: existing.tuning
      ? {
          ...baseTuning,
          ...existing.tuning,
          gearRatios:
            Array.isArray(existing.tuning.gearRatios) &&
            existing.tuning.gearRatios.length === car.forwardRatios.length
              ? [...existing.tuning.gearRatios]
              : baseTuning.gearRatios,
        }
      : cloneTuning(baseTuning),
  };
}
