import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EDGE =
  process.env.EDGE ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8765/";
const DEBUG_PORT = 9223;
const OUT = path.resolve("screens");
const PROFILE = path.join(os.tmpdir(), "starnest-cdp-" + Date.now());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
const consoleErrors = [];
let ws;
let seq = 0;
const pending = new Map();

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log("PASS  " + name + (detail ? "  — " + detail : ""));
}
function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.log("FAIL  " + name + (detail ? "  — " + detail : ""));
}
function assert(condition, name, detail = "") {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

async function waitFor(fn, timeout = 6000, step = 120) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await fn()) return true;
    } catch {
      /* retry */
    }
    await sleep(step);
  }
  return false;
}

function cdp(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await cdp("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text ||
        "Runtime exception"
    );
  }
  return response.result?.value;
}

async function navigate(hash) {
  await evaluate("location.hash = " + JSON.stringify(hash));
  await sleep(450);
  await waitFor(async () => {
    const state = await evaluate(
      "document.readyState === 'complete' && !!document.querySelector('#app')?.children.length"
    );
    return state;
  });
  await sleep(250);
}

async function revealAll() {
  await evaluate(
    "document.querySelectorAll('[data-reveal]').forEach(el => el.classList.add('is-revealed')); true"
  );
  await sleep(850);
}

async function setField(selector, value) {
  const expression = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error(${JSON.stringify("Missing field: " + selector)});
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value;
  })()`;
  return evaluate(expression);
}

async function click(selector) {
  const expression = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error(${JSON.stringify("Missing click target: " + selector)});
    el.click();
    return true;
  })()`;
  return evaluate(expression);
}

async function screenshot(name) {
  await revealAll();
  const metrics = await cdp("Page.getLayoutMetrics");
  const size = metrics.cssContentSize || metrics.contentSize;
  const width = Math.min(1440, Math.ceil(size.width));
  const height = Math.min(16000, Math.ceil(size.height));
  const shot = await cdp("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(shot.data, "base64"));
  console.log("SHOT  screens/" + name + ".png  " + width + "x" + height);
}

async function goClean() {
  await evaluate("localStorage.clear(); true");
  await cdp("Page.reload", { ignoreCache: true });
  await sleep(700);
  await waitFor(async () => {
    return evaluate("document.readyState === 'complete' && !!document.querySelector('#app')?.children.length");
  });
  await sleep(250);
}

const edge = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--remote-debugging-port=" + DEBUG_PORT,
    "--user-data-dir=" + PROFILE,
    "--window-size=1440,1000",
    "about:blank",
  ],
  { stdio: "ignore" }
);

