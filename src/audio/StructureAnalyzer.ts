import { RhythmAnalysis, SongAnalysis, SongSection, StructureAnalysis } from "./AnalysisTypes";

export class StructureAnalyzer {
  public analyze(song: SongAnalysis, rhythm: RhythmAnalysis): StructureAnalysis {
    const frameCount = song.frames.length;
    const energyEnvelope = new Float32Array(frameCount);
    const dangerEnvelope = new Float32Array(frameCount);
    const noveltyEnvelope = new Float32Array(frameCount);

    if (frameCount === 0) {
      return {
        sections: [],
        bigMomentFrames: [],
        energyEnvelope,
        dangerEnvelope,
        noveltyEnvelope
      };
    }

    const beatFrames = Math.max(2, rhythm.beatPeriodFrames);
    this.buildEnergyEnvelope(song, energyEnvelope, Math.max(6, Math.floor(beatFrames * 0.8)));
    this.buildDangerEnvelope(song, rhythm, dangerEnvelope, Math.max(4, Math.floor(beatFrames * 0.45)));
    this.buildNoveltyEnvelope(song, noveltyEnvelope, Math.max(8, beatFrames * 2));

    this.normalize(energyEnvelope);
    this.normalize(dangerEnvelope);
    this.normalize(noveltyEnvelope);

    const sections = this.detectSections(song, rhythm, energyEnvelope, noveltyEnvelope);
    const bigMomentFrames = this.detectBigMoments(song, rhythm, energyEnvelope, dangerEnvelope, noveltyEnvelope, sections);

    return {
      sections,
      bigMomentFrames,
      energyEnvelope,
      dangerEnvelope,
      noveltyEnvelope
    };
  }

  private buildEnergyEnvelope(song: SongAnalysis, out: Float32Array, radius: number): void {
    for (let i = 0; i < song.frames.length; i += 1) {
      const lo = Math.max(0, i - radius);
      const hi = Math.min(song.frames.length - 1, i + radius);
      let sum = 0;
      for (let j = lo; j <= hi; j += 1) {
        sum += song.frames[j].rms;
      }
      out[i] = sum / (hi - lo + 1);
    }
  }

  private buildDangerEnvelope(song: SongAnalysis, rhythm: RhythmAnalysis, out: Float32Array, radius: number): void {
    const onset = rhythm.onsetStrength;
    for (let i = 0; i < song.frames.length; i += 1) {
      const lo = Math.max(0, i - radius);
      const hi = Math.min(song.frames.length - 1, i + radius);
      let sum = 0;
      for (let j = lo; j <= hi; j += 1) {
        const flux = song.frames[j].spectralFlux;
        const onsetWeight = onset[j] ?? 0;
        sum += flux * 0.55 + onsetWeight * 0.45;
      }
      out[i] = sum / (hi - lo + 1);
    }
  }

  private buildNoveltyEnvelope(song: SongAnalysis, out: Float32Array, lag: number): void {
    const frameCount = song.frames.length;
    const centroidScale = 1 / 6000;

    for (let i = lag; i < frameCount; i += 1) {
      const a = song.frames[i];
      const b = song.frames[i - lag];
      const dl = Math.log1p(a.low) - Math.log1p(b.low);
      const dm = Math.log1p(a.mid) - Math.log1p(b.mid);
      const dh = Math.log1p(a.high) - Math.log1p(b.high);
      const dc = (a.centroid - b.centroid) * centroidScale;
      out[i] = Math.sqrt(dl * dl + dm * dm + dh * dh + dc * dc);
    }
  }

