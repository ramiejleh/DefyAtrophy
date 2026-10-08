/*
 * End-to-end: drives the real UI in headless Chrome for all three modes.
 *
 *   PUPPETEER=/path/to/node_modules/puppeteer-core CHROME=/path/to/chrome node test/e2e.mjs [type|learn|review]
 *
 * puppeteer-core is deliberately not a dependency of the plugin: install it somewhere temporary.
 * Set SHOTS=<dir> to save screenshots of each stage.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createGameServer } from "../game/server.js";
import { rows } from "../lib/session.js";
import { AFTER, makeDemo } from "./fixtures/demo.js";

const { default: puppeteer } = await import(pathToFileURL(join(process.env.PUPPETEER, "lib", "esm", "puppeteer", "puppeteer-core.js")).href);
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(mode, viewport = { width: 1440, height: 900 }) {
  const demo = makeDemo(mode);
  const events = [];
  const server = createGameServer({ sessionDir: demo.sessionDir, projectDir: demo.project, emit: (l) => events.push(l) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, defaultViewport: viewport });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // A 409 is the conflict flow working as designed; the browser logs it anyway.
  page.on("console", (m) => m.type() === "error" && !m.text().includes("status of 409") && errors.push(m.text()));
  await page.goto(`http://localhost:${server.address().port}/#t=${server.token}`);
  await page.waitForSelector(".node");
  const session = JSON.parse(readFileSync(join(demo.sessionDir, "session.json"), "utf8"));
  const shot = async (name) => SHOTS && page.screenshot({ path: join(SHOTS, `${mode}-${name}.png`) });
  const close = async () => {
    await browser.close();
    server.closeAllConnections();
    server.close();
    assert.deepEqual(errors, [], "no errors in the browser console");
  };
  const waitEvent = async (prefix, timeout = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (events.some((e) => e.startsWith(prefix))) return;
      await sleep(50);
    }
    throw new Error(`no "${prefix}" event; saw ${events.join(", ")}`);
  };
  const fileOf = (path) => session.steps.flatMap((s) => s.files).find((f) => f.path === path);
  const disk = (path) => (existsSync(join(demo.project, path)) ? readFileSync(join(demo.project, path), "utf8") : null);
  return { ...demo, page, events, session, shot, close, waitEvent, fileOf, disk };
}

const openStep = async (page, n) => {
  const nodes = await page.$$(".node");
  await nodes[n - 1].click();
  await page.waitForSelector(".diagram .card");
  await sleep(300);
};

const openCard = async (page, path) => {
  await page.click(`button.card[data-open="${path}"]`);
  await sleep(400);
};

const noBrokenText = async (page) => {
  const text = await page.evaluate(() => document.body.innerText);
  assert.ok(!/\bundefined\b|\bNaN\b|\[object Object\]/.test(text), "no broken values rendered");
};

/** Types every typed line of a file, with one typo fixed and one autocompleted line along the way. */
async function typeFile(t, path, { typo = false, autocompleteOne = false } = {}) {
  const lines = rows(t.fileOf(path)).filter((r) => r.kind === "typed" && r.text !== "");
  for (const [i, r] of lines.entries()) {
    if (typo && i === 0) {
      await t.page.keyboard.type("#");
      assert.ok(await t.page.$(".row.current .wrong"), "a wrong character shows red");
      await t.page.keyboard.press("Enter");
      assert.ok(await t.page.$(".row.current .wrong"), "Enter doesn't accept a wrong line");
      await t.page.keyboard.press("Backspace");
    }
    if (autocompleteOne && i === 1) await t.page.keyboard.press("Tab");
    else await t.page.keyboard.type(r.text);
    await t.page.keyboard.press("Enter");
  }
  await sleep(1200);
}

