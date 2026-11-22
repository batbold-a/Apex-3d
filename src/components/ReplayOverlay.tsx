import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Film,
  Gauge,
  Pause,
  Play,
  Rewind,
  Route,
  SkipBack,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { ReplayCameraMode, ReplayStateSummary, TelemetryData } from '../types/vehicle';
import { DrivingControllerRef } from './DrivingCanvas';

interface ReplayOverlayProps {
  replayState: ReplayStateSummary;
  telemetry: TelemetryData;
  muted: boolean;
  onToggleReplayRecording: () => void;
  onToggleMute: () => void;
  controllerRef: React.MutableRefObject<DrivingControllerRef | null>;
}

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1.0] as const;

const REPLAY_CAM_OPTIONS: { id: ReplayCameraMode; label: string }[] = [
  { id: 'director', label: 'Director' },
  { id: 'trackside', label: 'Trackside' },
  { id: 'helicopter', label: 'Chopper' },
  { id: 'fender', label: 'Fender' },
  { id: 'chase', label: 'Chase' },
  { id: 'hood', label: 'Hood' },
  { id: 'cockpit', label: 'Cockpit' },
];

function formatTimeSec(sec: number): string {
  const clamped = Math.max(0, sec);
  const mins = Math.floor(clamped / 60);
  const rem = clamped - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
}

