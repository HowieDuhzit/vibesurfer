import { BEAT_THRESHOLD } from "../core/Config";
import { AudioAnalyzer } from "./AudioAnalyzer";

export interface BeatEvent {
  timestamp: number;
  energy: number;
  bassEnergy: number;
}

type BeatListener = (event: BeatEvent) => void;

export class BeatDetector {
  private readonly listeners: BeatListener[] = [];
  private lastBeatTime = -Infinity;
  private readonly minBeatInterval = 0.11;

  public constructor(private readonly analyzer: AudioAnalyzer) {}

  public update(audioTime: number): void {
    const energy = this.analyzer.getCurrentEnergy();
    const rollingAverage = this.analyzer.getRollingAverage();

    if (rollingAverage <= 0) {
      return;
    }

    if (audioTime - this.lastBeatTime < this.minBeatInterval) {
      return;
    }

    if (energy > rollingAverage * BEAT_THRESHOLD) {
      this.lastBeatTime = audioTime;
      const event: BeatEvent = {
        timestamp: audioTime,
        energy,
        bassEnergy: this.analyzer.getCurrentBassEnergy()
      };

      for (let i = 0; i < this.listeners.length; i += 1) {
        this.listeners[i](event);
      }
    }
  }

  public onBeat(listener: BeatListener): void {
    this.listeners.push(listener);
  }
}
