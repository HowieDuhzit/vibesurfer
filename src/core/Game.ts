import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AudioAnalyzer } from "../audio/AudioAnalyzer";
import { AudioManager } from "../audio/AudioManager";
import { BeatDetector } from "../audio/BeatDetector";
import { BeatMapGenerator, GeneratorDebugData, SpawnEvent } from "../audio/BeatMapGenerator";
import { BeatPulseEffect } from "../effects/BeatPulseEffect";
import { ComboRingEffect } from "../effects/ComboRingEffect";
import { FrequencySideRailsEffect } from "../effects/FrequencySideRailsEffect";
import { HitLineEffect } from "../effects/HitLineEffect";
import { MusicVisualizerBackground } from "../effects/MusicVisualizerBackground";
import { ParticleSystem } from "../effects/ParticleSystem";
import { PlayerTrailEffect } from "../effects/PlayerTrailEffect";
import { Player } from "../entities/Player";
import { CameraController } from "../render/CameraController";
import { Lighting } from "../render/Lighting";
import { Renderer } from "../render/Renderer";
import { SceneManager } from "../render/SceneManager";
import { CollisionSystem, HitJudgment } from "../systems/CollisionSystem";
import { MovementSystem } from "../systems/MovementSystem";
import { ScoreSystem } from "../systems/ScoreSystem";
import { NoteSpawner } from "../world/NoteSpawner";
import { Track } from "../world/Track";
import { GameLoop } from "./GameLoop";
import { InputManager } from "./InputManager";
import { Time } from "./Time";

export type DifficultyMode = "chill" | "normal" | "hyper";
export type QualityMode = "auto" | "high" | "medium" | "low";
export type GameMode = "chart" | "endless" | "practice";

export class Game {
  private readonly renderer: Renderer;
  private readonly sceneManager: SceneManager;
  private readonly lighting: Lighting;
  private readonly track: Track;
  private readonly player: Player;
  private readonly playerVisualRoot: THREE.Group;

  private readonly audioManager: AudioManager;
  private readonly audioAnalyzer: AudioAnalyzer;
  private readonly beatDetector: BeatDetector;
  private readonly beatMapGenerator: BeatMapGenerator;

  private readonly spawner: NoteSpawner;

  private readonly input: InputManager;
  private readonly movementSystem: MovementSystem;
  private readonly collisionSystem: CollisionSystem;
  private readonly scoreSystem: ScoreSystem;

  private readonly cameraController: CameraController;
  private readonly beatPulseEffect: BeatPulseEffect;
  private readonly particleSystem: ParticleSystem;
  private readonly musicVisualizerBackground: MusicVisualizerBackground;
  private readonly frequencySideRailsEffect: FrequencySideRailsEffect;
  private readonly playerTrailEffect: PlayerTrailEffect;
  private readonly hitLineEffect: HitLineEffect;
  private readonly comboRingEffect: ComboRingEffect;

  private readonly gameLoop: GameLoop;
  private readonly pendingSpawnEvents: SpawnEvent[] = [];

  private difficulty: DifficultyMode = "normal";
  private timingOffsetMs = 0;
  private sectionEnergy = 0;
  private sectionTrend = 0;
  private cameraShake = 0;
  private cameraFovPulse = 0;
  private songFinished = false;

  private judgmentLabel = "";
  private judgmentTimer = 0;

  private effectIntensity = 1;
  private laneTolerance = 0.55;
  private qualityMode: QualityMode = "auto";
  private qualityScale = 1;

  private gameMode: GameMode = "chart";
  private strictMode = false;
  private mirrorLanes = false;
  private practiceSpeed = 0.85;
  private loopStart = 0;
  private loopEnd = 0;

  private metronomeEnabled = false;
  private metronomeBpm = 120;
  private nextMetronomeBeat = 0;

  private frameCostAvg = 1 / 60;
  private qualityAdaptClock = 0;
  private hoverBobTime = 0;

