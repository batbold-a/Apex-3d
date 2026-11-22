import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CarFront, Check, Map as MapIcon, Play } from 'lucide-react';
import { CARS } from '../data/cars';
import { MAPS } from '../data/maps';
import {
  disposeLobbyPreviewRenderer,
  renderCarPreviewDataUrl,
  renderMapPreviewDataUrl,
} from '../engine/lobbyPreviews';
import { CarSpec, MapId, MapSpec } from '../types/vehicle';

interface GameLobbyProps {
  selectedCar: CarSpec;
  selectedPaint: string;
  selectedMap: MapSpec;
  onSelectCar: (car: CarSpec) => void;
  onSelectPaint: (hex: string) => void;
  onSelectMap: (map: MapSpec) => void;
  onStartDrive: () => void;
}

type LobbySection = 'cars' | 'maps';

export const GameLobby: React.FC<GameLobbyProps> = ({
  selectedCar,
  selectedPaint,
  selectedMap,
  onSelectCar,
  onSelectPaint,
  onSelectMap,
  onStartDrive,
}) => {
  const [section, setSection] = useState<LobbySection>('cars');
  const [carThumbs, setCarThumbs] = useState<Record<string, string>>({});
  const [mapThumbs, setMapThumbs] = useState<Partial<Record<MapId, string>>>({});

  // Generate crisp 3D studio renders for all cars (updating active car when paint changes)
  useEffect(() => {
    const nextCarThumbs: Record<string, string> = {};
    for (const car of CARS) {
      const paint = car.id === selectedCar.id ? selectedPaint : car.defaultColor;
      const url = renderCarPreviewDataUrl(car, paint);
      if (url) nextCarThumbs[car.id] = url;
    }
    setCarThumbs(nextCarThumbs);
  }, [selectedCar.id, selectedPaint]);

  // Generate 3D terrain dioramas for all maps once on lobby mount, and dispose preview GL on unmount
  useEffect(() => {
    const nextMapThumbs: Partial<Record<MapId, string>> = {};
    for (const map of MAPS) {
      const url = renderMapPreviewDataUrl(map.id);
      if (url) nextMapThumbs[map.id] = url;
    }
    setMapThumbs(nextMapThumbs);

    return () => {
      disposeLobbyPreviewRenderer();
    };
  }, []);

  const selectedPaintName = useMemo(
    () =>
      selectedCar.paintOptions.find(
        (p) => p.hex.toLowerCase() === selectedPaint.toLowerCase()
      )?.name ?? 'Custom',
    [selectedCar, selectedPaint]
  );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#090C12] text-slate-100">
      {/* Top Bar: Brand — Cars / Maps Tabs — Primary Launch CTA */}
      <header className="shrink-0 border-b border-white/10 bg-[#0D121B]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-6 py-3.5">
          <span className="font-display text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            Apex Drive 3D
          </span>

          <nav
            aria-label="Lobby Sections"
            className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#090C12] p-1 shrink-0"
          >
            <button
              type="button"
              onClick={() => setSection('cars')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                section === 'cars'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <CarFront className="h-3.5 w-3.5" />
              <span>Cars</span>
            </button>

            <button
              type="button"
              onClick={() => setSection('maps')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                section === 'maps'
                  ? 'bg-cyan-400 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              <span>Maps</span>
            </button>
          </nav>

          <button
            type="button"
            onClick={onStartDrive}
            className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 font-display text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>Start Driving</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto flex h-full max-w-[1440px] flex-col justify-between gap-8">
          {section === 'cars' ? (
            <>
              {/* Cars Section Header */}
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h1 className="font-display text-3xl font-bold tracking-tight text-white">
                    Select Your Vehicle
                  </h1>
                  <p className="mt-1 text-sm text-slate-400">
                    Click any vehicle to inspect its build and customize factory paint.
                  </p>
                </div>
                <div className="text-xs text-slate-400 font-mono-tabular">
                  Selected Map <span className="mx-1.5 text-slate-600">·</span>{' '}
                  <button
                    type="button"
                    onClick={() => setSection('maps')}
                    className="font-semibold text-cyan-300 hover:text-cyan-200 underline-offset-4 hover:underline cursor-pointer"
                  >
                    {selectedMap.name}
                  </button>
                </div>
              </div>

              {/* Horizontal Side-by-Side 3D Car Design Gallery */}
              <section
                aria-label="Vehicle Showroom"
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
              >
                {CARS.map((car) => {
                  const active = car.id === selectedCar.id;
                  const thumb = carThumbs[car.id];
                  const swatch = active ? selectedPaint : car.defaultColor;

                  return (
                    <button
                      key={car.id}
                      type="button"
                      onClick={() => onSelectCar(car)}
                      className={`group flex flex-col overflow-hidden rounded-2xl text-left transition-all duration-150 cursor-pointer ${
                        active
                          ? 'bg-[#141B29] ring-2 ring-amber-400 shadow-2xl'
                          : 'border border-white/10 bg-[#0F141F] hover:border-white/25 hover:bg-[#131926]'
                      }`}
                    >
                      {/* 3D Studio Car Render */}
                      <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#0C111B]">
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={car.name}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <CarFront className="h-10 w-10 text-slate-700" />
                          </div>
                        )}
                        {active && (
                          <span className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-slate-950 shadow">
                            <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                          </span>
                        )}
                      </div>

                      {/* Minimal Clean Title + 1-Line Spec Summary */}
                      <div className="flex flex-1 flex-col justify-between p-4">
                        <div>
                          <h2 className="font-display text-base font-bold text-white leading-snug">
                            {car.name}
                          </h2>
                          <p className="mt-1 text-xs text-slate-400 font-mono-tabular">
                            {car.horsepower} HP <span className="text-slate-600">·</span>{' '}
                            {car.drivetrain} <span className="text-slate-600">·</span>{' '}
                            {car.topSpeedKmh} km/h
                          </p>
                        </div>

                        {/* Subtle paint bar indicator */}
                        <div className="mt-4 flex items-center justify-between border-t border-white/8 pt-3 text-[11px] text-slate-400">
                          <span className="truncate">{car.bodyStyle.toUpperCase()}</span>
                          <span
                            className="h-2.5 w-6 rounded-full border border-white/25"
                            style={{ backgroundColor: swatch }}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </section>

              {/* Selected Car Finish & Key Specs Strip */}
              <section
                aria-label="Selected Vehicle Details"
                className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-white/10 bg-[#0F141F] px-6 py-5"
              >
                <div className="min-w-[220px]">
                  <div className="text-xs text-slate-400">Selected Build</div>
                  <div className="mt-0.5 font-display text-xl font-bold text-white">
                    {selectedCar.name}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">{selectedCar.subtitle}</div>
                </div>

                {/* Factory Paint Selector */}
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-slate-400">Paint</span>
                  <div className="flex items-center gap-2">
                    {selectedCar.paintOptions.map((p) => {
                      const isSelected = p.hex.toLowerCase() === selectedPaint.toLowerCase();
                      return (
                        <button
                          key={p.name}
                          type="button"
                          title={p.name}
                          aria-label={p.name}
                          onClick={() => onSelectPaint(p.hex)}
                          className={`h-7 w-7 rounded-full border-2 transition-transform cursor-pointer ${
                            isSelected ? 'scale-110 border-white' : 'border-white/25 hover:scale-105'
                          }`}
                          style={{ backgroundColor: p.hex }}
                        />
                      );
                    })}
                  </div>
                  <span className="text-xs text-slate-300 whitespace-nowrap">{selectedPaintName}</span>
                </div>

                {/* Clean Tabular Key Metrics */}
                <div className="flex items-center gap-6 border-l border-white/10 pl-6 text-xs font-mono-tabular">
                  <div>
                    <div className="text-[11px] text-slate-500">Power</div>
                    <div className="font-semibold text-white">{selectedCar.horsepower} HP</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Torque</div>
                    <div className="font-semibold text-white">{selectedCar.peakTorqueNm} Nm</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Travel</div>
                    <div className="font-semibold text-white">
                      {Math.round(selectedCar.suspensionMaxTravel * 1000)} mm
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Diff</div>
                    <div className="font-semibold text-amber-300">
                      {selectedCar.hasDiffLock ? 'Lockable' : 'Limited Slip'}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSection('maps')}
                  className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-semibold text-white hover:bg-white/10 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>Choose Map</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </section>
            </>
          ) : (
            <>
              {/* Maps Section Header */}
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h1 className="font-display text-3xl font-bold tracking-tight text-white">
                    Choose Your Proving Ground
                  </h1>
                  <p className="mt-1 text-sm text-slate-400">
                    Each environment features distinct elevation, surface grip, and terrain geometry.
                  </p>
                </div>
                <div className="text-xs text-slate-400 font-mono-tabular">
                  Selected Vehicle <span className="mx-1.5 text-slate-600">·</span>{' '}
                  <button
                    type="button"
                    onClick={() => setSection('cars')}
                    className="font-semibold text-amber-300 hover:text-amber-200 underline-offset-4 hover:underline cursor-pointer"
                  >
                    {selectedCar.name}
                  </button>
                </div>
              </div>

              {/* Visual 3D Terrain Diorama Map Grid */}
              <section
                aria-label="Map Environments"
                className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
              >
                {MAPS.map((map) => {
                  const active = map.id === selectedMap.id;
                  const thumb = mapThumbs[map.id];

                  return (
                    <button
                      key={map.id}
                      type="button"
                      onClick={() => onSelectMap(map)}
                      className={`group flex flex-col overflow-hidden rounded-2xl text-left transition-all duration-150 cursor-pointer ${
                        active
                          ? 'bg-[#131C2A] ring-2 ring-cyan-400 shadow-2xl'
                          : 'border border-white/10 bg-[#0F141F] hover:border-white/25 hover:bg-[#131926]'
                      }`}
                    >
                      {/* 3D Terrain Diorama Preview */}
                      <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#0C111B]">
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={map.name}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <MapIcon className="h-10 w-10 text-slate-700" />
                          </div>
                        )}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#0F141F] via-[#0F141F]/40 to-transparent" />
                        {active && (
                          <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400 text-slate-950 shadow">
                            <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                          </span>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col justify-between p-5">
                        <div>
                          <h2 className="font-display text-lg font-bold text-white leading-snug">
                            {map.name}
                          </h2>
                          <p className="mt-1.5 text-xs text-slate-300 leading-relaxed">
                            {map.subtitle}
                          </p>
                        </div>

                        <div className="mt-4 flex items-center justify-between border-t border-white/8 pt-3 text-[11px] font-mono-tabular">
                          <span className="text-slate-400">{map.surfaceSummary}</span>
                          <span className="font-semibold text-cyan-300 whitespace-nowrap ml-2">
                            {map.difficulty}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </section>

              {/* Selected Map Summary & Launch Strip */}
              <section
                aria-label="Launch Summary"
                className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-white/10 bg-[#0F141F] px-6 py-5"
              >
                <div className="flex items-center gap-4">
                  <span
                    className="h-4 w-4 rounded-full border border-white/40 shrink-0"
                    style={{ backgroundColor: selectedPaint }}
                  />
                  <div>
                    <div className="text-xs text-slate-400">Ready to Launch</div>
                    <div className="mt-0.5 font-display text-lg font-bold text-white">
                      {selectedCar.name} <span className="mx-1.5 text-slate-500">·</span>{' '}
                      <span className="text-cyan-300">{selectedMap.name}</span>
                    </div>
                  </div>
                </div>

                <div className="text-xs font-mono-tabular text-slate-400">
                  Recommended <span className="mx-1.5 text-slate-600">·</span>{' '}
                  <span className="text-slate-200">{selectedMap.recommendedGear}</span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSection('cars')}
                    className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    Back to Cars
                  </button>
                  <button
                    type="button"
                    onClick={onStartDrive}
                    className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 font-display text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>Start Driving</span>
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
};
