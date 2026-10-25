// zcode-wallpaper-engine — UI inject v3 (runtime)
// 1) Ctrl+Alt+R reloads; tuning.css loads after the baked sheet.
// 2) Floating "壁纸引擎" panel (DSH-style): library grid, filters, click-to-apply
//    through the local service at http://127.0.0.1:47613 (scripts/ui-server.mjs).
//    Ctrl+Alt+W toggles the panel.
(function () {
  if (window.__zwpInjected) return;
  window.__zwpInjected = true;
  var API = "http://127.0.0.1:47613";
  var ZWP_VER = "0.5.5";

  try {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = API + "/tuning.css";
    document.head.appendChild(link);
  } catch (e) {}

  window.addEventListener("keydown", function (e) {
    if (e.ctrlKey && e.altKey && (e.key === "r" || e.key === "R")) { e.preventDefault(); location.reload(); }
    if (e.ctrlKey && e.altKey && (e.key === "w" || e.key === "W")) { e.preventDefault(); togglePanel(); }
  }, true);

  /* ---------- helpers ---------- */
  // JSONP first (works from any origin, including file:// pages), fetch as fallback.
  var jsonpSeq = 0;
  function jsonp(path) {
    return new Promise(function (resolve, reject) {
      var name = "__zwpCb" + (++jsonpSeq);
      var s = document.createElement("script");
      var timer = setTimeout(function () { cleanup(); reject(new Error("timeout")); }, 200000);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[name]; } catch (e) { window[name] = undefined; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[name] = function (data) { cleanup(); resolve(data); };
      s.src = API + path + (path.indexOf("?") >= 0 ? "&" : "?") + "cb=" + name;
      s.onerror = function () { cleanup(); reject(new Error("jsonp error")); };
      document.head.appendChild(s);
    });
  }
  function api(path) {
    return jsonp(path).catch(function () {
      return fetch(API + path).then(function (r) { return r.json(); });
    });
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var TYPE_LABEL = { scene: "场景", video: "视频", web: "网页", application: "应用", unknown: "未知" };

  function liveSwap() {
    document.documentElement.style.setProperty(
      "--zwp-image", 'url("' + API + '/current.jpg?v=' + Date.now() + '")'
    );
  }

  /* ---------- diagnostic beacon: report real-environment style state to the ui-server ---------- */
  function sendDiag() {
    try {
      var out = { ver: ZWP_VER, url: location.href.slice(0, 80), sheets: [], surfaces: [], live: !!document.getElementById("zwp-live") };
      for (var i = 0; i < document.styleSheets.length; i++) {
        var h = document.styleSheets[i].href || "inline";
        if (h.indexOf("zwp-wallpaper") >= 0 || h.indexOf("styles-") >= 0) out.sheets.push(h.split("/").pop() + ":" + (function () { try { return document.styleSheets[i].cssRules.length; } catch (e) { return "blocked"; } })());
      }
      out.opaque = [];
      var all = document.querySelectorAll("#root *");
      var seen = {};
      for (var k = 0; k < all.length && out.opaque.length < 14; k++) {
        var n2 = all[k];
        var r2 = n2.getBoundingClientRect();
        if (r2.width < 300 || r2.height < 150) continue;
        var bg2 = getComputedStyle(n2).backgroundColor;
        var m2 = bg2.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
        if (!m2) continue;
        var a2 = m2[4] === undefined ? 1 : parseFloat(m2[4]);
        if (a2 < 0.55) continue;
        var key = String(n2.className).slice(0, 90);
        if (seen[key]) continue;
        seen[key] = 1;
        out.opaque.push(Math.round(r2.width) + "x" + Math.round(r2.height) + " a=" + a2 + " bg=" + bg2 + " cls=" + key);
      }
      var sels = ["html", "body", "#root", ".bg-background-win-alt", ".bg-background", ".bg-panel", ".bg-sidebar", ".bg-surface"];
      for (var j = 0; j < sels.length; j++) {
        var n = document.querySelector(sels[j]);
        if (!n) { out.surfaces.push(sels[j] + ": ABSENT"); continue; }
        var cs = getComputedStyle(n);
        out.surfaces.push(sels[j] + " | bg=" + cs.backgroundColor + " | cls=" + String(n.className).split(/\s+/).slice(0, 4).join("."));
      }
      fetch(API + "/diag", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(out) }).catch(function () {});
    } catch (e) {}
  }

  /* ---------- live background layer (scene render / video / animated gif) ---------- */
  var sceneToken = 0, sceneInstance = null;
  function fileUrl(p) {
    return encodeURI("file:///" + String(p).replace(/\\/g, "/")).replace(/#/g, "%23");
  }
  function loadWwg() {
    if (window.WebWallGL) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var sc = document.createElement("script");
      sc.src = "./assets/webwallgl.global.min.js";
      sc.onload = function () { resolve(); };
      sc.onerror = function () { reject(new Error("webwallgl load failed")); };
      document.head.appendChild(sc);
    });
  }
  function mountScene(anim, token) {
    return loadWwg().then(function () {
      if (token !== sceneToken) return null;
      var host = document.createElement("div");
      host.id = "zwp-live";
      host.className = "zwp-live";
      document.body.appendChild(host);
      return window.WebWallGL.mount(host, {
        source: window.WebWallGL.httpSource(API + "/pkg/" + anim.id),
        volume: 0
      }).then(function (inst) {
        if (token !== sceneToken) { try { inst.dispose && inst.dispose(); } catch (e) {} return null; }
        sceneInstance = inst;
        return inst;
      });
    });
  }
  function hideLayer() {
    sceneToken++;
    if (sceneInstance) {
      var inst = sceneInstance;
      sceneInstance = null;
      try { inst.dispose && inst.dispose(); } catch (e) {}
    }
    var old = document.getElementById("zwp-live");
    if (old) old.remove();
  }
  function showLayer(anim) {
    hideLayer();
    if (!anim || !anim.path) return;
    var token = sceneToken;
    if (anim.kind === "scene") {
      mountScene(anim, token).catch(function () {});
      return;
    }
    var node;
    if (anim.kind === "video") {
      node = document.createElement("video");
      node.src = fileUrl(anim.path);
      node.autoplay = true; node.loop = true; node.muted = true; node.playsInline = true;
      node.setAttribute("playsinline", "");
    } else {
      node = document.createElement("img");
      node.src = fileUrl(anim.path);
      node.alt = "";
    }
    node.id = "zwp-live";
    node.className = "zwp-live";
    document.body.appendChild(node);
    if (anim.kind === "video") { var p = node.play(); if (p && p.catch) p.catch(function () {}); }
  }
  function restoreActive() {
    // boot: point --zwp-image at the local service (works for any user, no baked path)
    document.documentElement.style.setProperty("--zwp-image", 'url("' + API + '/current.jpg?v=' + Date.now() + '")');
    api("/active").then(function (r) { if (r && r.ok && r.anim) showLayer(r.anim); }).catch(function () {});
  }
  function toast(msg, ok) {
    var t = el("div", "zwp-toast" + (ok === false ? " zwp-toast-err" : ""), msg);
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("zwp-show"); }, 10);
    setTimeout(function () { t.classList.remove("zwp-show"); setTimeout(function () { t.remove(); }, 300); }, 2600);
  }

  /* ---------- panel ---------- */
  var panel, grid, pager, state = { target: "ui", q: "", rating: "all", type: "all", items: [], page: 1, perPage: 24 };

  function togglePanel() {
    if (!panel) { buildPanel(); return; }
    panel.classList.toggle("zwp-open");
  }

  function buildPanel() {
    panel = el("div", "zwp-panel");
    panel.appendChild(buildHeader());
    panel.appendChild(buildToolbar());
    grid = el("div", "zwp-grid");
    panel.appendChild(grid);
    pager = el("div", "zwp-pager");
    panel.appendChild(pager);
    panel.appendChild(buildFooter());
    document.body.appendChild(panel);
    requestAnimationFrame(function () { panel.classList.add("zwp-open"); });
    loadLibrary();
  }

  function buildHeader() {
    var h = el("div", "zwp-head");
    var left = el("div", "zwp-head-l");
    var t = el("div", "zwp-title"); t.appendChild(document.createTextNode("壁纸引擎 ")); t.appendChild(el("span", "zwp-ver", "v" + ZWP_VER)); left.appendChild(t);
    left.appendChild(el("div", "zwp-sub", "本地 Wallpaper Engine 壁纸"));
    var close = el("button", "zwp-icon-btn", "✕");
    close.onclick = function () { panel.classList.remove("zwp-open"); };
    h.appendChild(left); h.appendChild(close);
    return h;
  }

  function buildToolbar() {
    var bar = el("div", "zwp-toolbar");
    var seg = el("div", "zwp-seg");
    [["ui", "界面壁纸"], ["desktop", "桌面壁纸"]].forEach(function (m) {
      var b = el("button", "zwp-seg-btn" + (state.target === m[0] ? " zwp-on" : ""), m[1]);
      b.onclick = function () {
        state.target = m[0];
        seg.querySelectorAll(".zwp-seg-btn").forEach(function (x) { x.classList.remove("zwp-on"); });
        b.classList.add("zwp-on");
      };
      seg.appendChild(b);
    });
    var search = el("input", "zwp-search");
    search.placeholder = "搜索壁纸…";
    search.oninput = function () { state.q = search.value.trim().toLowerCase(); state.page = 1; renderGrid(); };
    var rating = el("select", "zwp-select");
    [["all", "分级 全部"], ["everyone", "Everyone"], ["mature", "Mature"], ["questionable", "Questionable"]].forEach(function (o) {
      var op = el("option", null, o[1]); op.value = o[0]; rating.appendChild(op);
    });
    rating.onchange = function () { state.rating = rating.value; state.page = 1; renderGrid(); };
    var type = el("select", "zwp-select");
    [["all", "类型 全部"], ["scene", "场景"], ["video", "视频"], ["web", "网页"]].forEach(function (o) {
      var op = el("option", null, o[1]); op.value = o[0]; type.appendChild(op);
    });
    type.onchange = function () { state.type = type.value; state.page = 1; renderGrid(); };
    bar.appendChild(seg); bar.appendChild(search); bar.appendChild(rating); bar.appendChild(type);
    return bar;
  }

  function buildFooter() {
    var f = el("div", "zwp-foot");
    f.appendChild(actionBtn("随机", function () {
      return api("/action?action=random_" + state.target).then(function (r) {
        if (r && r.ok && state.target === "ui") {
          if (r.anim) showLayer(r.anim); else { hideLayer(); liveSwap(); }
        }
        return r;
      });
    }));
    f.appendChild(actionBtn("必应今日", function () {
      return api("/action?action=bing_" + state.target).then(function (r) {
        if (r && r.ok && state.target === "ui") { hideLayer(); liveSwap(); }
        if (r && r.ok && r.copyright) toast("已应用：" + String(r.copyright).slice(0, 40));
        return r;
      });
    }));
    var dim = el("button", "zwp-act-btn", "暗一点");
    dim.onclick = function () { tune(-0.08); };
    var bright = el("button", "zwp-act-btn", "亮一点");
    bright.onclick = function () { tune(0.08); };
    f.appendChild(dim); f.appendChild(bright);
    return f;
  }

  function actionBtn(label, call) {
    var b = el("button", "zwp-act-btn", label);
    b.onclick = function () {
      b.disabled = true; b.textContent = "…";
      Promise.resolve().then(call).then(function (r) {
        if (r && r.ok) {
          if (state.target === "ui") liveSwap();
          else toast("桌面壁纸已应用");
        } else toast((r && r.error) || "失败", false);
      }).catch(function () { toast("本地服务未运行", false); })
        .finally(function () { b.disabled = false; b.textContent = label; });
    };
    return b;
  }

  var canvasLevel = null;
  function tune(delta) {
    canvasLevel = Math.min(0.9, Math.max(0.1, (canvasLevel || 0.45) + delta));
    document.documentElement.style.setProperty("--zwp-canvas", canvasLevel);
    api("/tune?canvas=" + canvasLevel).then(function () { toast("已保存"); })
      .catch(function () { toast("已临时调整（服务未运行，重启后还原）", false); });
  }

  function loadLibrary() {
    grid.innerHTML = "";
    grid.appendChild(el("div", "zwp-hint", "正在读取本地壁纸库…"));
    api("/library").then(function (r) {
      state.items = (r && r.items) || [];
      var sub = panel.querySelector(".zwp-sub");
      if (sub) sub.textContent = "本地 Wallpaper Engine 壁纸 · 共 " + state.items.length + " 个";
      renderGrid();
    }).catch(function () {
      grid.innerHTML = "";
      grid.appendChild(el("div", "zwp-hint", "本地服务未运行。请运行插件目录 scripts\\start-ui-server.bat 后重试。"));
    });
  }

  function filtered() {
    return state.items.filter(function (it) {
      if (state.type !== "all" && it.type !== state.type) return false;
      if (state.rating !== "all" && (it.contentrating || "").toLowerCase() !== state.rating) return false;
      if (state.q && String(it.title).toLowerCase().indexOf(state.q) < 0) return false;
      return true;
    });
  }

  function renderGrid() {
    grid.innerHTML = "";
    var filteredCount = filtered().length;
    var off = el("div", "zwp-card zwp-card-off");
    off.appendChild(el("div", "zwp-card-off-x", "✕"));
    off.appendChild(el("div", "zwp-card-name", "关闭界面壁纸"));
    off.onclick = function () {
      api("/tune?bg=off").then(function () {
        hideLayer();
        document.documentElement.style.setProperty("--zwp-image", "none");
        toast("界面壁纸已关闭");
      }).catch(function () { toast("本地服务未运行", false); });
    };
    grid.appendChild(off);

    var list = filtered();
    var pages = Math.max(1, Math.ceil(list.length / state.perPage));
    if (state.page > pages) state.page = pages;
    var slice = list.slice((state.page - 1) * state.perPage, state.page * state.perPage);
    list = slice;
    pager.innerHTML = "";
    if (pages > 1) {
      var prev = el("button", null, "上一页");
      prev.disabled = state.page <= 1;
      prev.onclick = function () { state.page--; renderGrid(); grid.scrollTop = 0; };
      var info = el("span", "zwp-pager-info", "第 " + state.page + " / " + pages + " 页 · 共 " + filteredCount + " 个");
      var next = el("button", null, "下一页");
      next.disabled = state.page >= pages;
      next.onclick = function () { state.page++; renderGrid(); grid.scrollTop = 0; };
      pager.appendChild(prev); pager.appendChild(info); pager.appendChild(next);
    }
    list.forEach(function (it) {
      var card = el("div", "zwp-card");
      if (it.thumb) {
        var img = el("img", "zwp-thumb");
        img.src = API + it.thumb;
        img.loading = "lazy";
        card.appendChild(img);
      } else {
        card.appendChild(el("div", "zwp-thumb zwp-thumb-none", "无预览"));
      }
      var badges = el("div", "zwp-badges");
      badges.appendChild(el("span", "zwp-badge", TYPE_LABEL[it.type] || it.type));
      var cr = (it.contentrating || "").toLowerCase();
      if (cr === "mature") badges.appendChild(el("span", "zwp-badge zwp-badge-r", "R18"));
      if (cr === "questionable") badges.appendChild(el("span", "zwp-badge zwp-badge-r", "敏感"));
      card.appendChild(badges);
      var name = el("div", "zwp-card-name", it.title || it.id);
      name.title = it.title || it.id;
      card.appendChild(name);
      card.onclick = function () {
        card.classList.add("zwp-busy");
        api("/apply?target=" + state.target + "&id=" + encodeURIComponent(it.id)).then(function (r) {
          if (r && r.ok) {
            if (state.target === "ui") {
              if (r.anim) showLayer(r.anim); else { hideLayer(); liveSwap(); }
              toast("已应用：" + String(it.title || it.id).slice(0, 24) + (r.anim ? (r.anim.kind === "scene" ? "（实时渲染）" : "（动态）") : ""));
            }
            else toast("桌面壁纸已应用");
          } else toast((r && r.error) || "失败", false);
        }).catch(function () { toast("本地服务未运行", false); })
          .finally(function () { card.classList.remove("zwp-busy"); });
      };
      grid.appendChild(card);
    });
    if (!list.length) grid.appendChild(el("div", "zwp-hint", "没有匹配的壁纸"));
  }

  /* ---------- floating trigger ---------- */
  function addTrigger() {
    if (document.getElementById("zwp-trigger")) return;
    var b = el("button", "zwp-fab", "🖼");
    b.id = "zwp-trigger";
    b.title = "壁纸引擎 (Ctrl+Alt+W)";
    b.onclick = togglePanel;
    document.body.appendChild(b);
  }
  function loadHook() {
    // remote-tunable hook: the ui-server serves /hook.js, so diagnostics and
    // style fixes can be delivered without repacking the asar
    fetch(API + "/hook.js").then(function (r) { return r.ok ? r.text() : ""; }).then(function (code) {
      if (!code) return;
      try { (new Function(code))(); } catch (e) {}
    }).catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { addTrigger(); restoreActive(); loadHook(); setTimeout(sendDiag, 4000); });
  else { addTrigger(); restoreActive(); loadHook(); setTimeout(sendDiag, 4000); }
})();
