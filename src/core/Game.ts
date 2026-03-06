import * as THREE from "three";
import { AudioAnalyzer } from "../audio/AudioAnalyzer";
import { AudioManager } from "../audio/AudioManager";
import { BeatDetector } from "../audio/BeatDetector";
import { BeatMapGenerator, BeatMarkerEvent, SpawnEvent } from "../audio/BeatMapGenerator";
import { BeatPulseEffect } from "../effects/BeatPulseEffect";
import { ParticleSystem } from "../effects/ParticleSystem";
import { MusicVisualizerBackground } from "../effects/MusicVisualizerBackground";
import { Player } from "../entities/Player";
import { CollisionSystem } from "../systems/CollisionSystem";
import { MovementSystem } from "../systems/MovementSystem";
import { ScoreSystem } from "../systems/ScoreSystem";
import { CameraController } from "../render/CameraController";
import { Lighting } from "../render/Lighting";
import { Renderer } from "../render/Renderer";
import { SceneManager } from "../render/SceneManager";
import { NoteSpawner } from "../world/NoteSpawner";
import { Track } from "../world/Track";
import { GameLoop } from "./GameLoop";
import { InputManager } from "./InputManager";
import { Time } from "./Time";

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

  private readonly gameLoop: GameLoop;
  private readonly pendingSpawnEvents: SpawnEvent[] = [];
  private readonly pendingBeatMarkerEvents: BeatMarkerEvent[] = [];

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
    this.movementSystem = new MovementSystem(this.player, this.track, this.spawner);
    this.collisionSystem = new CollisionSystem(
      this.player,
      this.spawner,
      this.scoreSystem,
      (x, y, z, lane) => this.particleSystem.emitBurst(x, y, z, lane)
    );

    this.cameraController = new CameraController(this.renderer.camera, this.player);
    this.beatPulseEffect = new BeatPulseEffect(this.track);

    this.beatDetector.onBeat((beat) => {
      this.beatPulseEffect.trigger(beat.bassEnergy / 255);
    });

    this.gameLoop = new GameLoop(this.update);
    this.cameraController.update();
  }

  public start(): void {
    this.gameLoop.start();
  }

  public stop(): void {
    this.gameLoop.stop();
  }

  public async loadAudioFile(file: File): Promise<void> {
    this.beatMapGenerator.clear();
    this.spawner.reset();
    this.scoreSystem.reset();
    this.musicVisualizerBackground.randomizeStyle();

    await this.audioManager.loadAudioFile(file);
    const buffer = this.audioManager.getLoadedBuffer();
    if (buffer) {
      this.beatMapGenerator.generateFromAudioBuffer(buffer);
    }
  }

  public async playAudio(): Promise<void> {
    await this.audioManager.play();
  }

  public getScoreState(): Readonly<{ score: number; combo: number; maxCombo: number }> {
    return {
      score: Math.floor(this.scoreSystem.score),
      combo: this.scoreSystem.combo,
      maxCombo: this.scoreSystem.maxCombo
    };
  }

  public getDebugState(): Readonly<{ playing: boolean; pendingSpawns: number; activeNotes: number }> {
    return {
      playing: this.audioManager.isPlaying(),
      pendingSpawns: this.beatMapGenerator.getPendingCount(),
      activeNotes: this.spawner.getActiveCount()
    };
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

      this.track.setMusicReactiveColor(energyNorm, bassNorm, trebleNorm);
      this.spawner.setMusicReactiveColor(energyNorm, bassNorm, trebleNorm);
      this.musicVisualizerBackground.update(
        time.deltaTime,
        energyNorm,
        bassNorm,
        trebleNorm,
        this.audioAnalyzer.getFrequencyData()
      );

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
      this.collisionSystem.update();

      // 8) update scoring and effects
      this.scoreSystem.update();
      this.beatPulseEffect.update(time.deltaTime);
      this.particleSystem.update(time.deltaTime);
    } else {
      this.musicVisualizerBackground.update(time.deltaTime, 0, 0, 0);
    }

    // 9) render frame
    this.cameraController.update();
    this.renderer.render();
  };
}
