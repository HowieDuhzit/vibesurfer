import { LANES } from "./Config";

export class InputManager {
  private targetLane = 1;
  private pendingDelta = 0;
  private absoluteLane: number | null = null;
  private leftHeld = false;
  private rightHeld = false;
  private keyboardControlActive = false;
  private swipeEnabled = true;

  private touchStartX: number | null = null;
  private readonly minSwipeDistance = 35;

  public constructor(private readonly target: HTMLElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.target.addEventListener("touchstart", this.onTouchStart, { passive: true });
    this.target.addEventListener("touchend", this.onTouchEnd, { passive: true });
  }

  public getTargetLane(): number {
    return this.targetLane;
  }

  public update(): void {
    if (this.keyboardControlActive) {
      if (this.leftHeld && !this.rightHeld) {
        this.targetLane = 0;
      } else if (this.rightHeld && !this.leftHeld) {
        this.targetLane = LANES - 1;
      } else {
        this.targetLane = 1;
      }

      this.pendingDelta = 0;
      return;
    }

    if (this.pendingDelta !== 0) {
      this.targetLane = Math.max(0, Math.min(LANES - 1, this.targetLane + this.pendingDelta));
      this.pendingDelta = 0;
    }

    if (this.absoluteLane !== null) {
      this.targetLane = Math.max(0, Math.min(LANES - 1, this.absoluteLane));
      this.absoluteLane = null;
    }
  }

  public setAbsoluteLane(lane: number): void {
    this.absoluteLane = Math.max(0, Math.min(LANES - 1, lane));
  }

  public nudge(delta: number): void {
    this.pendingDelta += delta;
  }

  public setSwipeEnabled(enabled: boolean): void {
    this.swipeEnabled = enabled;
  }

  public dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("touchstart", this.onTouchStart);
    this.target.removeEventListener("touchend", this.onTouchEnd);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    this.keyboardControlActive = true;

    if (key === "arrowleft" || key === "a") {
      this.leftHeld = true;
    }

    if (key === "arrowright" || key === "d") {
      this.rightHeld = true;
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();

    if (key === "arrowleft" || key === "a") {
      this.leftHeld = false;
    }

    if (key === "arrowright" || key === "d") {
      this.rightHeld = false;
    }
  };

  private onTouchStart = (event: TouchEvent): void => {
    if (event.changedTouches.length === 0) {
      return;
    }

    this.touchStartX = event.changedTouches[0].clientX;
  };

  private onTouchEnd = (event: TouchEvent): void => {
    if (!this.swipeEnabled) {
      this.touchStartX = null;
      return;
    }

    if (this.touchStartX === null || event.changedTouches.length === 0) {
      return;
    }

    const deltaX = event.changedTouches[0].clientX - this.touchStartX;

    if (deltaX <= -this.minSwipeDistance) {
      this.pendingDelta -= 1;
    } else if (deltaX >= this.minSwipeDistance) {
      this.pendingDelta += 1;
    }

    this.touchStartX = null;
  };
}
