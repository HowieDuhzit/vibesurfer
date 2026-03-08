import * as THREE from "three";
import { TrackPlan } from "../audio/AnalysisTypes";
import { LANE_WIDTH, LANES, TRACK_SPEED } from "../core/Config";
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

interface FrameSample {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export class Track {
  public readonly group = new THREE.Group();
  public readonly segments: TrackSegment[] = [];

  private readonly trackLength = 240;
  private readonly rearLength = 36;
  private readonly totalCurveLength = this.trackLength + this.rearLength;
  private readonly lengthSegments = 180;
  private readonly trackWidth = LANE_WIDTH * (LANES + 1);
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly forwardAxis = new THREE.Vector3(0, 0, -1);
  private readonly backwardAxis = new THREE.Vector3(0, 0, 1);

  private readonly roadMaterial: THREE.MeshPhysicalMaterial;
  private readonly sideMaterial: THREE.MeshPhysicalMaterial;
  private readonly lineMaterial: THREE.MeshBasicMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private readonly tempColor = new THREE.Color();

  private readonly surfaces: RibbonSurface[] = [];

  private readonly sampleA: FrameSample = this.createFrameSample();
  private readonly sampleB: FrameSample = this.createFrameSample();
  private readonly anchorSample: FrameSample = this.createFrameSample();
  private readonly localSample: FrameSample = this.createFrameSample();
  private readonly yawOnlyQuat = new THREE.Quaternion();
  private readonly invYawOnlyQuat = new THREE.Quaternion();
  private readonly tempEuler = new THREE.Euler();
  private readonly tempMatrix = new THREE.Matrix4();
  private readonly tempVec = new THREE.Vector3();
  private readonly tempVecB = new THREE.Vector3();
  private readonly tempQuat = new THREE.Quaternion();
  private readonly tempRollQuat = new THREE.Quaternion();

  private readonly idlePlan = this.makeIdlePlan();
  private activePlan: TrackPlan = this.idlePlan;
  private planDuration = 12;
  private currentTime = 0;

  private globalPositions: THREE.Vector3[] = [];
  private globalTangents: THREE.Vector3[] = [];
  private globalRights: THREE.Vector3[] = [];
  private globalUps: THREE.Vector3[] = [];
  private globalQuaternions: THREE.Quaternion[] = [];

  private riderHeight = 0;
  private riderBank = 0;
  private riderPitch = 0;

  public constructor() {
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

    this.setGeneratedPlan(null, this.planDuration);
  }

  public setGeneratedPlan(plan: Readonly<TrackPlan> | null, duration: number): void {
    this.activePlan = plan ? this.clonePlan(plan) : this.idlePlan;
    this.planDuration = Math.max(1, duration);
    this.currentTime = 0;
    this.rebuildGlobalPath();
    this.updateVisibleTrack();
  }

  public setPlaybackTime(timeSeconds: number): void {
    this.currentTime = Math.max(0, Math.min(this.planDuration, timeSeconds));
  }

  public update(_deltaTime: number): void {
    this.updateVisibleTrack();
  }

  public getPlaybackSpeedScale(): number {
    return this.samplePlanScalar(this.activePlan.speedScale, this.currentTime, 1);
  }

  public setControlProfile(_elevation: number, _curvature: number, _pace: number, _feature: number): void {
    // The track is immutable during play; runtime control data is now used for
    // camera/effects only. Keep this method for call-site compatibility.
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
    this.sampleRelativeFrame(this.trackZToTime(trackZ), this.localSample);
    out.copy(this.localSample.position)
      .addScaledVector(this.localSample.right, -laneOffset)
      .addScaledVector(this.localSample.up, heightOffset);
    return out;
  }

  public sampleLaneQuaternion(trackZ: number, roll: number, out: THREE.Quaternion): THREE.Quaternion {
    this.sampleRelativeFrame(this.trackZToTime(trackZ), this.localSample);
    out.copy(this.localSample.quaternion);
    if (roll !== 0) {
      this.tempRollQuat.setFromAxisAngle(this.localSample.tangent, roll);
      out.multiply(this.tempRollQuat);
    }
    return out;
  }

