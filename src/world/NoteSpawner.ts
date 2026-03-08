import * as THREE from "three";
import { LANE_WIDTH, NOTE_POOL_SIZE, SPAWN_DISTANCE } from "../core/Config";
import { SpawnEvent } from "../audio/BeatMapGenerator";
import { NoteType } from "../entities/Note";
import { Note } from "../entities/Note";
import { Track } from "./Track";

export class NoteSpawner {
  public readonly instancedMesh: THREE.InstancedMesh;

  private readonly notes: Note[] = [];
  private readonly freeIndices: number[] = [];
  private readonly activeIndices: number[] = [];

  private readonly matrixDummy = new THREE.Object3D();
  private readonly emptyMatrix = new THREE.Matrix4().makeTranslation(0, -1000, 0);
  private readonly worldPos = new THREE.Vector3();
  private readonly worldQuat = new THREE.Quaternion();

  private readonly material: THREE.MeshStandardMaterial;
  private readonly laneColors = [new THREE.Color(0xf97316), new THREE.Color(0x22d3ee), new THREE.Color(0xfacc15)];
  private readonly typeColors: Record<NoteType, THREE.Color> = {
    tap: new THREE.Color(0x60a5fa),
    hold: new THREE.Color(0x34d399),
    double: new THREE.Color(0xc084fc),
    slide: new THREE.Color(0xf59e0b),
    mine: new THREE.Color(0xf43f5e)
  };
  private readonly tempColor = new THREE.Color();
  private readonly mixedColor = new THREE.Color();
  private effectIntensity = 1;

  public constructor(scene: THREE.Scene, private readonly track: Track) {
    const geometry = new THREE.IcosahedronGeometry(0.42, 1);
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0x22d3ee,
      emissive: 0x22d3ee,
      emissiveIntensity: 0.95,
      metalness: 0.35,
      roughness: 0.2,
      clearcoat: 0.72,
      clearcoatRoughness: 0.08,
      transmission: 0.08,
      thickness: 0.7,
      vertexColors: true
    });

    this.instancedMesh = new THREE.InstancedMesh(geometry, this.material, NOTE_POOL_SIZE);
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.castShadow = true;
    this.instancedMesh.receiveShadow = true;

    for (let i = 0; i < NOTE_POOL_SIZE; i += 1) {
      const note = new Note(i);
      this.notes.push(note);
      this.freeIndices.push(i);
      this.instancedMesh.setMatrixAt(i, this.emptyMatrix);
      this.instancedMesh.setColorAt(i, this.laneColors[1]);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }

    scene.add(this.instancedMesh);
  }

  public updateSpawnEvents(spawns: readonly SpawnEvent[]): void {
    for (let i = 0; i < spawns.length; i += 1) {
      const spawn = spawns[i];
      const note = this.acquireNote();
      if (!note) {
        continue;
      }

      note.spawn(spawn.lane, spawn.type, spawn.duration, spawn.slideToLane);
      note.zPosition = -SPAWN_DISTANCE;
      this.writeMatrix(note);
      const laneColor = this.laneColors[spawn.lane] ?? this.laneColors[1];
      const typeColor = this.typeColors[spawn.type] ?? this.typeColors.tap;
      this.mixedColor.copy(laneColor).lerp(typeColor, 0.58);
      this.instancedMesh.setColorAt(note.instanceId, this.mixedColor);
      this.activeIndices.push(note.instanceId);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  public updateActiveNotes(deltaTime: number, trackSpeed: number): void {
    for (let i = this.activeIndices.length - 1; i >= 0; i -= 1) {
      const note = this.notes[this.activeIndices[i]];
      note.updatePosition(deltaTime, trackSpeed);
      this.writeMatrix(note);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  public setMusicReactiveColor(energy: number, bass: number, treble: number, fever = 0): void {
    this.tempColor.setHSL(0.56 - treble * 0.18 + bass * 0.05 + fever * 0.03, 0.9, 0.45 + energy * 0.15 + fever * 0.12);
    this.material.emissive.copy(this.tempColor);
    this.material.emissiveIntensity = (0.65 + energy * 1.5 + fever * 1.7) * this.effectIntensity;
  }

  public setEffectIntensity(scale: number): void {
    this.effectIntensity = Math.max(0.35, Math.min(2, scale));
  }

  public getActiveInstanceIds(): readonly number[] {
    return this.activeIndices;
  }

  public getActiveCount(): number {
    return this.activeIndices.length;
  }

  public getNoteByInstanceId(instanceId: number): Note {
    return this.notes[instanceId];
  }

  public deactivateNote(note: Note): void {
    if (!note.active) {
      return;
    }

    note.deactivate();
    this.instancedMesh.setMatrixAt(note.instanceId, this.emptyMatrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    const idx = this.activeIndices.indexOf(note.instanceId);
    if (idx >= 0) {
      this.activeIndices.splice(idx, 1);
    }

    this.freeIndices.push(note.instanceId);
  }

  public reset(): void {
    for (let i = this.activeIndices.length - 1; i >= 0; i -= 1) {
      const note = this.notes[this.activeIndices[i]];
      note.deactivate();
      this.instancedMesh.setMatrixAt(note.instanceId, this.emptyMatrix);
      this.freeIndices.push(note.instanceId);
    }

    this.activeIndices.length = 0;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  private acquireNote(): Note | null {
    const idx = this.freeIndices.pop();
    if (idx === undefined) {
      return null;
    }

    return this.notes[idx];
  }

  private writeMatrix(note: Note): void {
    const laneOffset = (note.lane - 1) * LANE_WIDTH;
    this.track.sampleLanePoint(note.zPosition, laneOffset, 0.36, this.worldPos);
    this.track.sampleLaneQuaternion(note.zPosition, 0, this.worldQuat);
    note.mesh.position.copy(this.worldPos);

    this.matrixDummy.position.copy(this.worldPos);
    this.matrixDummy.quaternion.copy(this.worldQuat);
    if (note.type === "slide") {
      const direction = Math.sign(note.slideToLane - note.lane);
      this.matrixDummy.rotateZ(direction * 0.42);
      this.matrixDummy.scale.set(1.28, 1, 0.86);
    } else if (note.type === "hold") {
      this.matrixDummy.scale.set(0.95, 1.05, 1.2 + note.duration * 1.6);
    } else if (note.type === "double") {
      this.matrixDummy.scale.set(1.35, 1.05, 1.35);
    } else if (note.type === "mine") {
      this.matrixDummy.rotateX(0.8);
      this.matrixDummy.rotateY(note.zPosition * 0.08);
      this.matrixDummy.rotateZ(0.8);
      this.matrixDummy.scale.set(0.78, 0.78, 0.78);
    } else {
      this.matrixDummy.scale.set(1, 1, 1);
    }
    this.matrixDummy.updateMatrix();
    this.instancedMesh.setMatrixAt(note.instanceId, this.matrixDummy.matrix);
  }

}
