import * as THREE from "three";
import { LANE_WIDTH } from "../core/Config";
import { Entity } from "./Entity";

const laneX = [-LANE_WIDTH, 0, LANE_WIDTH];

export class Player extends Entity {
  public currentLane = 1;
  public targetLane = 1;
  public readonly position: THREE.Vector3;
  private trackHeight = 0;
  private trackBank = 0;
  private trackPitch = 0;
  private readonly baseY = 0.5;

  public constructor(mesh: THREE.Object3D) {
    super(mesh);
    this.position = mesh.position;
    this.position.set(0, this.baseY, 0);
  }

  public setTargetLane(lane: number): void {
    this.targetLane = lane;
  }

  public update(): void {
    const targetX = laneX[this.targetLane] ?? 0;
    this.position.x += (targetX - this.position.x) * 0.2;
    const targetY = this.baseY + this.trackHeight + Math.sin(this.trackBank) * Math.abs(this.position.x) * 0.05;
    this.position.y += (targetY - this.position.y) * 0.24;
    this.mesh.rotation.z += (this.trackBank * 0.78 - this.mesh.rotation.z) * 0.18;
    this.mesh.rotation.x += (this.trackPitch * 0.48 - this.mesh.rotation.x) * 0.16;

    if (Math.abs(this.position.x - targetX) < 0.001) {
      this.position.x = targetX;
      this.currentLane = this.targetLane;
    }
  }

  public setTrackPose(height: number, bank: number, pitch: number): void {
    this.trackHeight = height;
    this.trackBank = bank;
    this.trackPitch = pitch;
  }

  public getZ(): number {
    return this.position.z;
  }
}
