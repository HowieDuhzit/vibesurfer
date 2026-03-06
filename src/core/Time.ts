const MAX_DELTA_SECONDS = 1 / 20;

export class Time {
  private lastNow = 0;
  private started = false;

  public deltaTime = 0;
  public elapsedTime = 0;

  public update(nowMs: number): void {
    if (!this.started) {
      this.lastNow = nowMs;
      this.started = true;
      this.deltaTime = 0;
      return;
    }

    const rawDelta = (nowMs - this.lastNow) / 1000;
    this.lastNow = nowMs;

    this.deltaTime = Math.min(Math.max(rawDelta, 0), MAX_DELTA_SECONDS);
    this.elapsedTime += this.deltaTime;
  }
}
