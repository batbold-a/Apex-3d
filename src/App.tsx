import { useCallback, useEffect, useRef, useState } from 'react';
import { CarSelectorModal } from './components/CarSelectorModal';
import { DrivingCanvas, DrivingControllerRef } from './components/DrivingCanvas';
import { DrivingHUD } from './components/DrivingHUD';
import { GameLobby } from './components/GameLobby';
import { ValidationBenchModal } from './components/ValidationBenchModal';
import { CARS } from './data/cars';
import { MAPS } from './data/maps';
import {
  ApexDriveStore,
  BenchmarkSuiteSummary,
  getSavedCarBuild,
  loadStore,
  PinballStoredPrefs,
  saveStore,
} from './engine/storage';
import {
  DEFAULT_PINBALL_CONFIG,
  PinballConfig,
  PinballTelemetrySummary,
} from './types/pinball';
import {
  CameraMode,
  CarSpec,
  HudMode,
  MapSpec,
  ReplayStateSummary,
  TelemetryData,
  TimeOfDay,
  VehicleTuningSetup,
} from './types/vehicle';

const CAMERA_MODES: CameraMode[] = ['chase', 'hood', 'cockpit', 'wheel', 'orbit'];

const INITIAL_TELEMETRY: TelemetryData = {
  speedKmh: 0,
  speedMs: 0,
  rpm: 950,
  redlineRpm: CARS[0].redlineRpm,
  maxRpm: CARS[0].maxRpm,
  gearIndex: 1,
  gearLabel: '1',
  autoShift: true,
  throttle: 0,
  brake: 0,
  handbrake: 0,
  steerNorm: 0,
  engineTorqueNm: 0,
  wheelTorqueNm: 0,
  gearRatioActive: CARS[0].forwardRatios[0],
  diffLock: false,
  hasDiffLock: CARS[0].hasDiffLock,
  driftMode: false,
  surfaceType: 'asphalt',
  surfaceName: 'Smooth Asphalt',
  surfaceGrip: 1.08,
  surfaceRoughness: 0.04,
  slopeGradePct: 0,
  wheelCompression: [0.35, 0.35, 0.35, 0.35],
  wheelGroundContact: [true, true, true, true],
  wheelSlip: [0, 0, 0, 0],
  pitchDeg: 0,
  rollDeg: 0,
  isLugging: false,
  isRevLimiting: false,
  isAirborne: false,
  posX: 0,
  posZ: 16,
  headingDeg: 0,
  distanceKm: 0,
  zoneName: 'Proving Ground Hub',
  damage: {
    overallIntegrity: 100,
    front: 0,
    rear: 0,
    left: 0,
    right: 0,
    engineHealth: 100,
    suspensionHealth: [100, 100, 100, 100],
    alignmentPullDeg: 0,
  },
};

