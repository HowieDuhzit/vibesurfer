import * as THREE from "three";
import { LANE_WIDTH, LANES, NOTE_POOL_SIZE, SPAWN_DISTANCE } from "../core/Config";
import { BeatMarkerEvent, SpawnEvent } from "../audio/BeatMapGenerator";
import { NoteType } from "../entities/Note";
import { Note } from "../entities/Note";

const MARKER_POOL_SIZE = NOTE_POOL_SIZE * 3;

export class NoteSpawner {
  public readonly instancedMesh: THREE.InstancedMesh;
  public readonly markerMesh: THREE.InstancedMesh;

  private readonly notes: Note[] = [];
  private readonly freeIndices: number[] = [];
  private readonly activeIndices: number[] = [];

  private readonly markerZ = new Float32Array(MARKER_POOL_SIZE);
  private readonly markerIsBar = new Uint8Array(MARKER_POOL_SIZE);
  private readonly markerFreeIndices: number[] = [];
  private readonly markerActiveIndices: number[] = [];

  private readonly matrixDummy = new THREE.Object3D();
  private readonly emptyMatrix = new THREE.Matrix4().makeTranslation(0, -1000, 0);

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
  private readonly markerMainColor = new THREE.Color(0xe0f2fe);
  private readonly markerBarColor = new THREE.Color(0xfef9c3);

