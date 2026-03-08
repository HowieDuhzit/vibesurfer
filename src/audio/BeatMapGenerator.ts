import { HIT_LINE_Z_OFFSET, LANES, SPAWN_DISTANCE, TRACK_SPEED } from "../core/Config";
import { NoteType } from "../entities/Note";
import { BeatEvent } from "./BeatDetector";
import { EventPlanner } from "./EventPlanner";
import { RhythmAnalyzer } from "./RhythmAnalyzer";
import { SongAnalyzer } from "./SongAnalyzer";
import { StructureAnalyzer } from "./StructureAnalyzer";
import { TrackPlanner } from "./TrackPlanner";
import { RhythmAnalysis, SongAnalysis, SongSection, StructureAnalysis, TrackPlan } from "./AnalysisTypes";

export interface SpawnEvent {
  spawnTime: number;
  beatTime: number;
  lane: number;
  bassEnergy: number;
  type: NoteType;
  duration: number;
  slideToLane: number;
}

export interface BeatMarkerEvent {
  spawnTime: number;
  beatTime: number;
  isBarLine: boolean;
  isAnchor: boolean;
}

export interface GeneratorDebugData {
  bpm: number;
  beatConfidence: number;
  duration: number;
  sections: SongSection[];
  anchors: number[];
  beats: number[];
  onsets: number[];
  diagnostics: {
    notes: number;
    nps: number;
    lane0: number;
    lane1: number;
    lane2: number;
    chartHash: string;
  };
  plan: {
    elevation: readonly number[];
    curvature: readonly number[];
    pace: readonly number[];
    density: readonly number[];
    danger: readonly number[];
    feature: readonly number[];
    novelty: readonly number[];
  };
}

export interface RuntimeControlSample {
  elevation: number;
  curvature: number;
  pace: number;
  density: number;
  danger: number;
  feature: number;
}

export type RideStyle = "flow" | "burst" | "technical";
export type RulesetMode = "cruise" | "precision" | "assault";

export class BeatMapGenerator {
  private readonly queue: SpawnEvent[] = [];
  private readonly beatMarkerQueue: BeatMarkerEvent[] = [];
  private readonly lastGenerated: SpawnEvent[] = [];

  private readonly songAnalyzer = new SongAnalyzer();
  private readonly rhythmAnalyzer = new RhythmAnalyzer();
  private readonly structureAnalyzer = new StructureAnalyzer();
  private readonly trackPlanner = new TrackPlanner();
  private readonly eventPlanner = new EventPlanner();
  private readonly analysisCache = new WeakMap<AudioBuffer, {
    song: SongAnalysis;
    rhythm: RhythmAnalysis;
    structure: StructureAnalysis;
    track: TrackPlan;
  }>();

  private mapSeed = 123456789;
  private timingOffsetSeconds = 0.01;
  private minNoteGapSeconds = 0.14;
  private difficulty: "chill" | "normal" | "hyper" = "normal";
  private rideStyle: RideStyle = "flow";
  private ruleset: RulesetMode = "cruise";
  private activeSongDuration = 1;
  private activeTrack: TrackPlan | null = null;
  private activeNovelty: Float32Array | null = null;
  private readonly runtimeSample: RuntimeControlSample = {
    elevation: 0,
    curvature: 0,
    pace: 0,
    density: 0,
    danger: 0,
    feature: 0
  };

  private debugData: GeneratorDebugData = {
    bpm: 120,
    beatConfidence: 0,
    duration: 1,
    sections: [],
    anchors: [],
    beats: [],
    onsets: [],
    diagnostics: {
      notes: 0,
      nps: 0,
      lane0: 0,
      lane1: 0,
      lane2: 0,
      chartHash: "00000000"
    },
    plan: {
      elevation: [],
      curvature: [],
      pace: [],
      density: [],
      danger: [],
      feature: [],
      novelty: []
    }
  };