  public constructor(private readonly mount: HTMLElement) {
    this.renderer = new Renderer(this.mount);
    this.sceneManager = new SceneManager(this.renderer.scene);
    this.lighting = new Lighting(this.sceneManager.scene);

    this.track = new Track();
    this.sceneManager.add(this.track.group);

    const playerRig = this.createPlayerRig();
    this.playerVisualRoot = playerRig.visualRoot;
    this.player = new Player(playerRig);
    this.sceneManager.add(this.player.mesh);
    void this.loadBikeModel();

    this.audioManager = new AudioManager();
    this.audioAnalyzer = new AudioAnalyzer(this.audioManager.getAnalyser());
    this.beatDetector = new BeatDetector(this.audioAnalyzer);
    this.beatMapGenerator = new BeatMapGenerator();

    this.spawner = new NoteSpawner(this.sceneManager.scene, this.track);

    this.input = new InputManager(this.mount);
    this.scoreSystem = new ScoreSystem();
    this.particleSystem = new ParticleSystem(this.sceneManager.scene);
    this.musicVisualizerBackground = new MusicVisualizerBackground(this.sceneManager.scene);
    this.frequencySideRailsEffect = new FrequencySideRailsEffect(this.sceneManager.scene, this.track);
    this.playerTrailEffect = new PlayerTrailEffect(this.sceneManager.scene);
    this.hitLineEffect = new HitLineEffect(this.sceneManager.scene, this.track);
    this.comboRingEffect = new ComboRingEffect(this.sceneManager.scene, this.player);

    this.movementSystem = new MovementSystem(this.player, this.track, this.spawner);
    this.collisionSystem = new CollisionSystem(
      this.player,
      this.spawner,
      this.scoreSystem,
      (x, y, z, lane, judgment) => this.onNoteCollected(x, y, z, lane, judgment),
      (x, y, z, lane) => this.onMineHit(x, y, z, lane)
    );

    this.cameraController = new CameraController(this.renderer.camera, this.player);
    this.beatPulseEffect = new BeatPulseEffect(this.track);

    this.beatDetector.onBeat((beat) => {
      const bassNorm = beat.bassEnergy / 255;
      this.beatPulseEffect.trigger(bassNorm);
      this.cameraFovPulse = Math.min(1, this.cameraFovPulse + 0.25 + bassNorm * 0.45);

      if (this.gameMode === "endless" && this.audioManager.isPlaying()) {
        this.beatMapGenerator.addBeat(beat);
      }
    });

    this.audioManager.onEnded(() => {
      this.songFinished = true;
    });

    this.setQualityMode("auto");
    this.setEffectIntensity(1);
    this.setLaneTolerance(0.55);
    this.setDifficulty("normal");
    this.setGameMode("chart");

    this.gameLoop = new GameLoop(this.update);
    this.cameraController.update(0, 0, 0);
  }

  public start(): void {
    this.gameLoop.start();
  }

  public stop(): void {
    this.gameLoop.stop();
  }

  public async loadAudioFile(file: File): Promise<void> {
    this.songFinished = false;
    this.judgmentLabel = "";
    this.judgmentTimer = 0;
    this.beatMapGenerator.clear();
    this.spawner.reset();
    this.scoreSystem.reset();
    this.musicVisualizerBackground.randomizeStyle();

    await this.audioManager.loadAudioFile(file);
    this.audioManager.setPlaybackRate(this.gameMode === "practice" ? this.practiceSpeed : 1);
    this.regenerateBeatMap();
  }

  public async playAudio(): Promise<void> {
    this.songFinished = false;
    await this.audioManager.play();
    if (this.metronomeEnabled) {
      const now = this.audioManager.isPlaying() ? this.audioManager.getCurrentTime() : 0;
      this.nextMetronomeBeat = now;
    }
  }

  public setGameMode(mode: GameMode): void {
    this.gameMode = mode;
    this.audioManager.setPlaybackRate(mode === "practice" ? this.practiceSpeed : 1);
    if (mode === "endless") {
      this.beatMapGenerator.clear();
      this.spawner.reset();
    } else {
      this.regenerateBeatMap();
    }
  }

  public getGameMode(): GameMode {
    return this.gameMode;
  }