  private updateVisibleTrack(): void {
    this.sampleRelativeFrame(0, this.anchorSample);
    this.riderHeight = this.anchorSample.position.y;
    this.tempEuler.setFromQuaternion(this.anchorSample.quaternion, "YXZ");
    this.riderPitch = this.tempEuler.x;
    this.riderBank = this.tempEuler.z;
    const speedScale = this.getPlaybackSpeedScale();
    const visibleLength = this.totalCurveLength * THREE.MathUtils.lerp(0.9, 1.28, this.clamp((speedScale - 0.72) / (1.6 - 0.72), 0, 1));
    const visibleRear = this.rearLength * THREE.MathUtils.lerp(0.9, 1.12, this.clamp((speedScale - 0.72) / (1.6 - 0.72), 0, 1));

    for (let s = 0; s < this.surfaces.length; s += 1) {
      const surface = this.surfaces[s];
      const across = surface.widthSegments + 1;
      let ptr = 0;

      for (let zi = 0; zi <= this.lengthSegments; zi += 1) {
        const u = zi / this.lengthSegments;
        const trackZ = visibleRear - u * visibleLength;
        this.sampleRelativeFrame(this.trackZToTime(trackZ), this.localSample);

        for (let xi = 0; xi < across; xi += 1) {
          const v = xi / surface.widthSegments;
          const localX = (v - 0.5) * surface.width + surface.centerOffset;
          surface.positions[ptr] = this.localSample.position.x + this.localSample.right.x * localX + this.localSample.up.x * surface.yOffset;
          surface.positions[ptr + 1] = this.localSample.position.y + this.localSample.right.y * localX + this.localSample.up.y * surface.yOffset;
          surface.positions[ptr + 2] = this.localSample.position.z + this.localSample.right.z * localX + this.localSample.up.z * surface.yOffset;
          ptr += 3;
        }
      }

      surface.geometry.attributes.position.needsUpdate = true;
      surface.geometry.computeVertexNormals();
    }
  }

  private sampleRelativeFrame(timeSeconds: number, out: FrameSample): void {
    this.sampleGlobalFrame(this.currentTime, this.anchorSample);
    this.sampleGlobalFrame(timeSeconds, this.sampleA);
    const forwardFlat = this.tempVec.copy(this.anchorSample.tangent);
    forwardFlat.y = 0;
    if (forwardFlat.lengthSq() < 1e-8) {
      forwardFlat.set(0, 0, -1);
    } else {
      forwardFlat.normalize();
    }

    this.yawOnlyQuat.setFromUnitVectors(this.forwardAxis, forwardFlat);
    this.invYawOnlyQuat.copy(this.yawOnlyQuat).invert();

    out.position.copy(this.sampleA.position).sub(this.anchorSample.position).applyQuaternion(this.invYawOnlyQuat);
    out.tangent.copy(this.sampleA.tangent).applyQuaternion(this.invYawOnlyQuat).normalize();
    out.right.copy(this.sampleA.right).applyQuaternion(this.invYawOnlyQuat).normalize();
    out.up.copy(this.sampleA.up).applyQuaternion(this.invYawOnlyQuat).normalize();

    this.tempMatrix.makeBasis(out.right, out.up, this.tempVecB.copy(out.tangent).multiplyScalar(-1));
    out.quaternion.setFromRotationMatrix(this.tempMatrix);
  }

