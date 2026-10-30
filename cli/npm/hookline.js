#!/usr/bin/env node
// Launcher of the @hookline/cli npm package: runs the native binary from the
// platform package npm installed as an optional dependency (no postinstall
// script, no download at install time).
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const platforms = {
  "darwin-arm64": "@hookline/cli-darwin-arm64",
  "darwin-x64": "@hookline/cli-darwin-x64",
  "linux-arm64": "@hookline/cli-linux-arm64",
  "linux-x64": "@hookline/cli-linux-x64",
  "win32-arm64": "@hookline/cli-win32-arm64",
  "win32-x64": "@hookline/cli-win32-x64",
};

const key = `${process.platform}-${process.arch}`;
const pkg = platforms[key];
if (!pkg) {
  console.error(
    `hookline: no build for ${key}. Download one from https://github.com/kaanxsrd/hookline/releases`,
  );
  process.exit(1);
}

let binary;
try {
  const exe = process.platform === "win32" ? "hookline.exe" : "hookline";
  binary = createRequire(import.meta.url).resolve(`${pkg}/bin/${exe}`);
} catch {
  console.error(
    `hookline: ${pkg} is not installed. Reinstall without --no-optional / --omit=optional:\n` +
      "  npm install -g @hookline/cli",
  );
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  console.error(`hookline: ${result.error.message}`);
  process.exit(1);
}
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