  public setStrictMode(enabled: boolean): void {
    this.strictMode = enabled;
    this.applyHitWindowForDifficulty();
  }

  public getStrictMode(): boolean {
    return this.strictMode;
  }

  public setMirrorLanes(enabled: boolean): void {
    this.mirrorLanes = enabled;
  }

  public getMirrorLanes(): boolean {
    return this.mirrorLanes;
  }

  public setMetronomeEnabled(enabled: boolean): void {
    this.metronomeEnabled = enabled;
    this.nextMetronomeBeat = this.audioManager.getCurrentTime();
  }

  public getMetronomeEnabled(): boolean {
    return this.metronomeEnabled;
  }

  public setMetronomeBpm(bpm: number): void {
    this.metronomeBpm = Math.max(60, Math.min(220, bpm));
  }

  public getMetronomeBpm(): number {
    return this.metronomeBpm;
  }

  public setCameraPulseEnabled(enabled: boolean): void {
    this.cameraController.setFovPulseEnabled(enabled);
  }

  public setSwipeEnabled(enabled: boolean): void {
    this.input.setSwipeEnabled(enabled);
  }

  public setAbsoluteLane(lane: number): void {
    this.input.setAbsoluteLane(lane);
  }

  public setPracticeSpeed(speed: number): void {
    this.practiceSpeed = Math.max(0.55, Math.min(1.15, speed));
    if (this.gameMode === "practice") {
      this.audioManager.setPlaybackRate(this.practiceSpeed);
    }
  }

  public getPracticeSpeed(): number {
    return this.practiceSpeed;
  }

  public setLoopRange(start: number, end: number): void {
    const duration = this.audioManager.getDuration();
    this.loopStart = Math.max(0, Math.min(duration, start));
    this.loopEnd = Math.max(this.loopStart, Math.min(duration, end));
  }

  public clearLoopRange(): void {
    this.loopStart = 0;
    this.loopEnd = 0;
  }

  public getLoopRange(): Readonly<{ start: number; end: number }> {
    return { start: this.loopStart, end: this.loopEnd };
  }

  public setSeed(seed: number): void {
    this.beatMapGenerator.setSeed(seed);
    this.regenerateBeatMap();
  }

  public getSeed(): number {
    return this.beatMapGenerator.getSeed();
  }

  public setTimingOffsetMs(ms: number): void {
    this.timingOffsetMs = Math.max(-120, Math.min(120, ms));
    this.beatMapGenerator.setTimingOffsetMs(this.timingOffsetMs);
    this.regenerateBeatMap();
  }

  public getTimingOffsetMs(): number {
    return this.timingOffsetMs;
  }

  public setDifficulty(mode: DifficultyMode): void {
    this.difficulty = mode;
    this.beatMapGenerator.setDifficulty(mode);
    this.applyHitWindowForDifficulty();
    this.regenerateBeatMap();
  }

  public getDifficulty(): DifficultyMode {
    return this.difficulty;
  }

  public getCurrentAudioTime(): number {
    return this.audioManager.getCurrentTime();
  }

  public getNearestBeatDeltaSeconds(audioTime: number): number | null {
    const preview = this.beatMapGenerator.getPreview();
    if (preview.length === 0) {
      return null;
    }

    let best = Infinity;
    for (let i = 0; i < preview.length; i += 1) {
      const d = preview[i].beatTime - audioTime;
      if (Math.abs(d) < Math.abs(best)) {
        best = d;
      }
    }
    return Number.isFinite(best) ? best : null;
  }

