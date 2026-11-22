import React, { useEffect, useState } from 'react';
import { CarFront, Check, X } from 'lucide-react';
import { CARS } from '../data/cars';
import { disposeLobbyPreviewRenderer, renderCarPreviewDataUrl } from '../engine/lobbyPreviews';
import { CarSpec } from '../types/vehicle';

interface CarSelectorModalProps {
  open: boolean;
  selectedCar: CarSpec;
  selectedPaint: string;
  onSelectCar: (car: CarSpec) => void;
  onSelectPaint: (hex: string) => void;
  onClose: () => void;
}

export const CarSelectorModal: React.FC<CarSelectorModalProps> = ({
  open,
  selectedCar,
  selectedPaint,
  onSelectCar,
  onSelectPaint,
  onClose,
}) => {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      disposeLobbyPreviewRenderer();
      return;
    }
    const next: Record<string, string> = {};
    for (const c of CARS) {
      const paint = c.id === selectedCar.id ? selectedPaint : c.defaultColor;
      const url = renderCarPreviewDataUrl(c, paint);
      if (url) next[c.id] = url;
    }
    setThumbs(next);
  }, [open, selectedCar.id, selectedPaint]);

  useEffect(() => {
    return () => {
      disposeLobbyPreviewRenderer();
    };
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-6xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/12 bg-[#0D121B] p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">Vehicle Garage</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Select a vehicle and paint finish to swap directly in the proving ground.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Garage"
            className="rounded-lg border border-white/12 bg-white/5 p-2 text-slate-300 hover:bg-white/12 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Side-by-Side 3D Vehicle Cards */}
        <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
          {CARS.map((c) => {
            const active = c.id === selectedCar.id;
            const thumb = thumbs[c.id];
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectCar(c)}
                className={`flex flex-col overflow-hidden rounded-xl text-left transition-all cursor-pointer ${
                  active
                    ? 'bg-[#151D2C] ring-2 ring-amber-400'
                    : 'border border-white/10 bg-[#101622] hover:border-white/25'
                }`}
              >
                <div className="relative aspect-[16/10] w-full bg-[#0B0F18]">
                  {thumb ? (
                    <img src={thumb} alt={c.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <CarFront className="h-8 w-8 text-slate-700" />
                    </div>
                  )}
                  {active && (
                    <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-slate-950">
                      <Check className="h-3 w-3 stroke-[2.5]" />
                    </span>
                  )}
                </div>

                <div className="p-3.5">
                  <h3 className="font-display text-sm font-bold text-white leading-snug">{c.name}</h3>
                  <p className="mt-1 text-[11px] text-slate-400 font-mono-tabular">
                    {c.horsepower} HP <span className="text-slate-600">·</span> {c.drivetrain}{' '}
                    <span className="text-slate-600">·</span> {c.topSpeedKmh} km/h
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Factory Paint Selector & Resume */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium text-slate-400">Exterior Paint</span>
            <div className="flex items-center gap-2">
              {selectedCar.paintOptions.map((p) => {
                const isSelected = p.hex.toLowerCase() === selectedPaint.toLowerCase();
                return (
                  <button
                    key={p.name}
                    type="button"
                    title={p.name}
                    onClick={() => onSelectPaint(p.hex)}
                    className={`h-7 w-7 rounded-full border-2 transition-transform cursor-pointer ${
                      isSelected ? 'scale-110 border-white' : 'border-white/25 hover:scale-105'
                    }`}
                    style={{ backgroundColor: p.hex }}
                  />
                );
              })}
            </div>
            <span className="text-xs text-slate-300">
              {selectedCar.paintOptions.find(
                (p) => p.hex.toLowerCase() === selectedPaint.toLowerCase()
              )?.name ?? 'Custom'}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-amber-500 px-5 py-2.5 font-display text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
          >
            Drive {selectedCar.name}
          </button>
        </div>
      </div>
    </div>
  );
};
