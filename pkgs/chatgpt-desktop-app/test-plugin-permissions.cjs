const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { patch } = require(process.argv[3]);

async function loadCopies(directory) {
  const files = (await fs.readdir(directory)).filter(name => name.endsWith(".js"));
  const bundles = await Promise.all(files.map(name => fs.readFile(path.join(directory, name), "utf8")));
  const candidates = bundles.filter(source => source.includes("await (async function nixWritablePluginCopy"));
  assert.equal(candidates.length, 1, "the bundled marketplace copy helper must be patched");
  return candidates.map(source => {
    const marker = source.indexOf("await (async function nixWritablePluginCopy");
    const start = [...source.slice(0, marker).matchAll(/async function(?:\s+[\w$]+)?\(/g)].at(-1)?.index ?? -1;
    const windowsCopy = source.indexOf("copyDirectoryAllowDecryptedDestinationOnEncryptionFailure", marker);
    assert(start >= 0 && windowsCopy > marker);
    // The helper may be immediately invoked or followed by another declaration.
    // Let the JS parser find its closing brace instead of assuming a separator.
    let helper;
    for (let end = source.indexOf("}", windowsCopy); end >= 0; end = source.indexOf("}", end + 1)) {
      const candidate = source.slice(start, end + 1);
      try {
        new vm.Script(`(${candidate})`);
        helper = candidate;
        break;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    assert(helper, "could not extract marketplace copy helper");
    const fsAlias = helper.match(/([\w$]+)\(\)\.cp\(/)[1];
    const osAlias = helper.match(/"win32"!==([\w$]+)\(\)\.platform/);
    return vm.runInNewContext(`(${helper})`, {
      [fsAlias]: () => fs,
      ...(osAlias ? { [osAlias[1]]: () => ({ platform: "linux" }) } : {}),
      process: { platform: "linux" },
      require,
    });
  });
}

async function checkCopy(copy) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-plugin-permissions-"));
  const source = path.join(root, "source");
  const baseline = path.join(root, "baseline");
  const destination = path.join(root, "destination");
  const outside = path.join(root, "outside");
  const mode = async file => (await fs.stat(file)).mode & 0o777;
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
    await assert.rejects(fs.writeFile(path.join(baseline, ".codex-plugin", "plugin.json"), "changed"), { code: "EACCES" });
    await assert.rejects(fs.rm(path.join(baseline, "skills", "live"), { recursive: true }), { code: "EACCES" });

    for (let attempt = 0; attempt < 2; attempt++) {
      await copy(source, destination);
      assert.equal(await mode(destination), 0o755);
      assert.equal(await mode(path.join(destination, ".codex-plugin", "plugin.json")), 0o644);
      assert.equal(await mode(path.join(destination, "executable")), 0o755);
      assert.equal(await fs.readlink(path.join(destination, "directory-link")), outside);
      await fs.writeFile(path.join(destination, ".codex-plugin", "plugin.json"), '{"bundledContentVariant":"live-disabled"}');
      await fs.rm(path.join(destination, "skills", "live"), { recursive: true });
      await fs.mkdir(path.join(destination, "new-directory"));
      await fs.rm(destination, { recursive: true });
    }
    assert.equal(await mode(source), 0o555);
    assert.equal(await mode(path.join(source, ".codex-plugin", "plugin.json")), 0o444);
    assert.equal(await fs.readFile(path.join(source, ".codex-plugin", "plugin.json"), "utf8"), '{"name":"visualize"}');
    assert.equal(await mode(outside), 0o555);
    assert.equal(await mode(path.join(outside, "sentinel")), 0o444);
    assert.equal(await fs.readFile(path.join(outside, "sentinel"), "utf8"), "unchanged");
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

async function main() {
  assert.notEqual(process.getuid(), 0, "run unprivileged so permission checks are meaningful");
  assert.throws(() => patch("upstream helper changed"), /Expected one bundled plugin copy branch/);
  for (const copy of await loadCopies(process.argv[2])) await checkCopy(copy);
  console.log("Bundled plugin copy: edits, cleanup and repeated updates work; read-only inputs and symlink targets unchanged");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
