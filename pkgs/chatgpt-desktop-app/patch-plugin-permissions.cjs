// Adapt the bundled marketplace's Linux copy helper to read-only Nix inputs.
// Fail closed when upstream changes the helper instead of silently losing the fix.
const fs = require("node:fs");
const path = require("node:path");

const copyBranch = /if\((?<os>[\w$]+\.default)\.platform!==`win32`\)\{await (?<fs>[\w$]+\.default)\.cp\((?<source>[\w$]+),(?<destination>[\w$]+),\{recursive:!0,verbatimSymlinks:!0\}\);return\}/g;

function findCopyBranch(source) {
  const matches = [...source.matchAll(copyBranch)];
  if (matches.length !== 1) {
    throw new Error(`Expected one bundled plugin copy branch, found ${matches.length}`);
  }
  const match = matches[0];
  const before = source.slice(Math.max(0, match.index - 250), match.index);
  const after = source.slice(match.index + match[0].length, match.index + match[0].length + 350);
  if (!before.includes("/usr/bin/ditto") ||
      !after.includes("copyDirectoryAllowDecryptedDestinationOnEncryptionFailure")) {
    throw new Error("Copy branch is not the expected bundled marketplace helper");
  }
  return match;
}

function patch(source) {
  const match = findCopyBranch(source);
  const api = match.groups.fs;
  const destination = match.groups.destination;
  // Walk only the newly copied tree. lstat avoids chmod following symlinks
  // back into the Nix store or to any other target outside the cache.
  const makeWritable = `await (async function nixWritablePluginCopy(root){
    const stat=await ${api}.lstat(root);
    if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))return;
    await ${api}.chmod(root,(stat.mode&0o7777)|0o200);
    if(stat.isDirectory())for(const name of await ${api}.readdir(root))
      await nixWritablePluginCopy(require("node:path").join(root,name));
  })(${destination});`;
  const replacement = match[0].replace(";return}", `;${makeWritable}return}`);
  return source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length);
}

function patchDirectory(directory) {
  const candidates = fs.readdirSync(directory)
    .filter(name => /^main-.*\.js$/.test(name))
    .map(name => path.join(directory, name))
    .filter(file => fs.readFileSync(file, "utf8").includes("plugin_marketplace_folder_write_failed"));
  if (candidates.length !== 1) {
    throw new Error(`Expected one marketplace main bundle, found ${candidates.length}`);
  }
  const file = candidates[0];
  fs.writeFileSync(file, patch(fs.readFileSync(file, "utf8")));
  console.log(`Patched bundled plugin copy permissions in ${file}`);
}

module.exports = { findCopyBranch, patch, patchDirectory };
if (require.main === module) {
  if (process.argv.length !== 3) throw new Error("Usage: patch-plugin-permissions.cjs BUILD_DIRECTORY");
  patchDirectory(process.argv[2]);
}
