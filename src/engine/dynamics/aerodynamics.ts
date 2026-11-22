import * as THREE from 'three';
import { CarSpec, VehicleTuningSetup } from '../../types/vehicle';
import { RapierWorldManager } from '../rapierWorld';

const AIR_DENSITY = 1.225;
const _relVel = new THREE.Vector3();
const _aeroPoint = new THREE.Vector3();

/**
 * Computes velocity-squared aerodynamic drag and front/rear downforce split
 * and applies genuine forces to the Rapier chassis rigid body.
 */
export class AerodynamicsModule {
  public lastDragN = 0;
  public lastDownforceN = 0;

  public applyForces(
    rapier: RapierWorldManager,
    car: CarSpec,
    tuning: VehicleTuningSetup,
    chassisPos: THREE.Vector3,
    chassisQuat: THREE.Quaternion,
    velocity: THREE.Vector3,
    carForward: THREE.Vector3,
    carUp: THREE.Vector3,
    windWorldX = 0,
    windWorldZ = 0
  ): void {
    _relVel.set(velocity.x - windWorldX, velocity.y, velocity.z - windWorldZ);
    const relSpeed = _relVel.length();
    const frontalArea = car.width * car.height * 0.82;

    const dragCoeff = car.dragCoeff * tuning.aeroDragScale;
    const dragMag = 0.5 * AIR_DENSITY * dragCoeff * frontalArea * relSpeed * relSpeed;
    this.lastDragN = dragMag;

    if (relSpeed > 0.1) {
      const dragScale = -dragMag / relSpeed;
      rapier.addForce(
        _relVel.x * dragScale,
        _relVel.y * dragScale,
        _relVel.z * dragScale
      );
    }

    const forwardAirSpeed = _relVel.dot(carForward);
    const downforceMag =
      0.5 *
      AIR_DENSITY *
      car.downforceCoeff *
      tuning.downforceScale *
      frontalArea *
      forwardAirSpeed *
      Math.abs(forwardAirSpeed);
    const totalDown = Math.max(-0.25 * car.massKg * 9.81, downforceMag);
    this.lastDownforceN = totalDown;

    // Split downforce 38% front / 62% rear to reflect rear wing pitch balance
    const frontDown = totalDown * 0.38;
    const rearDown = totalDown * 0.62;
    const hz = car.wheelbase * 0.45;

    _aeroPoint.set(0, 0.25, -hz).applyQuaternion(chassisQuat).add(chassisPos);
    rapier.addForceAtPoint(
      -carUp.x * frontDown,
      -carUp.y * frontDown,
      -carUp.z * frontDown,
      _aeroPoint.x,
      _aeroPoint.y,
      _aeroPoint.z
    );

    _aeroPoint.set(0, 0.35, hz).applyQuaternion(chassisQuat).add(chassisPos);
    rapier.addForceAtPoint(
      -carUp.x * rearDown,
      -carUp.y * rearDown,
      -carUp.z * rearDown,
      _aeroPoint.x,
      _aeroPoint.y,
      _aeroPoint.z
    );
  }
}