  public generateFromAudioBuffer(buffer: AudioBuffer): void {
    this.queue.length = 0;
    this.beatMarkerQueue.length = 0;
    this.lastGenerated.length = 0;

    const travelTime = (SPAWN_DISTANCE + HIT_LINE_Z_OFFSET) / TRACK_SPEED;
    if (buffer.duration <= 0.25) {
      this.generateFallbackGrid(buffer.duration || 1);
      return;
    }

    const { song, rhythm, structure, track } = this.getOrAnalyze(buffer);

    this.activeSongDuration = Math.max(1e-6, song.duration);
    this.activeTrack = track;
    this.activeNovelty = structure.noveltyEnvelope;

    this.debugData = {
      bpm: rhythm.bpm,
      beatConfidence: rhythm.confidence,
      duration: song.duration,
      sections: structure.sections,
      anchors: structure.bigMomentFrames.map((f) => song.frames[Math.max(0, Math.min(song.frames.length - 1, f))]?.time ?? 0),
      beats: this.compactFrameTimes(song, rhythm.beatFrames),
      onsets: this.compactFrameTimes(song, rhythm.onsetFrames),
      diagnostics: {
        notes: 0,
        nps: 0,
        lane0: 0,
        lane1: 0,
        lane2: 0,
        chartHash: "00000000"
      },
      plan: this.compactPlan(track, structure.noveltyEnvelope)
    };

    const events = this.eventPlanner.plan(song, rhythm, structure, track, {
      seed: this.mapSeed,
      difficulty: this.difficulty,
      rideStyle: this.rideStyle,
      ruleset: this.ruleset,
      minGapSeconds: this.minNoteGapSeconds,
      travelTime,
      timingOffsetSeconds: this.timingOffsetSeconds
    });

    for (let i = 0; i < events.length; i += 1) {
      this.queue.push(events[i]);
      this.lastGenerated.push(events[i]);
    }

    this.updateDiagnostics(events, song.duration);

    this.buildBeatMarkerGrid(song, rhythm.beatFrames, structure.bigMomentFrames, travelTime);

    if (this.queue.length === 0) {
      this.generateFallbackGrid(buffer.duration || 1);
    }
  }

  public addBeat(beat: BeatEvent): void {
    const travelTime = (SPAWN_DISTANCE + HIT_LINE_Z_OFFSET) / TRACK_SPEED;
    const lane = Math.floor((Math.abs(Math.sin(beat.timestamp * 2.17 + this.mapSeed)) * 9973) % LANES);
    this.queue.push({
      spawnTime: beat.timestamp - travelTime,
      beatTime: beat.timestamp,
      lane,
      bassEnergy: beat.bassEnergy,
      type: "tap",
      duration: 0,
      slideToLane: lane
    });
  }

  public popSpawnEvents(currentAudioTime: number, output: SpawnEvent[]): void {
    while (this.queue.length > 0 && this.queue[0].spawnTime <= currentAudioTime) {
      const next = this.queue.shift();
      if (next) {
        output.push(next);
      }
    }
  }

  public popBeatMarkerEvents(currentAudioTime: number, output: BeatMarkerEvent[]): void {
    while (this.beatMarkerQueue.length > 0 && this.beatMarkerQueue[0].spawnTime <= currentAudioTime) {
      const next = this.beatMarkerQueue.shift();
      if (next) {
        output.push(next);
      }
    }
  }

  public clear(): void {
    this.queue.length = 0;
    this.beatMarkerQueue.length = 0;
    this.activeTrack = null;
    this.activeNovelty = null;
  }

  public setSeed(seed: number): void {
    const next = Number.isFinite(seed) ? Math.floor(seed) : 123456789;
    this.mapSeed = (next >>> 0) || 1;
  }

  public getSeed(): number {
    return this.mapSeed;
  }

  public getPreview(): readonly SpawnEvent[] {
    return this.lastGenerated;
  }

  public getTrackPlan(): Readonly<TrackPlan> | null {
    return this.activeTrack;
  }

  public getDebugData(): Readonly<GeneratorDebugData> {
    return this.debugData;
  }

  public getPendingCount(): number {
    return this.queue.length;
  }

