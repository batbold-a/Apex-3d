import React, { useState } from 'react';
import {
  Activity,
  Camera,
  CarFront,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clapperboard,
  Compass,
  Eye,
  Flame,
  FlaskConical,
  Gauge,
  Lock,
  Map as MapIcon,
  Minus,
  Moon,
  Orbit,
  Plus,
  RotateCcw,
  Sun,
  Unlock,
  Video,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import { MAPS } from '../data/maps';
import { PinballConfig, PinballTelemetrySummary } from '../types/pinball';
import {
  CameraMode,
  CarSpec,
  HudMode,
  MapId,
  ReplayStateSummary,
  TelemetryData,
  TimeOfDay,
} from '../types/vehicle';
import { DrivingControllerRef, QuickZoneId } from './DrivingCanvas';
import { PinballHUD } from './PinballHUD';
import { ReplayOverlay } from './ReplayOverlay';

interface DrivingHUDProps {
  car: CarSpec;
  selectedPaint: string;
  mapId: MapId;
  timeOfDay: TimeOfDay;
  telemetry: TelemetryData;
  cameraMode: CameraMode;
  hudMode: HudMode;
  debugOverlay: boolean;
  muted: boolean;
  dockOpen: boolean;
  replayState: ReplayStateSummary;
  pinballConfig: PinballConfig;
  pinballSummary: PinballTelemetrySummary;
  onToggleReplayRecording: () => void;
  onToggleDock: () => void;
  onToggleHudMode: () => void;
  onToggleDebugOverlay: () => void;
  onToggleTimeOfDay: () => void;
  onOpenBench: () => void;
  onCycleCamera: () => void;
  onSelectCamera: (mode: CameraMode) => void;
  onSelectCar: (car: CarSpec) => void;
  onSelectPaint: (hex: string) => void;
  onOpenGarage: () => void;
  onOpenLobby: () => void;
  onToggleMute: () => void;
  onUpdatePinballConfig: (patch: Partial<PinballConfig>) => void;
  onTogglePinball: () => void;
  controllerRef: React.MutableRefObject<DrivingControllerRef | null>;
}

const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: 'Chase View',
  hood: 'Hood Cam',
  cockpit: 'Cockpit Cam',
  wheel: 'Wheel & Spring Cam',
  orbit: 'Free Orbit Cam',
};

const CAMERA_ICONS: Record<CameraMode, React.ComponentType<{ className?: string }>> = {
  chase: Video,
  hood: Eye,
  cockpit: Gauge,
  wheel: CircleDot,
  orbit: Orbit,
};

const MAP_QUICK_ZONES: Record<MapId, { id: QuickZoneId; label: string; desc: string }[]> = {
  'proving-valley': [
    { id: 'highway', label: 'Smooth Highway', desc: 'Shift 4–6 for 290+ km/h' },
    { id: 'driftpad', label: 'NE Drift Skidpad', desc: 'R=44m low-glaze drift & slide ring' },
    { id: 'bumps', label: 'Bad Road & Bumps', desc: 'Speed humps, moguls & cobble' },
    { id: 'mountain', label: 'Mountain Hill Climb', desc: 'Connected summit & north/west descents' },
    { id: 'ramps', label: 'Stunt Ramps & Dunes', desc: 'Airborne suspension drops' },
    { id: 'rallystage', label: 'SE Rally & SW Canyon', desc: 'Linked gravel rally & canyon dirt loop' },
    { id: 'crash', label: 'Crash Barriers & Bollards', desc: 'Test body deformation & damage' },
  ],
  'mountain-pass': [
    { id: 'basecamp', label: 'Valley Basecamp', desc: 'Start of the Redrock Ascent' },
    { id: 'midclimb', label: 'Mid Switchbacks', desc: 'Rock ledges (Use 1–2 + Diff Lock)' },
    { id: 'summit', label: 'Summit Plateau', desc: '28m peak lookout above canyon' },
  ],
  'desert-baja': [
    { id: 'wash', label: 'Desert Wash Start', desc: 'High-speed packed wash runway' },
    { id: 'whoops', label: 'Rhythm Whoops Strip', desc: 'Long-travel suspension rollers' },
    { id: 'jumps', label: 'Twin Mega Launch Ramps', desc: 'Launch at 120+ km/h' },
  ],
  'highway-circuit': [
    { id: 'hub', label: 'Speedway Start Grid', desc: '4-lane midnight straight' },
    { id: 'loop', label: 'East Coastal Loop', desc: 'High-speed sweeping bends' },
  ],
  'testing-facility': [
    { id: 'straight', label: '600m Acceleration Strip', desc: '0–100 & high-speed stability pull' },
    { id: 'skidpad', label: 'R=40m Skid Pad', desc: 'Constant-radius lateral G calibration' },
    { id: 'splitmu', label: 'Split-μ Braking Pad', desc: 'Dry tarmac (L) / Ice (R) ABS test' },
    { id: 'dlc', label: 'ISO Double Lane Change', desc: 'Swerve stability cone corridor' },
    { id: 'susprig', label: 'Suspension Calibration Rig', desc: '0.26m bumps & 0.28m step drop' },
    { id: 'traction', label: 'Multi-Surface Traction Pad', desc: 'Tarmac, cobble, gravel & sand' },
  ],
};

