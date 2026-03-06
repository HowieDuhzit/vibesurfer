import * as THREE from "three";

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

export class ParticleSystem {
  private readonly maxParticles = 512;
  private readonly particles: Particle[] = [];
  private readonly activeIndices: number[] = [];
  private readonly freeIndices: number[] = [];

  private readonly mesh: THREE.InstancedMesh;
  private readonly emptyMatrix = new THREE.Matrix4().makeTranslation(0, -1000, 0);
  private readonly dummy = new THREE.Object3D();

  private rngState = 987654321;

  public constructor(scene: THREE.Scene) {
    const geometry = new THREE.SphereGeometry(0.09, 6, 6);
    const material = new THREE.MeshStandardMaterial({
      color: 0xfde68a,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.2,
      metalness: 0.1,
      roughness: 0.35
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, this.maxParticles);
    this.mesh.frustumCulled = false;

    for (let i = 0; i < this.maxParticles; i += 1) {
      this.particles.push({ x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0 });
      this.freeIndices.push(i);
      this.mesh.setMatrixAt(i, this.emptyMatrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  public emitBurst(x: number, y: number, z: number, lane: number): void {
    const count = 14;
    const lateralBias = lane - 1;

    for (let i = 0; i < count; i += 1) {
      const index = this.freeIndices.pop();
      if (index === undefined) {
        break;
      }

      const p = this.particles[index];
      const angle = this.rand() * Math.PI * 2;
      const speed = 2.8 + this.rand() * 4.0;

      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(angle) * speed + lateralBias * 0.7;
      p.vy = 2.0 + this.rand() * 3.5;
      p.vz = (this.rand() - 0.5) * 3.0;
      p.maxLife = 0.28 + this.rand() * 0.25;
      p.life = p.maxLife;

      this.activeIndices.push(index);
      this.writeMatrix(index, 1);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  public update(deltaTime: number): void {
    const gravity = 9.5;

    for (let i = this.activeIndices.length - 1; i >= 0; i -= 1) {
      const index = this.activeIndices[i];
      const p = this.particles[index];

      p.life -= deltaTime;
      if (p.life <= 0) {
        this.mesh.setMatrixAt(index, this.emptyMatrix);
        this.activeIndices[i] = this.activeIndices[this.activeIndices.length - 1];
        this.activeIndices.pop();
        this.freeIndices.push(index);
        continue;
      }

      p.vy -= gravity * deltaTime;
      p.x += p.vx * deltaTime;
      p.y += p.vy * deltaTime;
      p.z += p.vz * deltaTime;

      const lifeT = p.life / p.maxLife;
      this.writeMatrix(index, Math.max(0.2, lifeT));
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private writeMatrix(index: number, scale: number): void {
    const p = this.particles[index];
    this.dummy.position.set(p.x, p.y, p.z);
    this.dummy.scale.setScalar(scale);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
  }

  private rand(): number {
    this.rngState = (1664525 * this.rngState + 1013904223) >>> 0;
    return this.rngState / 4294967295;
  }
}
