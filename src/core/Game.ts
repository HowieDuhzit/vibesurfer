import * as THREE from "three";
import { AudioAnalyzer } from "../audio/AudioAnalyzer";
import { AudioManager } from "../audio/AudioManager";
import { BeatDetector } from "../audio/BeatDetector";
import { BeatMapGenerator, SpawnEvent } from "../audio/BeatMapGenerator";
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
import { HitJudgment, CollisionSystem } from "../systems/CollisionSystem";
import { MovementSystem } from "../systems/MovementSystem";
import { ScoreSystem } from "../systems/ScoreSystem";
import { NoteSpawner } from "../world/NoteSpawner";
import { Track } from "../world/Track";
import { GameLoop } from "./GameLoop";
import { InputManager } from "./InputManager";
import { Time } from "./Time";

export type DifficultyMode = "chill" | "normal" | "hyper";

export class Game {
  private readonly renderer: Renderer;
  private readonly sceneManager: SceneManager;
  private readonly lighting: Lighting;
  private readonly track: Track;
  private readonly player: Player;

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
  private songFinished = false;

  private judgmentLabel = "";
  private judgmentTimer = 0;

  public constructor(private readonly mount: HTMLElement) {
    // Initialization order:
    // Renderer -> Scene -> Camera -> Lighting -> Track -> Player -> Audio -> Spawner -> Systems -> Game Loop
    this.renderer = new Renderer(this.mount);
    this.sceneManager = new SceneManager(this.renderer.scene);
    this.lighting = new Lighting(this.sceneManager.scene);

    this.track = new Track();
    this.sceneManager.add(this.track.group);

    const playerGeometry = new THREE.BoxGeometry(1.2, 0.8, 1.4);
    const playerMaterial = new THREE.MeshStandardMaterial({ color: 0x22c55e, metalness: 0.1, roughness: 0.65 });
    const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
    playerMesh.castShadow = true;
    this.player = new Player(playerMesh);
    this.sceneManager.add(this.player.mesh);

    this.audioManager = new AudioManager();
    this.audioAnalyzer = new AudioAnalyzer(this.audioManager.getAnalyser());
    this.beatDetector = new BeatDetector(this.audioAnalyzer);
    this.beatMapGenerator = new BeatMapGenerator();

    this.spawner = new NoteSpawner(this.sceneManager.scene);

    this.input = new InputManager(this.mount);
    this.scoreSystem = new ScoreSystem();
    this.particleSystem = new ParticleSystem(this.sceneManager.scene);
    this.musicVisualizerBackground = new MusicVisualizerBackground(this.sceneManager.scene);
    this.frequencySideRailsEffect = new FrequencySideRailsEffect(this.sceneManager.scene);
    this.playerTrailEffect = new PlayerTrailEffect(this.sceneManager.scene);
    this.hitLineEffect = new HitLineEffect(this.sceneManager.scene);
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
    });

    this.audioManager.onEnded(() => {
      this.songFinished = true;
    });

    this.setDifficulty("normal");

    this.gameLoop = new GameLoop(this.update);
    this.cameraController.update(0, 0);
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
    this.regenerateBeatMap();
  }

  public async playAudio(): Promise<void> {
    this.songFinished = false;
    await this.audioManager.play();
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

    if (mode === "chill") {
      this.collisionSystem.setHitWindow(0.62);
    } else if (mode === "hyper") {
      this.collisionSystem.setHitWindow(0.42);
    } else {
      this.collisionSystem.setHitWindow(0.5);
    }

    this.regenerateBeatMap();
  }

  public getDifficulty(): DifficultyMode {
    return this.difficulty;
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
    judgment: string;
    judgmentVisible: boolean;
  }> {
    return {
      score: Math.floor(this.scoreSystem.score),
      combo: this.scoreSystem.combo,
      maxCombo: this.scoreSystem.maxCombo,
      accuracy: this.scoreSystem.getAccuracy(),
      perfect: this.scoreSystem.perfect,
      great: this.scoreSystem.great,
      good: this.scoreSystem.good,
      miss: this.scoreSystem.misses,
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
  }> {
    return {
      complete: this.songFinished,
      score: Math.floor(this.scoreSystem.score),
      maxCombo: this.scoreSystem.maxCombo,
      accuracy: this.scoreSystem.getAccuracy(),
      perfect: this.scoreSystem.perfect,
      great: this.scoreSystem.great,
      good: this.scoreSystem.good,
      miss: this.scoreSystem.misses
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

  private regenerateBeatMap(): void {
    const buffer = this.audioManager.getLoadedBuffer();
    if (!buffer) {
      return;
    }

    this.beatMapGenerator.clear();
    this.spawner.reset();
    this.beatMapGenerator.generateFromAudioBuffer(buffer);
  }

  private onNoteCollected(x: number, y: number, z: number, lane: number, judgment: HitJudgment): void {
    this.particleSystem.emitBurst(x, y, z, lane);
    this.cameraShake = Math.min(1, this.cameraShake + (judgment === "perfect" ? 0.45 : judgment === "great" ? 0.28 : 0.16));
    this.judgmentLabel = judgment.toUpperCase();
    this.judgmentTimer = 0.5;
  }

  private onMineHit(x: number, y: number, z: number, lane: number): void {
    this.particleSystem.emitBurst(x, y, z, lane);
    this.cameraShake = Math.min(1, this.cameraShake + 0.52);
    this.judgmentLabel = "MISS";
    this.judgmentTimer = 0.45;
  }

  private update = (time: Time): void => {
    // 1) update time (already updated by GameLoop before callback)

    // 2) update input
    this.input.update();
    this.player.setTargetLane(this.input.getTargetLane());

    const isPlaying = this.audioManager.isPlaying();

    if (isPlaying) {
      // 3) update audio analysis
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
      this.frequencySideRailsEffect.update(
        time.deltaTime,
        energyNorm,
        bassNorm,
        trebleNorm,
        this.audioAnalyzer.getFrequencyData()
      );
      this.musicVisualizerBackground.update(
        time.deltaTime,
        energyNorm,
        bassNorm,
        trebleNorm,
        this.audioAnalyzer.getFrequencyData()
      );
      this.playerTrailEffect.update(time.deltaTime, this.player.position.x, energyNorm, bassNorm, fever);

      // 4) update beat detector
      const audioTime = this.audioManager.getCurrentTime();
      this.beatDetector.update(audioTime);

      // 5) update note spawner
      this.pendingSpawnEvents.length = 0;
      this.beatMapGenerator.popSpawnEvents(audioTime, this.pendingSpawnEvents);
      this.spawner.updateSpawnEvents(this.pendingSpawnEvents);

      // 6) update entity movement
      this.movementSystem.update(time.deltaTime);

      // 7) update collision system
      this.collisionSystem.update(time.deltaTime);

      // 8) update scoring and effects
      this.scoreSystem.update();
      this.beatPulseEffect.update(time.deltaTime);
      this.particleSystem.update(time.deltaTime);
    } else {
      this.hitLineEffect.update(0.08, 0.06, 0.12);
      this.comboRingEffect.update(time.deltaTime, this.scoreSystem.combo, 0.08);
      this.frequencySideRailsEffect.update(time.deltaTime, 0.08, 0.06, 0.12);
      this.musicVisualizerBackground.update(time.deltaTime, 0, 0, 0);
      this.playerTrailEffect.update(time.deltaTime, this.player.position.x, 0.08, 0.06, 0);
    }

    this.cameraShake += (0 - this.cameraShake) * Math.min(1, time.deltaTime * 8);
    this.judgmentTimer = Math.max(0, this.judgmentTimer - time.deltaTime);

    // 9) render frame
    this.cameraController.update(time.deltaTime, this.cameraShake);
    this.renderer.render();
  };
}
