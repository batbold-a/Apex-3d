import React, { useState } from 'react';
import { CheckCircle2, FlaskConical, Play, RotateCw, X, XCircle } from 'lucide-react';
import {
  BENCHMARK_ORDER,
  BenchmarkId,
  runAllBenchmarks,
  runSingleBenchmark,
} from '../engine/benchmarks';
import { BenchmarkMetricItem, BenchmarkSuiteSummary } from '../engine/storage';
import { CarSpec, TelemetryData, VehicleTuningSetup } from '../types/vehicle';

interface ValidationBenchModalProps {
  open: boolean;
  car: CarSpec;
  tuning: VehicleTuningSetup;
  telemetry: TelemetryData;
  savedRecord?: BenchmarkSuiteSummary;
  onSaveRecord: (summary: BenchmarkSuiteSummary) => void;
  onClose: () => void;
}

const BENCHMARK_LABELS: Record<BenchmarkId, { title: string; criteria: string }> = {
  'accel-0-100': { title: '0–100 km/h Acceleration', criteria: 'Realistic power-to-weight launch' },
  'coast-down': { title: '120 → 20 km/h Coast-Down', criteria: 'Monotonic aero & rolling decel' },
  'brake-100-0': { title: '100–0 km/h Emergency Brake (ABS)', criteria: '25–40 m, ABS slip modulated' },
  'split-mu-brake': { title: 'Split-μ Braking (1.08 / 0.30)', criteria: 'ABS cuts split-surface yaw spin' },
  'skidpad-40m': { title: 'Constant-Radius Skid Pad (R=40m)', criteria: 'Peak lateral G & stable roll' },
  'step-steer': { title: 'Step-Steer Transient (80 km/h)', criteria: 'Bounded yaw overshoot & settle' },
  'iso-dlc': { title: 'ISO Double Lane Change (78+ km/h)', criteria: 'Clean lane shift without spin' },
  'rebound-drop': { title: 'Suspension Rebound (1.0m Drop)', criteria: 'Settle < 30 mm/s in ≤ 5 cycles' },
  'high-speed-stability': { title: 'High-Speed Stability & Disturbance', criteria: 'Damped recovery near Vmax' },
  'multi-surface': { title: 'Multi-Surface Traction (0–50 km/h)', criteria: 'Asphalt > Cobble / Gravel / Sand' },
  'collision-integrity': { title: 'Barrier Collision & Momentum', criteria: 'Zero tunneling, impact damage' },
};

