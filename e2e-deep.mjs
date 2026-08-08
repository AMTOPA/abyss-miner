import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errs.push("CONSOLE: " + m.text()); });

const results = [];
const ok = (n, c, x = "") => results.push(`${c ? "PASS" : "FAIL"} ${n}${x ? " | " + x : ""}`);

// 注入“老玩家”存档：高安全装备 + 全部检查点
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.evaluate(() => {
  const save = {
    cash: 9000,
    upgrades: { drill: 8, safety: 8, backpack: 4, detection: 5, support: 6 },
    unlockedCheckpoints: [0, 100, 300, 600, 1000],
    stats: { runs: 12, totalBanked: 8120, bestRunValue: 1240, bestDepth: 610, disasters: 2 },
    settings: { muted: false },
  };
  localStorage.setItem("abyss_miner_save_v1", JSON.stringify(save));
});
await page.reload({ waitUntil: "networkidle" });

// 从 1000m 深渊检查点出发
await page.getByRole("button", { name: /开始下矿/ }).click();
await page.waitForTimeout(300);
await page.locator(".checkpoint-item").filter({ hasText: "1000m" }).click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "出发！" }).click();
await page.waitForTimeout(3000);

// 深渊异常层：踏入
if (await page.locator(".anomaly-panel").count() > 0) {
  await page.getByRole("button", { name: /踏入这一层/ }).click();
  await page.waitForTimeout(400);
}
ok("signals at abyss", (await page.locator(".signal").count()) >= 3);
const titleDeep = await page.locator(".observe-layout .panel-title").first().textContent().catch(() => "");
ok("deep observe shows 1000m", /1000m/.test(titleDeep || ""), titleDeep);

// 使用探测器
await page.locator("button", { hasText: "探测器" }).first().click();
await page.waitForTimeout(200);

// 超载钻进（深渊层应能看到超载按钮）
await page.getByRole("button", { name: /超载钻进/ }).click();
await page.waitForTimeout(4000);

// 深潜结果：结算面板（正常）或灾难面板（深渊高风险，均为有效结局）
const resultCount = await page.locator(".result-panel").count();
const disasterCount = await page.locator(".end-panel.disaster").count();
ok("deep drill settled (result or disaster)", resultCount === 1 || disasterCount === 1, `result=${resultCount} disaster=${disasterCount}`);

if (resultCount === 1) {
  // 撤退返回地面
  await page.getByRole("button", { name: /返回地面/ }).click();
  await page.waitForTimeout(600);
  ok("deep surfaced", (await page.locator(".end-panel.success").count()) === 1);
} else {
  // 灾难结局也视为深层流程走通
  ok("deep disaster panel shown (expected abyss risk)", disasterCount === 1);
}

console.log("=== RESULTS ===");
console.log(results.join("\n"));
console.log("=== ERRORS ===");
console.log(errs.length ? errs.join("\n") : "(none)");
await browser.close();
process.exit(0);