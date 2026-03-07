import * as THREE from "three";
import { HIT_LINE_Z_OFFSET, LANE_WIDTH, LANES } from "../core/Config";
import { Track } from "../world/Track";

export class FrequencySideRailsEffect {
  private readonly barsPerSide = 48;
  private readonly totalBars = this.barsPerSide * 2;
  private readonly leftMesh: THREE.InstancedMesh;
  private readonly rightMesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly worldPos = new THREE.Vector3();
  private readonly worldQuat = new THREE.Quaternion();
  private scroll = 0;
  private intensityScale = 1;
  private qualityScale = 1;

  public constructor(scene: THREE.Scene, private readonly track: Track) {
    const geometry = new THREE.BoxGeometry(0.14, 1, 0.22);
    const material = new THREE.MeshStandardMaterial({
      color: 0x60a5fa,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.1,
      metalness: 0.22,
      roughness: 0.36
    });

    this.leftMesh = new THREE.InstancedMesh(geometry, material, this.barsPerSide);
    this.rightMesh = new THREE.InstancedMesh(geometry, material, this.barsPerSide);
    this.leftMesh.frustumCulled = false;
    this.rightMesh.frustumCulled = false;
    this.leftMesh.renderOrder = 1;
    this.rightMesh.renderOrder = 1;

    scene.add(this.leftMesh);
    scene.add(this.rightMesh);
  }

  public update(
    deltaTime: number,
    energy: number,
    bass: number,
    treble: number,
    frequencyData?: Uint8Array
  ): void {
    const bins = frequencyData?.length ?? 0;
    const clampedEnergy = Math.max(0, Math.min(1, energy));
    const clampedBass = Math.max(0, Math.min(1, bass));
    const clampedTreble = Math.max(0, Math.min(1, treble));

    this.scroll += deltaTime * (12 + clampedEnergy * 26);
    const hue = 0.57 - clampedTreble * 0.2 + clampedBass * 0.05;
    this.color.setHSL(hue, 0.9, 0.5 + clampedEnergy * 0.18);

    const spanZ = 118;
    const stepZ = spanZ / this.barsPerSide;
    const sideOffsetX = (LANE_WIDTH * (LANES + 1)) * 0.5 + 1.9;

    const stride = this.qualityScale >= 0.95 ? 1 : this.qualityScale >= 0.6 ? 2 : 3;
    for (let i = 0; i < this.barsPerSide; i += 1) {
      const z = HIT_LINE_Z_OFFSET - 6 - i * stepZ;
      const bin = bins > 0 ? Math.min(bins - 1, Math.floor(((i + this.scroll) % this.barsPerSide) * (bins / this.barsPerSide))) : 0;
      const amp = bins > 0 ? (frequencyData as Uint8Array)[bin] / 255 : 0;
      const h = 0.22 + amp * (6.2 + clampedBass * 2.4) * this.intensityScale;
      if (i % stride !== 0) {
        this.dummy.position.set(-sideOffsetX, -1000, z);
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.leftMesh.setMatrixAt(i, this.dummy.matrix);
        this.dummy.position.set(sideOffsetX, -1000, z);
        this.dummy.updateMatrix();
        this.rightMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      this.track.sampleLanePoint(z, -sideOffsetX, h * 0.5, this.worldPos);
      this.track.sampleLaneQuaternion(z, 0, this.worldQuat);
      this.dummy.position.copy(this.worldPos);
      this.dummy.quaternion.copy(this.worldQuat);
      this.dummy.scale.set(1, h, 1);
      this.dummy.updateMatrix();
      this.leftMesh.setMatrixAt(i, this.dummy.matrix);

      this.track.sampleLanePoint(z, sideOffsetX, h * 0.5, this.worldPos);
      this.track.sampleLaneQuaternion(z, 0, this.worldQuat);
      this.dummy.position.copy(this.worldPos);
      this.dummy.quaternion.copy(this.worldQuat);
      this.dummy.updateMatrix();
      this.rightMesh.setMatrixAt(i, this.dummy.matrix);
    }

    this.leftMesh.instanceMatrix.needsUpdate = true;
    this.rightMesh.instanceMatrix.needsUpdate = true;

    const material = this.leftMesh.material as THREE.MeshStandardMaterial;
    material.color.copy(this.color);
    material.emissive.copy(this.color);
    material.emissiveIntensity = (0.85 + clampedEnergy * 1.6) * this.intensityScale;
  }

  public setIntensity(scale: number): void {
    this.intensityScale = Math.max(0.3, Math.min(2, scale));
  }

  public setQualityScale(scale: number): void {
    this.qualityScale = Math.max(0.25, Math.min(1, scale));
  }
}
