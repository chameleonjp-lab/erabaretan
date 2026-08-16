import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

rmSync("web/generated", { recursive: true, force: true });
execFileSync("./node_modules/.bin/tsc", ["-p", "tsconfig.web.json"], { stdio: "inherit" });
