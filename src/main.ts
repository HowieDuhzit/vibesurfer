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

type MenuTab = "start" | "settings" | "profile";

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing required DOM node: ${id}`);
  }
  return node as T;
};

const mount = byId<HTMLElement>("app");
const mainMenu = byId<HTMLDivElement>("main-menu");
const closeMenuBtn = byId<HTMLButtonElement>("close-menu");
const openMenuBtn = byId<HTMLButtonElement>("open-menu-btn");
const tabStartBtn = byId<HTMLButtonElement>("tab-start");
const tabSettingsBtn = byId<HTMLButtonElement>("tab-settings");
const tabProfileBtn = byId<HTMLButtonElement>("tab-profile");
const panelStart = byId<HTMLElement>("panel-start");
const panelSettings = byId<HTMLElement>("panel-settings");
const panelProfile = byId<HTMLElement>("panel-profile");

const fileInput = byId<HTMLInputElement>("audio-file");
const playButton = byId<HTMLButtonElement>("play-button");
const gameModeSelect = byId<HTMLSelectElement>("game-mode");
const difficultySelect = byId<HTMLSelectElement>("difficulty");
const strictModeInput = byId<HTMLInputElement>("strict-mode");
const mirrorLanesInput = byId<HTMLInputElement>("mirror-lanes");
const seedInput = byId<HTMLInputElement>("seed-input");
const applySeedButton = byId<HTMLButtonElement>("apply-seed");
const chartSummaryLabel = byId<HTMLDivElement>("chart-summary");
const analysisCanvas = byId<HTMLCanvasElement>("analysis-canvas");
const analysisMetaLabel = byId<HTMLDivElement>("analysis-meta");

const timingOffsetInput = byId<HTMLInputElement>("timing-offset");
const timingOffsetLabel = byId<HTMLSpanElement>("timing-offset-label");
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

const scoreLabel = byId<HTMLSpanElement>("score");
const comboLabel = byId<HTMLSpanElement>("combo");
const accuracyLabel = byId<HTMLSpanElement>("accuracy");
const profileSummaryLabel = byId<HTMLDivElement>("profile-summary");
const missionSummaryLabel = byId<HTMLDivElement>("mission-summary");
const sessionSummaryLabel = byId<HTMLDivElement>("session-summary");
const goalSummaryLabel = byId<HTMLDivElement>("goal-summary");
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
const resultMenuBtn = byId<HTMLButtonElement>("result-menu-btn");

const touchZones = byId<HTMLDivElement>("touch-zones");
const touchLane0 = byId<HTMLButtonElement>("touch-lane-0");
const touchLane1 = byId<HTMLButtonElement>("touch-lane-1");
const touchLane2 = byId<HTMLButtonElement>("touch-lane-2");

const game = new Game(mount);
game.start();

const PB_KEY = "vibesurfer_personal_best";
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
const session = {
  plays: 0,
  clears: 0,
  bestCombo: 0
};

const saveProfile = (): void => {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
};

const setMenuOpen = (open: boolean): void => {
  mainMenu.classList.toggle("hidden", !open);
  if (!open) {
    resultPanel.classList.remove("show");
  }
};

const setTab = (tab: MenuTab): void => {
  panelStart.classList.toggle("active", tab === "start");
  panelSettings.classList.toggle("active", tab === "settings");
  panelProfile.classList.toggle("active", tab === "profile");
};

const updateProfileUi = (): void => {
  profileSummaryLabel.textContent = `Profile Plays:${profile.totalPlays} Clears:${profile.clears} BestAcc:${(profile.bestAccuracy * 100).toFixed(1)}% BestCombo:${profile.bestCombo}`;
  missionSummaryLabel.textContent = `Missions 50:${profile.missions.combo50 ? "Y" : "N"} 100:${profile.missions.combo100 ? "Y" : "N"} Acc90:${profile.missions.accuracy90 ? "Y" : "N"}`;
  sessionSummaryLabel.textContent = `Session Plays:${session.plays} Clears:${session.clears} BestCombo:${session.bestCombo}`;

  const nextComboGoal = profile.missions.combo100 ? "All Major Combo Goals Complete" : profile.missions.combo50 ? "Next: 100 Combo" : "Next: 50 Combo";
  const nextAccGoal = profile.missions.accuracy90 ? "Accuracy Goal Complete" : "Next: 90% Accuracy";
  goalSummaryLabel.textContent = `Goals ${nextComboGoal} | ${nextAccGoal}`;
};

updateProfileUi();

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
  accuracyLabel.textContent = `Acc: ${(state.accuracy * 100).toFixed(1)}%`;

  judgmentLabel.textContent = state.judgment;
  judgmentLabel.classList.toggle("show", state.judgmentVisible);

  const chart = game.getChartPreviewSummary();
  chartSummaryLabel.textContent = `Chart N:${chart.total} NPS:${chart.nps.toFixed(2)} L:${chart.lane0}/${chart.lane1}/${chart.lane2} T/H/S/D/M:${chart.taps}/${chart.holds}/${chart.slides}/${chart.doubles}/${chart.mines}`;
  drawAnalysisDebug();

  const debug = game.getDebugState();
  const perf = game.getPerformanceState();
  debugLabel.textContent = `Playing:${debug.playing} Pending:${debug.pendingSpawns} Active:${debug.activeNotes} Progress:${(debug.progress * 100).toFixed(1)}% Q:${qualityModeSelect.value}/${perf.qualityScale.toFixed(2)} FPS:${perf.fps.toFixed(1)}`;

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
    session.clears += 1;
    session.bestCombo = Math.max(session.bestCombo, result.maxCombo);
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

setMenuOpen(true);
setTab("start");

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  await game.loadAudioFile(file);
  playButton.disabled = false;
  resultPanel.classList.remove("show");
  drawAnalysisDebug();
});

playButton.addEventListener("click", async () => {
  session.plays += 1;
  profile.totalPlays += 1;
  saveProfile();
  updateProfileUi();
  await game.playAudio();
  setMenuOpen(false);
});

openMenuBtn.addEventListener("click", () => {
  setMenuOpen(true);
  setTab("start");
});

closeMenuBtn.addEventListener("click", () => {
  setMenuOpen(false);
});

resultMenuBtn.addEventListener("click", () => {
  setMenuOpen(true);
  setTab("profile");
});

tabStartBtn.addEventListener("click", () => setTab("start"));
tabSettingsBtn.addEventListener("click", () => setTab("settings"));
tabProfileBtn.addEventListener("click", () => setTab("profile"));

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
  drawAnalysisDebug();
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

function drawAnalysisDebug(): void {
  const ctx = analysisCanvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const w = analysisCanvas.width;
  const h = analysisCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, w, h);

  const debug = game.getGeneratorDebugData();
  analysisMetaLabel.textContent = `Analysis BPM:${debug.bpm.toFixed(1)} Confidence:${(debug.beatConfidence * 100).toFixed(0)}% Notes:${debug.diagnostics.notes} NPS:${debug.diagnostics.nps.toFixed(2)} Lanes:${debug.diagnostics.lane0}/${debug.diagnostics.lane1}/${debug.diagnostics.lane2} Sections:${debug.sections.length} Beats:${debug.beats.length} Onsets:${debug.onsets.length} Hash:${debug.diagnostics.chartHash}`;

  const drawCurve = (values: readonly number[], color: string, yScale = 1): void => {
    if (values.length < 2) {
      return;
    }
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.7;
    for (let i = 0; i < values.length; i += 1) {
      const x = (i / (values.length - 1)) * (w - 1);
      const v = Math.max(0, Math.min(1, values[i] * yScale));
      const y = h - 8 - v * (h - 16);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  };

  drawCurve(debug.plan.elevation, "#38bdf8");
  drawCurve(debug.plan.density, "#a78bfa");
  drawCurve(debug.plan.danger, "#f59e0b");
  drawCurve(debug.plan.feature, "rgba(34,197,94,0.85)");
  drawCurve(debug.plan.novelty, "rgba(244,63,94,0.8)");

  const totalDuration = Math.max(1, debug.duration || (debug.anchors.length > 0 ? debug.anchors[debug.anchors.length - 1] + 1 : 1));
  ctx.strokeStyle = "rgba(244,63,94,0.2)";
  for (let i = 0; i < debug.onsets.length; i += 1) {
    const t = debug.onsets[i];
    const x = (t / totalDuration) * w;
    ctx.beginPath();
    ctx.moveTo(x, h * 0.72);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(34,211,238,0.28)";
  for (let i = 0; i < debug.beats.length; i += 1) {
    const t = debug.beats[i];
    const x = (t / totalDuration) * w;
    ctx.beginPath();
    ctx.moveTo(x, h * 0.46);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(125, 211, 252, 0.35)";
  ctx.lineWidth = 1;
  for (let i = 0; i < debug.anchors.length; i += 1) {
    const t = debug.anchors[i];
    const x = (t / totalDuration) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  if (debug.sections.length > 0) {
    const laneHeight = 6;
    const totalFrames = Math.max(1, debug.sections[debug.sections.length - 1].endFrame + 1);
    for (let i = 0; i < debug.sections.length; i += 1) {
      const s = debug.sections[i];
      const startT = (s.startFrame / totalFrames) * totalDuration;
      const endT = (s.endFrame / totalFrames) * totalDuration;
      const x0 = (startT / totalDuration) * w;
      const x1 = (endT / totalDuration) * w;
      ctx.fillStyle = s.label === "chorus"
        ? "rgba(34,197,94,0.45)"
        : s.label === "breakdown"
          ? "rgba(234,179,8,0.45)"
          : s.label === "intro" || s.label === "outro"
            ? "rgba(148,163,184,0.35)"
            : "rgba(59,130,246,0.35)";
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), laneHeight);
    }
  }
}
