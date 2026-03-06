import * as THREE from "three";

export class MusicVisualizerBackground {
  private readonly starsGeometry = new THREE.BufferGeometry();
  private readonly starsMaterial = new THREE.PointsMaterial({
    size: 0.85,
    sizeAttenuation: true,
    color: 0x60a5fa,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  private readonly starPositions: Float32Array;
  private readonly starSpeeds: Float32Array;
  private readonly tempColor = new THREE.Color();
  private intensityScale = 1;
  private qualityScale = 1;

  public constructor(scene: THREE.Scene) {
    const count = 1700;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const base = i * 3;
      positions[base] = (Math.random() - 0.5) * 220;
      positions[base + 1] = (Math.random() - 0.5) * 130 + 22;
      positions[base + 2] = -Math.random() * 260 - 20;
      speeds[i] = 0.4 + Math.random() * 2.2;
    }

    this.starsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.starsGeometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));

    this.starPositions = positions;
    this.starSpeeds = speeds;

    const points = new THREE.Points(this.starsGeometry, this.starsMaterial);
    points.frustumCulled = false;
    scene.add(points);
  }

  public randomizeStyle(): void {
    // Starfield-only visualizer: retained for interface compatibility.
  }

  public update(
    deltaTime: number,
    energy: number,
    bass: number,
    treble: number,
    frequencyData?: Uint8Array
  ): void {
    const e = Math.max(0, Math.min(1, energy));
    const b = Math.max(0, Math.min(1, bass));
    const t = Math.max(0, Math.min(1, treble));
    const bins = frequencyData?.length ?? 0;

    const stride = this.qualityScale >= 0.95 ? 1 : this.qualityScale >= 0.6 ? 2 : 3;
    for (let i = 0; i < this.starSpeeds.length; i += stride) {
      const base = i * 3;
      const xNorm = (this.starPositions[base] + 110) / 220;
      const bin = bins > 0 ? Math.max(0, Math.min(bins - 1, Math.floor(xNorm * bins))) : 0;
      const amp = bins > 0 ? (frequencyData as Uint8Array)[bin] / 255 : 0;

      const speed = this.starSpeeds[i] * (0.2 + amp * (3.5 + b * 2.5)) * this.intensityScale;
      this.starPositions[base + 2] += speed * deltaTime * 18;
      this.starPositions[base] += (amp - 0.5) * deltaTime * 0.8;

      if (this.starPositions[base + 2] > 18) {
        this.starPositions[base + 2] = -260;
        this.starPositions[base] = (Math.random() - 0.5) * 220;
        this.starPositions[base + 1] = (Math.random() - 0.5) * 130 + 22;
      }
    }

    const positionAttr = this.starsGeometry.getAttribute("position") as THREE.BufferAttribute;
    positionAttr.needsUpdate = true;

    this.tempColor.setHSL(0.6 - t * 0.25 + b * 0.06, 0.9, 0.56 + e * 0.22);
    this.starsMaterial.color.copy(this.tempColor);
    this.starsMaterial.opacity = (0.5 + e * 0.4) * Math.max(0.45, this.intensityScale);
    this.starsMaterial.size = (0.5 + e * 1.6) * Math.max(0.45, this.intensityScale);
  }

  public setIntensity(scale: number): void {
    this.intensityScale = Math.max(0.3, Math.min(2, scale));
  }

  public setQualityScale(scale: number): void {
    this.qualityScale = Math.max(0.25, Math.min(1, scale));
  }
}
