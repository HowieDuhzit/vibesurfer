import * as THREE from "three";

export class TrackSegment {
  public zPosition: number;
  public readonly laneLines: THREE.Mesh[];
  public readonly rails: THREE.Mesh[];
  public readonly glows: THREE.Mesh[];

  public constructor(
    public readonly mesh: THREE.Object3D,
    zPosition: number,
    laneLines: THREE.Mesh[] = [],
    rails: THREE.Mesh[] = [],
    glows: THREE.Mesh[] = []
  ) {
    this.zPosition = zPosition;
    this.mesh.position.z = zPosition;
    this.laneLines = laneLines;
    this.rails = rails;
    this.glows = glows;
  }
}
