import { TRACK_SPEED } from "../core/Config";
import { Player } from "../entities/Player";
import { Track } from "../world/Track";
import { NoteSpawner } from "../world/NoteSpawner";

export class MovementSystem {
  public constructor(
    private readonly player: Player,
    private readonly track: Track,
    private readonly noteSpawner: NoteSpawner
  ) {}

  public update(deltaTime: number): void {
    this.player.update();
    this.track.update(deltaTime);
    this.noteSpawner.updateActiveNotes(deltaTime, TRACK_SPEED);
  }
}
