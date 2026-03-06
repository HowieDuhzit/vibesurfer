import * as THREE from "three";
import { LANE_WIDTH, LANES, SEGMENT_COUNT, SEGMENT_LENGTH, TRACK_SPEED } from "../core/Config";
import { TrackSegment } from "./TrackSegment";

export class Track {
  public readonly group = new THREE.Group();
  public readonly segments: TrackSegment[] = [];

  private readonly totalLength = SEGMENT_LENGTH * SEGMENT_COUNT;
  private readonly segmentMaterial: THREE.MeshStandardMaterial;
  private readonly lineMaterial: THREE.MeshStandardMaterial;
  private readonly tempColor = new THREE.Color();

  public constructor() {
    const width = LANE_WIDTH * (LANES + 1);
    const segmentGeometry = new THREE.PlaneGeometry(width, SEGMENT_LENGTH);
    this.segmentMaterial = new THREE.MeshStandardMaterial({
      color: 0x111827,
      metalness: 0.2,
      roughness: 0.9,
      emissive: 0x0a0f1f,
      emissiveIntensity: 0.35
    });

    for (let i = 0; i < SEGMENT_COUNT; i += 1) {
      const segmentMesh = new THREE.Mesh(segmentGeometry, this.segmentMaterial);
      segmentMesh.rotation.x = -Math.PI * 0.5;
      segmentMesh.receiveShadow = true;
      const z = -i * SEGMENT_LENGTH;

      const segment = new TrackSegment(segmentMesh, z);
      this.segments.push(segment);
      this.group.add(segment.mesh);
    }

    const lineGeometry = new THREE.BoxGeometry(0.06, 0.05, this.totalLength);
    this.lineMaterial = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.5,
      metalness: 0.2,
      roughness: 0.4
    });

    for (let i = 0; i <= LANES; i += 1) {
      const offset = (i - LANES / 2) * LANE_WIDTH;
      const line = new THREE.Mesh(lineGeometry, this.lineMaterial);
      line.position.set(offset, 0.03, -this.totalLength * 0.5);
      this.group.add(line);
    }
  }

  public update(deltaTime: number): void {
    const step = TRACK_SPEED * deltaTime;

    for (let i = 0; i < this.segments.length; i += 1) {
      const segment = this.segments[i];
      segment.zPosition += step;

      if (segment.zPosition > SEGMENT_LENGTH) {
        segment.zPosition -= this.totalLength;
      }

      segment.mesh.position.z = segment.zPosition;
    }
  }

  public setMusicReactiveColor(energy: number, bass: number, treble: number): void {
    const lineHue = 0.58 - treble * 0.2;
    this.tempColor.setHSL(lineHue, 0.85, 0.5 + energy * 0.15);
    this.lineMaterial.color.copy(this.tempColor);
    this.lineMaterial.emissive.copy(this.tempColor);
    this.lineMaterial.emissiveIntensity = 0.5 + energy * 1.4;

    this.tempColor.setHSL(0.6 - bass * 0.08, 0.45, 0.12 + bass * 0.12);
    this.segmentMaterial.color.copy(this.tempColor);
    this.segmentMaterial.emissive.copy(this.tempColor);
    this.segmentMaterial.emissiveIntensity = 0.2 + bass * 0.5;
  }
}
