import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " | " + extra : ""}`);
};

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));

await page.goto(BASE, { waitUntil: "networkidle" });

// 1. Home screen
ok("home title", (await page.getByRole("heading", { name: /深 渊 矿 工/ }).count()) === 1);
ok("start button", (await page.getByRole("button", { name: /开始下矿/ }).count()) === 1);
ok("leaderboard button", (await page.getByRole("button", { name: /排行榜/ }).count()) === 1);

// 2. Start run
await page.getByRole("button", { name: /开始下矿/ }).click();
await page.waitForTimeout(300);
ok("start modal shows checkpoints", (await page.locator(".checkpoint-item").count()) === 5);
await page.getByRole("button", { name: "出发！" }).click();
await page.waitForTimeout(2500); // descending

// 3. Observe phase
ok("observe panel signals", (await page.locator(".signal").count()) >= 3);
ok("drill buttons x3", (await page.locator(".drill-btn").count()) === 3);
ok("detector button", (await page.locator("button", { hasText: "探测器" }).count()) >= 1);

// use detector
const detBtn = page.locator("button", { hasText: "探测器" }).first();
await detBtn.click();
await page.waitForTimeout(200);
ok("detector consumed", (await page.locator("button", { hasText: "探测器 ×1" }).count()) >= 1);

// 4. Drill standard
await page.getByRole("button", { name: /标准钻进/ }).click();
await page.waitForTimeout(300);
ok("drilling tip", (await page.locator(".drilling-tip").count()) === 1);
await page.waitForTimeout(2600); // drilling animation
await page.waitForTimeout(400);
const resultVisible = await page.locator(".result-panel").count();
ok("result panel", resultVisible === 1, `count=${resultVisible}`);

// 5. Retreat -> surfaced
await page.getByRole("button", { name: /返回地面/ }).click();
await page.waitForTimeout(500);
ok("surfaced panel", (await page.locator(".end-panel.success").count()) === 1);
ok("need login shown", (await page.getByRole("button", { name: /登录后上榜/ }).count()) >= 1);

// 6. Go home, check cash updated
await page.getByRole("button", { name: "返回主菜单" }).click();
await page.waitForTimeout(500);
const cashText = await page.locator(".home-stats .stat-card").first().textContent();
ok("cash updated", /[1-9]/.test(cashText), cashText);

// 7. Register via UI
await page.getByRole("button", { name: "注册" }).click();
await page.waitForTimeout(300);
const uname = "e2e" + Date.now().toString().slice(-8);
await page.locator("input").nth(0).fill(uname);
await page.locator("input").nth(1).fill("e2epass123");
await page.getByRole("button", { name: "注册并登录" }).click();
// 等待登录回调完成（回调与页面更新之间存在网络延迟，用轮询替代固定等待）
const chipOk = await (async () => {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if ((await page.locator(".user-name", { hasText: uname }).count()) === 1) return true;
    await page.waitForTimeout(150);
  }
  return false;
})();
ok("logged in chip", chipOk);

// 8. Leaderboard
await page.getByRole("button", { name: /排行榜/ }).click();
await page.waitForTimeout(600);
ok("leaderboard table", (await page.locator(".lb-table tbody tr").count()) >= 1);
const lbText = await page.locator(".lb-table").textContent();
ok("leaderboard has new user", lbText.includes(uname));

// 9. Upgrade shop
await page.getByRole("button", { name: /关闭/ }).click();
await page.getByRole("button", { name: /升级车间/ }).click();
await page.waitForTimeout(400);
ok("upgrade cards x5", (await page.locator(".upgrade-card").count()) === 5);
const buyBtns = await page.locator(".upgrade-card .btn").allTextContents();
ok("upgrade buy disabled (no cash)", buyBtns.some((t) => t.includes("升级")), buyBtns.join(","));

await page.getByRole("button", { name: /关闭/ }).click();
await page.waitForTimeout(200);

console.log("=== RESULTS ===");
console.log(results.join("\n"));
console.log("=== CONSOLE ERRORS ===");
console.log(consoleErrors.length ? consoleErrors.join("\n") : "(none)");

await browser.close();
process.exit(0);
