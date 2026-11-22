export interface PerformanceStats {
  physicsStepMs: number;
  maxPhysicsStepMs: number;
  substepsLastFrame: number;
  renderFps: number;
  overloadActive: boolean;
  totalPhysicsSteps: number;
  particleScale: number;
}

/**
 * Tracks 120 Hz fixed-step execution timing, render FPS, and triggers automatic
 * overload protection (spiral-of-death prevention + visual particle scaling) when
 * a browser frame budget is exceeded. Zero heap allocations during steady-state ticks.
 */
export class PhysicsPerfMonitor {
  public physicsStepMs = 0;
  public maxPhysicsStepMs = 0;
  public substepsLastFrame = 0;
  public renderFps = 60;
  public overloadActive = false;
  public totalPhysicsSteps = 0;
  public particleScale = 1.0;

  private emaStepMs = 0.5;
  private emaFrameMs = 16.67;
  private overloadStreak = 0;
  private recoveryStreak = 0;

  public recordFrame(frameDtSec: number, substeps: number, physicsWorkMs: number): void {
    const safeFrameMs = Math.max(1, frameDtSec * 1000);
    this.emaFrameMs += (safeFrameMs - this.emaFrameMs) * 0.1;
    this.renderFps = Math.min(240, Math.round(1000 / Math.max(4, this.emaFrameMs)));

    this.substepsLastFrame = substeps;
    this.totalPhysicsSteps += substeps;

    const perStepMs = substeps > 0 ? physicsWorkMs / substeps : 0;
    if (substeps > 0) {
      this.emaStepMs += (perStepMs - this.emaStepMs) * 0.15;
      this.physicsStepMs = this.emaStepMs;
      if (physicsWorkMs > this.maxPhysicsStepMs) {
        this.maxPhysicsStepMs = physicsWorkMs;
      }
    }

    // Overload detection: step work consistently exceeding 8.5ms threatens 60 fps budget
    if (physicsWorkMs > 8.5) {
      this.overloadStreak++;
      this.recoveryStreak = 0;
      if (this.overloadStreak >= 8) {
        this.overloadActive = true;
        this.particleScale = 0.45;
      }
    } else {
      this.overloadStreak = Math.max(0, this.overloadStreak - 1);
      if (this.overloadActive) {
        this.recoveryStreak++;
        if (this.recoveryStreak >= 45) {
          this.overloadActive = false;
          this.particleScale = 1.0;
          this.recoveryStreak = 0;
        }
      }
    }
  }

  public reset(): void {
    this.physicsStepMs = 0;
    this.maxPhysicsStepMs = 0;
    this.substepsLastFrame = 0;
    this.overloadActive = false;
    this.totalPhysicsSteps = 0;
    this.particleScale = 1.0;
    this.emaStepMs = 0.5;
    this.emaFrameMs = 16.67;
    this.overloadStreak = 0;
    this.recoveryStreak = 0;
  }

  public getSnapshot(out: PerformanceStats): PerformanceStats {
    out.physicsStepMs = Math.round(this.physicsStepMs * 100) / 100;
    out.maxPhysicsStepMs = Math.round(this.maxPhysicsStepMs * 100) / 100;
    out.substepsLastFrame = this.substepsLastFrame;
    out.renderFps = this.renderFps;
    out.overloadActive = this.overloadActive;
    out.totalPhysicsSteps = this.totalPhysicsSteps;
    out.particleScale = this.particleScale;
    return out;
  }
}
