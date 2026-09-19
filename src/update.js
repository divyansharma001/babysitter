import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const BABYSITTER_REPOSITORY = "divyansharma001/babysitter";
export const BABYSITTER_ROOT = fileURLToPath(new URL("../", import.meta.url));

function cacheFile(env = process.env) {
  return env.JEV_AUTO_UPDATE_CACHE || `${homedir()}/.cache/babysitter/update.json`;
}

function intervalMs(env = process.env) {
  const hours = Number(env.JEV_AUTO_UPDATE_INTERVAL_HOURS || 24);
  return Number.isFinite(hours) && hours >= 1 ? hours * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

function readCache(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function writeCache(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value)}\n`);
  } catch {}
}

function localCommit(root) {
  if (!existsSync(`${root}/.git`)) return "";
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 1000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return ""; }
}

export function updateFromComparison(comparison) {
  const commits = Number(comparison?.ahead_by || 0);
  if (commits < 1) return null;
  return {
    available: true,
    commits,
    latestCommit: comparison.commits?.at(-1)?.sha || "",
    url: `https://github.com/${BABYSITTER_REPOSITORY}`,
  };
}

export async function checkForBabysitterUpdate({
  env = process.env,
  now = Date.now(),
  root = BABYSITTER_ROOT,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (env.JEV_AUTO_UPDATE_CHECK === "0" || env.JEV_AUTO_UPDATE_CHECK === "false") return null;
  const currentCommit = localCommit(root);
  if (!currentCommit || typeof fetchImpl !== "function") return null;

  const path = cacheFile(env);
  const cached = readCache(path);
  if (cached?.currentCommit === currentCommit && now - cached.checkedAt < intervalMs(env)) {
    return cached.update || null;
  }

  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${BABYSITTER_REPOSITORY}/compare/${currentCommit}...main`,
      {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "babysitter-update-check" },
        signal: AbortSignal.timeout(1800),
      },
    );
    if (!response.ok) return null;
    const update = updateFromComparison(await response.json());
    writeCache(path, { checkedAt: now, currentCommit, update });
    return update;
  } catch {
    return null;
  }
}

export function updateNotice(update) {
  if (!update?.available) return "";
  const count = `${update.commits} new commit${update.commits === 1 ? "" : "s"}`;
  return `Babysitter update available · ${count} · run bbs-update`;
}
