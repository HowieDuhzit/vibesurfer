import * as THREE from "three";
import { LANE_WIDTH } from "../core/Config";
import { Entity } from "./Entity";

const laneX = [-LANE_WIDTH, 0, LANE_WIDTH];

export class Player extends Entity {
  public currentLane = 1;
  public targetLane = 1;
  public readonly position: THREE.Vector3;
  private logicalLaneX = 0;
  private readonly logicalTrackZ = 0;
  private readonly rideTarget = new THREE.Vector3(0, 0.5, 0);
  private readonly targetQuaternion = new THREE.Quaternion();
  private readonly tempLeanQuaternion = new THREE.Quaternion();
  private readonly tempForward = new THREE.Vector3(0, 0, -1);

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
    this.mesh.quaternion.slerp(this.targetQuaternion, 0.18);

    if (Math.abs(this.logicalLaneX - targetX) < 0.001) {
      this.logicalLaneX = targetX;
      this.currentLane = this.targetLane;
    }
  }

  public setRideTarget(x: number, y: number, z: number): void {
    this.rideTarget.set(x, y, z);
  }

  public setTrackQuaternion(quaternion: THREE.Quaternion): void {
    this.targetQuaternion.copy(quaternion);

    const targetX = laneX[this.targetLane] ?? 0;
    const laneDelta = THREE.MathUtils.clamp(targetX - this.logicalLaneX, -LANE_WIDTH, LANE_WIDTH);
    const lean = THREE.MathUtils.clamp(laneDelta / Math.max(0.001, LANE_WIDTH), -1, 1) * 0.12;
    this.tempLeanQuaternion.setFromAxisAngle(this.tempForward, -lean);
    this.targetQuaternion.multiply(this.tempLeanQuaternion);
  }

  public getLaneOffsetX(): number {
    return this.logicalLaneX;
  }

  public getZ(): number {
    return this.logicalTrackZ;
  }
}