  public constructor(scene: THREE.Scene) {
    const geometry = new THREE.CylinderGeometry(0.45, 0.45, 0.24, 16);
    this.material = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x22d3ee,
      emissiveIntensity: 0.7,
      metalness: 0.25,
      roughness: 0.35,
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

    const markerGeometry = new THREE.BoxGeometry(LANE_WIDTH * (LANES + 1), 0.12, 0.5);
    const markerMaterial = new THREE.MeshStandardMaterial({
      color: 0xe0f2fe,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.5,
      metalness: 0.15,
      roughness: 0.45,
      vertexColors: true
    });
    this.markerMesh = new THREE.InstancedMesh(markerGeometry, markerMaterial, MARKER_POOL_SIZE);
    this.markerMesh.frustumCulled = false;
    this.markerMesh.renderOrder = 1;

    for (let i = 0; i < MARKER_POOL_SIZE; i += 1) {
      this.markerFreeIndices.push(i);
      this.markerMesh.setMatrixAt(i, this.emptyMatrix);
      this.markerMesh.setColorAt(i, this.markerMainColor);
      this.markerZ[i] = -1000;
      this.markerIsBar[i] = 0;
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
    this.markerMesh.instanceMatrix.needsUpdate = true;
    if (this.markerMesh.instanceColor) {
      this.markerMesh.instanceColor.needsUpdate = true;
    }

    scene.add(this.instancedMesh);
    scene.add(this.markerMesh);
  }

  public updateSpawnEvents(spawns: readonly SpawnEvent[]): void {
    for (let i = 0; i < spawns.length; i += 1) {
      const spawn = spawns[i];
      const note = this.acquireNote();
      if (!note) {
        continue;
      }

      note.spawn(spawn.lane, spawn.type);
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

  public spawnBeatMarkers(markers: readonly BeatMarkerEvent[]): void {
    for (let i = 0; i < markers.length; i += 1) {
      const marker = markers[i];
      const idx = this.acquireMarker();
      if (idx === null) {
        continue;
      }

      this.markerZ[idx] = -SPAWN_DISTANCE;
      this.markerIsBar[idx] = marker.isBarLine ? 1 : 0;
      this.writeMarkerMatrix(idx);
      this.markerMesh.setColorAt(idx, marker.isBarLine ? this.markerBarColor : this.markerMainColor);
      this.markerActiveIndices.push(idx);
    }

    this.markerMesh.instanceMatrix.needsUpdate = true;
    if (this.markerMesh.instanceColor) {
      this.markerMesh.instanceColor.needsUpdate = true;
    }
  }

  public updateActiveNotes(deltaTime: number, trackSpeed: number): void {
    for (let i = this.activeIndices.length - 1; i >= 0; i -= 1) {
      const note = this.notes[this.activeIndices[i]];
      note.updatePosition(deltaTime, trackSpeed);
      this.writeMatrix(note);
    }

    for (let i = this.markerActiveIndices.length - 1; i >= 0; i -= 1) {
      const idx = this.markerActiveIndices[i];
      this.markerZ[idx] += trackSpeed * deltaTime;

      if (this.markerZ[idx] > 5) {
        this.markerMesh.setMatrixAt(idx, this.emptyMatrix);
        this.markerActiveIndices[i] = this.markerActiveIndices[this.markerActiveIndices.length - 1];
        this.markerActiveIndices.pop();
        this.markerFreeIndices.push(idx);
        this.markerIsBar[idx] = 0;
        continue;
      }

      this.writeMarkerMatrix(idx);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.markerMesh.instanceMatrix.needsUpdate = true;
  }

  public setMusicReactiveColor(energy: number, bass: number, treble: number, fever = 0): void {
    this.tempColor.setHSL(0.56 - treble * 0.18 + bass * 0.05 + fever * 0.03, 0.9, 0.45 + energy * 0.15 + fever * 0.12);
    this.material.emissive.copy(this.tempColor);
    this.material.emissiveIntensity = 0.65 + energy * 1.5 + fever * 1.7;
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

    for (let i = this.markerActiveIndices.length - 1; i >= 0; i -= 1) {
      const idx = this.markerActiveIndices[i];
      this.markerMesh.setMatrixAt(idx, this.emptyMatrix);
      this.markerFreeIndices.push(idx);
      this.markerIsBar[idx] = 0;
      this.markerZ[idx] = -1000;
    }

    this.activeIndices.length = 0;
    this.markerActiveIndices.length = 0;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.markerMesh.instanceMatrix.needsUpdate = true;
  }

  private acquireNote(): Note | null {
    const idx = this.freeIndices.pop();
    if (idx === undefined) {
      return null;
    }

    return this.notes[idx];
  }

  private acquireMarker(): number | null {
    const idx = this.markerFreeIndices.pop();
    return idx === undefined ? null : idx;
  }

  private writeMatrix(note: Note): void {
    this.matrixDummy.position.copy(note.mesh.position);
    if (note.type === "slide") {
      this.matrixDummy.rotation.set(0, 0, Math.sin(note.zPosition * 0.25) * 0.32);
      this.matrixDummy.scale.set(1.1, 1, 1.1);
    } else if (note.type === "hold") {
      this.matrixDummy.rotation.set(0, 0, 0);
      this.matrixDummy.scale.set(0.95, 1.05, 1.8);
    } else if (note.type === "double") {
      this.matrixDummy.rotation.set(0, 0, 0);
      this.matrixDummy.scale.set(1.35, 1.05, 1.35);
    } else if (note.type === "mine") {
      this.matrixDummy.rotation.set(0.8, note.zPosition * 0.08, 0.8);
      this.matrixDummy.scale.set(0.78, 0.78, 0.78);
    } else {
      this.matrixDummy.rotation.set(0, 0, 0);
      this.matrixDummy.scale.set(1, 1, 1);
    }
    this.matrixDummy.updateMatrix();
    this.instancedMesh.setMatrixAt(note.instanceId, this.matrixDummy.matrix);
  }

  private writeMarkerMatrix(instanceId: number): void {
    this.matrixDummy.position.set(0, 0.12, this.markerZ[instanceId]);
    this.matrixDummy.rotation.set(0, 0, 0);
    const isBar = this.markerIsBar[instanceId] === 1;
    this.matrixDummy.scale.set(1, isBar ? 1.8 : 1, 1);
    this.matrixDummy.updateMatrix();
    this.markerMesh.setMatrixAt(instanceId, this.matrixDummy.matrix);
  }
}
