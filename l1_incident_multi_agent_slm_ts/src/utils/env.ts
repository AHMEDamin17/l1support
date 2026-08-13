import fs from "node:fs";
import path from "node:path";

export function loadDotEnv(file = ".env"): void {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;
    const idx = clean.indexOf("=");
    if (idx < 0) continue;
    const key = clean.slice(0, idx).trim();
    const value = clean.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

export function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export function envBool(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return ["true", "1", "yes", "y"].includes(v.toLowerCase());
}
