import * as THREE from "three";
import { LANE_WIDTH, LANES } from "../core/Config";
import { TrackSegment } from "./TrackSegment";

interface RibbonSurface {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  width: number;
  centerOffset: number;
  yOffset: number;
  widthSegments: number;
}

export class Track {
  public readonly group = new THREE.Group();
  public readonly segments: TrackSegment[] = [];

  private readonly trackLength = 240;
  private readonly rearLength = 36;
  private readonly totalCurveLength = this.trackLength + this.rearLength;
  private readonly frontPadding = 8;
  private readonly lengthSegments = 160;
  private readonly trackWidth = LANE_WIDTH * (LANES + 1);
  private readonly centerlineCurve: THREE.CatmullRomCurve3;
  private readonly centerlinePoints: THREE.Vector3[];
  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  private readonly roadMaterial: THREE.MeshPhysicalMaterial;
  private readonly sideMaterial: THREE.MeshPhysicalMaterial;
  private readonly lineMaterial: THREE.MeshBasicMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private readonly tempColor = new THREE.Color();

  private readonly surfaces: RibbonSurface[] = [];

  private readonly forwardAxis = new THREE.Vector3(0, 0, -1);
  private readonly tempCenter = new THREE.Vector3();
  private readonly tempTangent = new THREE.Vector3();
  private readonly tempRight = new THREE.Vector3();
  private readonly tempUp = new THREE.Vector3();
  private readonly tempNormal = new THREE.Vector3();
  private readonly tempBinormal = new THREE.Vector3();
  private readonly tempQuat = new THREE.Quaternion();
  private readonly tempRollQuat = new THREE.Quaternion();
  private readonly tempAxis = new THREE.Vector3();
  private readonly tempPrevTangent = new THREE.Vector3();
  private readonly tempRotateQuat = new THREE.Quaternion();
  private readonly frameTangents: THREE.Vector3[] = [];
  private readonly frameNormals: THREE.Vector3[] = [];
  private readonly frameBinormals: THREE.Vector3[] = [];

  private targetLift = 0;
  private targetBank = 0;
  private targetCurve = 0;
  private targetPace = 0;
  private targetForwardLean = 0;
  private readonly motionIntensity = 0.46;

  private lift = 0;
  private bank = 0;
  private curve = 0;
  private pace = 0;
  private forwardLean = 0;
  private waveTime = 0;

  private riderHeight = 0;
  private riderBank = 0;
  private riderPitch = 0;

