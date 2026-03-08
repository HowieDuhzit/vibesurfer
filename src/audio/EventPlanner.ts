import { LANES } from "../core/Config";
import { NoteType } from "../entities/Note";
import { RhythmAnalysis, SongAnalysis, SongSection, StructureAnalysis, TrackPlan } from "./AnalysisTypes";
import { SpawnEvent } from "./BeatMapGenerator";

interface EventPlannerOptions {
  seed: number;
  difficulty: "chill" | "normal" | "hyper";
  rideStyle: "flow" | "burst" | "technical";
  ruleset: "cruise" | "precision" | "assault";
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

interface PatternSpec {
  lanes: readonly number[];
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

      const spawnChance = this.spawnChance(c, density, danger, novelty, options.difficulty, options.rideStyle, options.ruleset, profile, anchorBoost);
      if (nextRandom() > spawnChance) {
        continue;
      }

      const lane = this.pickLane(song, frame, prevLane, laneCounts, nextRandom);
      if (Math.abs(lane - prevLane) >= 2 && beatTime - lastBeatTime < maxJumpSeconds) {
        continue;
      }

      const type = this.pickType(c.strength, density, feature + profile.featureBias + anchorBoost * 0.15, options.difficulty, options.rideStyle, options.ruleset, nextRandom);
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
    const normalized = this.normalizeDensity(playable, song.duration, options.difficulty, options.rideStyle, options.ruleset, nextRandom, sectionByFrame, sectionCounts);
    const patterned = this.applyPatternVocabulary(normalized, beatSeconds, options.difficulty, options.rideStyle, options.ruleset, nextRandom, sectionByFrame, song.duration);
    const anchored = this.applyAnchorPhrases(
      patterned,
      song,
      track.anchorFrames,
      beatSeconds,
      options.travelTime,
      options.timingOffsetSeconds,
      options.rideStyle,
      options.ruleset,
      nextRandom
    );
    return this.survivabilityPass(anchored, beatSeconds, options.minGapSeconds, options.difficulty, options.rideStyle, options.ruleset);
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
    const beatFramesSet = new Set<number>(rhythm.beatFrames.map((frame) => this.clampFrame(frame, song.frames.length)));
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
      const nearestBeatFrame = this.findNearestBeatFrame(frame, beatFramesSet, Math.max(2, Math.floor(subdivision * 0.45)));
      const beatAligned = nearestBeatFrame !== null;
      const onsetThreshold = beatAligned ? 0.15 : 0.2;
      if (onsetStrength < onsetThreshold || density < 0.16) {
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
    rideStyle: "flow" | "burst" | "technical",
    ruleset: "cruise" | "precision" | "assault",
    profile: SectionProfile,
    anchorBoost: number
  ): number {
    const base = candidate.isBeat ? 0.62 : 0.34;
    const diff = difficulty === "hyper" ? 0.12 : difficulty === "chill" ? -0.12 : 0;
    const styleBias = rideStyle === "burst" ? 0.1 : rideStyle === "technical" ? 0.03 : -0.03;
    const rulesetBias = ruleset === "assault" ? 0.08 : ruleset === "precision" ? -0.04 : 0.02;
    const chance = base + density * 0.35 + danger * 0.2 + novelty * 0.16 + diff + profile.spawnBias + anchorBoost * 0.15 + styleBias + rulesetBias;
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

    const total = Math.max(1e-6, bass + mids + highs);
    const lowNorm = bass / total;
    const midNorm = mids / total;
    const highNorm = highs / total;

    const weights = [0, 0, 0];
    weights[0] = 0.55 + lowNorm * 0.7 + midNorm * 0.12;
    weights[1] = 0.65 + midNorm * 0.82 + lowNorm * 0.08 + highNorm * 0.08;
    weights[2] = 0.55 + highNorm * 0.7 + midNorm * 0.12;

    const laneMean = (laneCounts[0] + laneCounts[1] + laneCounts[2]) / 3;
    for (let lane = 0; lane < LANES; lane += 1) {
      const occupancyPenalty = (laneCounts[lane] - laneMean) * 0.08;
      const jumpPenalty = Math.abs(lane - prevLane) >= 2 ? 0.16 : 0;
      const repeatPenalty = lane === prevLane ? 0.06 : 0;
      const jitter = (nextRandom() - 0.5) * 0.08;
      weights[lane] = weights[lane] - occupancyPenalty - jumpPenalty - repeatPenalty + jitter;
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
    rideStyle: "flow" | "burst" | "technical",
    ruleset: "cruise" | "precision" | "assault",
    nextRandom: () => number
  ): NoteType {
    const r = nextRandom();
    const hard = difficulty === "hyper";
    const easy = difficulty === "chill";
    const bursty = rideStyle === "burst";
    const technical = rideStyle === "technical";
    const assault = ruleset === "assault";
    const precision = ruleset === "precision";

    if ((hard || technical || assault) && feature > 0.62 && density > 0.55 && strength > 0.9 && r < (assault ? 0.18 : 0.1)) {
      return "mine";
    }
    if (!easy && (technical || bursty || precision) && feature > 0.45 && strength > 0.78 && r < (precision ? 0.34 : technical ? 0.28 : 0.2)) {
      return "slide";
    }
    if (!easy && density > 0.52 && strength > 0.84 && r < (assault ? 0.26 : bursty ? 0.22 : hard ? 0.17 : 0.1)) {
      return "double";
    }
    if (strength > 0.7 && r < (precision ? 0.18 : rideStyle === "flow" ? 0.3 : hard ? 0.28 : easy ? 0.12 : 0.2)) {
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
    rideStyle: "flow" | "burst" | "technical",
    ruleset: "cruise" | "precision" | "assault",
    nextRandom: () => number,
    sectionByFrame: Int8Array,
    sectionCounts: readonly number[]
  ): SpawnEvent[] {
    if (events.length <= 3 || duration <= 0.5) {
      return events;
    }

    const beatIntervals = this.estimateBeatIntervals(events);
    const avgBeatSeconds = beatIntervals.length > 0
      ? beatIntervals.reduce((sum, value) => sum + value, 0) / beatIntervals.length
      : 0.5;
    const bpm = 60 / Math.max(0.24, avgBeatSeconds);
    const tempoFactor = Math.max(0.85, Math.min(1.22, bpm / 130));
    const styleNpsBias = rideStyle === "burst" ? 0.35 : rideStyle === "technical" ? 0.15 : -0.1;
    const rulesetBias = ruleset === "assault" ? 0.4 : ruleset === "precision" ? -0.15 : 0;
    const targetNpsBase = (difficulty === "hyper" ? 2.25 : difficulty === "chill" ? 1.2 : 1.9) + styleNpsBias + rulesetBias;
    const targetNps = targetNpsBase * tempoFactor;
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

  private estimateBeatIntervals(events: readonly SpawnEvent[]): number[] {
    const out: number[] = [];
    for (let i = 1; i < events.length; i += 1) {
      const dt = events[i].beatTime - events[i - 1].beatTime;
      if (dt > 0.12 && dt < 1.2) {
        out.push(dt);
      }
      if (out.length >= 48) {
        break;
      }
    }
    return out;
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
      const restBias = this.profileForSection(section).restBias;
      const biasAdjust = Math.round(restBias * 6);
      const dynamicRestEvery = heavySection ? Math.max(8, restEvery - 4 + biasAdjust) : Math.max(8, restEvery + biasAdjust);
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

  private applyPatternVocabulary(
    events: SpawnEvent[],
    beatSeconds: number,
    difficulty: "chill" | "normal" | "hyper",
    rideStyle: "flow" | "burst" | "technical",
    ruleset: "cruise" | "precision" | "assault",
    nextRandom: () => number,
    sectionByFrame: Int8Array,
    duration: number
  ): SpawnEvent[] {
    if (events.length < 4 || beatSeconds <= 0.05) {
      return events;
    }

    const out = events.map((e) => ({ ...e }));
    const measureSeconds = beatSeconds * 4;
    const windows = Math.max(1, Math.ceil(duration / Math.max(0.8, measureSeconds)));
    const introPattern: PatternSpec = { lanes: [1, 1, 0, 1, 2, 1] };
    const versePatterns: PatternSpec[] = [
      { lanes: [1, 0, 1, 2, 1] },
      { lanes: [0, 1, 2, 1] },
      { lanes: [2, 1, 0, 1] }
    ];
    const chorusPatterns: PatternSpec[] = [
      { lanes: [0, 2, 0, 2, 1, 2, 1, 0] },
      { lanes: [0, 1, 2, 1, 0, 1, 2, 1] }
    ];
    const breakdownPatterns: PatternSpec[] = [
      { lanes: [1, 2, 1, 0, 1] },
      { lanes: [0, 1, 1, 2, 1] }
    ];

    let prevLane = out[0]?.lane ?? 1;
    for (let w = 0; w < windows; w += 1) {
      const t0 = w * measureSeconds;
      const t1 = t0 + measureSeconds;
      const bucket: number[] = [];
      for (let i = 0; i < out.length; i += 1) {
        const t = out[i].beatTime;
        if (t >= t0 && t < t1) {
          bucket.push(i);
        }
      }
      if (bucket.length < 2) {
        continue;
      }

      const midT = t0 + measureSeconds * 0.5;
      const section = this.resolveSectionForTime(midT, sectionByFrame, duration);
      let spec: PatternSpec;
      if (section === 0 || section === 4) {
        spec = introPattern;
      } else if (section === 2) {
        spec = chorusPatterns[Math.floor(nextRandom() * chorusPatterns.length)];
      } else if (section === 3) {
        spec = breakdownPatterns[Math.floor(nextRandom() * breakdownPatterns.length)];
      } else {
        spec = versePatterns[Math.floor(nextRandom() * versePatterns.length)];
      }

      const mirror = difficulty === "hyper" || ruleset === "precision" ? nextRandom() < 0.5 : nextRandom() < 0.35;
      const maxStep = difficulty === "hyper" || rideStyle === "technical" || ruleset === "precision" ? 2 : 1;
      for (let bi = 0; bi < bucket.length; bi += 1) {
        const idx = bucket[bi];
        const rawLane = spec.lanes[bi % spec.lanes.length];
        let lane = mirror ? (LANES - 1 - rawLane) : rawLane;
        if (rideStyle === "flow" && ruleset !== "assault" && bi % 3 === 1) {
          lane = 1;
        }
        const nextLane = this.stepLaneToward(prevLane, lane, maxStep);
        out[idx].lane = nextLane;
        if (out[idx].type === "slide") {
          out[idx].slideToLane = this.pickSlideTarget(nextLane, nextRandom);
        } else {
          out[idx].slideToLane = nextLane;
        }
        prevLane = nextLane;
      }
    }

    out.sort((a, b) => a.beatTime - b.beatTime);
    return out;
  }

  private applyAnchorPhrases(
    events: SpawnEvent[],
    song: SongAnalysis,
    anchorFrames: readonly number[],
    beatSeconds: number,
    travelTime: number,
    timingOffsetSeconds: number,
    rideStyle: "flow" | "burst" | "technical",
    ruleset: "cruise" | "precision" | "assault",
    nextRandom: () => number
  ): SpawnEvent[] {
    if (events.length === 0 || anchorFrames.length === 0) {
      return events;
    }

    const out = events.map((event) => ({ ...event }));
    const windowRadius = Math.max(beatSeconds * 0.9, 0.42);

    for (let i = 0; i < anchorFrames.length; i += 1) {
      const frame = this.clampFrame(anchorFrames[i], song.frames.length);
      const anchorTime = song.frames[frame]?.time ?? 0;
      const nearby = out.filter((event) => Math.abs(event.beatTime - anchorTime) <= windowRadius);
      if (nearby.length >= (ruleset === "assault" ? 5 : rideStyle === "burst" ? 4 : 3)) {
        continue;
      }

      const baseLane = rideStyle === "technical"
        ? (nextRandom() < 0.5 ? 0 : 2)
        : rideStyle === "burst"
          ? (nextRandom() < 0.5 ? 0 : 2)
          : 1;
      const phrase = this.anchorPattern(baseLane, rideStyle, ruleset);
      const offsetStep = beatSeconds * 0.5;

      for (let p = 0; p < phrase.length; p += 1) {
        const beatTime = anchorTime + (p - Math.floor(phrase.length / 2)) * offsetStep;
        if (beatTime <= travelTime || beatTime >= song.duration - 0.05) {
          continue;
        }

        const lane = phrase[p];
        out.push({
          spawnTime: beatTime - travelTime + timingOffsetSeconds,
          beatTime: beatTime + timingOffsetSeconds,
          lane,
          bassEnergy: 120,
          type: rideStyle === "flow" && ruleset !== "precision" && p === Math.floor(phrase.length / 2) ? "hold" : "tap",
          duration: rideStyle === "flow" && ruleset !== "precision" && p === Math.floor(phrase.length / 2) ? Math.max(0.26, beatSeconds * 0.75) : 0,
          slideToLane: lane
        });
      }
    }

    out.sort((a, b) => a.beatTime - b.beatTime);
    return out;
  }

  private survivabilityPass(
    events: SpawnEvent[],
    beatSeconds: number,
    minGapSeconds: number,
    difficulty: "chill" | "normal" | "hyper",
    rideStyle: "flow" | "burst" | "technical",
    ruleset: "cruise" | "precision" | "assault"
  ): SpawnEvent[] {
    if (events.length <= 2) {
      return events;
    }

    const out: SpawnEvent[] = [];
    const switchTime = rideStyle === "technical"
      ? 0.16
      : difficulty === "hyper"
        ? 0.17
        : difficulty === "chill"
          ? 0.24
          : 0.2;
    const minMineGap = Math.max(minGapSeconds * (ruleset === "assault" ? 1.05 : 1.2), beatSeconds * (ruleset === "assault" ? 0.62 : 0.75));
    let lastTime = events[0].beatTime;
    let currentLane = 1;
    let lastMineTime = -Infinity;
    let lastMineLane = -1;

    for (let i = 0; i < events.length; i += 1) {
      const e = { ...events[i] };
      const dt = Math.max(0.01, e.beatTime - lastTime);
      const maxStep = Math.max(1, Math.floor(dt / switchTime));
      const reachable = this.stepLaneToward(currentLane, e.lane, maxStep);

      if (e.type === "mine") {
        if (e.beatTime - lastMineTime < minMineGap && e.lane === lastMineLane) {
          continue;
        }
        // Keep mines readable and avoid forced impossible switches.
        e.lane = reachable;
        e.slideToLane = e.lane;
        lastMineTime = e.beatTime;
        lastMineLane = e.lane;
      } else {
        e.lane = reachable;
        if (e.type === "slide") {
          e.slideToLane = this.stepLaneToward(e.lane, e.slideToLane, 1);
        } else {
          e.slideToLane = e.lane;
        }
      }

      out.push(e);
      lastTime = e.beatTime;
      currentLane = e.lane;
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

  private stepLaneToward(current: number, target: number, maxStep: number): number {
    const clampedTarget = Math.max(0, Math.min(LANES - 1, target));
    const step = Math.max(1, maxStep);
    if (clampedTarget > current) {
      return Math.min(clampedTarget, current + step);
    }
    if (clampedTarget < current) {
      return Math.max(clampedTarget, current - step);
    }
    return clampedTarget;
  }

  private clampFrame(frame: number, length: number): number {
    return Math.max(0, Math.min(length - 1, frame));
  }

  private anchorPattern(
    baseLane: number,
    rideStyle: "flow" | "burst" | "technical",
    ruleset: "cruise" | "precision" | "assault"
  ): readonly number[] {
    if (ruleset === "assault") {
      return baseLane === 0 ? [0, 1, 2, 2, 1] : [2, 1, 0, 0, 1];
    }
    if (ruleset === "precision") {
      return baseLane === 0 ? [0, 1, 2, 1, 0] : [2, 1, 0, 1, 2];
    }
    if (rideStyle === "burst") {
      return baseLane === 0 ? [0, 1, 2, 1] : [2, 1, 0, 1];
    }
    if (rideStyle === "technical") {
      return baseLane === 0 ? [0, 1, 0, 2] : [2, 1, 2, 0];
    }
    return [1, baseLane, 1];
  }

  private findNearestBeatFrame(frame: number, beatFrames: ReadonlySet<number>, window: number): number | null {
    for (let d = 0; d <= window; d += 1) {
      const lo = frame - d;
      if (beatFrames.has(lo)) {
        return lo;
      }
      const hi = frame + d;
      if (beatFrames.has(hi)) {
        return hi;
      }
    }
    return null;
  }
}
