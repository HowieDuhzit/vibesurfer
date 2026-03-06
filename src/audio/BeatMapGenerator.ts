import { FFT_SIZE, HIT_LINE_Z_OFFSET, LANES, SPAWN_DISTANCE, TRACK_SPEED } from "../core/Config";
import { BeatEvent } from "./BeatDetector";

export interface SpawnEvent {
  spawnTime: number;
  beatTime: number;
  lane: number;
  bassEnergy: number;
}

export interface BeatMarkerEvent {
  spawnTime: number;
  beatTime: number;
  isBarLine: boolean;
}

interface Candidate {
  frame: number;
  time: number;
  strength: number;
}

export class BeatMapGenerator {
  private readonly queue: SpawnEvent[] = [];
  private readonly beatMarkerQueue: BeatMarkerEvent[] = [];
  private rngState = 123456789;

  private readonly frameSize = FFT_SIZE * 2;
  private readonly hopSize = FFT_SIZE / 4;
  private readonly silenceFloorDb = -45;
  private timingOffsetSeconds = 0.01;
  private readonly minNoteGapSeconds = 0.14;

  private readonly bpmMin = 80;
  private readonly bpmMax = 170;
  private difficulty: "chill" | "normal" | "hyper" = "normal";

  public generateFromAudioBuffer(buffer: AudioBuffer): void {
    this.queue.length = 0;
    this.beatMarkerQueue.length = 0;

    const sampleRate = buffer.sampleRate;
    const travelTime = (SPAWN_DISTANCE + HIT_LINE_Z_OFFSET) / TRACK_SPEED;
    if (buffer.length <= this.frameSize + 4) {
      this.generateFallbackGrid(buffer.duration);
      return;
    }

    const mono = this.mixToMono(buffer);
    const analysis = this.analyzeFrames(mono, sampleRate);

    const candidates = this.extractOnsetCandidates(
      analysis.flux,
      analysis.rmsDb,
      sampleRate,
      travelTime
    );

    if (candidates.length === 0) {
      this.generateFallbackGrid(buffer.duration);
      return;
    }

    const periodFrames = this.estimateBeatPeriodFrames(analysis.flux, sampleRate);
    const beatCandidates = this.trackBeatPath(candidates, periodFrames);
    this.buildBeatMarkerGrid(beatCandidates, periodFrames, sampleRate, buffer.duration, travelTime);
    let selectedFrames = this.expandWithOffbeats(
      beatCandidates,
      candidates,
      periodFrames,
      sampleRate,
      buffer.duration
    );

    selectedFrames = this.densifyFrames(
      selectedFrames,
      candidates,
      periodFrames,
      sampleRate,
      buffer.duration
    );

    if (selectedFrames.length === 0) {
      this.generateFallbackGrid(buffer.duration);
      return;
    }

    const lowMean = this.mean(analysis.lowBand);
    const midMean = this.mean(analysis.midBand);
    const highMean = this.mean(analysis.highBand);

    let prevLane = 1;
    let repeatCount = 0;
    let lastTime = -Infinity;

    for (let i = 0; i < selectedFrames.length; i += 1) {
      const frame = selectedFrames[i];
      const beatTime = this.frameToTime(frame, sampleRate);

      if (beatTime < travelTime || beatTime - lastTime < this.minNoteGapSeconds) {
        continue;
      }

      if (analysis.rmsDb[frame] < this.silenceFloorDb) {
        continue;
      }

      const laneResult = this.pickLane(
        analysis.lowBand[frame],
        analysis.midBand[frame],
        analysis.highBand[frame],
        lowMean,
        midMean,
        highMean,
        prevLane,
        repeatCount
      );

      prevLane = laneResult.lane;
      repeatCount = laneResult.repeatCount;
      lastTime = beatTime;

      const bassEnergy = Math.max(32, Math.min(255, Math.round(Math.log1p(analysis.lowBand[frame]) * 26)));
      this.queue.push({
        spawnTime: beatTime - travelTime + this.timingOffsetSeconds,
        beatTime: beatTime + this.timingOffsetSeconds,
        lane: laneResult.lane,
        bassEnergy
      });
    }

    if (this.queue.length === 0) {
      this.generateFallbackGrid(buffer.duration);
    }
  }

