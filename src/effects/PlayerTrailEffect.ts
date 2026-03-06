import * as THREE from "three";
import { TRACK_SPEED } from "../core/Config";

interface Ghost {
  x: number;
  z: number;
  life: number;
  maxLife: number;
}

export class PlayerTrailEffect {
  private readonly maxGhosts = 120;
  private readonly ghosts: Ghost[] = [];
  private readonly activeIndices: number[] = [];
  private readonly freeIndices: number[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly emptyMatrix = new THREE.Matrix4().makeTranslation(0, -1000, 0);
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private spawnAccumulator = 0;
  private intensityScale = 1;
  private qualityScale = 1;

  public constructor(scene: THREE.Scene) {
    const geometry = new THREE.PlaneGeometry(1.1, 0.72);
    const material = new THREE.MeshStandardMaterial({
      color: 0x60a5fa,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, this.maxGhosts);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;

    for (let i = 0; i < this.maxGhosts; i += 1) {
      this.ghosts.push({ x: 0, z: -1000, life: 0, maxLife: 0 });
      this.freeIndices.push(i);
      this.mesh.setMatrixAt(i, this.emptyMatrix);
      this.mesh.setColorAt(i, new THREE.Color(0x60a5fa));
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
    scene.add(this.mesh);
  }

  public update(deltaTime: number, playerX: number, energy: number, bass: number, fever: number): void {
    this.spawnAccumulator += deltaTime;
    const spawnInterval = Math.max(
      0.015,
      (0.038 - energy * 0.018 - fever * 0.008) / Math.max(0.3, this.intensityScale * this.qualityScale)
    );

    while (this.spawnAccumulator >= spawnInterval) {
      this.spawnAccumulator -= spawnInterval;
      const idx = this.freeIndices.pop();
      if (idx === undefined) {
        break;
      }

      const life = 0.16 + energy * 0.22 + fever * 0.12;
      const ghost = this.ghosts[idx];
      ghost.x = playerX;
      ghost.z = 0.45;
      ghost.life = life;
      ghost.maxLife = life;
      this.activeIndices.push(idx);
    }

    for (let i = this.activeIndices.length - 1; i >= 0; i -= 1) {
      const idx = this.activeIndices[i];
      const g = this.ghosts[idx];
      g.life -= deltaTime;
      g.z += TRACK_SPEED * deltaTime;

      if (g.life <= 0 || g.z > 8) {
        this.mesh.setMatrixAt(idx, this.emptyMatrix);
        this.activeIndices[i] = this.activeIndices[this.activeIndices.length - 1];
        this.activeIndices.pop();
        this.freeIndices.push(idx);
        continue;
      }

      const t = g.life / g.maxLife;
      this.color.setHSL(0.58 - bass * 0.1 + fever * 0.03, 0.88, 0.42 + t * 0.24);
      this.mesh.setColorAt(idx, this.color);

      this.dummy.position.set(g.x, 0.5, g.z);
      this.dummy.rotation.set(0, Math.PI, 0);
      this.dummy.scale.setScalar(Math.max(0.22, t * (0.95 + fever * 0.25)));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(idx, this.dummy.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }

    const material = this.mesh.material as THREE.MeshStandardMaterial;
    material.opacity = (0.3 + energy * 0.25 + fever * 0.2) * Math.max(0.45, this.intensityScale);
    material.emissiveIntensity = (0.4 + energy * 0.7 + fever * 1.1) * Math.max(0.45, this.intensityScale);
  }

  public setIntensity(scale: number): void {
    this.intensityScale = Math.max(0.3, Math.min(2, scale));
  }

  public setQualityScale(scale: number): void {
    this.qualityScale = Math.max(0.25, Math.min(1, scale));
  }
}