async function e2eType() {
  const t = await setup("type", { width: 1280, height: 640 });
  const { page } = t;
  try {
    await t.shot("1-map");
    await noBrokenText(page);
    assert.equal(await page.$$eval(".node", (n) => n.length), 2);
    assert.ok(await page.$eval(".node[data-step='02-use-it']", (n) => n.disabled), "step 2 is locked");

    await openStep(page, 1);
    await t.shot("2-step");
    const orders = await page.$$eval("button.card .order-dot", (els) => els.map((e) => e.textContent));
    assert.deepEqual(orders.sort(), ["1", "2"], "numbered cards");
    assert.equal(await page.$$eval(".card.context", (e) => e.length), 1, "context card");
    assert.ok((await page.$$eval("svg.edges g.edge", (e) => e.length)) >= 2, "import arrows drawn");
    const folders = await page.$$eval(".folder-label", (els) => els.map((e) => e.textContent.trim()));
    assert.ok(folders.some((f) => f.includes("src/")) && folders.some((f) => f.includes("http/")), "files sit in their real folders");

    // File #2 first: free order. config.ts is a modify with given lines around the typed ones.
    await openCard(page, "src/config.ts");
    assert.ok((await page.$$(".row.given")).length >= 3, "unchanged lines are shown for context");
    await typeFile(t, "src/config.ts", { typo: true });
    assert.equal(t.disk("src/config.ts"), AFTER["src/config.ts"], "config.ts written byte for byte");
    assert.ok(t.events.includes("LBL file src/config.ts"));
    await page.waitForSelector(".diagram .card");

    await openCard(page, "src/retry.ts");
    await page.keyboard.type(rows(t.fileOf("src/retry.ts")).find((r) => r.kind === "typed" && r.text).text.slice(0, 10));
    await sleep(100);
    await t.shot("4-typing");
    await page.keyboard.down("Alt");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.up("Alt");
    await typeFile(t, "src/retry.ts", { autocompleteOne: true });
    assert.equal(t.disk("src/retry.ts"), AFTER["src/retry.ts"]);
    await page.waitForSelector("#reflect");
    await t.shot("5-step-done");
    await t.waitEvent("LBL step-done 01-retry-helper");
    const progress = JSON.parse(readFileSync(join(t.sessionDir, "progress.json"), "utf8"));
    assert.equal(progress.files["src/retry.ts"].stats.assisted, 1, "autocomplete is counted");

    await page.type("#reflect", "Retry calls the work function, and when it throws it waits a growing delay before calling it again, up to the configured number of tries.");
    await page.click("#submit");
    await t.waitEvent("LBL reflection 01-retry-helper");
    mkdirSync(join(t.sessionDir, "grades", "steps"), { recursive: true });
    writeFileSync(join(t.sessionDir, "grades", "steps", "01-retry-helper.json"), JSON.stringify({ verdict: "pass", score: 92, feedback: "Clear and **correct**." }));
    await page.waitForSelector(".verdict.pass", { timeout: 8000 });
    await t.shot("6-graded");

    // reopen a finished file: read mode
    await page.click('[data-act="step"]');
    await page.waitForSelector(".diagram .card");
    await openCard(page, "src/retry.ts");
    assert.ok(await page.$(".code.read"), "finished files open read-only");
    await page.keyboard.type("zzz");
    assert.equal(t.disk("src/retry.ts"), AFTER["src/retry.ts"]);
    await page.click(".row.typed");
    await t.shot("7-read-mode");
    assert.notEqual(await page.$eval("#note", (n) => n.textContent), "", "clicking a line shows its note");
    await page.click("[data-back]");
    await page.waitForSelector("[data-back]");
    await page.click("[data-back]");
    await page.waitForSelector(".node");

    // Step 2: a modify with removed lines, a deletion and a tab-indented Go file
    // ...but first someone edits one of its files on disk: a banner warns, and writing it asks first
    writeFileSync(join(t.project, "tools/main.go"), "package main\n// edited by hand\n");
    await page.waitForSelector("#banner.show", { timeout: 8000 });
    await openStep(page, 2);
    await openCard(page, "src/http/client.ts");
    assert.ok((await page.$$(".row.removed")).length > 0, "removed lines are shown struck through");
    await t.shot("8-modify-with-removed");
    // scroll away from the cursor: a pill offers the way back, and typing goes to the cursor regardless
    await page.$eval("#code", (c) => (c.scrollTop = c.scrollHeight));
    await sleep(150);
    await t.shot("9-scrolled-away");
    assert.ok(await page.$eval("#to-cursor", (p) => !p.hidden), "back-to-cursor pill appears when the cursor is out of view");
    await typeFile(t, "src/http/client.ts");
    assert.equal(t.disk("src/http/client.ts"), AFTER["src/http/client.ts"]);
    await page.waitForSelector(".diagram .card");
    await openCard(page, "src/legacy.ts");
    await page.click("#apply-now");
    await page.waitForSelector('.modal [data-act="go"]');
    await page.click('.modal [data-act="go"]');
    await sleep(1200);
    assert.equal(t.disk("src/legacy.ts"), null, "deleted after confirming");
    await page.waitForSelector(".diagram .card");
    await openCard(page, "tools/main.go");
    await typeFile(t, "tools/main.go");
    await page.waitForSelector('.modal [data-act="overwrite"]', { timeout: 8000 });
    await t.shot("11-conflict");
    await page.click('.modal [data-act="overwrite"]');
    await sleep(1500);
    assert.equal(t.disk("tools/main.go"), AFTER["tools/main.go"], "tabs survive, and the overwrite went through");
    await page.waitForSelector("#reflect");
    await page.type("#reflect", "Wrapping the whole request means a bad status code is retried too, not just a network error from fetch. The old constant was dead code.");
    await page.click("#submit");
    await t.waitEvent("LBL complete");
    for (const id of ["02-use-it"]) writeFileSync(join(t.sessionDir, "grades", "steps", `${id}.json`), JSON.stringify({ verdict: "partial", score: 70, feedback: "Close." }));
    await page.waitForSelector('[data-act="final"]', { timeout: 8000 });
    await page.click('[data-act="final"]');
    await page.waitForSelector(".done-wrap.final");
    await sleep(600);
    await t.shot("10-final");
    await noBrokenText(page);
  } finally {
    await t.close();
  }
}