export default function App() {
  const [store, setStore] = useState<ApexDriveStore>(() => loadStore());
  const initialCar = CARS.find((c) => c.id === store.selectedCarId) ?? CARS[0];
  const initialBuild = getSavedCarBuild(store, initialCar);
  const initialMap = MAPS.find((m) => m.id === store.selectedMapId) ?? MAPS[0];

  const [phase, setPhase] = useState<'lobby' | 'playing'>('lobby');
  const [selectedCar, setSelectedCar] = useState<CarSpec>(initialCar);
  const [paintHex, setPaintHex] = useState<string>(initialBuild.paintHex);
  const [tuning, setTuning] = useState<VehicleTuningSetup>(initialBuild.tuning);
  const [selectedMap, setSelectedMap] = useState<MapSpec>(initialMap);
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const [hudMode, setHudMode] = useState<HudMode>(store.hudMode);
  const [debugOverlay, setDebugOverlay] = useState<boolean>(store.debugOverlay);
  const [driftMode, setDriftMode] = useState<boolean>(store.driftMode);
  const [replayRecordingEnabled, setReplayRecordingEnabled] = useState<boolean>(
    store.replayRecordingEnabled
  );
  const [replayState, setReplayState] = useState<ReplayStateSummary>(() => ({
    recordingEnabled: store.replayRecordingEnabled,
    isReplaying: false,
    isPlaying: true,
    playbackSpeed: 0.5,
    cameraMode: 'director',
    activeDirectorShot: 'Trackside Telephoto',
    cinemaBars: true,
    showDrivingLine: true,
    showReplayTelemetry: true,
    currentTimeSec: 0,
    durationSec: 0,
    bufferedSeconds: 0,
    frameCount: 0,
  }));
  const [pinballConfig, setPinballConfig] = useState<PinballConfig>(() => ({
    ...DEFAULT_PINBALL_CONFIG,
    ...store.pinballPrefs,
    enabled: false,
  }));
  const [pinballSummary, setPinballSummary] = useState<PinballTelemetrySummary>(() => ({
    ...DEFAULT_PINBALL_CONFIG,
    ...store.pinballPrefs,
    enabled: false,
    activeAiCount: 0,
    lastImpactImpulseNs: 0,
    lastImpactSpeedKmh: 0,
    lastImpactAtMs: 0,
    hitCount: 0,
    perfThrottled: false,
    aiRadarBlips: [],
  }));
  const [garageOpen, setGarageOpen] = useState<boolean>(false);
  const [benchOpen, setBenchOpen] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(false);
  const [dockOpen, setDockOpen] = useState<boolean>(true);
  const [telemetry, setTelemetry] = useState<TelemetryData>(() => ({
    ...INITIAL_TELEMETRY,
    driftMode: store.driftMode,
    redlineRpm: initialCar.redlineRpm,
    maxRpm: initialCar.maxRpm,
    gearRatioActive: initialCar.forwardRatios[0],
    hasDiffLock: initialCar.hasDiffLock,
  }));

  const controllerRef = useRef<DrivingControllerRef | null>(null);

  useEffect(() => {
    saveStore(store);
  }, [store]);

  const handleCycleCamera = useCallback(() => {
    setCameraMode((prev) => {
      const idx = CAMERA_MODES.indexOf(prev);
      return CAMERA_MODES[(idx + 1) % CAMERA_MODES.length];
    });
  }, []);

  const handleToggleGarage = useCallback(() => {
    setGarageOpen((v) => !v);
  }, []);

  const handleToggleMute = useCallback(() => {
    setMuted((v) => !v);
  }, []);

  const handleToggleDock = useCallback(() => {
    setDockOpen((v) => !v);
  }, []);

  const handleToggleHudMode = useCallback(() => {
    setHudMode((prev) => {
      const next: HudMode = prev === 'horizon' ? 'beamng' : 'horizon';
      setStore((s) => ({ ...s, hudMode: next }));
      return next;
    });
  }, []);

  const handleToggleDebugOverlay = useCallback(() => {
    setDebugOverlay((prev) => {
      const next = !prev;
      setStore((s) => ({ ...s, debugOverlay: next }));
      return next;
    });
  }, []);

  const handleToggleDriftMode = useCallback(() => {
    setDriftMode((prev) => {
      const next = !prev;
      setStore((s) => ({ ...s, driftMode: next }));
      return next;
    });
  }, []);

  const handleToggleReplayRecording = useCallback(() => {
    setReplayRecordingEnabled((prev) => {
      const next = !prev;
      setStore((s) => ({ ...s, replayRecordingEnabled: next }));
      setReplayState((rs) => ({ ...rs, recordingEnabled: next }));
      return next;
    });
  }, []);

  const handleTogglePinball = useCallback(() => {
    setPinballConfig((prev) => ({
      ...prev,
      enabled: !prev.enabled,
    }));
  }, []);

  const defaultTimeForMap: TimeOfDay = selectedMap.id === 'highway-circuit' ? 'night' : 'day';
  const timeOfDay: TimeOfDay = store.mapTimeOfDay[selectedMap.id] ?? defaultTimeForMap;

  const handleToggleTimeOfDay = useCallback(() => {
    setStore((s) => {
      const fallback: TimeOfDay = selectedMap.id === 'highway-circuit' ? 'night' : 'day';
      const current = s.mapTimeOfDay[selectedMap.id] ?? fallback;
      const next: TimeOfDay = current === 'day' ? 'night' : 'day';
      return {
        ...s,
        mapTimeOfDay: {
          ...s.mapTimeOfDay,
          [selectedMap.id]: next,
        },
      };
    });
  }, [selectedMap.id]);

  const handleUpdatePinballConfig = useCallback((patch: Partial<PinballConfig>) => {
    setPinballConfig((prev) => {
      const next = { ...prev, ...patch };
      const prefs: PinballStoredPrefs = {
        multiplier: next.multiplier,
        upwardLaunchScale: next.upwardLaunchScale,
        barrierBounceScale: next.barrierBounceScale,
        aiCount: next.aiCount,
        aiBehavior: next.aiBehavior,
        aiTargetSpeedKmh: next.aiTargetSpeedKmh,
        aiAggression: next.aiAggression,
        aiSpawnDistanceM: next.aiSpawnDistanceM,
      };
      setStore((s) => ({ ...s, pinballPrefs: prefs }));
      return next;
    });
  }, []);

  const handleSelectCar = useCallback(
    (car: CarSpec) => {
      const saved = getSavedCarBuild(store, car);
      setSelectedCar(car);
      setPaintHex(saved.paintHex);
      setTuning(saved.tuning);
      setStore((s) => ({
        ...s,
        selectedCarId: car.id,
        carBuilds: {
          ...s.carBuilds,
          [car.id]: saved,
        },
      }));
    },
    [store]
  );

  const handleSelectPaint = useCallback(
    (hex: string) => {
      setPaintHex(hex);
      setStore((s) => ({
        ...s,
        carBuilds: {
          ...s.carBuilds,
          [selectedCar.id]: {
            paintHex: hex,
            tuning,
          },
        },
      }));
    },
    [selectedCar.id, tuning]
  );

  const handleSelectMap = useCallback((map: MapSpec) => {
    setSelectedMap(map);
    setStore((s) => ({ ...s, selectedMapId: map.id }));
  }, []);

  const handleSaveBenchmark = useCallback((summary: BenchmarkSuiteSummary) => {
    setStore((s) => ({
      ...s,
      benchmarkRecords: {
        ...s.benchmarkRecords,
        [summary.carId]: summary,
      },
    }));
  }, []);

  if (phase === 'lobby') {
    return (
      <GameLobby
        selectedCar={selectedCar}
        selectedPaint={paintHex}
        selectedMap={selectedMap}
        onSelectCar={handleSelectCar}
        onSelectPaint={handleSelectPaint}
        onSelectMap={handleSelectMap}
        onStartDrive={() => setPhase('playing')}
      />
    );
  }

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0B0E14]">
      <DrivingCanvas
        car={selectedCar}
        paintHex={paintHex}
        tuning={tuning}
        mapId={selectedMap.id}
        timeOfDay={timeOfDay}
        cameraMode={cameraMode}
        muted={muted}
        debugOverlay={debugOverlay}
        driftMode={driftMode}
        replayRecordingEnabled={replayRecordingEnabled}
        pinballConfig={pinballConfig}
        onTelemetry={setTelemetry}
        onReplayState={setReplayState}
        onPinballTelemetry={setPinballSummary}
        onCycleCamera={handleCycleCamera}
        onToggleGarage={handleToggleGarage}
        onToggleMute={handleToggleMute}
        onToggleDock={handleToggleDock}
        onToggleDebugOverlay={handleToggleDebugOverlay}
        onToggleDriftMode={handleToggleDriftMode}
        onTogglePinball={handleTogglePinball}
        onToggleTimeOfDay={handleToggleTimeOfDay}
        controllerRef={controllerRef}
      />

      <DrivingHUD
        car={selectedCar}
        selectedPaint={paintHex}
        mapId={selectedMap.id}
        timeOfDay={timeOfDay}
        telemetry={telemetry}
        cameraMode={cameraMode}
        hudMode={hudMode}
        debugOverlay={debugOverlay}
        muted={muted}
        dockOpen={dockOpen}
        replayState={replayState}
        pinballConfig={pinballConfig}
        pinballSummary={pinballSummary}
        onToggleReplayRecording={handleToggleReplayRecording}
        onToggleDock={handleToggleDock}
        onToggleHudMode={handleToggleHudMode}
        onToggleDebugOverlay={handleToggleDebugOverlay}
        onToggleTimeOfDay={handleToggleTimeOfDay}
        onOpenBench={() => {
          setPinballConfig((p) => (p.enabled ? { ...p, enabled: false } : p));
          setBenchOpen(true);
        }}
        onCycleCamera={handleCycleCamera}
        onSelectCamera={setCameraMode}
        onSelectCar={handleSelectCar}
        onSelectPaint={handleSelectPaint}
        onOpenGarage={() => setGarageOpen(true)}
        onOpenLobby={() => {
          controllerRef.current?.exitReplay();
          setPinballConfig((p) => (p.enabled ? { ...p, enabled: false } : p));
          setGarageOpen(false);
          setBenchOpen(false);
          setPhase('lobby');
        }}
        onToggleMute={handleToggleMute}
        onUpdatePinballConfig={handleUpdatePinballConfig}
        onTogglePinball={handleTogglePinball}
        controllerRef={controllerRef}
      />

      <CarSelectorModal
        open={garageOpen}
        selectedCar={selectedCar}
        selectedPaint={paintHex}
        onSelectCar={handleSelectCar}
        onSelectPaint={handleSelectPaint}
        onClose={() => setGarageOpen(false)}
      />

      <ValidationBenchModal
        open={benchOpen}
        car={selectedCar}
        tuning={tuning}
        telemetry={telemetry}
        savedRecord={store.benchmarkRecords[selectedCar.id]}
        onSaveRecord={handleSaveBenchmark}
        onClose={() => setBenchOpen(false)}
      />
    </main>
  );
}
