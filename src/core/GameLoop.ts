import { Time } from "./Time";

export type UpdateCallback = (time: Time) => void;

export class GameLoop {
  private readonly time = new Time();
  private rafId: number | null = null;

  public constructor(private readonly updateCallback: UpdateCallback) {}

  public start(): void {
    if (this.rafId !== null) {
      return;
    }

    const tick = (now: number): void => {
      this.time.update(now);
      this.updateCallback(this.time);
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  public stop(): void {
    if (this.rafId === null) {
      return;
    }

    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}