  public sampleRuntimeControl(audioTime: number): Readonly<RuntimeControlSample> {
    const track = this.activeTrack;
    if (!track || track.elevation.length === 0) {
      this.runtimeSample.elevation = 0;
      this.runtimeSample.curvature = 0;
      this.runtimeSample.pace = 0;
      this.runtimeSample.density = 0;
      this.runtimeSample.danger = 0;
      this.runtimeSample.feature = 0;
      return this.runtimeSample;
    }

    const normalized = Math.max(0, Math.min(0.99999, audioTime / this.activeSongDuration));
    const index = Math.max(0, Math.min(track.elevation.length - 1, Math.floor(normalized * track.elevation.length)));

    this.runtimeSample.elevation = track.elevation[index] ?? 0;
    this.runtimeSample.curvature = track.curvature[index] ?? 0;
    this.runtimeSample.pace = track.pace[index] ?? 0;
    this.runtimeSample.density = track.eventDensity[index] ?? 0;
    this.runtimeSample.danger = track.dangerLevel[index] ?? 0;
    this.runtimeSample.feature = track.featureEligibility[index] ?? 0;
    return this.runtimeSample;
  }

  public setTimingOffsetMs(ms: number): void {
    this.timingOffsetSeconds = ms / 1000;
  }

  public setDifficulty(difficulty: "chill" | "normal" | "hyper"): void {
    this.difficulty = difficulty;
    this.minNoteGapSeconds = difficulty === "hyper" ? 0.11 : difficulty === "chill" ? 0.18 : 0.14;
  }

  public setRideStyle(rideStyle: RideStyle): void {
    this.rideStyle = rideStyle;
  }

  public setRuleset(ruleset: RulesetMode): void {
    this.ruleset = ruleset;
  }

  public getRuleset(): RulesetMode {
    return this.ruleset;
  }

  private buildBeatMarkerGrid(
    song: ReturnType<SongAnalyzer["analyze"]>,
    beatFrames: number[],
    anchorFrames: readonly number[],
    travelTime: number
  ): void {
    this.beatMarkerQueue.length = 0;
    let beatIndex = 0;
    const anchorSet = new Set<number>(anchorFrames.map((frame) => Math.max(0, Math.min(song.frames.length - 1, frame))));

    for (let i = 0; i < beatFrames.length; i += 1) {
      const frame = Math.max(0, Math.min(song.frames.length - 1, beatFrames[i]));
      const beatTime = song.frames[frame]?.time ?? 0;
      if (beatTime < travelTime || beatTime >= song.duration) {
        continue;
      }

      this.beatMarkerQueue.push({
        spawnTime: beatTime - travelTime + this.timingOffsetSeconds,
        beatTime: beatTime + this.timingOffsetSeconds,
        isBarLine: beatIndex % 4 === 0,
        isAnchor: anchorSet.has(frame)
      });
      beatIndex += 1;
    }

    for (let i = 0; i < anchorFrames.length; i += 1) {
      const frame = Math.max(0, Math.min(song.frames.length - 1, anchorFrames[i]));
      const beatTime = song.frames[frame]?.time ?? 0;
      if (beatTime < travelTime || beatTime >= song.duration) {
        continue;
      }
      this.beatMarkerQueue.push({
        spawnTime: beatTime - travelTime + this.timingOffsetSeconds,
        beatTime: beatTime + this.timingOffsetSeconds,
        isBarLine: true,
        isAnchor: true
      });
    }

    this.beatMarkerQueue.sort((a, b) => a.beatTime - b.beatTime);
  }

  private compactPlan(track: TrackPlan, novelty: Float32Array): GeneratorDebugData["plan"] {
    const step = Math.max(1, Math.floor(track.elevation.length / 256));
    const downsample = (source: Float32Array): number[] => {
      const out: number[] = [];
      for (let i = 0; i < source.length; i += step) {
        out.push(source[i]);
      }
      return out;
    };

    return {
      elevation: downsample(track.elevation),
      curvature: downsample(track.curvature),
      pace: downsample(track.pace),
      density: downsample(track.eventDensity),
      danger: downsample(track.dangerLevel),
      feature: downsample(track.featureEligibility),
      novelty: downsample(novelty)
    };
  }