  public constructor() {
    this.centerlinePoints = new Array(22);
    for (let i = 0; i < this.centerlinePoints.length; i += 1) {
      const u = i / (this.centerlinePoints.length - 1);
      this.centerlinePoints[i] = new THREE.Vector3(0, 0, this.rearLength - u * this.totalCurveLength);
    }
    this.centerlineCurve = new THREE.CatmullRomCurve3(this.centerlinePoints, false, "centripetal", 0.5);
    for (let i = 0; i <= this.lengthSegments; i += 1) {
      this.frameTangents.push(new THREE.Vector3(0, 0, -1));
      this.frameNormals.push(new THREE.Vector3(1, 0, 0));
      this.frameBinormals.push(new THREE.Vector3(0, 1, 0));
    }

    this.roadMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x0b1228,
      roughness: 0.5,
      metalness: 0.55,
      clearcoat: 0.42,
      clearcoatRoughness: 0.2,
      emissive: 0x071325,
      emissiveIntensity: 0.2,
      map: this.makeRoadTexture()
    });

    this.sideMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x111827,
      emissive: 0x0f172a,
      emissiveIntensity: 0.22,
      roughness: 0.72,
      metalness: 0.2
    });

    this.lineMaterial = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.95
    });

    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.78
    });

    // Single uninterrupted mesh surfaces generated along one spline.
    this.surfaces.push(this.createRibbonSurface(this.trackWidth, 0, 0, 10, this.roadMaterial));

    const shoulderWidth = 1.65;
    const shoulderOffset = this.trackWidth * 0.5 + shoulderWidth * 0.5;
    this.surfaces.push(this.createRibbonSurface(shoulderWidth, shoulderOffset, 0.02, 2, this.sideMaterial));
    this.surfaces.push(this.createRibbonSurface(shoulderWidth, -shoulderOffset, 0.02, 2, this.sideMaterial));

    for (let lane = 0; lane <= LANES; lane += 1) {
      const offset = (lane - LANES / 2) * LANE_WIDTH;
      this.surfaces.push(this.createRibbonSurface(0.08, offset, 0.05, 1, this.lineMaterial));
    }

    const glowOffset = this.trackWidth * 0.5 + 0.08;
    this.surfaces.push(this.createRibbonSurface(0.05, glowOffset, 0.11, 1, this.glowMaterial));
    this.surfaces.push(this.createRibbonSurface(0.05, -glowOffset, 0.11, 1, this.glowMaterial));

    this.refreshFrenetFrames();
    this.updateWarpedGeometry();
  }

  public update(deltaTime: number): void {
    this.waveTime += deltaTime * (0.6 + this.pace * 1.1);

    const smooth = Math.min(1, deltaTime * 4.8);
    this.lift += (this.targetLift - this.lift) * smooth;
    this.bank += (this.targetBank - this.bank) * smooth;
    this.curve += (this.targetCurve - this.curve) * smooth;
    this.pace += (this.targetPace - this.pace) * smooth;
    this.forwardLean += (this.targetForwardLean - this.forwardLean) * smooth;

    this.refreshCenterlineSpline();
    this.refreshFrenetFrames();
    this.updateWarpedGeometry();
    this.updateRiderPose();
  }

  public setControlProfile(elevation: number, curvature: number, pace: number, feature: number): void {
    const e = Math.max(0, Math.min(1, elevation));
    const c = Math.max(-1, Math.min(1, curvature));
    const p = Math.max(0, Math.min(1, pace));
    const f = Math.max(0, Math.min(1, feature));

    this.targetLift = (e * 3.6 + f * 1.3) * this.motionIntensity;
    this.targetCurve = (c * (2.8 + p * 2.8 + f * 1.4)) * this.motionIntensity;
    this.targetBank = (c * (0.14 + p * 0.22 + f * 0.1)) * this.motionIntensity;
    this.targetPace = p;
    this.targetForwardLean = (-0.02 - p * 0.05) * this.motionIntensity;
  }

  public setMusicReactiveColor(energy: number, bass: number, treble: number, fever = 0): void {
    this.tempColor.setHSL(0.58 - treble * 0.2 + fever * 0.06, 0.85, 0.5 + energy * 0.14);
    this.lineMaterial.color.copy(this.tempColor);
    this.lineMaterial.opacity = 0.62 + Math.min(0.35, energy * 0.38 + fever * 0.35);

    this.tempColor.setHSL(0.61 - bass * 0.08 + fever * 0.03, 0.5 + fever * 0.22, 0.11 + bass * 0.12);
    this.roadMaterial.color.copy(this.tempColor);
    this.roadMaterial.emissive.copy(this.tempColor);
    this.roadMaterial.emissiveIntensity = 0.15 + bass * 0.66 + fever * 1.0;

    this.tempColor.setHSL(0.55 - treble * 0.14 + fever * 0.05, 0.88, 0.44 + energy * 0.2);
    this.glowMaterial.color.copy(this.tempColor);
    this.glowMaterial.opacity = 0.42 + energy * 0.48;
  }

  public getRiderPose(): Readonly<{ height: number; bank: number; pitch: number }> {
    return {
      height: this.riderHeight,
      bank: this.riderBank,
      pitch: this.riderPitch
    };
  }

  public sampleLanePoint(trackZ: number, laneOffset: number, heightOffset: number, out: THREE.Vector3): THREE.Vector3 {
    const u = Math.max(0, Math.min(1, (this.rearLength + this.frontPadding - trackZ) / this.totalCurveLength));
    this.centerlineCurve.getPointAt(u, this.tempCenter);
    this.sampleFrameAt(u, this.tempTangent, this.tempRight, this.tempUp);
    out.copy(this.tempCenter)
      .addScaledVector(this.tempRight, laneOffset)
      .addScaledVector(this.tempUp, heightOffset);
    return out;
  }

  public sampleLaneQuaternion(trackZ: number, roll: number, out: THREE.Quaternion): THREE.Quaternion {
    const u = Math.max(0, Math.min(1, (this.rearLength + this.frontPadding - trackZ) / this.totalCurveLength));
    this.sampleFrameAt(u, this.tempTangent, this.tempRight, this.tempUp);
    out.setFromUnitVectors(this.forwardAxis, this.tempTangent);
    this.tempRollQuat.setFromAxisAngle(this.tempTangent, roll);
    out.multiply(this.tempRollQuat);
    return out;
  }

  private createRibbonSurface(
    width: number,
    centerOffset: number,
    yOffset: number,
    widthSegments: number,
    material: THREE.Material
  ): RibbonSurface {
    const verticesAcross = Math.max(1, widthSegments) + 1;
    const verticesLong = this.lengthSegments + 1;
    const positions = new Float32Array(verticesAcross * verticesLong * 3);
    const indices: number[] = [];

    for (let z = 0; z < this.lengthSegments; z += 1) {
      for (let x = 0; x < widthSegments; x += 1) {
        const a = z * verticesAcross + x;
        const b = a + 1;
        const c = a + verticesAcross;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    return {
      mesh,
      geometry,
      positions,
      width,
      centerOffset,
      yOffset,
      widthSegments: Math.max(1, widthSegments)
    };
  }

  private refreshCenterlineSpline(): void {
    for (let i = 0; i < this.centerlinePoints.length; i += 1) {
      const u = i / (this.centerlinePoints.length - 1);
      if (i === 0) {
        this.centerlinePoints[i].set(0, 0, 0);
        continue;
      }

      const damp = 0.6 + 0.4 * this.smoothstep(0.04, 1, u);
      const phase = (u * (1.22 + this.pace * 1.5) + this.waveTime * (0.14 + this.pace * 0.12)) * Math.PI * 2;
      const phase2 = phase * 0.7 + 0.9;

      const lateralA = Math.sin(phase) * this.curve * (0.1 + damp * 0.72);
      const lateralB = Math.sin(phase * 0.48 + 1.4) * this.curve * 0.24 * damp;
      const lateral = lateralA + lateralB;

      const baseLift = this.lift * (0.08 + damp * 0.92);
      const hillA = Math.sin(phase2) * this.lift * 0.38 * damp;
      const hillB = Math.sin(phase * 0.24 + 2.0) * this.lift * 0.22 * damp;
      const drop = -Math.max(0, Math.sin(phase * 0.32 - 0.72)) * this.lift * 0.13 * damp;
      const slope = this.forwardLean * u * this.totalCurveLength * 0.1;
      const y = baseLift + hillA + hillB + drop + slope;

      this.centerlinePoints[i].set(lateral, y, this.rearLength + this.frontPadding - u * this.totalCurveLength);
    }
  }

  private updateWarpedGeometry(): void {
    for (let s = 0; s < this.surfaces.length; s += 1) {
      const surface = this.surfaces[s];
      const across = surface.widthSegments + 1;
      let ptr = 0;

      for (let zi = 0; zi <= this.lengthSegments; zi += 1) {
        const u = zi / this.lengthSegments;
        this.centerlineCurve.getPointAt(u, this.tempCenter);
        this.sampleFrameAt(u, this.tempTangent, this.tempRight, this.tempUp);

        const phase = (u * (1.1 + this.pace * 0.95) + this.waveTime * (0.09 + this.pace * 0.1)) * Math.PI * 2;
        const damp = 0.52 + 0.48 * this.smoothstep(0.08, 1, u);
        const roll = this.bank * (0.16 + damp * 0.64) + Math.sin(phase * 0.74) * this.curve * 0.025 * damp;
        this.tempQuat.setFromAxisAngle(this.tempTangent, roll);
        this.tempRight.applyQuaternion(this.tempQuat);
        this.tempUp.applyQuaternion(this.tempQuat);

        for (let xi = 0; xi < across; xi += 1) {
          const v = xi / surface.widthSegments;
          const localX = (v - 0.5) * surface.width + surface.centerOffset;
          surface.positions[ptr] = this.tempCenter.x + this.tempRight.x * localX + this.tempUp.x * surface.yOffset;
          surface.positions[ptr + 1] = this.tempCenter.y + this.tempRight.y * localX + this.tempUp.y * surface.yOffset;
          surface.positions[ptr + 2] = this.tempCenter.z + this.tempRight.z * localX + this.tempUp.z * surface.yOffset;
          ptr += 3;
        }
      }

      surface.geometry.attributes.position.needsUpdate = true;
      surface.geometry.computeVertexNormals();
    }
  }

  private updateRiderPose(): void {
    this.centerlineCurve.getPointAt(0, this.tempCenter);
    this.sampleFrameAt(0, this.tempTangent, this.tempRight, this.tempUp);
    const forwardLen = Math.max(1e-6, Math.hypot(this.tempTangent.x, this.tempTangent.z));
    this.riderPitch = Math.atan2(this.tempTangent.y, forwardLen);
    this.riderBank = this.bank * 0.9 + Math.sin(this.waveTime * 1.8) * this.curve * 0.02;
    this.riderHeight = this.tempCenter.y;
  }

  private sampleFrameAt(
    u: number,
    tangentOut: THREE.Vector3,
    rightOut: THREE.Vector3,
    upOut: THREE.Vector3
  ): void {
    const f = Math.max(0, Math.min(this.lengthSegments, u * this.lengthSegments));
    const i0 = Math.floor(f);
    const i1 = Math.min(this.lengthSegments, i0 + 1);
    const t = f - i0;

    tangentOut.copy(this.frameTangents[i0]).lerp(this.frameTangents[i1], t).normalize();
    this.tempNormal.copy(this.frameNormals[i0]).lerp(this.frameNormals[i1], t).normalize();
    this.tempBinormal.copy(this.frameBinormals[i0]).lerp(this.frameBinormals[i1], t).normalize();

    // Keep the road upright for readability; prevents occasional side flips.
    if (this.tempBinormal.dot(this.worldUp) < 0) {
      this.tempNormal.multiplyScalar(-1);
      this.tempBinormal.multiplyScalar(-1);
    }

    rightOut.copy(this.tempNormal);
    upOut.copy(this.tempBinormal);
  }

  private refreshFrenetFrames(): void {
    // Rotation-minimizing frames (parallel transport) are more stable than raw
    // Frenet frames for dynamic curves and prevent random 180-degree flips.
    this.centerlineCurve.getTangentAt(0, this.frameTangents[0]).normalize();

    this.frameBinormals[0]
      .copy(this.worldUp)
      .addScaledVector(this.frameTangents[0], -this.worldUp.dot(this.frameTangents[0]));
    if (this.frameBinormals[0].lengthSq() < 1e-8) {
      this.frameBinormals[0].set(0, 0, 1).addScaledVector(
        this.frameTangents[0],
        -this.frameTangents[0].z
      );
    }
    this.frameBinormals[0].normalize();
    this.frameNormals[0].crossVectors(this.frameBinormals[0], this.frameTangents[0]).normalize();

    for (let i = 1; i <= this.lengthSegments; i += 1) {
      const u = i / this.lengthSegments;
      this.centerlineCurve.getTangentAt(Math.min(0.9999, u), this.frameTangents[i]).normalize();

      this.tempPrevTangent.copy(this.frameTangents[i - 1]);
      this.tempAxis.crossVectors(this.tempPrevTangent, this.frameTangents[i]);
      const axisLen = this.tempAxis.length();

      if (axisLen > 1e-8) {
        this.tempAxis.multiplyScalar(1 / axisLen);
        const dot = THREE.MathUtils.clamp(this.tempPrevTangent.dot(this.frameTangents[i]), -1, 1);
        const angle = Math.acos(dot);
        this.tempRotateQuat.setFromAxisAngle(this.tempAxis, angle);
        this.frameNormals[i].copy(this.frameNormals[i - 1]).applyQuaternion(this.tempRotateQuat).normalize();
        this.frameBinormals[i].copy(this.frameBinormals[i - 1]).applyQuaternion(this.tempRotateQuat).normalize();
      } else {
        this.frameNormals[i].copy(this.frameNormals[i - 1]);
        this.frameBinormals[i].copy(this.frameBinormals[i - 1]);
      }

      // Keep the frame upright and right-handed.
      if (this.frameBinormals[i].dot(this.worldUp) < 0) {
        this.frameBinormals[i].multiplyScalar(-1);
        this.frameNormals[i].multiplyScalar(-1);
      }
      this.frameNormals[i]
        .crossVectors(this.frameBinormals[i], this.frameTangents[i])
        .normalize();
      this.frameBinormals[i]
        .crossVectors(this.frameTangents[i], this.frameNormals[i])
        .normalize();
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
    tex.repeat.set(1, 8);
    tex.anisotropy = 8;
    return tex;
  }
}
