import { existsSync } from "node:fs";
import { join } from "node:path";

// Standard Compose filenames, in grove's chosen precedence order (legacy
// docker-compose.* before compose.*). Most repos have exactly one, so the
// order only matters in the rare case a repo ships more than one.
const COMPOSE_FILENAMES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
];

/** Return the absolute path of the first compose file found in `dir`, or null if none. */
export function findComposeFile(dir: string): string | null {
  for (const name of COMPOSE_FILENAMES) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
