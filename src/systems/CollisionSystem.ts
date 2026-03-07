import { HIT_LINE_Z_OFFSET, HIT_WINDOW, LANE_WIDTH } from "../core/Config";
import { NoteType } from "../entities/Note";
import { Player } from "../entities/Player";
import { NoteSpawner } from "../world/NoteSpawner";
import { ScoreSystem } from "./ScoreSystem";

export type HitJudgment = "perfect" | "great" | "good";

interface ActiveHold {
  lane: number;
  remaining: number;
  grace: number;
}

interface ActiveSlide {
  fromLane: number;
  toLane: number;
  remaining: number;
  requiredDirection: number;
}

export class CollisionSystem {
  private laneTolerance = 0.55;
  private perfectDistance = HIT_WINDOW * 0.2;
  private greatDistance = HIT_WINDOW * 0.38;
  private goodDistance = HIT_WINDOW * 0.6;
  private previousPlayerX = 0;

  private readonly activeHolds: ActiveHold[] = [];
  private readonly activeSlides: ActiveSlide[] = [];

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

  public setLaneTolerance(tolerance: number): void {
    this.laneTolerance = Math.max(0.3, Math.min(1.2, tolerance));
  }

  public update(deltaTime: number): void {
    const playerHitZ = this.player.getZ() + HIT_LINE_Z_OFFSET;
    const playerX = this.player.position.x;
    const playerLateralSpeed = (playerX - this.previousPlayerX) / Math.max(1e-4, deltaTime);
    this.previousPlayerX = playerX;

    this.updateActiveHolds(deltaTime, playerX);
    this.updateActiveSlides(deltaTime, playerX, playerLateralSpeed);

    const activeIds = this.noteSpawner.getActiveInstanceIds();

    for (let i = activeIds.length - 1; i >= 0; i -= 1) {
      const note = this.noteSpawner.getNoteByInstanceId(activeIds[i]);
      const distance = Math.abs(playerHitZ - note.zPosition);
      const noteLaneX = this.laneToX(note.lane);
      const laneAligned = Math.abs(noteLaneX - playerX) <= this.laneTolerance;

      if (laneAligned && note.type === "mine" && distance <= this.goodDistance) {
        this.scoreSystem.onMineHit();
        this.onMineHit(note.mesh.position.x, note.mesh.position.y, note.mesh.position.z, note.lane);
        this.noteSpawner.deactivateNote(note);
        continue;
      }

      const judgment = this.getJudgment(distance);
      if (laneAligned && judgment && note.type !== "mine") {
        if (note.type === "hold") {
          this.scoreSystem.onNoteCollected(judgment, "hold", distance <= this.greatDistance);
          this.activeHolds.push({ lane: note.lane, remaining: Math.max(0.14, note.duration), grace: 0.12 });
          this.onCollected(note.mesh.position.x, note.mesh.position.y, note.mesh.position.z, note.lane, judgment);
          this.noteSpawner.deactivateNote(note);
          continue;
        }

        if (note.type === "slide") {
          this.scoreSystem.onNoteCollected(judgment, "slide", false);
          this.activeSlides.push({
            fromLane: note.lane,
            toLane: note.slideToLane,
            remaining: Math.max(0.14, note.duration),
            requiredDirection: Math.sign(note.slideToLane - note.lane)
          });
          this.onCollected(note.mesh.position.x, note.mesh.position.y, note.mesh.position.z, note.lane, judgment);
          this.noteSpawner.deactivateNote(note);
          continue;
        }

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

  private updateActiveHolds(deltaTime: number, playerX: number): void {
    for (let i = this.activeHolds.length - 1; i >= 0; i -= 1) {
      const hold = this.activeHolds[i];
      const laneX = this.laneToX(hold.lane);
      const aligned = Math.abs(playerX - laneX) <= this.laneTolerance;

      hold.remaining -= deltaTime;
      if (aligned) {
        hold.grace = Math.min(0.12, hold.grace + deltaTime * 0.5);
      } else {
        hold.grace -= deltaTime;
      }

      if (hold.remaining <= 0) {
        this.scoreSystem.onHoldCompleted();
        this.activeHolds.splice(i, 1);
        continue;
      }

      if (hold.grace <= 0) {
        this.scoreSystem.onHoldBroken();
        this.activeHolds.splice(i, 1);
      }
    }
  }

  private updateActiveSlides(deltaTime: number, playerX: number, playerLateralSpeed: number): void {
    for (let i = this.activeSlides.length - 1; i >= 0; i -= 1) {
      const slide = this.activeSlides[i];
      const targetX = this.laneToX(slide.toLane);
      const directionOk = Math.sign(playerLateralSpeed) === slide.requiredDirection || Math.abs(playerLateralSpeed) < 0.25;

      slide.remaining -= deltaTime;
      if (Math.abs(playerX - targetX) <= this.laneTolerance && directionOk) {
        this.scoreSystem.onSlideCompleted();
        this.activeSlides.splice(i, 1);
        continue;
      }

      if (slide.remaining <= 0) {
        this.scoreSystem.onSlideBroken();
        this.activeSlides.splice(i, 1);
      }
    }
  }

  private laneToX(lane: number): number {
    return (lane - 1) * LANE_WIDTH;
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