  public getChartPreviewSummary(): Readonly<{
    total: number;
    taps: number;
    holds: number;
    slides: number;
    doubles: number;
    mines: number;
    lane0: number;
    lane1: number;
    lane2: number;
    nps: number;
  }> {
    const preview = this.beatMapGenerator.getPreview();
    let taps = 0;
    let holds = 0;
    let slides = 0;
    let doubles = 0;
    let mines = 0;
    let lane0 = 0;
    let lane1 = 0;
    let lane2 = 0;

    for (let i = 0; i < preview.length; i += 1) {
      const note = preview[i];
      if (note.type === "hold") {
        holds += 1;
      } else if (note.type === "slide") {
        slides += 1;
      } else if (note.type === "double") {
        doubles += 1;
      } else if (note.type === "mine") {
        mines += 1;
      } else {
        taps += 1;
      }

      if (note.lane === 0) {
        lane0 += 1;
      } else if (note.lane === 1) {
        lane1 += 1;
      } else {
        lane2 += 1;
      }
    }

    const duration = Math.max(1, this.audioManager.getDuration());
    return {
      total: preview.length,
      taps,
      holds,
      slides,
      doubles,
      mines,
      lane0,
      lane1,
      lane2,
      nps: preview.length / duration
    };
  }

  public getGeneratorDebugData(): Readonly<GeneratorDebugData> {
    return this.beatMapGenerator.getDebugData();
  }

  public getScoreState(): Readonly<{
    score: number;
    combo: number;
    maxCombo: number;
    accuracy: number;
    perfect: number;
    great: number;
    good: number;
    miss: number;
    fever: number;
    judgment: string;
    judgmentVisible: boolean;
  }> {
    const fever = Math.max(0, Math.min(1, (this.scoreSystem.combo - 16) / 24));
    return {
      score: Math.floor(this.scoreSystem.score),
      combo: this.scoreSystem.combo,
      maxCombo: this.scoreSystem.maxCombo,
      accuracy: this.scoreSystem.getAccuracy(),
      perfect: this.scoreSystem.perfect,
      great: this.scoreSystem.great,
      good: this.scoreSystem.good,
      miss: this.scoreSystem.misses,
      fever,
      judgment: this.judgmentLabel,
      judgmentVisible: this.judgmentTimer > 0
    };
  }

  public getResultState(): Readonly<{
    complete: boolean;
    score: number;
    maxCombo: number;
    accuracy: number;
    perfect: number;
    great: number;
    good: number;
    miss: number;
    mineHits: number;
    tapHits: number;
    holdHits: number;
    slideHits: number;
    doubleHits: number;
    holdCompleted: number;
    holdBroken: number;
    slideCompleted: number;
    slideBroken: number;
  }> {
    return {
      complete: this.songFinished,
      score: Math.floor(this.scoreSystem.score),
      maxCombo: this.scoreSystem.maxCombo,
      accuracy: this.scoreSystem.getAccuracy(),
      perfect: this.scoreSystem.perfect,
      great: this.scoreSystem.great,
      good: this.scoreSystem.good,
      miss: this.scoreSystem.misses,
      mineHits: this.scoreSystem.mineHits,
      tapHits: this.scoreSystem.tapHits,
      holdHits: this.scoreSystem.holdHits,
      slideHits: this.scoreSystem.slideHits,
      doubleHits: this.scoreSystem.doubleHits,
      holdCompleted: this.scoreSystem.holdCompleted,
      holdBroken: this.scoreSystem.holdBroken,
      slideCompleted: this.scoreSystem.slideCompleted,
      slideBroken: this.scoreSystem.slideBroken
    };
  }

  public getDebugState(): Readonly<{ playing: boolean; pendingSpawns: number; activeNotes: number; progress: number }> {
    const duration = this.audioManager.getDuration();
    const progress = duration > 0 ? this.audioManager.getCurrentTime() / duration : 0;

    return {
      playing: this.audioManager.isPlaying(),
      pendingSpawns: this.beatMapGenerator.getPendingCount(),
      activeNotes: this.spawner.getActiveCount(),
      progress: Math.max(0, Math.min(1, progress))
    };
  }

  public getPerformanceState(): Readonly<{ fps: number; qualityScale: number }> {
    return {
      fps: this.frameCostAvg > 0 ? 1 / this.frameCostAvg : 0,
      qualityScale: this.qualityScale
    };
  }

