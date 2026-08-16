import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

const trialPath = process.env.TRIAL_PATH ?? "p403-h2-local";
const sourceSha = process.env.TRIAL_SOURCE_SHA ?? "UNSET";
if (!/^[a-z0-9-]{8,64}$/.test(trialPath)) throw new Error("invalid TRIAL_PATH");

rmSync("trials/p4-03-h2/generated", { recursive: true, force: true });
rmSync("dist", { recursive: true, force: true });
execFileSync("npm", ["run", "build:web"], { stdio: "inherit" });
execFileSync("./node_modules/.bin/tsc", ["-p", "tsconfig.p4-03-h2-trial.json"], { stdio: "inherit" });

const outputRoot = `dist/${trialPath}`;
mkdirSync(outputRoot, { recursive: true });
cpSync("web/index.html", "dist/index.html");
cpSync("web/styles.css", "dist/styles.css");
cpSync("web/generated", "dist/generated", { recursive: true });
cpSync("trials/p4-03-h2/generated", `${outputRoot}/generated`, { recursive: true });
cpSync("trials/p4-03-h2/index.html", `${outputRoot}/index.html`);
cpSync("trials/p4-03-h2/styles.css", `${outputRoot}/styles.css`);

const generatedContent = `${outputRoot}/generated/trials/p4-03-h2/content.js`;
const content = readFileSync(generatedContent, "utf8").replaceAll("__TRIAL_SOURCE_SHA__", sourceSha);
writeFileSync(generatedContent, content);

writeFileSync("dist/.nojekyll", "");
writeFileSync("dist/robots.txt", "User-agent: *\nDisallow: /\n");
writeFileSync("dist/404.html", `<!doctype html><html lang="ja"><head><meta name="robots" content="noindex,nofollow"><meta charset="utf-8"><title>Not found</title></head><body><p>試遊ページは公開されていません。</p></body></html>`);
writeFileSync(`${outputRoot}/trial-manifest.json`, JSON.stringify({
  candidateId: "candidate.p4-03.h2",
  sourceSha,
  trialPath,
  noTelemetry: true,
  fixedSeeds: 8,
}, null, 2) + "\n");
