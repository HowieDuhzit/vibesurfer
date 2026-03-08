import { RhythmAnalysis, SongAnalysis, SongSection, StructureAnalysis, TrackPlan } from "./AnalysisTypes";

interface FeatureWindow {
  centerFrame: number;
  startFrame: number;
  endFrame: number;
  kind: "hill" | "corkscrew" | "loop";
  strength: number;
  sectionLabel: SongSection["label"];
}

interface SectionProfile {
  pitchScale: number;
  yawScale: number;
  basePitchBias: number;
  paceBias: number;
}

export class TrackPlanner {
  public plan(song: SongAnalysis, rhythm: RhythmAnalysis, structure: StructureAnalysis): TrackPlan {
    const count = song.frames.length;
    const tilt = new Float32Array(count);
    const pan = new Float32Array(count);
    const roll = new Float32Array(count);
    const elevation = new Float32Array(count);
    const curvature = new Float32Array(count);
    const pace = new Float32Array(count);
    const eventDensity = new Float32Array(count);
    const dangerLevel = new Float32Array(count);
    const featureEligibility = new Float32Array(count);

    const lookaheadFrames = Math.max(10, rhythm.beatPeriodFrames * 3);
    let currentTilt = 0;
    let currentPan = 0;
    let prevEnergy = structure.energyEnvelope[0] ?? 0;

    for (let i = 0; i < count; i += 1) {
      const frame = song.frames[i];
      const energy = structure.energyEnvelope[i] ?? 0;
      const danger = structure.dangerEnvelope[i] ?? 0;
      const novelty = structure.noveltyEnvelope[i] ?? 0;
      const energyDelta = energy - prevEnergy;
      const centroidNorm = Math.max(0, Math.min(1, (frame.centroid - 140) / 3800));
      const anchorBoost = this.lookaheadAnchorBoost(i, structure.bigMomentFrames, lookaheadFrames);
      const section = this.getSectionForFrame(i, structure.sections);
      const profile = this.profileForSection(section.label);

      const curveIntent = (((danger * 0.5) + (centroidNorm * 0.18) + (novelty * 0.32)) * 2 - 1) * profile.yawScale;
      const pitchIntent = (
        energyDelta * (4.4 + profile.pitchScale * 0.8) +
        (energy - 0.48) * 0.18 +
        anchorBoost * 0.52 +
        profile.basePitchBias
      ) * profile.pitchScale;

      currentTilt = this.damp(currentTilt, pitchIntent, 0.075);
      currentPan = this.damp(currentPan, currentPan + curveIntent * 0.055, 0.12);

      currentTilt = this.clamp(currentTilt, -0.58, 0.58);
      currentPan = this.clamp(currentPan, -1.1, 1.1);

      tilt[i] = currentTilt;
      pan[i] = currentPan;
      roll[i] = this.clamp(curveIntent * 0.3 + currentPan * 0.18 + anchorBoost * 0.1, -0.55, 0.55);
      elevation[i] = energy * 0.68 + anchorBoost * 0.26 + Math.max(0, currentTilt) * 0.4;
      curvature[i] = this.clamp(curveIntent, -1, 1);
      pace[i] = this.clamp(energy * 0.5 + danger * 0.2 + novelty * 0.18 + anchorBoost * 0.2 + profile.paceBias, 0, 1);
      eventDensity[i] = this.clamp(danger * 0.44 + energy * 0.24 + novelty * 0.32, 0, 1);
      dangerLevel[i] = this.clamp(danger * 0.54 + energy * 0.18 + novelty * 0.28, 0, 1);
      featureEligibility[i] = this.clamp(anchorBoost * 0.52 + novelty * 0.28 + danger * 0.2, 0, 1);

      prevEnergy = energy;
    }

    this.smooth(tilt, Math.max(4, Math.floor(rhythm.beatPeriodFrames * 0.65)));
    this.smooth(pan, Math.max(5, Math.floor(rhythm.beatPeriodFrames * 0.72)));
    this.smooth(roll, Math.max(4, Math.floor(rhythm.beatPeriodFrames * 0.4)));
    this.smooth(elevation, Math.max(3, Math.floor(rhythm.beatPeriodFrames * 0.4)));
    this.smooth(curvature, Math.max(3, Math.floor(rhythm.beatPeriodFrames * 0.3)));
    this.smooth(pace, Math.max(3, Math.floor(rhythm.beatPeriodFrames * 0.34)));
    this.smooth(eventDensity, Math.max(2, Math.floor(rhythm.beatPeriodFrames * 0.26)));
    this.smooth(dangerLevel, Math.max(2, Math.floor(rhythm.beatPeriodFrames * 0.24)));
    this.smooth(featureEligibility, Math.max(4, Math.floor(rhythm.beatPeriodFrames * 0.45)));

    const features = this.selectFeatures(song, rhythm, structure, featureEligibility, dangerLevel);
    this.applyFeatures(tilt, pan, roll, elevation, features);
    this.smooth(tilt, Math.max(3, Math.floor(rhythm.beatPeriodFrames * 0.28)));
    this.smooth(pan, Math.max(3, Math.floor(rhythm.beatPeriodFrames * 0.28)));
    this.smooth(roll, Math.max(2, Math.floor(rhythm.beatPeriodFrames * 0.24)));

    return {
      tilt,
      pan,
      roll,
      elevation,
      curvature,
      pace,
      eventDensity,
      dangerLevel,
      featureEligibility,
      anchorFrames: structure.bigMomentFrames.slice()
    };
  }

