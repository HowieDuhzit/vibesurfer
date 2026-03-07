import { RhythmAnalysis, SongAnalysis } from "./AnalysisTypes";

export class RhythmAnalyzer {
  private readonly bpmMin = 70;
  private readonly bpmMax = 188;
  private readonly silenceFloorDb = -46;

  public analyze(song: SongAnalysis): RhythmAnalysis {
    const frameCount = song.frames.length;
    if (frameCount === 0) {
      return {
        bpm: 120,
        beatPeriodFrames: 1,
        beatFrames: [],
        onsetFrames: [],
        onsetStrength: new Float32Array(),
        confidence: 0
      };
    }

    const flux = new Float32Array(frameCount);
    const rmsDb = new Float32Array(frameCount);
    for (let i = 0; i < frameCount; i += 1) {
      flux[i] = song.frames[i].spectralFlux;
      rmsDb[i] = song.frames[i].rmsDb;
    }

    const onsetStrength = this.makeOnsetStrength(flux, rmsDb);
    const onsetFrames = this.pickOnsets(onsetStrength, rmsDb);

    const beatPeriodFrames = this.estimateBeatPeriodFrames(onsetStrength, song.sampleRate, song.hopSize);
    const beatPhase = this.estimateBeatPhase(onsetStrength, beatPeriodFrames);
    const beatFrames = this.buildBeatGrid(frameCount, beatPeriodFrames, beatPhase, onsetFrames);

    const bpm = beatPeriodFrames > 0
      ? 60 * song.sampleRate / (beatPeriodFrames * song.hopSize)
      : 120;
    const confidence = this.estimateConfidence(onsetStrength, beatFrames, beatPeriodFrames);

    return {
      bpm,
      beatPeriodFrames,
      beatFrames,
      onsetFrames,
      onsetStrength,
      confidence
    };
  }

  private makeOnsetStrength(flux: Float32Array, rmsDb: Float32Array): Float32Array {
    const out = new Float32Array(flux.length);
    const smooth = new Float32Array(flux.length);
    const radius = 2;

    for (let i = 0; i < flux.length; i += 1) {
      let sum = 0;
      let count = 0;
      const lo = Math.max(0, i - radius);
      const hi = Math.min(flux.length - 1, i + radius);
      for (let j = lo; j <= hi; j += 1) {
        sum += flux[j];
        count += 1;
      }
      smooth[i] = count > 0 ? sum / count : 0;
    }

    const mean = this.mean(smooth);
    const std = this.std(smooth, mean);
    const scale = Math.max(1e-6, std * 1.2);

    for (let i = 0; i < smooth.length; i += 1) {
      const silenceMask = rmsDb[i] <= this.silenceFloorDb ? 0 : 1;
      const v = Math.max(0, (smooth[i] - mean) / scale);
      out[i] = silenceMask * Math.min(2.5, v);
    }

    return out;
  }

  private pickOnsets(onsetStrength: Float32Array, rmsDb: Float32Array): number[] {
    const out: number[] = [];
    const localRadius = 8;
    const minSpacing = 2;
    let last = -Infinity;

    for (let i = localRadius; i < onsetStrength.length - localRadius; i += 1) {
      if (rmsDb[i] < this.silenceFloorDb) {
        continue;
      }

      let localMean = 0;
      let localSq = 0;
      let count = 0;
      for (let j = i - localRadius; j <= i + localRadius; j += 1) {
        const v = onsetStrength[j];
        localMean += v;
        localSq += v * v;
        count += 1;
      }
      localMean /= count;
      const variance = Math.max(0, localSq / count - localMean * localMean);
      const localStd = Math.sqrt(variance);
      const threshold = localMean + localStd * 0.8;
      const value = onsetStrength[i];

      if (value < threshold || value < 0.12) {
        continue;
      }
      if (!(value > onsetStrength[i - 1] && value >= onsetStrength[i + 1])) {
        continue;
      }
      if (i - last < minSpacing) {
        continue;
      }

      out.push(i);
      last = i;
    }

    return out;
  }

