import { TRACK_SPEED } from "../core/Config";
import * as THREE from "three";
import { Player } from "../entities/Player";
import { Track } from "../world/Track";
import { NoteSpawner } from "../world/NoteSpawner";

export class MovementSystem {
  private readonly ridePoint = new THREE.Vector3();
  private readonly rideQuaternion = new THREE.Quaternion();
  public constructor(
    private readonly player: Player,
    private readonly track: Track,
    private readonly noteSpawner: NoteSpawner
  ) {}

  public update(deltaTime: number): void {
    this.track.update(deltaTime);
    this.track.sampleRiderLanePoint(this.player.getZ(), this.player.getLaneOffsetX(), 0.5, this.ridePoint);
    this.track.sampleRiderLaneQuaternion(this.player.getZ(), 0, this.rideQuaternion);
    this.player.setRideTarget(this.ridePoint.x, this.ridePoint.y, this.ridePoint.z);
    this.player.setTrackQuaternion(this.rideQuaternion);
    this.player.update();
    this.noteSpawner.updateActiveNotes(deltaTime, TRACK_SPEED);
  }
}