  public addBeat(beat: BeatEvent): void {
    const travelTime = (SPAWN_DISTANCE + HIT_LINE_Z_OFFSET) / TRACK_SPEED;
    this.queue.push({
      spawnTime: beat.timestamp - travelTime,
      beatTime: beat.timestamp,
      lane: this.nextLane(),
      bassEnergy: beat.bassEnergy
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
  }

  public getPendingCount(): number {
    return this.queue.length;
  }

  public setTimingOffsetMs(ms: number): void {
    this.timingOffsetSeconds = ms / 1000;
  }

  public setDifficulty(difficulty: "chill" | "normal" | "hyper"): void {
    this.difficulty = difficulty;
  }

  private analyzeFrames(mono: Float32Array, sampleRate: number): {
    flux: Float32Array;
    rmsDb: Float32Array;
    lowBand: Float32Array;
    midBand: Float32Array;
    highBand: Float32Array;
  } {
    const frameCount = Math.floor((mono.length - this.frameSize) / this.hopSize);
    const window = this.makeHannWindow(this.frameSize);
    const real = new Float32Array(this.frameSize);
    const imag = new Float32Array(this.frameSize);
    const prevLogMag = new Float32Array(this.frameSize / 2);

    const flux = new Float32Array(frameCount);
    const rmsDb = new Float32Array(frameCount);
    const lowBand = new Float32Array(frameCount);
    const midBand = new Float32Array(frameCount);
    const highBand = new Float32Array(frameCount);

    const lowCutBin = Math.max(1, Math.floor((250 * this.frameSize) / sampleRate));
    const midCutBin = Math.max(lowCutBin + 1, Math.floor((2200 * this.frameSize) / sampleRate));

    for (let frame = 0; frame < frameCount; frame += 1) {
      const start = frame * this.hopSize;
      let rmsAcc = 0;

      for (let i = 0; i < this.frameSize; i += 1) {
        const s = mono[start + i];
        rmsAcc += s * s;
        real[i] = s * window[i];
        imag[i] = 0;
      }

      this.fftInPlace(real, imag);

      let frameFlux = 0;
      let low = 0;
      let mid = 0;
      let high = 0;

      const nyquistBins = this.frameSize / 2;
      for (let bin = 0; bin < nyquistBins; bin += 1) {
        const re = real[bin];
        const im = imag[bin];
        const m = Math.sqrt(re * re + im * im);

        const logMag = Math.log1p(m);
        const diff = logMag - prevLogMag[bin];
        if (diff > 0) {
          frameFlux += diff;
        }
        prevLogMag[bin] = logMag;

        if (bin <= lowCutBin) {
          low += m;
        } else if (bin <= midCutBin) {
          mid += m;
        } else {
          high += m;
        }
      }

      flux[frame] = frameFlux;
      rmsDb[frame] = 20 * Math.log10(Math.max(1e-9, Math.sqrt(rmsAcc / this.frameSize)));
      lowBand[frame] = low;
      midBand[frame] = mid;
      highBand[frame] = high;
    }

    this.smooth3(flux);

    return { flux, rmsDb, lowBand, midBand, highBand };
  }

  private extractOnsetCandidates(
    flux: Float32Array,
    rmsDb: Float32Array,
    sampleRate: number,
    travelTime: number
  ): Candidate[] {
    const candidates: Candidate[] = [];
    const windowRadius = 16;
    const fluxMedian = this.median(flux);
    const fluxMad = this.medianAbsDev(flux, fluxMedian);
    const globalThreshold = fluxMedian + 0.9 * fluxMad;

    for (let i = 1; i < flux.length - 1; i += 1) {
      const t = this.frameToTime(i, sampleRate);
      if (t < travelTime || rmsDb[i] < this.silenceFloorDb) {
        continue;
      }

      const lo = Math.max(0, i - windowRadius);
      const hi = Math.min(flux.length - 1, i + windowRadius);
      let localMax = -Infinity;
      for (let j = lo; j <= hi; j += 1) {
        if (flux[j] > localMax) {
          localMax = flux[j];
        }
      }

      const isPeak = flux[i] > flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] >= localMax * 0.2;
      if (!isPeak || flux[i] < globalThreshold) {
        continue;
      }

      candidates.push({ frame: i, time: t, strength: flux[i] });
    }

    return candidates;
  }

  private estimateBeatPeriodFrames(flux: Float32Array, sampleRate: number): number {
    const minLag = Math.max(1, Math.floor((60 / this.bpmMax) * sampleRate / this.hopSize));
    const maxLag = Math.max(minLag + 1, Math.floor((60 / this.bpmMin) * sampleRate / this.hopSize));

    let bestLag = minLag;
    let bestScore = -Infinity;

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let score = 0;
      for (let i = lag; i < flux.length; i += 1) {
        score += flux[i] * flux[i - lag];
      }

      const bpm = 60 * sampleRate / (lag * this.hopSize);
      const prior = Math.exp(-Math.pow((bpm - 120) / 45, 2));
      const weighted = score * (0.8 + 0.4 * prior);

      if (weighted > bestScore) {
        bestScore = weighted;
        bestLag = lag;
      }
    }

    return bestLag;
  }

