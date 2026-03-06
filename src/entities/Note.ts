import * as THREE from "three";
import { LANE_WIDTH, SPAWN_DISTANCE } from "../core/Config";
import { Entity } from "./Entity";

const laneX = [-LANE_WIDTH, 0, LANE_WIDTH];

export type NoteType = "beat";

export class Note extends Entity {
  public lane = 1;
  public zPosition = -SPAWN_DISTANCE;
  public type: NoteType = "beat";
  public active = false;

  public constructor(public readonly instanceId: number) {
    super(new THREE.Object3D());
  }

  public spawn(lane: number, type: NoteType = "beat"): void {
    this.lane = lane;
    this.zPosition = -SPAWN_DISTANCE;
    this.type = type;
    this.active = true;
    this.mesh.position.set(laneX[lane] ?? 0, 0.55, this.zPosition);
  }

  public updatePosition(deltaTime: number, speed: number): void {
    this.zPosition += speed * deltaTime;
    this.mesh.position.z = this.zPosition;
  }

  public deactivate(): void {
    this.active = false;
  }
}
