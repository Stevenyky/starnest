import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9335;
const url = process.argv[2] || "http://127.0.0.1:8765/";
const outPath = resolve(process.argv[3] || "screens/shot.png");
const width = Number(process.argv[4] || 1440);
const height = Number(process.argv[5] || 1000);
const fullPage = process.argv[6] === "full";
const profile = mkdtempSync(join(tmpdir(), "starnest-shot-"));
const browser = spawn(
  edge,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const page = list.find((item) => item.type === "page");
      if (page) return page;
    } catch {}
    await sleep(120);
  }
  throw new Error("No CDP target");
}

let id = 0;
const pending = new Map();
const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  ws.addEventListener("open", resolveOpen, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolveSend) => {
    const msgId = ++id;
    pending.set(msgId, resolveSend);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width < 700,
});
await send("Page.navigate", { url });
await sleep(Number(process.env.SHOT_WAIT || 2600));
await send("Runtime.evaluate", {
  expression:
    "document.querySelectorAll('[data-reveal]').forEach(function(el){el.classList.add('is-revealed')});window.scrollTo(0,0);",
});
await sleep(650);

let clip;
if (fullPage) {
  const metrics = await send("Page.getLayoutMetrics");
  const content = metrics.result.cssContentSize || metrics.result.contentSize;
  clip = { x: 0, y: 0, width, height: Math.ceil(content.height), scale: 1 };
}
const shot = await send("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
  captureBeyondViewport: fullPage,
  ...(clip ? { clip } : {}),
});
writeFileSync(outPath, Buffer.from(shot.result.data, "base64"));
console.log(
  JSON.stringify({ outPath, width, height, fullPage, innerWidth: (await send("Runtime.evaluate", { expression: "innerWidth", returnByValue: true })).result.result.value })
);
ws.close();
browser.kill();