export const DrivingHUD: React.FC<DrivingHUDProps> = React.memo(({
  car,
  selectedPaint: _selectedPaint,
  mapId,
  timeOfDay,
  telemetry,
  cameraMode,
  hudMode,
  debugOverlay,
  muted,
  dockOpen,
  replayState,
  pinballConfig,
  pinballSummary,
  onToggleReplayRecording,
  onToggleDock,
  onToggleHudMode,
  onToggleDebugOverlay,
  onToggleTimeOfDay,
  onOpenBench,
  onCycleCamera,
  onSelectCamera,
  onSelectCar: _onSelectCar,
  onSelectPaint: _onSelectPaint,
  onOpenGarage,
  onOpenLobby,
  onToggleMute,
  onUpdatePinballConfig,
  onTogglePinball,
  controllerRef,
}) => {
  const [zonesOpen, setZonesOpen] = useState(false);

  if (replayState.isReplaying) {
    return (
      <ReplayOverlay
        replayState={replayState}
        telemetry={telemetry}
        muted={muted}
        onToggleReplayRecording={onToggleReplayRecording}
        onToggleMute={onToggleMute}
        controllerRef={controllerRef}
      />
    );
  }

  const activeMapSpec = MAPS.find((m) => m.id === mapId) ?? MAPS[0];
  const quickZones = MAP_QUICK_ZONES[mapId];
  const canReplay = replayState.bufferedSeconds >= 0.25;

  const rpmRatio = Math.max(0, Math.min(1, telemetry.rpm / telemetry.maxRpm));
  const redlineStartRatio = telemetry.redlineRpm / telemetry.maxRpm;

  const gearHint = telemetry.isLugging
    ? telemetry.autoShift
      ? 'Steep climb — Traction engaged'
      : 'Steep or rough surface — Shift down (Q) for torque'
    : !telemetry.autoShift && telemetry.isRevLimiting && telemetry.gearIndex >= 1 && telemetry.gearIndex < car.forwardRatios.length
      ? 'Rev limit — Shift up (X)'
      : null;

  // Clamp player coordinates inside circular radar radius (266 units from center)
  const mapDist = Math.hypot(telemetry.posX, telemetry.posZ);
  const mapMaxR = 266;
  const mapX = mapDist > mapMaxR ? (telemetry.posX / mapDist) * mapMaxR : telemetry.posX;
  const mapZ = mapDist > mapMaxR ? (telemetry.posZ / mapDist) * mapMaxR : telemetry.posZ;

  // BeamNG mode derived telemetry
  const latG = telemetry.lateralG ?? 0;
  const longG = telemetry.longitudinalG ?? 0;
  const gDotX = Math.max(-24, Math.min(24, (latG / 1.5) * 22));
  const gDotY = Math.max(-24, Math.min(24, (-longG / 1.5) * 22));
  const horizonOffsetPx = Math.max(-14, Math.min(14, telemetry.pitchDeg * 0.6));
  const steerLeftDeg = telemetry.steeringAnglesDeg?.[0] ?? 0;
  const steerRightDeg = telemetry.steeringAnglesDeg?.[1] ?? 0;
  const engineLoadPct = Math.round((telemetry.engineLoad ?? telemetry.throttle) * 100);
  const boostBar = telemetry.boostBar ?? 0;

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between">
      {/* TOP BAR */}
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5 sm:flex-nowrap sm:px-5">
        {/* LEFT: Circular Mini-Map + Active Gear / Drift / Attitude Column (+ BeamNG Technical Inclinometer/G-Meter) */}
        <div className="pointer-events-auto flex shrink-0 flex-col gap-2">
          <div className="flex shrink-0 items-start gap-3">
            {/* Circular Mini-Map Overlay */}
            <div className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-2 border-white/18 bg-[#0B0E14]/94 shadow-2xl sm:h-28 sm:w-28">
              <svg
                viewBox="-295 -295 590 590"
                className="h-full w-full rounded-full"
                aria-label="Circular Mini-Map"
              >
                <defs>
                  <clipPath id="minimap-circle-clip">
                    <circle cx="0" cy="0" r="290" />
                  </clipPath>
                </defs>

                <g clipPath="url(#minimap-circle-clip)">
                  <circle cx="0" cy="0" r="290" fill="#0E131D" />
                  <circle cx="0" cy="0" r="195" fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="2" strokeDasharray="8 8" />
                  <circle cx="0" cy="0" r="100" fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="2" />
                  <line x1="-290" y1="0" x2="290" y2="0" stroke="rgba(148,163,184,0.08)" strokeWidth="2" />
                  <line x1="0" y1="-290" x2="0" y2="290" stroke="rgba(148,163,184,0.08)" strokeWidth="2" />

                  {mapId === 'proving-valley' && (
                    <>
                      {/* Outer Grand Asphalt Circuit */}
                      <rect
                        x="-210"
                        y="-210"
                        width="420"
                        height="420"
                        rx="75"
                        fill="none"
                        stroke="rgba(148,163,184,0.48)"
                        strokeWidth="22"
                      />
                      <rect
                        x="-210"
                        y="-210"
                        width="420"
                        height="420"
                        rx="75"
                        fill="none"
                        stroke="rgba(255,255,255,0.22)"
                        strokeWidth="2.5"
                        strokeDasharray="12 12"
                      />
                      {/* Central High-Speed Straight & West/East Connectors */}
                      <line x1="0" y1="-210" x2="0" y2="210" stroke="rgba(148,163,184,0.5)" strokeWidth="20" />
                      <line x1="-210" y1="0" x2="-154" y2="0" stroke="rgba(148,163,184,0.48)" strokeWidth="14" />
                      <line x1="160" y1="0" x2="210" y2="0" stroke="rgba(148,163,184,0.48)" strokeWidth="14" />

                      {/* NE Drift Skidpad & 4 Connectors */}
                      <circle cx="120" cy="-120" r="44" fill="rgba(168,85,247,0.22)" stroke="rgba(192,132,252,0.58)" strokeWidth="4" />
                      <circle cx="120" cy="-120" r="24" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="2" strokeDasharray="6 6" />
                      <line x1="0" y1="-120" x2="80" y2="-120" stroke="rgba(148,163,184,0.48)" strokeWidth="14" />
                      <line x1="120" y1="-160" x2="120" y2="-210" stroke="rgba(148,163,184,0.48)" strokeWidth="14" />
                      <line x1="120" y1="-80" x2="120" y2="-48" stroke="rgba(148,163,184,0.48)" strokeWidth="14" />
                      <line x1="44" y1="-44" x2="92" y2="-92" stroke="rgba(148,163,184,0.48)" strokeWidth="14" />

                      {/* NW Mountain Peak + Connected Summit-to-Circuit Trails */}
                      <circle cx="-115" cy="-125" r="62" fill="rgba(34,197,94,0.24)" stroke="rgba(74,222,128,0.45)" strokeWidth="2" />
                      <circle cx="-115" cy="-125" r="30" fill="none" stroke="rgba(74,222,128,0.35)" strokeWidth="2" />
                      <polyline
                        points="-44,-44 -66,-66 -88,-88 -104,-108 -116,-124 -122,-148 -116,-176 -115,-210"
                        fill="none"
                        stroke="rgba(161,118,75,0.72)"
                        strokeWidth="12"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      <polyline
                        points="-116,-124 -145,-125 -178,-125 -210,-125"
                        fill="none"
                        stroke="rgba(161,118,75,0.68)"
                        strokeWidth="11"
                        strokeLinecap="round"
                      />

                      {/* SE Rally Gravel Stage + Links */}
                      <polyline
                        points="0,122 54,114 106,92 148,116 142,162 98,178 88,210"
                        fill="none"
                        stroke="rgba(217,119,6,0.68)"
                        strokeWidth="12"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      <line x1="116" y1="50" x2="110" y2="92" stroke="rgba(217,119,6,0.64)" strokeWidth="11" strokeLinecap="round" />
                      <line x1="147" y1="134" x2="210" y2="134" stroke="rgba(217,119,6,0.64)" strokeWidth="11" strokeLinecap="round" />

                      {/* SW Canyon Dirt Trail + Links */}
                      <polyline
                        points="0,122 -56,112 -105,86 -152,114 -146,164 -104,178 -95,210"
                        fill="none"
                        stroke="rgba(180,101,60,0.68)"
                        strokeWidth="12"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      <line x1="-105" y1="42" x2="-105" y2="86" stroke="rgba(180,101,60,0.64)" strokeWidth="11" strokeLinecap="round" />
                      <line x1="-150" y1="120" x2="-210" y2="120" stroke="rgba(180,101,60,0.64)" strokeWidth="11" strokeLinecap="round" />

                      {/* Central Hub, West Bad-Road Strip & East Stunt Dunes */}
                      <rect x="-46" y="-46" width="92" height="92" rx="10" fill="rgba(100,116,139,0.45)" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
                      <rect x="-155" y="-42" width="103" height="84" rx="8" fill="rgba(245,158,11,0.34)" stroke="rgba(245,158,11,0.55)" strokeWidth="2" />
                      <rect x="52" y="-52" width="113" height="104" rx="8" fill="rgba(239,68,68,0.28)" stroke="rgba(239,68,68,0.5)" strokeWidth="2" />
                      <line x1="72" y1="-19" x2="89" y2="-19" stroke="#FCA5A5" strokeWidth="5" />
                      <line x1="105" y1="18" x2="125" y2="18" stroke="#FCA5A5" strokeWidth="5" />
                      <line x1="14" y1="-28" x2="34" y2="-28" stroke="#F59E0B" strokeWidth="6" />
                      <line x1="-34" y1="-28" x2="-14" y2="-28" stroke="#F59E0B" strokeWidth="6" />
                      <circle cx="19.5" cy="-14" r="4" fill="#FBBF24" />
                    </>
                  )}

                  {mapId === 'mountain-pass' && (
                    <>
                      <path
                        d="M -9 -175 C 58 -120, -64 -55, 48 0 C -58 55, 64 108, 0 165"
                        fill="none"
                        stroke="rgba(217,119,6,0.62)"
                        strokeWidth="22"
                        strokeLinecap="round"
                      />
                      <circle cx="-14" cy="-165" r="36" fill="rgba(34,197,94,0.26)" stroke="#4ADE80" strokeWidth="3" />
                      <circle cx="0" cy="145" r="24" fill="rgba(148,163,184,0.28)" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
                    </>
                  )}

                  {mapId === 'desert-baja' && (
                    <>
                      <polyline
                        points="0,-245 72,-262 162,-206 208,-92 212,45 166,178 76,244 0,238"
                        fill="none"
                        stroke="rgba(245,158,11,0.48)"
                        strokeWidth="18"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      <polyline
                        points="0,-245 -64,-242 -152,-172 -178,-45 -168,96 -116,202 -56,238 0,238"
                        fill="none"
                        stroke="rgba(245,158,11,0.48)"
                        strokeWidth="18"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      <polyline
                        points="0,126 -56,114 -60,60 -60,-85 -54,-142 0,-168"
                        fill="none"
                        stroke="rgba(251,191,36,0.45)"
                        strokeWidth="14"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      <line x1="0" y1="-245" x2="0" y2="238" stroke="rgba(245,158,11,0.7)" strokeWidth="20" strokeLinecap="round" />
                      <rect x="-86" y="-112" width="52" height="202" rx="10" fill="rgba(245,158,11,0.22)" stroke="rgba(245,158,11,0.5)" strokeWidth="2" />
                      <line x1="-10" y1="40" x2="10" y2="40" stroke="#FCA5A5" strokeWidth="7" />
                      <line x1="-11" y1="-72" x2="11" y2="-72" stroke="#FCA5A5" strokeWidth="7" />
                    </>
                  )}

                  {mapId === 'highway-circuit' && (
                    <>
                      <rect
                        x="-210"
                        y="-210"
                        width="420"
                        height="420"
                        rx="75"
                        fill="none"
                        stroke="rgba(244,63,94,0.55)"
                        strokeWidth="24"
                      />
                      <rect
                        x="-210"
                        y="-210"
                        width="420"
                        height="420"
                        rx="75"
                        fill="none"
                        stroke="rgba(255,255,255,0.3)"
                        strokeWidth="2.5"
                        strokeDasharray="12 12"
                      />
                      <line x1="0" y1="-210" x2="0" y2="210" stroke="rgba(56,189,248,0.55)" strokeWidth="24" />
                      <rect x="84" y="-54" width="32" height="38" rx="4" fill="rgba(245,158,11,0.35)" stroke="#F59E0B" strokeWidth="2" />
                    </>
                  )}

                  {mapId === 'testing-facility' && (
                    <>
                      {/* 600m Straight */}
                      <line x1="0" y1="-280" x2="0" y2="280" stroke="rgba(148,163,184,0.55)" strokeWidth="28" />
                      <line x1="0" y1="-280" x2="0" y2="280" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeDasharray="10 10" />
                      {/* R=40m Skid Pad */}
                      <circle cx="-90" cy="0" r="56" fill="rgba(168,85,247,0.18)" stroke="rgba(168,85,247,0.45)" strokeWidth="2" />
                      <circle cx="-90" cy="0" r="40" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="3" strokeDasharray="8 6" />
                      {/* ISO DLC Corridor */}
                      <rect x="-46" y="-150" width="26" height="185" fill="rgba(245,158,11,0.22)" stroke="rgba(245,158,11,0.45)" strokeWidth="2" />
                      {/* Split-mu Braking Pad: dry left + ice right */}
                      <rect x="34" y="-160" width="12" height="320" fill="rgba(100,116,139,0.5)" />
                      <rect x="46" y="-160" width="12" height="320" fill="rgba(56,189,248,0.55)" />
                      {/* Suspension Calibration Rig */}
                      <rect x="90" y="-90" width="40" height="180" fill="rgba(244,63,94,0.28)" stroke="rgba(244,63,94,0.5)" strokeWidth="2" />
                      {/* Multi-Surface Traction Pad */}
                      <rect x="34" y="180" width="28" height="82" fill="rgba(100,116,139,0.45)" />
                      <rect x="62" y="180" width="28" height="82" fill="rgba(148,163,184,0.45)" />
                      <rect x="90" y="180" width="28" height="82" fill="rgba(180,120,70,0.5)" />
                      <rect x="118" y="180" width="28" height="82" fill="rgba(245,158,11,0.48)" />
                    </>
                  )}

                  {pinballSummary.enabled &&
                    pinballSummary.aiRadarBlips.map((blip) => {
                      const bDist = Math.hypot(blip.x, blip.z);
                      const bx = bDist > mapMaxR ? (blip.x / bDist) * mapMaxR : blip.x;
                      const bz = bDist > mapMaxR ? (blip.z / bDist) * mapMaxR : blip.z;
                      const rotDeg = -(blip.headingRad * 180) / Math.PI;
                      const blipColor =
                        blip.behavior === 'arena'
                          ? '#F59E0B'
                          : blip.behavior === 'evade'
                            ? '#34D399'
                            : '#38BDF8';
                      return (
                        <g key={blip.id} transform={`translate(${bx}, ${bz}) rotate(${rotDeg})`}>
                          <polygon
                            points="0,-16 11,12 0,6 -11,12"
                            fill={blipColor}
                            stroke="#0B0E14"
                            strokeWidth="2.5"
                            strokeLinejoin="round"
                          />
                        </g>
                      );
                    })}

                  <g transform={`translate(${mapX}, ${mapZ}) rotate(${telemetry.headingDeg})`}>
                    <polygon points="0,-6 -34,-82 34,-82" fill="rgba(56,189,248,0.2)" />
                    <polygon points="0,-24 15,17 0,9 -15,17" fill="#38BDF8" stroke="#FFFFFF" strokeWidth="3.5" strokeLinejoin="round" />
                  </g>
                </g>

                <text x="0" y="-262" textAnchor="middle" fill="#38BDF8" fontSize="22" fontWeight="700" fontFamily="monospace">N</text>
                <text x="0" y="278" textAnchor="middle" fill="rgba(148,163,184,0.75)" fontSize="20" fontWeight="600" fontFamily="monospace">S</text>
                <text x="270" y="7" textAnchor="middle" fill="rgba(148,163,184,0.75)" fontSize="20" fontWeight="600" fontFamily="monospace">E</text>
                <text x="-270" y="7" textAnchor="middle" fill="rgba(148,163,184,0.75)" fontSize="20" fontWeight="600" fontFamily="monospace">W</text>
              </svg>

              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded border border-white/15 bg-[#0B0E14] px-1.5 py-0.5 text-[10px] font-mono-tabular font-semibold text-cyan-300">
                {String(telemetry.headingDeg).padStart(3, '0')}°
              </div>
            </div>

            {/* Left Compact Card: Active Gear + Clean Non-Overlapping Attitude/Health + Drift/Diff Control */}
            <div className="flex shrink-0 items-center gap-3.5 rounded-xl border border-white/12 bg-[#0B0E14]/92 px-3.5 py-2.5 shadow-2xl">
              <div className="flex shrink-0 flex-col items-center gap-1 border-r border-white/10 pr-3.5">
                <button
                  type="button"
                  title="Toggle Auto / Manual Shifting"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    controllerRef.current?.toggleAutoShift();
                  }}
                  className="text-[9px] font-bold uppercase tracking-wider text-cyan-300 hover:text-white cursor-pointer whitespace-nowrap"
                >
                  {telemetry.autoShift ? 'AUTO' : 'MAN'}
                </button>
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-lg font-display text-2xl font-extrabold leading-none shadow-inner ${
                    telemetry.gearIndex === -1
                      ? 'bg-amber-500 text-slate-950'
                      : telemetry.gearIndex === 0
                        ? 'bg-slate-200 text-slate-950'
                        : 'bg-cyan-500 text-slate-950'
                  }`}
                >
                  {telemetry.gearLabel}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title="Shift Down (Q / [)"
                    aria-label="Shift Down"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      controllerRef.current?.shiftDown();
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded border border-white/12 bg-white/6 text-slate-300 hover:bg-white/14 cursor-pointer"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    title="Shift Up (X / ])"
                    aria-label="Shift Up"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      controllerRef.current?.shiftUp();
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded border border-white/12 bg-white/6 text-slate-300 hover:bg-white/14 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-start gap-5 text-[11px] font-mono-tabular whitespace-nowrap">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2.5">
                      <span className="text-slate-400">Pitch</span>
                      <span className="w-11 text-right font-semibold text-white">
                        {telemetry.pitchDeg > 0 ? '+' : ''}{telemetry.pitchDeg}°
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2.5">
                      <span className="text-slate-400">Roll</span>
                      <span className="w-11 text-right font-semibold text-white">
                        {telemetry.rollDeg > 0 ? '+' : ''}{telemetry.rollDeg}°
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2.5">
                      <span className="text-slate-400">Grade</span>
                      <span className="w-11 text-right font-semibold text-amber-300">
                        {telemetry.slopeGradePct}%
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 border-l border-white/10 pl-4">
                    <div className="flex items-center justify-between gap-2.5">
                      <span className="text-slate-400">Body</span>
                      <span
                        className={
                          telemetry.damage.overallIntegrity < 50
                            ? 'w-9 text-right font-semibold text-rose-400'
                            : telemetry.damage.overallIntegrity < 85
                              ? 'w-9 text-right font-semibold text-amber-400'
                              : 'w-9 text-right font-semibold text-emerald-400'
                        }
                      >
                        {telemetry.damage.overallIntegrity}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2.5">
                      <span className="text-slate-400">Eng</span>
                      <span
                        className={
                          telemetry.damage.engineHealth < 55
                            ? 'w-9 text-right font-semibold text-rose-400'
                            : telemetry.damage.engineHealth < 85
                              ? 'w-9 text-right font-semibold text-amber-400'
                              : 'w-9 text-right font-semibold text-emerald-400'
                        }
                      >
                        {telemetry.damage.engineHealth}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2.5">
                      <span className="text-slate-400">Grip</span>
                      <span className="w-9 text-right font-semibold text-cyan-300">
                        {Math.round(telemetry.surfaceGrip * 100)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Drift Control & Diff Mode Control Row */}
                <div className="flex items-center justify-between gap-3 border-t border-white/8 pt-1 text-[10px] font-mono-tabular whitespace-nowrap">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      controllerRef.current?.toggleDriftMode();
                    }}
                    title="Toggle Drift Control / High-Grip Mode (T)"
                    className={`flex items-center gap-1 font-semibold transition-colors cursor-pointer ${
                      telemetry.driftMode ? 'text-amber-400 hover:text-amber-300' : 'text-emerald-400 hover:text-emerald-300'
                    }`}
                  >
                    <span>Mode:</span>
                    <span>{telemetry.driftMode ? 'DRIFT' : 'GRIP'}</span>
                  </button>

                  {telemetry.hasDiffLock && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        controllerRef.current?.toggleDiffLock();
                      }}
                      title="Toggle 4WD Diff Lock (L)"
                      className="flex items-center gap-1 cursor-pointer"
                    >
                      <span className="text-slate-400">Diff:</span>
                      <span className={telemetry.diffLock ? 'font-bold text-amber-400' : 'text-slate-300'}>
                        {telemetry.diffLock ? 'LOCK' : 'OPEN'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* BEAMNG TECHNICAL HUD EXTRA PANEL (Inclinometer + G-Force Circle + Drivetrain Telemetry) */}
          {hudMode === 'beamng' && (
            <div className="hidden sm:flex items-center gap-3.5 rounded-xl border border-white/12 bg-[#0B0E14]/92 px-3.5 py-2.5 shadow-2xl">
              {/* Artificial Horizon Inclinometer */}
              <div className="flex flex-col items-center gap-1">
                <svg viewBox="-28 -28 56 56" className="h-12 w-12 rounded-full border border-white/15 bg-[#080B10]">
                  <defs>
                    <clipPath id="inc-clip">
                      <circle cx="0" cy="0" r="25" />
                    </clipPath>
                  </defs>
                  <g clipPath="url(#inc-clip)">
                    <g transform={`rotate(${-telemetry.rollDeg}) translate(0, ${horizonOffsetPx})`}>
                      <rect x="-40" y="-40" width="80" height="40" fill="rgba(56,189,248,0.16)" />
                      <rect x="-40" y="0" width="80" height="40" fill="rgba(180,120,60,0.22)" />
                      <line x1="-35" y1="0" x2="35" y2="0" stroke="#38BDF8" strokeWidth="1.5" />
                    </g>
                    <line x1="-10" y1="0" x2="-4" y2="0" stroke="#F59E0B" strokeWidth="2" />
                    <line x1="4" y1="0" x2="10" y2="0" stroke="#F59E0B" strokeWidth="2" />
                    <circle cx="0" cy="0" r="1.8" fill="#F59E0B" />
                  </g>
                </svg>
                <span className="text-[9px] font-mono-tabular text-slate-400">Horizon</span>
              </div>

              {/* Live G-Force Circle */}
              <div className="flex flex-col items-center gap-1 border-l border-white/10 pl-3.5">
                <svg viewBox="-28 -28 56 56" className="h-12 w-12 rounded-full border border-white/15 bg-[#080B10]">
                  <circle cx="0" cy="0" r="22" fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="1" />
                  <circle cx="0" cy="0" r="11" fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="1" strokeDasharray="3 3" />
                  <line x1="-24" y1="0" x2="24" y2="0" stroke="rgba(148,163,184,0.15)" strokeWidth="1" />
                  <line x1="0" y1="-24" x2="0" y2="24" stroke="rgba(148,163,184,0.15)" strokeWidth="1" />
                  <line x1="0" y1="0" x2={gDotX} y2={gDotY} stroke="rgba(245,158,11,0.5)" strokeWidth="1.5" />
                  <circle cx={gDotX} cy={gDotY} r="3.4" fill="#F59E0B" />
                </svg>
                <span className="text-[9px] font-mono-tabular text-slate-300">
                  {Math.hypot(latG, longG).toFixed(2)} G
                </span>
              </div>

              {/* Drivetrain & Steering Data */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-l border-white/10 pl-3.5 text-[10px] font-mono-tabular whitespace-nowrap">
                <span className="text-slate-400">Load</span>
                <span className="text-right font-semibold text-white">{engineLoadPct}%</span>
                <span className="text-slate-400">{car.hasTurbo || car.hasSupercharger ? 'Boost' : 'Temp'}</span>
                <span className="text-right font-semibold text-cyan-300">
                  {car.hasTurbo || car.hasSupercharger
                    ? `${boostBar >= 0 ? '+' : ''}${boostBar.toFixed(2)} bar`
                    : `${telemetry.engineTempC ?? 90}°C`}
                </span>
                <span className="text-slate-400">Steer L/R</span>
                <span className="text-right font-semibold text-amber-300">
                  {steerLeftDeg.toFixed(1)}° / {steerRightDeg.toFixed(1)}°
                </span>
                <span className="text-slate-400">Lat / Long</span>
                <span className="text-right font-semibold text-slate-200">
                  {latG.toFixed(2)} / {longG.toFixed(2)}G
                </span>
              </div>
            </div>
          )}
        </div>

        {/* TOP-CENTER: Always-Visible Speedometer (KM/H), Distance (KM), RPM Bar & Surface */}
        <div className="pointer-events-auto flex shrink-0 flex-col items-center">
          <div className="flex items-center gap-4 rounded-2xl border border-white/14 bg-[#0B0E14]/92 px-4 py-2 shadow-2xl">
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-3xl font-extrabold leading-none tracking-tight text-white font-mono-tabular sm:text-4xl">
                {telemetry.speedKmh}
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-400">
                KM/H
              </span>
            </div>

            <div className="h-8 w-px bg-white/10" />

            <div className="flex min-w-[175px] flex-col gap-1">
              <div className="flex items-baseline justify-between gap-4 text-xs font-mono-tabular whitespace-nowrap">
                <span className="font-bold text-white">
                  {telemetry.distanceKm.toFixed(2)}{' '}
                  <span className="text-[10px] font-medium text-slate-400">km</span>
                </span>
                <span className="text-[11px] text-amber-300">
                  {telemetry.rpm.toLocaleString()} <span className="text-[10px] text-slate-400">RPM</span>
                </span>
              </div>
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="absolute inset-y-0 right-0 bg-rose-500/30"
                  style={{ width: `${Math.max(0, (1 - redlineStartRatio) * 100)}%` }}
                />
                <div
                  className={`h-full transition-all duration-75 ${
                    telemetry.rpm >= telemetry.redlineRpm ? 'bg-rose-500' : 'bg-amber-400'
                  }`}
                  style={{ width: `${Math.round(rpmRatio * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between gap-3 text-[10px] whitespace-nowrap">
                <span className="text-slate-300">{activeMapSpec.name}</span>
                <span className="text-amber-400/90">
                  {telemetry.absActive ? 'ABS Active · ' : ''}
                  {telemetry.surfaceName}
                </span>
              </div>
            </div>
          </div>

          {gearHint && (
            <div className="mt-1.5 rounded-lg border border-amber-500/40 bg-[#0B0E14]/92 px-3 py-1 text-[11px] font-semibold text-amber-300">
              {gearHint}
            </div>
          )}
        </div>

        {/* TOP-RIGHT: Replay + Drift Toggle + HUD Mode Switch + Physics Tools + Vehicle Actions */}
        <div className="pointer-events-auto flex shrink-0 items-center justify-end gap-1.5">
          {/* Replay System Recorder & Playback Controls */}
          <div className="flex h-9 items-center rounded-lg border border-white/12 bg-[#0B0E14]/90 p-0.5 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleReplayRecording();
              }}
              aria-label={replayState.recordingEnabled ? 'Disable Replay Recording' : 'Enable Replay Recording'}
              title="Toggle 30s Telemetry Replay Recorder ON / OFF"
              className={`flex h-full items-center rounded-md px-2 text-[10px] font-mono-tabular font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                replayState.recordingEnabled
                  ? 'text-emerald-300 hover:bg-white/6'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {replayState.recordingEnabled ? 'Rec' : 'Off'}
            </button>
            <div className="h-4 w-px bg-white/10" />
            <button
              type="button"
              disabled={!canReplay}
              onClick={(e) => {
                e.currentTarget.blur();
                controllerRef.current?.enterReplay();
              }}
              aria-label="Enter Cinematic Slow-Mo Replay Mode"
              title={
                canReplay
                  ? `Watch last ${replayState.bufferedSeconds.toFixed(1)}s in Cinematic Slow-Mo Replay (P)`
                  : 'Drive for at least 0.3s with Rec enabled to buffer Replay'
              }
              className={`flex h-full items-center gap-1.5 rounded-md px-2.5 text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 ${
                canReplay
                  ? 'text-amber-300 hover:bg-amber-500/20 cursor-pointer'
                  : 'text-slate-600 cursor-not-allowed'
              }`}
            >
              <Clapperboard className="h-3.5 w-3.5" />
              <span>
                Replay
                {replayState.bufferedSeconds >= 1
                  ? ` ${Math.min(30, Math.round(replayState.bufferedSeconds))}s`
                  : ''}
              </span>
            </button>
          </div>

          {/* Drift vs Grip Control Switch */}
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              controllerRef.current?.toggleDriftMode();
            }}
            aria-label={telemetry.driftMode ? 'Switch to Grip Mode' : 'Switch to Drift Mode'}
            title="Drift Control Mode (T): DRIFT lowers rear lateral grip for sustained slides; GRIP maximizes corner bite"
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              telemetry.driftMode
                ? 'border-amber-400/65 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                : 'border-emerald-500/40 bg-emerald-500/12 text-emerald-300 hover:bg-emerald-500/22'
            }`}
          >
            <Flame className="h-3.5 w-3.5" />
            <span>{telemetry.driftMode ? 'Drift On' : 'Grip'}</span>
          </button>

          {/* Opt-In Pinball Mode & AI Target Fleet */}
          <PinballHUD
            config={pinballConfig}
            summary={pinballSummary}
            physicsStepMs={telemetry.perf?.physicsStepMs ?? 0}
            renderFps={telemetry.perf?.renderFps ?? 60}
            onUpdateConfig={onUpdatePinballConfig}
            onToggleEnabled={onTogglePinball}
            onRespawnAi={() => controllerRef.current?.respawnPinballAi()}
          />

          {/* Live Day / Night Lighting & Headlights Switch (Key J) */}
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleTimeOfDay();
            }}
            aria-label={timeOfDay === 'night' ? 'Switch to Daylight' : 'Switch to Night Lighting'}
            title={`Time of Day: ${timeOfDay === 'night' ? 'Night (Headlights On)' : 'Daylight'} — Press J to switch`}
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              timeOfDay === 'night'
                ? 'border-indigo-400/55 bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/30'
                : 'border-amber-400/45 bg-amber-500/12 text-amber-200 hover:bg-amber-500/22'
            }`}
          >
            {timeOfDay === 'night' ? (
              <Moon className="h-3.5 w-3.5 text-indigo-300" />
            ) : (
              <Sun className="h-3.5 w-3.5 text-amber-300" />
            )}
            <span>{timeOfDay === 'night' ? 'Night' : 'Day'}</span>
          </button>

          {/* Horizon / BeamNG HUD Switch */}
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleHudMode();
            }}
            aria-label="Toggle Cockpit HUD Layout"
            title={`HUD Layout: ${hudMode === 'horizon' ? 'Horizon Clean' : 'BeamNG Technical'} (Click to switch)`}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-white/12 bg-[#0B0E14]/90 px-2.5 text-[11px] font-semibold text-slate-200 hover:bg-[#161C28] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>{hudMode === 'horizon' ? 'Horizon' : 'BeamNG'}</span>
          </button>

          {/* 3D Physics Vector Overlay (Key B) */}
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleDebugOverlay();
            }}
            aria-label="Toggle 3D Physics Vectors"
            title="Toggle 3D Tire Force, CoM & Velocity Vectors (B)"
            className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors cursor-pointer ${
              debugOverlay
                ? 'border-cyan-400/70 bg-cyan-500/25 text-cyan-200'
                : 'border-white/12 bg-[#0B0E14]/90 text-slate-300 hover:bg-[#161C28]'
            }`}
          >
            <Activity className="h-4 w-4" />
          </button>

          {/* Physics Validation Bench Modal */}
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenBench();
            }}
            aria-label="Open Physics Validation Bench"
            title="Run 11 Physics Benchmarks & Scorecard"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-purple-500/40 bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 transition-colors cursor-pointer"
          >
            <FlaskConical className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenLobby();
            }}
            aria-label="Maps & Lobby"
            title="Maps & Vehicle Lobby"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/35 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 transition-colors cursor-pointer"
          >
            <MapIcon className="h-4 w-4" />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                setZonesOpen((v) => !v);
              }}
              aria-label="Test Zones"
              title="Test Zones"
              className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors cursor-pointer ${
                zonesOpen
                  ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-300'
                  : 'border-white/12 bg-[#0B0E14]/90 text-slate-200 hover:bg-[#161C28]'
              }`}
            >
              <Compass className="h-4 w-4 text-cyan-400" />
            </button>

            {zonesOpen && (
              <div className="absolute right-0 mt-2 w-60 rounded-xl border border-white/12 bg-[#0F141D] p-1.5 shadow-2xl">
                {quickZones.map((z) => (
                  <button
                    key={z.id}
                    type="button"
                    onClick={() => {
                      controllerRef.current?.resetCar(z.id);
                      setZonesOpen(false);
                    }}
                    className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/8 transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-semibold text-white">{z.label}</div>
                    <div className="text-[11px] text-slate-400">{z.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onCycleCamera();
            }}
            aria-label={`Cycle Camera (${CAMERA_LABELS[cameraMode]})`}
            title={`Camera: ${CAMERA_LABELS[cameraMode]} (C)`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/12 bg-[#0B0E14]/90 text-slate-200 hover:bg-[#161C28] transition-colors cursor-pointer"
          >
            <Camera className="h-4 w-4 text-cyan-400" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenGarage();
            }}
            aria-label="Change Car"
            title={`Change Car — ${car.name} (G)`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-500/35 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-colors cursor-pointer"
          >
            <CarFront className="h-4 w-4" />
          </button>

          {telemetry.hasDiffLock && (
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                controllerRef.current?.toggleDiffLock();
              }}
              aria-label={telemetry.diffLock ? 'Unlock Differential' : 'Lock Differential'}
              title={`Diff Lock: ${telemetry.diffLock ? 'LOCKED' : 'OPEN'} (L)`}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors cursor-pointer ${
                telemetry.diffLock
                  ? 'border-amber-400 bg-amber-500/25 text-amber-200'
                  : 'border-white/12 bg-[#0B0E14]/90 text-slate-300 hover:bg-[#161C28]'
              }`}
            >
              {telemetry.diffLock ? (
                <Lock className="h-4 w-4 text-amber-300" />
              ) : (
                <Unlock className="h-4 w-4 text-slate-400" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              controllerRef.current?.repairCar();
            }}
            aria-label="Repair Vehicle"
            title="Repair Body & Mechanics (F)"
            className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors cursor-pointer ${
              telemetry.damage.overallIntegrity < 100
                ? 'border-rose-500/50 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                : 'border-white/12 bg-[#0B0E14]/90 text-slate-200 hover:bg-[#161C28]'
            }`}
          >
            <Wrench className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              controllerRef.current?.resetCar();
            }}
            aria-label="Reset Upright"
            title="Reset Upright (Backspace)"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/12 bg-[#0B0E14]/90 text-slate-200 hover:bg-[#161C28] transition-colors cursor-pointer"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={muted ? 'Unmute Audio' : 'Mute Audio'}
            title="Mute / Unmute Engine Sound (M)"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/12 bg-[#0B0E14]/90 text-slate-200 hover:bg-[#161C28] transition-colors cursor-pointer"
          >
            {muted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4 text-cyan-400" />}
          </button>
        </div>
      </header>

      {/* BOTTOM COLLAPSIBLE DOCK */}
      <div className="flex flex-col items-center px-3 pb-3">
        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleDock();
          }}
          aria-label={dockOpen ? 'Hide Suspension Dock' : 'Show Suspension Dock'}
          title={dockOpen ? 'Hide Suspension Dock (H)' : 'Show Suspension Dock (H)'}
          className="pointer-events-auto mb-1 flex h-6 w-10 items-center justify-center rounded-t-lg border border-b-0 border-white/12 bg-[#0B0E14]/90 text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          {dockOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>

        {dockOpen && (
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-4 rounded-2xl border border-white/12 bg-[#0B0E14]/92 px-4 py-2.5 shadow-2xl">
            {hudMode === 'beamng' ? (
              /* Expanded BeamNG 4-Corner Wheel Telemetry Matrix */
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px] font-mono-tabular sm:grid-cols-4">
                {(['FL', 'FR', 'RL', 'RR'] as const).map((label, idx) => {
                  const comp = telemetry.wheelCompression[idx];
                  const grounded = telemetry.wheelGroundContact[idx];
                  const suspHp = telemetry.damage.suspensionHealth[idx];
                  const wRpm = telemetry.wheelRpm?.[idx] ?? 0;
                  const sAng = telemetry.slipAngleDeg?.[idx] ?? 0;
                  const sRat = telemetry.slipRatio?.[idx] ?? 0;
                  const tTemp = telemetry.tireTempC?.[idx] ?? 45;
                  const bTemp = telemetry.brakeTempC?.[idx] ?? 40;
                  return (
                    <div key={label} className="flex flex-col gap-0.5 border-r border-white/8 pr-3 last:border-r-0 last:pr-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={suspHp < 55 ? 'font-bold text-rose-400' : 'font-bold text-slate-200'}>
                          {label}
                        </span>
                        <div className="h-1.5 w-14 overflow-hidden rounded-sm bg-white/10">
                          <div
                            className={`h-full transition-all duration-75 ${
                              !grounded ? 'bg-slate-600' : comp > 0.78 ? 'bg-rose-500' : 'bg-emerald-400'
                            }`}
                            style={{ width: `${Math.round(comp * 100)}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-slate-300">{wRpm}r</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[9px] text-slate-400">
                        <span>α {sAng.toFixed(1)}°</span>
                        <span>κ {sRat.toFixed(2)}</span>
                        <span className={bTemp > 420 ? 'text-rose-400' : 'text-amber-300'}>
                          {tTemp}°/{bTemp}°C
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Horizon Minimal 4-Corner Suspension Travel & Torque */
              <div className="flex items-center gap-3.5">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {(['FL', 'FR', 'RL', 'RR'] as const).map((label, idx) => {
                    const comp = telemetry.wheelCompression[idx];
                    const grounded = telemetry.wheelGroundContact[idx];
                    const suspHp = telemetry.damage.suspensionHealth[idx];
                    return (
                      <div key={label} className="flex items-center gap-1.5">
                        <span
                          className={`w-4 text-[10px] font-mono-tabular ${
                            suspHp < 55
                              ? 'text-rose-400'
                              : suspHp < 85
                                ? 'text-amber-400'
                                : 'text-slate-400'
                          }`}
                        >
                          {label}
                        </span>
                        <div className="h-2 w-11 overflow-hidden rounded-sm bg-white/10">
                          <div
                            className={`h-full transition-all duration-75 ${
                              !grounded
                                ? 'bg-slate-600'
                                : comp > 0.78
                                  ? 'bg-rose-500'
                                  : 'bg-emerald-400'
                            }`}
                            style={{ width: `${Math.round(comp * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col border-l border-white/10 pl-3 text-[10px] font-mono-tabular text-slate-400">
                  <span className={telemetry.isAirborne ? 'font-semibold text-amber-300' : 'text-emerald-400'}>
                    {telemetry.isAirborne ? 'Airborne' : 'Springs Active'}
                  </span>
                  <span>
                    {telemetry.wheelTorqueNm.toLocaleString()} Nm
                    {Math.abs(telemetry.damage.alignmentPullDeg) >= 0.2
                      ? ` · Pull ${telemetry.damage.alignmentPullDeg > 0 ? '+' : ''}${telemetry.damage.alignmentPullDeg}°`
                      : ''}
                  </span>
                </div>
              </div>
            )}

            {/* Camera View Icon Selector */}
            <div className="flex items-center gap-1 border-l border-white/10 pl-3">
              {(['chase', 'hood', 'cockpit', 'wheel', 'orbit'] as CameraMode[]).map((m) => {
                const Icon = CAMERA_ICONS[m];
                const active = cameraMode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onSelectCamera(m);
                    }}
                    aria-label={CAMERA_LABELS[m]}
                    title={`${CAMERA_LABELS[m]} (Drag mouse to look around)`}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors cursor-pointer ${
                      active
                        ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-300'
                        : 'border-white/8 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
