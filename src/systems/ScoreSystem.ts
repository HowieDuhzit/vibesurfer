import { NoteType } from "../entities/Note";
import { HitJudgment } from "./CollisionSystem";

type RideStyle = "flow" | "burst" | "technical";
type RulesetMode = "cruise" | "precision" | "assault";

export class ScoreSystem {
  private rideStyle: RideStyle = "flow";
  private ruleset: RulesetMode = "cruise";
  public score = 0;
  public combo = 0;
  public maxCombo = 0;
  public totalNotes = 0;
  public hits = 0;
  public perfect = 0;
  public great = 0;
  public good = 0;
  public misses = 0;
  public mineHits = 0;
  public holdCompleted = 0;
  public holdBroken = 0;
  public slideCompleted = 0;
  public slideBroken = 0;
  public tapHits = 0;
  public holdHits = 0;
  public slideHits = 0;
  public doubleHits = 0;
  public lastJudgment: HitJudgment | "miss" | null = null;

  public onNoteCollected(judgment: HitJudgment, noteType: NoteType, expressiveHit: boolean): void {
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

    if (noteType === "hold") {
      this.holdHits += 1;
    } else if (noteType === "slide") {
      this.slideHits += 1;
    } else if (noteType === "double") {
      this.doubleHits += 1;
    } else {
      this.tapHits += 1;
    }

    const comboMultiplier = this.rideStyle === "flow"
      ? 1 + this.combo * 0.115
      : this.rideStyle === "burst"
        ? 1 + this.combo * 0.09
        : 1 + this.combo * 0.1;
    const base = judgment === "perfect" ? 130 : judgment === "great" ? 100 : 70;
    const noteTypeMult = this.getNoteTypeMultiplier(noteType);
    const expressiveBonus = expressiveHit ? (this.rideStyle === "technical" ? 55 : 35) : 0;
    const rulesetBonus = this.ruleset === "precision"
      ? judgment === "perfect" ? 30 : 10
      : this.ruleset === "assault"
        ? noteType === "double" || noteType === "slide" ? 26 : 8
        : noteType === "hold" ? 18 : 0;
    this.score += base * comboMultiplier * noteTypeMult + expressiveBonus + rulesetBonus;
  }

  public onNoteMissed(): void {
    this.combo = 0;
    this.totalNotes += 1;
    this.misses += 1;
    this.lastJudgment = "miss";
  }

  public onMineHit(): void {
    this.combo = 0;
    this.mineHits += 1;
    const penaltyBase = this.rideStyle === "technical" ? 280 : this.rideStyle === "burst" ? 180 : 220;
    const penalty = this.ruleset === "assault" ? Math.round(penaltyBase * 0.85) : this.ruleset === "precision" ? Math.round(penaltyBase * 1.15) : penaltyBase;
    this.score = Math.max(0, this.score - penalty);
    this.lastJudgment = "miss";
  }

  public onHoldCompleted(): void {
    this.holdCompleted += 1;
    const bonus = this.rideStyle === "flow" ? 130 : this.rideStyle === "technical" ? 95 : 80;
    this.score += bonus + this.combo * 2.2;
  }

  public onHoldBroken(): void {
    this.combo = 0;
    this.holdBroken += 1;
    this.misses += 1;
    this.totalNotes += 1;
    this.lastJudgment = "miss";
  }

  public onSlideCompleted(): void {
    this.slideCompleted += 1;
    const bonus = this.rideStyle === "technical" ? 145 : this.rideStyle === "burst" ? 120 : 105;
    this.score += bonus + this.combo * 2.6;
  }

  public setRideStyle(rideStyle: RideStyle): void {
    this.rideStyle = rideStyle;
  }

  public setRuleset(ruleset: RulesetMode): void {
    this.ruleset = ruleset;
  }

  public onSlideBroken(): void {
    this.combo = 0;
    this.slideBroken += 1;
    this.misses += 1;
    this.totalNotes += 1;
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
    this.mineHits = 0;
    this.holdCompleted = 0;
    this.holdBroken = 0;
    this.slideCompleted = 0;
    this.slideBroken = 0;
    this.tapHits = 0;
    this.holdHits = 0;
    this.slideHits = 0;
    this.doubleHits = 0;
    this.lastJudgment = null;
  }

  public update(): void {
    // Reserved for future score-side effects.
  }

  private getNoteTypeMultiplier(noteType: NoteType): number {
    if (this.ruleset === "precision") {
      if (noteType === "slide") {
        return 1.55;
      }
      if (noteType === "hold") {
        return 1.14;
      }
      if (noteType === "double") {
        return 1.34;
      }
      return 1.08;
    }

    if (this.ruleset === "assault") {
      if (noteType === "double") {
        return 1.82;
      }
      if (noteType === "mine") {
        return 0.9;
      }
      if (noteType === "slide") {
        return 1.3;
      }
      return 1.12;
    }

    if (this.rideStyle === "flow") {
      if (noteType === "hold") {
        return 1.55;
      }
      if (noteType === "slide") {
        return 1.32;
      }
      if (noteType === "double") {
        return 1.3;
      }
      return 1;
    }

    if (this.rideStyle === "burst") {
      if (noteType === "double") {
        return 1.72;
      }
      if (noteType === "tap") {
        return 1.08;
      }
      if (noteType === "slide") {
        return 1.22;
      }
      return 1.12;
    }

    if (noteType === "slide") {
      return 1.42;
    }
    if (noteType === "hold") {
      return 1.22;
    }
    if (noteType === "double") {
      return 1.46;
    }
    return 1.05;
  }
}
