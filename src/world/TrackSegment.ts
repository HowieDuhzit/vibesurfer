import * as THREE from "three";

export class TrackSegment {
  public zPosition: number;

  public constructor(public readonly mesh: THREE.Mesh, zPosition: number) {
    this.zPosition = zPosition;
    this.mesh.position.z = zPosition;
  }
}
