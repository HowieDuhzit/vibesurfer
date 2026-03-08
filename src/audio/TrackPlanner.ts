import { TRACK_SPEED } from "../core/Config";
import { RhythmAnalysis, SongAnalysis, SongSection, StructureAnalysis, TrackPlan } from "./AnalysisTypes";

type RideStyle = "classic" | "flow" | "burst" | "technical";

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
  public plan(song: SongAnalysis, rhythm: RhythmAnalysis, structure: StructureAnalysis, rideStyle: RideStyle): TrackPlan {
    const count = song.frames.length;
    const tilt = new Float32Array(count);
    const pan = new Float32Array(count);
    const roll = new Float32Array(count);
    const elevation = new Float32Array(count);
    const curvature = new Float32Array(count);
    const pace = new Float32Array(count);
    const speedScale = new Float32Array(count);
    const cumulativeDistance = new Float32Array(count);
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
      const profile = this.profileForSection(section.label, rideStyle);
      const classicYawBias = rideStyle === "classic" ? 0.72 : 1;
      const classicPitchBias = rideStyle === "classic" ? 1.52 : 1;

      const curveIntent = (((danger * 0.5) + (centroidNorm * 0.18) + (novelty * 0.32)) * 2 - 1) * profile.yawScale * classicYawBias;
      const pitchIntent = (
        energyDelta * (4.4 + profile.pitchScale * 0.8) +
        (energy - 0.48) * 0.18 +
        anchorBoost * 0.52 +
        profile.basePitchBias
      ) * profile.pitchScale * classicPitchBias;

      currentTilt = this.damp(currentTilt, pitchIntent, rideStyle === "classic" ? 0.062 : 0.075);
      currentPan = this.damp(currentPan, currentPan + curveIntent * (rideStyle === "classic" ? 0.038 : 0.055), rideStyle === "classic" ? 0.095 : 0.12);

      currentTilt = this.clamp(currentTilt, rideStyle === "classic" ? -1.02 : -0.58, rideStyle === "classic" ? 1.02 : 0.58);
      currentPan = this.clamp(currentPan, rideStyle === "classic" ? -0.82 : -1.1, rideStyle === "classic" ? 0.82 : 1.1);

      tilt[i] = currentTilt;
      pan[i] = currentPan;
      roll[i] = this.clamp(curveIntent * (rideStyle === "classic" ? 0.2 : 0.3) + currentPan * 0.18 + anchorBoost * 0.1, -0.55, 0.55);
      elevation[i] = energy * (rideStyle === "classic" ? 0.9 : 0.68) + anchorBoost * (rideStyle === "classic" ? 0.46 : 0.26) + Math.max(0, currentTilt) * 0.48;
      curvature[i] = this.clamp(curveIntent, -1, 1);
      pace[i] = this.clamp(
        energy * 0.42 +
        danger * 0.16 +
        novelty * 0.14 +
        Math.max(0, energyDelta) * 0.85 +
        anchorBoost * 0.24 +
        profile.paceBias,
        0,
        1
      );
      speedScale[i] = this.speedScaleForPace(pace[i], rideStyle);
      eventDensity[i] = this.clamp(danger * 0.44 + energy * 0.24 + novelty * 0.32, 0, 1);
      dangerLevel[i] = this.clamp(danger * 0.54 + energy * 0.18 + novelty * 0.28, 0, 1);
      featureEligibility[i] = this.clamp(anchorBoost * 0.52 + novelty * 0.28 + danger * 0.2, 0, 1);

      prevEnergy = energy;
    }

    this.smooth(tilt, Math.max(4, Math.floor(rhythm.beatPeriodFrames * (rideStyle === "classic" ? 0.78 : 0.65))));
    this.smooth(pan, Math.max(5, Math.floor(rhythm.beatPeriodFrames * (rideStyle === "classic" ? 1.08 : 0.72))));
    this.smooth(roll, Math.max(4, Math.floor(rhythm.beatPeriodFrames * (rideStyle === "classic" ? 0.62 : 0.4))));
    this.smooth(elevation, Math.max(3, Math.floor(rhythm.beatPeriodFrames * (rideStyle === "classic" ? 0.42 : 0.4))));
    this.smooth(curvature, Math.max(3, Math.floor(rhythm.beatPeriodFrames * 0.3)));
    this.smooth(pace, Math.max(3, Math.floor(rhythm.beatPeriodFrames * 0.34)));
    this.smooth(speedScale, Math.max(3, Math.floor(rhythm.beatPeriodFrames * 0.34)));
    this.smooth(eventDensity, Math.max(2, Math.floor(rhythm.beatPeriodFrames * 0.26)));
    this.smooth(dangerLevel, Math.max(2, Math.floor(rhythm.beatPeriodFrames * 0.24)));
    this.smooth(featureEligibility, Math.max(4, Math.floor(rhythm.beatPeriodFrames * 0.45)));

    this.applyMacroTerrain(tilt, pan, elevation, pace, structure.sections, rideStyle);
    const features = this.selectFeatures(song, rhythm, structure, featureEligibility, dangerLevel, rideStyle);
    this.applyFeatures(tilt, pan, roll, elevation, pace, features, rideStyle);
    this.normalizeOpeningWindow(tilt, pan, roll, pace, rhythm.beatPeriodFrames, rideStyle);
    this.smooth(tilt, Math.max(1, Math.floor(rhythm.beatPeriodFrames * (rideStyle === "classic" ? 0.12 : 0.18))));
    this.smooth(pan, Math.max(1, Math.floor(rhythm.beatPeriodFrames * (rideStyle === "classic" ? 0.12 : 0.18))));
    this.smooth(roll, Math.max(1, Math.floor(rhythm.beatPeriodFrames * (rideStyle === "classic" ? 0.1 : 0.14))));

    cumulativeDistance[0] = 0;
    for (let i = 1; i < count; i += 1) {
      const dt = Math.max(1e-4, song.frames[i].time - song.frames[i - 1].time);
      const speed = (speedScale[i - 1] + speedScale[i]) * 0.5;
      cumulativeDistance[i] = cumulativeDistance[i - 1] + TRACK_SPEED * speed * dt;
    }

    return {
      tilt,
      pan,
      roll,
      elevation,
      curvature,
      pace,
      speedScale,
      cumulativeDistance,
      eventDensity,
      dangerLevel,
      featureEligibility,
      anchorFrames: structure.bigMomentFrames.slice()
    };
  }

  private speedScaleForPace(pace: number, rideStyle: RideStyle): number {
    if (rideStyle === "classic") {
      return this.clamp(0.66 + pace * 1.02, 0.7, 1.72);
    }
    return this.clamp(0.7 + pace * 0.9, 0.72, 1.6);
  }

  private selectFeatures(
    song: SongAnalysis,
    rhythm: RhythmAnalysis,
    structure: StructureAnalysis,
    featureEligibility: Float32Array,
    dangerLevel: Float32Array,
    rideStyle: RideStyle
  ): FeatureWindow[] {
    const anchors = this.collectFeatureAnchors(structure, featureEligibility, dangerLevel, rhythm.beatPeriodFrames, rideStyle);
    const minGap = Math.max(rhythm.beatPeriodFrames * (rideStyle === "classic" ? 18 : 24), Math.floor(song.frames.length / (rideStyle === "classic" ? 10 : 8)));
    const picked: FeatureWindow[] = [];
    let lastCenter = -minGap;
    let loopsPlaced = 0;
    let corkscrewsPlaced = 0;
    const maxLoops = rideStyle === "classic"
      ? Math.max(1, Math.min(4, Math.floor(song.duration / 65) + 1))
      : Math.max(1, Math.min(2, Math.floor(song.duration / 95) + 1));
    const maxCorkscrews = rideStyle === "classic"
      ? Math.max(2, Math.min(5, Math.floor(song.duration / 50) + 1))
      : Math.max(1, Math.min(4, Math.floor(song.duration / 55) + 1));

    for (let i = 0; i < anchors.length; i += 1) {
      const centerFrame = anchors[i];
      if (centerFrame - lastCenter < minGap) {
        continue;
      }
      if ((featureEligibility[centerFrame] ?? 0) < (rideStyle === "classic" ? 0.44 : 0.42)) {
        continue;
      }

      const strength = this.clamp(
        (featureEligibility[centerFrame] ?? 0) * 0.65 +
        (dangerLevel[centerFrame] ?? 0) * 0.35,
        0,
        1
      );
      const section = this.getSectionForFrame(centerFrame, structure.sections);
      const span = Math.max(rhythm.beatPeriodFrames * 10, rideStyle === "classic" ? 70 : 68);
      const halfSpan = Math.floor(span * (rideStyle === "classic" ? 0.75 + strength * 0.68 : 0.7 + strength * 0.55));
      const startFrame = Math.max(4, centerFrame - halfSpan);
      const endFrame = Math.min(song.frames.length - 5, centerFrame + halfSpan);

      const kind: FeatureWindow["kind"] = "hill";

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

    picked.sort((a, b) => a.centerFrame - b.centerFrame);
    return picked;
  }

  private applyFeatures(
    tilt: Float32Array,
    pan: Float32Array,
    roll: Float32Array,
    elevation: Float32Array,
    pace: Float32Array,
    features: readonly FeatureWindow[],
    rideStyle: RideStyle
  ): void {
    for (let i = 0; i < features.length; i += 1) {
      const feature = features[i];
      const span = Math.max(1, feature.endFrame - feature.startFrame);
      const panDrift = THREE_DEG_40 / Math.max(1, Math.floor(span * 0.5));
      const sectionScale = feature.sectionLabel === "chorus" ? 1.15 : feature.sectionLabel === "breakdown" ? 0.82 : 1;

      if (feature.kind === "hill") {
        for (let frame = feature.startFrame; frame <= feature.endFrame; frame += 1) {
          const phase = (frame - feature.startFrame) / span;
          const wave = Math.sin(phase * Math.PI);
          const crest = Math.sin(phase * Math.PI * 2 - Math.PI * 0.5);
          tilt[frame] += crest * (rideStyle === "classic" ? 0.11 + feature.strength * 0.2 : 0.05 + feature.strength * 0.11) * sectionScale;
          elevation[frame] += wave * (rideStyle === "classic" ? 0.28 + feature.strength * 0.4 : 0.14 + feature.strength * 0.22) * sectionScale;
          pace[frame] = this.clamp(pace[frame] + wave * (rideStyle === "classic" ? 0.11 : 0.04), 0, 1);
        }
        continue;
      }

      if (feature.kind === "loop") {
        const startTilt = tilt[feature.startFrame];
        const endOriginalTilt = tilt[feature.endFrame];
        const endOriginalPan = pan[feature.endFrame];
        const tiltDeltaOverLoop = -Math.PI * 2 + (endOriginalTilt - startTilt);
        let panValue = pan[feature.startFrame];
        let panRate = panDrift * (rideStyle === "classic" ? 0.42 : 0.55) * sectionScale;
        const panRejoinIndex = Math.min(pan.length - 1, feature.endFrame + Math.max(span * 2, 40));
        if (pan[panRejoinIndex] > pan[feature.startFrame]) {
          panRate *= -1;
        }
        const midFrame = feature.startFrame + Math.floor(span * 0.55);

        for (let frame = feature.startFrame + 1; frame <= feature.endFrame; frame += 1) {
          const progress = (frame - feature.startFrame) / span;
          const eased = 0.5 - Math.cos(progress * Math.PI) * 0.5;
          tilt[frame] = startTilt + tiltDeltaOverLoop * eased;
          if (frame === midFrame) {
            panRate *= -1;
          }
          panValue += panRate;
          pan[frame] = panValue;
          roll[frame] += Math.sin(progress * Math.PI * 2) * (rideStyle === "classic" ? 0.12 + feature.strength * 0.1 : 0.1 + feature.strength * 0.08) * sectionScale;
          elevation[frame] += Math.sin(progress * Math.PI) * (rideStyle === "classic" ? 0.2 + feature.strength * 0.24 : 0.12 + feature.strength * 0.16) * sectionScale;
          pace[frame] = this.clamp(pace[frame] + Math.sin(progress * Math.PI) * 0.1, 0, 1);
        }

        const panDeltaCascade = pan[feature.endFrame] - endOriginalPan;
        const tiltDeltaCascade = tilt[feature.endFrame] - endOriginalTilt;
        for (let frame = feature.endFrame + 1; frame < tilt.length; frame += 1) {
          tilt[frame] += tiltDeltaCascade;
          pan[frame] += panDeltaCascade;
        }
        continue;
      }

      if (feature.kind === "corkscrew") {
        const endOriginalRoll = roll[feature.endFrame];
        let cumulativeRoll = roll[feature.startFrame];
        const totalTurns = Math.PI * 2 * (rideStyle === "classic" ? 1.18 + feature.strength * 0.7 : 0.65 + feature.strength * 0.45) * sectionScale;
        const rollIncrement = totalTurns / span;
        for (let frame = feature.startFrame; frame <= feature.endFrame; frame += 1) {
          roll[frame] = cumulativeRoll;
          cumulativeRoll += rollIncrement;
          const progress = (frame - feature.startFrame) / span;
          pan[frame] += Math.sin(progress * Math.PI) * panDrift * (rideStyle === "classic" ? 0.22 : 0.22);
          tilt[frame] += Math.sin(progress * Math.PI * 2 - Math.PI * 0.5) * (rideStyle === "classic" ? 0.08 + feature.strength * 0.1 : 0.03 + feature.strength * 0.05);
          pace[frame] = this.clamp(pace[frame] + Math.sin(progress * Math.PI) * 0.08, 0, 1);
        }
        const rollDeltaCascade = roll[feature.endFrame] - endOriginalRoll;
        for (let frame = feature.endFrame + 1; frame < roll.length; frame += 1) {
          roll[frame] += rollDeltaCascade;
        }
      }
    }

    this.applyRecoveryWindows(pan, roll, pace, features, rideStyle);
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

  private profileForSection(label: SongSection["label"], rideStyle: RideStyle): SectionProfile {
    const classic = rideStyle === "classic";
    switch (label) {
      case "intro":
        return { pitchScale: classic ? 0.58 : 0.5, yawScale: classic ? 0.32 : 0.45, basePitchBias: 0.01, paceBias: -0.08 };
      case "chorus":
        return { pitchScale: classic ? 1.28 : 1.1, yawScale: classic ? 0.52 : 0.78, basePitchBias: 0.04, paceBias: classic ? 0.18 : 0.12 };
      case "breakdown":
        return { pitchScale: classic ? 0.92 : 0.8, yawScale: classic ? 0.38 : 0.55, basePitchBias: -0.03, paceBias: -0.02 };
      case "outro":
        return { pitchScale: classic ? 0.62 : 0.55, yawScale: classic ? 0.28 : 0.4, basePitchBias: -0.01, paceBias: -0.08 };
      case "verse":
      default:
        return { pitchScale: classic ? 0.94 : 0.78, yawScale: classic ? 0.42 : 0.58, basePitchBias: 0.01, paceBias: classic ? 0.03 : 0 };
    }
  }

  private applyRecoveryWindows(
    pan: Float32Array,
    roll: Float32Array,
    pace: Float32Array,
    features: readonly FeatureWindow[],
    rideStyle: RideStyle
  ): void {
    const classicRecovery = rideStyle === "classic";
    for (let i = 0; i < features.length; i += 1) {
      const feature = features[i];
      const recoveryFrames = classicRecovery
        ? Math.max(28, Math.floor((feature.endFrame - feature.startFrame) * 0.85))
        : Math.max(18, Math.floor((feature.endFrame - feature.startFrame) * 0.55));
      for (let step = 1; step <= recoveryFrames; step += 1) {
        const frame = feature.endFrame + step;
        if (frame >= pan.length) {
          break;
        }
        const t = step / recoveryFrames;
        const fade = (1 - t) * (classicRecovery ? 0.12 : 0.08);
        pan[frame] *= 1 - fade;
        roll[frame] *= 1 - fade * 1.15;
        pace[frame] = this.clamp(pace[frame] - fade * 0.35, 0, 1);
      }
    }
  }

  private applyMacroTerrain(
    tilt: Float32Array,
    pan: Float32Array,
    elevation: Float32Array,
    pace: Float32Array,
    sections: readonly SongSection[],
    rideStyle: RideStyle
  ): void {
    if (rideStyle !== "classic" || sections.length === 0) {
      return;
    }

    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i];
      const start = Math.max(0, section.startFrame);
      const end = Math.min(tilt.length - 1, section.endFrame);
      const span = Math.max(1, end - start);
      const pitchAmp = section.label === "chorus"
        ? 0.34
        : section.label === "breakdown"
          ? 0.24
          : 0.2;
      const yawAmp = section.label === "chorus"
        ? 0.1
        : section.label === "verse"
          ? 0.08
          : 0.05;
      const paceAmp = section.label === "chorus"
        ? 0.12
        : section.label === "breakdown"
          ? -0.04
          : 0.05;

      for (let frame = start; frame <= end; frame += 1) {
        const phase = (frame - start) / span;
        const sectionWave = Math.sin(phase * Math.PI);
        const roller = Math.sin(phase * Math.PI * (section.label === "chorus" ? 3 : 2) - Math.PI * 0.5);
        tilt[frame] += roller * pitchAmp * Math.max(0.55, section.intensity);
        elevation[frame] += sectionWave * pitchAmp * 0.7;
        pan[frame] += Math.sin(phase * Math.PI * 2) * yawAmp * Math.max(0.4, section.intensity);
        pace[frame] = this.clamp(pace[frame] + sectionWave * paceAmp, 0, 1);
      }
    }
  }

  private collectFeatureAnchors(
    structure: StructureAnalysis,
    featureEligibility: Float32Array,
    dangerLevel: Float32Array,
    beatPeriodFrames: number,
    rideStyle: RideStyle
  ): number[] {
    const anchors = structure.bigMomentFrames.slice();
    const minGap = Math.max(12, Math.floor(beatPeriodFrames * (rideStyle === "classic" ? 10 : 7)));
    const threshold = rideStyle === "classic" ? 0.56 : 0.68;

    for (let i = 2; i < featureEligibility.length - 2; i += 1) {
      const score = (featureEligibility[i] ?? 0) * 0.58 + (dangerLevel[i] ?? 0) * 0.42;
      if (score < threshold) {
        continue;
      }
      if (score < (featureEligibility[i - 1] ?? 0) * 0.58 + (dangerLevel[i - 1] ?? 0) * 0.42) {
        continue;
      }
      if (score < (featureEligibility[i + 1] ?? 0) * 0.58 + (dangerLevel[i + 1] ?? 0) * 0.42) {
        continue;
      }

      const last = anchors.length > 0 ? anchors[anchors.length - 1] : -Infinity;
      if (i - last >= minGap) {
        anchors.push(i);
      }
    }

    anchors.sort((a, b) => a - b);
    return anchors;
  }

  private normalizeOpeningWindow(
    tilt: Float32Array,
    pan: Float32Array,
    roll: Float32Array,
    pace: Float32Array,
    beatPeriodFrames: number,
    rideStyle: RideStyle
  ): void {
    const settleFrames = Math.max(12, Math.floor(beatPeriodFrames * (rideStyle === "classic" ? 6 : 4)));
    const sampleFrames = Math.max(4, Math.min(settleFrames, Math.floor(settleFrames * 0.45)));
    let panBias = 0;
    let rollBias = 0;
    let tiltBias = 0;

    for (let i = 0; i < sampleFrames; i += 1) {
      panBias += pan[i] ?? 0;
      rollBias += roll[i] ?? 0;
      tiltBias += tilt[i] ?? 0;
    }

    panBias /= sampleFrames;
    rollBias /= sampleFrames;
    tiltBias /= sampleFrames;

    for (let i = 0; i < pan.length; i += 1) {
      pan[i] -= panBias;
      roll[i] -= rollBias * 0.9;
      if (rideStyle === "classic") {
        tilt[i] -= tiltBias * 0.35;
      }
    }

    for (let i = 0; i < settleFrames; i += 1) {
      const t = i / Math.max(1, settleFrames - 1);
      const ease = t * t * (3 - 2 * t);
      pan[i] *= ease;
      roll[i] *= ease;
      if (rideStyle === "classic") {
        tilt[i] *= 0.55 + ease * 0.45;
        pace[i] = this.clamp(pace[i] * (0.9 + ease * 0.1), 0, 1);
      }
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

const THREE_DEG_40 = (40 * Math.PI) / 180;
