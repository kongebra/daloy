import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { findForbiddenLockfileSources } from "../scripts/verify-lockfile-sources.ts";

async function readWorkspaceFile(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("root npmrc blocks install-time supply-chain attack paths", async () => {
  const npmrc = await readWorkspaceFile(".npmrc");

  assert.match(npmrc, /^ignore-scripts=true$/m);
  assert.match(npmrc, /^minimum-release-age=1440$/m);
  assert.match(npmrc, /^verify-store-integrity=true$/m);
  assert.match(npmrc, /^frozen-lockfile=true$/m);
  assert.match(npmrc, /^strict-peer-dependencies=true$/m);
  assert.match(npmrc, /^provenance=true$/m);
});

test("workspace allowlists dependency build scripts explicitly", async () => {
  const packageJson = JSON.parse(await readWorkspaceFile("package.json"));

  assert.equal(packageJson.scripts["verify:lockfile"], "node --import tsx scripts/verify-lockfile-sources.ts");
  assert.deepEqual(packageJson.pnpm.onlyBuiltDependencies, ["esbuild"]);
  assert.deepEqual(packageJson.pnpm.neverBuiltDependencies, []);
});

test("pnpm-workspace.yaml enables pnpm 11 supply-chain controls", async () => {
  const workspace = await readWorkspaceFile("pnpm-workspace.yaml");

  // 24h release-age cooldown — blocks freshly published malicious versions.
  assert.match(workspace, /^minimumReleaseAge:\s*1440$/m);

  // Transitive deps must not pull from git or arbitrary tarball URLs.
  assert.match(workspace, /^blockExoticSubdeps:\s*true$/m);

  // Refuse to install dependencies with unreviewed install scripts.
  assert.match(workspace, /^strictDepBuilds:\s*true$/m);

  // Scripts must not run against a stale node_modules.
  assert.match(workspace, /^verifyDepsBeforeRun:\s*install$/m);

  // Explicit build allowlist — esbuild is the only package permitted to run
  // install scripts. Adding more requires a deliberate PR.
  assert.match(workspace, /^allowBuilds:\s*$/m);
  assert.match(workspace, /^\s{2}esbuild:\s*true$/m);
});

test("lockfile does not contain git or non-registry tarball dependency sources", async () => {
  const lockfile = await readWorkspaceFile("pnpm-lock.yaml");

  assert.deepEqual(findForbiddenLockfileSources(lockfile), []);
  assert.deepEqual(findForbiddenLockfileSources("specifier: github:owner/project"), [
    {
      line: 1,
      reason: "git dependency source",
      text: "specifier: github:owner/project",
    },
  ]);
  assert.deepEqual(findForbiddenLockfileSources("resolution: {tarball: https://example.com/pkg.tgz}"), [
    {
      line: 1,
      reason: "non-registry tarball source",
      text: "resolution: {tarball: https://example.com/pkg.tgz}",
    },
  ]);
});

test("lockfile scanner rejects every forbidden git and tarball source with line numbers", () => {
  const lockfile = [
    "packages:",
    "  dep-a:",
    "    specifier: github:owner/project",
    "  dep-b:",
    "    resolution: git+ssh://git@github.com/owner/project.git",
    "  dep-c:",
    "    specifier: git@github.com:owner/project.git",
    "  dep-d:",
    "    resolution: {tarball: https://cdn.example.com/pkg.tgz}",
  ].join("\n");

  assert.deepEqual(findForbiddenLockfileSources(lockfile), [
    {
      line: 3,
      reason: "git dependency source",
      text: "specifier: github:owner/project",
    },
    {
      line: 5,
      reason: "git dependency source",
      text: "resolution: git+ssh://git@github.com/owner/project.git",
    },
    {
      line: 7,
      reason: "git dependency source",
      text: "specifier: git@github.com:owner/project.git",
    },
    {
      line: 9,
      reason: "non-registry tarball source",
      text: "resolution: {tarball: https://cdn.example.com/pkg.tgz}",
    },
  ]);
});

test("lockfile scanner rejects registry lookalike tarball hosts", () => {
  const lockfile = [
    "resolution: {tarball: https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz}",
    "resolution: {tarball: https://registry.npmjs.org.evil.example/pkg.tgz}",
  ].join("\n");

  assert.deepEqual(findForbiddenLockfileSources(lockfile), [
    {
      line: 2,
      reason: "non-registry tarball source",
      text: "resolution: {tarball: https://registry.npmjs.org.evil.example/pkg.tgz}",
    },
  ]);
});

test("ci workflow avoids privileged fork-pr and cache-poisoning patterns", async () => {
  const workflow = await readWorkspaceFile(".github/workflows/ci.yml");

  assert.doesNotMatch(workflow, /^\s*pull_request_target:/m);
  assert.doesNotMatch(workflow, /cache:\s*pnpm/);
  assert.match(workflow, /permissions:\s*\{\}/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts/);
  assert.match(workflow, /pnpm verify:lockfile/);
  assert.match(workflow, /step-security\/harden-runner@[0-9a-f]{40}\s+# v2/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}\s+# v6/);
  assert.match(workflow, /pnpm\/action-setup@[0-9a-f]{40}\s+# v6/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}\s+# v6/);
});

test("all workflows avoid unsafe pull_request_target and zizmor is enforced", async () => {
  const workflowDir = new URL("../.github/workflows/", import.meta.url);
  const workflowFiles = (await readdir(workflowDir)).filter((file) => /\.ya?ml$/.test(file));
  const pullRequestTargetWorkflows: string[] = [];

  for (const file of workflowFiles) {
    const workflow = await readWorkspaceFile(`.github/workflows/${file}`);
    if (/^\s*pull_request_target:/m.test(workflow)) {
      pullRequestTargetWorkflows.push(file);
    }
  }

  assert.deepEqual(pullRequestTargetWorkflows, ["close-external-prs.yml"]);

  const closeExternalPrs = await readWorkspaceFile(".github/workflows/close-external-prs.yml");
  assert.doesNotMatch(closeExternalPrs, /^\s*uses:\s*/m);
  assert.doesNotMatch(closeExternalPrs, /^\s*id-token:\s*write\s*$/m);
  assert.doesNotMatch(closeExternalPrs, /^\s*actions:\s*write\s*$/m);
  assert.doesNotMatch(closeExternalPrs, /^\s*packages:\s*write\s*$/m);
  assert.doesNotMatch(closeExternalPrs, /^\s*issues:\s*write\s*$/m);
  assert.doesNotMatch(closeExternalPrs, /^\s*contents:\s*write\s*$/m);
  assert.match(closeExternalPrs, /^\s*contents:\s*read\s*$/m);
  assert.match(closeExternalPrs, /^\s*pull-requests:\s*write\s*$/m);
  assert.match(closeExternalPrs, /github\.repository == 'daloyjs\/daloy'/);
  assert.match(closeExternalPrs, /^\s*timeout-minutes:\s*5\s*$/m);
  assert.match(closeExternalPrs, /author_association != 'OWNER'/);
  assert.match(closeExternalPrs, /author_association != 'MEMBER'/);
  assert.match(closeExternalPrs, /author_association != 'COLLABORATOR'/);
  assert.match(closeExternalPrs, /user\.login != 'dependabot\[bot\]'/);
  assert.match(closeExternalPrs, /gh pr comment/);
  assert.match(closeExternalPrs, /gh pr close/);

  const zizmor = await readWorkspaceFile(".github/workflows/zizmor.yml");
  assert.match(zizmor, /^\s*pull_request:\s*$/m);
  assert.match(zizmor, /permissions:\s*\{\}/);
  assert.match(zizmor, /zizmorcore\/zizmor-action@[0-9a-f]{40}\s+# v0\.5\.4/);
  assert.match(zizmor, /version:\s*v1\.25\.0/);
});

test("release workflow isolates npm publish permissions", async () => {
  const workflow = await readWorkspaceFile(".github/workflows/release.yml");

  assert.doesNotMatch(workflow, /^\s*pull_request:/m);
  assert.doesNotMatch(workflow, /^\s*pull_request_target:/m);
  assert.match(workflow, /permissions:\s*\{\}/);
  assert.match(workflow, /environment:\s*\n\s+name:\s+\$\{\{ vars\.NPM_PUBLISH_ENVIRONMENT \|\| 'npm-publish' \}\}/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /pnpm publish --access public --no-git-checks --provenance/);
  assert.match(workflow, /egress-policy:\s*block/);
  assert.match(workflow, /step-security\/harden-runner@[0-9a-f]{40}\s+# v2/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}\s+# v6/);
  assert.match(workflow, /pnpm\/action-setup@[0-9a-f]{40}\s+# v6/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}\s+# v6/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
  assert.doesNotMatch(workflow, /^\s*NODE_AUTH_TOKEN:/m);

  assert.doesNotMatch(workflow, /^\s*always-auth:/m);

  const verifyJob = workflow.match(/  verify:[\s\S]*?\n\n  publish-core:/)?.[0] ?? "";
  assert.doesNotMatch(verifyJob, /id-token:\s*write/);
});