  private detectSections(
    song: SongAnalysis,
    rhythm: RhythmAnalysis,
    energy: Float32Array,
    novelty: Float32Array
  ): SongSection[] {
    const sections: SongSection[] = [];
    const frameCount = song.frames.length;
    const minSection = Math.max(20, rhythm.beatPeriodFrames * 8);

    const boundaries: number[] = [0];
    const noveltyThreshold = this.percentile(Array.from(novelty), 0.82);
    let lastBoundary = 0;

    for (let i = minSection; i < frameCount - minSection; i += 1) {
      if (novelty[i] < noveltyThreshold) {
        continue;
      }
      if (!(novelty[i] > novelty[i - 1] && novelty[i] >= novelty[i + 1])) {
        continue;
      }
      if (i - lastBoundary < minSection) {
        continue;
      }
      boundaries.push(i);
      lastBoundary = i;
    }

    if (boundaries[boundaries.length - 1] !== frameCount - 1) {
      boundaries.push(frameCount - 1);
    }

    const means: number[] = [];
    const noveltyMeans: number[] = [];
    for (let i = 0; i < boundaries.length - 1; i += 1) {
      const start = boundaries[i];
      const end = Math.max(start, boundaries[i + 1] - 1);
      let mean = 0;
      let noveltyMean = 0;
      for (let f = start; f <= end; f += 1) {
        mean += energy[f];
        noveltyMean += novelty[f];
      }
      mean /= (end - start + 1);
      noveltyMean /= (end - start + 1);
      means.push(mean);
      noveltyMeans.push(noveltyMean);
    }

    const e33 = this.percentile(means, 0.33);
    const e66 = this.percentile(means, 0.66);
    const n66 = this.percentile(noveltyMeans, 0.66);

    for (let i = 0; i < boundaries.length - 1; i += 1) {
      const start = boundaries[i];
      const end = Math.max(start, boundaries[i + 1] - 1);
      const mean = means[i] ?? 0;
      const noveltyMean = noveltyMeans[i] ?? 0;
      const prevMean = means[Math.max(0, i - 1)] ?? mean;
      const delta = mean - prevMean;
      const label = this.sectionLabel(i, boundaries.length - 1, mean, noveltyMean, delta, e33, e66, n66);
      sections.push({
        startFrame: start,
        endFrame: end,
        energyMean: mean,
        intensity: mean,
        label
      });
    }

    return sections;
  }

  private detectBigMoments(
    song: SongAnalysis,
    rhythm: RhythmAnalysis,
    energy: Float32Array,
    danger: Float32Array,
    novelty: Float32Array,
    sections: SongSection[]
  ): number[] {
    const out: number[] = [];
    const frameCount = song.frames.length;
    const spacing = Math.max(24, rhythm.beatPeriodFrames * 4);

    for (let i = 1; i < sections.length; i += 1) {
      const prev = sections[i - 1];
      const curr = sections[i];
      if (curr.energyMean - prev.energyMean > 0.1 || curr.label === "chorus" || curr.label === "breakdown") {
        out.push(curr.startFrame);
      }
    }

    for (let i = 2; i < frameCount - 2; i += 1) {
      const score = energy[i] * 0.45 + danger[i] * 0.35 + novelty[i] * 0.2;
      if (score < 0.72) {
        continue;
      }
      if (!(score > (energy[i - 1] * 0.45 + danger[i - 1] * 0.35 + novelty[i - 1] * 0.2))) {
        continue;
      }
      if (!(score >= (energy[i + 1] * 0.45 + danger[i + 1] * 0.35 + novelty[i + 1] * 0.2))) {
        continue;
      }

      const last = out.length > 0 ? out[out.length - 1] : -Infinity;
      if (i - last >= spacing) {
        out.push(i);
      }
    }

    out.sort((a, b) => a - b);
    return this.unique(out);
  }

  private sectionLabel(
    index: number,
    sectionCount: number,
    mean: number,
    noveltyMean: number,
    deltaFromPrev: number,
    energyP33: number,
    energyP66: number,
    noveltyP66: number
  ): SongSection["label"] {
    if (index === 0 && mean <= energyP33 + 0.03) {
      return "intro";
    }
    if (index === sectionCount - 1 && mean <= energyP33 + 0.05) {
      return "outro";
    }

    const highEnergy = mean >= energyP66;
    const lowEnergy = mean <= energyP33;
    const highNovelty = noveltyMean >= noveltyP66;
    const rising = deltaFromPrev > 0.08;
    const dropping = deltaFromPrev < -0.08;

    if (highEnergy && (highNovelty || rising)) {
      return "chorus";
    }
    if (lowEnergy && (highNovelty || dropping)) {
      return "breakdown";
    }
    return "verse";
  }

  private unique(values: number[]): number[] {
    if (values.length <= 1) {
      return values;
    }
    const out = [values[0]];
    for (let i = 1; i < values.length; i += 1) {
      if (values[i] !== values[i - 1]) {
        out.push(values[i]);
      }
    }
    return out;
  }

  private normalize(values: Float32Array): void {
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < values.length; i += 1) {
      min = Math.min(min, values[i]);
      max = Math.max(max, values[i]);
    }

    const range = Math.max(1e-6, max - min);
    for (let i = 0; i < values.length; i += 1) {
      values[i] = (values[i] - min) / range;
    }
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) {
      return 0;
    }
    const copy = values.slice().sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(copy.length - 1, Math.floor(p * (copy.length - 1))));
    return copy[idx];
  }
}