  private trackBeatPath(candidates: Candidate[], periodFrames: number): Candidate[] {
    if (candidates.length === 0) {
      return [];
    }

    const n = candidates.length;
    const dp = new Float64Array(n);
    const prev = new Int32Array(n);

    for (let i = 0; i < n; i += 1) {
      dp[i] = candidates[i].strength;
      prev[i] = -1;
    }

    for (let i = 0; i < n; i += 1) {
      const fi = candidates[i].frame;
      const base = candidates[i].strength;

      for (let j = 0; j < i; j += 1) {
        const d = fi - candidates[j].frame;
        if (d < Math.floor(periodFrames * 0.5) || d > Math.ceil(periodFrames * 1.8)) {
          continue;
        }

        const deviation = Math.abs(d - periodFrames) / periodFrames;
        const transition = 1.0 - 1.7 * deviation;
        const score = dp[j] + base + transition;

        if (score > dp[i]) {
          dp[i] = score;
          prev[i] = j;
        }
      }
    }

    let bestIndex = 0;
    for (let i = 1; i < n; i += 1) {
      if (dp[i] > dp[bestIndex]) {
        bestIndex = i;
      }
    }

    const path: Candidate[] = [];
    let idx = bestIndex;
    while (idx >= 0) {
      path.push(candidates[idx]);
      idx = prev[idx];
    }

    path.reverse();
    return path;
  }

  private expandWithOffbeats(
    beatPath: Candidate[],
    candidates: Candidate[],
    periodFrames: number,
    sampleRate: number,
    durationSeconds: number
  ): number[] {
    const outFrames: number[] = [];
    if (beatPath.length === 0) {
      return outFrames;
    }

    const candidateByFrame = new Map<number, Candidate>();
    for (let i = 0; i < candidates.length; i += 1) {
      candidateByFrame.set(candidates[i].frame, candidates[i]);
    }

    const used = new Set<number>();
    for (let i = 0; i < beatPath.length; i += 1) {
      outFrames.push(beatPath[i].frame);
      used.add(beatPath[i].frame);
    }

    const beatSpacing = periodFrames;
    const offbeatWindow = Math.max(2, Math.floor(beatSpacing * 0.18));
    const minOffbeatStrength = this.percentile(candidates.map((c) => c.strength), 0.74);

    for (let i = 0; i < beatPath.length - 1; i += 1) {
      const left = beatPath[i].frame;
      const right = beatPath[i + 1].frame;
      const mid = Math.floor((left + right) * 0.5);

      let best: Candidate | null = null;
      for (let f = mid - offbeatWindow; f <= mid + offbeatWindow; f += 1) {
        const c = candidateByFrame.get(f);
        if (!c || used.has(c.frame)) {
          continue;
        }
        if (c.strength < minOffbeatStrength) {
          continue;
        }
        if (best === null || c.strength > best.strength) {
          best = c;
        }
      }

      if (best) {
        outFrames.push(best.frame);
        used.add(best.frame);
      }
    }

    outFrames.sort((a, b) => a - b);

    const filtered: number[] = [];
    let lastTime = -Infinity;
    for (let i = 0; i < outFrames.length; i += 1) {
      const t = this.frameToTime(outFrames[i], sampleRate);
      if (t < 0 || t > durationSeconds) {
        continue;
      }
      if (t - lastTime < this.minNoteGapSeconds) {
        continue;
      }
      filtered.push(outFrames[i]);
      lastTime = t;
    }

    return filtered;
  }