  private estimateBeatPeriodFrames(onsetStrength: Float32Array, sampleRate: number, hopSize: number): number {
    const minLag = Math.max(1, Math.floor((60 / this.bpmMax) * sampleRate / hopSize));
    const maxLag = Math.max(minLag + 1, Math.floor((60 / this.bpmMin) * sampleRate / hopSize));

    let bestLag = minLag;
    let bestScore = -Infinity;

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let score = 0;
      for (let i = lag; i < onsetStrength.length; i += 1) {
        score += onsetStrength[i] * onsetStrength[i - lag];
      }

      const bpm = 60 * sampleRate / (lag * hopSize);
      const prior = Math.exp(-Math.pow((bpm - 124) / 42, 2));
      const weighted = score * (0.75 + 0.5 * prior);
      if (weighted > bestScore) {
        bestScore = weighted;
        bestLag = lag;
      }
    }

    return bestLag;
  }

  private estimateBeatPhase(onsetStrength: Float32Array, periodFrames: number): number {
    if (periodFrames <= 1 || onsetStrength.length <= periodFrames) {
      return 0;
    }

    let bestPhase = 0;
    let bestScore = -Infinity;

    for (let phase = 0; phase < periodFrames; phase += 1) {
      let score = 0;
      for (let i = phase; i < onsetStrength.length; i += periodFrames) {
        score += onsetStrength[i];
      }
      if (score > bestScore) {
        bestScore = score;
        bestPhase = phase;
      }
    }

    return bestPhase;
  }

  private buildBeatGrid(
    frameCount: number,
    periodFrames: number,
    phase: number,
    onsetFrames: number[]
  ): number[] {
    const beats: number[] = [];
    if (periodFrames <= 0) {
      return beats;
    }

    let cursor = Math.max(0, Math.min(frameCount - 1, phase));
    let onsetIdx = 0;
    const window = Math.max(1, Math.floor(periodFrames * 0.2));

    while (cursor < frameCount) {
      while (onsetIdx < onsetFrames.length && onsetFrames[onsetIdx] < cursor - window) {
        onsetIdx += 1;
      }

      let snapped = cursor;
      let bestDist = Infinity;
      let j = onsetIdx;
      while (j < onsetFrames.length && onsetFrames[j] <= cursor + window) {
        const dist = Math.abs(onsetFrames[j] - cursor);
        if (dist < bestDist) {
          bestDist = dist;
          snapped = onsetFrames[j];
        }
        j += 1;
      }

      beats.push(Math.max(0, Math.min(frameCount - 1, snapped)));
      cursor += periodFrames;
    }

    return this.uniqueSorted(beats);
  }

  private estimateConfidence(onsetStrength: Float32Array, beats: number[], beatPeriodFrames: number): number {
    if (beats.length === 0 || beatPeriodFrames <= 1) {
      return 0;
    }

    let beatEnergy = 0;
    for (let i = 0; i < beats.length; i += 1) {
      beatEnergy += onsetStrength[beats[i]] ?? 0;
    }
    beatEnergy /= beats.length;

    let offEnergy = 0;
    let offCount = 0;
    const half = Math.max(1, Math.floor(beatPeriodFrames * 0.5));
    for (let i = 0; i < beats.length; i += 1) {
      const off = beats[i] + half;
      if (off >= 0 && off < onsetStrength.length) {
        offEnergy += onsetStrength[off];
        offCount += 1;
      }
    }
    offEnergy /= Math.max(1, offCount);

    const ratio = beatEnergy / Math.max(1e-6, offEnergy + 0.02);
    return Math.max(0, Math.min(1, (ratio - 1) / 2.2));
  }

  private uniqueSorted(values: number[]): number[] {
    if (values.length <= 1) {
      return values.slice();
    }
    values.sort((a, b) => a - b);
    const out = [values[0]];
    for (let i = 1; i < values.length; i += 1) {
      if (values[i] !== values[i - 1]) {
        out.push(values[i]);
      }
    }
    return out;
  }

  private mean(values: Float32Array): number {
    if (values.length === 0) {
      return 0;
    }
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) {
      sum += values[i];
    }
    return sum / values.length;
  }

  private std(values: Float32Array, mean: number): number {
    if (values.length === 0) {
      return 0;
    }
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) {
      const d = values[i] - mean;
      sum += d * d;
    }
    return Math.sqrt(sum / values.length);
  }
}
