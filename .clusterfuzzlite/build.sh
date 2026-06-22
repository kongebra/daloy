#!/bin/bash -eu
#
# Builds @daloyjs/core and compiles each fuzz target into a libFuzzer binary.
# Invoked by the OSS-Fuzz `compile` entrypoint inside the base-builder image.

cd "$SRC/daloy"

# 1. Build dist/. @daloyjs/core has ZERO runtime dependencies, but emitting
#    dist/ needs the devDependency tree (the TypeScript compiler and its types),
#    so install it with scripts disabled (matching the repo's supply-chain
#    posture) and emit with the TypeScript version pinned in package.json.
TS_VERSION="$(node -p "require('./package.json').devDependencies.typescript")"
npm install --no-save --no-audit --no-fund --ignore-scripts "typescript@${TS_VERSION}"
npx tsc -p tsconfig.build.json

# 2. Install Jazzer.js in ISOLATION, then overlay it into the project's
#    node_modules. Installing it alongside the framework's devDependency tree
#    leaves @jazzer.js/fuzzer without its native addon; a clean install resolves
#    the addon correctly. Pinned to 2.1.0 — the newest release whose addon works
#    on the OSS-Fuzz base image's glibc 2.31 (Ubuntu 20.04); 4.x ships a prebuilt
#    that requires GLIBC_2.32 and fails to load here. compile_javascript_fuzzer
#    copies node_modules into $OUT, so the launcher resolves @jazzer.js/core from
#    there. Bump 2.1.0 when the OSS-Fuzz base moves to a newer glibc (see
#    .clusterfuzzlite/README.md).
JAZZER_DIR="$(mktemp -d)"
( cd "$JAZZER_DIR" && npm install --no-save --no-audit --no-fund "@jazzer.js/core@2.1.0" )
cp -rn "$JAZZER_DIR"/node_modules/* "$SRC/daloy/node_modules/"
rm -rf "$JAZZER_DIR"

# 3. Compile every fuzz target. compile_javascript_fuzzer bundles the target
#    (and the dist/ modules it dynamically imports) into a standalone fuzzer.
for target_path in "$SRC"/daloy/.clusterfuzzlite/fuzz_*.js; do
  target_name="$(basename "$target_path" .js)"
  compile_javascript_fuzzer daloy ".clusterfuzzlite/${target_name}.js"
done
