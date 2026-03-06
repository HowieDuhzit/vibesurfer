import { HitJudgment } from "./CollisionSystem";

export class ScoreSystem {
  public score = 0;
  public combo = 0;
  public maxCombo = 0;
  public totalNotes = 0;
  public hits = 0;
  public perfect = 0;
  public great = 0;
  public good = 0;
  public misses = 0;
  public lastJudgment: HitJudgment | "miss" | null = null;

  public onNoteCollected(judgment: HitJudgment): void {
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.totalNotes += 1;
    this.hits += 1;
    this.lastJudgment = judgment;

    if (judgment === "perfect") {
      this.perfect += 1;
    } else if (judgment === "great") {
      this.great += 1;
    } else {
      this.good += 1;
    }

    const comboMultiplier = 1 + this.combo * 0.1;
    const base = judgment === "perfect" ? 130 : judgment === "great" ? 100 : 70;
    this.score += base * comboMultiplier;
  }

  public onNoteMissed(): void {
    this.combo = 0;
    this.totalNotes += 1;
    this.misses += 1;
    this.lastJudgment = "miss";
  }

  public getAccuracy(): number {
    if (this.totalNotes === 0) {
      return 0;
    }

    const weighted = this.perfect * 1 + this.great * 0.75 + this.good * 0.45;
    return weighted / this.totalNotes;
  }

  public reset(): void {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.totalNotes = 0;
    this.hits = 0;
    this.perfect = 0;
    this.great = 0;
    this.good = 0;
    this.misses = 0;
    this.lastJudgment = null;
  }

  public update(): void {
    // Reserved for future score-side effects.
  }
}
