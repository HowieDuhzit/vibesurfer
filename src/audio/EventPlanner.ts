import { LANES } from "../core/Config";
import { NoteType } from "../entities/Note";
import { RhythmAnalysis, SongAnalysis, SongSection, StructureAnalysis, TrackPlan } from "./AnalysisTypes";
import { SpawnEvent } from "./BeatMapGenerator";

interface EventPlannerOptions {
  seed: number;
  difficulty: "chill" | "normal" | "hyper";
  minGapSeconds: number;
  travelTime: number;
  timingOffsetSeconds: number;
}

interface Candidate {
  frame: number;
  time: number;
  strength: number;
  isBeat: boolean;
}

interface SectionProfile {
  spawnBias: number;
  featureBias: number;
  restBias: number;
}

export class EventPlanner {
  public plan(
    song: SongAnalysis,
    rhythm: RhythmAnalysis,
    structure: StructureAnalysis,
    track: TrackPlan,
    options: EventPlannerOptions
  ): SpawnEvent[] {
    if (song.frames.length === 0 || rhythm.beatFrames.length === 0) {
      return [];
    }

    let rngState = options.seed >>> 0;
    const nextRandom = (): number => {
      rngState = (1664525 * rngState + 1013904223) >>> 0;
      return rngState / 0xffffffff;
    };

    const candidates = this.buildCandidates(song, rhythm, track);
    const laneCounts = [0, 0, 0];
    const events: SpawnEvent[] = [];
    const sectionByFrame = this.makeSectionLookup(song.frames.length, structure.sections);
    const sectionCounts = [0, 0, 0, 0, 0];

    let prevLane = 1;
    let lastBeatTime = -Infinity;
    const beatSeconds = rhythm.beatPeriodFrames > 0
      ? (rhythm.beatPeriodFrames * song.hopSize) / song.sampleRate
      : 0.5;
    const maxJumpSeconds = Math.max(0.16, beatSeconds * 0.82);

    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      const frame = c.frame;
      const beatTime = c.time;
      if (beatTime < options.travelTime || beatTime > song.duration - 0.02) {
        continue;
      }
      if (beatTime - lastBeatTime < options.minGapSeconds) {
        continue;
      }

      const energy = structure.energyEnvelope[frame] ?? 0;
      const danger = track.dangerLevel[frame] ?? 0;
      const density = track.eventDensity[frame] ?? 0;
      const novelty = structure.noveltyEnvelope[frame] ?? 0;
      const feature = track.featureEligibility[frame] ?? 0;
      const loudEnough = song.frames[frame].rmsDb > -44;
      const sectionLabel = sectionByFrame[frame];
      const profile = this.profileForSection(sectionLabel);
      const anchorBoost = this.anchorBoost(frame, track.anchorFrames, rhythm.beatPeriodFrames);

      if (!loudEnough || energy < 0.08) {
        continue;
      }

      const spawnChance = this.spawnChance(c, density, danger, novelty, options.difficulty, profile, anchorBoost);
      if (nextRandom() > spawnChance) {
        continue;
      }

      const lane = this.pickLane(song, frame, prevLane, laneCounts, nextRandom);
      if (Math.abs(lane - prevLane) >= 2 && beatTime - lastBeatTime < maxJumpSeconds) {
        continue;
      }

      const type = this.pickType(c.strength, density, feature + profile.featureBias + anchorBoost * 0.15, options.difficulty, nextRandom);
      const duration = this.pickDuration(type, beatSeconds, options.difficulty, nextRandom);
      const slideToLane = type === "slide" ? this.pickSlideTarget(lane, nextRandom) : lane;
      const bassEnergy = this.computeBassEnergy(song, frame);

      events.push({
        spawnTime: beatTime - options.travelTime + options.timingOffsetSeconds,
        beatTime: beatTime + options.timingOffsetSeconds,
        lane,
        bassEnergy,
        type,
        duration,
        slideToLane
      });

      laneCounts[lane] += 1;
      sectionCounts[this.sectionLabelIndex(sectionLabel)] += 1;
      prevLane = lane;
      lastBeatTime = beatTime;

      if (type === "double") {
        const echoGap = options.difficulty === "hyper" ? beatSeconds * 0.42 : beatSeconds * 0.52;
        const echoTime = beatTime + echoGap;
        if (echoTime < song.duration && echoTime - lastBeatTime >= options.minGapSeconds * 0.8) {
          const echoLane = this.pickEchoLane(lane, nextRandom);
          events.push({
            spawnTime: echoTime - options.travelTime + options.timingOffsetSeconds,
            beatTime: echoTime + options.timingOffsetSeconds,
            lane: echoLane,
            bassEnergy: Math.max(16, Math.floor(bassEnergy * 0.84)),
            type: "tap",
            duration: 0,
            slideToLane: echoLane
          });
          laneCounts[echoLane] += 1;
          sectionCounts[this.sectionLabelIndex(sectionLabel)] += 1;
          prevLane = echoLane;
          lastBeatTime = echoTime;
        }
      }
    }