let exitCode = 0;
try {
  const ready = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      return response.ok;
    } catch {
      return false;
    }
  }, 12000);
  if (!ready) throw new Error("Edge DevTools endpoint did not start");

  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("No page target");

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("WebSocket failed"));
  });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      consoleErrors.push(
        message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text
      );
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
      consoleErrors.push(message.params.entry.text);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push(
        message.params.args.map((arg) => arg.value || arg.description || "").join(" ")
      );
    }
  };

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await cdp("Page.navigate", { url: BASE + "#/" });
  await sleep(900);
  await waitFor(async () => {
    return evaluate("document.readyState === 'complete' && !!document.querySelector('#app')?.children.length");
  });
  await goClean();

  assert(
    await evaluate("document.querySelector('.hero h1')?.textContent.includes('无限席位')"),
    "首页加载"
  );
  assert(
    (await evaluate("document.querySelectorAll('.dept-card').length")) === 8,
    "首页 8 个部门卡"
  );
  assert(
    (await evaluate("document.querySelectorAll('.role-card').length")) === 6,
    "首页 6 个精选岗位"
  );
  await screenshot("home-final");

  await click('.main-nav a[href="#/careers"]');
  await sleep(500);
  assert((await evaluate("location.hash")) === "#/careers", "导航到开放岗位");
  assert(
    (await evaluate("document.querySelectorAll('#role-results .role-card').length")) === 31,
    "岗位列表 31 个"
  );

  await setField("#role-search", "安全");
  await sleep(300);
  const safetyCount = await evaluate(
    "document.querySelectorAll('#role-results .role-card').length"
  );
  assert(safetyCount > 0 && safetyCount < 31, "关键词筛选生效", "匹配 " + safetyCount + " 个");
  assert(
    (await evaluate("document.querySelector('#role-search')?.value")) === "安全",
    "搜索词保留"
  );

  await click('[data-action="clear-filters"]');
  await sleep(300);
  assert(
    (await evaluate("document.querySelectorAll('#role-results .role-card').length")) === 31,
    "清除筛选"
  );

  await evaluate("document.querySelector('#role-results .role-card').click(); true");
  await sleep(250);
  assert(await evaluate("document.getElementById('site-dialog').open"), "岗位详情弹窗打开");
  assert(
    await evaluate("document.querySelector('#dialog-content h2')?.textContent.length > 0"),
    "岗位详情有内容"
  );
  await click('[data-action="close-dialog"]');
  await sleep(250);
  assert(!(await evaluate("document.getElementById('site-dialog').open")), "岗位弹窗关闭");

  await click('[data-action="open-compass"]');
  await sleep(300);
  assert(await evaluate("document.getElementById('site-dialog').open"), "岗位罗盘打开");
  for (let i = 0; i < 3; i += 1) {
    await evaluate("document.querySelector('.compass-option')?.click(); true");
    await sleep(250);
  }
  assert(
    await evaluate("!!document.querySelector('.compass-result')"),
    "罗盘生成推荐结果"
  );
  const recommended = await evaluate(
    "document.querySelector('.compass-role')?.textContent.trim() || ''"
  );
  assert(Boolean(recommended), "罗盘推荐岗位", recommended);
  await click('[data-action="compass-apply"]');
  await sleep(600);
  assert((await evaluate("location.hash")) === "#/join", "罗盘结果带入入职");

  await setField("#join-name", "林一页");
  await setField("#join-school", "南山大学");
  await setField("#join-major", "计算机");
  await setField("#join-grade", "大三");
  await click('[data-action="wizard-next"]');
  await sleep(400);
  assert(
    (await evaluate("document.querySelector('.wizard-progress-step.is-active .wizard-progress-label')?.textContent")) ===
      "选航线",
    "进入第二步"
  );

  await setField("#join-role", "frontend-engineer");
  await sleep(300);
  const chipCount = await evaluate("document.querySelectorAll('.skill-chip').length");
  assert(chipCount > 0, "岗位能力选项出现", chipCount + " 个");
  await evaluate(`(() => {
    const chip = document.querySelector('.skill-chip');
    if (!chip) throw new Error('Skill chip missing');
    chip.click();
    return true;
  })()`);
  await setField(
    "#join-motivation",
    "我想做一个让新生不用在群里反复问这个专业能做什么的页面。"
  );
  await click('[data-action="wizard-next"]');
  await sleep(400);
  assert(
    (await evaluate("document.querySelector('.wizard-progress-step.is-active .wizard-progress-label')?.textContent")) ===
      "工作方式",
    "进入第三步"
  );

  await setField("#join-hours", "6–10 小时 / 周");
  await setField("#join-start", "两周内");
  await evaluate("document.querySelectorAll('input[name=workStyle]')[1].click(); true");
  await click('[data-action="wizard-next"]');
  await sleep(400);
  assert(
    (await evaluate("document.querySelector('.wizard-progress-step.is-active .wizard-progress-label')?.textContent")) ===
      "确认承诺",
    "进入第四步"
  );

  await evaluate(
    "document.querySelectorAll('[data-consent]').forEach(el => el.click()); true"
  );
  await click('[data-action="wizard-next"]');
  await sleep(700);
  assert((await evaluate("location.hash")) === "#/welcome", "完成入职并进入欢迎页");
  assert(
    (await evaluate("document.querySelector('.offer-heading')?.textContent.includes('林一页')")) === true,
    "欢迎页显示称呼"
  );
  const residentId = await evaluate(
    "JSON.parse(localStorage.getItem('starnest.resident.v1')).id"
  );
  assert(/^SN-\d{4}-\d{4}$/.test(residentId), "生成工号", residentId);
  await screenshot("welcome-final");

  await click('.offer-actions a[href="#/workspace"]');
  await sleep(500);
  assert((await evaluate("location.hash")) === "#/workspace", "进入我的工位");
  assert(await evaluate("!!document.querySelector('.id-card')"), "显示数字工牌");
  assert(
    (await evaluate("document.querySelectorAll('.check-item').length")) === 6,
    "显示 6 项入职清单"
  );
  assert(
    (await evaluate("document.querySelectorAll('.check-item.is-done').length")) === 1,
    "工牌项默认完成"
  );
  await evaluate("document.querySelector('[data-action=\"toggle-check\"][data-key=\"charter\"]').click(); true");
  await sleep(300);
  const progress = await evaluate(
    "document.querySelector('.progress-bar')?.getAttribute('aria-valuenow') || document.querySelector('.progress-bar')?.textContent"
  );
  assert(progress !== null && progress !== undefined, "清单进度更新", String(progress));

  await evaluate("document.querySelector('[data-action=\"toggle-task\"]')?.click(); true");
  await sleep(250);
  assert(
    await evaluate("!!document.querySelector('.task-item.is-done')"),
    "任务勾选生效"
  );

  await click('[data-action="focus-reflection"]');
  await sleep(450);
  assert(
    (await evaluate("document.activeElement?.id")) === "reflection-did",
    "复盘入口聚焦输入框"
  );

  await evaluate(
    "document.getElementById('reflection-did').value = '补齐了岗位筛选的空状态，也写清了什么情况下会出现空结果。';" +
      "document.getElementById('reflection-learned').value = '空状态不是装饰，它要告诉用户下一步能做什么。';" +
      "document.getElementById('reflection-next').value = '找一位同学做一次 10 分钟可用性测试。'; true"
  );
  await click('[data-action="save-reflection"]');
  await sleep(350);
  assert(
    (await evaluate("document.querySelectorAll('.reflection-entry').length")) === 1,
    "保存第一周复盘"
  );
  assert(
    (await evaluate("document.getElementById('reflection-count')?.textContent.includes('1 / 8')")) === true,
    "复盘计数更新"
  );
  assert(
    (await evaluate("document.querySelector('[data-action=\"toggle-check\"][data-key=\"reflection\"]')?.classList.contains('is-done')")) === true,
    "复盘自动完成清单项"
  );
  await evaluate(
    "document.getElementById('reflection-did').value = '完成第一次周复盘，并把任务拆成了三个小步骤。'; true"
  );
  await click('[data-action="save-reflection"]');
  await sleep(300);
  assert(
    (await evaluate("document.querySelectorAll('.reflection-entry').length")) === 2,
    "保存第二周复盘"
  );
  await evaluate("window.confirm = () => true; true");
  await click('[data-action="delete-reflection"]');
  await sleep(300);
  assert(
    (await evaluate("document.querySelectorAll('.reflection-entry').length")) === 1,
    "删除一条复盘"
  );
  await cdp("Page.reload", { ignoreCache: true });
  await sleep(700);
  await waitFor(async () => {
    return evaluate("document.readyState === 'complete' && !!document.querySelector('.reflection-entry')");
  });
  assert(
    (await evaluate("document.querySelectorAll('.reflection-entry').length")) === 1,
    "复盘刷新后仍保留"
  );

  await click('[data-action="toggle-sleep"]');
  await sleep(350);
  assert(
    (await evaluate("document.querySelector('.workspace-sub')?.textContent.includes('休眠中')")) === true,
    "暂停状态切换"
  );
  await screenshot("workspace-final");

  await navigate("/security");
  assert(
    (await evaluate("document.querySelectorAll('.protection-card').length")) >= 6,
    "安全基线卡片"
  );
  await evaluate(
    "document.querySelector('.quiz-option input')?.click(); true"
  );
  await sleep(200);
  assert(
    (await evaluate("document.querySelectorAll('input[name=\"quiz\"]:checked').length")) === 1,
    "安全题可选中"
  );
  for (let i = 0; i < 4; i += 1) {
    await evaluate("document.querySelector('[data-action=\"quiz-next\"]')?.click(); true");
    await sleep(220);
    await evaluate("document.querySelector('.quiz-option input')?.click(); true");
    await sleep(220);
  }
  await evaluate("document.querySelector('[data-action=\"quiz-next\"]')?.click(); true");
  await sleep(350);
  assert(
    await evaluate("!!document.querySelector('.quiz-result') || !!document.querySelector('.quiz-score')"),
    "安全演练完成"
  );
  assert(
    (await evaluate("document.querySelectorAll('#audit-panel-content .audit-entry').length")) > 0,
    "审计日志记录"
  );
  await screenshot("security-final");

  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await navigate("/workspace");
  const workspaceOverflow = await evaluate(
    "document.documentElement.scrollWidth - window.innerWidth"
  );
  assert(workspaceOverflow <= 1, "移动端工位无横向溢出", "diff " + workspaceOverflow + "px");
  assert(
    (await evaluate("document.querySelectorAll('.reflection-entry').length")) === 1,
    "移动端显示复盘记录"
  );
  await screenshot("workspace-mobile-final");

  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await navigate("/security");
  await evaluate("window.confirm = () => true; true");
  await click('[data-action="delete-data"]');
  await sleep(400);
  assert(
    (await evaluate("localStorage.getItem('starnest.resident.v1')")) === null,
    "删除全部数据"
  );
  assert((await evaluate("location.hash")) === "#/", "删除后回到首页");

  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp("Page.reload", { ignoreCache: true });
  await sleep(800);
  await waitFor(async () => {
    return evaluate("document.readyState === 'complete' && !!document.querySelector('#app')?.children.length");
  });
  const overflow = await evaluate(
    "document.documentElement.scrollWidth - window.innerWidth"
  );
  assert(overflow <= 1, "移动端无横向溢出", "diff " + overflow + "px");
  await click(".nav-toggle");
  await sleep(200);
  assert(await evaluate("document.querySelector('.main-nav').classList.contains('is-open')"), "移动端导航展开");
  await screenshot("home-mobile");

  assert(consoleErrors.length === 0, "无浏览器控制台错误", consoleErrors.join(" | ").slice(0, 300));
} catch (error) {
  exitCode = 1;
  fail("测试执行异常", error.message);
  console.error(error);
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  edge.kill();
  await sleep(200);
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const failures = results.filter((item) => !item.ok);
  console.log("");
  console.log(`RESULT  ${results.length - failures.length}/${results.length} passed`);
  if (failures.length) {
    console.log("Failures: " + failures.map((item) => item.name).join(", "));
  }
  if (exitCode) process.exitCode = 1;
  else if (failures.length) process.exitCode = 1;
}
