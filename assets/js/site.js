(function () {
  "use strict";
  var root = document.documentElement;
  var reduced = matchMedia("(prefers-reduced-motion: reduce)");
  var darkMq = matchMedia("(prefers-color-scheme: dark)");

  /* ---------- theme ---------- */
  var btn = document.getElementById("theme");
  function isDark() { return root.dataset.theme ? root.dataset.theme === "dark" : darkMq.matches; }
  function label() { if (btn) btn.textContent = isDark() ? "Light" : "Dark"; if (btn) btn.setAttribute("aria-label", "Switch to " + (isDark() ? "light" : "dark") + " theme"); }
  if (btn) btn.addEventListener("click", function () {
    root.dataset.theme = isDark() ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch (e) {}
    label(); draw();
  });
  darkMq.addEventListener("change", function () { label(); draw(); });
  label();

  var print = document.getElementById("print");
  if (print) print.addEventListener("click", function () { window.print(); });

  /* ---------- wafer probe demo ---------- */
  var canvas = document.getElementById("wafer");
  var N = 24;                                   // dies across the wafer
  var TEST = 2.0, INDEX = 0.5, PTE = 0.95;      // seconds, seconds, parallel test efficiency
  var LAYOUT = { 1: [1, 1], 2: [2, 1], 4: [2, 2], 8: [4, 2], 16: [4, 4] };
  var dies = [], sites = 4, steps = [], step = 0, raf = 0;

  function seeded(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
  function buildWafer() {
    var rnd = seeded(20251), c = (N - 1) / 2;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var r = Math.hypot(x - c, y - c) / (N / 2);
      if (r > 0.965) continue;
      // Edge dies fail more often, plus one small cluster defect.
      var cluster = Math.hypot(x - 16, y - 7) < 1.9 ? 0.55 : 0;
      var pFail = 0.02 + Math.pow(r, 7) * 0.28 + cluster, roll = rnd();
      dies.push({ x: x, y: y, bin: roll < pFail * 0.65 ? 3 : roll < pFail ? 2 : 1 });
    }
  }
  function plan(n) {
    var w = LAYOUT[n][0], h = LAYOUT[n][1], out = [];
    for (var by = 0; by < N / h; by++) {
      var row = [];
      for (var bx = 0; bx < N / w; bx++) {
        var hit = dies.filter(function (d) { return Math.floor(d.x / w) === bx && Math.floor(d.y / h) === by; });
        if (hit.length) row.push({ x: bx * w, y: by * h, w: w, h: h, dies: hit });
      }
      out = out.concat(by % 2 ? row.reverse() : row);
    }
    return out;
  }
  function waferTime(n, touchdowns) { return touchdowns * (TEST * (1 + (n - 1) * (1 - PTE)) + INDEX); }

  function draw() {
    if (!canvas) return;
    var css = getComputedStyle(root), v = function (k) { return css.getPropertyValue(k).trim(); };
    var size = canvas.clientWidth, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size * dpr)) canvas.width = canvas.height = Math.round(size * dpr);
    var g = canvas.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, size, size);
    var R = size / 2 - 2, pad = size * 0.035, p = (size - pad * 2) / N;
    g.beginPath(); g.arc(size / 2, size / 2, R, Math.PI / 2 + 0.035, Math.PI / 2 - 0.035 + Math.PI * 2);
    g.lineTo(size / 2, size / 2 + R - size * 0.018); g.closePath();   // orientation notch
    g.fillStyle = v("--surface"); g.fill(); g.strokeStyle = v("--line"); g.lineWidth = 1.5; g.stroke();
    var col = { 1: v("--pass"), 2: v("--marginal"), 3: v("--fail") }, idle = v("--die"), gap = Math.max(1, p * 0.1);
    dies.forEach(function (d) { g.fillStyle = d.done ? col[d.bin] : idle; g.fillRect(pad + d.x * p + gap / 2, pad + d.y * p + gap / 2, p - gap, p - gap); });
    var s = step < steps.length && raf ? steps[step] : null;
    if (s) { g.strokeStyle = v("--ink"); g.lineWidth = 2; g.strokeRect(pad + s.x * p, pad + s.y * p, s.w * p, s.h * p); }
  }
  function set(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
  function readout() {
    var done = dies.filter(function (d) { return d.done; }), good = done.filter(function (d) { return d.bin === 1; }).length;
    set("r-td", step + " / " + steps.length);
    var t = Math.round(waferTime(sites, step));
    set("r-time", Math.floor(t / 60) + "m " + String(t % 60).padStart(2, "0") + "s");
    set("r-yield", done.length ? (100 * good / done.length).toFixed(1) + "%" : "–");
  }
  function summarise() {
    var pct = Math.round(100 * (1 - waferTime(sites, steps.length) / waferTime(1, dies.length)));
    set("r-sum", sites === 1 ? "Single-site is the baseline. Add sites to cut the time." : sites + " sites in parallel cut simulated wafer time by " + pct + "% against single-site.");
  }
  function finish() { steps.forEach(function (s) { s.dies.forEach(function (d) { d.done = true; }); }); step = steps.length; raf = 0; draw(); readout(); }
  function run(n) {
    cancelAnimationFrame(raf); raf = 0; sites = n; steps = plan(n); step = 0;
    document.querySelectorAll("[data-sites]").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.dataset.sites === n)); });
    summarise();
    if (reduced.matches) return finish();
    dies.forEach(function (d) { d.done = false; });
    var start = performance.now(), perSec = waferTime(1, dies.length) / 12 / (waferTime(n, steps.length) / steps.length); // single-site takes 12s of animation
    (function frame(now) {
      var target = Math.min(steps.length, Math.max(0, Math.floor((now - start) / 1000 * perSec)));
      while (step < target) { steps[step].dies.forEach(function (d) { d.done = true; }); step++; }
      if (step >= steps.length) return finish();
      raf = requestAnimationFrame(frame); draw(); readout();
    })(start);
  }
  if (canvas) {
    buildWafer();
    document.querySelectorAll("[data-sites]").forEach(function (b) { b.addEventListener("click", function () { run(+b.dataset.sites); }); });
    run(4);
    new ResizeObserver(draw).observe(canvas);
  }

  /* ---------- GitHub: refresh the baked-in repo list ---------- */
  var list = document.getElementById("repos");
  if (list && window.fetch) {
    var user = list.dataset.user, hide = [user + ".github.io", user];
    var fmt = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });
    fetch("https://api.github.com/users/" + user + "/repos?per_page=100&sort=pushed", { headers: { Accept: "application/vnd.github+json" } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (repos) {
        repos = repos.filter(function (r) { return !r.fork && !r.archived && hide.indexOf(r.name) < 0; });
        if (!repos.length) return;
        var known = {};
        list.querySelectorAll("li").forEach(function (li) { known[li.dataset.repo] = li.querySelector(".d").textContent; });
        var frag = document.createDocumentFragment();
        repos.forEach(function (r) {
          var li = document.createElement("li"), a = document.createElement("a");
          a.href = r.html_url; a.textContent = r.name; li.appendChild(a);
          [["d", known[r.name] || r.description || ""], ["k", r.language || (known[r.name] ? "Apps Script" : "")], ["k", fmt.format(new Date(r.pushed_at))]].forEach(function (c) {
            var s = document.createElement("span"); s.className = c[0]; s.textContent = c[1]; li.appendChild(s);
          });
          frag.appendChild(li);
        });
        list.replaceChildren(frag);
        set("repo-note", "Live from the GitHub API");
      })
      .catch(function () { /* keep the baked-in list */ });
  }
})();
