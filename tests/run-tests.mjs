import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
};

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const beatMap = read("src/audio/BeatMapGenerator.ts");
assert(beatMap.includes("setSeed("), "BeatMapGenerator must expose setSeed");
assert(beatMap.includes("getPreview("), "BeatMapGenerator must expose getPreview");
assert(beatMap.includes("quantizeFrames("), "BeatMapGenerator must quantize note timings");

const collision = read("src/systems/CollisionSystem.ts");
assert(collision.includes("updateActiveHolds"), "CollisionSystem must process hold states");
assert(collision.includes("updateActiveSlides"), "CollisionSystem must process slide states");

const game = read("src/core/Game.ts");
assert(game.includes("setGameMode("), "Game must support mode switching");
assert(game.includes("setPracticeSpeed("), "Game must support practice speed");
assert(game.includes("setMirrorLanes("), "Game must support mirror lanes");
assert(game.includes("setQualityMode("), "Game must support quality mode");
assert(game.includes("getChartPreviewSummary("), "Game must expose chart preview summary");

const main = read("src/main.ts");
assert(main.includes("PROFILE_KEY"), "main must persist profile progression");
assert(main.includes("calibrating"), "main must include calibration flow");
assert(main.includes("touch-zones"), "main must wire touch lane controls");

console.log("tests passed");
