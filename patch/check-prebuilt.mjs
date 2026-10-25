import { readFileSync } from "node:fs";
const a = await import("file:///E:/zcode-plugins/zcode-wallpaper-engine/patch/tools/node_modules/@electron/asar/lib/asar.js");
const p = "E:/zcode-plugins/zcode-wallpaper-engine/patch/prebuilt/app.asar";
const wwg = a.extractFile(p, "out" + String.fromCharCode(92) + "renderer" + String.fromCharCode(92) + "assets" + String.fromCharCode(92) + "webwallgl.global.min.js");
const js = a.extractFile(p, "out" + String.fromCharCode(92) + "renderer" + String.fromCharCode(92) + "assets" + String.fromCharCode(92) + "zwp-wallpaper.js").toString();
const css = a.extractFile(p, "out" + String.fromCharCode(92) + "renderer" + String.fromCharCode(92) + "assets" + String.fromCharCode(92) + "zwp-wallpaper.css").toString();
console.log("wwg baked:", wwg.length, "bytes | WebWallGL.mount in js:", js.includes("WebWallGL.mount"), "| badge 0.5.0:", js.includes("0.5.0"), "| /pkg:", js.includes("/pkg/"));
console.log("badge 0.5.4:", js.includes("0.5.4"), "| nested-clear:", css.includes("bg-panel .bg-panel"));
console.log("uniform glass:", css.includes("#0d1524"), "| rows94:", css.includes("grid-auto-rows: 94px"));
