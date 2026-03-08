export interface SongFrameFeatures {
  time: number;
  rms: number;
  rmsDb: number;
  spectralFlux: number;
  centroid: number;
  zeroCrossing: number;
  low: number;
  mid: number;
  high: number;
}

export interface SongAnalysis {
  sampleRate: number;
  frameSize: number;
  hopSize: number;
  frames: SongFrameFeatures[];
  duration: number;
}

export interface RhythmAnalysis {
  bpm: number;
  beatPeriodFrames: number;
  beatFrames: number[];
  onsetFrames: number[];
  onsetStrength: Float32Array;
  confidence: number;
}

export interface SongSection {
  startFrame: number;
  endFrame: number;
  energyMean: number;
  intensity: number;
  label: "intro" | "verse" | "chorus" | "breakdown" | "outro";
}

export interface StructureAnalysis {
  sections: SongSection[];
  bigMomentFrames: number[];
  energyEnvelope: Float32Array;
  dangerEnvelope: Float32Array;
  noveltyEnvelope: Float32Array;
}

export interface TrackPlan {
  tilt: Float32Array;
  pan: Float32Array;
  roll: Float32Array;
  elevation: Float32Array;
  curvature: Float32Array;
  pace: Float32Array;
  speedScale: Float32Array;
  cumulativeDistance: Float32Array;
  eventDensity: Float32Array;
  dangerLevel: Float32Array;
  featureEligibility: Float32Array;
  anchorFrames: number[];
}
