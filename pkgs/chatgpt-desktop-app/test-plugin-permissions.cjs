const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { patch } = require(process.argv[3] || "./patch-plugin-permissions.cjs");

async function loadPatchedCopy(directory) {
  const files = (await fs.readdir(directory)).filter(name => /^main-.*\.js$/.test(name));
  const bundles = await Promise.all(files.map(name => fs.readFile(path.join(directory, name), "utf8")));
  const candidates = bundles.filter(source => source.includes("await (async function nixWritablePluginCopy"));
  assert.equal(candidates.length, 1, "exactly one patched marketplace bundle");
  const source = candidates[0];
  const marker = source.indexOf("await (async function nixWritablePluginCopy");
  const start = source.lastIndexOf("async function ", marker);
  const windowsCopy = source.indexOf("copyDirectoryAllowDecryptedDestinationOnEncryptionFailure", marker);
  const end = source.indexOf("async function ", windowsCopy);
  assert(start >= 0 && windowsCopy > marker && end > windowsCopy);
  const helper = source.slice(start, end);
  const fsAlias = helper.match(/([\w$]+)\.default\.cp\(/)[1];
  const osAlias = helper.match(/([\w$]+)\.default\.platform/)[1];
  // Execute the actual patched helper without launching Electron or importing
  // the rest of the app. Only the Linux branch is available in this context.
  return vm.runInNewContext(`(${helper})`, {
    [fsAlias]: { default: fs },
    [osAlias]: { default: { platform: "linux" } },
    require,
  });
}

async function main() {
  assert.notEqual(process.getuid(), 0, "run as a non-root user so permission failures are meaningful");
  const copy = await loadPatchedCopy(process.argv[2]);
  assert.throws(() => patch("upstream helper changed"), /Expected one bundled plugin copy branch/);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-plugin-permissions-"));
  const source = path.join(root, "source");
  const baseline = path.join(root, "baseline");
  const destination = path.join(root, "destination");
  const outside = path.join(root, "outside");
  const mode = async file => (await fs.stat(file)).mode & 0o777;
  const denied = error => error.code === "EACCES";
  try {
    await fs.mkdir(path.join(source, ".codex-plugin"), { recursive: true });
    await fs.mkdir(path.join(source, "skills", "live"), { recursive: true });
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "sentinel"), "unchanged", { mode: 0o444 });
    await fs.writeFile(path.join(source, ".codex-plugin", "plugin.json"), '{"name":"visualize"}', { mode: 0o444 });
    await fs.writeFile(path.join(source, "skills", "live", "SKILL.md"), "skill", { mode: 0o444 });
    await fs.writeFile(path.join(source, "executable"), "#!/bin/sh\n", { mode: 0o555 });
    await fs.symlink(path.join(outside, "sentinel"), path.join(source, "file-link"));
    await fs.symlink(outside, path.join(source, "directory-link"));
    for (const directory of [source, path.join(source, ".codex-plugin"), path.join(source, "skills"), path.join(source, "skills", "live"), outside]) {
      await fs.chmod(directory, 0o555);
    }

    await fs.cp(source, baseline, { recursive: true, verbatimSymlinks: true });
    await assert.rejects(fs.writeFile(path.join(baseline, ".codex-plugin", "plugin.json"), "changed"), denied);
    await assert.rejects(fs.rm(path.join(baseline, "skills", "live"), { recursive: true }), denied);

    await copy(source, destination);
    assert.equal(await mode(destination), 0o755);
    assert.equal(await mode(path.join(destination, ".codex-plugin", "plugin.json")), 0o644);
    assert.equal(await mode(path.join(destination, "executable")), 0o755);
    assert.equal(await fs.readlink(path.join(destination, "directory-link")), outside);
    await fs.writeFile(path.join(destination, ".codex-plugin", "plugin.json"), '{"bundledContentVariant":"live-disabled"}');
    await fs.rm(path.join(destination, "skills", "live"), { recursive: true });
    await fs.mkdir(path.join(destination, "new-directory"));
    await fs.rm(destination, { recursive: true });
    // A fresh copy also works on a later update.
    await copy(source, destination);
    await fs.rm(destination, { recursive: true });

    assert.equal(await mode(source), 0o555);
    assert.equal(await mode(path.join(source, ".codex-plugin", "plugin.json")), 0o444);
    assert.equal(await fs.readFile(path.join(source, ".codex-plugin", "plugin.json"), "utf8"), '{"name":"visualize"}');
    assert.equal(await mode(outside), 0o555);
    assert.equal(await mode(path.join(outside, "sentinel")), 0o444);
    assert.equal(await fs.readFile(path.join(outside, "sentinel"), "utf8"), "unchanged");
    console.log("Plugin permissions: reproduced EACCES; patched copy supports edits, cleanup and repeated updates; source and symlink targets unchanged");
  } finally {
    async function clean(directory) {
      const stat = await fs.lstat(directory);
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        await fs.chmod(directory, 0o700);
        for (const name of await fs.readdir(directory)) await clean(path.join(directory, name));
      }
    }
    await clean(root);
    await fs.rm(root, { recursive: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