  public setEffectIntensity(scale: number): void {
    this.effectIntensity = Math.max(0.3, Math.min(2, scale));
    this.particleSystem.setIntensity(this.effectIntensity);
    this.playerTrailEffect.setIntensity(this.effectIntensity);
    this.musicVisualizerBackground.setIntensity(this.effectIntensity);
    this.frequencySideRailsEffect.setIntensity(this.effectIntensity);
    this.spawner.setEffectIntensity(this.effectIntensity);
  }

  public getEffectIntensity(): number {
    return this.effectIntensity;
  }

  public setLaneTolerance(tolerance: number): void {
    this.laneTolerance = Math.max(0.3, Math.min(1.2, tolerance));
    this.collisionSystem.setLaneTolerance(this.laneTolerance);
  }

  public getLaneTolerance(): number {
    return this.laneTolerance;
  }

  public setQualityMode(mode: QualityMode): void {
    this.qualityMode = mode;
    this.applyQualityScale(this.resolveQualityScale(mode));
  }

  public getQualityMode(): QualityMode {
    return this.qualityMode;
  }

  private applyHitWindowForDifficulty(): void {
    let window = 0.5;
    if (this.difficulty === "chill") {
      window = 0.62;
    } else if (this.difficulty === "hyper") {
      window = 0.42;
    }
    if (this.strictMode) {
      window *= 0.83;
    }
    this.collisionSystem.setHitWindow(window);
  }

  private applyQualityScale(scale: number): void {
    this.qualityScale = Math.max(0.25, Math.min(1, scale));
    this.particleSystem.setQualityScale(this.qualityScale);
    this.playerTrailEffect.setQualityScale(this.qualityScale);
    this.musicVisualizerBackground.setQualityScale(this.qualityScale);
    this.frequencySideRailsEffect.setQualityScale(this.qualityScale);
  }

  private regenerateBeatMap(): void {
    if (this.gameMode === "endless") {
      this.track.setGeneratedPlan(null, 12);
      return;
    }

    const buffer = this.audioManager.getLoadedBuffer();
    if (!buffer) {
      return;
    }

    this.beatMapGenerator.clear();
    this.spawner.reset();
    this.beatMapGenerator.generateFromAudioBuffer(buffer);
    this.track.setGeneratedPlan(this.beatMapGenerator.getTrackPlan(), buffer.duration);
  }

  private onNoteCollected(x: number, y: number, z: number, lane: number, judgment: HitJudgment): void {
    this.particleSystem.emitBurst(x, y, z, lane);
    this.hitLineEffect.triggerHit(judgment === "perfect" ? 1 : judgment === "great" ? 0.65 : 0.45);
    this.cameraShake = Math.min(1, this.cameraShake + (judgment === "perfect" ? 0.45 : judgment === "great" ? 0.28 : 0.16));
    this.judgmentLabel = judgment.toUpperCase();
    this.judgmentTimer = 0.5;
  }

  private onMineHit(x: number, y: number, z: number, lane: number): void {
    this.particleSystem.emitBurst(x, y, z, lane);
    this.hitLineEffect.triggerMiss();
    this.cameraShake = Math.min(1, this.cameraShake + 0.52);
    this.judgmentLabel = "MISS";
    this.judgmentTimer = 0.45;
  }

