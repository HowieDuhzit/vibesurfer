import { DifficultyMode, Game, GameMode, QualityMode } from "./core/Game";

interface Profile {
  totalPlays: number;
  clears: number;
  bestAccuracy: number;
  bestCombo: number;
  totalScore: number;
  missions: {
    combo50: boolean;
    combo100: boolean;
    accuracy90: boolean;
  };
}

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing required DOM node: ${id}`);
  }
  return node as T;
};

const mount = byId<HTMLElement>("app");
const fileInput = byId<HTMLInputElement>("audio-file");
const playButton = byId<HTMLButtonElement>("play-button");
const compactToggle = byId<HTMLButtonElement>("compact-toggle");
const gameModeSelect = byId<HTMLSelectElement>("game-mode");
const difficultySelect = byId<HTMLSelectElement>("difficulty");
const strictModeInput = byId<HTMLInputElement>("strict-mode");
const mirrorLanesInput = byId<HTMLInputElement>("mirror-lanes");
const timingOffsetInput = byId<HTMLInputElement>("timing-offset");
const timingOffsetLabel = byId<HTMLSpanElement>("timing-offset-label");
const seedInput = byId<HTMLInputElement>("seed-input");
const applySeedButton = byId<HTMLButtonElement>("apply-seed");
const calibrateButton = byId<HTMLButtonElement>("calibrate-btn");
const practiceSpeedInput = byId<HTMLInputElement>("practice-speed");
const practiceSpeedLabel = byId<HTMLSpanElement>("practice-speed-label");
const loopStartInput = byId<HTMLInputElement>("loop-start");
const loopEndInput = byId<HTMLInputElement>("loop-end");
const applyLoopButton = byId<HTMLButtonElement>("apply-loop");
const clearLoopButton = byId<HTMLButtonElement>("clear-loop");
const qualityModeSelect = byId<HTMLSelectElement>("quality-mode");
const fxIntensityInput = byId<HTMLInputElement>("fx-intensity");
const fxIntensityLabel = byId<HTMLSpanElement>("fx-intensity-label");
const laneToleranceInput = byId<HTMLInputElement>("lane-tolerance");
const laneToleranceLabel = byId<HTMLSpanElement>("lane-tolerance-label");
const cameraPulseInput = byId<HTMLInputElement>("camera-pulse");
const metronomeEnabledInput = byId<HTMLInputElement>("metronome-enabled");
const metronomeBpmInput = byId<HTMLInputElement>("metronome-bpm");
const touchZonesToggle = byId<HTMLInputElement>("touch-zones-toggle");
const touchZones = byId<HTMLDivElement>("touch-zones");
const touchLane0 = byId<HTMLButtonElement>("touch-lane-0");
const touchLane1 = byId<HTMLButtonElement>("touch-lane-1");
const touchLane2 = byId<HTMLButtonElement>("touch-lane-2");

const scoreLabel = byId<HTMLSpanElement>("score");
const comboLabel = byId<HTMLSpanElement>("combo");
const maxComboLabel = byId<HTMLSpanElement>("max-combo");
const feverLabel = byId<HTMLSpanElement>("fever");
const accuracyLabel = byId<HTMLSpanElement>("accuracy");
const breakdownLabel = byId<HTMLSpanElement>("breakdown");
const chartSummaryLabel = byId<HTMLSpanElement>("chart-summary");
const profileSummaryLabel = byId<HTMLSpanElement>("profile-summary");
const missionSummaryLabel = byId<HTMLSpanElement>("mission-summary");
const debugLabel = byId<HTMLDivElement>("debug");
const judgmentLabel = byId<HTMLDivElement>("judgment");

const resultPanel = byId<HTMLDivElement>("result");
const resultScore = byId<HTMLSpanElement>("result-score");
const resultMedal = byId<HTMLSpanElement>("result-medal");
const resultPersonalBest = byId<HTMLSpanElement>("result-personal-best");
const resultAccuracy = byId<HTMLSpanElement>("result-accuracy");
const resultMaxCombo = byId<HTMLSpanElement>("result-max-combo");
const resultBreakdown = byId<HTMLSpanElement>("result-breakdown");
const resultTypes = byId<HTMLSpanElement>("result-types");
const resultTech = byId<HTMLSpanElement>("result-tech");

const game = new Game(mount);
game.start();

const PB_KEY = "vibesurfer_personal_best";
const COMPACT_KEY = "vibesurfer_hud_compact";
const QUALITY_KEY = "vibesurfer_quality";
const FX_KEY = "vibesurfer_fx";
const LANE_TOLERANCE_KEY = "vibesurfer_lane_tolerance";
const PROFILE_KEY = "vibesurfer_profile";
const CAMERA_PULSE_KEY = "vibesurfer_camera_pulse";
const TOUCH_ZONES_KEY = "vibesurfer_touch_zones";
const MIRROR_KEY = "vibesurfer_mirror";
const STRICT_KEY = "vibesurfer_strict";

let personalBest = Number(localStorage.getItem(PB_KEY) || "0");
let previousResultComplete = false;

const loadProfile = (): Profile => {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) {
      throw new Error("none");
    }
    const parsed = JSON.parse(raw) as Profile;
    return {
      totalPlays: parsed.totalPlays ?? 0,
      clears: parsed.clears ?? 0,
      bestAccuracy: parsed.bestAccuracy ?? 0,
      bestCombo: parsed.bestCombo ?? 0,
      totalScore: parsed.totalScore ?? 0,
      missions: {
        combo50: parsed.missions?.combo50 ?? false,
        combo100: parsed.missions?.combo100 ?? false,
        accuracy90: parsed.missions?.accuracy90 ?? false
      }
    };
  } catch {
    return {
      totalPlays: 0,
      clears: 0,
      bestAccuracy: 0,
      bestCombo: 0,
      totalScore: 0,
      missions: {
        combo50: false,
        combo100: false,
        accuracy90: false
      }
    };
  }
};

const profile = loadProfile();

const saveProfile = (): void => {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
};

const hudElement = byId<HTMLDivElement>("hud");
if (localStorage.getItem(COMPACT_KEY) === "1") {
  hudElement.classList.add("compact");
}

const savedQuality = (localStorage.getItem(QUALITY_KEY) as QualityMode | null) ?? "auto";
qualityModeSelect.value = savedQuality;
game.setQualityMode(savedQuality);

const savedFx = Number(localStorage.getItem(FX_KEY) || "100");
fxIntensityInput.value = String(savedFx);
fxIntensityLabel.textContent = `${savedFx}%`;
game.setEffectIntensity(savedFx / 100);

const savedLaneTol = Number(localStorage.getItem(LANE_TOLERANCE_KEY) || "55");
laneToleranceInput.value = String(savedLaneTol);
laneToleranceLabel.textContent = `${savedLaneTol}%`;
game.setLaneTolerance(savedLaneTol / 100);

const savedCameraPulse = localStorage.getItem(CAMERA_PULSE_KEY) !== "0";
cameraPulseInput.checked = savedCameraPulse;
game.setCameraPulseEnabled(savedCameraPulse);

const savedTouchZones = localStorage.getItem(TOUCH_ZONES_KEY) === "1";
touchZonesToggle.checked = savedTouchZones;
touchZones.classList.toggle("show", savedTouchZones);
game.setSwipeEnabled(!savedTouchZones);

const savedMirror = localStorage.getItem(MIRROR_KEY) === "1";
mirrorLanesInput.checked = savedMirror;
game.setMirrorLanes(savedMirror);

const savedStrict = localStorage.getItem(STRICT_KEY) === "1";
strictModeInput.checked = savedStrict;
game.setStrictMode(savedStrict);

const updateProfileUi = (): void => {
  profileSummaryLabel.textContent = `Profile Plays:${profile.totalPlays} Clears:${profile.clears} BestAcc:${(profile.bestAccuracy * 100).toFixed(1)}% BestCombo:${profile.bestCombo}`;
  missionSummaryLabel.textContent = `Missions 50:${profile.missions.combo50 ? "Y" : "N"} 100:${profile.missions.combo100 ? "Y" : "N"} Acc90:${profile.missions.accuracy90 ? "Y" : "N"}`;
};

updateProfileUi();

let calibrating = false;
const calibrationDeltas: number[] = [];

const pushCalibrationTap = (): void => {
  if (!calibrating) {
    return;
  }

  const delta = game.getNearestBeatDeltaSeconds(game.getCurrentAudioTime());
  if (delta === null) {
    return;
  }

  calibrationDeltas.push(delta);
  calibrateButton.textContent = `Calibrating ${calibrationDeltas.length}/8`;

  if (calibrationDeltas.length >= 8) {
    const avg = calibrationDeltas.reduce((a, b) => a + b, 0) / calibrationDeltas.length;
    const corrected = Math.round(game.getTimingOffsetMs() + avg * 1000);
    game.setTimingOffsetMs(corrected);
    timingOffsetInput.value = String(corrected);
    timingOffsetLabel.textContent = `${corrected}ms`;
    calibrating = false;
    calibrationDeltas.length = 0;
    calibrateButton.textContent = "Calibrate";
  }
};

mount.addEventListener("pointerdown", pushCalibrationTap);
window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    pushCalibrationTap();
  }
});

let hudRaf = 0;
const updateHud = (): void => {
  const state = game.getScoreState();
  scoreLabel.textContent = `Score: ${state.score}`;
  comboLabel.textContent = `Combo: ${state.combo}`;
  maxComboLabel.textContent = `Max Combo: ${state.maxCombo}`;
  feverLabel.textContent = `Fever: ${(state.fever * 100).toFixed(0)}%`;
  accuracyLabel.textContent = `Accuracy: ${(state.accuracy * 100).toFixed(1)}%`;
  breakdownLabel.textContent = `P:${state.perfect} G:${state.great} g:${state.good} M:${state.miss}`;

  judgmentLabel.textContent = state.judgment;
  judgmentLabel.classList.toggle("show", state.judgmentVisible);

  const chart = game.getChartPreviewSummary();
  chartSummaryLabel.textContent = `Chart N:${chart.total} NPS:${chart.nps.toFixed(2)} L:${chart.lane0}/${chart.lane1}/${chart.lane2} T/H/S/D/M:${chart.taps}/${chart.holds}/${chart.slides}/${chart.doubles}/${chart.mines}`;

  const debug = game.getDebugState();
  debugLabel.textContent = `Playing:${debug.playing} Pending:${debug.pendingSpawns} Active:${debug.activeNotes} Progress:${(debug.progress * 100).toFixed(1)}% Q:${qualityModeSelect.value}`;

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
  resultTypes.textContent = `Tap:${result.tapHits} Hold:${result.holdHits} Slide:${result.slideHits} Double:${result.doubleHits} Mines:${result.mineHits}`;
  resultTech.textContent = `Hold C/B:${result.holdCompleted}/${result.holdBroken} Slide C/B:${result.slideCompleted}/${result.slideBroken}`;

  if (result.complete && !previousResultComplete) {
    profile.clears += 1;
    profile.totalScore += result.score;
    profile.bestAccuracy = Math.max(profile.bestAccuracy, result.accuracy);
    profile.bestCombo = Math.max(profile.bestCombo, result.maxCombo);
    profile.missions.combo50 = profile.missions.combo50 || result.maxCombo >= 50;
    profile.missions.combo100 = profile.missions.combo100 || result.maxCombo >= 100;
    profile.missions.accuracy90 = profile.missions.accuracy90 || result.accuracy >= 0.9;
    saveProfile();
    updateProfileUi();
  }
  previousResultComplete = result.complete;

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
  profile.totalPlays += 1;
  saveProfile();
  updateProfileUi();
  await game.playAudio();
});

compactToggle.addEventListener("click", () => {
  hudElement.classList.toggle("compact");
  localStorage.setItem(COMPACT_KEY, hudElement.classList.contains("compact") ? "1" : "0");
});

gameModeSelect.addEventListener("change", () => {
  game.setGameMode(gameModeSelect.value as GameMode);
});

difficultySelect.addEventListener("change", () => {
  game.setDifficulty(difficultySelect.value as DifficultyMode);
});

strictModeInput.addEventListener("change", () => {
  game.setStrictMode(strictModeInput.checked);
  localStorage.setItem(STRICT_KEY, strictModeInput.checked ? "1" : "0");
});

mirrorLanesInput.addEventListener("change", () => {
  game.setMirrorLanes(mirrorLanesInput.checked);
  localStorage.setItem(MIRROR_KEY, mirrorLanesInput.checked ? "1" : "0");
});

timingOffsetInput.addEventListener("input", () => {
  const ms = Number(timingOffsetInput.value);
  timingOffsetLabel.textContent = `${ms}ms`;
  game.setTimingOffsetMs(ms);
});

applySeedButton.addEventListener("click", () => {
  const seed = Number(seedInput.value || "123456789");
  game.setSeed(seed);
});

calibrateButton.addEventListener("click", () => {
  calibrating = !calibrating;
  calibrationDeltas.length = 0;
  calibrateButton.textContent = calibrating ? "Calibrating 0/8" : "Calibrate";
});

practiceSpeedInput.addEventListener("input", () => {
  const speed = Number(practiceSpeedInput.value);
  practiceSpeedLabel.textContent = `${speed}%`;
  game.setPracticeSpeed(speed / 100);
});

applyLoopButton.addEventListener("click", () => {
  const start = Number(loopStartInput.value || "0");
  const end = Number(loopEndInput.value || "0");
  game.setLoopRange(start, end);
});

clearLoopButton.addEventListener("click", () => {
  game.clearLoopRange();
  loopStartInput.value = "0";
  loopEndInput.value = "0";
});

qualityModeSelect.addEventListener("change", () => {
  const mode = qualityModeSelect.value as QualityMode;
  game.setQualityMode(mode);
  localStorage.setItem(QUALITY_KEY, mode);
});

fxIntensityInput.addEventListener("input", () => {
  const pct = Number(fxIntensityInput.value);
  fxIntensityLabel.textContent = `${pct}%`;
  game.setEffectIntensity(pct / 100);
  localStorage.setItem(FX_KEY, String(pct));
});

laneToleranceInput.addEventListener("input", () => {
  const pct = Number(laneToleranceInput.value);
  laneToleranceLabel.textContent = `${pct}%`;
  game.setLaneTolerance(pct / 100);
  localStorage.setItem(LANE_TOLERANCE_KEY, String(pct));
});

cameraPulseInput.addEventListener("change", () => {
  game.setCameraPulseEnabled(cameraPulseInput.checked);
  localStorage.setItem(CAMERA_PULSE_KEY, cameraPulseInput.checked ? "1" : "0");
});

metronomeEnabledInput.addEventListener("change", () => {
  game.setMetronomeEnabled(metronomeEnabledInput.checked);
});

metronomeBpmInput.addEventListener("input", () => {
  game.setMetronomeBpm(Number(metronomeBpmInput.value || "120"));
});

touchZonesToggle.addEventListener("change", () => {
  touchZones.classList.toggle("show", touchZonesToggle.checked);
  game.setSwipeEnabled(!touchZonesToggle.checked);
  localStorage.setItem(TOUCH_ZONES_KEY, touchZonesToggle.checked ? "1" : "0");
});

const bindTouchLane = (button: HTMLButtonElement, lane: number): void => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    game.setAbsoluteLane(lane);
  });
};

bindTouchLane(touchLane0, 0);
bindTouchLane(touchLane1, 1);
bindTouchLane(touchLane2, 2);

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(hudRaf);
  game.stop();
});
