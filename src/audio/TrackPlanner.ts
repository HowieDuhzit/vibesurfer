import { RhythmAnalysis, SongAnalysis, StructureAnalysis, TrackPlan } from "./AnalysisTypes";

export class TrackPlanner {
  public plan(song: SongAnalysis, rhythm: RhythmAnalysis, structure: StructureAnalysis): TrackPlan {
    const count = song.frames.length;
    const elevation = new Float32Array(count);
    const curvature = new Float32Array(count);
    const pace = new Float32Array(count);
    const eventDensity = new Float32Array(count);
    const dangerLevel = new Float32Array(count);
    const featureEligibility = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const e = structure.energyEnvelope[i] ?? 0;
      const d = structure.dangerEnvelope[i] ?? 0;
      const n = structure.noveltyEnvelope[i] ?? 0;
      const centroidNorm = Math.max(0, Math.min(1, (song.frames[i].centroid - 150) / 4200));
      const anchorLookahead = this.lookaheadAnchorBoost(i, structure.bigMomentFrames, Math.max(6, rhythm.beatPeriodFrames * 2));

      elevation[i] = e * 0.76 + d * 0.16 + anchorLookahead * 0.42;
      curvature[i] = ((d * 0.55 + centroidNorm * 0.28 + n * 0.17) * 2) - 1;
      pace[i] = Math.max(0, Math.min(1, e * 0.56 + d * 0.24 + n * 0.2 + anchorLookahead * 0.25));
      eventDensity[i] = Math.max(0, Math.min(1, d * 0.45 + e * 0.25 + n * 0.3));
      dangerLevel[i] = Math.max(0, Math.min(1, d * 0.52 + e * 0.23 + n * 0.25));
      featureEligibility[i] = Math.max(0, Math.min(1, anchorLookahead * 0.5 + n * 0.3 + d * 0.2));
    }

    this.smooth(elevation, Math.max(2, Math.floor(rhythm.beatPeriodFrames * 0.42)));
    this.smooth(curvature, Math.max(2, Math.floor(rhythm.beatPeriodFrames * 0.28)));
    this.smooth(pace, Math.max(2, Math.floor(rhythm.beatPeriodFrames * 0.34)));
    this.smooth(eventDensity, Math.max(2, Math.floor(rhythm.beatPeriodFrames * 0.26)));
    this.smooth(dangerLevel, Math.max(2, Math.floor(rhythm.beatPeriodFrames * 0.24)));
    this.smooth(featureEligibility, Math.max(2, Math.floor(rhythm.beatPeriodFrames * 0.5)));

    return {
      elevation,
      curvature,
      pace,
      eventDensity,
      dangerLevel,
      featureEligibility,
      anchorFrames: structure.bigMomentFrames.slice()
    };
  }

  private lookaheadAnchorBoost(frame: number, anchors: readonly number[], lookaheadFrames: number): number {
    if (anchors.length === 0) {
      return 0;
    }

    let best = 0;
    for (let i = 0; i < anchors.length; i += 1) {
      const d = anchors[i] - frame;
      if (d < 0 || d > lookaheadFrames) {
        continue;
      }
      const t = 1 - d / Math.max(1, lookaheadFrames);
      best = Math.max(best, t * t);
    }
    return best;
  }

  private smooth(values: Float32Array, radius: number): void {
    if (values.length === 0 || radius <= 0) {
      return;
    }

    const copy = new Float32Array(values);
    for (let i = 0; i < values.length; i += 1) {
      const lo = Math.max(0, i - radius);
      const hi = Math.min(values.length - 1, i + radius);
      let sum = 0;
      for (let j = lo; j <= hi; j += 1) {
        sum += copy[j];
      }
      values[i] = sum / (hi - lo + 1);
    }
  }
}
