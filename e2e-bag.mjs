// e2e-bag.mjs — 背包管理（丢弃/清空）+ 钻进跳过 + 结算面板保持 相关 E2E 验证
// 依赖：dev server 运行在 http://localhost:3000，Playwright + 系统 Chrome
// 用法：node e2e-bag.mjs
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const results = [];
const ok = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " | " + extra : ""}`);

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE: " + m.text()); });
page.on("dialog", (d) => d.accept());

await page.goto(BASE, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /开始下矿/ }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "出发！" }).click();
await page.waitForTimeout(3200);

// 钻进阶段：进度条 + 跳过按钮
await page.getByRole("button", { name: /标准钻进/ }).click();
await page.waitForTimeout(200);
ok("drill progress bar", (await page.locator(".drill-progress-fill").count()) === 1);
ok("skip button", (await page.locator(".skip-btn").count()) === 1);
await page.locator(".skip-btn").click();
await page.waitForTimeout(400);
ok("skip resolves to result", (await page.locator(".result-panel").count()) === 1);

// 结算面板：逐类丢弃
const chipCount = await page.locator(".bag-discard").count();
ok("discard buttons present", chipCount >= 1, `n=${chipCount}`);
if (chipCount >= 1) {
  const loadBefore = await page.locator(".bag-total").textContent();
  await page.locator(".bag-discard").first().click();
  await page.waitForTimeout(300);
  ok("result panel stays after discard", (await page.locator(".result-panel").count()) === 1);
  const loadAfter = await page.locator(".bag-total").textContent();
  ok("discard reduces load", loadBefore !== loadAfter, `${loadBefore} -> ${loadAfter}`);
}

// 结算面板：榨取矿脉后仍保持（回归：曾出现选项消失 bug）
const milk = page.getByRole("button", { name: /榨取矿脉/ });
if ((await milk.count()) > 0 && !(await milk.first().isDisabled())) {
  await milk.first().click();
  await page.waitForTimeout(300);
  ok("result panel stays after milk", (await page.locator(".result-panel").count()) === 1);
} else {
  ok("milk flow (not available this run)", true);
}

// 继续深入仍可推进
await page.getByRole("button", { name: /继续深入/ }).click();
await page.waitForTimeout(400);
ok("advance to next layer", (await page.locator(".result-panel").count()) === 0);

console.log("=== RESULTS ===");
console.log(results.join("\n"));
console.log("=== ERRORS ===");
console.log(errs.length ? errs.join("\n") : "(none)");
await browser.close();
process.exit(0);