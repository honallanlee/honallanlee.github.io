/* Body-to-bits demo: synthetic signal + interference -> optional front-end filter -> N-bit ADC. */
(function () {
  "use strict";
  var canvas = document.getElementById("scope");
  if (!canvas) return;
  var root = document.documentElement, $ = function (id) { return document.getElementById(id); };
  var reduced = matchMedia("(prefers-reduced-motion: reduce)");
  var TAU = Math.PI * 2;
  function rng(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; }; }
  function bump(t, c, w) { var d = (t - c) / w; return Math.exp(-0.5 * d * d); }

  /* ---------- sources: clean signal, interference, filter, display window ---------- */
  var SOURCES = {
    ecg: {
      fs: 1000, secs: 8, from: 2, win: 3.2, stages: ["Electrodes", "Amplifier", "Filter", "ADC"], unit: "bpm",
      label: "ECG", noise: "50 Hz mains, baseline wander and hiss", bpm: 72,
      clean: function (t) { var p = t % (60 / 72); return 0.07 * bump(p, 0.18, 0.026) - 0.09 * bump(p, 0.315, 0.011) + 0.72 * bump(p, 0.34, 0.012) - 0.16 * bump(p, 0.367, 0.012) + 0.17 * bump(p, 0.56, 0.048); },
      noisy: function (t, r) { return 0.17 * Math.sin(TAU * 50 * t) + 0.16 * Math.sin(TAU * 0.19 * t + 1) + 0.045 * r(); },
      filter: [["hp", 0.5, 0.707], ["notch", 50, 2], ["lp", 70, 0.707]]
    },
    ppg: {
      fs: 500, secs: 10, from: 2, win: 4.2, stages: ["Photodiode", "Transimpedance amp", "Filter", "ADC"], unit: "bpm",
      label: "Optical pulse", noise: "100 Hz room-light flicker, motion drift and hiss", bpm: 64,
      clean: function (t) { var p = t % (60 / 64); return 0.62 * bump(p, 0.26, 0.085) + 0.25 * bump(p, 0.54, 0.1) - 0.3; },
      noisy: function (t, r) { return 0.12 * Math.sin(TAU * 100 * t) + 0.15 * Math.sin(TAU * 0.16 * t) + 0.05 * r(); },
      filter: [["hp", 0.4, 0.707], ["lp", 10, 0.707]]
    },
    audio: {
      fs: 24000, secs: 2, from: 0.3, win: 0.02, stages: ["Microphone", "Preamp", "Filter", "ADC"], unit: "Hz",
      label: "Audio", noise: "50 Hz hum and broadband hiss",
      clean: function (t) { return 0.3 * Math.sin(TAU * 440 * t) + 0.14 * Math.sin(TAU * 660 * t) + 0.09 * Math.sin(TAU * 1100 * t + 0.6); },
      noisy: function (t, r) { return 0.17 * Math.sin(TAU * 50 * t) + 0.16 * r(); },
      filter: [["hp", 180, 0.707], ["lp", 2200, 0.707]]
    }
  };

  /* ---------- DSP ---------- */
  function biquad(type, f, q, fs) {
    var w = TAU * f / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al, b;
    if (type === "lp") b = [(1 - c) / 2, 1 - c, (1 - c) / 2];
    else if (type === "hp") b = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    else b = [1, -2 * c, 1];
    return [b[0] / a0, b[1] / a0, b[2] / a0, -2 * c / a0, (1 - al) / a0];
  }
  function pass(x, k) {
    var y = new Float64Array(x.length), x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (var i = 0; i < x.length; i++) { var v = k[0] * x[i] + k[1] * x1 + k[2] * x2 - k[3] * y1 - k[4] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    return y;
  }
  // Forward then backward, so the filter adds no phase shift and the output can be compared with the clean signal.
  function zeroPhase(x, k) { return pass(pass(x, k).reverse(), k).reverse(); }
  function quantise(x, bits) {
    var lsb = 2 / Math.pow(2, bits), top = Math.pow(2, bits - 1) - 1, bot = -Math.pow(2, bits - 1);
    return x.map(function (v) { return Math.max(bot, Math.min(top, Math.round(v / lsb))) * lsb; });
  }
  function mean(x, a, b) { var s = 0; for (var i = a; i < b; i++) s += x[i]; return s / (b - a); }
  // SNR over the middle of the record, gain- and offset-matched to the clean signal.
  function snr(clean, out, a, b) {
    var mc = mean(clean, a, b), mo = mean(out, a, b), cc = 0, co = 0, i;
    for (i = a; i < b; i++) { cc += (clean[i] - mc) * (clean[i] - mc); co += (clean[i] - mc) * (out[i] - mo); }
    var g = co / cc, e = 0;
    for (i = a; i < b; i++) { var d = (out[i] - mo) - g * (clean[i] - mc); e += d * d; }
    return 10 * Math.log10(g * g * cc / e);
  }

  var cache = {};
  function record(key) {
    if (cache[key]) return cache[key];
    var s = SOURCES[key], n = Math.round(s.fs * s.secs), r = rng(77), clean = new Float64Array(n), raw = new Float64Array(n);
    for (var i = 0; i < n; i++) { var t = i / s.fs; clean[i] = s.clean(t); raw[i] = clean[i] + s.noisy(t, r); }
    var f = raw;
    s.filter.forEach(function (d) { f = zeroPhase(f, biquad(d[0], d[1], d[2], s.fs)); });
    return (cache[key] = { clean: clean, raw: raw, filtered: f });
  }

  /* ---------- state ---------- */
  var state = { src: "ecg", filter: true, bits: 8 }, out = null, m = {};
  function update() {
    var s = SOURCES[state.src], rec = record(state.src), n = rec.raw.length, edge = Math.round(n * 0.15);
    var front = state.filter ? rec.filtered : rec.raw;
    out = quantise(front, state.bits);
    m.snr = snr(rec.clean, out, edge, n - edge);
    m.front = snr(rec.clean, front, edge, n - edge);
    m.adc = snr(front, out, edge, n - edge);
    $("s-snr").textContent = m.snr.toFixed(1) + " dB";
    $("s-front").textContent = m.front.toFixed(1) + " dB";
    $("s-adc").textContent = m.adc.toFixed(1) + " dB";
    $("s-note").textContent = m.adc < m.front - 1 ? "The ADC is the limit here. Add bits to recover the signal."
      : m.adc < m.front + 6 ? "The ADC and the front end add similar error here."
      : state.filter ? "The front end is the limit here, so more bits won’t help." : "Interference is the limit here. Switch the filter on.";
    $("s-desc").textContent = s.label + " with " + s.noise + ". Simulated, not recorded from a person.";
    $("s-bits").textContent = state.bits + "-bit";
    var lis = document.querySelectorAll("#chain li");
    s.stages.forEach(function (name, i) { lis[i].textContent = name; });
    lis[2].classList.toggle("off", !state.filter);
    lis[2].setAttribute("aria-label", state.filter ? "Filter on" : "Filter off");
    canvas.setAttribute("aria-label", s.label + " before and after the signal chain. Output signal-to-noise ratio " + m.snr.toFixed(1) + " decibels.");
    document.querySelectorAll("[data-src]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.src === state.src)); });
    draw();
  }

  /* ---------- drawing ---------- */
  var head = 1;
  function draw() {
    if (!out) return;
    var css = getComputedStyle(root), v = function (k) { return css.getPropertyValue(k).trim(); };
    var W = canvas.clientWidth, H = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!W) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    var g = canvas.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    var s = SOURCES[state.src], rec = record(state.src), a = Math.round(s.from * s.fs), win = W < 520 ? +(s.win * 0.6).toPrecision(2) : s.win, len = Math.round(win * s.fs);
    g.strokeStyle = v("--line"); g.lineWidth = 1; g.globalAlpha = 0.6; g.beginPath();
    for (var i = 1; i < 10; i++) { var gx = Math.round(W * i / 10) + 0.5; g.moveTo(gx, 0); g.lineTo(gx, H); }
    g.stroke(); g.globalAlpha = 1; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    function trace(data, top, h, colour, hold) {
      var mid = mean(data, a, a + len), scale = (h - 30) / (state.src === "audio" ? 1.75 : 1.55);
      // ECG and pulse sit mostly below their peaks, so drop the baseline to use the panel.
      var base = top + h * (state.src === "ecg" ? 0.72 : 0.56) + 4;
      function Y(k) { return base - (data[a + k] - mid) * scale; }
      g.save(); g.beginPath(); g.rect(0, top, W, h); g.clip();
      g.strokeStyle = colour; g.lineWidth = 2; g.lineJoin = "round"; g.beginPath();
      for (var k = 0; k < len; k++) {
        var x = k / (len - 1) * W, y = Y(k);
        if (!k) g.moveTo(x, y); else { if (hold) g.lineTo(x, Y(k - 1)); g.lineTo(x, y); }
      }
      g.stroke();
      if (head < 1) {   // monitor-style sweep: an erase bar led by a dot
        var hx = head * W, kx = Math.min(len - 1, Math.round(head * (len - 1)));
        g.clearRect(hx, top + 1, Math.min(22, W * 0.04), h - 2);
        g.fillStyle = colour; g.beginPath(); g.arc(hx, Y(kx), 4.5, 0, TAU); g.fill();
      }
      g.restore();
    }
    trace(rec.raw, 0, H / 2, v("--muted"), false);
    trace(out, H / 2, H / 2, v("--accent"), true);
    g.font = "500 12px " + v("--mono"); g.fillStyle = v("--muted"); g.textBaseline = "top";
    function tag(t, y) { var w = g.measureText(t).width; g.fillStyle = v("--surface"); g.fillRect(6, y, w + 8, 18); g.fillStyle = v("--ink"); g.fillText(t, 10, y + 3); }
    tag("In", 6); tag("Out", H / 2 + 6);
    var span = win < 1 ? Math.round(win * 1000) + " ms" : win + " s", sw = g.measureText(span).width;
    g.fillStyle = v("--surface"); g.fillRect(W - sw - 14, H - 22, sw + 8, 18); g.fillStyle = v("--muted"); g.fillText(span, W - sw - 10, H - 19);
  }
  var raf = 0, visible = false, t0 = 0;
  function tick(now) {
    var period = state.src === "audio" ? 4000 : SOURCES[state.src].win * 1000;
    head = ((now - t0) % period) / period; draw(); raf = requestAnimationFrame(tick);
  }
  function play() {
    cancelAnimationFrame(raf); raf = 0;
    if (visible && !reduced.matches) { t0 = performance.now(); raf = requestAnimationFrame(tick); } else { head = 1; draw(); }
  }

  /* ---------- listen: the audio output as sound, or a monitor blip per heartbeat ---------- */
  var ctx = null, playing = null, listen = $("listen");
  function stopSound() { if (playing) { var p = playing; playing = null; try { p.stop(); } catch (e) {} } listen.textContent = "Listen"; }
  function sound() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (playing) return stopSound();
    ctx = ctx || new AC(); ctx.resume();
    var s = SOURCES[state.src], fs = 24000, secs = state.src === "audio" ? s.secs : 5, buf = ctx.createBuffer(1, fs * secs, fs), d = buf.getChannelData(0), i;
    if (state.src === "audio") for (i = 0; i < d.length; i++) d[i] = (out[i] || 0) * 0.5;
    else for (var b = 0.1; b < secs - 0.2; b += 60 / s.bpm) for (i = 0; i < fs * 0.1; i++) d[Math.round(b * fs) + i] = 0.16 * Math.sin(TAU * 880 * i / fs) * Math.sin(Math.PI * i / (fs * 0.1));
    for (i = 0; i < 480; i++) { d[i] *= i / 480; d[d.length - 1 - i] *= i / 480; }
    var node = ctx.createBufferSource(); node.buffer = buf; node.connect(ctx.destination);
    node.onended = function () { if (playing === node) stopSound(); };
    playing = node; node.start(); listen.textContent = "Stop";
  }

  /* ---------- controls ---------- */
  document.querySelectorAll("[data-src]").forEach(function (b) { b.addEventListener("click", function () { state.src = b.dataset.src; stopSound(); update(); play(); }); });
  $("filter").addEventListener("change", function (e) { state.filter = e.target.checked; stopSound(); update(); });
  $("bits").addEventListener("input", function (e) { state.bits = +e.target.value; stopSound(); update(); });
  listen.addEventListener("click", sound);
  state.filter = $("filter").checked; state.bits = +$("bits").value;   // browsers may restore form values
  update();
  new ResizeObserver(draw).observe(canvas);
  new MutationObserver(draw).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
  new IntersectionObserver(function (es) { visible = es[0].isIntersecting; play(); }, { threshold: 0.15 }).observe(canvas);
})();
