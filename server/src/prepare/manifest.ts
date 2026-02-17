import { readFileSync } from "fs";
import { resolve } from "path";
import type { BundleManifest } from "./types";

let cached: BundleManifest | null = null;

export function loadManifest(): BundleManifest {
  if (cached && process.env.NODE_ENV === "production") return cached;

  const manifestPath = resolve(__dirname, "../../assets/prepare-bundle/manifest.json");
  const raw = readFileSync(manifestPath, "utf-8");
  cached = JSON.parse(raw) as BundleManifest;
  return cached;
}

export function getBundleFilePath(localPath: string): string {
  return resolve(__dirname, "../../assets/prepare-bundle", localPath);
}
