import * as THREE from "three";
import { HIT_LINE_Z_OFFSET, LANE_WIDTH, LANES } from "../core/Config";
import { Track } from "../world/Track";

export class HitLineEffect {
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly widthSegments = 20;
  private readonly stripRows = 2;
  private readonly color = new THREE.Color();
  private readonly missColor = new THREE.Color(0xf43f5e);
  private readonly worldPos = new THREE.Vector3();
  private readonly leftPos = new THREE.Vector3();
  private readonly rightPos = new THREE.Vector3();
  private hitBoost = 0;
  private missCrack = 0;

  public constructor(scene: THREE.Scene, private readonly track: Track) {
    const verticesAcross = this.widthSegments + 1;
    const vertexCount = verticesAcross * this.stripRows;
    this.positions = new Float32Array(vertexCount * 3);
    const indices: number[] = [];
    for (let x = 0; x < this.widthSegments; x += 1) {
      const a = x;
      const b = x + 1;
      const c = x + verticesAcross;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setIndex(indices);
    this.geometry.computeVertexNormals();

    this.material = new THREE.MeshPhysicalMaterial({
      color: 0xbfdbfe,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.2,
      metalness: 0.32,
      roughness: 0.18,
      clearcoat: 0.7,
      clearcoatRoughness: 0.1
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  public update(energy: number, bass: number, treble: number): void {
    this.hitBoost += (0 - this.hitBoost) * 0.12;
    this.missCrack += (0 - this.missCrack) * 0.1;

    this.color.setHSL(0.58 - treble * 0.2 + bass * 0.06, 0.95, 0.6 + energy * 0.2);
    if (this.missCrack > 0.02) {
      this.color.lerp(this.missColor, Math.min(0.8, this.missCrack));
    }
    this.material.color.copy(this.color);
    this.material.emissive.copy(this.color);
    this.material.emissiveIntensity = 0.9 + energy * 2.2 + this.hitBoost * 2.2;

    const pulse = 1 + bass * 0.35 + this.hitBoost * 0.16 + this.missCrack * 0.08;
    const halfWidth = (LANE_WIDTH * (LANES + 1)) * 0.5;
    const verticesAcross = this.widthSegments + 1;
    const nearZ = HIT_LINE_Z_OFFSET + 0.14 * pulse;
    const farZ = HIT_LINE_Z_OFFSET - 0.18 * pulse;

    for (let x = 0; x <= this.widthSegments; x += 1) {
      const t = x / this.widthSegments;
      const laneOffset = -halfWidth + t * (halfWidth * 2);

      this.track.sampleLanePoint(nearZ, laneOffset, 0.09, this.leftPos);
      this.track.sampleLanePoint(farZ, laneOffset, 0.09, this.rightPos);

      let ptr = x * 3;
      this.positions[ptr] = this.leftPos.x;
      this.positions[ptr + 1] = this.leftPos.y;
      this.positions[ptr + 2] = this.leftPos.z;

      ptr = (x + verticesAcross) * 3;
      this.positions[ptr] = this.rightPos.x;
      this.positions[ptr + 1] = this.rightPos.y;
      this.positions[ptr + 2] = this.rightPos.z;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  public triggerHit(strength = 1): void {
    this.hitBoost = Math.max(this.hitBoost, Math.max(0.1, Math.min(1, strength)));
  }

  public triggerMiss(): void {
    this.missCrack = 1;
  }
}
