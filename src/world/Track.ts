import * as THREE from "three";
import { LANE_WIDTH, LANES, SEGMENT_COUNT } from "../core/Config";
import { TrackSegment } from "./TrackSegment";

interface WarpSurface {
  mesh: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  positions: Float32Array;
  centerOffset: number;
  yOffset: number;
  width: number;
  widthSegments: number;
  longSegments: number;
  updateNormals: boolean;
}

export class Track {
  public readonly group = new THREE.Group();
  public readonly segments: TrackSegment[] = [];

  private readonly totalLength = 220;
  private readonly trackWidth = LANE_WIDTH * (LANES + 1);
  private readonly longSegments = SEGMENT_COUNT * 8;
  private readonly centerlineCurve: THREE.CatmullRomCurve3;
  private readonly centerlinePoints: THREE.Vector3[];

  private readonly segmentMaterial: THREE.MeshPhysicalMaterial;
  private readonly sideMaterial: THREE.MeshPhysicalMaterial;
  private readonly lineMaterial: THREE.MeshBasicMaterial;
  private readonly edgeGlowMaterial: THREE.MeshBasicMaterial;
  private readonly tempColor = new THREE.Color();

  private readonly surfaces: WarpSurface[] = [];

  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly forwardAxis = new THREE.Vector3(0, 0, -1);
  private readonly tempCenter = new THREE.Vector3();
  private readonly tempTangent = new THREE.Vector3();
  private readonly tempRight = new THREE.Vector3();
  private readonly tempUp = new THREE.Vector3();
  private readonly tempQuat = new THREE.Quaternion();
  private readonly tempRollQuat = new THREE.Quaternion();

  private targetLift = 0;
  private targetBank = 0;
  private targetForwardLean = 0;
  private targetCurve = 0;
  private targetPace = 0;

  private lift = 0;
  private bank = 0;
  private forwardLean = 0;
  private curve = 0;
  private pace = 0;
  private waveTime = 0;

  private riderHeight = 0;
  private riderBank = 0;
  private riderPitch = 0;

