import * as THREE from "three";
import { LANE_WIDTH } from "../core/Config";
import { Entity } from "./Entity";

const laneX = [-LANE_WIDTH, 0, LANE_WIDTH];

export class Player extends Entity {
  public currentLane = 1;
  public targetLane = 1;
  public readonly position: THREE.Vector3;
  private logicalLaneX = 0;
  private trackHeight = 0;
  private trackBank = 0;
  private trackPitch = 0;
  private readonly logicalTrackZ = 0;
  private readonly rideTarget = new THREE.Vector3(0, 0.5, 0);

  public constructor(mesh: THREE.Object3D) {
    super(mesh);
    this.position = mesh.position;
    this.position.set(0, 0.5, this.logicalTrackZ);
  }

  public setTargetLane(lane: number): void {
    this.targetLane = lane;
  }

  public update(): void {
    const targetX = laneX[this.targetLane] ?? 0;
    this.logicalLaneX += (targetX - this.logicalLaneX) * 0.2;

    this.position.x += (this.rideTarget.x - this.position.x) * 0.32;
    this.position.y += (this.rideTarget.y - this.position.y) * 0.28;
    this.position.z += (this.rideTarget.z - this.position.z) * 0.3;
    this.mesh.rotation.z += (this.trackBank * 0.78 - this.mesh.rotation.z) * 0.18;
    this.mesh.rotation.x += (this.trackPitch * 0.48 - this.mesh.rotation.x) * 0.16;

    if (Math.abs(this.logicalLaneX - targetX) < 0.001) {
      this.logicalLaneX = targetX;
      this.currentLane = this.targetLane;
    }
  }

  public setRideTarget(x: number, y: number, z: number): void {
    this.rideTarget.set(x, y, z);
  }

  public setTrackPose(height: number, bank: number, pitch: number): void {
    this.trackHeight = height;
    this.trackBank = bank;
    this.trackPitch = pitch;
  }

  public getLaneOffsetX(): number {
    return this.logicalLaneX;
  }

  public getZ(): number {
    return this.logicalTrackZ;
  }
}
