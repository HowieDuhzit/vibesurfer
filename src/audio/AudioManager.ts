import { FFT_SIZE } from "../core/Config";

export class AudioManager {
  private audioContext: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private audioBuffer: AudioBuffer | null = null;

  private readonly analyserNode: AnalyserNode;
  private readonly gainNode: GainNode;

  private playbackStartContextTime = 0;
  private playbackOffset = 0;
  private playing = false;
  private readonly endedListeners: Array<() => void> = [];

  public constructor() {
    this.audioContext = new AudioContext();
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = FFT_SIZE;
    this.gainNode = this.audioContext.createGain();

    this.analyserNode.connect(this.gainNode);
    this.gainNode.connect(this.audioContext.destination);
  }

  public getAnalyser(): AnalyserNode {
    return this.analyserNode;
  }

  public getAudioContext(): AudioContext {
    if (this.audioContext === null) {
      this.audioContext = new AudioContext();
    }

    return this.audioContext;
  }

  public getLoadedBuffer(): AudioBuffer | null {
    return this.audioBuffer;
  }

  public getDuration(): number {
    return this.audioBuffer?.duration ?? 0;
  }

  public async loadAudioFile(file: File): Promise<void> {
    const context = this.getAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    this.audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
    this.stop();
    this.playbackOffset = 0;
  }

  public async play(): Promise<void> {
    if (!this.audioBuffer) {
      return;
    }

    const context = this.getAudioContext();
    if (context.state === "suspended") {
      await context.resume();
    }

    this.stopSourceOnly();

    this.sourceNode = context.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.connect(this.analyserNode);
    this.playbackStartContextTime = context.currentTime;
    this.sourceNode.start(0, this.playbackOffset);
    this.playing = true;

    this.sourceNode.onended = () => {
      this.playing = false;
      this.sourceNode = null;
      this.playbackOffset = 0;
      for (let i = 0; i < this.endedListeners.length; i += 1) {
        this.endedListeners[i]();
      }
    };
  }

  public stop(): void {
    if (!this.playing) {
      return;
    }

    const context = this.getAudioContext();
    this.playbackOffset = Math.max(0, context.currentTime - this.playbackStartContextTime + this.playbackOffset);
    this.stopSourceOnly();
    this.playing = false;
  }

  public getCurrentTime(): number {
    if (!this.playing) {
      return this.playbackOffset;
    }

    const context = this.getAudioContext();
    return context.currentTime - this.playbackStartContextTime + this.playbackOffset;
  }

  public isPlaying(): boolean {
    return this.playing;
  }

  public onEnded(listener: () => void): void {
    this.endedListeners.push(listener);
  }

  private stopSourceOnly(): void {
    if (!this.sourceNode) {
      return;
    }

    this.sourceNode.onended = null;
    this.sourceNode.stop();
    this.sourceNode.disconnect();
    this.sourceNode = null;
  }
}