export const ReplayOverlay: React.FC<ReplayOverlayProps> = React.memo(({
  replayState,
  telemetry,
  muted,
  onToggleReplayRecording,
  onToggleMute,
  controllerRef,
}) => {
  const [controlsOpen, setControlsOpen] = useState(true);
  const duration = Math.max(0.1, replayState.durationSec);
  const progressPct = Math.max(0, Math.min(100, (replayState.currentTimeSec / duration) * 100));

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between">
      {/* Subtle cinema edge vignette */}
      {replayState.cinemaBars && (
        <div
          className="pointer-events-none fixed inset-0 z-0 transition-opacity duration-300"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(0,0,0,0) 58%, rgba(0,0,0,0.44) 100%)',
          }}
        />
      )}

      {/* Anamorphic 2.39:1 Letterbox Bars (compositor-only transform animation) */}
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-x-0 top-0 z-10 h-[7.5vh] max-h-16 bg-black transition-transform duration-300 ease-out ${
          replayState.cinemaBars ? 'translate-y-0' : '-translate-y-full'
        }`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-x-0 bottom-0 z-10 h-[7.5vh] max-h-16 bg-black transition-transform duration-300 ease-out ${
          replayState.cinemaBars ? 'translate-y-0' : 'translate-y-full'
        }`}
      />

      {/* TOP CINEMA BROADCAST HEADER */}
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-4 px-5 pt-3">
        <div className="pointer-events-auto flex flex-col gap-1">
          <div className="flex items-center gap-2.5 text-xs font-medium text-slate-200 whitespace-nowrap">
            <span className="font-display font-bold tracking-wider text-amber-400 uppercase">
              Replay Mode
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="font-mono-tabular text-cyan-300">
              {replayState.playbackSpeed}x {replayState.playbackSpeed < 1 ? 'Slow-Mo' : 'Live Speed'}
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-200">{replayState.activeDirectorShot}</span>
          </div>

          {replayState.showReplayTelemetry && (
            <div className="flex items-center gap-2.5 text-[11px] font-mono-tabular text-slate-300 whitespace-nowrap">
              <span className="font-bold text-white">{telemetry.speedKmh} KM/H</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>Gear {telemetry.gearLabel}</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-amber-300">{telemetry.rpm.toLocaleString()} RPM</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>{Math.abs(telemetry.lateralG ?? 0).toFixed(2)} G</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-slate-400">{telemetry.surfaceName}</span>
            </div>
          )}
        </div>

        <div className="pointer-events-auto flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleReplayRecording();
            }}
            title="Enable or disable background 30s replay recording while driving"
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-cyan-400 ${
              replayState.recordingEnabled
                ? 'border-emerald-500/40 bg-[#0B0E14]/94 text-emerald-300 hover:bg-[#161C28]'
                : 'border-white/15 bg-[#0B0E14]/94 text-slate-400 hover:text-white'
            }`}
          >
            <span>{replayState.recordingEnabled ? 'Rec Enabled' : 'Rec Off'}</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={muted ? 'Unmute Audio' : 'Mute Audio'}
            title="Mute / Unmute Audio (M)"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-[#0B0E14]/94 text-slate-200 hover:bg-[#161C28] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            {muted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4 text-cyan-400" />}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              controllerRef.current?.exitReplay();
            }}
            title="Exit Replay Mode and return to driving (P / Esc)"
            className="flex h-9 items-center gap-1.5 rounded-lg border border-amber-400/60 bg-amber-500/20 px-3.5 text-xs font-bold text-amber-200 hover:bg-amber-500/30 transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            <X className="h-3.5 w-3.5" />
            <span>Exit Replay</span>
          </button>
        </div>
      </header>

      {/* UNIFIED BOTTOM-CENTER CINEMA REPLAY DOCK */}
      <div className="relative z-20 flex flex-col items-center px-3 pb-3">
        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            setControlsOpen((v) => !v);
          }}
          aria-label={controlsOpen ? 'Hide Replay Controls' : 'Show Replay Controls'}
          title={controlsOpen ? 'Hide Replay Controls for Clean Cinema View' : 'Show Replay Controls'}
          className="pointer-events-auto mb-1 flex h-6 w-12 items-center justify-center rounded-t-lg border border-b-0 border-white/14 bg-[#0B0E14]/94 text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          {controlsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>

        {controlsOpen && (
          <div className="pointer-events-auto flex w-full max-w-[940px] flex-col gap-2.5 rounded-2xl border border-white/14 bg-[#0B0E14]/94 px-4 py-3 shadow-2xl">
            {/* Row 1: 30s Telemetry Timeline Scrubber */}
            <div className="flex items-center gap-3">
              <span className="w-14 text-xs font-mono-tabular font-semibold text-white shrink-0">
                {formatTimeSec(replayState.currentTimeSec)}
              </span>

              <div className="relative flex flex-1 items-center">
                <input
                  type="range"
                  aria-label="Replay Timeline Scrubber"
                  min={0}
                  max={duration}
                  step={0.02}
                  value={Math.min(duration, replayState.currentTimeSec)}
                  onChange={(e) => {
                    controllerRef.current?.seekReplay(parseFloat(e.target.value));
                  }}
                  style={{
                    background: `linear-gradient(to right, #38bdf8 0%, #f59e0b ${progressPct}%, rgba(255,255,255,0.12) ${progressPct}%, rgba(255,255,255,0.12) 100%)`,
                  }}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full accent-amber-400"
                />
              </div>

              <span className="w-14 text-right text-xs font-mono-tabular text-slate-400 shrink-0">
                {formatTimeSec(replayState.durationSec)}
              </span>
            </div>

            {/* Row 2: Transport, Slow-Mo Speed, Camera Angle Selector & Visual Switches */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              {/* Transport & Slow-Mo Speed */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    controllerRef.current?.seekReplay(0);
                  }}
                  aria-label="Restart Clip"
                  title="Restart Replay"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/12 bg-white/5 text-slate-200 hover:bg-white/12 transition-colors cursor-pointer"
                >
                  <SkipBack className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    controllerRef.current?.seekReplay(Math.max(0, replayState.currentTimeSec - 2));
                  }}
                  aria-label="Rewind 2 Seconds"
                  title="Rewind 2s (Left Arrow)"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/12 bg-white/5 text-slate-200 hover:bg-white/12 transition-colors cursor-pointer"
                >
                  <Rewind className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    controllerRef.current?.setReplayPlaying(!replayState.isPlaying);
                  }}
                  aria-label={replayState.isPlaying ? 'Pause Replay' : 'Play Replay'}
                  title="Play / Pause (Space)"
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-cyan-400/55 bg-cyan-500/20 px-3 text-xs font-bold text-cyan-200 hover:bg-cyan-500/30 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {replayState.isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  <span>{replayState.isPlaying ? 'Pause' : 'Play'}</span>
                </button>

                <div className="ml-1 flex items-center rounded-lg border border-white/10 bg-white/4 p-0.5">
                  {SPEED_OPTIONS.map((spd) => {
                    const active = Math.abs(replayState.playbackSpeed - spd) < 0.02;
                    return (
                      <button
                        key={spd}
                        type="button"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          controllerRef.current?.setReplaySpeed(spd);
                        }}
                        className={`rounded-md px-2 py-1 text-[11px] font-mono-tabular font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          active
                            ? 'bg-amber-500 text-slate-950'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {spd}x
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Camera Angle Selector */}
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-white/4 p-0.5">
                {REPLAY_CAM_OPTIONS.map((cam) => {
                  const active = replayState.cameraMode === cam.id;
                  return (
                    <button
                      key={cam.id}
                      type="button"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        controllerRef.current?.setReplayCamera(cam.id);
                      }}
                      title={`Switch camera to ${cam.label} (Cycle: C)`}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-cyan-500 text-slate-950 font-bold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {cam.label}
                    </button>
                  );
                })}
              </div>

              {/* Cinematic Visual Toggles */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    controllerRef.current?.setReplayShowLine(!replayState.showDrivingLine);
                  }}
                  title="Toggle 3D Telemetry Driving Line Ribbon"
                  className={`flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    replayState.showDrivingLine
                      ? 'border-cyan-400/55 bg-cyan-500/20 text-cyan-200'
                      : 'border-white/10 bg-white/4 text-slate-400 hover:text-white'
                  }`}
                >
                  <Route className="h-3.5 w-3.5" />
                  <span>Line</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    controllerRef.current?.setReplayCinemaBars(!replayState.cinemaBars);
                  }}
                  title="Toggle Anamorphic Widescreen Letterbox"
                  className={`flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    replayState.cinemaBars
                      ? 'border-amber-400/55 bg-amber-500/20 text-amber-200'
                      : 'border-white/10 bg-white/4 text-slate-400 hover:text-white'
                  }`}
                >
                  <Film className="h-3.5 w-3.5" />
                  <span>Bars</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    controllerRef.current?.setReplayShowTelemetry(!replayState.showReplayTelemetry);
                  }}
                  title="Toggle Telemetry Readout"
                  className={`flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    replayState.showReplayTelemetry
                      ? 'border-white/25 bg-white/12 text-white'
                      : 'border-white/10 bg-white/4 text-slate-400 hover:text-white'
                  }`}
                >
                  <Gauge className="h-3.5 w-3.5" />
                  <span>Data</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
