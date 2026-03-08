import * as THREE from "three";
import { LANE_WIDTH, SPAWN_DISTANCE } from "../core/Config";
import { Entity } from "./Entity";

const laneX = [-LANE_WIDTH, 0, LANE_WIDTH];

export type NoteType = "tap" | "hold" | "double" | "slide" | "mine" | "power";

export class Note extends Entity {
  public lane = 1;
  public slideToLane = 1;
  public zPosition = -SPAWN_DISTANCE;
  public beatTime = 0;
  public spawnTime = 0;
  public type: NoteType = "tap";
  public duration = 0;
  public active = false;

  public constructor(public readonly instanceId: number) {
    super(new THREE.Object3D());
  }

  public spawn(lane: number, type: NoteType = "tap", duration = 0, slideToLane = lane, beatTime = 0, spawnTime = 0): void {
    this.lane = lane;
    this.slideToLane = slideToLane;
    this.zPosition = -SPAWN_DISTANCE;
    this.beatTime = beatTime;
    this.spawnTime = spawnTime;
    this.type = type;
    this.duration = duration;
    this.active = true;
    this.mesh.position.set(laneX[lane] ?? 0, 0.55, this.zPosition);
  }

  public deactivate(): void {
    this.active = false;
  }
}
