import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXPECTED_OWNER = process.env.HANAKO_UPDATE_OWNER || "elysia2326";
const EXPECTED_REPO = process.env.HANAKO_UPDATE_REPO || "openhanako";
const tag = process.env.GITHUB_REF_NAME || process.argv[2] || "";

function fail(message) {
  console.error(`[verify-fork-release] ${message}`);
  process.exit(1);
}

function readText(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) fail(`Missing ${relativePath}`);
  return fs.readFileSync(filePath, "utf-8");
}

const packageJson = JSON.parse(readText("package.json"));
const packageLock = JSON.parse(readText("package-lock.json"));
const expectedTag = `v${packageJson.version}`;

if (tag && tag !== expectedTag) {
  fail(`Tag ${tag} does not match package version ${expectedTag}. Run: node scripts/bump-hana-version.mjs ${tag.replace(/^v/, "")}`);
}

if (packageLock.version !== packageJson.version) {
  fail(`package-lock.json version ${packageLock.version} does not match package.json ${packageJson.version}`);
}
if (packageLock.packages?.[""]?.version !== packageJson.version) {
  fail(`package-lock root package version ${packageLock.packages[""].version} does not match package.json ${packageJson.version}`);
}

for (const relativePath of [
  "desktop/auto-updater.cjs",
  "scripts/fix-modules.cjs",
  "package.json",
]) {
  const text = readText(relativePath);
  if (!text.includes(EXPECTED_OWNER) || !text.includes(EXPECTED_REPO)) {
    fail(`${relativePath} does not point to github:${EXPECTED_OWNER}/${EXPECTED_REPO}`);
  }
}

console.log(`[verify-fork-release] OK for ${expectedTag} -> github:${EXPECTED_OWNER}/${EXPECTED_REPO}`);
