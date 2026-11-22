import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Crosshair,
  Minus,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  AIBehaviorMode,
  PinballConfig,
  PinballTelemetrySummary,
} from '../types/pinball';

interface PinballHUDProps {
  config: PinballConfig;
  summary: PinballTelemetrySummary;
  physicsStepMs: number;
  renderFps: number;
  onUpdateConfig: (patch: Partial<PinballConfig>) => void;
  onToggleEnabled: () => void;
  onRespawnAi: () => void;
}

const BEHAVIOR_OPTIONS: { id: AIBehaviorMode; label: string; desc: string }[] = [
  { id: 'cruise', label: 'Cruise', desc: 'Follow map roads & loops' },
  { id: 'evade', label: 'Evade', desc: 'Dodge & flee approaching player' },
  { id: 'arena', label: 'Arena', desc: 'Hunt & line up collision runs' },
];

export const PinballHUD: React.FC<PinballHUDProps> = React.memo(({
  config,
  summary,
  physicsStepMs,
  renderFps,
  onUpdateConfig,
  onToggleEnabled,
  onRespawnAi,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showImpactFlash, setShowImpactFlash] = useState(false);

  useEffect(() => {
    if (!config.enabled || summary.lastImpactAtMs <= 0) {
      setShowImpactFlash(false);
      return;
    }
    const ageMs = Date.now() - summary.lastImpactAtMs;
    if (ageMs < 1500) {
      setShowImpactFlash(true);
      const timer = window.setTimeout(() => setShowImpactFlash(false), 1500 - ageMs);
      return () => window.clearTimeout(timer);
    }
    setShowImpactFlash(false);
  }, [config.enabled, summary.lastImpactAtMs, summary.hitCount]);

  const cycleMultiplier = () => {
    const next = config.multiplier >= 5 ? 1 : config.multiplier + 1;
    onUpdateConfig({ multiplier: next });
  };

  return (
    <div className="relative">
      {/* Compact Single-Line Top-Bar Control */}
      <div
        className={`flex h-9 items-center rounded-lg border bg-[#0B0E14]/92 p-0.5 transition-colors ${
          config.enabled ? 'border-amber-400/60' : 'border-white/12'
        }`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleEnabled();
          }}
          aria-label={config.enabled ? 'Disable Pinball Mode' : 'Enable Pinball Mode'}
          title="Pinball Physics & AI Targets (U): Opt-in arcade impact solver + dynamic AI vehicles"
          className={`flex h-full items-center gap-1.5 rounded-md px-2 text-[11px] font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
            config.enabled
              ? 'bg-amber-500/22 text-amber-300 hover:bg-amber-500/32'
              : 'text-slate-300 hover:bg-white/8 hover:text-white'
          }`}
        >
          <Zap className="h-3.5 w-3.5" />
          <span>{config.enabled ? 'Pinball' : 'Pinball Off'}</span>
        </button>

        <div className="h-4 w-px bg-white/10" />

        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            cycleMultiplier();
          }}
          aria-label={`Cycle Pinball Force Multiplier (Currently ${config.multiplier}x)`}
          title="Click to cycle Pinball force multiplier (1x–5x)"
          className="flex h-full items-center px-2 font-mono-tabular text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/15 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          {config.multiplier}x
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            setDrawerOpen((v) => !v);
          }}
          aria-label="Configure Pinball Physics & AI Fleet"
          title="Pinball Physics & AI Target Fleet Settings"
          className={`flex h-full w-6 items-center justify-center rounded-md transition-colors cursor-pointer ${
            drawerOpen
              ? 'bg-white/12 text-white'
              : 'text-slate-400 hover:bg-white/8 hover:text-slate-200'
          }`}
        >
          {drawerOpen ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Transient Smash Telemetry Flash */}
      {showImpactFlash && config.enabled && !drawerOpen && (
        <div className="pointer-events-none absolute right-0 mt-1.5 flex items-center gap-2 rounded-lg border border-amber-400/50 bg-[#0B0E14]/95 px-2.5 py-1 text-[11px] font-mono-tabular shadow-xl whitespace-nowrap">
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
          <span className="font-display font-bold tracking-wide text-amber-300">SMASH</span>
          <span className="text-slate-200">{summary.lastImpactSpeedKmh} km/h</span>
          <span className="text-slate-500">·</span>
          <span className="text-cyan-300">
            {(summary.lastImpactImpulseNs / 1000).toFixed(1)} kN·s
          </span>
        </div>
      )}

      {/* Expandable Pinball & AI Fleet Controls Drawer */}
      {drawerOpen && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-white/14 bg-[#0B0E14]/97 p-3.5 shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div>
              <div className="font-display text-xs font-bold tracking-wider text-white uppercase">
                Pinball Mode &amp; AI Fleet
              </div>
              <div className="text-[10px] text-slate-400">
                Contact-normal Rapier impulse &amp; dynamic AI cars
              </div>
            </div>
            <button
              type="button"
              onClick={() => onToggleEnabled()}
              className={`rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                config.enabled
                  ? 'border-amber-400/60 bg-amber-500/20 text-amber-300'
                  : 'border-white/15 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {config.enabled ? 'Active' : 'Disabled'}
            </button>
          </div>

          {/* 1x - 5x Force Multiplier */}
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-200">Force Multiplier</span>
              <span className="font-mono-tabular font-bold text-cyan-300">
                {config.multiplier}x
              </span>
            </div>
            <div className="grid grid-cols-5 gap-1">
              {[1, 2, 3, 4, 5].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onUpdateConfig({ multiplier: m })}
                  className={`rounded-md border py-1 font-mono-tabular text-[11px] font-bold transition-colors cursor-pointer ${
                    config.multiplier === m
                      ? 'border-cyan-400/70 bg-cyan-500/22 text-cyan-200'
                      : 'border-white/10 bg-white/4 text-slate-400 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  {m}x
                </button>
              ))}
            </div>
          </div>

          {/* Upward Pop & Barrier Bounce */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-[10px]">
                <span className="text-slate-300">Upward Lift</span>
                <span className="font-mono-tabular text-amber-300">
                  {Math.round(config.upwardLaunchScale * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(config.upwardLaunchScale * 100)}
                onChange={(e) =>
                  onUpdateConfig({ upwardLaunchScale: Number(e.target.value) / 100 })
                }
                aria-label="Upward Launch Scale"
                className="w-full accent-amber-400 cursor-pointer"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-[10px]">
                <span className="text-slate-300">Barrier Bounce</span>
                <span className="font-mono-tabular text-cyan-300">
                  {Math.round(config.barrierBounceScale * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={60}
                step={5}
                value={Math.round(config.barrierBounceScale * 100)}
                onChange={(e) =>
                  onUpdateConfig({ barrierBounceScale: Number(e.target.value) / 100 })
                }
                aria-label="Static Barrier Bounce Scale"
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>
          </div>

          {/* AI Fleet Count (0-8) & Respawn */}
          <div className="mt-3 border-t border-white/10 pt-2.5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-slate-200">
                  AI Target Cars
                </div>
                <div className="text-[10px] text-slate-400">
                  Active: <span className="font-mono-tabular text-slate-200">{summary.activeAiCount}</span> / 8
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onUpdateConfig({ aiCount: Math.max(0, config.aiCount - 1) })}
                  aria-label="Decrease AI Target Count"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-white/12 bg-white/5 text-slate-200 hover:bg-white/12 cursor-pointer"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-5 text-center font-mono-tabular text-xs font-bold text-white">
                  {config.aiCount}
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateConfig({ aiCount: Math.min(8, config.aiCount + 1) })}
                  aria-label="Increase AI Target Count"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-white/12 bg-white/5 text-slate-200 hover:bg-white/12 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={!config.enabled || config.aiCount === 0}
                  onClick={onRespawnAi}
                  title="Respawn AI pack cleanly around player"
                  className="ml-1 flex h-7 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 text-[10px] font-bold text-amber-300 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Respawn</span>
                </button>
              </div>
            </div>

            {/* AI Behavior Mode */}
            <div className="mt-2.5 grid grid-cols-3 gap-1">
              {BEHAVIOR_OPTIONS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  title={b.desc}
                  onClick={() => onUpdateConfig({ aiBehavior: b.id })}
                  className={`rounded-md border py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    config.aiBehavior === b.id
                      ? b.id === 'arena'
                        ? 'border-amber-400/70 bg-amber-500/20 text-amber-200'
                        : b.id === 'evade'
                          ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-200'
                          : 'border-cyan-400/70 bg-cyan-500/20 text-cyan-200'
                      : 'border-white/10 bg-white/4 text-slate-400 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            {/* Target Speed, Aggression & Spawn Distance */}
            <div className="mt-2.5 space-y-2">
              <div>
                <div className="mb-0.5 flex items-center justify-between text-[10px]">
                  <span className="text-slate-300">Target Speed</span>
                  <span className="font-mono-tabular text-slate-200">
                    {config.aiTargetSpeedKmh} km/h
                  </span>
                </div>
                <input
                  type="range"
                  min={25}
                  max={160}
                  step={5}
                  value={config.aiTargetSpeedKmh}
                  onChange={(e) =>
                    onUpdateConfig({ aiTargetSpeedKmh: Number(e.target.value) })
                  }
                  aria-label="AI Target Speed"
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-0.5 flex items-center justify-between text-[10px]">
                    <span className="text-slate-300">Aggression</span>
                    <span className="font-mono-tabular text-amber-300">
                      {Math.round(config.aiAggression * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(config.aiAggression * 100)}
                    onChange={(e) =>
                      onUpdateConfig({ aiAggression: Number(e.target.value) / 100 })
                    }
                    aria-label="AI Aggression"
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="mb-0.5 flex items-center justify-between text-[10px]">
                    <span className="text-slate-300">Spawn Dist</span>
                    <span className="font-mono-tabular text-slate-200">
                      {config.aiSpawnDistanceM}m
                    </span>
                  </div>
                  <input
                    type="range"
                    min={24}
                    max={140}
                    step={4}
                    value={config.aiSpawnDistanceM}
                    onChange={(e) =>
                      onUpdateConfig({ aiSpawnDistanceM: Number(e.target.value) })
                    }
                    aria-label="AI Spawn Distance"
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Performance & Last Impact Footer */}
          <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2 text-[10px] font-mono-tabular text-slate-400">
            <span className="flex items-center gap-1">
              <Crosshair className="h-3 w-3 text-amber-400" />
              Hits: <strong className="text-slate-200">{summary.hitCount}</strong>
            </span>
            <span
              className={`flex items-center gap-1 ${
                summary.perfThrottled ? 'text-rose-400' : 'text-emerald-400'
              }`}
              title="Adaptive Rapier physics budget monitor"
            >
              {summary.perfThrottled && <ShieldAlert className="h-3 w-3" />}
              {physicsStepMs.toFixed(2)}ms · {renderFps}fps
            </span>
          </div>
        </div>
      )}
    </div>
  );
});
