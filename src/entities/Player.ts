import * as THREE from "three";
import { LANE_WIDTH } from "../core/Config";
import { Entity } from "./Entity";

const laneX = [-LANE_WIDTH, 0, LANE_WIDTH];

export class Player extends Entity {
  public currentLane = 1;
  public targetLane = 1;
  public readonly position: THREE.Vector3;

  public constructor(mesh: THREE.Mesh) {
    super(mesh);
    this.position = mesh.position;
    this.position.set(0, 0.5, 0);
  }

  public setTargetLane(lane: number): void {
    this.targetLane = lane;
  }

  public update(): void {
    const targetX = laneX[this.targetLane] ?? 0;
    this.position.x += (targetX - this.position.x) * 0.2;

    if (Math.abs(this.position.x - targetX) < 0.001) {
      this.position.x = targetX;
      this.currentLane = this.targetLane;
    }
  }

  public getZ(): number {
    return this.position.z;
  }
}
