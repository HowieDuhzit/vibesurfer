import { Track } from "../world/Track";

export class BeatPulseEffect {
  private targetScaleY = 1;

  public constructor(private readonly track: Track) {}

  public trigger(bassEnergy: number): void {
    this.targetScaleY = 1 + bassEnergy * 0.1;
  }

  public update(deltaTime: number): void {
    const current = this.track.group.scale.y;
    const blend = Math.min(1, deltaTime * 7);
    const dampedTarget = 1 + (this.targetScaleY - 1) * 0.2;
    const next = current + (dampedTarget - current) * blend;

    this.track.group.scale.y = next;
    this.targetScaleY += (1 - this.targetScaleY) * Math.min(1, deltaTime * 10);
  }
}
