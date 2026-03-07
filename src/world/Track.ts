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
  private readonly centerlineCurve: THREE.CatmullRomCurve3;
  private readonly centerlinePoints: THREE.Vector3[];
  private readonly forwardAxis = new THREE.Vector3(0, 0, -1);
  private readonly tempPoint = new THREE.Vector3();
  private readonly tempTangent = new THREE.Vector3();
  private readonly tempQuat = new THREE.Quaternion();
  private readonly tempRollQuat = new THREE.Quaternion();

  private readonly rails: THREE.Mesh[] = [];
  private readonly edgeGlows: THREE.Mesh[] = [];
  private readonly laneLines: THREE.Mesh[] = [];

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

  public constructor() {
    const width = LANE_WIDTH * (LANES + 1);
    const roadTexture = this.makeRoadTexture();

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

    this.lineMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.7,
      metalness: 0.2,
      roughness: 0.3,
      clearcoat: 0.3,
      clearcoatRoughness: 0.2
    });

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

    this.centerlinePoints = new Array(18);
    for (let i = 0; i < this.centerlinePoints.length; i += 1) {
      const u = i / (this.centerlinePoints.length - 1);
      this.centerlinePoints[i] = new THREE.Vector3(0, 0, -u * this.totalLength);
    }
    this.centerlineCurve = new THREE.CatmullRomCurve3(this.centerlinePoints, false, "centripetal", 0.5);

    const segmentRoadGeometry = new THREE.PlaneGeometry(width, SEGMENT_LENGTH * 1.06);
    const lineGeometry = new THREE.BoxGeometry(0.08, 0.05, SEGMENT_LENGTH * 0.96);
    const shoulderWidth = 1.68;
    const shoulderHeight = 0.22;
    const sideGeometry = new THREE.BoxGeometry(shoulderWidth, shoulderHeight, SEGMENT_LENGTH * 1.03);
    const railGeometry = new THREE.CylinderGeometry(0.06, 0.06, SEGMENT_LENGTH * 1.02, 10);
    const glowGeometry = new THREE.BoxGeometry(0.03, 0.13, SEGMENT_LENGTH * 0.98);
    const halfTrack = width * 0.5;

    for (let i = 0; i < SEGMENT_COUNT; i += 1) {
      const root = new THREE.Group();
      const road = new THREE.Mesh(segmentRoadGeometry, this.segmentMaterial);
      road.rotation.x = -Math.PI * 0.5;
      road.receiveShadow = true;
      root.add(road);

      const laneLines: THREE.Mesh[] = [];
      for (let lane = 0; lane <= LANES; lane += 1) {
        const offset = (lane - LANES / 2) * LANE_WIDTH;
        const line = new THREE.Mesh(lineGeometry, this.lineMaterial);
        line.position.set(offset, 0.03, 0);
        line.castShadow = true;
        root.add(line);
        laneLines.push(line);
        this.laneLines.push(line);
      }

      const rails: THREE.Mesh[] = [];
      const glows: THREE.Mesh[] = [];
      for (let side = -1; side <= 1; side += 2) {
        const shoulder = new THREE.Mesh(sideGeometry, this.sideMaterial);
        shoulder.position.set(side * (halfTrack + shoulderWidth * 0.48), shoulderHeight * 0.5 - 0.02, 0);
        shoulder.receiveShadow = true;
        shoulder.castShadow = true;
        root.add(shoulder);

        const rail = new THREE.Mesh(railGeometry, this.railMaterial);
        rail.rotation.x = Math.PI * 0.5;
        rail.position.set(side * (halfTrack + 0.68), 0.28, 0);
        rail.castShadow = true;
        root.add(rail);
        rails.push(rail);
        this.rails.push(rail);

        const glow = new THREE.Mesh(glowGeometry, this.edgeGlowMaterial);
        glow.position.set(side * (halfTrack + 0.04), 0.1, 0);
        glow.renderOrder = 2;
        root.add(glow);
        glows.push(glow);
        this.edgeGlows.push(glow);
      }

      const z = -i * SEGMENT_LENGTH;
      const segment = new TrackSegment(root, z, laneLines, rails, glows);
      this.segments.push(segment);
      this.group.add(root);
    }
  }

  public update(deltaTime: number): void {
    const step = TRACK_SPEED * deltaTime;
    this.waveTime += deltaTime * (0.5 + this.pace * 0.9);

    const smoothing = Math.min(1, deltaTime * 4.8);
    this.lift += (this.targetLift - this.lift) * smoothing;
    this.bank += (this.targetBank - this.bank) * smoothing;
    this.forwardLean += (this.targetForwardLean - this.forwardLean) * smoothing;
    this.curve += (this.targetCurve - this.curve) * smoothing;
    this.pace += (this.targetPace - this.pace) * smoothing;
    this.refreshCenterlineSpline();

    for (let i = 0; i < this.segments.length; i += 1) {
      const segment = this.segments[i];
      segment.zPosition += step;
      if (segment.zPosition > SEGMENT_LENGTH) {
        segment.zPosition -= this.totalLength;
      }
      const distanceAhead = Math.max(0, Math.min(this.totalLength, -segment.zPosition + SEGMENT_LENGTH * 0.5));
      const u = distanceAhead / this.totalLength;
      const damp = this.smoothstep(0.08, 1, u);
      const phase = (u * (1.1 + this.pace * 0.9) + this.waveTime * (0.08 + this.pace * 0.09)) * Math.PI * 2;
      const roll = this.bank * (0.18 + damp * 0.85) + Math.sin(phase * 0.75) * this.curve * 0.04 * damp;

      this.centerlineCurve.getPointAt(u, this.tempPoint);
      this.centerlineCurve.getTangentAt(Math.min(0.9999, u + 1e-4), this.tempTangent);
      if (this.tempTangent.lengthSq() < 1e-8) {
        this.tempTangent.set(0, 0, -1);
      } else {
        this.tempTangent.normalize();
      }

      this.tempQuat.setFromUnitVectors(this.forwardAxis, this.tempTangent);
      this.tempRollQuat.setFromAxisAngle(this.tempTangent, roll);
      segment.mesh.position.copy(this.tempPoint);
      segment.mesh.quaternion.copy(this.tempQuat).multiply(this.tempRollQuat);
    }
  }

  public setControlProfile(elevation: number, curvature: number, pace: number, feature: number): void {
    const e = Math.max(0, Math.min(1, elevation));
    const c = Math.max(-1, Math.min(1, curvature));
    const p = Math.max(0, Math.min(1, pace));
    const f = Math.max(0, Math.min(1, feature));

    this.targetLift = e * 3.2 + f * 1.2;
    this.targetBank = c * (0.12 + p * 0.18 + f * 0.08);
    this.targetCurve = c * (2.4 + p * 2.6 + f * 1.4);
    this.targetPace = p;
    this.targetForwardLean = -0.02 - p * 0.05;
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
    tex.repeat.set(1, SEGMENT_COUNT * 0.72);
    tex.anisotropy = 8;
    return tex;
  }

  private refreshCenterlineSpline(): void {
    const points = this.centerlinePoints;
    for (let i = 0; i < points.length; i += 1) {
      const u = i / (points.length - 1);
      const damp = this.smoothstep(0.03, 1, u);
      const laneSafeDamp = this.smoothstep(0.18, 1, u);
      const phase = (u * (1.25 + this.pace * 1.4) + this.waveTime * (0.12 + this.pace * 0.11)) * Math.PI * 2;
      const phase2 = phase * 0.72 + 0.8;

      const lateralPrimary = Math.sin(phase) * this.curve * (0.08 + laneSafeDamp * 0.9);
      const lateralSecondary = Math.sin(phase * 0.47 + 1.3) * this.curve * 0.35 * laneSafeDamp;
      const lateral = lateralPrimary + lateralSecondary;

      const baseLift = this.lift * (0.06 + laneSafeDamp * 0.94);
      const rollerA = Math.sin(phase2) * this.lift * 0.55 * damp;
      const rollerB = Math.sin(phase * 0.21 + 2.1) * this.lift * 0.35 * laneSafeDamp;
      const drop = -Math.max(0, Math.sin(phase * 0.31 - 0.7)) * this.lift * 0.18 * laneSafeDamp;
      const lift = baseLift + rollerA + rollerB + drop;
      const z = -u * this.totalLength;
      points[i].set(lateral, lift, z);
    }
  }

  private smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }
}
