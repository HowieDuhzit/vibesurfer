import { Game } from "./core/Game";

const mount = document.getElementById("app");
const fileInput = document.getElementById("audio-file") as HTMLInputElement | null;
const playButton = document.getElementById("play-button") as HTMLButtonElement | null;

const scoreLabel = document.getElementById("score");
const comboLabel = document.getElementById("combo");
const maxComboLabel = document.getElementById("max-combo");
const debugLabel = document.getElementById("debug");

if (!mount || !fileInput || !playButton || !scoreLabel || !comboLabel || !maxComboLabel || !debugLabel) {
  throw new Error("Missing required DOM nodes");
}

const game = new Game(mount);
game.start();

let hudRaf = 0;
const updateHud = (): void => {
  const state = game.getScoreState();
  scoreLabel.textContent = `Score: ${state.score}`;
  comboLabel.textContent = `Combo: ${state.combo}`;
  maxComboLabel.textContent = `Max Combo: ${state.maxCombo}`;
  const debug = game.getDebugState();
  debugLabel.textContent = `Playing: ${debug.playing} Pending: ${debug.pendingSpawns} Active: ${debug.activeNotes}`;
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
});

playButton.addEventListener("click", async () => {
  await game.playAudio();
});

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(hudRaf);
  game.stop();
});