    events.sort((a, b) => a.beatTime - b.beatTime);
    const playable = this.playabilityPass(events, options.minGapSeconds, beatSeconds);
    return this.normalizeDensity(playable, song.duration, options.difficulty, nextRandom, sectionByFrame, sectionCounts);
  }

  private buildCandidates(song: SongAnalysis, rhythm: RhythmAnalysis, track: TrackPlan): Candidate[] {
    const beatSet = new Set<number>();
    const out: Candidate[] = [];

    for (let i = 0; i < rhythm.beatFrames.length; i += 1) {
      const frame = this.clampFrame(rhythm.beatFrames[i], song.frames.length);
      beatSet.add(frame);
      const f = song.frames[frame];
      const strength = (rhythm.onsetStrength[frame] ?? 0) * 0.55 + (track.dangerLevel[frame] ?? 0) * 0.45;
      out.push({ frame, time: f.time, strength, isBeat: true });
    }

    const subdivision = Math.max(1, Math.floor(rhythm.beatPeriodFrames * 0.5));
    for (let i = 0; i < rhythm.onsetFrames.length; i += 1) {
      const onset = this.clampFrame(rhythm.onsetFrames[i], song.frames.length);
      const snapped = subdivision > 1
        ? Math.round(onset / subdivision) * subdivision
        : onset;
      const frame = this.clampFrame(snapped, song.frames.length);
      if (beatSet.has(frame)) {
        continue;
      }

      const onsetStrength = rhythm.onsetStrength[frame] ?? 0;
      const density = track.eventDensity[frame] ?? 0;
      if (onsetStrength < 0.18 || density < 0.18) {
        continue;
      }

      out.push({
        frame,
        time: song.frames[frame].time,
        strength: onsetStrength * 0.7 + (track.dangerLevel[frame] ?? 0) * 0.3,
        isBeat: false
      });
      beatSet.add(frame);
    }

    out.sort((a, b) => a.time - b.time);
    return out;
  }

  private spawnChance(
    candidate: Candidate,
    density: number,
    danger: number,
    novelty: number,
    difficulty: "chill" | "normal" | "hyper",
    profile: SectionProfile,
    anchorBoost: number
  ): number {
    const base = candidate.isBeat ? 0.62 : 0.34;
    const diff = difficulty === "hyper" ? 0.2 : difficulty === "chill" ? -0.16 : 0;
    const chance = base + density * 0.35 + danger * 0.2 + novelty * 0.16 + diff + profile.spawnBias + anchorBoost * 0.15;
    return Math.max(0.06, Math.min(0.95, chance));
  }

  private pickLane(
    song: SongAnalysis,
    frame: number,
    prevLane: number,
    laneCounts: readonly number[],
    nextRandom: () => number
  ): number {
    const f = song.frames[frame];
    const bass = Math.log1p(f.low);
    const mids = Math.log1p(f.mid);
    const highs = Math.log1p(f.high);

    const weights = [0, 0, 0];
    weights[0] = bass;
    weights[1] = mids * 1.06;
    weights[2] = highs;

    const laneMean = (laneCounts[0] + laneCounts[1] + laneCounts[2]) / 3;
    for (let lane = 0; lane < LANES; lane += 1) {
      const occupancyPenalty = (laneCounts[lane] - laneMean) * 0.04;
      const jumpPenalty = Math.abs(lane - prevLane) >= 2 ? 0.12 : 0;
      const jitter = (nextRandom() - 0.5) * 0.08;
      weights[lane] = weights[lane] - occupancyPenalty - jumpPenalty + jitter;
    }

    let best = 0;
    let bestWeight = weights[0];
    for (let lane = 1; lane < LANES; lane += 1) {
      if (weights[lane] > bestWeight) {
        bestWeight = weights[lane];
        best = lane;
      }
    }

    return best;
  }

  private pickType(
    strength: number,
    density: number,
    feature: number,
    difficulty: "chill" | "normal" | "hyper",
    nextRandom: () => number
  ): NoteType {
    const r = nextRandom();
    const hard = difficulty === "hyper";
    const easy = difficulty === "chill";

    if (hard && feature > 0.62 && density > 0.55 && strength > 0.9 && r < 0.1) {
      return "mine";
    }
    if (!easy && feature > 0.45 && strength > 0.78 && r < 0.2) {
      return "slide";
    }
    if (!easy && density > 0.52 && strength > 0.84 && r < (hard ? 0.17 : 0.1)) {
      return "double";
    }
    if (strength > 0.7 && r < (hard ? 0.28 : easy ? 0.12 : 0.2)) {
      return "hold";
    }
    return "tap";
  }

  private pickDuration(
    type: NoteType,
    beatSeconds: number,
    difficulty: "chill" | "normal" | "hyper",
    nextRandom: () => number
  ): number {
    if (type === "hold") {
      const scale = difficulty === "hyper" ? 0.72 : difficulty === "chill" ? 1.06 : 0.9;
      return Math.max(0.24, Math.min(0.95, beatSeconds * scale * (0.85 + nextRandom() * 0.35)));
    }
    if (type === "slide") {
      return Math.max(0.2, Math.min(0.7, beatSeconds * (0.62 + nextRandom() * 0.22)));
    }
    return 0;
  }

  private pickSlideTarget(lane: number, nextRandom: () => number): number {
    if (lane <= 0) {
      return 1;
    }
    if (lane >= LANES - 1) {
      return LANES - 2;
    }
    return nextRandom() < 0.5 ? lane - 1 : lane + 1;
  }

  private pickEchoLane(lane: number, nextRandom: () => number): number {
    if (lane <= 0) {
      return 1;
    }
    if (lane >= LANES - 1) {
      return LANES - 2;
    }
    if (nextRandom() < 0.25) {
      return lane;
    }
    return nextRandom() < 0.5 ? lane - 1 : lane + 1;
  }

  private computeBassEnergy(song: SongAnalysis, frame: number): number {
    const value = song.frames[frame].low;
    return Math.max(24, Math.min(255, Math.round(Math.log1p(value) * 24)));
  }

  private playabilityPass(events: SpawnEvent[], minGapSeconds: number, beatSeconds: number): SpawnEvent[] {
    const out: SpawnEvent[] = [];
    let lastTime = -Infinity;
    let lastLane = 1;
    let streak = 0;

    for (let i = 0; i < events.length; i += 1) {
      const e = events[i];
      if (e.beatTime - lastTime < minGapSeconds) {
        continue;
      }

      const jump = Math.abs(e.lane - lastLane);
      if (jump >= 2 && e.beatTime - lastTime < Math.max(minGapSeconds * 1.2, beatSeconds * 0.8)) {
        continue;
      }

      if (e.lane === lastLane) {
        streak += 1;
        if (streak >= 4) {
          continue;
        }
      } else {
        streak = 0;
      }

      out.push(e);
      lastTime = e.beatTime;
      lastLane = e.lane;
    }

    return out;
  }

  private normalizeDensity(
    events: SpawnEvent[],
    duration: number,
    difficulty: "chill" | "normal" | "hyper",
    nextRandom: () => number,
    sectionByFrame: Int8Array,
    sectionCounts: readonly number[]
  ): SpawnEvent[] {
    if (events.length <= 3 || duration <= 0.5) {
      return events;
    }

    const targetNps = difficulty === "hyper" ? 2.9 : difficulty === "chill" ? 1.35 : 2.1;
    const maxEvents = Math.max(6, Math.floor(targetNps * duration));
    const sorted = events.slice().sort((a, b) => a.beatTime - b.beatTime);

    if (sorted.length > maxEvents) {
      const keep = new Array<boolean>(sorted.length).fill(true);
      let removeCount = sorted.length - maxEvents;
      let idx = 1;

      while (removeCount > 0 && idx < sorted.length - 1) {
        const prev = sorted[idx - 1];
        const cur = sorted[idx];
        const next = sorted[idx + 1];
        const localSpacing = (cur.beatTime - prev.beatTime) + (next.beatTime - cur.beatTime);
        const removableType = cur.type === "tap" || cur.type === "double";
        if (removableType && localSpacing < (difficulty === "hyper" ? 0.75 : 0.95)) {
          keep[idx] = false;
          removeCount -= 1;
          idx += 2;
          continue;
        }
        idx += 1;
      }

      if (removeCount > 0) {
        for (let i = sorted.length - 2; i >= 1 && removeCount > 0; i -= 1) {
          if (!keep[i]) {
            continue;
          }
          if (sorted[i].type === "hold" || sorted[i].type === "slide") {
            continue;
          }
          if (nextRandom() < 0.7) {
            keep[i] = false;
            removeCount -= 1;
          }
        }
      }

      const filtered: SpawnEvent[] = [];
      for (let i = 0; i < sorted.length; i += 1) {
        if (keep[i]) {
          filtered.push(sorted[i]);
        }
      }
      return this.injectRests(filtered, difficulty, sectionByFrame, sectionCounts);
    }

    return this.injectRests(sorted, difficulty, sectionByFrame, sectionCounts);
  }

  private injectRests(
    events: SpawnEvent[],
    difficulty: "chill" | "normal" | "hyper",
    sectionByFrame: Int8Array,
    sectionCounts: readonly number[]
  ): SpawnEvent[] {
    if (events.length <= 8) {
      return events;
    }

    const out: SpawnEvent[] = [];
    const restEvery = difficulty === "hyper" ? 20 : difficulty === "chill" ? 12 : 16;
    const restDuration = difficulty === "hyper" ? 0.48 : 0.62;
    let lastAccepted = -Infinity;
    let acceptedInSection = 0;
    let currentSection = -1;

    for (let i = 0; i < events.length; i += 1) {
      const e = events[i];
      const section = this.resolveSectionForTime(
        e.beatTime,
        sectionByFrame,
        events[events.length - 1].beatTime
      );
      if (section !== currentSection) {
        currentSection = section;
        acceptedInSection = 0;
      }
      const sectionLoad = section >= 0 && section < sectionCounts.length ? sectionCounts[section] : 0;
      const heavySection = sectionLoad > 30;
      const dynamicRestEvery = heavySection ? Math.max(8, restEvery - 4) : restEvery;
      const shouldRest = (i > 0 && i % dynamicRestEvery === 0) || acceptedInSection >= (heavySection ? 14 : 22);
      if (i > 0 && i % restEvery === 0) {
        if (e.beatTime - lastAccepted < restDuration) {
          continue;
        }
      }
      if (shouldRest && e.beatTime - lastAccepted < restDuration) {
        continue;
      }
      out.push(e);
      lastAccepted = e.beatTime;
      acceptedInSection += 1;
    }

    return out;
  }

  private makeSectionLookup(frameCount: number, sections: readonly SongSection[]): Int8Array {
    const lookup = new Int8Array(frameCount);
    for (let i = 0; i < lookup.length; i += 1) {
      lookup[i] = 1;
    }
    for (let i = 0; i < sections.length; i += 1) {
      const label = this.sectionLabelIndex(sections[i].label);
      const lo = Math.max(0, sections[i].startFrame);
      const hi = Math.min(frameCount - 1, sections[i].endFrame);
      for (let f = lo; f <= hi; f += 1) {
        lookup[f] = label;
      }
    }
    return lookup;
  }

  private profileForSection(labelIdx: number): SectionProfile {
    if (labelIdx === 0) {
      return { spawnBias: -0.22, featureBias: -0.16, restBias: 0.24 };
    }
    if (labelIdx === 2) {
      return { spawnBias: 0.08, featureBias: 0.1, restBias: -0.08 };
    }
    if (labelIdx === 3) {
      return { spawnBias: 0.14, featureBias: 0.16, restBias: -0.12 };
    }
    if (labelIdx === 4) {
      return { spawnBias: -0.16, featureBias: -0.12, restBias: 0.16 };
    }
    return { spawnBias: 0, featureBias: 0, restBias: 0 };
  }

  private anchorBoost(frame: number, anchors: readonly number[], beatPeriodFrames: number): number {
    if (anchors.length === 0) {
      return 0;
    }
    const window = Math.max(6, beatPeriodFrames * 2);
    let best = 0;
    for (let i = 0; i < anchors.length; i += 1) {
      const d = Math.abs(anchors[i] - frame);
      if (d > window) {
        continue;
      }
      const n = 1 - d / window;
      best = Math.max(best, n * n);
    }
    return best;
  }

  private sectionLabelIndex(label: number | string): number {
    if (typeof label === "number") {
      return Math.max(0, Math.min(4, label | 0));
    }
    if (label === "intro") {
      return 0;
    }
    if (label === "verse") {
      return 1;
    }
    if (label === "chorus") {
      return 2;
    }
    if (label === "breakdown") {
      return 3;
    }
    return 4;
  }

  private resolveSectionForTime(beatTime: number, sectionByFrame: Int8Array, duration: number): number {
    if (sectionByFrame.length <= 1) {
      return 1;
    }
    const normalized = Math.max(0, Math.min(0.9999, beatTime / Math.max(1e-6, duration)));
    const frame = Math.max(0, Math.min(sectionByFrame.length - 1, Math.floor(normalized * sectionByFrame.length)));
    return sectionByFrame[frame];
  }

  private clampFrame(frame: number, length: number): number {
    return Math.max(0, Math.min(length - 1, frame));
  }
}
