import * as THREE from "three";
import { LANE_WIDTH, LANES, SEGMENT_COUNT, SEGMENT_LENGTH, TRACK_SPEED } from "../core/Config";
import { TrackSegment } from "./TrackSegment";

export class Track {
  public readonly group = new THREE.Group();
  public readonly segments: TrackSegment[] = [];

  private readonly totalLength = SEGMENT_LENGTH * SEGMENT_COUNT;
  private readonly segmentMaterial: THREE.MeshPhysicalMaterial;
  private readonly lineMaterial: THREE.MeshPhysicalMaterial;
  private readonly sideMaterial: THREE.MeshPhysicalMaterial;
  private readonly railMaterial: THREE.MeshPhysicalMaterial;
  private readonly edgeGlowMaterial: THREE.MeshPhysicalMaterial;
  private readonly tempColor = new THREE.Color();

  private readonly rails: THREE.Mesh[] = [];
  private readonly edgeGlows: THREE.Mesh[] = [];
  private targetLift = 0;
  private targetBank = 0;
  private targetForwardLean = 0;
  private lift = 0;
  private bank = 0;
  private forwardLean = 0;

  public constructor() {
    const width = LANE_WIDTH * (LANES + 1);
    const roadTexture = this.makeRoadTexture();

    const segmentGeometry = new THREE.PlaneGeometry(width, SEGMENT_LENGTH);
    this.segmentMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x0b1228,
      roughness: 0.5,
      metalness: 0.58,
      clearcoat: 0.42,
      clearcoatRoughness: 0.24,
      emissive: 0x040915,
      emissiveIntensity: 0.2,
      map: roadTexture
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

    const lineGeometry = new THREE.BoxGeometry(0.08, 0.06, this.totalLength);
    this.lineMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.7,
      metalness: 0.2,
      roughness: 0.3,
      clearcoat: 0.3,
      clearcoatRoughness: 0.2
    });

    for (let i = 0; i <= LANES; i += 1) {
      const offset = (i - LANES / 2) * LANE_WIDTH;
      const line = new THREE.Mesh(lineGeometry, this.lineMaterial);
      line.position.set(offset, 0.03, -this.totalLength * 0.5);
      line.castShadow = true;
      this.group.add(line);
    }

    this.sideMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x111827,
      emissive: 0x0f172a,
      emissiveIntensity: 0.2,
      roughness: 0.72,
      metalness: 0.18,
      clearcoat: 0.14,
      clearcoatRoughness: 0.52
    });

    this.railMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x7dd3fc,
      emissive: 0x0284c7,
      emissiveIntensity: 0.9,
      roughness: 0.28,
      metalness: 0.62,
      clearcoat: 0.65,
      clearcoatRoughness: 0.14
    });

    this.edgeGlowMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.2,
      roughness: 0.25,
      metalness: 0.35,
      transparent: true,
      opacity: 0.8
    });

    const shoulderWidth = 1.65;
    const sideHeight = 0.24;
    const sideGeometry = new THREE.BoxGeometry(shoulderWidth, sideHeight, this.totalLength);
    const sideRailGeometry = new THREE.CylinderGeometry(0.06, 0.06, this.totalLength, 10);
    const sideGlowGeometry = new THREE.BoxGeometry(0.02, 0.13, this.totalLength);

    const halfTrack = width * 0.5;
    for (let i = -1; i <= 1; i += 2) {
      const side = new THREE.Mesh(sideGeometry, this.sideMaterial);
      side.position.set(i * (halfTrack + shoulderWidth * 0.48), sideHeight * 0.5 - 0.02, -this.totalLength * 0.5);
      side.receiveShadow = true;
      side.castShadow = true;
      this.group.add(side);

      const rail = new THREE.Mesh(sideRailGeometry, this.railMaterial);
      rail.rotation.x = Math.PI * 0.5;
      rail.position.set(i * (halfTrack + 0.68), 0.28, -this.totalLength * 0.5);
      rail.castShadow = true;
      this.group.add(rail);
      this.rails.push(rail);

      const glow = new THREE.Mesh(sideGlowGeometry, this.edgeGlowMaterial);
      glow.position.set(i * (halfTrack + 0.04), 0.1, -this.totalLength * 0.5);
      glow.renderOrder = 2;
      this.group.add(glow);
      this.edgeGlows.push(glow);
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

    const smoothing = Math.min(1, deltaTime * 4.6);
    this.lift += (this.targetLift - this.lift) * smoothing;
    this.bank += (this.targetBank - this.bank) * smoothing;
    this.forwardLean += (this.targetForwardLean - this.forwardLean) * smoothing;

    this.group.position.y = this.lift;
    this.group.rotation.z = this.bank;
    this.group.rotation.x = this.forwardLean;
  }

  public setControlProfile(elevation: number, curvature: number, pace: number, feature: number): void {
    const e = Math.max(0, Math.min(1, elevation));
    const c = Math.max(-1, Math.min(1, curvature));
    const p = Math.max(0, Math.min(1, pace));
    const f = Math.max(0, Math.min(1, feature));

    this.targetLift = e * 0.36 + f * 0.1;
    this.targetBank = c * (0.06 + p * 0.07);
    this.targetForwardLean = -0.01 - p * 0.025;
  }

  public setMusicReactiveColor(energy: number, bass: number, treble: number, fever = 0): void {
    const lineHue = 0.58 - treble * 0.2 + fever * 0.06;
    this.tempColor.setHSL(lineHue, 0.85, 0.5 + energy * 0.15);
    this.lineMaterial.color.copy(this.tempColor);
    this.lineMaterial.emissive.copy(this.tempColor);
    this.lineMaterial.emissiveIntensity = 0.5 + energy * 1.6 + fever * 2.4;

    this.tempColor.setHSL(0.61 - bass * 0.08 + fever * 0.03, 0.5 + fever * 0.24, 0.1 + bass * 0.12);
    this.segmentMaterial.color.copy(this.tempColor);
    this.segmentMaterial.emissive.copy(this.tempColor);
    this.segmentMaterial.emissiveIntensity = 0.14 + bass * 0.6 + fever * 0.95;

    this.tempColor.setHSL(0.56 - treble * 0.16, 0.78, 0.48 + energy * 0.22);
    this.railMaterial.color.copy(this.tempColor);
    this.railMaterial.emissive.copy(this.tempColor);
    this.railMaterial.emissiveIntensity = 0.55 + energy * 1.5;

    this.tempColor.setHSL(0.55 - treble * 0.15 + fever * 0.05, 0.88, 0.44 + energy * 0.2);
    this.edgeGlowMaterial.color.copy(this.tempColor);
    this.edgeGlowMaterial.emissive.copy(this.tempColor);
    this.edgeGlowMaterial.emissiveIntensity = 0.8 + energy * 2.4 + fever * 2.1;
    this.edgeGlowMaterial.opacity = 0.45 + energy * 0.45;
  }

  private makeRoadTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return new THREE.CanvasTexture(canvas);
    }

    ctx.fillStyle = "#0b1228";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "rgba(125,211,252,0.08)");
    grad.addColorStop(1, "rgba(15,23,42,0.12)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(148,163,184,0.16)";
    ctx.lineWidth = 2;
    for (let y = 0; y < canvas.height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y + 12);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(56,189,248,0.12)";
    ctx.lineWidth = 1;
    for (let y = 0; y < canvas.height; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, SEGMENT_COUNT * 0.65);
    tex.anisotropy = 8;
    return tex;
  }
}