  private sampleGlobalFrame(timeSeconds: number, out: FrameSample): void {
    const count = this.globalPositions.length;
    if (count === 0) {
      out.position.set(0, 0, 0);
      out.tangent.copy(this.forwardAxis);
      out.right.set(1, 0, 0);
      out.up.set(0, 1, 0);
      out.quaternion.identity();
      return;
    }

    const normalized = this.clamp(timeSeconds / Math.max(1e-6, this.planDuration), 0, 0.999999);
    const f = normalized * (count - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(count - 1, i0 + 1);
    const t = f - i0;

    out.position.copy(this.globalPositions[i0]).lerp(this.globalPositions[i1], t);
    out.tangent.copy(this.globalTangents[i0]).lerp(this.globalTangents[i1], t).normalize();
    out.right.copy(this.globalRights[i0]).lerp(this.globalRights[i1], t).normalize();
    out.up.copy(this.globalUps[i0]).lerp(this.globalUps[i1], t).normalize();
    out.quaternion.copy(this.globalQuaternions[i0]).slerp(this.globalQuaternions[i1], t);
  }

  private rebuildGlobalPath(): void {
    const count = Math.max(2, this.activePlan.tilt.length);
    this.globalPositions = new Array(count);
    this.globalTangents = new Array(count);
    this.globalRights = new Array(count);
    this.globalUps = new Array(count);
    this.globalQuaternions = new Array(count);

    const dt = this.planDuration / Math.max(1, count - 1);
    const prevTangent = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const rotateQuat = new THREE.Quaternion();
    const baseRight = new THREE.Vector3(1, 0, 0);
    const baseUp = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < count; i += 1) {
      const pitch = this.activePlan.tilt[i] ?? 0;
      const yaw = this.activePlan.pan[i] ?? 0;
      const cp = Math.cos(pitch);
      const tangent = new THREE.Vector3(
        Math.sin(yaw) * cp,
        Math.sin(pitch),
        -Math.cos(yaw) * cp
      ).normalize();
      this.globalTangents[i] = tangent;
    }

    this.globalPositions[0] = new THREE.Vector3(0, 0, 0);
    this.globalRights[0] = baseRight.clone();
    this.globalUps[0] = baseUp.clone();

    for (let i = 1; i < count; i += 1) {
      const prevPos = this.globalPositions[i - 1];
      const dir = this.tempVec.copy(this.globalTangents[i - 1]).lerp(this.globalTangents[i], 0.5).normalize();
      const plannedDistance = this.getPlannedDistanceStep(i, dt);
      this.globalPositions[i] = prevPos.clone().addScaledVector(dir, plannedDistance);
    }

    for (let i = 1; i < count; i += 1) {
      prevTangent.copy(this.globalTangents[i - 1]);
      axis.crossVectors(prevTangent, this.globalTangents[i]);
      const axisLen = axis.length();

      if (axisLen > 1e-8) {
        axis.multiplyScalar(1 / axisLen);
        const angle = Math.acos(this.clamp(prevTangent.dot(this.globalTangents[i]), -1, 1));
        rotateQuat.setFromAxisAngle(axis, angle);
        this.globalRights[i] = this.globalRights[i - 1].clone().applyQuaternion(rotateQuat);
        this.globalUps[i] = this.globalUps[i - 1].clone().applyQuaternion(rotateQuat);
      } else {
        this.globalRights[i] = this.globalRights[i - 1].clone();
        this.globalUps[i] = this.globalUps[i - 1].clone();
      }

      this.orthonormalizeFrame(this.globalTangents[i], this.globalRights[i], this.globalUps[i]);
    }

    for (let i = 0; i < count; i += 1) {
      const roll = this.activePlan.roll[i] ?? 0;
      this.tempRollQuat.setFromAxisAngle(this.globalTangents[i], roll);
      this.globalRights[i].applyQuaternion(this.tempRollQuat);
      this.globalUps[i].applyQuaternion(this.tempRollQuat);
      this.orthonormalizeFrame(this.globalTangents[i], this.globalRights[i], this.globalUps[i]);
      this.tempMatrix.makeBasis(this.globalRights[i], this.globalUps[i], this.tempVec.copy(this.globalTangents[i]).multiplyScalar(-1));
      this.globalQuaternions[i] = new THREE.Quaternion().setFromRotationMatrix(this.tempMatrix);
    }
  }

  private trackZToTime(trackZ: number): number {
    return this.currentTime + (-trackZ / TRACK_SPEED);
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

  private makeIdlePlan(): TrackPlan {
    const count = 512;
    const tilt = new Float32Array(count);
    const pan = new Float32Array(count);
    const roll = new Float32Array(count);
    const elevation = new Float32Array(count);
    const curvature = new Float32Array(count);
    const pace = new Float32Array(count);
    const speedScale = new Float32Array(count);
    const cumulativeDistance = new Float32Array(count);
    const eventDensity = new Float32Array(count);
    const dangerLevel = new Float32Array(count);
    const featureEligibility = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const u = i / Math.max(1, count - 1);
      tilt[i] = Math.sin(u * Math.PI * 2) * 0.06;
      pan[i] = Math.sin(u * Math.PI * 1.4) * 0.08;
      roll[i] = Math.sin(u * Math.PI * 2.4) * 0.05;
      elevation[i] = 0.2;
      curvature[i] = pan[i];
      pace[i] = 0.25;
      speedScale[i] = 0.9;
      cumulativeDistance[i] = i * (TRACK_SPEED * (this.planDuration / Math.max(1, count - 1)) * 0.9);
      eventDensity[i] = 0.2;
      dangerLevel[i] = 0.2;
      featureEligibility[i] = 0.1;
    }

    return {
      tilt,
      pan,
      roll,
      elevation,
      curvature,
      pace,
      speedScale,
      cumulativeDistance,
      eventDensity,
      dangerLevel,
      featureEligibility,
      anchorFrames: []
    };
  }