  private densifyFrames(
    baseFrames: number[],
    candidates: Candidate[],
    periodFrames: number,
    sampleRate: number,
    durationSeconds: number
  ): number[] {
    if (baseFrames.length === 0) {
      return baseFrames;
    }

    const beatPeriodSeconds = (periodFrames * this.hopSize) / sampleRate;
    const difficultyMult = this.difficulty === "chill" ? 0.8 : this.difficulty === "hyper" ? 1.35 : 1;
    const targetNps = Math.max(1.4, Math.min(4.2, (1 / Math.max(0.2, beatPeriodSeconds)) * 1.35 * difficultyMult));
    const targetCount = Math.floor(durationSeconds * targetNps);

    if (baseFrames.length >= targetCount) {
      return baseFrames;
    }

    const out = baseFrames.slice();
    const used = new Set<number>(out);

    const residual = candidates
      .filter((c) => !used.has(c.frame))
      .sort((a, b) => b.strength - a.strength);

    for (let i = 0; i < residual.length && out.length < targetCount; i += 1) {
      const frame = residual[i].frame;
      const t = this.frameToTime(frame, sampleRate);

      let tooClose = false;
      for (let j = 0; j < out.length; j += 1) {
        const tj = this.frameToTime(out[j], sampleRate);
        if (Math.abs(t - tj) < this.minNoteGapSeconds) {
          tooClose = true;
          break;
        }
      }

      if (tooClose) {
        continue;
      }

      out.push(frame);
      used.add(frame);
    }

    out.sort((a, b) => a - b);
    return out;
  }

  private pickLane(
    low: number,
    mid: number,
    high: number,
    lowMean: number,
    midMean: number,
    highMean: number,
    prevLane: number,
    repeatCount: number
  ): { lane: number; repeatCount: number } {
    const ln = low / Math.max(1e-6, lowMean);
    const mn = mid / Math.max(1e-6, midMean);
    const hn = high / Math.max(1e-6, highMean);

    let lane = 1;
    let best = mn;
    if (ln > best) {
      best = ln;
      lane = 0;
    }
    if (hn > best) {
      best = hn;
      lane = 2;
    }

    if (lane === prevLane) {
      repeatCount += 1;
      if (repeatCount >= 2) {
        const closeToMid = mn > best * 0.84;
        if (closeToMid) {
          lane = 1;
        } else if (lane === 1) {
          lane = ln > hn ? 0 : 2;
        } else {
          lane = 1;
        }
        repeatCount = 0;
      }
    } else {
      repeatCount = 0;
    }

    return { lane, repeatCount };
  }

  private frameToTime(frame: number, sampleRate: number): number {
    return ((frame * this.hopSize) + this.frameSize * 0.5) / sampleRate;
  }

  private mixToMono(buffer: AudioBuffer): Float32Array {
    const mono = new Float32Array(buffer.length);
    const channelCount = buffer.numberOfChannels;

    for (let c = 0; c < channelCount; c += 1) {
      const channel = buffer.getChannelData(c);
      for (let i = 0; i < buffer.length; i += 1) {
        mono[i] += channel[i] / channelCount;
      }
    }

    return mono;
  }

