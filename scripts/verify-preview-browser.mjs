// The hosted Ubuntu runner provides matching Chrome and ChromeDriver binaries.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const origin = "http://127.0.0.1:3412";
assert.equal(process.env.NEXT_PUBLIC_APP_URL, origin);
assert.equal(process.env.VERCEL_ENV, "preview");
const { login } = JSON.parse(await readFile(join(process.env.RUNNER_TEMP, "hamster-preview-fixture.json"), "utf8"));
const driver = spawn(process.env.CHROMEWEBDRIVER ? join(process.env.CHROMEWEBDRIVER, "chromedriver") : "chromedriver",
  ["--port=9515"], {stdio: "ignore"});
let launchError;
driver.on("error", error => { launchError = error; });
let session;

async function request(method, path, body) {
  const response = await fetch("http://127.0.0.1:9515" + path, {
    method, headers: {"Content-Type": "application/json"}, body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const { value } = await response.json();
  if (!response.ok) throw new Error("ChromeDriver " + path + " returned " + value.error);
  return value;
}
const command = (path, body = {}) => request("POST", "/session/" + session + path, body);
async function element(selector) {
  const node = await command("/element", {using: "css selector", value: selector});
  return "/element/" + node["element-6066-11e4-a52e-4f735466cecf"];
}
async function calendar() {
  await element("section.calendar-card button[data-calendar-date]");
  assert.equal(await command("/execute/sync", {script: "return document.querySelector('.calendar-study h1')?.textContent", args: []}), "프리뷰 인증 모임");
}

try {
  for (let attempt = 0; ; attempt++) {
    if (launchError) throw launchError;
    try { if ((await request("GET", "/status")).ready) break; } catch { /* Starting. */ }
    assert.ok(attempt < 40, "ChromeDriver did not become ready");
    await delay(100);
  }
  session = (await request("POST", "/session", {capabilities: {alwaysMatch: {
    browserName: "chrome", "goog:chromeOptions": {args: ["--headless=new", "--disable-dev-shm-usage", "--window-size=390,844"]},
  }}})).sessionId;
  await command("/timeouts", {implicit: 12000});
  await command("/url", {url: origin});
  await command(await element("input[name=login]") + "/value", {text: login});
  await command(await element("input[name=password]") + "/value", {text: "preview-only-password"});
  await command(await element("form button[type=submit]") + "/click");
  await calendar();
  const title = await element("dialog[open] #hamster-release-title");
  assert.equal(await request("GET", "/session/" + session + title + "/text"), "햄쮸터가 업그레이드됐다 쮸!");
  await command(await element("dialog[open] form button") + "/click");
  await command("/refresh");
  await calendar();
  await element("dialog[aria-labelledby='hamster-release-title']");
  const reopened = await command("/execute/async", {
    script: "const done=arguments[0]; requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => done(Boolean(document.querySelector('dialog[open]'))), 0)))",
    args: [],
  });
  assert.equal(reopened, false, "The same release reopened after reload");
  console.log("Chrome signed in with a pre-migration account, opened its calendar, dismissed the update, and retained both on reload.");
} finally {
  try { if (session) await request("DELETE", "/session/" + session); }
  finally { driver.kill(); }
}
