import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EngineAudio } from '../engine/audio';
import { CarVisualRig, createCarVisualRig } from '../engine/carModels';
import { PhysicsDebugOverlay } from '../engine/debugOverlay';
import { VehicleInput, VehiclePhysics } from '../engine/physics';
import { PinballMode } from '../engine/pinball/PinballMode';
import { ensureRapierInitialized, RapierWorldManager } from '../engine/rapierWorld';
import {
  createEmptyReplayFrame,
  ReplayCameraController,
  ReplayLineVisualizer,
  TelemetryReplayRecorder,
} from '../engine/replay';
import { getTerrainHeightRaw } from '../engine/terrain';
import {
  buildProvingGroundWorld,
  createOutdoorReflectionTexture,
  WorldHandles,
} from '../engine/world';
import { MAPS } from '../data/maps';
import {
  PinballConfig,
  PinballTelemetrySummary,
} from '../types/pinball';
import {
  CameraMode,
  CarSpec,
  MapId,
  ReplayCameraMode,
  ReplayStateSummary,
  TelemetryData,
  TimeOfDay,
  VehicleTuningSetup,
} from '../types/vehicle';

export type QuickZoneId =
  | 'hub'
  | 'highway'
  | 'bumps'
  | 'mountain'
  | 'ramps'
  | 'driftpad'
  | 'rallystage'
  | 'crash'
  | 'basecamp'
  | 'midclimb'
  | 'summit'
  | 'wash'
  | 'whoops'
  | 'jumps'
  | 'loop'
  | 'straight'
  | 'skidpad'
  | 'splitmu'
  | 'dlc'
  | 'susprig'
  | 'traction';

export interface DrivingControllerRef {
  shiftUp: () => void;
  shiftDown: () => void;
  setGear: (gear: number) => void;
  toggleAutoShift: () => boolean;
  toggleDiffLock: () => boolean;
  toggleDriftMode: () => boolean;
  resetCar: (zone?: QuickZoneId) => void;
  repairCar: () => void;
  setTouchInput: (key: Exclude<keyof VehicleInput, 'steerOverride'>, active: boolean) => void;
  enterReplay: () => void;
  exitReplay: () => void;
  toggleReplay: () => void;
  setReplayPlaying: (playing: boolean) => void;
  setReplaySpeed: (speed: number) => void;
  setReplayCamera: (mode: ReplayCameraMode) => void;
  cycleReplayCamera: () => void;
  seekReplay: (timeSec: number) => void;
  setReplayCinemaBars: (enabled: boolean) => void;
  setReplayShowLine: (enabled: boolean) => void;
  setReplayShowTelemetry: (enabled: boolean) => void;
  respawnPinballAi: () => void;
}

interface DrivingCanvasProps {
  car: CarSpec;
  paintHex: string;
  tuning: VehicleTuningSetup;
  mapId: MapId;
  timeOfDay: TimeOfDay;
  cameraMode: CameraMode;
  muted: boolean;
  debugOverlay: boolean;
  driftMode: boolean;
  replayRecordingEnabled: boolean;
  pinballConfig: PinballConfig;
  onTelemetry: (data: TelemetryData) => void;
  onReplayState: (summary: ReplayStateSummary) => void;
  onPinballTelemetry: (summary: PinballTelemetrySummary) => void;
  onCycleCamera: () => void;
  onToggleGarage: () => void;
  onToggleMute: () => void;
  onToggleDock: () => void;
  onToggleDebugOverlay: () => void;
  onToggleDriftMode: () => void;
  onTogglePinball: () => void;
  onToggleTimeOfDay: () => void;
  controllerRef: React.MutableRefObject<DrivingControllerRef | null>;
}

// Pre-allocated scratch math helpers (zero GC inside tick)
const _camDesiredPos = new THREE.Vector3();
const _camDesiredLook = new THREE.Vector3();
const _camCurrentLook = new THREE.Vector3();
const _localOffset = new THREE.Vector3();
const _localLook = new THREE.Vector3();
const _forwardVec = new THREE.Vector3();
const _hitLocalPos = new THREE.Vector3();
const _hitLocalNorm = new THREE.Vector3();
const _hoodSmokeWorld = new THREE.Vector3();

