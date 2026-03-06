import * as THREE from "three";
import { HIT_LINE_Z_OFFSET, LANE_WIDTH, LANES } from "../core/Config";

export class HitLineEffect {
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly color = new THREE.Color();

  public constructor(scene: THREE.Scene) {
    const geometry = new THREE.BoxGeometry(LANE_WIDTH * (LANES + 1), 0.03, 0.36);
    this.material = new THREE.MeshStandardMaterial({
      color: 0xbfdbfe,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.2,
      metalness: 0.12,
      roughness: 0.45
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.set(0, 0.08, HIT_LINE_Z_OFFSET);
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  public update(energy: number, bass: number, treble: number): void {
    this.color.setHSL(0.58 - treble * 0.2 + bass * 0.06, 0.95, 0.6 + energy * 0.2);
    this.material.color.copy(this.color);
    this.material.emissive.copy(this.color);
    this.material.emissiveIntensity = 0.9 + energy * 2.2;

    const pulse = 1 + bass * 0.35;
    this.mesh.scale.set(1, 1, pulse);
  }
}