async function e2eReview() {
  const t = await setup("review");
  const { page } = t;
  try {
    await t.shot("1-map");
    assert.equal(await page.$$eval(".node:disabled", (n) => n.length), 0, "review steps are never locked");
    await openStep(page, 2);
    await t.shot("2-step");
    await openCard(page, "src/http/client.ts");
    const stops = rows(t.fileOf("src/http/client.ts")).filter((r) => (r.kind === "typed" || r.kind === "removed") && r.text).length;
    assert.ok(await page.$(".row.current"), "the first changed line is current");
    assert.ok((await page.$$(".row.removed")).length > 0, "removed lines are shown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await sleep(100);
    const pos = await page.$eval("#file-pos", (e) => e.textContent);
    assert.match(pos, /Changed line 2 of/, "↑ goes back");
    await t.shot("3-stepping");
    for (let i = 0; i < stops; i++) await page.keyboard.press("Tab");
    await sleep(1200);
    await page.waitForSelector(".diagram .card");
    for (const path of ["src/legacy.ts", "tools/main.go"]) {
      await openCard(page, path);
      const n = rows(t.fileOf(path)).filter((r) => (r.kind === "typed" || r.kind === "removed") && r.text).length;
      for (let i = 0; i <= n; i++) await page.keyboard.press("Enter");
      await sleep(1200);
    }
    await page.waitForSelector(".done-wrap");
    assert.equal(await page.$("#reflect"), null, "no reflection in review mode");
    await t.shot("4-step-reviewed");
    for (const [path, content] of Object.entries(AFTER)) assert.equal(t.disk(path), content, `review never writes (${path})`);
    assert.ok(!t.events.some((e) => e.startsWith("LBL file")), "no file events");
  } finally {
    await t.close();
  }
}

async function e2eLearn() {
  const t = await setup("learn");
  const { page } = t;
  // Test-only: runs the literal snippets below against the page's CodeMirror instance.
  const cm = (fn, ...args) => page.evaluate((src, a) => new Function("cm", "args", src)(document.querySelector(".CodeMirror").CodeMirror, a), fn, args);
  try {
    await openStep(page, 1);
    await openCard(page, "src/retry.ts");
    await page.waitForSelector(".CodeMirror");
    await t.shot("1-editor");
    const before = await cm("return cm.getLine(0);");
    await cm("cm.setCursor({ line: 0, ch: 3 }); cm.focus();");
    await page.keyboard.type("XYZ");
    assert.equal(await cm("return cm.getLine(0);"), before, "Claude's lines are locked");
    assert.ok(await page.$eval("#btn-reveal", (b) => b.disabled), "reveal is locked at first");

    // write the hole through the keyboard, then fix it up to the reference body
    const holeStart = await cm("return cm.getDoc().getValue().split('\\n').findIndex((l, i) => cm.lineInfo(i).wrapClass?.includes('lbl-hole'));");
    await cm(`cm.setCursor({ line: ${holeStart}, ch: cm.getLine(${holeStart}).length }); cm.focus();`);
    await page.keyboard.type("return work();");
    assert.match(await cm(`return cm.getLine(${holeStart});`), /return work\(\);/, "typing in a hole works");
    await sleep(700);
    await page.click("#btn-hint");
    await t.waitEvent("LBL hint 01-retry-helper src/retry.ts retry");
    await page.click("#btn-submit");
    await t.waitEvent("LBL submit 01-retry-helper src/retry.ts 1");
    await page.waitForSelector(".grade-card .waiting");
    mkdirSync(join(t.sessionDir, "grades", "files"), { recursive: true });
    const gradeFile = join(t.sessionDir, "grades", "files", `${encodeURIComponent("src/retry.ts")}.json`);
    writeFileSync(gradeFile, JSON.stringify([{ attempt: 1, verdict: "retry", score: 30, feedback: "It never retries.", comments: [{ line: holeStart + 1, text: "What happens when `work()` throws?" }] }]));
    await page.waitForSelector(".verdict.retry", { timeout: 8000 });
    assert.ok(await page.$(".lbl-comment"), "inline comment from the grade");
    await t.shot("2-graded-retry");

    const body = AFTER["src/retry.ts"].split("\n").slice(5, 13).join("\n");
    await cm(
      `const doc = cm.getDoc(); const lines = doc.getValue().split('\\n'); const holeLines = lines.map((_, i) => i).filter((i) => cm.lineInfo(i).wrapClass?.includes('lbl-hole'));
       doc.replaceRange(args[0], { line: holeLines[0], ch: 0 }, { line: holeLines.at(-1), ch: cm.getLine(holeLines.at(-1)).length });`,
      body,
    );
    await sleep(600);
    await page.click("#btn-submit");
    await t.waitEvent("LBL submit 01-retry-helper src/retry.ts 2");
    writeFileSync(gradeFile, JSON.stringify([...JSON.parse(readFileSync(gradeFile, "utf8")), { attempt: 2, verdict: "pass", score: 95, feedback: "Spot on.", comments: [] }]));
    try {
      await page.waitForFunction(() => document.querySelector(".diagram .card"), { timeout: 10000 });
    } catch (error) {
      await t.shot("debug-after-pass");
      console.log(t.events, await page.evaluate(() => document.querySelector("#grade")?.innerText));
      throw error;
    }
    assert.equal(t.disk("src/retry.ts"), AFTER["src/retry.ts"], "a pass is written to the project");
    await t.shot("3-after-pass");

    // config.ts has no holes: read it, then write it
    await openCard(page, "src/config.ts");
    await page.waitForSelector("#apply-now");
    await page.click("#apply-now");
    await page.waitForSelector(".done-wrap", { timeout: 8000 });
    assert.equal(t.disk("src/config.ts"), AFTER["src/config.ts"]);
    await t.waitEvent("LBL step-done 01-retry-helper");
    await t.shot("4-step-done");
  } finally {
    await t.close();
  }
}

const which = process.argv[2];
for (const [name, fn] of Object.entries({ type: e2eType, review: e2eReview, learn: e2eLearn })) {
  if (which && which !== name) continue;
  const start = Date.now();
  await fn();
  console.log(`ok - e2e ${name} (${Date.now() - start} ms)`);
}
