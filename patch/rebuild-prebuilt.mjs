// build the prebuilt patched asar into patch/prebuilt/
import { rmSync, cpSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const base = "E:/zcode-plugins/zcode-wallpaper-engine/patch";
const src = join(base, "work-build");
const out = join(base, "prebuilt");
const asarLib = await import("file:///E:/zcode-plugins/zcode-wallpaper-engine/patch/tools/node_modules/@electron/asar/lib/asar.js");

// 1. patch index.html
const indexPath = join(src, "out", "renderer", "index.html");
let html = readFileSync(indexPath, "utf8");
if (!html.includes("zwp-inject-v1")) {
  html = html.replace("</head>",
    `    <!-- zwp-inject-v1 -->\n` +
    `    <link rel="stylesheet" crossorigin href="./assets/zwp-wallpaper.css">\n` +
    `    <script src="./assets/zwp-wallpaper.js"></script>\n` +
    `  </head>`);
  writeFileSync(indexPath, html);
  console.log("index.html patched");
}

// 2. inject assets with the real (fixed) wallpaper URL
const url = "file:///C:/Users/yuji1/.zcode/cli/wallpaper/current.jpg";
const css = readFileSync(join(base, "tools", "inject", "zwp-wallpaper.css"), "utf8").replace(/\{\{WALLPAPER_URL\}\}/g, url);
writeFileSync(join(src, "out", "renderer", "assets", "zwp-wallpaper.css"), css);
cpSync(join(base, "tools", "inject", "zwp-wallpaper.js"), join(src, "out", "renderer", "assets", "zwp-wallpaper.js"));
cpSync(join(base, "tools", "inject", "webwallgl.global.min.js"), join(src, "out", "renderer", "assets", "webwallgl.global.min.js"));
console.log("inject assets written, url:", url);

// 3. repack
rmSync(join(out, "app.asar"), { force: true });
rmSync(join(out, "app.asar.unpacked"), { recursive: true, force: true });
await asarLib.createPackageWithOptions(src, join(out, "app.asar"), { unpack: "*.{node,dll,exe}" });
asarLib.uncacheAll();
const ok = asarLib.listPackage(join(out, "app.asar")).some(e => e.split("\\").join("/").endsWith("zwp-wallpaper.css"));
console.log("prebuilt asar ready, css present:", ok);

// 4. compare unpacked file list with the original
function listFiles(dir, prefix = "") {
  const res = [];
  if (!existsSync(dir)) return res;
  for (const e of readdirSync(dir)) {
    const rel = prefix ? prefix + "/" + e : e;
    if (statSync(join(dir, e)).isDirectory()) res.push(...listFiles(join(dir, e), rel));
    else res.push(rel);
  }
  return res;
}
const mine = listFiles(join(out, "app.asar.unpacked")).sort();
const orig = listFiles("D:/新建文件夹 (2)/ZCode/resources/app.asar.unpacked").sort();
console.log("unpacked files: mine =", mine.length, " orig =", orig.length);
const onlyOrig = orig.filter(f => !mine.includes(f));
const onlyMine = mine.filter(f => !orig.includes(f));
if (onlyOrig.length || onlyMine.length) {
  console.log("only in original:", onlyOrig.slice(0, 10));
  console.log("only in mine:", onlyMine.slice(0, 10));
} else {
  console.log("unpacked layout matches original exactly");
}
