import { DifficultyMode, Game } from "./core/Game";

const mount = document.getElementById("app");
const fileInput = document.getElementById("audio-file") as HTMLInputElement | null;
const playButton = document.getElementById("play-button") as HTMLButtonElement | null;
const compactToggle = document.getElementById("compact-toggle") as HTMLButtonElement | null;
const difficultySelect = document.getElementById("difficulty") as HTMLSelectElement | null;
const timingOffsetInput = document.getElementById("timing-offset") as HTMLInputElement | null;
const timingOffsetLabel = document.getElementById("timing-offset-label");

const scoreLabel = document.getElementById("score");
const comboLabel = document.getElementById("combo");
const maxComboLabel = document.getElementById("max-combo");
const accuracyLabel = document.getElementById("accuracy");
const breakdownLabel = document.getElementById("breakdown");
const debugLabel = document.getElementById("debug");
const judgmentLabel = document.getElementById("judgment");

const resultPanel = document.getElementById("result");
const resultScore = document.getElementById("result-score");
const resultMedal = document.getElementById("result-medal");
const resultPersonalBest = document.getElementById("result-personal-best");
const resultAccuracy = document.getElementById("result-accuracy");
const resultMaxCombo = document.getElementById("result-max-combo");
const resultBreakdown = document.getElementById("result-breakdown");

if (
  !mount
  || !fileInput
  || !playButton
  || !compactToggle
  || !difficultySelect
  || !timingOffsetInput
  || !timingOffsetLabel
  || !scoreLabel
  || !comboLabel
  || !maxComboLabel
  || !accuracyLabel
  || !breakdownLabel
  || !debugLabel
  || !judgmentLabel
  || !resultPanel
  || !resultScore
  || !resultMedal
  || !resultPersonalBest
  || !resultAccuracy
  || !resultMaxCombo
  || !resultBreakdown
) {
  throw new Error("Missing required DOM nodes");
}

const game = new Game(mount);
game.start();

const PB_KEY = "vibesurfer_personal_best";
const COMPACT_KEY = "vibesurfer_hud_compact";
let personalBest = Number(localStorage.getItem(PB_KEY) || "0");

const hudElement = document.getElementById("hud");
if (hudElement && localStorage.getItem(COMPACT_KEY) === "1") {
  hudElement.classList.add("compact");
}

let hudRaf = 0;
const updateHud = (): void => {
  const state = game.getScoreState();
  scoreLabel.textContent = `Score: ${state.score}`;
  comboLabel.textContent = `Combo: ${state.combo}`;
  maxComboLabel.textContent = `Max Combo: ${state.maxCombo}`;
  accuracyLabel.textContent = `Accuracy: ${(state.accuracy * 100).toFixed(1)}%`;
  breakdownLabel.textContent = `P:${state.perfect} G:${state.great} g:${state.good} M:${state.miss}`;

  judgmentLabel.textContent = state.judgment;
  judgmentLabel.classList.toggle("show", state.judgmentVisible);

  const debug = game.getDebugState();
  debugLabel.textContent = `Playing: ${debug.playing} Pending: ${debug.pendingSpawns} Active: ${debug.activeNotes} Progress: ${(debug.progress * 100).toFixed(1)}%`;

  const result = game.getResultState();
  resultPanel.classList.toggle("show", result.complete);
  resultScore.textContent = `Score: ${result.score}`;
  const medal = result.accuracy >= 0.92 ? "S" : result.accuracy >= 0.82 ? "A" : result.accuracy >= 0.68 ? "B" : "C";
  resultMedal.textContent = `Medal: ${medal}`;

  if (result.complete && result.score > personalBest) {
    personalBest = result.score;
    localStorage.setItem(PB_KEY, String(personalBest));
  }

  resultPersonalBest.textContent = `Personal Best: ${personalBest}`;
  resultAccuracy.textContent = `Accuracy: ${(result.accuracy * 100).toFixed(1)}%`;
  resultMaxCombo.textContent = `Max Combo: ${result.maxCombo}`;
  resultBreakdown.textContent = `P:${result.perfect} G:${result.great} g:${result.good} M:${result.miss}`;

  hudRaf = requestAnimationFrame(updateHud);
};

hudRaf = requestAnimationFrame(updateHud);

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  await game.loadAudioFile(file);
  playButton.disabled = false;
  resultPanel.classList.remove("show");
});

playButton.addEventListener("click", async () => {
  await game.playAudio();
});

compactToggle.addEventListener("click", () => {
  if (!hudElement) {
    return;
  }
  hudElement.classList.toggle("compact");
  localStorage.setItem(COMPACT_KEY, hudElement.classList.contains("compact") ? "1" : "0");
});

difficultySelect.addEventListener("change", () => {
  game.setDifficulty(difficultySelect.value as DifficultyMode);
});

timingOffsetInput.addEventListener("input", () => {
  const ms = Number(timingOffsetInput.value);
  timingOffsetLabel.textContent = `${ms}ms`;
  game.setTimingOffsetMs(ms);
});

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(hudRaf);
  game.stop();
});
