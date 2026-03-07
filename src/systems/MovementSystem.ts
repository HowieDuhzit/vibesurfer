import * as THREE from "three";
import { TRACK_SPEED } from "../core/Config";
import { Player } from "../entities/Player";
import { Track } from "../world/Track";
import { NoteSpawner } from "../world/NoteSpawner";

export class MovementSystem {
  private readonly ridePoint = new THREE.Vector3();
  public constructor(
    private readonly player: Player,
    private readonly track: Track,
    private readonly noteSpawner: NoteSpawner
  ) {}

  public update(deltaTime: number): void {
    this.track.update(deltaTime);
    this.track.sampleLanePoint(this.player.getZ(), this.player.getLaneOffsetX(), 0.5, this.ridePoint);
    this.player.setRideTarget(this.ridePoint.x, this.ridePoint.y, this.ridePoint.z);
    const pose = this.track.getRiderPose();
    this.player.setTrackPose(pose.height, pose.bank, pose.pitch);
    this.player.update();
    this.noteSpawner.updateActiveNotes(deltaTime, TRACK_SPEED);
  }
}