  private clonePlan(plan: Readonly<TrackPlan>): TrackPlan {
    return {
      tilt: new Float32Array(plan.tilt),
      pan: new Float32Array(plan.pan),
      roll: new Float32Array(plan.roll),
      elevation: new Float32Array(plan.elevation),
      curvature: new Float32Array(plan.curvature),
      pace: new Float32Array(plan.pace),
      speedScale: new Float32Array(plan.speedScale),
      cumulativeDistance: new Float32Array(plan.cumulativeDistance),
      eventDensity: new Float32Array(plan.eventDensity),
      dangerLevel: new Float32Array(plan.dangerLevel),
      featureEligibility: new Float32Array(plan.featureEligibility),
      anchorFrames: plan.anchorFrames.slice()
    };
  }

  private createFrameSample(): FrameSample {
    return {
      position: new THREE.Vector3(),
      tangent: new THREE.Vector3(0, 0, -1),
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
      quaternion: new THREE.Quaternion()
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private samplePlanScalar(source: Float32Array, timeSeconds: number, fallback: number): number {
    if (source.length === 0) {
      return fallback;
    }
    const normalized = this.clamp(timeSeconds / Math.max(1e-6, this.planDuration), 0, 0.999999);
    const f = normalized * (source.length - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(source.length - 1, i0 + 1);
    const t = f - i0;
    return THREE.MathUtils.lerp(source[i0] ?? fallback, source[i1] ?? source[i0] ?? fallback, t);
  }

  private getPlannedDistanceStep(index: number, fallbackDt: number): number {
    const distances = this.activePlan.cumulativeDistance;
    if (index > 0 && index < distances.length) {
      const delta = (distances[index] ?? 0) - (distances[index - 1] ?? 0);
      if (Number.isFinite(delta) && delta > 1e-4) {
        const minStep = TRACK_SPEED * fallbackDt * 0.68;
        const maxStep = TRACK_SPEED * fallbackDt * 1.62;
        return this.clamp(delta, minStep, maxStep);
      }
    }

    const speedScale = this.activePlan.speedScale[index] ?? this.activePlan.speedScale[index - 1] ?? 1;
    return TRACK_SPEED * fallbackDt * this.clamp(speedScale, 0.72, 1.6);
  }

  private orthonormalizeFrame(tangent: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3): void {
    if (!this.isFiniteVector(tangent) || tangent.lengthSq() < 1e-8) {
      tangent.set(0, 0, -1);
    } else {
      tangent.normalize();
    }

    if (!this.isFiniteVector(right) || right.lengthSq() < 1e-8) {
      right.copy(this.pickFallbackRight(tangent));
    }

    up.crossVectors(tangent, right);
    if (!this.isFiniteVector(up) || up.lengthSq() < 1e-8) {
      right.copy(this.pickFallbackRight(tangent));
      up.crossVectors(tangent, right);
    }
    up.normalize();

    right.crossVectors(up, tangent);
    if (!this.isFiniteVector(right) || right.lengthSq() < 1e-8) {
      right.copy(this.pickFallbackRight(tangent));
      up.crossVectors(tangent, right).normalize();
    } else {
      right.normalize();
    }

    if (up.dot(this.worldUp) < -0.2) {
      right.multiplyScalar(-1);
      up.multiplyScalar(-1);
    }
  }

  private pickFallbackRight(tangent: THREE.Vector3): THREE.Vector3 {
    const axis = Math.abs(tangent.y) > 0.92 ? this.backwardAxis : this.worldUp;
    return this.tempVecB.crossVectors(axis, tangent).normalize();
  }

  private isFiniteVector(v: THREE.Vector3): boolean {
    return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
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
