/**
 * bun scripts/release/npm.ts [dist] — builds the npm packages of the CLI from
 * a goreleaser dist directory (after `goreleaser release`):
 *
 *   dist/npm/cli-<os>-<cpu>/   @vantedev/hookline-cli-<os>-<cpu>, one native binary each
 *   dist/npm/cli/              hookline-cli, the launcher (cli/npm/hookline.js)
 *                              with the platform packages as optional dependencies
 *
 * Publish the platform packages first, then the launcher (release.yml does).
 */
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

type Artifact = { type: string; path: string; goos?: string; goarch?: string };

const root = path.resolve(import.meta.dirname, "..", "..");
const dist = path.resolve(process.argv[2] ?? path.join(root, "dist"));
const out = path.join(dist, "npm");

const { version } = JSON.parse(readFileSync(path.join(dist, "metadata.json"), "utf8")) as {
  version: string;
};
const artifacts = JSON.parse(readFileSync(path.join(dist, "artifacts.json"), "utf8")) as Artifact[];

const OS: Record<string, string> = { darwin: "darwin", linux: "linux", windows: "win32" };
const CPU: Record<string, string> = { amd64: "x64", arm64: "arm64" };

const common = {
  version,
  license: "GPL-3.0-only",
  homepage: "https://hookline.vante.app/docs/cli",
  repository: {
    type: "git",
    url: "git+https://github.com/kaanxsrd/hookline.git",
    directory: "cli",
  },
};

rmSync(out, { recursive: true, force: true });
const optional: Record<string, string> = {};

for (const a of artifacts.filter((x) => x.type === "Binary")) {
  const os = OS[a.goos ?? ""];
  const cpu = CPU[a.goarch ?? ""];
  if (!os || !cpu) continue;
  const name = `@vantedev/hookline-cli-${os}-${cpu}`;
  const dir = path.join(out, `cli-${os}-${cpu}`);
  const exe = os === "win32" ? "hookline.exe" : "hookline";
  mkdirSync(path.join(dir, "bin"), { recursive: true });
  copyFileSync(path.resolve(root, a.path), path.join(dir, "bin", exe));
  chmodSync(path.join(dir, "bin", exe), 0o755);
  writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify(
      {
        name,
        ...common,
        description: `The hookline CLI binary for ${os} ${cpu}. Install hookline-cli instead.`,
        os: [os],
        cpu: [cpu],
        files: ["bin"],
        preferUnplugged: true,
      },
      null,
      2,
    )}\n`,
  );
  optional[name] = version;
}

if (Object.keys(optional).length !== 6) {
  throw new Error(`expected 6 platform binaries in ${dist}, found ${Object.keys(optional).length}`);
}

const launcher = path.join(out, "cli");
mkdirSync(path.join(launcher, "bin"), { recursive: true });
copyFileSync(
  path.join(root, "cli", "npm", "hookline.js"),
  path.join(launcher, "bin", "hookline.js"),
);
copyFileSync(path.join(root, "cli", "npm", "README.md"), path.join(launcher, "README.md"));
copyFileSync(path.join(root, "LICENSE"), path.join(launcher, "LICENSE"));
writeFileSync(
  path.join(launcher, "package.json"),
  `${JSON.stringify(
    {
      name: "hookline-cli",
      ...common,
      description: "Catch every webhook. Replay anything. Pipe it to localhost.",
      keywords: ["webhooks", "tunnel", "cli", "localhost", "stripe", "github"],
      type: "module",
      bin: { hookline: "bin/hookline.js" },
      files: ["bin", "README.md", "LICENSE"],
      engines: { node: ">=18" },
      optionalDependencies: optional,
    },
    null,
    2,
  )}\n`,
);

console.log(`npm packages for ${version} in ${path.relative(root, out)}:`);
for (const name of [...Object.keys(optional), "hookline-cli"]) console.log(`  ${name}`);
