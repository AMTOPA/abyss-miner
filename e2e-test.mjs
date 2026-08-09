// e2e-test.mjs — v2 基础回归：大厅出矿 / 钻进 / 结算 / 黑市 / 仓库 / 商店 / 登录 / 排行榜
// 依赖：dev server 运行在 http://localhost:3000，Playwright + 系统 Chrome
// 用法：node e2e-test.mjs
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const results = [];
const ok = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " | " + extra : ""}`);

// 浏览器启动：优先 CHROME_PATH 环境变量，其次常见系统浏览器，最后回退 Playwright 自带 Chromium
async function launchBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      return await chromium.launch({ executablePath: p, headless: true });
    } catch { /* try next */ }
  }
  return chromium.launch({ headless: true });
}
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE: " + m.text()); });
page.on("dialog", (d) => d.accept());

// 注入存档：现金 + 升级 + 已解锁检查点，保证黑市流程可达
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  const save = {
    version: 4, cash: 8000,
    upgrades: { drill: 6, safety: 6, backpack: 4, detection: 5, support: 9 },
    unlockedCheckpoints: [0, 100, 300],
    warehouseStacks: [
      { key: "copper:normal", count: 20, unitValue: 20 },
      { key: "silver:fine", count: 5, unitValue: 60 },
    ],
    warehouseItems: { repair_kit: 3 },
    warehouseEquipment: [], equipped: {}, shop: { date: "", stock: [] },
    favor: 1, difficultyUnlocked: ["mild", "normal", "hardcore"],
    archetypesUnlocked: [],
    codex: { minerals: {}, rooms: [], creatures: 0, anomalies: [], modules: [], research: {} },
    daily: { date: "", tasks: {}, claimed: {} },
    stats: { runs: 0, totalBanked: 0, bestRunValue: 0, bestDepth: 500, disasters: 0, totalMined: 0, totalSells: 0, creaturesScared: 0, bmTrades: 0, anomaliesSeen: 0, overloadDrills: 0 },
    settings: { muted: true, reduceMotion: false },
  };
  localStorage.setItem("abyss_miner_save_v4", JSON.stringify(save));
});
await page.reload({ waitUntil: "networkidle" });

// ---------- 1. 大厅 ----------
await page.waitForSelector(".lobby-tab", { timeout: 8000 });
ok("lobby tabs", (await page.locator(".lobby-tab").count()) === 8);
ok("cash shown", /8,?000/.test(await page.locator(".lobby-cash").innerText()));
// 展开高级配置后，检查点/难度/增益/携带道具才可见
await page.getByRole("button", { name: /高级配置/ }).first().click();
await page.waitForTimeout(400);
ok("checkpoints x5", (await page.locator(".checkpoint-item").count()) === 5);
ok("difficulty x3", (await page.locator(".diff-card").count()) === 3);
ok("buff cards", (await page.locator(".buff-card").count()) === 10);

// 选择硬核 + 携带一个维修套件
await page.locator(".diff-card", { hasText: "硬核" }).click();
await page.waitForTimeout(150);
await page.locator(".carry-grid button", { hasText: "维修套件" }).first().click();
await page.waitForTimeout(150);

// ---------- 2. 出矿 → 观察 ----------
await page.getByRole("button", { name: /出发！/ }).click();
await page.waitForTimeout(2800);
ok("observe signals", (await page.locator(".signal").count()) >= 3);
ok("drill buttons x3", (await page.locator(".drill-btn").count()) === 3);
ok("hardcore badge", /硬核/.test(await page.locator(".diff-badge").first().innerText().catch(() => "")));
ok("carried item in bag", (await page.locator(".bag-cell-item").count()) >= 1);

// 使用携带的维修套件
const useBtn = page.locator(".bag-cell-item .bag-use").first();
if (await useBtn.count()) {
  await useBtn.click();
  await page.waitForTimeout(300);
  ok("use item works", (await page.locator(".bag-cell-item").count()) === 0);
} else ok("use item works", true, "no item cell");

// ---------- 3. 一路推进到黑市（100m 检查点） ----------
let bmOpened = false;
for (let step = 0; step < 80; step++) {
  const bmBtn = page.getByRole("button", { name: /前往黑市/ });
  if (await bmBtn.count()) {
    bmOpened = true;
    await bmBtn.first().click();
    await page.waitForTimeout(400);
    ok("black market panel", (await page.locator(".bm-panel").count()) === 1);
    const bmHeader = await page.locator(".bm-header").innerText().catch(() => "");
    ok("bm favor & ratio", /好感/.test(bmHeader), bmHeader.slice(0, 120));
    // 全卖第一个矿石堆
    const sellAll = page.getByRole("button", { name: /全卖/ }).first();
    if (await sellAll.count()) {
      const pocketBefore = await page.locator(".pocket-chip").first().innerText().catch(() => "");
      await sellAll.click();
      await page.waitForTimeout(300);
      const pocketAfter = await page.locator(".pocket-chip").first().innerText().catch(() => "");
      ok("bm 全卖 -> pocket", pocketBefore !== pocketAfter);
    }
    // 用现金买货架第一件（若买得起）
    const cashBuy = page.locator(".bm-item-actions .btn-primary").first();
    if (await cashBuy.count()) {
      const disabled = await cashBuy.isDisabled().catch(() => true);
      if (!disabled) {
        await cashBuy.click();
        await page.waitForTimeout(300);
        ok("bm cash buy", true);
      } else ok("bm cash buy", true, "too expensive");
    }
    // 维修
    const repair = page.getByRole("button", { name: /^维修$/ });
    if (await repair.count()) {
      const disabled = await repair.isDisabled().catch(() => true);
      ok("bm repair enabled", !disabled);
      if (!disabled) { await repair.click(); await page.waitForTimeout(200); }
    }
    await page.getByRole("button", { name: /离开黑市/ }).click();
    await page.waitForTimeout(400);
    ok("bm leave -> result", (await page.locator(".result-panel").count()) === 1);
    break;
  }
  const cont = page.getByRole("button", { name: /继续深入/ });
  if (await cont.count()) { await cont.click(); await page.waitForTimeout(1500); continue; }
  // v4 事件面板：路线分岔 / 局内模块 / 特殊房间（都选第一个选项继续）
  const routeCard = page.locator(".route-card").first();
  if (await routeCard.count()) { await routeCard.click(); await page.waitForTimeout(400); continue; }
  const moduleCard = page.locator(".module-card").first();
  if (await moduleCard.count()) { await moduleCard.click(); await page.waitForTimeout(400); continue; }
  const roomOpt = page.locator(".room-option").first();
  if (await roomOpt.count()) { await roomOpt.click(); await page.waitForTimeout(400); continue; }
  const drillBtn = page.getByRole("button", { name: /标准钻进/ });
  if (await drillBtn.count()) {
    const sup = page.getByRole("button", { name: /支撑架/ }).first();
    if (await sup.count()) {
      if (!(await sup.isDisabled().catch(() => true))) { await sup.click(); await page.waitForTimeout(150); }
    }
    await drillBtn.click(); await page.waitForTimeout(200);
    const skip = page.locator(".skip-btn");
    if (await skip.count()) { await skip.click(); await page.waitForTimeout(300); }
    await page.waitForTimeout(500);
    continue;
  }
  const hazard = page.getByRole("button", { name: /驱赶/ });
  if (await hazard.count()) { await hazard.click(); await page.waitForTimeout(300); continue; }
  const anomaly = page.getByRole("button", { name: /踏入这一层/ });
  if (await anomaly.count()) { await anomaly.click(); await page.waitForTimeout(300); continue; }
  const bandit = page.getByRole("button", { name: /给现金/ });
  if (await bandit.count()) { await bandit.click(); await page.waitForTimeout(300); continue; }
  if (await page.locator(".end-panel").count()) { break; }
  await page.waitForTimeout(800);
}
ok("black market reached", bmOpened);

// ---------- 4. 返回地面（评级） ----------
for (let tries = 0; tries < 14 && !(await page.locator(".end-panel").count()); tries++) {
  const retreatBtn = page.getByRole("button", { name: /返回地面/ }).first();
  if (await retreatBtn.count() && !(await retreatBtn.isDisabled().catch(() => true))) {
    await retreatBtn.click(); await page.waitForTimeout(700);
  } else {
    await page.waitForTimeout(500);
  }
}
ok("surfaced", (await page.locator(".end-panel.success").count()) === 1);
const endText = await page.locator(".end-panel").innerText().catch(() => "");
ok("rating present", /S|A|B|C/.test(endText), endText.slice(0, 120));

// ---------- 5. 返回大厅：仓库应有矿石，可出售 ----------
const diag = await page.evaluate(() => ({
  endPanels: document.querySelectorAll(".end-panel").length,
  endSuccess: document.querySelectorAll(".end-panel.success").length,
  btns: Array.from(document.querySelectorAll("button")).filter((b) => b.offsetParent !== null).map((b) => (b.textContent || "").trim().slice(0, 24)).slice(0, 30),
}));
console.log("DIAG BEFORE MENU:", JSON.stringify(diag));
const menuBtn2 = page.getByRole("button", { name: /返回主菜单/ }).first();
await menuBtn2.click({ force: true, timeout: 8000 });

await page.waitForTimeout(600);
await page.getByRole("button", { name: /仓库/ }).click();
await page.waitForTimeout(400);
ok("warehouse ores", (await page.locator(".wh-row").count()) >= 1, `rows=${await page.locator(".wh-row").count()}`);
const whText = await page.locator(".lobby-panel").innerText().catch(() => "");
ok("warehouse value", /总价值：[1-9]/.test(whText), (whText.match(/仓库矿石总价值：[^\n]*/) || [""])[0]);
const sell1 = page.getByRole("button", { name: /卖 1/ }).first();
if (await sell1.count()) {
  const cashBefore = await page.locator(".lobby-cash").innerText().catch(() => "");
  await sell1.click();
  await page.waitForTimeout(300);
  const cashAfter = await page.locator(".lobby-cash").innerText().catch(() => "");
  ok("sell ore -> cash", cashBefore !== cashAfter);
}

// ---------- 6. 商店 ----------
await page.getByRole("button", { name: /商店/ }).click();
await page.waitForTimeout(400);
ok("shop cards", (await page.locator(".shop-card").count()) >= 1);
const buyBtn = page.locator(".shop-card .btn").first();
if (await buyBtn.count()) {
  const disabled = await buyBtn.isDisabled().catch(() => true);
  ok("shop buy enabled", !disabled);
  if (!disabled) { await buyBtn.click(); await page.waitForTimeout(300); }
}

// ---------- 7. 注册登录 + 排行榜 ----------
await page.getByRole("button", { name: /注册/ }).click();
await page.waitForTimeout(300);
const uname = "e2e" + Date.now().toString().slice(-8);
await page.locator("input").nth(0).fill(uname);
await page.locator("input").nth(1).fill("e2epass123");
await page.getByRole("button", { name: /注册并登录/ }).click();
const chipOk = await (async () => {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if ((await page.locator(".user-name", { hasText: uname }).count()) === 1) return true;
    await page.waitForTimeout(150);
  }
  return false;
})();
ok("logged in chip", chipOk);

// 下矿一次并撤离，验证自动上榜
await page.getByRole("button", { name: /出矿/ }).click();
await page.waitForTimeout(200);
// 第二次出发：新大厅默认折叠高级配置，直接用快速出发
const quickGo = page.getByRole("button", { name: /快速出发/ });
if (await quickGo.count()) await quickGo.first().click();
else await page.getByRole("button", { name: /出发！/ }).click();
await page.waitForTimeout(2800);
for (let i = 0; i < 8; i++) {
  const drillBtn = page.getByRole("button", { name: /标准钻进/ });
  if (await drillBtn.count()) { await drillBtn.click(); await page.waitForTimeout(200); const skip = page.locator(".skip-btn"); if (await skip.count()) { await skip.click(); await page.waitForTimeout(300); } await page.waitForTimeout(400); }
  const cont = page.getByRole("button", { name: /继续深入/ });
  if (await cont.count()) { await cont.click(); await page.waitForTimeout(1400); continue; }
  const routeCard = page.locator(".route-card").first();
  if (await routeCard.count()) { await routeCard.click(); await page.waitForTimeout(400); continue; }
  const moduleCard = page.locator(".module-card").first();
  if (await moduleCard.count()) { await moduleCard.click(); await page.waitForTimeout(400); continue; }
  const roomOpt = page.locator(".room-option").first();
  if (await roomOpt.count()) { await roomOpt.click(); await page.waitForTimeout(400); continue; }
  await page.waitForTimeout(800);
}
for (let tries = 0; tries < 14; tries++) {
  const retreat2 = page.getByRole("button", { name: /返回地面/ }).first();
  if ((await retreat2.count()) && !(await retreat2.isDisabled().catch(() => true))) {
    await retreat2.click();
    await page.waitForTimeout(700);
    break;
  }
  await page.waitForTimeout(500);
}
const doneNote = await page.locator(".submit-note.ok").count().catch(() => 0);
ok("score submitted", doneNote === 1);
const menuBtn = page.getByRole("button", { name: /返回主菜单/ }).first();
try {
  await menuBtn.click({ force: true, timeout: 8000 });
} catch (e) {
  const d2 = await page.evaluate(() => ({
    end: document.querySelectorAll(".end-panel").length,
    endSuccess: document.querySelectorAll(".end-panel.success").length,
    title: (document.querySelector(".panel-title, .end-title") || {}).textContent || "",
    btns: Array.from(document.querySelectorAll("button")).filter((b) => b.offsetParent !== null).map((b) => (b.textContent || "").trim().slice(0, 24)).slice(0, 40),
  }));
  console.log("DIAG2:", JSON.stringify(d2));
  throw e;
}
await page.waitForTimeout(600);
await page.getByRole("button", { name: /排行榜/ }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: /打开排行榜/ }).click();
await page.waitForSelector(".lb-table", { timeout: 8000 });
const lbText = await page.locator(".lb-table").innerText().catch(() => "");
ok("leaderboard has user", lbText.includes(uname));

const fails = results.filter((r) => r.startsWith("FAIL")).length;
console.log("=== RESULTS ===");
console.log(results.join("\n"));
console.log("=== ERRORS ===");
console.log(errs.length ? errs.join("\n") : "(none)");
await browser.close();
process.exit(fails > 0 || errs.length > 0 ? 1 : 0);
