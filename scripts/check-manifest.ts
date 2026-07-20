import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, "..", "dist", "manifest.webmanifest");

interface ManifestIcon {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
}

interface Manifest {
  display?: string;
  icons?: ManifestIcon[];
}

function main() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`✗ ${MANIFEST_PATH} does not exist — run \`npm run build\` first.`);
    process.exit(1);
  }

  const raw = readFileSync(MANIFEST_PATH, "utf8");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    console.error(`✗ manifest.webmanifest is not valid JSON: ${(err as Error).message}`);
    process.exit(1);
  }

  const errors: string[] = [];

  if (manifest.display !== "standalone") {
    errors.push(`display: expected "standalone", got ${JSON.stringify(manifest.display)}`);
  }

  const sizes = new Set((manifest.icons ?? []).map((icon) => icon.sizes));
  for (const required of ["192x192", "512x512"]) {
    if (!sizes.has(required)) {
      errors.push(`icons: missing an entry with sizes "${required}"`);
    }
  }

  if (errors.length > 0) {
    console.error("✗ manifest.webmanifest failed validation:");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log(`✓ ${MANIFEST_PATH} is valid: display=standalone, icons include 192x192 and 512x512.`);
}

main();