  private update = (time: Time): void => {
    this.frameCostAvg += (time.deltaTime - this.frameCostAvg) * Math.min(1, time.deltaTime * 2.6);
    this.qualityAdaptClock += time.deltaTime;

    if (this.qualityMode === "auto" && this.qualityAdaptClock > 2.5) {
      this.qualityAdaptClock = 0;
      if (this.frameCostAvg > 0.03 && this.qualityScale > 0.38) {
        this.applyQualityScale(this.qualityScale > 0.64 ? 0.64 : 0.38);
      } else if (this.frameCostAvg < 0.018 && this.qualityScale < 1) {
        this.applyQualityScale(this.qualityScale < 0.64 ? 0.64 : 1);
      }
    }

    this.input.update();
    let lane = this.input.getTargetLane();
    if (this.mirrorLanes) {
      lane = 2 - lane;
    }
    this.player.setTargetLane(lane);

    const isPlaying = this.audioManager.isPlaying();

    if (isPlaying) {
      this.audioAnalyzer.update();
      const energyNorm = this.audioAnalyzer.getCurrentEnergy() / 255;
      const bassNorm = this.audioAnalyzer.getCurrentBassEnergy() / 255;
      const trebleNorm = Math.max(0, Math.min(1, energyNorm * 1.2 - bassNorm * 0.55));

      this.sectionTrend += (energyNorm - this.sectionEnergy) * Math.min(1, time.deltaTime * 2.2);
      this.sectionEnergy += (energyNorm - this.sectionEnergy) * Math.min(1, time.deltaTime * 1.8);
      const fever = Math.max(0, Math.min(1, (this.scoreSystem.combo - 16) / 24));

      this.track.setMusicReactiveColor(
        Math.max(0, Math.min(1, this.sectionEnergy + this.sectionTrend * 0.35)),
        bassNorm,
        trebleNorm,
        fever
      );
      this.spawner.setMusicReactiveColor(energyNorm, bassNorm, trebleNorm, fever);
      this.hitLineEffect.update(energyNorm, bassNorm, trebleNorm);
      this.comboRingEffect.update(time.deltaTime, this.scoreSystem.combo, energyNorm);
      this.frequencySideRailsEffect.update(time.deltaTime, energyNorm, bassNorm, trebleNorm, this.audioAnalyzer.getFrequencyData());
      this.musicVisualizerBackground.update(time.deltaTime, energyNorm, bassNorm, trebleNorm, this.audioAnalyzer.getFrequencyData());
      this.playerTrailEffect.update(time.deltaTime, this.player.position.x, energyNorm, bassNorm, fever);
      this.updatePlayerHoverVisual(time.deltaTime, energyNorm, bassNorm);

      const audioTime = this.audioManager.getCurrentTime();
      this.beatDetector.update(audioTime);

      if (this.gameMode === "practice" && this.loopEnd > this.loopStart && audioTime >= this.loopEnd) {
        this.audioManager.seek(this.loopStart);
      }

      this.pendingSpawnEvents.length = 0;
      this.beatMapGenerator.popSpawnEvents(audioTime, this.pendingSpawnEvents);
      this.spawner.updateSpawnEvents(this.pendingSpawnEvents);

      const control = this.beatMapGenerator.sampleRuntimeControl(audioTime);
      this.track.setPlaybackTime(audioTime);
      this.cameraController.setTrackMotion(control.curvature, control.elevation, control.pace);

      this.movementSystem.update(time.deltaTime);
      this.collisionSystem.update(time.deltaTime);

      this.scoreSystem.update();
      this.beatPulseEffect.update(time.deltaTime);
      this.particleSystem.update(time.deltaTime);

      if (this.metronomeEnabled) {
        const beatInterval = 60 / this.metronomeBpm;
        while (audioTime >= this.nextMetronomeBeat) {
          this.nextMetronomeBeat += beatInterval;
          this.beatPulseEffect.trigger(0.5);
          this.cameraFovPulse = Math.min(1, this.cameraFovPulse + 0.3);
        }
      }
    } else {
      this.hitLineEffect.update(0.08, 0.06, 0.12);
      this.comboRingEffect.update(time.deltaTime, this.scoreSystem.combo, 0.08);
      this.frequencySideRailsEffect.update(time.deltaTime, 0.08, 0.06, 0.12);
      this.musicVisualizerBackground.update(time.deltaTime, 0, 0, 0);
      this.playerTrailEffect.update(time.deltaTime, this.player.position.x, 0.08, 0.06, 0);
      this.updatePlayerHoverVisual(time.deltaTime, 0.08, 0.06);
      this.track.setPlaybackTime(0);
      this.cameraController.setTrackMotion(0, 0, 0);
      this.movementSystem.update(time.deltaTime);
      this.particleSystem.update(time.deltaTime);
    }

    this.cameraShake += (0 - this.cameraShake) * Math.min(1, time.deltaTime * 8);
    this.cameraFovPulse += (0 - this.cameraFovPulse) * Math.min(1, time.deltaTime * 6);
    this.judgmentTimer = Math.max(0, this.judgmentTimer - time.deltaTime);

    this.cameraController.update(time.deltaTime, this.cameraShake, this.cameraFovPulse);
    this.renderer.render();
  };

