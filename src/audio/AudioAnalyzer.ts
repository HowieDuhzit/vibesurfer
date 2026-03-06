import { ENERGY_HISTORY } from "../core/Config";

export class AudioAnalyzer {
  private readonly frequencyData: Uint8Array;
  private readonly energyHistory = new Float32Array(ENERGY_HISTORY);

  private historyIndex = 0;
  private historyCount = 0;

  private currentEnergy = 0;
  private currentBassEnergy = 0;

  public constructor(private readonly analyser: AnalyserNode) {
    this.frequencyData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
  }

  public update(): void {
    this.analyser.getByteFrequencyData(this.frequencyData as unknown as Uint8Array<ArrayBuffer>);

    let sum = 0;
    let bassSum = 0;
    const bassBins = Math.max(1, Math.floor(this.frequencyData.length * 0.08));

    for (let i = 0; i < this.frequencyData.length; i += 1) {
      const value = this.frequencyData[i];
      sum += value;

      if (i < bassBins) {
        bassSum += value;
      }
    }

    this.currentEnergy = sum / this.frequencyData.length;
    this.currentBassEnergy = bassSum / bassBins;

    this.energyHistory[this.historyIndex] = this.currentEnergy;
    this.historyIndex = (this.historyIndex + 1) % this.energyHistory.length;
    this.historyCount = Math.min(this.historyCount + 1, this.energyHistory.length);
  }

  public getCurrentEnergy(): number {
    return this.currentEnergy;
  }

  public getCurrentBassEnergy(): number {
    return this.currentBassEnergy;
  }

  public getFrequencyData(): Uint8Array {
    return this.frequencyData;
  }

  public getRollingAverage(): number {
    if (this.historyCount === 0) {
      return 0;
    }

    let sum = 0;
    for (let i = 0; i < this.historyCount; i += 1) {
      sum += this.energyHistory[i];
    }

    return sum / this.historyCount;
  }
}
