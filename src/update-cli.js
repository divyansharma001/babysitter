#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { BABYSITTER_ROOT } from "./update.js";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: BABYSITTER_ROOT, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

function main() {
  if (!existsSync(`${BABYSITTER_ROOT}/.git`)) {
    throw new Error("This installation is not a Git checkout. Reinstall Babysitter from GitHub to update it.");
  }
  const changes = execFileSync("git", ["-C", BABYSITTER_ROOT, "status", "--porcelain"], { encoding: "utf8" }).trim();
  if (changes) {
    throw new Error("Babysitter has local changes. Commit or stash them before updating so nothing is overwritten.");
  }
  process.stdout.write("Updating Babysitter…\n");
  run("git", ["pull", "--ff-only"]);
  run("npm", ["install"]);
  process.stdout.write("Babysitter is up to date. Restart bbs-codex or bbs-claude.\n");
}

try { main(); } catch (error) {
  console.error(`[babysitter] ${error.message}`);
  process.exitCode = 1;
}
