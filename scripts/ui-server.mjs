// zcode-wallpaper-engine local UI service (127.0.0.1 only).
// Bridges the injected ZCode panel to wallpaper.ps1: library listing, apply, tune.
// Run: node ui-server.mjs  (auto-started at login by patch-ui.ps1 if Node was found)
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const PORT = 47613;
const SCRIPT = join(import.meta.dirname, "wallpaper.ps1");
const WALL_DIR = join(process.env.USERPROFILE || "", ".zcode", "cli", "wallpaper");
const THUMB_DIR = join(WALL_DIR, "thumbs");
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function ps(args) {
  return new Promise((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, ...args],
      { timeout: 180000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, encoding: "utf8" },
      (err, stdout, stderr) => {
        const out = (stdout || "").trim();
        let json = null;
        const start = out.indexOf("{");
        if (start >= 0) { try { json = JSON.parse(out.slice(start)); } catch {} }
        resolve(json || { ok: false, error: (err && err.message) || (stderr || "no output").slice(0, 300) });
      }
    );
  });
}

// Derive the animation source for an item: video type plays its own mp4/webm,
// scene/web types animate their preview.gif when one exists.
function deriveAnim(item) {
  if (!item) return null;
  const type = String(item.type || "").toLowerCase();
  const dir = item.dir || "";
  const file = item.file || "";
  const ext = (file.match(/\.([a-z0-9]+)$/i) || [])[1] || "";
  if (type === "video" && ["mp4", "webm", "mov", "m4v"].includes(ext.toLowerCase())) {
    return { kind: "video", path: join(dir, file) };
  }
  if ((item.previewKind || "") === "gif" && item.previewPath) {
    return { kind: "gif", path: item.previewPath };
  }
  return null;
}


// --- Wallpaper Engine .pkg (PKGV0020) high-res frame extraction ---
// Scene packages embed the original artwork as .tex files whose payload is a
// plain PNG or JPEG (often 1080p+), far sharper than the preview.jpg.
function carvePng(buf, start) {
  let pos = start + 8;
  try {
    while (pos + 8 <= buf.length) {
      const len = buf.readUInt32BE(pos);
      const type = buf.slice(pos + 4, pos + 8).toString("ascii");
      pos += 12 + len;
      if (type === "IEND") return buf.slice(start, pos);
    }
  } catch {}
  return null;
}
function carveJpeg(buf, start) {
  let pos = start + 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) { pos++; continue; }
    const marker = buf[pos + 1];
    if (marker === 0xd9) return buf.slice(start, pos + 2);
    if (marker === 0xda) {
      let q = pos + 2;
      while (q + 1 < buf.length) { if (buf[q] === 0xff && buf[q + 1] === 0xd9) return buf.slice(start, q + 2); q++; }
      return null;
    }
    const len = buf.readUInt16BE(pos + 2);
    pos += 2 + len;
  }
  return null;
}
function carveImageFromTex(texBuf) {
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const jpgSig = Buffer.from([0xff, 0xd8, 0xff]);
  let best = null;
  let idx = texBuf.indexOf(pngSig);
  while (idx >= 0) {
    const png = carvePng(texBuf, idx);
    if (png && (!best || png.length > best.length)) best = png;
    idx = texBuf.indexOf(pngSig, idx + 1);
    if (best && idx >= 0 && idx < best.length) break;
  }
  if (best) return best;
  idx = texBuf.indexOf(jpgSig);
  while (idx >= 0) {
    const jpg = carveJpeg(texBuf, idx);
    if (jpg && (!best || jpg.length > best.length)) best = jpg;
    idx = texBuf.indexOf(jpgSig, idx + 1);
  }
  return best;
}
async function extractSceneFrame(item) {
  if (!item || !item.dir || String(item.type).toLowerCase() !== "scene") return null;
  const { readFile: rf, writeFile: wf, mkdir: mk } = await import("node:fs/promises");
  const frameDir = join(WALL_DIR, "frames");
  const outPath = join(frameDir, item.id + ".png");
  try { await stat(outPath); return outPath; } catch {}
  const pkgPath = join(item.dir, "scene.pkg");
  let pkg;
  try { pkg = await rf(pkgPath); } catch { return null; }
  // brute force: carve every complete PNG/JPEG from the pkg, keep the largest by area
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const jpgSig = Buffer.from([0xff, 0xd8, 0xff]);
  let best = null, bestArea = 0;
  function consider(img) {
    if (!img || img.length < 50000) return;
    const i = img.indexOf(Buffer.from("IHDR"));
    let area = 0;
    if (i > 0) area = img.readUInt32BE(i + 4) * img.readUInt32BE(i + 8);
    if (area > bestArea) { bestArea = area; best = img; }
  }
  let idx = pkg.indexOf(pngSig);
  while (idx >= 0) {
    consider(carvePng(pkg, idx));
    idx = pkg.indexOf(pngSig, idx + 8);
  }
  if (!best) {
    idx = pkg.indexOf(jpgSig);
    while (idx >= 0) {
      consider(carveJpeg(pkg, idx));
      idx = pkg.indexOf(jpgSig, idx + 3);
    }
  }
  if (!best || bestArea < 300000) return null;
  await mk(frameDir, { recursive: true });
  await wf(outPath, best);
  return outPath;
}
async function writeActive(data) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(WALL_DIR, "active.json"), JSON.stringify({ ...data, at: new Date().toISOString() }, null, 1), "utf8");
}

