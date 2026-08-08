// e2e-pen.mjs — 穿透机制（一次钻穿多层）+ 钻机朝下/岩层滚动 相关 E2E 验证
// 依赖：dev server 运行在 http://localhost:3000，Playwright + 系统 Chrome
// 用法：
//   node e2e-pen.mjs            （40 轮超载钻进）
//   PEN_ROUNDS=6 node e2e-pen.mjs  （快速冒烟，用于脚本自测）
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const ROUNDS = Number(process.env.PEN_ROUNDS) || 40;
const MAX_RESTARTS = 40;

const results = [];
const ok = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " | " + extra : ""}`);

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// 收集 pageerror / console error（favicon 404 忽略）
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  // favicon 404 的 console 文本不含 URL，需用 location.url 判断（favicon 404 忽略）
  const loc = m.location() || {};
  const txt = m.text() || "";
  if (/favicon/i.test(loc.url || "") || /favicon/i.test(txt)) return;
  errs.push("CONSOLE: " + txt);
});

const sleep = (ms) => page.waitForTimeout(ms);

// ---------- 工具函数 ----------

async function waitFor(fn, timeoutMs, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return true;
    } catch { /* 元素切换期间可能抛错，忽略 */ }
    await sleep(intervalMs);
  }
  return false;
}

// 等待进入观察界面（.observe-layout 出现或 .signal >= 3；顺带处理深渊异常弹窗）
async function waitObserve(timeoutMs) {
  return waitFor(async () => {
    if ((await page.locator(".anomaly-panel").count()) > 0) {
      const btn = page.getByRole("button", { name: /踏入这一层/ });
      if ((await btn.count()) > 0) await btn.first().click();
      return false;
    }
    return (await page.locator(".observe-layout").count()) > 0 || (await page.locator(".signal").count()) >= 3;
  }, timeoutMs);
}

// 读取观察面板标题「第 N 层 · XXXm · 阶段名」中的深度
async function readObserveDepth() {
  try {
    const title = await page.locator(".observe-layout .panel-title").first().textContent();
    const m = (title || "").match(/第\s*\d+\s*层\s*·\s*(\d+)\s*m/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

// 点击「超载钻进」；按钮缺失/禁用（如电量不足）返回 false
async function clickOverload() {
  const btn = page.getByRole("button", { name: /超载钻进/ });
  if ((await btn.count()) === 0) return false;
  if (await btn.isDisabled()) return false;
  await btn.click();
  return true;
}

// 等待钻进结算：result / hazard / disaster / surfaced / timeout
async function pollDrillResult(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await page.locator(".result-panel").count()) > 0) return "result";
    if ((await page.locator(".hazard-panel").count()) > 0) return "hazard";
    if ((await page.locator(".end-panel", { hasText: "灾难" }).count()) > 0) return "disaster";
    if ((await page.locator(".end-panel", { hasText: "安全返回" }).count()) > 0) return "surfaced";
    await sleep(150);
  }
  return "timeout";
}

// 在结算面板检测穿透徽章：优先 [data-testid="penetrate-badge"]，退化用 /穿透/ 文本
async function detectPenetration() {
  const badge = page.locator('[data-testid="penetrate-badge"]');
  if ((await badge.count()) > 0) {
    const text = (await badge.first().textContent()) || "";
    const m = text.match(/穿透[^\d]*(\d+)/);
    return { seen: true, layers: m ? parseInt(m[1], 10) : null, text: text.trim() };
  }
  const rpText = (await page.locator(".result-panel").textContent()) || "";
  if (/穿透/.test(rpText)) {
    const m = rpText.match(/穿透[^\d]*(\d+)/);
    return { seen: true, layers: m ? parseInt(m[1], 10) : null, text: rpText.slice(0, 60) };
  }
  return { seen: false, layers: null, text: "" };
}

// 结算面板已出现：检测穿透 → 点「继续深入」→ 等观察界面 → 记录穿透深度跳跃
async function completeRound(depthBefore) {
  const roundNo = roundsDone + 1;
  const pen = await detectPenetration();
  let interrupted = false;
  if ((await page.locator(".result-panel .event").allTextContents()).some((t) => t.includes("严重事故") || t.includes("被打断"))) {
    interrupted = true;
  }
  if (pen.seen) {
    penetrationCount++;
    penRounds.push({ round: roundNo, layers: pen.layers, depthBefore, text: pen.text, interrupted });
  }
  const cont = page.getByRole("button", { name: /继续深入/ });
  if ((await cont.count()) === 0) return { ok: false, reason: `no continue button round ${roundNo}` };
  await cont.first().click();
  if (!(await waitObserve(8000))) return { ok: false, reason: `no observe after continue round ${roundNo}` };
  const depthAfter = await readObserveDepth();
  const rec = penRounds.find((r) => r.round === roundNo);
  if (rec) {
    rec.depthAfter = depthAfter;
    rec.jump = depthAfter === null ? null : depthAfter - depthBefore;
  }
  return { ok: true, roundNo };
}

// 回到主菜单（撤退被封锁时先继续钻一层解锁）
async function backToHome(maxTries = 8) {
  for (let t = 0; t < maxTries; t++) {
    if ((await page.locator(".home-screen").count()) > 0) return true;
    // 结束面板（灾难 / 安全返回）
    if (
      (await page.locator(".end-panel", { hasText: "灾难" }).count()) > 0 ||
      (await page.locator(".end-panel", { hasText: "安全返回" }).count()) > 0
    ) {
      const menu = page.getByRole("button", { name: /返回主菜单/ });
      if ((await menu.count()) > 0) {
        await menu.first().click();
        await sleep(400);
        continue;
      }
    }
    // 观察 / 结算界面：点「返回地面」
    const inRun =
      (await page.locator(".observe-layout").count()) > 0 ||
      (await page.locator(".result-panel").count()) > 0 ||
      (await page.locator(".signal").count()) >= 3;
    if (inRun) {
      const retreat = page.getByRole("button", { name: /返回地面/ }).first();
      if ((await retreat.count()) > 0 && !(await retreat.isDisabled())) {
        await retreat.click();
        await sleep(600);
        continue;
      }
      // 撤退被封锁：超载钻进一层再试
      const btn = page.getByRole("button", { name: /超载钻进/ });
      if ((await btn.count()) > 0 && !(await btn.isDisabled())) {
        await btn.click();
        await pollDrillResult(6000);
        const cont = page.getByRole("button", { name: /继续深入/ });
        if ((await cont.count()) > 0) {
          await cont.first().click();
          await waitObserve(6000);
        }
        continue;
      }
    }
    await sleep(300);
  }
  return (await page.locator(".home-screen").count()) > 0;
}

// 从 0m 重新开始一轮
async function startRun0() {
  if ((await page.locator(".home-screen").count()) === 0) {
    if (!(await backToHome(5))) return false;
  }
  const start = page.getByRole("button", { name: /开始下矿/ });
  if ((await start.count()) === 0) return false;
  await start.click();
  await sleep(300);
  const go = page.getByRole("button", { name: "出发！" });
  if ((await go.count()) === 0) return false;
  await go.click();
  return true;
}

// 灾难/意外结束 → 返回主菜单 → 重新从 0m 出发并进入观察
async function restartFromHome() {
  const menu = page.getByRole("button", { name: /返回主菜单/ });
  if ((await menu.count()) > 0) await menu.first().click();
  await sleep(400);
  if (!(await startRun0())) return false;
  return waitObserve(8000);
}

// ---------- 1. 注入高现金 + 全检查点存档 ----------
await page.goto(BASE, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const save = {
    cash: 5000,
    upgrades: { drill: 5, safety: 3, backpack: 2, detection: 3, support: 2 },
    unlockedCheckpoints: [0, 100, 300, 600, 1000],
    stats: { runs: 0, totalBanked: 0, bestRunValue: 0, bestDepth: 0, disasters: 0 },
    settings: { muted: true },
  };
  localStorage.setItem("abyss_miner_save_v1", JSON.stringify(save));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const cashText = await page.locator(".home-stats .stat-card").first().textContent();
ok("save injected cash 5000", (cashText || "").includes("5,000") || (cashText || "").includes("5000"), cashText);

// ---------- 2. 从 0m 出发，进入观察界面 ----------
ok("start button present", (await page.getByRole("button", { name: /开始下矿/ }).count()) === 1);
await page.getByRole("button", { name: /开始下矿/ }).click();
await sleep(300);
const go = page.getByRole("button", { name: "出发！" });
ok("go button present", (await go.count()) === 1);
await go.click();
ok("entered observe", await waitObserve(8000));

// 观察面板标题形如「第 N 层 · XXXm · 阶段名」
const title0 = await page.locator(".observe-layout .panel-title").first().textContent();
ok("observe title format (第N层 · XXXm · 阶段名)", /第\s*\d+\s*层\s*·\s*\d+\s*m/.test(title0 || ""), title0);
const depth0 = await readObserveDepth();
ok("start depth 0m", depth0 === 0, `depth=${depth0}`);

// 钻进按钮文案：稳妥钻进 / 标准钻进 / 超载钻进
for (const n of ["稳妥钻进", "标准钻进", "超载钻进"]) {
  ok(`drill button: ${n}`, (await page.getByRole("button", { name: new RegExp(n) }).count()) >= 1);
}

// ---------- 3. 连续 40 轮超载钻进，统计穿透 ----------
let roundsDone = 0;
let penetrationCount = 0;
const penRounds = []; // { round, layers, depthBefore, depthAfter, jump }
let restarts = 0;
let abort = null;

while (roundsDone < ROUNDS && !abort) {
  if (restarts > MAX_RESTARTS) {
    abort = `too many restarts (${restarts})`;
    break;
  }
  if (!(await waitObserve(8000))) {
    abort = `cannot reach observe before round ${roundsDone + 1}`;
    break;
  }
  const depthBefore = await readObserveDepth();
  if (depthBefore === null) {
    abort = `depth unreadable round ${roundsDone + 1}`;
    break;
  }

  if (!(await clickOverload())) {
    // 电量不足/按钮禁用：撤退回主菜单后重新从 0m 开始
    const wentHome = await backToHome(5);
    restarts++;
    if (!wentHome || !(await startRun0()) || !(await waitObserve(8000))) {
      abort = `cannot restart after disabled drill (round ${roundsDone + 1})`;
      break;
    }
    continue;
  }

  const phase = await pollDrillResult(5000);

  if (phase === "result") {
    const r = await completeRound(depthBefore);
    if (!r.ok) { abort = r.reason; break; }
    roundsDone = r.roundNo;
    continue;
  }

  if (phase === "hazard") {
    // 地底生物挡路：驱赶（或丢诱饵）后应回到结算面板
    const scare = page.getByRole("button", { name: /驱赶/ });
    if ((await scare.count()) > 0) {
      await scare.first().click();
    } else {
      const bait = page.getByRole("button", { name: /诱饵/ });
      if ((await bait.count()) > 0) await bait.first().click();
      else { abort = `unresolvable hazard round ${roundsDone + 1}`; break; }
    }
    await sleep(300);
    const phase2 = await pollDrillResult(5000);
    if (phase2 === "result") {
      const r = await completeRound(depthBefore);
      if (!r.ok) { abort = r.reason; break; }
      roundsDone = r.roundNo;
      continue;
    }
    if (phase2 === "disaster" || phase2 === "surfaced") {
      restarts++;
      if (!(await restartFromHome())) { abort = `restart failed after hazard (round ${roundsDone + 1})`; break; }
      continue;
    }
    // 未出现结算：可能直接进入观察界面（本轮不计数）
    if (await waitObserve(3000)) continue;
    // 兜底：卡死状态（结算面板缺失）→ 顶栏「✕ 返回」放弃本次下矿并重新开始
    const topExit = page.locator(".run-topbar button").first();
    if ((await topExit.count()) > 0) {
      page.once("dialog", (d) => d.accept());
      await topExit.click();
      await sleep(500);
    }
    restarts++;
    if (!(await restartFromHome())) { abort = `restart failed after stuck hazard (round ${roundsDone + 1})`; break; }
    continue;
  }

  if (phase === "disaster" || phase === "surfaced") {
    restarts++;
    if (!(await restartFromHome())) { abort = `restart failed (round ${roundsDone + 1})`; break; }
    continue;
  }

  abort = `drill result timeout round ${roundsDone + 1}`;
  break;
}

// ---------- 4. 断言 ----------
ok(`${ROUNDS} rounds completed`, roundsDone === ROUNDS, `done=${roundsDone} restarts=${restarts}${abort ? " abort=" + abort : ""}`);
ok(
  "penetration seen at least once",
  penetrationCount >= 1,
  `count=${penetrationCount} ${penRounds.map((p) => `#${p.round}(L${p.layers ?? "?"},+${p.jump ?? "?"}m)`).join(" ")}`
);
const validPen = penRounds.filter((p) => !p.interrupted && typeof p.jump === "number");
const penJumps = validPen.map((p) => p.jump);
ok("penetration depth jump >= 20m", penJumps.some((j) => j >= 20), `jumps=[${penJumps.join(", ")}] valid=${validPen.length} total=${penRounds.length}`);
const firstLayers = validPen.find((p) => typeof p.layers === "number" && p.layers >= 2);
if (firstLayers) {
  ok(
    "penetration jump matches badge layers (10 x layers)",
    Math.abs(firstLayers.jump - 10 * firstLayers.layers) <= 1,
    `round=${firstLayers.round} layers=${firstLayers.layers} jump=${firstLayers.jump}m`
  );
}
ok("no page/console errors", errs.length === 0, errs.length ? errs.join(" | ") : "");

// ---------- 5. 返回主菜单 ----------
const wentHome = await backToHome(8);
ok("back to main menu (home-screen)", wentHome);

console.log("=== RESULTS ===");
console.log(results.join("\n"));
console.log("=== ERRORS ===");
console.log(errs.length ? errs.join("\n") : "(none)");

await browser.close();
process.exit(0);


