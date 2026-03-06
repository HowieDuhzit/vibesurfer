import { HIT_LINE_Z_OFFSET, HIT_WINDOW } from "../core/Config";
import { Player } from "../entities/Player";
import { NoteSpawner } from "../world/NoteSpawner";
import { ScoreSystem } from "./ScoreSystem";

export class CollisionSystem {
  private readonly laneTolerance = 0.55;
  private readonly hitDistance = HIT_WINDOW * 0.6;

  public constructor(
    private readonly player: Player,
    private readonly noteSpawner: NoteSpawner,
    private readonly scoreSystem: ScoreSystem,
    private readonly onCollected: (x: number, y: number, z: number, lane: number) => void
  ) {}

  public update(): void {
    const activeIds = this.noteSpawner.getActiveInstanceIds();
    const playerHitZ = this.player.getZ() + HIT_LINE_Z_OFFSET;
    const playerX = this.player.position.x;

    for (let i = activeIds.length - 1; i >= 0; i -= 1) {
      const note = this.noteSpawner.getNoteByInstanceId(activeIds[i]);
      const distance = Math.abs(playerHitZ - note.zPosition);
      const laneAligned = Math.abs(note.mesh.position.x - playerX) <= this.laneTolerance;

      if (laneAligned && distance <= this.hitDistance) {
        this.scoreSystem.onNoteCollected();
        this.onCollected(note.mesh.position.x, note.mesh.position.y, note.mesh.position.z, note.lane);
        this.noteSpawner.deactivateNote(note);
        continue;
      }

      if (note.zPosition > playerHitZ + HIT_WINDOW) {
        this.scoreSystem.onNoteMissed();
        this.noteSpawner.deactivateNote(note);
      }
    }
  }
}