  private selectFeatures(
    song: SongAnalysis,
    rhythm: RhythmAnalysis,
    structure: StructureAnalysis,
    featureEligibility: Float32Array,
    dangerLevel: Float32Array
  ): FeatureWindow[] {
    const anchors = structure.bigMomentFrames.slice();
    const minGap = Math.max(rhythm.beatPeriodFrames * 18, Math.floor(song.frames.length / 10));
    const picked: FeatureWindow[] = [];
    let lastCenter = -minGap;
    let loopPlaced = false;

    for (let i = 0; i < anchors.length; i += 1) {
      const centerFrame = anchors[i];
      if (centerFrame - lastCenter < minGap) {
        continue;
      }
      if ((featureEligibility[centerFrame] ?? 0) < 0.42) {
        continue;
      }

      const strength = this.clamp(
        (featureEligibility[centerFrame] ?? 0) * 0.65 +
        (dangerLevel[centerFrame] ?? 0) * 0.35,
        0,
        1
      );
      const section = this.getSectionForFrame(centerFrame, structure.sections);
      const span = Math.max(rhythm.beatPeriodFrames * 8, 56);
      const halfSpan = Math.floor(span * (0.6 + strength * 0.7));
      const startFrame = Math.max(4, centerFrame - halfSpan);
      const endFrame = Math.min(song.frames.length - 5, centerFrame + halfSpan);

      let kind: FeatureWindow["kind"] = "hill";
      if (!loopPlaced && section.label === "chorus" && strength > 0.72) {
        kind = "loop";
        loopPlaced = true;
      } else if ((section.label === "chorus" || section.label === "verse") && strength > 0.54) {
        kind = "corkscrew";
      }

      picked.push({
        centerFrame,
        startFrame,
        endFrame,
        kind,
        strength,
        sectionLabel: section.label
      });
      lastCenter = centerFrame;
    }

    return picked;
  }

