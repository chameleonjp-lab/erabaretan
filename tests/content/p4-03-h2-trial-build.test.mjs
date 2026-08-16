import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("normal web build keeps the H2 balance module out", () => {
  const webConfig = read("tsconfig.web.json");
  assert.match(webConfig, /packages\/content\/src\/balance\/\*\*\/\*\.ts/);
  const index = read("packages/content/src/index.ts");
  assert.doesNotMatch(index, /p4-03-h2|P4_03_H2/);
});

test("trial source binds setup, executor, preview, and display to H2", () => {
  const content = read("trials/p4-03-h2/content.ts");
  assert.match(content, /p4-03-h2/);
  assert.match(content, /P4_03_H2_PROFILE\.catalog/);
  assert.match(content, /previewCommand/);
  const main = read("trials/p4-03-h2/src/main.ts");
  assert.match(main, /H2試遊版/);
  assert.match(main, /H2_TRIAL_SOURCE_SHA/);
  const battle = read("trials/p4-03-h2/src/battle-shell.ts");
  assert.match(battle, /世界へ8/);
});

test("trial uses eight fixed seeds and exposes a copyable record", () => {
  const local = read("trials/p4-03-h2/src/local-match.ts");
  assert.equal((local.match(/0000000000000000000000000000000[1-8]/g) ?? []).length, 8);
  assert.match(read("trials/p4-03-h2/src/main.ts"), /data-copy-trial-record/);
});

test("Pages publication is manual and supports cleanup", () => {
  const workflow = read(".github/workflows/h2-human-trial-pages.yml");
  assert.match(workflow, /workflow_dispatch/);
  assert.doesNotMatch(workflow, /^\s+push:/m);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /operation.*cleanup|cleanup.*operation/s);
  assert.match(workflow, /p403-h2-\$\{\{ github\.run_id \}\}/);
});
