import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// src/utils/package.ts -> repo root; dist/utils/package.js -> installed package root.
// Both resolve to the directory holding package.json and packs/.
const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function packageRoot(): string {
  return PACKAGE_ROOT;
}

export function packsDir(): string {
  return join(PACKAGE_ROOT, "packs");
}

interface PackageManifest {
  version: string;
  engines?: { node?: string };
}

// Single source of truth: the published package.json. Reading it at runtime keeps
// `jev --version` correct for any install path without a build-time codegen step.
export function packageManifest(): PackageManifest {
  return createRequire(import.meta.url)("../../package.json") as PackageManifest;
}

export function cliVersion(): string {
  try {
    return packageManifest().version;
  } catch {
    return "0.0.0-unknown";
  }
}