  public constructor() {
    this.centerlinePoints = new Array(20);
    for (let i = 0; i < this.centerlinePoints.length; i += 1) {
      const u = i / (this.centerlinePoints.length - 1);
      this.centerlinePoints[i] = new THREE.Vector3(0, 0, -u * this.totalLength);
    }
    this.centerlineCurve = new THREE.CatmullRomCurve3(this.centerlinePoints, false, "centripetal", 0.5);

    const roadTexture = this.makeRoadTexture();
    this.segmentMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x0b1228,
      roughness: 0.52,
      metalness: 0.52,
      clearcoat: 0.44,
      clearcoatRoughness: 0.22,
      emissive: 0x040915,
      emissiveIntensity: 0.24,
      map: roadTexture
    });

    this.sideMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x111827,
      emissive: 0x0f172a,
      emissiveIntensity: 0.2,
      roughness: 0.72,
      metalness: 0.2,
      clearcoat: 0.12,
      clearcoatRoughness: 0.54
    });

    this.lineMaterial = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.95
    });
    this.edgeGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.82
    });

    // One continuous warped mesh for the drivable surface.
    this.surfaces.push(this.createSurface(this.trackWidth, 0, 0, 8, this.segmentMaterial, true));

    // Side shoulders.
    const shoulderWidth = 1.65;
    const shoulderOffset = this.trackWidth * 0.5 + shoulderWidth * 0.5;
    this.surfaces.push(this.createSurface(shoulderWidth, shoulderOffset, 0.01, 2, this.sideMaterial, true));
    this.surfaces.push(this.createSurface(shoulderWidth, -shoulderOffset, 0.01, 2, this.sideMaterial, true));

    // Lane divider strips follow exact spline frame.
    for (let lane = 0; lane <= LANES; lane += 1) {
      const offset = (lane - LANES / 2) * LANE_WIDTH;
      this.surfaces.push(this.createSurface(0.09, offset, 0.05, 1, this.lineMaterial, false));
    }

    // Outer glow rails.
    const glowOffset = this.trackWidth * 0.5 + 0.08;
    this.surfaces.push(this.createSurface(0.05, glowOffset, 0.11, 1, this.edgeGlowMaterial, false));
    this.surfaces.push(this.createSurface(0.05, -glowOffset, 0.11, 1, this.edgeGlowMaterial, false));

    this.updateWarpedSurfaces();
  }

  public update(deltaTime: number): void {
    this.waveTime += deltaTime * (0.65 + this.pace * 1.1);

    const smoothing = Math.min(1, deltaTime * 4.8);
    this.lift += (this.targetLift - this.lift) * smoothing;
    this.bank += (this.targetBank - this.bank) * smoothing;
    this.forwardLean += (this.targetForwardLean - this.forwardLean) * smoothing;
    this.curve += (this.targetCurve - this.curve) * smoothing;
    this.pace += (this.targetPace - this.pace) * smoothing;

    this.refreshCenterlineSpline();
    this.updateWarpedSurfaces();

    // Rider pose at hit zone.
    this.centerlineCurve.getPointAt(0, this.tempCenter);
    this.centerlineCurve.getTangentAt(0.001, this.tempTangent);
    this.tempTangent.normalize();
    const forwardLen = Math.max(1e-6, Math.hypot(this.tempTangent.x, this.tempTangent.z));
    this.riderPitch = Math.atan2(this.tempTangent.y, forwardLen);
    this.riderBank = this.bank * 0.9 + Math.sin(this.waveTime * 1.7) * this.curve * 0.018;
    this.riderHeight = this.tempCenter.y;
  }

  public setControlProfile(elevation: number, curvature: number, pace: number, feature: number): void {
    const e = Math.max(0, Math.min(1, elevation));
    const c = Math.max(-1, Math.min(1, curvature));
    const p = Math.max(0, Math.min(1, pace));
    const f = Math.max(0, Math.min(1, feature));

    this.targetLift = e * 3.4 + f * 1.25;
    this.targetBank = c * (0.12 + p * 0.2 + f * 0.1);
    this.targetCurve = c * (2.6 + p * 2.8 + f * 1.5);
    this.targetPace = p;
    this.targetForwardLean = -0.02 - p * 0.05;
  }

  public setMusicReactiveColor(energy: number, bass: number, treble: number, fever = 0): void {
    this.tempColor.setHSL(0.58 - treble * 0.2 + fever * 0.06, 0.85, 0.5 + energy * 0.15);
    this.lineMaterial.color.copy(this.tempColor);
    this.lineMaterial.opacity = 0.65 + Math.min(0.35, energy * 0.4 + fever * 0.35);

    this.tempColor.setHSL(0.61 - bass * 0.08 + fever * 0.03, 0.5 + fever * 0.24, 0.1 + bass * 0.12);
    this.segmentMaterial.color.copy(this.tempColor);
    this.segmentMaterial.emissive.copy(this.tempColor);
    this.segmentMaterial.emissiveIntensity = 0.16 + bass * 0.62 + fever * 0.95;

    this.tempColor.setHSL(0.55 - treble * 0.15 + fever * 0.05, 0.88, 0.44 + energy * 0.2);
    this.edgeGlowMaterial.color.copy(this.tempColor);
    this.edgeGlowMaterial.opacity = 0.45 + energy * 0.45;
  }

  public getRiderPose(): Readonly<{ height: number; bank: number; pitch: number }> {
    return {
      height: this.riderHeight,
      bank: this.riderBank,
      pitch: this.riderPitch
    };
  }

  public sampleLanePoint(trackZ: number, laneOffset: number, heightOffset: number, out: THREE.Vector3): THREE.Vector3 {
    const distanceAhead = Math.max(0, Math.min(this.totalLength, -trackZ));
    const u = distanceAhead / this.totalLength;
    this.centerlineCurve.getPointAt(u, this.tempCenter);
    this.centerlineCurve.getTangentAt(Math.min(0.9999, u + 1e-4), this.tempTangent);
    this.tempTangent.normalize();

    this.tempRight.crossVectors(this.tempTangent, this.worldUp);
    if (this.tempRight.lengthSq() < 1e-8) {
      this.tempRight.set(1, 0, 0);
    } else {
      this.tempRight.normalize();
    }
    this.tempUp.crossVectors(this.tempRight, this.tempTangent).normalize();

    out.copy(this.tempCenter)
      .addScaledVector(this.tempRight, laneOffset)
      .addScaledVector(this.tempUp, heightOffset);
    return out;
  }

  public sampleLaneQuaternion(trackZ: number, roll: number, out: THREE.Quaternion): THREE.Quaternion {
    const distanceAhead = Math.max(0, Math.min(this.totalLength, -trackZ));
    const u = distanceAhead / this.totalLength;
    this.centerlineCurve.getTangentAt(Math.min(0.9999, u + 1e-4), this.tempTangent);
    this.tempTangent.normalize();
    out.setFromUnitVectors(this.forwardAxis, this.tempTangent);
    this.tempRollQuat.setFromAxisAngle(this.tempTangent, roll);
    out.multiply(this.tempRollQuat);
    return out;
  }

  private createSurface(
    width: number,
    centerOffset: number,
    yOffset: number,
    widthSegments: number,
    material: THREE.Material,
    updateNormals: boolean
  ): WarpSurface {
    const geometry = new THREE.PlaneGeometry(width, this.totalLength, Math.max(1, widthSegments), this.longSegments);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);

    const positions = geometry.attributes.position.array as Float32Array;
    return {
      mesh,
      geometry,
      positions,
      centerOffset,
      yOffset,
      width,
      widthSegments: Math.max(1, widthSegments),
      longSegments: this.longSegments,
      updateNormals
    };
  }

  private refreshCenterlineSpline(): void {
    const points = this.centerlinePoints;
    for (let i = 0; i < points.length; i += 1) {
      const u = i / (points.length - 1);
      if (i === 0) {
        points[i].set(0, 0, 0);
        continue;
      }

      const damp = 0.58 + 0.42 * this.smoothstep(0.03, 1, u);
      const laneSafeDamp = 0.55 + 0.45 * this.smoothstep(0.16, 1, u);
      const phase = (u * (1.2 + this.pace * 1.45) + this.waveTime * (0.13 + this.pace * 0.12)) * Math.PI * 2;
      const phase2 = phase * 0.72 + 0.8;

      const lateralPrimary = Math.sin(phase) * this.curve * (0.1 + laneSafeDamp * 0.95);
      const lateralSecondary = Math.sin(phase * 0.47 + 1.3) * this.curve * 0.36 * laneSafeDamp;
      const lateral = lateralPrimary + lateralSecondary;

      const baseLift = this.lift * (0.06 + laneSafeDamp * 0.94);
      const rollerA = Math.sin(phase2) * this.lift * 0.56 * damp;
      const rollerB = Math.sin(phase * 0.21 + 2.1) * this.lift * 0.34 * laneSafeDamp;
      const drop = -Math.max(0, Math.sin(phase * 0.31 - 0.7)) * this.lift * 0.2 * laneSafeDamp;
      const slope = this.forwardLean * u * this.totalLength * 0.1;
      const lift = baseLift + rollerA + rollerB + drop + slope;

      points[i].set(lateral, lift, -u * this.totalLength);
    }
  }

  private updateWarpedSurfaces(): void {
    for (let s = 0; s < this.surfaces.length; s += 1) {
      const surface = this.surfaces[s];
      const widthVerts = surface.widthSegments + 1;
      const longVerts = surface.longSegments + 1;
      let ptr = 0;

      for (let zi = 0; zi < longVerts; zi += 1) {
        const u = zi / surface.longSegments;
        this.centerlineCurve.getPointAt(u, this.tempCenter);
        this.centerlineCurve.getTangentAt(Math.min(0.9999, u + 1e-4), this.tempTangent);
        this.tempTangent.normalize();

        this.tempRight.crossVectors(this.tempTangent, this.worldUp);
        if (this.tempRight.lengthSq() < 1e-8) {
          this.tempRight.set(1, 0, 0);
        } else {
          this.tempRight.normalize();
        }
        this.tempUp.crossVectors(this.tempRight, this.tempTangent).normalize();

        const phase = (u * (1.1 + this.pace * 0.9) + this.waveTime * (0.08 + this.pace * 0.09)) * Math.PI * 2;
        const damp = 0.5 + 0.5 * this.smoothstep(0.08, 1, u);
        const roll = this.bank * (0.18 + damp * 0.85) + Math.sin(phase * 0.75) * this.curve * 0.04 * damp;
        this.tempQuat.setFromAxisAngle(this.tempTangent, roll);
        this.tempRight.applyQuaternion(this.tempQuat);
        this.tempUp.applyQuaternion(this.tempQuat);

        for (let xi = 0; xi < widthVerts; xi += 1) {
          const v = xi / surface.widthSegments;
          const localX = (v - 0.5) * surface.width + surface.centerOffset;
          const x = this.tempCenter.x + this.tempRight.x * localX + this.tempUp.x * surface.yOffset;
          const y = this.tempCenter.y + this.tempRight.y * localX + this.tempUp.y * surface.yOffset;
          const z = this.tempCenter.z + this.tempRight.z * localX + this.tempUp.z * surface.yOffset;

          surface.positions[ptr] = x;
          surface.positions[ptr + 1] = y;
          surface.positions[ptr + 2] = z;
          ptr += 3;
        }
      }

      surface.geometry.attributes.position.needsUpdate = true;
      if (surface.updateNormals) {
        surface.geometry.computeVertexNormals();
      }
    }
  }

  private smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
    return t * t * (3 - 2 * t);
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
    tex.repeat.set(1, SEGMENT_COUNT * 0.9);
    tex.anisotropy = 8;
    return tex;
  }
}
