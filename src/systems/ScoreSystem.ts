export class ScoreSystem {
  public score = 0;
  public combo = 0;
  public maxCombo = 0;

  public onNoteCollected(): void {
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);

    const comboMultiplier = 1 + this.combo * 0.1;
    this.score += 100 * comboMultiplier;
  }

  public onNoteMissed(): void {
    this.combo = 0;
  }

  public reset(): void {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
  }

  public update(): void {
    // Reserved for future score-side effects.
  }
}
