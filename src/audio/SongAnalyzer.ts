import { FFT_SIZE } from "../core/Config";
import { SongAnalysis, SongFrameFeatures } from "./AnalysisTypes";

export class SongAnalyzer {
  private readonly frameSize = FFT_SIZE * 2;
  private readonly hopSize = FFT_SIZE / 4;

  public analyze(buffer: AudioBuffer): SongAnalysis {
    const sampleRate = buffer.sampleRate;
    const mono = this.mixToMono(buffer);
    const frameCount = mono.length >= this.frameSize
      ? Math.floor((mono.length - this.frameSize) / this.hopSize) + 1
      : 0;

    const window = this.makeHannWindow(this.frameSize);
    const real = new Float32Array(this.frameSize);
    const imag = new Float32Array(this.frameSize);
    const prevLogMag = new Float32Array(this.frameSize / 2);

    const lowCutBin = Math.max(1, Math.floor((220 * this.frameSize) / sampleRate));
    const midCutBin = Math.max(lowCutBin + 1, Math.floor((2400 * this.frameSize) / sampleRate));

    const frames: SongFrameFeatures[] = new Array(frameCount);

    for (let frame = 0; frame < frameCount; frame += 1) {
      const start = frame * this.hopSize;
      let rmsAcc = 0;
      let zeroCrossing = 0;
      let prevSign = 0;

      for (let i = 0; i < this.frameSize; i += 1) {
        const s = mono[start + i] ?? 0;
        rmsAcc += s * s;
        real[i] = s * window[i];
        imag[i] = 0;

        const sign = s > 0 ? 1 : s < 0 ? -1 : 0;
        if (i > 0 && sign !== 0 && prevSign !== 0 && sign !== prevSign) {
          zeroCrossing += 1;
        }
        if (sign !== 0) {
          prevSign = sign;
        }
      }

      this.fftInPlace(real, imag);

      let flux = 0;
      let low = 0;
      let mid = 0;
      let high = 0;
      let centroidNumerator = 0;
      let centroidDenominator = 0;

      const nyquistBins = this.frameSize / 2;
      for (let bin = 0; bin < nyquistBins; bin += 1) {
        const re = real[bin];
        const im = imag[bin];
        const mag = Math.sqrt(re * re + im * im);

        const logMag = Math.log1p(mag);
        const diff = logMag - prevLogMag[bin];
        if (diff > 0) {
          flux += diff;
        }
        prevLogMag[bin] = logMag;

        if (bin <= lowCutBin) {
          low += mag;
        } else if (bin <= midCutBin) {
          mid += mag;
        } else {
          high += mag;
        }

        centroidNumerator += bin * mag;
        centroidDenominator += mag;
      }

      const rms = Math.sqrt(rmsAcc / this.frameSize);
      const rmsDb = 20 * Math.log10(Math.max(1e-9, rms));
      const centroidHz = centroidDenominator > 0
        ? (centroidNumerator / centroidDenominator) * (sampleRate / this.frameSize)
        : 0;

      frames[frame] = {
        time: ((frame * this.hopSize) + this.frameSize * 0.5) / sampleRate,
        rms,
        rmsDb,
        spectralFlux: flux,
        centroid: centroidHz,
        zeroCrossing: zeroCrossing / this.frameSize,
        low,
        mid,
        high
      };
    }

    this.smoothFlux(frames);

    return {
      sampleRate,
      frameSize: this.frameSize,
      hopSize: this.hopSize,
      frames,
      duration: buffer.duration
    };
  }

  private mixToMono(buffer: AudioBuffer): Float32Array {
    const mono = new Float32Array(buffer.length);
    const channels = buffer.numberOfChannels;
    for (let c = 0; c < channels; c += 1) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < buffer.length; i += 1) {
        mono[i] += data[i] / channels;
      }
    }
    return mono;
  }

  private makeHannWindow(size: number): Float32Array {
    const out = new Float32Array(size);
    for (let i = 0; i < size; i += 1) {
      out[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return out;
  }

  private smoothFlux(frames: SongFrameFeatures[]): void {
    for (let i = 1; i < frames.length - 1; i += 1) {
      frames[i].spectralFlux = (frames[i - 1].spectralFlux + frames[i].spectralFlux + frames[i + 1].spectralFlux) / 3;
    }
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
}