  private buildBeatMarkerGrid(
    beatPath: Candidate[],
    periodFrames: number,
    sampleRate: number,
    durationSeconds: number,
    travelTime: number
  ): void {
    if (beatPath.length === 0) {
      return;
    }

    const intervalHint = (periodFrames * this.hopSize) / sampleRate;
    const intervals: number[] = [];
    for (let i = 1; i < beatPath.length; i += 1) {
      const dt = beatPath[i].time - beatPath[i - 1].time;
      if (dt > 0.2 && dt < 1.2) {
        intervals.push(dt);
      }
    }

    const medianInterval = intervals.length > 0
      ? this.percentile(intervals, 0.5)
      : Math.max(0.3, Math.min(0.9, intervalHint));

    let beatIndex = 0;
    let lastAcceptedTime = -Infinity;
    const minMainBeatSpacing = medianInterval * 0.75;

    for (let i = 0; i < beatPath.length; i += 1) {
      const beatTime = beatPath[i].time;

      if (beatTime - lastAcceptedTime < minMainBeatSpacing) {
        continue;
      }

      if (beatTime < travelTime || beatTime >= durationSeconds) {
        continue;
      }

      this.beatMarkerQueue.push({
        spawnTime: beatTime - travelTime + this.timingOffsetSeconds,
        beatTime: beatTime + this.timingOffsetSeconds,
        isBarLine: beatIndex % 4 === 0
      });

      lastAcceptedTime = beatTime;
      beatIndex += 1;
    }
  }

  private generateFallbackGrid(durationSeconds: number): void {
    const beatInterval = 0.5;
    let lane = 0;
    let beatIndex = 0;

    for (let beatTime = 0.5; beatTime < durationSeconds; beatTime += beatInterval) {
      this.queue.push({
        spawnTime: beatTime - (SPAWN_DISTANCE + HIT_LINE_Z_OFFSET) / TRACK_SPEED,
        beatTime,
        lane,
        bassEnergy: 96
      });
      this.beatMarkerQueue.push({
        spawnTime: beatTime - (SPAWN_DISTANCE + HIT_LINE_Z_OFFSET) / TRACK_SPEED,
        beatTime,
        isBarLine: beatIndex % 4 === 0
      });
      lane = (lane + 1) % LANES;
      beatIndex += 1;
    }
  }

  private makeHannWindow(size: number): Float32Array {
    const out = new Float32Array(size);
    for (let i = 0; i < size; i += 1) {
      out[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return out;
  }

  private smooth3(values: Float32Array): void {
    for (let i = 1; i < values.length - 1; i += 1) {
      values[i] = (values[i - 1] + values[i] + values[i + 1]) / 3;
    }
  }

  private mean(values: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) {
      sum += values[i];
    }
    return values.length > 0 ? sum / values.length : 0;
  }

  private median(values: Float32Array): number {
    if (values.length === 0) {
      return 0;
    }

    const copy = Array.from(values);
    copy.sort((a, b) => a - b);
    const mid = Math.floor(copy.length / 2);
    return copy.length % 2 === 0 ? (copy[mid - 1] + copy[mid]) * 0.5 : copy[mid];
  }

  private medianAbsDev(values: Float32Array, center: number): number {
    if (values.length === 0) {
      return 0;
    }

    const absDev = new Float32Array(values.length);
    for (let i = 0; i < values.length; i += 1) {
      absDev[i] = Math.abs(values[i] - center);
    }

    return this.median(absDev);
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) {
      return 0;
    }

    const copy = values.slice().sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(copy.length - 1, Math.floor(p * (copy.length - 1))));
    return copy[idx];
  }

  private fftInPlace(real: Float32Array, imag: Float32Array): void {
    const n = real.length;
    let j = 0;

    for (let i = 0; i < n; i += 1) {
      if (i < j) {
        const tr = real[i];
        const ti = imag[i];
        real[i] = real[j];
        imag[i] = imag[j];
        real[j] = tr;
        imag[j] = ti;
      }

      let m = n >> 1;
      while (j >= m && m >= 2) {
        j -= m;
        m >>= 1;
      }
      j += m;
    }

    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = (Math.PI * 2) / size;

      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k += 1) {
          const angle = k * step;
          const wr = Math.cos(angle);
          const wi = -Math.sin(angle);
          const even = i + k;
          const odd = even + half;

          const or = real[odd] * wr - imag[odd] * wi;
          const oi = real[odd] * wi + imag[odd] * wr;

          real[odd] = real[even] - or;
          imag[odd] = imag[even] - oi;
          real[even] += or;
          imag[even] += oi;
        }
      }
    }
  }

  private nextLane(): number {
    this.rngState = (1664525 * this.rngState + 1013904223) >>> 0;
    return this.rngState % LANES;
  }
}
