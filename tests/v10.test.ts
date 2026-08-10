import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { MinerGame } from "../src/game/engine";
import { defaultSave, normalizeSave } from "../src/game/config";
import { AudioEngine } from "../src/game/audio";
import type { RunConfig } from "../src/game/types";

// ---------- v10 ??????node ?? stub ?????????? rAF ???? ----------
let rafCb: ((t: number) => void) | null = null;
let clock = 0;

function makeCanvas(): HTMLCanvasElement {
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get: (t, prop) => {
      if (prop === "measureText") return () => ({ width: 0 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") {
        return () => ({ addColorStop: () => {} });
      }
      if (typeof prop === "string" && prop in t) return t[prop];
      if (typeof prop === "string") return () => undefined;
      return undefined;
    },
    set: (t, prop, value) => {
      (t as Record<string, unknown>)[prop as string] = value;
      return true;
    },
  });
  return {
    getContext: () => ctx,
    width: 0, height: 0, style: {},
    addEventListener: () => {}, removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
}

function advance(seconds: number): void {
  const step = 0.05;
  let remaining = seconds;
  while (remaining > 0) {
    if (!rafCb) break;
    const cb = rafCb;
    rafCb = null;
    clock += step * 1000;
    cb(clock);
    remaining -= step;
  }
}

beforeAll(() => {
  vi.stubGlobal("window", {
    devicePixelRatio: 1, innerWidth: 1280, innerHeight: 900,
    addEventListener: () => {}, removeEventListener: () => {},
    setInterval: () => 0, clearInterval: () => {}, AudioContext: undefined,
  });
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { rafCb = cb; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("performance", { now: () => 0 });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function makeConfig(seed = "v10-test-seed"): RunConfig {
  return { difficulty: "normal", pocket: 100, buffs: [], equipment: [], items: [], archetype: null, seed, challenge: [], disasterMode: "gauge" };
}

function makeEngine(save = defaultSave(), config = makeConfig()) {
  const cb = { onUi: () => {}, onRunEnd: () => {} };
  const audio = new AudioEngine();
  const game = new MinerGame(makeCanvas(), save, audio, cb);
  return { game, audio, cb };
}

describe("v10 ?????????", () => {
  it("normalizeSave ????? warehouseLocked", () => {
    const raw = { ...defaultSave(), warehouseLocked: ["gold:fine", 123, "silver:normal"] } as unknown;
    const s = normalizeSave(raw);
    expect(s.warehouseLocked).toEqual(["gold:fine", "silver:normal"]);
  });

  it("normalizeSave ??? settings.shakeEnabled / textScale", () => {
    const s1 = normalizeSave({ ...defaultSave(), settings: { muted: false, reduceMotion: false, shakeEnabled: false, textScale: 1.25 } } as unknown);
    expect(s1.settings.shakeEnabled).toBe(false);
    expect(s1.settings.textScale).toBe(1.25);
    const s2 = normalizeSave({ ...defaultSave(), settings: { shakeEnabled: true, textScale: 7 } } as unknown);
    expect(s2.settings.shakeEnabled).toBe(true);
    expect(s2.settings.textScale).toBe(1);
  });

  it("normalizeSave ??? checkin ??", () => {
    const s = normalizeSave({ ...defaultSave(), checkin: { date: "2026-08-10", streak: 3, total: 9 } } as unknown);
    expect(s.checkin).toEqual({ date: "2026-08-10", streak: 3, total: 9 });
    const s2 = normalizeSave({ ...defaultSave(), checkin: { date: 42, streak: -5, total: 1e9 } } as unknown);
    expect(s2.checkin.date).toBe("");
    expect(s2.checkin.streak).toBe(0);
    expect(s2.checkin.total).toBe(1e6);
  });
});

describe("v10 背景自动暂停", () => {
  it("????????????????????", () => {
    let visHandler: (() => void) | undefined;
    const doc: Record<string, unknown> = { _h: false };
    Object.defineProperty(doc, "hidden", { get: () => doc._h });
    doc.addEventListener = (_t: string, cb: () => void) => { visHandler = cb; };
    doc.removeEventListener = () => {};
    vi.stubGlobal("document", doc);

    const save = defaultSave();
    const config = makeConfig("pause-seed");
    const { game } = makeEngine(save, config);
    game.startRun(0, save, config);

    let snap = game.captureRunState() as unknown as { phase: string; depth: number };
    expect(snap.phase).toBe("descending");

    doc._h = true;
    if (visHandler) visHandler();
    advance(3);
    snap = game.captureRunState() as unknown as { phase: string; depth: number };
    expect(snap.phase).toBe("descending");

    doc._h = false;
    if (visHandler) visHandler();
    advance(2);
    snap = game.captureRunState() as unknown as { phase: string; depth: number };
    if (snap.phase === "anomaly") (game as unknown as { anomalyContinue(): void }).anomalyContinue();
    expect(["observe", "anomaly"]).toContain(snap.phase);
  });
});