  private applyFeatures(
    tilt: Float32Array,
    pan: Float32Array,
    roll: Float32Array,
    elevation: Float32Array,
    features: readonly FeatureWindow[]
  ): void {
    for (let i = 0; i < features.length; i += 1) {
      const feature = features[i];
      const span = Math.max(1, feature.endFrame - feature.startFrame);
      const panDrift = 0.08 + feature.strength * 0.12;
      const sectionScale = feature.sectionLabel === "chorus" ? 1.15 : feature.sectionLabel === "breakdown" ? 0.82 : 1;

      for (let frame = feature.startFrame; frame <= feature.endFrame; frame += 1) {
        const phase = (frame - feature.startFrame) / span;
        const eased = this.easeInOutSine(phase);
        const wave = Math.sin(phase * Math.PI);

        if (feature.kind === "hill") {
          tilt[frame] += Math.sin(phase * Math.PI * 2) * (0.08 + feature.strength * 0.18) * sectionScale;
          elevation[frame] += wave * (0.18 + feature.strength * 0.32) * sectionScale;
        } else if (feature.kind === "corkscrew") {
          roll[frame] += eased * Math.PI * 2 * sectionScale;
          tilt[frame] += Math.sin(phase * Math.PI) * (0.06 + feature.strength * 0.08) * sectionScale;
          pan[frame] += Math.sin(phase * Math.PI) * panDrift * 0.55;
        } else {
          tilt[frame] += -eased * Math.PI * 2 * sectionScale;
          pan[frame] += Math.sin(phase * Math.PI) * panDrift * sectionScale;
          roll[frame] += Math.sin(phase * Math.PI * 2) * (0.22 + feature.strength * 0.2) * sectionScale;
          elevation[frame] += wave * (0.22 + feature.strength * 0.35) * sectionScale;
        }
      }

      const recoveryEnd = Math.min(tilt.length - 1, feature.endFrame + Math.max(8, Math.floor(span * 0.28)));
      for (let frame = feature.endFrame + 1; frame <= recoveryEnd; frame += 1) {
        const t = (frame - feature.endFrame) / Math.max(1, recoveryEnd - feature.endFrame);
        const damping = 1 - t * 0.45;
        tilt[frame] *= damping;
        roll[frame] *= 1 - t * 0.5;
        pan[frame] *= 1 - t * 0.18;
      }
    }
  }

  private getSectionForFrame(frame: number, sections: readonly SongSection[]): SongSection {
    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i];
      if (frame >= section.startFrame && frame <= section.endFrame) {
        return section;
      }
    }
    return sections[sections.length - 1] ?? {
      startFrame: 0,
      endFrame: 0,
      energyMean: 0,
      intensity: 0,
      label: "verse"
    };
  }

  private profileForSection(label: SongSection["label"]): SectionProfile {
    switch (label) {
      case "intro":
        return { pitchScale: 0.5, yawScale: 0.45, basePitchBias: 0.01, paceBias: -0.08 };
      case "chorus":
        return { pitchScale: 1.1, yawScale: 0.78, basePitchBias: 0.04, paceBias: 0.12 };
      case "breakdown":
        return { pitchScale: 0.8, yawScale: 0.55, basePitchBias: -0.03, paceBias: -0.02 };
      case "outro":
        return { pitchScale: 0.55, yawScale: 0.4, basePitchBias: -0.01, paceBias: -0.08 };
      case "verse":
      default:
        return { pitchScale: 0.78, yawScale: 0.58, basePitchBias: 0.01, paceBias: 0 };
    }
  }

  private lookaheadAnchorBoost(frame: number, anchors: readonly number[], lookaheadFrames: number): number {
    if (anchors.length === 0) {
      return 0;
    }

    let best = 0;
    for (let i = 0; i < anchors.length; i += 1) {
      const delta = anchors[i] - frame;
      if (delta < 0 || delta > lookaheadFrames) {
        continue;
      }
      const t = 1 - delta / Math.max(1, lookaheadFrames);
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

  private easeInOutSine(t: number): number {
    return -(Math.cos(Math.PI * this.clamp(t, 0, 1)) - 1) * 0.5;
  }

  private damp(current: number, target: number, amount: number): number {
    return current + (target - current) * amount;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
