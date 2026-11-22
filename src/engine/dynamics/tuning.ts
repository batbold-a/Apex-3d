import { CarSpec, TireCompoundId, VehicleTuningSetup } from '../../types/vehicle';

export function createDefaultTuning(car: CarSpec): VehicleTuningSetup {
  let tireCompound: TireCompoundId = 'sport';
  if (car.id === 'gt3-rs') tireCompound = 'semi-slick';
  else if (car.id === 'wrx-rally') tireCompound = 'offroad-at';
  else if (car.bodyStyle === 'suv') tireCompound = 'offroad-at';
  else if (car.id === 'shelby-gt500') tireCompound = 'sport';

  const isTrack = car.id === 'gt3-rs';
  const isMuscle = car.bodyStyle === 'muscle';
  const isRally = car.bodyStyle === 'rally';
  const isSuv = car.bodyStyle === 'suv';

  return {
    powerMultiplier: 1.0,
    boostPressureScale: 1.0,
    gearRatios: [...car.forwardRatios],
    finalDrive: car.finalDrive,
    clutchEngagementRate: isTrack ? 1.55 : isMuscle ? 1.32 : isSuv ? 0.92 : 1.2,
    awdFrontSplit:
      car.drivetrain === 'RWD' ? 0 : car.drivetrain === '4WD' ? 0.5 : isRally ? 0.42 : 0.38,
    diffFrontAccelLock: car.drivetrain === 'RWD' ? 0 : isSuv ? 0.25 : 0.3,
    diffFrontDecelLock: car.drivetrain === 'RWD' ? 0 : 0.15,
    diffFrontPreloadNm: car.drivetrain === 'RWD' ? 0 : 45,
    diffRearAccelLock: isTrack ? 0.52 : isMuscle ? 0.58 : isRally ? 0.45 : 0.35,
    diffRearDecelLock: isTrack ? 0.38 : isMuscle ? 0.28 : 0.22,
    diffRearPreloadNm: isTrack ? 90 : isMuscle ? 115 : 65,
    diffCenterLock: isRally ? 0.35 : 0,
    springRateScaleFront: 1.0,
    springRateScaleRear: 1.0,
    damperBumpScale: 1.0,
    damperReboundScale: 1.0,
    antiRollFrontNmPerM: car.antiRollStiffness * (isTrack ? 1.08 : isMuscle ? 1.12 : isSuv ? 0.92 : 1.0),
    antiRollRearNmPerM: car.antiRollStiffness * (isTrack ? 0.96 : isMuscle ? 0.88 : isSuv ? 0.84 : 0.92),
    bumpStopStiffness: isSuv ? 120000 : 155000,
    rideHeightOffsetM: 0,
    frontCamberDeg: isTrack ? -2.2 : isMuscle ? -1.4 : isRally ? -1.6 : -0.4,
    rearCamberDeg: isTrack ? -1.8 : isMuscle ? -1.1 : isRally ? -1.2 : -0.3,
    frontToeDeg: isTrack ? -0.06 : 0.04,
    rearToeDeg: isTrack || isMuscle || isRally ? 0.2 : 0.12,
    casterDeg: isTrack ? 7.2 : isSuv ? 4.5 : 6.0,
    steeringRatioScale: 1.0,
    tireCompound,
    tirePressurePsiFront: isSuv ? 32 : 33,
    tirePressurePsiRear: isSuv ? 34 : 32,
    brakeBiasFront: isTrack ? 0.64 : isMuscle ? 0.63 : 0.59,
    absEnabled: true,
    aeroDragScale: 1.0,
    downforceScale: 1.0,
  };
}

export function cloneTuning(t: VehicleTuningSetup): VehicleTuningSetup {
  return {
    ...t,
    gearRatios: [...t.gearRatios],
  };
}