  private resolveQualityScale(mode: QualityMode): number {
    if (mode === "high") {
      return 1;
    }
    if (mode === "medium") {
      return 0.64;
    }
    if (mode === "low") {
      return 0.38;
    }

    const nav = window.navigator as Navigator & { deviceMemory?: number };
    const memory = nav.deviceMemory ?? 8;
    const cores = nav.hardwareConcurrency ?? 8;
    if (memory <= 2 || cores <= 2) {
      return 0.38;
    }
    if (memory <= 4 || cores <= 4) {
      return 0.64;
    }
    return 1;
  }

  private createPlayerRig(): THREE.Group & { visualRoot: THREE.Group } {
    const root = new THREE.Group() as THREE.Group & { visualRoot: THREE.Group };
    const visualRoot = new THREE.Group();
    root.add(visualRoot);

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.45, 1.05, 6, 14),
      new THREE.MeshPhysicalMaterial({
        color: 0x22c55e,
        roughness: 0.3,
        metalness: 0.45,
        clearcoat: 0.62,
        clearcoatRoughness: 0.08,
        emissive: 0x064e3b,
        emissiveIntensity: 0.5
      })
    );
    body.position.y = 0.25;
    body.castShadow = true;
    visualRoot.add(body);

    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 20, 16),
      new THREE.MeshPhysicalMaterial({
        color: 0x67e8f9,
        emissive: 0x22d3ee,
        emissiveIntensity: 0.9,
        roughness: 0.08,
        metalness: 0.2,
        transmission: 0.82,
        thickness: 0.8,
        clearcoat: 0.9,
        clearcoatRoughness: 0.04,
        transparent: true,
        opacity: 0.92
      })
    );
    canopy.position.set(0, 0.72, 0.08);
    visualRoot.add(canopy);

    const trim = new THREE.Mesh(
      new THREE.TorusGeometry(0.58, 0.05, 12, 44),
      new THREE.MeshPhysicalMaterial({
        color: 0x22d3ee,
        emissive: 0x38bdf8,
        emissiveIntensity: 1.3,
        roughness: 0.2,
        metalness: 0.62
      })
    );
    trim.rotation.x = Math.PI * 0.5;
    trim.position.y = 0.12;
    trim.castShadow = true;
    visualRoot.add(trim);
    root.userData.visualRoot = visualRoot;
    root.visualRoot = visualRoot;
    return root;
  }

  private async loadBikeModel(): Promise<void> {
    try {
      const loader = new GLTFLoader();
      const url = new URL("../../assets/models/bike.glb", import.meta.url).href;
      const gltf = await loader.loadAsync(url);
      const bike = gltf.scene;
      bike.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });

      const box = new THREE.Box3().setFromObject(bike);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
      const target = 1.7;
      const scale = target / maxDim;
      bike.scale.setScalar(scale);
      bike.position.sub(center.multiplyScalar(scale));

      // Face down-track and sit centered over lane root.
      bike.rotation.y = Math.PI;
      bike.position.y += 0.25;

      this.playerVisualRoot.clear();
      this.playerVisualRoot.add(bike);
    } catch {
      // Keep fallback capsule rig if model load fails.
    }
  }

  private updatePlayerHoverVisual(deltaTime: number, energy: number, bass: number): void {
    this.hoverBobTime += deltaTime * (1.8 + energy * 2.2 + bass * 1.4);
    const bob = Math.sin(this.hoverBobTime) * (0.05 + energy * 0.03);
    const sway = Math.sin(this.hoverBobTime * 0.5 + 0.7) * 0.025;
    const roll = Math.sin(this.hoverBobTime * 0.9) * 0.03;
    this.playerVisualRoot.position.y = bob;
    this.playerVisualRoot.position.x = sway;
    this.playerVisualRoot.rotation.z = roll;
  }
}
