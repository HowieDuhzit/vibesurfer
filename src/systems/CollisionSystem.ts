import { HIT_LINE_Z_OFFSET, HIT_WINDOW } from "../core/Config";
import { NoteType } from "../entities/Note";
import { Player } from "../entities/Player";
import { NoteSpawner } from "../world/NoteSpawner";
import { ScoreSystem } from "./ScoreSystem";

export type HitJudgment = "perfect" | "great" | "good";

export class CollisionSystem {
  private readonly laneTolerance = 0.55;
  private perfectDistance = HIT_WINDOW * 0.2;
  private greatDistance = HIT_WINDOW * 0.38;
  private goodDistance = HIT_WINDOW * 0.6;
  private previousPlayerX = 0;

  public constructor(
    private readonly player: Player,
    private readonly noteSpawner: NoteSpawner,
    private readonly scoreSystem: ScoreSystem,
    private readonly onCollected: (x: number, y: number, z: number, lane: number, judgment: HitJudgment) => void,
    private readonly onMineHit: (x: number, y: number, z: number, lane: number) => void
  ) {}

  public setHitWindow(window: number): void {
    const clamped = Math.max(0.2, window);
    this.perfectDistance = clamped * 0.2;
    this.greatDistance = clamped * 0.38;
    this.goodDistance = clamped * 0.6;
  }

  public update(deltaTime: number): void {
    const activeIds = this.noteSpawner.getActiveInstanceIds();
    const playerHitZ = this.player.getZ() + HIT_LINE_Z_OFFSET;
    const playerX = this.player.position.x;
    const playerLateralSpeed = (playerX - this.previousPlayerX) / Math.max(1e-4, deltaTime);
    this.previousPlayerX = playerX;

    for (let i = activeIds.length - 1; i >= 0; i -= 1) {
      const note = this.noteSpawner.getNoteByInstanceId(activeIds[i]);
      const distance = Math.abs(playerHitZ - note.zPosition);
      const laneAligned = Math.abs(note.mesh.position.x - playerX) <= this.laneTolerance;

      if (laneAligned && note.type === "mine" && distance <= this.goodDistance) {
        this.scoreSystem.onMineHit();
        this.onMineHit(note.mesh.position.x, note.mesh.position.y, note.mesh.position.z, note.lane);
        this.noteSpawner.deactivateNote(note);
        continue;
      }

      const judgment = this.getJudgment(distance);
      if (laneAligned && judgment && note.type !== "mine") {
        const expressive = this.isExpressiveHit(note.type, distance, playerLateralSpeed);
        this.scoreSystem.onNoteCollected(judgment, note.type, expressive);
        this.onCollected(note.mesh.position.x, note.mesh.position.y, note.mesh.position.z, note.lane, judgment);
        this.noteSpawner.deactivateNote(note);
        continue;
      }

      if (note.zPosition > playerHitZ + HIT_WINDOW) {
        this.scoreSystem.onNoteMissed();
        this.noteSpawner.deactivateNote(note);
      }
    }
  }

  private getJudgment(distance: number): HitJudgment | null {
    if (distance <= this.perfectDistance) {
      return "perfect";
    }
    if (distance <= this.greatDistance) {
      return "great";
    }
    if (distance <= this.goodDistance) {
      return "good";
    }
    return null;
  }

  private isExpressiveHit(noteType: NoteType, distance: number, lateralSpeed: number): boolean {
    if (noteType === "slide") {
      return Math.abs(lateralSpeed) > 2.4 && distance <= this.greatDistance;
    }
    if (noteType === "hold") {
      return distance <= this.perfectDistance * 1.2;
    }
    if (noteType === "double") {
      return distance <= this.greatDistance;
    }
    return false;
  }
}
