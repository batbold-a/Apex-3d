import * as THREE from 'three';
import { PhysicsDebugSnapshot } from './physics';

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();

/**
 * 3D Physics Debug Vector Overlay (toggleable via key B):
 * - Amber sphere at chassis Center of Mass
 * - 4 wheel contact patch markers
 * - Scaled vertical normal load arrows (green)
 * - Scaled horizontal tire grip force arrows (orange)
 * - Chassis velocity vector (cyan) & yaw rate arrow (magenta)
 * Zero per-frame heap allocations.
 */
export class PhysicsDebugOverlay {
  public readonly group = new THREE.Group();

  private readonly comSphere: THREE.Mesh;
  private readonly contactMarkers: THREE.Mesh[] = [];
  private readonly normalArrows: THREE.ArrowHelper[] = [];
  private readonly tireArrows: THREE.ArrowHelper[] = [];
  private readonly velocityArrow: THREE.ArrowHelper;
  private readonly yawArrow: THREE.ArrowHelper;
  private readonly disposables: { dispose: () => void }[] = [];

  constructor() {
    this.group.visible = false;
    this.group.renderOrder = 10;

    const comGeo = new THREE.SphereGeometry(0.16, 12, 10);
    const comMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      depthTest: false,
      transparent: true,
      opacity: 0.92,
    });
    this.disposables.push(comGeo, comMat);
    this.comSphere = new THREE.Mesh(comGeo, comMat);
    this.group.add(this.comSphere);

    const contactGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const contactMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      depthTest: false,
    });
    this.disposables.push(contactGeo, contactMat);

    for (let i = 0; i < 4; i++) {
      const marker = new THREE.Mesh(contactGeo, contactMat);
      this.contactMarkers.push(marker);
      this.group.add(marker);

      const normArrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(),
        1,
        0x22c55e,
        0.22,
        0.12
      );
      this.setArrowDepthTest(normArrow, false);
      this.normalArrows.push(normArrow);
      this.group.add(normArrow);

      const tireArrow = new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(),
        1,
        0xf97316,
        0.22,
        0.12
      );
      this.setArrowDepthTest(tireArrow, false);
      this.tireArrows.push(tireArrow);
      this.group.add(tireArrow);
    }

    this.velocityArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(),
      1,
      0x38bdf8,
      0.28,
      0.16
    );
    this.setArrowDepthTest(this.velocityArrow, false);
    this.group.add(this.velocityArrow);

    this.yawArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      1,
      0xe879f9,
      0.24,
      0.14
    );
    this.setArrowDepthTest(this.yawArrow, false);
    this.group.add(this.yawArrow);
  }

  private setArrowDepthTest(arrow: THREE.ArrowHelper, enabled: boolean): void {
    const lineMat = arrow.line.material as THREE.Material;
    const coneMat = arrow.cone.material as THREE.Material;
    lineMat.depthTest = enabled;
    coneMat.depthTest = enabled;
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  public update(snapshot: PhysicsDebugSnapshot): void {
    if (!this.group.visible) return;

    const [cx, cy, cz] = snapshot.comWorld;
    this.comSphere.position.set(cx, cy, cz);

    // Velocity vector (cyan)
    _origin.set(cx, cy + 0.55, cz);
    _dir.set(snapshot.velocityWorld[0], snapshot.velocityWorld[1], snapshot.velocityWorld[2]);
    const speed = _dir.length();
    if (speed > 0.25) {
      this.velocityArrow.visible = true;
      _dir.divideScalar(speed);
      this.velocityArrow.position.copy(_origin);
      this.velocityArrow.setDirection(_dir);
      const len = Math.min(5.5, Math.max(0.45, speed * 0.12));
      this.velocityArrow.setLength(len, Math.min(0.32, len * 0.3), 0.14);
    } else {
      this.velocityArrow.visible = false;
    }

    // Yaw rate vertical indicator (magenta)
    const yawRate = snapshot.angVelWorld[1];
    if (Math.abs(yawRate) > 0.04) {
      this.yawArrow.visible = true;
      _dir.set(0, yawRate >= 0 ? 1 : -1, 0);
      this.yawArrow.position.set(cx, cy + 1.0, cz);
      this.yawArrow.setDirection(_dir);
      const len = Math.min(2.6, Math.max(0.35, Math.abs(yawRate) * 0.95));
      this.yawArrow.setLength(len, Math.min(0.26, len * 0.35), 0.12);
    } else {
      this.yawArrow.visible = false;
    }

    // 4-Corner Wheel Contacts + Normal & Tire Force Vectors
    for (let i = 0; i < 4; i++) {
      const [wx, wy, wz] = snapshot.wheelContactWorld[i];
      const grounded = snapshot.grounded[i];
      const marker = this.contactMarkers[i];
      const normArrow = this.normalArrows[i];
      const tireArrow = this.tireArrows[i];

      marker.position.set(wx, wy, wz);
      marker.visible = grounded;

      const normalN = snapshot.wheelNormalN[i];
      if (grounded && normalN > 30) {
        normArrow.visible = true;
        _dir.set(0, 1, 0);
        normArrow.position.set(wx, wy, wz);
        normArrow.setDirection(_dir);
        const nLen = Math.min(2.8, Math.max(0.25, normalN / 4500));
        normArrow.setLength(nLen, Math.min(0.22, nLen * 0.3), 0.1);
      } else {
        normArrow.visible = false;
      }

      const [fx, , fz] = snapshot.wheelForceWorld[i];
      const horizMag = Math.hypot(fx, fz);
      if (grounded && horizMag > 45) {
        tireArrow.visible = true;
        _dir.set(fx / horizMag, 0, fz / horizMag);
        tireArrow.position.set(wx, wy + 0.06, wz);
        tireArrow.setDirection(_dir);
        const fLen = Math.min(3.4, Math.max(0.28, horizMag / 3600));
        tireArrow.setLength(fLen, Math.min(0.24, fLen * 0.3), 0.1);
      } else {
        tireArrow.visible = false;
      }
    }
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    for (let i = 0; i < 4; i++) {
      this.normalArrows[i].dispose();
      this.tireArrows[i].dispose();
    }
    this.velocityArrow.dispose();
    this.yawArrow.dispose();
  }
}