export const ValidationBenchModal: React.FC<ValidationBenchModalProps> = ({
  open,
  car,
  tuning,
  telemetry,
  savedRecord,
  onSaveRecord,
  onClose,
}) => {
  const [runningAll, setRunningAll] = useState(false);
  const [runningId, setRunningId] = useState<BenchmarkId | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 11 });
  const [liveResults, setLiveResults] = useState<Record<string, BenchmarkMetricItem>>(() => {
    const initial: Record<string, BenchmarkMetricItem> = {};
    savedRecord?.results.forEach((r) => {
      initial[r.id] = r;
    });
    return initial;
  });

  if (!open) return null;

  const displayResults: Record<string, BenchmarkMetricItem> = {};
  savedRecord?.results.forEach((r) => {
    displayResults[r.id] = r;
  });
  Object.values(liveResults).forEach((r) => {
    displayResults[r.id] = r;
  });

  const completedList = BENCHMARK_ORDER.map((id) => displayResults[id]).filter(Boolean);
  const passedCount = completedList.filter((r) => r.passed).length;

  const handleRunAll = async () => {
    if (runningAll || runningId) return;
    setRunningAll(true);
    setProgress({ done: 0, total: BENCHMARK_ORDER.length });
    setLiveResults({});
    try {
      const summary = await runAllBenchmarks(car, tuning, (done, total, latest) => {
        setProgress({ done, total });
        setLiveResults((prev) => ({ ...prev, [latest.id]: latest }));
      });
      onSaveRecord(summary);
    } finally {
      setRunningAll(false);
    }
  };

  const handleRunSingle = async (id: BenchmarkId) => {
    if (runningAll || runningId) return;
    setRunningId(id);
    try {
      const item = await runSingleBenchmark(id, car, tuning);
      const merged = { ...displayResults, [item.id]: item };
      setLiveResults((prev) => ({ ...prev, [item.id]: item }));
      const fullList = BENCHMARK_ORDER.map((bid) => merged[bid]).filter(Boolean);
      onSaveRecord({
        carId: car.id,
        carName: car.name,
        timestampIso: new Date().toISOString(),
        passedCount: fullList.filter((r) => r.passed).length,
        totalCount: fullList.length,
        results: fullList,
      });
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0C1018] text-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-[#111622] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-purple-500/40 bg-purple-500/15 text-purple-300">
              <FlaskConical className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-white">
                Physics Validation Bench
              </h2>
              <p className="text-xs text-slate-400">
                {car.name} <span className="mx-1 text-slate-600">·</span> {tuning.tireCompound} <span className="mx-1 text-slate-600">·</span> 120 Hz Rapier Fixed-Step
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={runningAll || runningId !== null}
              onClick={handleRunAll}
              className="flex items-center gap-2 rounded-xl bg-purple-500 px-4 py-2 font-display text-xs font-bold text-white hover:bg-purple-400 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {runningAll ? (
                <>
                  <RotateCw className="h-3.5 w-3.5 animate-spin" />
                  <span>
                    Running {progress.done}/{progress.total}
                  </span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Run All 11 Benchmarks</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Validation Bench"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/12 bg-white/5 text-slate-300 hover:bg-white/12 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Summary & Runtime Budget Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/8 bg-[#0E131D] px-6 py-3 text-xs font-mono-tabular">
          <div className="flex items-center gap-5">
            <div>
              <span className="text-slate-400">Scorecard </span>
              <span
                className={`font-bold ${
                  completedList.length === 0
                    ? 'text-slate-300'
                    : passedCount === BENCHMARK_ORDER.length
                      ? 'text-emerald-400'
                      : 'text-amber-300'
                }`}
              >
                {completedList.length > 0 ? `${passedCount}/${BENCHMARK_ORDER.length} PASSED` : 'Not Run Yet'}
              </span>
            </div>
            {savedRecord && (
              <div className="text-slate-400">
                Saved <span className="text-slate-300">{new Date(savedRecord.timestampIso).toLocaleTimeString()}</span>
              </div>
            )}
          </div>

          {telemetry.perf && (
            <div className="flex items-center gap-4 text-[11px] text-slate-400">
              <span>
                Step <strong className="text-cyan-300">{telemetry.perf.physicsStepMs.toFixed(2)} ms</strong>
              </span>
              <span>
                Render <strong className="text-white">{telemetry.perf.renderFps} FPS</strong>
              </span>
              <span>
                Budget{' '}
                <strong className={telemetry.perf.overloadActive ? 'text-amber-400' : 'text-emerald-400'}>
                  {telemetry.perf.overloadActive ? 'SCALED' : 'NOMINAL'}
                </strong>
              </span>
            </div>
          )}
        </div>

        {/* Benchmark Rows */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-2">
            {BENCHMARK_ORDER.map((id, idx) => {
              const meta = BENCHMARK_LABELS[id];
              const res = displayResults[id];
              const isBusy = runningId === id;

              return (
                <div
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-[#121826] px-4 py-3"
                >
                  <div className="min-w-[240px] flex-1">
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 text-[11px] font-mono-tabular text-slate-500">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className="text-xs font-semibold text-white">{meta.title}</span>
                    </div>
                    <div className="pl-7 text-[11px] text-slate-400">
                      {res ? `Target: ${res.target}` : meta.criteria}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 font-mono-tabular">
                    {res ? (
                      <>
                        <span className="text-xs text-slate-200">{res.measured}</span>
                        <span
                          className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-bold ${
                            res.passed
                              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                              : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {res.passed ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5" />
                          )}
                          {res.passed ? 'PASS' : 'FAIL'}
                        </span>
                      </>
                    ) : (
                      <span className="text-[11px] text-slate-500">Pending</span>
                    )}

                    <button
                      type="button"
                      disabled={runningAll || runningId !== null}
                      onClick={() => handleRunSingle(id)}
                      title={`Run ${meta.title}`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/12 bg-white/5 text-slate-300 hover:bg-white/12 hover:text-white disabled:opacity-40 cursor-pointer"
                    >
                      <RotateCw className={`h-3.5 w-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
