// Offline asar patcher for zcode-wallpaper-engine.
// Usage: node apply.mjs <resourcesDir> <wallpaperFileUrl>
// - extracts app.asar to a temp dir, injects zwp-wallpaper.css/js + index.html link (idempotent),
//   repacks with native binaries unpacked (mirrors the original layout), replaces app.asar.
// - keeps one-time backups: app.asar.zwp-orig and app.asar.unpacked.zwp-orig.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [, , resourcesDir, wallpaperUrlArg] = process.argv;
const { homedir } = await import("node:os");
const wallpaperUrl = wallpaperUrlArg ||
  ("file:///" + homedir().split("\\").join("/") + "/.zcode/cli/wallpaper/current.jpg");
if (!resourcesDir || !wallpaperUrl) {
  console.error("usage: node apply.mjs <resourcesDir> <wallpaperFileUrl>");
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const asarLib = (await import(pathToFileURL(join(here, "node_modules", "@electron", "asar", "lib", "asar.js")).href));

const asarPath = join(resourcesDir, "app.asar");
const backupPath = join(resourcesDir, "app.asar.zwp-orig");
const tmp = join(resourcesDir, ".zwp-patch-tmp");
const MARKER = "zwp-inject-v1";

function die(msg) { console.error("apply failed: " + msg); process.exit(1); }

try {
  if (!existsSync(asarPath)) die("app.asar not found at " + asarPath);

  // Re-apply always starts from the pristine original.
  if (existsSync(backupPath)) {
    cpSync(backupPath, asarPath);
    const pristineUnpacked = join(resourcesDir, "app.asar.unpacked.zwp-orig");
    rmSync(join(resourcesDir, "app.asar.unpacked"), { recursive: true, force: true });
    if (existsSync(pristineUnpacked)) {
      cpSync(pristineUnpacked, join(resourcesDir, "app.asar.unpacked"), { recursive: true });
    }
  } else {
    cpSync(asarPath, backupPath);
    const unpackedDir = join(resourcesDir, "app.asar.unpacked");
    if (existsSync(unpackedDir)) {
      cpSync(unpackedDir, join(resourcesDir, "app.asar.unpacked.zwp-orig"), { recursive: true });
    }
    console.log("backup ready: " + backupPath + " (+ unpacked dir)");
  }

  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  console.log("extracting asar ...");
  asarLib.extractAll(asarPath, tmp);

  const indexPath = join(tmp, "out", "renderer", "index.html");
  let html = readFileSync(indexPath, "utf8");
  if (!html.includes(MARKER)) {
    html = html.replace("</head>",
      `    <!-- ${MARKER} -->\n` +
      `    <link rel="stylesheet" crossorigin href="./assets/zwp-wallpaper.css">\n` +
      `    <script src="./assets/zwp-wallpaper.js"></script>\n` +
      `  </head>`);
    writeFileSync(indexPath, html);
    console.log("index.html patched");
  } else {
    // re-running against an already-patched source: strip the old inject block first
    html = html.replace(new RegExp(`[ 	]*<!-- ${MARKER} -->
[ 	]*<link rel="stylesheet" crossorigin href="\.\/assets\/zwp-wallpaper\.css">
[ 	]*<script src="\.\/assets\/zwp-wallpaper\.js"><\/script>
`), "");
    writeFileSync(indexPath, html);
    console.log("index.html: previous inject stripped, re-patching");
    html = html.replace("</head>",
      `    <!-- ${MARKER} -->
` +
      `    <link rel="stylesheet" crossorigin href="./assets/zwp-wallpaper.css">
` +
      `    <script src="./assets/zwp-wallpaper.js"></script>
` +
      `  </head>`);
    writeFileSync(indexPath, html);
    console.log("index.html patched");
  }

  const cssName = "zwp-wallpaper.css", jsName = "zwp-wallpaper.js";
  cpSync(join(here, "inject", cssName), join(tmp, "out", "renderer", "assets", cssName));
  cpSync(join(here, "inject", jsName), join(tmp, "out", "renderer", "assets", jsName));
  let css = readFileSync(join(tmp, "out", "renderer", "assets", cssName), "utf8");
  css = css.replace(/\{\{WALLPAPER_URL\}\}/g, wallpaperUrl);
  writeFileSync(join(tmp, "out", "renderer", "assets", cssName), css);
  console.log("inject assets copied (url: " + wallpaperUrl + ")");

  console.log("repacking asar ...");
  const newAsar = join(resourcesDir, "app.asar.zwp-new");
  rmSync(newAsar, { force: true });
  await asarLib.createPackageWithOptions(tmp, newAsar, { unpack: "*.{node,dll,exe}" });

  const newUnpacked = newAsar + ".unpacked";
  rmSync(join(resourcesDir, "app.asar.unpacked"), { recursive: true, force: true });
  rmSync(asarPath);
  cpSync(newAsar, asarPath);
  if (existsSync(newUnpacked)) cpSync(newUnpacked, join(resourcesDir, "app.asar.unpacked"), { recursive: true });
  rmSync(newAsar, { force: true });
  rmSync(newUnpacked, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });

  // The lib caches parsed asar headers per path; drop them so verification reads the new archive.
  asarLib.uncacheAll();
  const entries = asarLib.listPackage(asarPath);
  if (!entries.some(e => e.replace(/\\/g, "/").endsWith("zwp-wallpaper.css"))) {
    die("verification failed: zwp-wallpaper.css missing from repacked asar");
  }
  console.log("apply OK: app.asar replaced, verification passed");
} catch (e) {
  die(e && e.stack || String(e));
}