export const DrivingCanvas: React.FC<DrivingCanvasProps> = ({
  car,
  paintHex,
  tuning,
  mapId,
  timeOfDay,
  cameraMode,
  muted,
  debugOverlay,
  driftMode,
  replayRecordingEnabled,
  pinballConfig,
  onTelemetry,
  onReplayState,
  onPinballTelemetry,
  onCycleCamera,
  onToggleGarage,
  onToggleMute,
  onToggleDock,
  onToggleDebugOverlay,
  onToggleDriftMode,
  onTogglePinball,
  onToggleTimeOfDay,
  controllerRef,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Latest props in refs so main WebGL loop never restarts on UI state changes
  const carRef = useRef<CarSpec>(car);
  const paintRef = useRef<string>(paintHex);
  const tuningRef = useRef<VehicleTuningSetup>(tuning);
  const timeOfDayRef = useRef<TimeOfDay>(timeOfDay);
  const cameraModeRef = useRef<CameraMode>(cameraMode);
  const mutedRef = useRef<boolean>(muted);
  const debugOverlayRef = useRef<boolean>(debugOverlay);
  const driftModeRef = useRef<boolean>(driftMode);
  const replayRecordingRef = useRef<boolean>(replayRecordingEnabled);
  const pinballConfigRef = useRef<PinballConfig>(pinballConfig);
  const callbacksRef = useRef({
    onTelemetry,
    onReplayState,
    onPinballTelemetry,
    onCycleCamera,
    onToggleGarage,
    onToggleMute,
    onToggleDock,
    onToggleDebugOverlay,
    onToggleDriftMode,
    onTogglePinball,
    onToggleTimeOfDay,
  });

  carRef.current = car;
  paintRef.current = paintHex;
  tuningRef.current = tuning;
  timeOfDayRef.current = timeOfDay;
  cameraModeRef.current = cameraMode;
  mutedRef.current = muted;
  debugOverlayRef.current = debugOverlay;
  driftModeRef.current = driftMode;
  replayRecordingRef.current = replayRecordingEnabled;
  pinballConfigRef.current = pinballConfig;
  callbacksRef.current = {
    onTelemetry,
    onReplayState,
    onPinballTelemetry,
    onCycleCamera,
    onToggleGarage,
    onToggleMute,
    onToggleDock,
    onToggleDebugOverlay,
    onToggleDriftMode,
    onTogglePinball,
    onToggleTimeOfDay,
  };

  // Live engine handles
  const physicsRef = useRef<VehiclePhysics | null>(null);
  const pinballRef = useRef<PinballMode | null>(null);
  const audioRef = useRef<EngineAudio | null>(null);
  const rigRef = useRef<CarVisualRig | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const worldRef = useRef<WorldHandles | null>(null);
  const replayLineRef = useRef<ReplayLineVisualizer | null>(null);
  const debugGizmosRef = useRef<PhysicsDebugOverlay | null>(null);
  const recorderRef = useRef<TelemetryReplayRecorder | null>(null);
  const exitReplayFnRef = useRef<(() => void) | null>(null);

  // Sync mute state
  useEffect(() => {
    audioRef.current?.setMuted(muted);
  }, [muted]);

  // Sync debug overlay visibility
  useEffect(() => {
    debugGizmosRef.current?.setVisible(debugOverlay);
  }, [debugOverlay]);

  // Sync Drift Control Mode
  useEffect(() => {
    const p = physicsRef.current;
    if (p) {
      p.setDriftMode(driftMode);
      callbacksRef.current.onTelemetry(p.getTelemetry());
    }
  }, [driftMode]);

  // Sync Tuning Setup
  useEffect(() => {
    const p = physicsRef.current;
    if (p) {
      p.setTuning(tuning);
    }
  }, [tuning]);

  // Sync Pinball Mode & AI Fleet configuration live
  useEffect(() => {
    const pb = pinballRef.current;
    if (pb) {
      pb.setConfig(pinballConfig);
      callbacksRef.current.onPinballTelemetry(pb.getTelemetrySummary());
    }
  }, [pinballConfig]);

  // Sync Day / Night Lighting & Headlights live without interrupting physics
  useEffect(() => {
    const world = worldRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (world && renderer && scene) {
      world.setTimeOfDay(timeOfDay, renderer, scene);
      if (scene.fog instanceof THREE.FogExp2) {
        replayLineRef.current?.setFog(scene.fog.color.getHex(), scene.fog.density);
      }
    }
    const isNight = timeOfDay === 'night';
    rigRef.current?.setNightMode(isNight);
    pinballRef.current?.setNightMode(isNight);
  }, [timeOfDay]);

  // Swap 3D car model cleanly when selected car changes
  useEffect(() => {
    const scene = sceneRef.current;
    const physics = physicsRef.current;
    if (!scene || !physics) return;

    exitReplayFnRef.current?.();
    recorderRef.current?.clear();

    physics.setCar(car, true, tuningRef.current);
    physics.setDriftMode(driftModeRef.current);
    callbacksRef.current.onTelemetry(physics.getTelemetry());

    if (rigRef.current) {
      scene.remove(rigRef.current.root);
      rigRef.current.dispose();
    }
    const newRig = createCarVisualRig(car, paintHex, { enableSpotBeams: true });
    newRig.setNightMode(timeOfDayRef.current === 'night');
    scene.add(newRig.root);
    rigRef.current = newRig;
  }, [car]);

  // Update exterior paint color live without rebuilding geometry
  useEffect(() => {
    if (rigRef.current) {
      rigRef.current.bodyPaintMat.color.set(paintHex);
    }
  }, [paintHex]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Software WebGL guard
    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglError('WebGL is unavailable in this browser environment.');
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglError('Graphics context interrupted. Attempting recovery…');
    };
    const onContextRestored = () => {
      setWebglError(null);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Outdoor Sky-Horizon-Sun PMREM Environment Reflection for crisp clearcoat & glass reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = createOutdoorReflectionTexture(pmremGenerator, mapId, timeOfDayRef.current);
    scene.environment = envTex;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(
      62,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.15,
      1700
    );

    const activeMap = MAPS.find((m) => m.id === mapId) ?? MAPS[0];
    const world = buildProvingGroundWorld(scene, renderer, mapId, timeOfDayRef.current);
    worldRef.current = world;

    const rig = createCarVisualRig(carRef.current, paintRef.current, { enableSpotBeams: true });
    rig.setNightMode(timeOfDayRef.current === 'night');
    scene.add(rig.root);
    rigRef.current = rig;

    const debugGizmos = new PhysicsDebugOverlay();
    debugGizmos.setVisible(debugOverlayRef.current);
    scene.add(debugGizmos.group);
    debugGizmosRef.current = debugGizmos;

    const fogHex = scene.fog instanceof THREE.FogExp2 ? scene.fog.color.getHex() : 0x0b0e14;
    const fogDensity = scene.fog instanceof THREE.FogExp2 ? scene.fog.density : 0.0012;
    const recorder = new TelemetryReplayRecorder();
    recorderRef.current = recorder;
    const replayLine = new ReplayLineVisualizer(fogHex, fogDensity);
    replayLineRef.current = replayLine;
    scene.add(replayLine.mesh);
    const replayCam = new ReplayCameraController();
    const replaySample = createEmptyReplayFrame();

    const audio = new EngineAudio();
    audio.setMuted(mutedRef.current);
    audioRef.current = audio;

    let rapier: RapierWorldManager | null = null;
    let physics: VehiclePhysics | null = null;
    let pinball: PinballMode | null = null;
    let particleTelemetry: TelemetryData | null = null;

    // Replay playback state
    const REPLAY_CAM_ORDER: ReplayCameraMode[] = [
      'director',
      'trackside',
      'helicopter',
      'fender',
      'chase',
      'hood',
      'cockpit',
    ];
    let isReplaying = false;
    let replayPlaying = true;
    let replaySpeed = 0.5;
    let replayCameraMode: ReplayCameraMode = 'director';
    let replayCinemaBars = true;
    let replayShowLine = true;
    let replayShowTelemetry = true;
    let replayTimeSec = 0;

    // Keyboard + touch input state
    const keysDown = new Set<string>();
    const touchInput: VehicleInput = {
      throttle: false,
      brake: false,
      steerLeft: false,
      steerRight: false,
      handbrake: false,
    };

    const doShiftUp = () => {
      audio.init();
      if (physicsRef.current?.shiftUp()) {
        audio.playShiftClunk(true, physicsRef.current.car);
      }
    };

    const doShiftDown = () => {
      audio.init();
      if (physicsRef.current?.shiftDown()) {
        audio.playShiftClunk(false, physicsRef.current.car);
      }
    };

    const doSetGear = (g: number) => {
      audio.init();
      const prev = physicsRef.current?.gearIndex ?? 1;
      if (physicsRef.current?.setGear(g)) {
        audio.playShiftClunk(g > prev, physicsRef.current.car);
      }
    };

    const doToggleAutoShift = () => {
      audio.init();
      const p = physicsRef.current;
      if (!p) return true;
      const isAuto = p.toggleAutoShift();
      audio.playShiftClunk(isAuto, p.car);
      callbacksRef.current.onTelemetry(p.getTelemetry());
      return isAuto;
    };

    const doToggleDiffLock = () => {
      audio.init();
      const p = physicsRef.current;
      if (!p || !p.car.hasDiffLock) return false;
      const locked = p.toggleDiffLock();
      audio.playShiftClunk(locked, p.car);
      callbacksRef.current.onTelemetry(p.getTelemetry());
      return locked;
    };

    const doToggleDriftMode = () => {
      audio.init();
      callbacksRef.current.onToggleDriftMode();
      const p = physicsRef.current;
      if (p) {
        audio.playShiftClunk(!p.driftMode, p.car);
        return !p.driftMode;
      }
      return false;
    };

    const doResetCar = (zone?: QuickZoneId) => {
      const p = physicsRef.current;
      if (!p) return;
      if (zone === 'highway') {
        p.reset(new THREE.Vector3(0, 0, 16), 0);
      } else if (zone === 'bumps') {
        p.reset(new THREE.Vector3(-42, 0, 0), Math.PI / 2);
      } else if (zone === 'mountain') {
        p.reset(new THREE.Vector3(-56, 0, -56), Math.PI * 0.25);
      } else if (zone === 'ramps') {
        p.reset(new THREE.Vector3(44, 0, -18), -Math.PI / 2);
      } else if (zone === 'driftpad') {
        p.reset(new THREE.Vector3(90, 0, -120), -Math.PI * 0.5);
      } else if (zone === 'rallystage') {
        p.reset(new THREE.Vector3(48, 0, 115), -Math.PI * 0.42);
      } else if (zone === 'crash') {
        p.reset(new THREE.Vector3(19.5, 0, -2), 0);
      } else if (zone === 'basecamp') {
        p.reset(new THREE.Vector3(0, 0, 145), 0);
      } else if (zone === 'midclimb') {
        p.reset(new THREE.Vector3(Math.sin(25 * 0.022) * 58, 0, 25), 0.35);
      } else if (zone === 'summit') {
        p.reset(new THREE.Vector3(Math.sin(-158 * 0.022) * 58, 0, -158), 0);
      } else if (zone === 'wash') {
        p.reset(new THREE.Vector3(0, 0, 130), 0);
      } else if (zone === 'whoops') {
        p.reset(new THREE.Vector3(-60, 0, 88), 0);
      } else if (zone === 'jumps') {
        p.reset(new THREE.Vector3(0, 0, 82), 0);
      } else if (zone === 'loop') {
        p.reset(new THREE.Vector3(210, 0, 20), 0);
      } else if (zone === 'straight') {
        p.reset(new THREE.Vector3(0, 0, 260), 0);
      } else if (zone === 'skidpad') {
        p.reset(new THREE.Vector3(-50, 0, 0), 0);
      } else if (zone === 'splitmu') {
        p.reset(new THREE.Vector3(46, 0, 145), 0);
      } else if (zone === 'dlc') {
        p.reset(new THREE.Vector3(-28, 0, 75), 0);
      } else if (zone === 'susprig') {
        p.reset(new THREE.Vector3(110, 0, -82), Math.PI);
      } else if (zone === 'traction') {
        p.reset(new THREE.Vector3(48, 0, 280), 0);
      } else if (zone === 'hub') {
        p.reset(new THREE.Vector3(...activeMap.spawnPos), activeMap.spawnHeading);
      } else {
        // Reset upright in place
        const e = new THREE.Euler().setFromQuaternion(p.quaternion, 'YXZ');
        p.reset(new THREE.Vector3(p.position.x, p.position.y, p.position.z), e.y);
      }
    };

    const doRepairCar = () => {
      const p = physicsRef.current;
      const r = rigRef.current;
      if (p) {
        p.repairDamage();
        callbacksRef.current.onTelemetry(p.getTelemetry());
      }
      if (r) {
        r.resetDeformation();
      }
    };

    const emitReplayState = () => {
      const dur = recorder.getDurationSec();
      callbacksRef.current.onReplayState({
        recordingEnabled: replayRecordingRef.current,
        isReplaying,
        isPlaying: replayPlaying,
        playbackSpeed: replaySpeed,
        cameraMode: replayCameraMode,
        activeDirectorShot: replayCam.getActiveShotLabel(replayCameraMode),
        cinemaBars: replayCinemaBars,
        showDrivingLine: replayShowLine,
        showReplayTelemetry: replayShowTelemetry,
        currentTimeSec: replayTimeSec,
        durationSec: dur,
        bufferedSeconds: dur,
        frameCount: recorder.getFrameCount(),
      });
    };

    const doEnterReplay = () => {
      const p = physicsRef.current;
      if (!p || isReplaying || recorder.getDurationSec() < 0.25) return;
      audio.init();
      isReplaying = true;
      replayPlaying = true;
      replayTimeSec = 0;
      camYawOffset = 0;
      camPitchOffset = 0.22;
      camZoomScale = 1.0;
      replayLine.rebuildFromRecorder(recorder, p.car);
      replayLine.setVisible(replayShowLine);
      replayLine.setCurrentTime(0);
      replayCam.reset(0);
      audio.setPaused(false);
      if (pinball) {
        const units = pinball.fleet.getUnits();
        for (let i = 0; i < units.length; i++) {
          const rig = units[i].rig;
          if (rig) rig.root.visible = false;
        }
      }
      emitReplayState();
    };

    const doExitReplay = () => {
      if (!isReplaying) return;
      isReplaying = false;
      replayLine.setVisible(false);
      camera.up.set(0, 1, 0);
      camYawOffset = 0;
      camPitchOffset = 0.22;
      camZoomScale = 1.0;
      audio.setPaused(false);
      if (pinball) {
        const units = pinball.fleet.getUnits();
        for (let i = 0; i < units.length; i++) {
          const rig = units[i].rig;
          if (rig) rig.root.visible = true;
        }
      }
      const p = physicsRef.current;
      if (p) {
        callbacksRef.current.onTelemetry(p.getTelemetry());
      }
      emitReplayState();
    };
    exitReplayFnRef.current = doExitReplay;

    const doToggleReplay = () => {
      if (isReplaying) doExitReplay();
      else doEnterReplay();
    };

    const doCycleReplayCamera = () => {
      const idx = REPLAY_CAM_ORDER.indexOf(replayCameraMode);
      replayCameraMode = REPLAY_CAM_ORDER[(idx + 1) % REPLAY_CAM_ORDER.length];
      camYawOffset = 0;
      camPitchOffset = 0.22;
      camZoomScale = 1.0;
      replayCam.requestCut();
      emitReplayState();
    };

    controllerRef.current = {
      shiftUp: doShiftUp,
      shiftDown: doShiftDown,
      setGear: doSetGear,
      toggleAutoShift: doToggleAutoShift,
      toggleDiffLock: doToggleDiffLock,
      toggleDriftMode: doToggleDriftMode,
      resetCar: doResetCar,
      repairCar: doRepairCar,
      setTouchInput: (key, active) => {
        audio.init();
        touchInput[key] = active;
      },
      enterReplay: doEnterReplay,
      exitReplay: doExitReplay,
      toggleReplay: doToggleReplay,
      setReplayPlaying: (playing) => {
        audio.init();
        replayPlaying = playing;
        if (isReplaying) {
          audio.setPaused(!playing);
          emitReplayState();
        }
      },
      setReplaySpeed: (speed) => {
        replaySpeed = THREE.MathUtils.clamp(speed, 0.1, 2.0);
        if (isReplaying) emitReplayState();
      },
      setReplayCamera: (mode) => {
        replayCameraMode = mode;
        camYawOffset = 0;
        camPitchOffset = 0.22;
        camZoomScale = 1.0;
        replayCam.requestCut();
        if (isReplaying) emitReplayState();
      },
      cycleReplayCamera: doCycleReplayCamera,
      seekReplay: (timeSec) => {
        const dur = recorder.getDurationSec();
        const nextT = THREE.MathUtils.clamp(timeSec, 0, dur);
        if (Math.abs(nextT - replayTimeSec) > 0.65) {
          replayCam.requestCut();
        }
        replayTimeSec = nextT;
        replayLine.setCurrentTime(replayTimeSec);
        if (isReplaying) emitReplayState();
      },
      setReplayCinemaBars: (enabled) => {
        replayCinemaBars = enabled;
        if (isReplaying) emitReplayState();
      },
      setReplayShowLine: (enabled) => {
        replayShowLine = enabled;
        replayLine.setVisible(isReplaying && enabled);
        if (isReplaying) emitReplayState();
      },
      setReplayShowTelemetry: (enabled) => {
        replayShowTelemetry = enabled;
        if (isReplaying) emitReplayState();
      },
      respawnPinballAi: () => {
        pinball?.respawnAiFleet();
        if (pinball) {
          callbacksRef.current.onPinballTelemetry(pinball.getTelemetrySummary());
        }
      },
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const code = e.code;

      if (
        code === 'Space' ||
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight'
      ) {
        e.preventDefault();
        if (document.activeElement instanceof HTMLButtonElement) {
          document.activeElement.blur();
        }
      }

      audio.init();

      if (!e.repeat) {
        if (code === 'KeyP') {
          doToggleReplay();
          return;
        }
        if (code === 'KeyM') {
          callbacksRef.current.onToggleMute();
          return;
        }
        if (code === 'KeyJ') {
          callbacksRef.current.onToggleTimeOfDay();
          return;
        }
        if (isReplaying) {
          if (code === 'Escape') {
            doExitReplay();
          } else if (code === 'Space' || code === 'KeyK') {
            replayPlaying = !replayPlaying;
            audio.setPaused(!replayPlaying);
            emitReplayState();
          } else if (code === 'KeyC' || code === 'KeyV') {
            doCycleReplayCamera();
          } else if (code === 'ArrowLeft') {
            replayTimeSec = Math.max(0, replayTimeSec - 2.0);
            replayCam.requestCut();
            emitReplayState();
          } else if (code === 'ArrowRight') {
            replayTimeSec = Math.min(recorder.getDurationSec(), replayTimeSec + 2.0);
            replayCam.requestCut();
            emitReplayState();
          }
          return;
        }

        if (code === 'KeyX' || code === 'BracketRight') doShiftUp();
        else if (code === 'KeyQ' || code === 'KeyZ' || code === 'BracketLeft') doShiftDown();
        else if (code === 'KeyC' || code === 'KeyV') callbacksRef.current.onCycleCamera();
        else if (code === 'KeyG') callbacksRef.current.onToggleGarage();
        else if (code === 'KeyH') callbacksRef.current.onToggleDock();
        else if (code === 'KeyB') callbacksRef.current.onToggleDebugOverlay();
        else if (code === 'KeyT') doToggleDriftMode();
        else if (code === 'KeyU') callbacksRef.current.onTogglePinball();
        else if (code === 'KeyF') doRepairCar();
        else if (code === 'KeyL') doToggleDiffLock();
        else if (code === 'Backspace') doResetCar();
        else if (code === 'Digit1') doSetGear(1);
        else if (code === 'Digit2') doSetGear(2);
        else if (code === 'Digit3') doSetGear(3);
        else if (code === 'Digit4') doSetGear(4);
        else if (code === 'Digit5') doSetGear(5);
        else if (code === 'Digit6') doSetGear(6);
        else if (code === 'Digit7') doSetGear(7);
        else if (code === 'Digit8') doSetGear(8);
        else if (code === 'Digit9') doSetGear(9);
        else if (code === 'KeyR') doSetGear(-1);
        else if (code === 'KeyN') doSetGear(0);
      }

      keysDown.add(code);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight'
      ) {
        e.preventDefault();
      }
      keysDown.delete(e.code);
    };

    const handleBlur = () => {
      keysDown.clear();
      touchInput.throttle = false;
      touchInput.brake = false;
      touchInput.steerLeft = false;
      touchInput.steerRight = false;
      touchInput.handbrake = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Mouse-look & scroll-zoom camera state (works in every camera view)
    let isDraggingCam = false;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let camYawOffset = 0;
    let camPitchOffset = 0.22;
    let camZoomScale = 1.0;
    let userMovedOrbit = false;
    renderer.domElement.style.cursor = 'grab';

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      audio.init();
      isDraggingCam = true;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      renderer.domElement.style.cursor = 'grabbing';
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic events
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingCam) return;
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      camYawOffset -= dx * 0.0065;
      camPitchOffset = THREE.MathUtils.clamp(camPitchOffset + dy * 0.0055, -0.15, 1.18);
      userMovedOrbit = true;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isDraggingCam) return;
      isDraggingCam = false;
      renderer.domElement.style.cursor = 'grab';
      try {
        renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camZoomScale = THREE.MathUtils.clamp(camZoomScale + e.deltaY * 0.0008, 0.58, 1.95);
    };

    const onDoubleClick = () => {
      camYawOffset = 0;
      camPitchOffset = 0.22;
      camZoomScale = 1.0;
      userMovedOrbit = false;
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('dblclick', onDoubleClick);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    // Animation loop with software WebGL afterDraw pacing
    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;
    let hudAccumulator = 0;
    let orbitAngle = 0.65;
    const prevWheelContact = [true, true, true, true];

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 4);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 16);
        }
      };
      frameId = window.setTimeout(poll, 4);
    }

    function tick() {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const p = physicsRef.current;
      const r = rigRef.current;
      if (!p || !r) return;

      if (isReplaying) {
        const dur = recorder.getDurationSec();
        if (dur <= 0.05) {
          doExitReplay();
          return;
        }
        const simDt = replayPlaying ? dt * replaySpeed : 0;
        replayTimeSec += simDt;
        if (replayTimeSec > dur) {
          replayTimeSec = 0;
          replayCam.reset(0);
        }

        recorder.sampleAt(replayTimeSec, replaySample);
        replayLine.setCurrentTime(replayTimeSec);
        replayLine.setVisible(replayShowLine);

        // Drive visual car rig directly from interpolated replay frame
        r.root.position.set(replaySample.posX, replaySample.posY, replaySample.posZ);
        r.root.quaternion.set(
          replaySample.quatX,
          replaySample.quatY,
          replaySample.quatZ,
          replaySample.quatW
        );

        r.steeringWheelGroup.rotation.z = replaySample.steerSmooth * 2.2;
        const targetShiftX =
          replaySample.gearIndex === -1
            ? -0.32
            : replaySample.gearIndex === 0
              ? 0
              : replaySample.gearIndex % 2 === 1
                ? 0.24
                : -0.22;
        const targetShiftZ =
          replaySample.gearIndex === -1
            ? -0.18
            : replaySample.gearIndex <= 2
              ? 0.14
              : replaySample.gearIndex <= 4
                ? 0
                : replaySample.gearIndex <= 6
                  ? -0.14
                  : -0.22;
        r.shifterStick.rotation.x = THREE.MathUtils.damp(r.shifterStick.rotation.x, targetShiftX, 18, dt);
        r.shifterStick.rotation.z = THREE.MathUtils.damp(r.shifterStick.rotation.z, targetShiftZ, 18, dt);

        const braking = replaySample.brakeSmooth > 0.08 || replaySample.handbrakeSmooth > 0.08;
        const tailBase = timeOfDayRef.current === 'night' ? 1.55 : 0.65;
        r.brakeLightMat.emissiveIntensity = braking ? 3.8 : tailBase;
        r.reverseLightMat.emissiveIntensity = replaySample.gearIndex === -1 ? 3.2 : 0.06;

        const mountLocalY = p.car.suspensionRestLength * 0.35;
        const springTopY = mountLocalY + 0.14;
        const springNaturalLen = p.car.suspensionRestLength * 0.92;
        let maxSlip = 0;
        for (let i = 0; i < 4; i++) {
          const isRight = i === 1 || i === 3;
          r.wheelPivots[i].position.y = replaySample.wheelOffsetY[i];
          r.wheelPivots[i].rotation.y = replaySample.wheelSteerRad[i];
          r.wheelPivots[i].rotation.z = (isRight ? -1 : 1) * replaySample.suspensionDamage[i] * 0.24;
          r.wheelSpinGroups[i].rotation.x = -replaySample.wheelSpinAngle[i];

          const currentLen = Math.max(0.08, springTopY - replaySample.wheelOffsetY[i]);
          const scaleY = THREE.MathUtils.clamp(currentLen / springNaturalLen, 0.22, 1.38);
          r.springMeshes[i].scale.y = scaleY;
          r.damperRods[i].scale.y = scaleY;
          r.controlArms[i].position.y = replaySample.wheelOffsetY[i] * 0.5;
          r.controlArms[i].rotation.z = (isRight ? 1 : -1) * Math.atan2(replaySample.wheelOffsetY[i], 0.32);
          maxSlip = Math.max(maxSlip, replaySample.wheelSlip[i]);
        }

        const anyGrounded =
          replaySample.wheelGroundContact[0] ||
          replaySample.wheelGroundContact[1] ||
          replaySample.wheelGroundContact[2] ||
          replaySample.wheelGroundContact[3];
        const shadowMat = r.contactShadow.material as THREE.MeshBasicMaterial;
        shadowMat.opacity = anyGrounded ? 0.48 : 0.16;

        if (particleTelemetry && replayPlaying && simDt > 0) {
          for (let i = 0; i < 4; i++) {
            particleTelemetry.wheelSlip[i] = replaySample.wheelSlip[i];
            particleTelemetry.wheelGroundContact[i] = replaySample.wheelGroundContact[i];
            if (particleTelemetry.wheelRpm) {
              particleTelemetry.wheelRpm[i] = Math.round(
                (replaySample.wheelAngularVel[i] * 60) / (2 * Math.PI)
              );
            }
          }
          particleTelemetry.surfaceType = replaySample.surfaceType;
          particleTelemetry.speedMs = replaySample.speedMs;
          particleTelemetry.throttle = replaySample.throttleSmooth;
          particleTelemetry.brake = replaySample.brakeSmooth;
          particleTelemetry.handbrake = replaySample.handbrakeSmooth;

          _camDesiredPos.set(replaySample.posX, replaySample.posY, replaySample.posZ);
          _camDesiredLook.set(replaySample.velX, replaySample.velY, replaySample.velZ);
          world.particles.emitVehicleEffects(
            particleTelemetry,
            p.car,
            _camDesiredPos,
            r.root.quaternion,
            _camDesiredLook,
            replaySample.wheelOffsetY,
            p.wheelTerrain,
            prevWheelContact,
            simDt,
            isSoftwareGl || p.perfMonitor.overloadActive
          );
        }

        world.particles.update(simDt, camera.fov, renderer.domElement.height);
        world.updateSunFollow(replaySample.posX, replaySample.posZ);

        replayCam.updateCamera(
          camera,
          replayCameraMode,
          replaySample,
          recorder,
          p.car,
          simDt,
          dt,
          camYawOffset,
          camPitchOffset,
          camZoomScale,
          isDraggingCam
        );

        if (replayPlaying) {
          audio.setPaused(false);
          const pitchScale = replaySpeed < 1 ? 0.65 + 0.35 * replaySpeed : 1.0;
          audio.update(
            p.car,
            replaySample.rpm * pitchScale,
            replaySample.throttleSmooth,
            maxSlip,
            replaySample.avgRoughness,
            replaySample.speedMs * pitchScale,
            !anyGrounded,
            replaySample.surfaceType,
            replaySample.engineLoad,
            replaySample.boostBar
          );
        } else {
          audio.setPaused(true);
        }

        hudAccumulator += dt;
        if (hudAccumulator >= 0.055) {
          hudAccumulator = 0;
          if (particleTelemetry) {
            callbacksRef.current.onTelemetry(
              recorder.fillTelemetrySnapshot(replaySample, particleTelemetry, p.car)
            );
          }
          emitReplayState();
        }

        renderer.render(scene, camera);
        if (isSoftwareGl) {
          afterDraw(tick);
        } else {
          frameId = requestAnimationFrame(tick);
        }
        return;
      }

      const spaceDown = keysDown.has('Space');
      const pedalBrake = keysDown.has('KeyS') || keysDown.has('ArrowDown') || touchInput.brake;
      const input: VehicleInput = {
        throttle: keysDown.has('KeyW') || keysDown.has('ArrowUp') || touchInput.throttle,
        brake: pedalBrake || spaceDown,
        serviceBrakeOnly: spaceDown && !pedalBrake,
        steerLeft: keysDown.has('KeyA') || keysDown.has('ArrowLeft') || touchInput.steerLeft,
        steerRight: keysDown.has('KeyD') || keysDown.has('ArrowRight') || touchInput.steerRight,
        handbrake: keysDown.has('KeyE') || touchInput.handbrake,
      };

      p.step(dt, input);
      pinball?.updateFrameVisuals(world.particles, audio, isSoftwareGl);
      if (replayRecordingRef.current) {
        recorder.record(p, dt);
      }

      // Process collision impacts -> deform body panels, emit sparks, play crunch audio & update damaged visuals
      const collisions = p.drainCollisions();
      if (collisions.length > 0) {
        let maxSeverity = 0;
        for (let ci = 0; ci < collisions.length; ci++) {
          const c = collisions[ci];
          _hitLocalPos.set(c.localPointX, c.localPointY, c.localPointZ);
          _hitLocalNorm.set(c.localNormalX, c.localNormalY, c.localNormalZ);
          r.applyDeformation(_hitLocalPos, _hitLocalNorm, c.severity);
          maxSeverity = Math.max(maxSeverity, c.severity);

          world.particles.emitImpactSparks(
            c.worldPointX,
            c.worldPointY,
            c.worldPointZ,
            c.severity,
            isSoftwareGl || p.perfMonitor.overloadActive
          );
        }
        audio.playImpact(maxSeverity);
        r.updateDamageVisuals(p.getTelemetry().damage);
      }

      // Damaged engine hood smoke
      if (p.engineDamage > 0.32) {
        _hoodSmokeWorld
          .set((Math.random() - 0.5) * 0.36, p.car.height * 0.58, -p.car.length * 0.36)
          .applyQuaternion(p.quaternion)
          .add(p.position);
        world.particles.emitEngineSmoke(
          _hoodSmokeWorld.x,
          _hoodSmokeWorld.y,
          _hoodSmokeWorld.z,
          p.engineDamage,
          isSoftwareGl || p.perfMonitor.overloadActive
        );
      }

      // Sync visual car rig with physics
      r.root.position.copy(p.position);
      r.root.quaternion.copy(p.quaternion);

      // Rotate interior cockpit steering wheel & move gear shifter lever
      r.steeringWheelGroup.rotation.z = p.steerSmooth * 2.2;
      const targetShiftX = p.gearIndex === -1 ? -0.32 : p.gearIndex === 0 ? 0 : p.gearIndex % 2 === 1 ? 0.24 : -0.22;
      const targetShiftZ =
        p.gearIndex === -1
          ? -0.18
          : p.gearIndex <= 2
            ? 0.14
            : p.gearIndex <= 4
              ? 0
              : p.gearIndex <= 6
                ? -0.14
                : -0.22;
      r.shifterStick.rotation.x = THREE.MathUtils.damp(r.shifterStick.rotation.x, targetShiftX, 18, dt);
      r.shifterStick.rotation.z = THREE.MathUtils.damp(r.shifterStick.rotation.z, targetShiftZ, 18, dt);

      // Update brake & reverse lights
      const braking = p.brakeSmooth > 0.08 || p.handbrakeSmooth > 0.08;
      const tailBase = timeOfDayRef.current === 'night' ? 1.55 : 0.65;
      r.brakeLightMat.emissiveIntensity = braking ? 3.8 : tailBase;
      r.reverseLightMat.emissiveIntensity = p.gearIndex === -1 ? 3.2 : 0.06;

      // Update 4 independent wheels, control arms & visible compressing coil springs
      const mountLocalY = p.car.suspensionRestLength * 0.35;
      const springTopY = mountLocalY + 0.14;
      const springNaturalLen = p.car.suspensionRestLength * 0.92;

      let maxSlip = 0;
      let avgRoughness = 0;
      for (let i = 0; i < 4; i++) {
        const isRight = i === 1 || i === 3;
        r.wheelPivots[i].position.y = p.wheelOffsetY[i];
        r.wheelPivots[i].rotation.y = p.steering.wheelAnglesRad[i];
        r.wheelPivots[i].rotation.z = (isRight ? -1 : 1) * p.suspensionDamage[i] * 0.24;
        // Rolling forward (-Z) corresponds to negative X rotation
        r.wheelSpinGroups[i].rotation.x = -p.wheelSpinAngle[i];

        // Compress visible helical coil spring & damper rod between top mount & wheel hub
        const currentLen = Math.max(0.08, springTopY - p.wheelOffsetY[i]);
        const scaleY = THREE.MathUtils.clamp(currentLen / springNaturalLen, 0.22, 1.38);
        r.springMeshes[i].scale.y = scaleY;
        r.damperRods[i].scale.y = scaleY;

        // Pivot lower control arm vertically with wheel hub
        r.controlArms[i].position.y = p.wheelOffsetY[i] * 0.5;
        r.controlArms[i].rotation.z = (isRight ? 1 : -1) * Math.atan2(p.wheelOffsetY[i], 0.32);

        maxSlip = Math.max(maxSlip, p.wheelSlip[i]);
        const wTerr = p.wheelTerrain[i];
        if (wTerr) avgRoughness += wTerr.roughness * 0.25;
      }

      if (particleTelemetry) {
        for (let i = 0; i < 4; i++) {
          particleTelemetry.wheelSlip[i] = p.wheelSlip[i];
          particleTelemetry.wheelGroundContact[i] = p.wheelGroundContact[i];
          if (particleTelemetry.wheelRpm) {
            particleTelemetry.wheelRpm[i] = Math.round(
              (p.tires.wheelAngularVel[i] * 60) / (2 * Math.PI)
            );
          }
        }

        // Sync zero-allocation telemetry fields for surface-reactive particle emission
        const centerSurface =
          p.wheelTerrain[2]?.surfaceType ?? p.wheelTerrain[0]?.surfaceType ?? 'asphalt';
        particleTelemetry.surfaceType = centerSurface;
        particleTelemetry.speedMs = p.velocity.length();
        particleTelemetry.throttle = p.throttleSmooth;
        particleTelemetry.brake = p.brakeSmooth;
        particleTelemetry.handbrake = p.handbrakeSmooth;

        world.particles.emitVehicleEffects(
          particleTelemetry,
          p.car,
          p.position,
          p.quaternion,
          p.velocity,
          p.wheelOffsetY,
          p.wheelTerrain,
          prevWheelContact,
          dt,
          isSoftwareGl || p.perfMonitor.overloadActive
        );
      }

      // Ground contact shadow adjustment when jumping
      const anyGrounded = p.wheelGroundContact.some(Boolean);
      const shadowMat = r.contactShadow.material as THREE.MeshBasicMaterial;
      shadowMat.opacity = anyGrounded ? 0.48 : 0.16;

      world.updateSunFollow(p.position.x, p.position.z);

      // Update camera choreography cleanly per mode + full 360° mouse look/zoom
      camera.up.set(0, 1, 0);
      const mode = cameraModeRef.current;
      const speedKmh = p.velocity.length() * 3.6;
      const targetFov =
        mode === 'wheel'
          ? 52
          : mode === 'orbit'
            ? 56
            : THREE.MathUtils.clamp(60 + (speedKmh / 280) * 18, 60, 78);
      camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 6, dt);
      camera.updateProjectionMatrix();

      if (mode === 'chase') {
        const baseDist = (5.4 + p.car.length * 0.35 + Math.min(1.6, speedKmh / 180)) * camZoomScale;
        // Forward direction in XZ rotated by user's mouse yaw offset
        _forwardVec.set(0, 0, -1).applyQuaternion(p.quaternion);
        const baseYaw = Math.atan2(_forwardVec.x, _forwardVec.z);
        const totalYaw = baseYaw + camYawOffset;
        const cosPitch = Math.cos(camPitchOffset);
        const sinPitch = Math.sin(camPitchOffset);

        _camDesiredPos.set(
          p.position.x - Math.sin(totalYaw) * baseDist * cosPitch,
          p.position.y + p.car.height * 0.55 + baseDist * sinPitch,
          p.position.z - Math.cos(totalYaw) * baseDist * cosPitch
        );
        const groundAtCam = getTerrainHeightRaw(_camDesiredPos.x, _camDesiredPos.z);
        _camDesiredPos.y = Math.max(_camDesiredPos.y, groundAtCam + 0.55);

        _camDesiredLook.set(
          p.position.x + Math.sin(totalYaw) * 4.2,
          p.position.y + 0.72,
          p.position.z + Math.cos(totalYaw) * 4.2
        );

        const dampSpeed = isDraggingCam ? 22 : 9.5;
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _camDesiredPos.x, dampSpeed, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _camDesiredPos.y, dampSpeed, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _camDesiredPos.z, dampSpeed, dt);
        _camCurrentLook.lerp(_camDesiredLook, Math.min(1, dt * 14));
        camera.lookAt(_camCurrentLook);
      } else if (mode === 'hood') {
        _localOffset.set(0, p.car.height * 0.68, -p.car.length * 0.16);
        const lookSin = Math.sin(camYawOffset);
        const lookCos = Math.cos(camYawOffset);
        _localLook.set(-lookSin * 18, p.car.height * 0.56 - (camPitchOffset - 0.22) * 10, -lookCos * 18);
        _camDesiredPos.copy(_localOffset).applyQuaternion(p.quaternion).add(p.position);
        _camDesiredLook.copy(_localLook).applyQuaternion(p.quaternion).add(p.position);

        camera.position.copy(_camDesiredPos);
        _camCurrentLook.copy(_camDesiredLook);
        camera.lookAt(_camCurrentLook);
      } else if (mode === 'cockpit') {
        const seatY = p.car.bodyStyle === 'suv' ? 1.18 : 0.88;
        _localOffset.set(-0.34, seatY, 0.05);
        const lookSin = Math.sin(camYawOffset);
        const lookCos = Math.cos(camYawOffset);
        _localLook.set(-0.22 - lookSin * 18, seatY - 0.06 - (camPitchOffset - 0.22) * 10, -lookCos * 18);
        _camDesiredPos.copy(_localOffset).applyQuaternion(p.quaternion).add(p.position);
        _camDesiredLook.copy(_localLook).applyQuaternion(p.quaternion).add(p.position);

        camera.position.copy(_camDesiredPos);
        _camCurrentLook.copy(_camDesiredLook);
        camera.lookAt(_camCurrentLook);
      } else if (mode === 'wheel') {
        // Front-left suspension & coil spring inspection cam (orbitable with mouse!)
        const wheelDist = 1.75 * camZoomScale;
        const wYaw = -Math.PI * 0.35 + camYawOffset;
        _localLook.set(-p.car.trackWidth * 0.44, 0.14, -p.car.wheelbase * 0.5);
        _localOffset.set(
          _localLook.x + Math.sin(wYaw) * wheelDist * Math.cos(camPitchOffset),
          _localLook.y + 0.2 + Math.sin(camPitchOffset) * wheelDist,
          _localLook.z + Math.cos(wYaw) * wheelDist * Math.cos(camPitchOffset)
        );
        _camDesiredPos.copy(_localOffset).applyQuaternion(p.quaternion).add(p.position);
        _camDesiredLook.copy(_localLook).applyQuaternion(p.quaternion).add(p.position);

        camera.position.x = THREE.MathUtils.damp(camera.position.x, _camDesiredPos.x, 16, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _camDesiredPos.y, 16, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _camDesiredPos.z, 16, dt);
        _camCurrentLook.lerp(_camDesiredLook, Math.min(1, dt * 16));
        camera.lookAt(_camCurrentLook);
      } else {
        // Free 360° Orbit / Drone Cam (auto-orbits gently until mouse-dragged)
        if (!userMovedOrbit && !isDraggingCam) {
          orbitAngle += dt * 0.35;
        }
        const totalOrbitYaw = orbitAngle + camYawOffset;
        const rad = 7.4 * camZoomScale;
        _camDesiredPos.set(
          p.position.x + Math.cos(totalOrbitYaw) * rad * Math.cos(camPitchOffset),
          p.position.y + 0.8 + rad * Math.sin(Math.max(0.05, camPitchOffset)),
          p.position.z + Math.sin(totalOrbitYaw) * rad * Math.cos(camPitchOffset)
        );
        const groundAtCam = getTerrainHeightRaw(_camDesiredPos.x, _camDesiredPos.z);
        _camDesiredPos.y = Math.max(_camDesiredPos.y, groundAtCam + 0.55);

        camera.position.x = THREE.MathUtils.damp(camera.position.x, _camDesiredPos.x, 10, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _camDesiredPos.y, 10, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _camDesiredPos.z, 10, dt);
        _camCurrentLook.lerp(p.position, Math.min(1, dt * 12));
        camera.lookAt(_camCurrentLook);
      }

      // Update procedural engine & road audio
      const centerSurface =
        p.wheelTerrain[2]?.surfaceType ?? p.wheelTerrain[0]?.surfaceType ?? 'asphalt';
      const isAirborne = !anyGrounded;
      audio.update(
        p.car,
        p.engineRpm,
        p.throttleSmooth,
        maxSlip,
        avgRoughness,
        p.velocity.length(),
        isAirborne,
        centerSurface,
        p.engineLoad,
        p.boostBar
      );

      // Update particle simulation with current camera FOV & drawing-buffer height for true world-space particle scale
      world.particles.update(dt, camera.fov, renderer.domElement.height);

      // Update 3D physics debug force/contact overlay if enabled (Key B)
      if (debugOverlayRef.current) {
        debugGizmos.update(p.getDebugSnapshot());
      }

      // Emit HUD telemetry at ~18 Hz to minimize React re-render overhead
      hudAccumulator += dt;
      if (hudAccumulator >= 0.055) {
        hudAccumulator = 0;
        callbacksRef.current.onTelemetry(p.getTelemetry());
        if (pinball) {
          callbacksRef.current.onPinballTelemetry(pinball.getTelemetrySummary());
        }
        emitReplayState();
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    const startSimulation = async () => {
      try {
        await ensureRapierInitialized();
      } catch (err) {
        if (!disposed) {
          setWebglError(
            `Physics engine failed to initialize: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        }
        return;
      }

      if (disposed) return;

      rapier = new RapierWorldManager(carRef.current, world.colliders);
      physics = new VehiclePhysics(carRef.current, rapier, tuningRef.current);
      physics.setDriftMode(driftModeRef.current);
      physics.reset(new THREE.Vector3(...activeMap.spawnPos), activeMap.spawnHeading);
      physicsRef.current = physics;
      particleTelemetry = physics.getTelemetry();

      pinball = new PinballMode(physics, rapier, mapId, scene);
      pinballRef.current = pinball;
      pinball.setNightMode(timeOfDayRef.current === 'night');
      pinball.setConfig(pinballConfigRef.current);

      // If car changed while WASM was initializing, sync rig & physics
      if (rigRef.current) {
        rigRef.current.bodyPaintMat.color.set(paintRef.current);
      }

      const [sx, , sz] = activeMap.spawnPos;
      const sy = physics.position.y;
      camera.position.set(
        sx + Math.sin(activeMap.spawnHeading) * 7.5,
        sy + 2.8,
        sz + Math.cos(activeMap.spawnHeading) * 7.5
      );
      _camCurrentLook.set(sx, sy + 0.6, sz - 2.0);
      camera.lookAt(_camCurrentLook);
      callbacksRef.current.onTelemetry(physics.getTelemetry());
      callbacksRef.current.onPinballTelemetry(pinball.getTelemetrySummary());
      emitReplayState();

      if (!isSoftwareGl) {
        renderer.compile(scene, camera);
      }

      clock.getDelta();
      if (isSoftwareGl) {
        tick();
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    void startSimulation();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);

      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('dblclick', onDoubleClick);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      physicsRef.current = null;
      pinballRef.current = null;
      debugGizmosRef.current = null;
      recorderRef.current = null;
      replayLineRef.current = null;
      worldRef.current = null;
      rendererRef.current = null;
      exitReplayFnRef.current = null;
      pinball?.dispose();
      debugGizmos.dispose();
      replayLine.dispose();
      rapier?.dispose();
      rigRef.current?.dispose();
      world.dispose();
      audio.dispose();
      envTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [mapId]);

  return (
    <div className="relative w-full h-full bg-[#0B0E14]">
      <div ref={mountRef} className="w-full h-full" />
      {webglError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0B0E14]/95 p-6 text-center">
          <div className="max-w-md rounded-xl border border-white/10 bg-[#131822] p-6">
            <h2 className="font-display text-xl font-bold text-white">3D Viewport Unavailable</h2>
            <p className="mt-2 text-sm text-slate-300">{webglError}</p>
          </div>
        </div>
      )}
    </div>
  );
};