  private compactFrameTimes(song: SongAnalysis, frames: readonly number[]): number[] {
    if (frames.length === 0) {
      return [];
    }
    const step = Math.max(1, Math.floor(frames.length / 300));
    const out: number[] = [];
    for (let i = 0; i < frames.length; i += step) {
      const f = Math.max(0, Math.min(song.frames.length - 1, frames[i]));
      out.push(song.frames[f]?.time ?? 0);
    }
    return out;
  }

  private getOrAnalyze(buffer: AudioBuffer): {
    song: SongAnalysis;
    rhythm: RhythmAnalysis;
    structure: StructureAnalysis;
    track: TrackPlan;
  } {
    const cached = this.analysisCache.get(buffer);
    if (cached) {
      return cached;
    }

    const song = this.songAnalyzer.analyze(buffer);
    const rhythm = this.rhythmAnalyzer.analyze(song);
    const structure = this.structureAnalyzer.analyze(song, rhythm);
    const track = this.trackPlanner.plan(song, rhythm, structure);

    const next = { song, rhythm, structure, track };
    this.analysisCache.set(buffer, next);
    return next;
  }

  private updateDiagnostics(events: readonly SpawnEvent[], duration: number): void {
    let lane0 = 0;
    let lane1 = 0;
    let lane2 = 0;
    for (let i = 0; i < events.length; i += 1) {
      if (events[i].lane === 0) {
        lane0 += 1;
      } else if (events[i].lane === 1) {
        lane1 += 1;
      } else {
        lane2 += 1;
      }
    }
    this.debugData.diagnostics = {
      notes: events.length,
      nps: events.length / Math.max(1, duration),
      lane0,
      lane1,
      lane2,
      chartHash: this.computeChartHash(events)
    };
  }

  private computeChartHash(events: readonly SpawnEvent[]): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < events.length; i += 1) {
      const e = events[i];
      hash = this.fnvMix(hash, Math.floor(e.beatTime * 1000));
      hash = this.fnvMix(hash, Math.floor(e.spawnTime * 1000));
      hash = this.fnvMix(hash, e.lane);
      hash = this.fnvMix(hash, e.bassEnergy);
      hash = this.fnvMix(hash, Math.floor(e.duration * 1000));
      hash = this.fnvMix(hash, e.slideToLane);
      hash = this.fnvMix(hash, this.noteTypeCode(e.type));
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  private fnvMix(hash: number, value: number): number {
    hash ^= value >>> 0;
    return Math.imul(hash, 0x01000193);
  }

  private noteTypeCode(type: NoteType): number {
    if (type === "hold") {
      return 1;
    }
    if (type === "double") {
      return 2;
    }
    if (type === "slide") {
      return 3;
    }
    if (type === "mine") {
      return 4;
    }
    return 0;
  }

  private generateFallbackGrid(durationSeconds: number): void {
    this.queue.length = 0;
    this.lastGenerated.length = 0;

    const travelTime = (SPAWN_DISTANCE + HIT_LINE_Z_OFFSET) / TRACK_SPEED;
    const beatInterval = 0.5;
    let lane = 0;

    for (let beatTime = 0.5; beatTime < durationSeconds; beatTime += beatInterval) {
      const event: SpawnEvent = {
        spawnTime: beatTime - travelTime + this.timingOffsetSeconds,
        beatTime: beatTime + this.timingOffsetSeconds,
        lane,
        bassEnergy: 96,
        type: "tap",
        duration: 0,
        slideToLane: lane
      };
      this.queue.push(event);
      this.lastGenerated.push(event);
      this.beatMarkerQueue.push({
        spawnTime: event.spawnTime,
        beatTime: event.beatTime,
        isBarLine: Math.floor((beatTime - 0.5) / beatInterval) % 4 === 0,
        isAnchor: false
      });
      lane = (lane + 1) % LANES;
    }
  }
}