// applying a new wallpaper must re-enable the background if the panel turned it off
async function clearBgOff() {
  const { writeFile, readFile } = await import("node:fs/promises");
  const file = join(WALL_DIR, "tuning.css");
  let css = "";
  try { css = await readFile(file, "utf8"); } catch {}
  css = css.replace(/html\s*\{[^}]*background-image:\s*none[^}]*\}\s*/g, "");
  await writeFile(file, css, "utf8");
}

function send(res, code, body, type = "application/json; charset=utf-8", cb = null) {
  if (type == null) type = "application/json; charset=utf-8";
  const isJson = type === "application/json; charset=utf-8";
  const payload = isJson && typeof body !== "string" ? JSON.stringify(body) : String(body);
  if (cb) {
    // JSONP: works from file:// pages where fetch/CORS is unreliable
    const buf = Buffer.from(`${cb}(${payload});`);
    res.writeHead(code, { "Content-Type": "application/javascript; charset=utf-8", "Content-Length": buf.length });
    res.end(buf);
    return;
  }
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(payload);
  res.writeHead(code, { "Content-Type": type, "Content-Length": buf.length, ...CORS });
  res.end(buf);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:" + PORT);
  const p = url.pathname;
  const cb = url.searchParams.get("cb");
  try {
    if (req.method === "OPTIONS") { send(res, 204, ""); return; }
    if (p === "/ping") { send(res, 200, { ok: true, service: "zcode-wallpaper-engine", script: SCRIPT }, null, cb); return; }

    if (p === "/library") {
      const list = await ps(["list"]);
      const thumbs = await ps(["thumbs", "-Thumbs", "0"]);
      const byId = new Map((thumbs.thumbs || []).map(t => [t.id, t.thumb]));
      const items = (list.items || []).map(it => ({
        id: it.id, title: it.title, type: it.type, contentrating: it.contentrating,
        previewKind: it.previewKind,
        thumb: byId.has(it.id) ? "/thumb/" + it.id : null,
      }));
      send(res, 200, { ok: true, count: items.length, items }, null, cb);
      return;
    }

    if (p.startsWith("/thumb/")) {
      const id = basename(p);
      const files = await import("node:fs/promises").then(fs => fs.readdir(THUMB_DIR)).catch(() => []);
      const hit = files.filter(f => f.endsWith(id + ".jpg")).sort().pop();
      if (!hit) throw "no thumbnail for " + id;
      send(res, 200, await readFile(join(THUMB_DIR, hit)), "image/jpeg");
      return;
    }

    if (p.startsWith("/pkg/")) {
      const rest = p.slice("/pkg/".length);
      const id = rest.split("/")[0];
      const sub = rest.slice(id.length + 1);
      const probe = await ps(["list"]);
      const item = (probe.items || []).find(it => it.id === id) || null;
      if (!item) throw "unknown item " + id;
      if (sub) {
        // loose-file requests (project.json / scene.json / ...): serve the real
        // file when present, else 404 so webwallgl falls back to the pkg
        const cand = join(item.dir, basename(sub));
        let found = false;
        try { await stat(cand); found = true; } catch {}
        if (!found) { send(res, 404, { ok: false, error: "not in pkg dir: " + sub }, null, cb); return; }
        send(res, 200, await readFile(cand), "application/octet-stream");
        return;
      }
      const pkgPath = join(item.dir, "scene.pkg");
      await stat(pkgPath);
      send(res, 200, await readFile(pkgPath), "application/octet-stream");
      return;
    }

    if (p === "/tuning.css" || p === "/current.jpg") {
      const f = join(WALL_DIR, p === "/tuning.css" ? "tuning.css" : "current.jpg");
      await stat(f);
      send(res, 200, await readFile(f), p === "/tuning.css" ? "text/css; charset=utf-8" : "image/jpeg");
      return;
    }

    if (p === "/hook.js") {
      const hookPath = join(WALL_DIR, "hook.js");
      let code = "";
      try { code = await readFile(hookPath, "utf8"); } catch {}
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(code);
      return;
    }

    if (p === "/wwg.js") {
      send(res, 200, await readFile(join(import.meta.dirname, "..", "patch", "tools", "inject", "webwallgl.global.min.js"), "utf8"), "text/javascript; charset=utf-8");
      return;
    }

    if (p === "/testscene") {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>scene test</title>
<style>html,body{margin:0;width:100%;height:100%;background:#000}#wp{position:fixed;inset:0}</style>
<script src="/wwg.js"></script></head><body><div id="wp"></div><script>
window.__st = { state: "loading", frames: 0 };
(async function(){
  try {
    window.__st.state = "mounting";
    const inst = await WebWallGL.mount(document.getElementById("wp"), {
      source: WebWallGL.httpSource("http://127.0.0.1:47613/pkg/3245426792"),
      volume: 0
    });
    window.__st.state = "mounted";
    window.__inst = inst;
    const cv = inst.canvas || document.querySelector("#wp canvas");
    let last = null, n = 0;
    const tick = () => {
      try {
        const gl = cv.getContext("webgl") || cv.getContext("webgl2");
        if (gl) {
          const px = new Uint8Array(4);
          gl.readPixels(5, 5, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const key = px.join(",");
          if (last !== null && key !== last) n++;
          last = key;
        }
        window.__st.frames = n;
      } catch (e) {}
      setTimeout(tick, 400);
    };
    tick();
  } catch (e) { window.__st.state = "error: " + (e && e.message || e); }
})();
<\/script></body></html>`;
      send(res, 200, html, "text/html; charset=utf-8");
      return;
    }

    if (p === "/diag" && req.method === "POST") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", async () => {
        try {
          const { appendFile } = await import("node:fs/promises");
          await appendFile(join(WALL_DIR, "diag-log.ndjson"), new Date().toISOString() + " " + body + "\\n", "utf8");
        } catch {}
        send(res, 200, { ok: true }, null, url.searchParams.get("cb"));
      });
      return;
    }

    if (p === "/active") {
      const file = join(WALL_DIR, "active.json");
      let active = { anim: null };
      try { active = JSON.parse(await readFile(file, "utf8")); } catch {}
      send(res, 200, { ok: true, ...active }, null, cb);
      return;
    }

    if (p === "/apply") {
      const target = url.searchParams.get("target") || "ui";
      const id = url.searchParams.get("id") || "";
      let r, anim = null;
      if (target === "desktop") {
        r = await ps(["set", "-WorkshopId", id]);
      } else {
        const probe = await ps(["list"]);
        const item = (probe.items || []).find(it => it.id === id) || null;
        let src = null;
        try { src = await extractSceneFrame(item); } catch {}
        if (src) {
          r = await ps(["ui", "-Path", src, "-Scrim", "8"]);
        } else {
          r = await ps(["ui", "-WorkshopId", id, "-Scrim", "8"]);
        }
        anim = deriveAnim(item);
        if (item && String(item.type).toLowerCase() === "scene") {
          let hasPkg = false;
          try { await stat(join(item.dir, "scene.pkg")); hasPkg = true; } catch {}
          if (hasPkg) anim = { kind: "scene", id: item.id, path: join(item.dir, "scene.pkg") };
        }
        await writeActive({ anim, applied: (r && r.uiWallpaper) || null, id, title: (item && item.title) || null });
        await clearBgOff();
      }
      send(res, 200, { ...r, target, anim }, null, cb);
      return;
    }

    if (p === "/action") {
      const action = url.searchParams.get("action") || "";
      if (action === "random_ui") {
        const dry = await ps(["random", "-Dry"]);
        const picked = dry && dry.picked;
        const id = picked && picked.id;
        let src = null;
        try { src = await extractSceneFrame(picked); } catch {}
        let anim = deriveAnim(picked);
        if (picked && String(picked.type).toLowerCase() === "scene") {
          let hasPkg = false;
          try { await stat(join(picked.dir, "scene.pkg")); hasPkg = true; } catch {}
          if (hasPkg) anim = { kind: "scene", id: picked.id, path: join(picked.dir, "scene.pkg") };
        }
        const r = src
          ? await ps(["ui", "-Path", src, "-Scrim", "8"])
          : await ps(["ui", "-WorkshopId", id || "", "-Scrim", "8"]);
        await writeActive({ anim, applied: r.uiWallpaper || null, id, title: (picked && picked.title) || null });
        await clearBgOff();
        send(res, 200, { ...r, target: "ui", picked: id, anim }, null, cb);
        return;
      }
      if (action === "random_desktop") { send(res, 200, { ...(await ps(["random"])), target: "desktop" }, null, cb); return; }
      if (action === "bing_ui") {
        const dl = await ps(["bing", "-Dry"]);
        if (!dl.downloaded) { send(res, 200, dl, null, cb); return; }
        const r = await ps(["ui", "-Path", dl.downloaded, "-Scrim", "8"]);
        await writeActive({ anim: null, applied: r.uiWallpaper || null, id: "bing", title: dl.copyright || null });
        await clearBgOff();
        send(res, 200, { ...r, target: "ui", copyright: dl.copyright, anim: null }, null, cb);
        return;
      }
      if (action === "bing_desktop") { send(res, 200, { ...(await ps(["bing"])), target: "desktop" }, null, cb); return; }
      send(res, 400, { ok: false, error: "unknown action: " + action }, null, cb);
      return;
    }

    if (p === "/tune") {
      // persists tuning changes to tuning.css so they survive restarts
      const canvas = parseFloat(url.searchParams.get("canvas") || "");
      const bgOff = url.searchParams.get("bg");
      const lines = ["/* zcode-wallpaper-engine tuning (written by the panel) */"];
      if (!Number.isNaN(canvas)) lines.push(`:root { --zwp-canvas: ${Math.min(0.95, Math.max(0.05, canvas))}; }`);
      if (bgOff === "off") {
        lines.push("html { background-image: none !important; }");
        await writeActive({ anim: null, applied: null, id: null, title: null });
      }
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(WALL_DIR, "tuning.css"), lines.join("\n") + "\n", "utf8");
      send(res, 200, { ok: true, lines: lines.length }, null, cb);
      return;
    }

    if (p === "/current") {
      const r = await ps(["current"]);
      const file = join(WALL_DIR, "current.jpg");
      let uiWall = null;
      try { await stat(file); uiWall = file; } catch {}
      send(res, 200, { ok: true, current: r.current, uiWall }, null, cb);
      return;
    }

    if (p === "/inject.js" || p === "/inject.css" || p === "/app.css") {
      const file = p === "/inject.js"
        ? join(import.meta.dirname, "..", "patch", "tools", "inject", "zwp-wallpaper.js")
        : p === "/inject.css"
          ? join(import.meta.dirname, "..", "patch", "tools", "inject", "zwp-wallpaper.css")
          : join(process.env.TEMP, "zwp-appstyles.css");
      const type = p === "/inject.js" ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8";
      send(res, 200, await readFile(file, "utf8"), type);
      return;
    }
    if (p === "/test2") {
      const html = `<!doctype html><html class="dark theme-zai-dark"><head><meta charset="utf-8"><title>zwp cascade test</title>
<link rel="stylesheet" href="/app.css">
<style>:root{--color-panel:#202020;--color-background:#161616;--color-surface:rgba(255,255,255,0.05);--color-foreground:#ececec;--color-foreground-subtle:#9a9a9a;--color-border:rgba(255,255,255,0.12);--color-brand:#4f8cff;--color-destructive:#e5484d;--color-hover:rgba(255,255,255,0.08);--zwp-image:url("file:///" + homedir.replace(/\/g, "/") + "/.zcode/cli/wallpaper/current.jpg")}
html,body{margin:0;width:100%;height:100%}</style>
<link rel="stylesheet" href="/inject.css"></head><body><div id="root"></div><script src="/inject.js"><\/script></body></html>`;
      send(res, 200, html, "text/html; charset=utf-8");
      return;
    }
    if (p === "/test") {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>zwp panel test</title>
<style>:root{--color-panel:#202020;--color-background:#161616;--color-surface:rgba(255,255,255,0.05);--color-foreground:#ececec;--color-foreground-subtle:#9a9a9a;--color-border:rgba(255,255,255,0.12);--color-brand:#4f8cff;--color-destructive:#e5484d;--color-hover:rgba(255,255,255,0.08);--zwp-image:url("file:///" + homedir.replace(/\/g, "/") + "/.zcode/cli/wallpaper/current.jpg")}
html,body{margin:0;width:100%;height:100%}html{background-image:var(--zwp-image);background-size:cover;background-position:center}body{background:color-mix(in srgb,#161616 45%,transparent)}</style>
<link rel="stylesheet" href="/inject.css"></head><body><div id="root"></div><script src="/inject.js"><\/script></body></html>`;
      send(res, 200, html, "text/html; charset=utf-8");
      return;
    }
    send(res, 404, { ok: false, error: "not found" }, null, cb);
  } catch (e) {
    send(res, 500, { ok: false, error: String((e && e.message) || e) }, null, cb);
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`zcode-wallpaper-engine ui-service on http://127.0.0.1:${PORT}`));
