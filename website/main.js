// Doppel site: OS-aware download buttons and the looping feature demos.
// Each demo's HTML already shows its finished state; when it scrolls near the
// viewport, it resets and plays, and it stops again when it leaves.
(function () {
  "use strict";

  var RELEASES = "https://github.com/raman2221/doppel/releases/latest/download/";
  var FILES = { mac: "Doppel-mac-arm64.dmg", windows: "Doppel-windows-x64-setup.exe" };
  var platform = navigator.userAgentData && navigator.userAgentData.platform ? navigator.userAgentData.platform : navigator.platform || navigator.userAgent;
  var os = /mac|iphone|ipad/i.test(platform) ? "mac" : /win/i.test(platform) ? "windows" : null;

  // ---- downloads ---------------------------------------------------------------
  if (os) {
    var other = os === "mac" ? "Windows" : "Mac";
    var primary = document.getElementById("primary-download");
    document.getElementById("primary-label").textContent = "Download for " + (os === "mac" ? "Mac" : "Windows");
    primary.href = RELEASES + FILES[os];
    document.getElementById("secondary-line").innerHTML =
      'Also for <a href="' + RELEASES + FILES[os === "mac" ? "windows" : "mac"] + '">' + other + "</a> · Free and open source";
    // In the closing band, the visitor's platform comes first and gets the blue button.
    var wrap = document.querySelector(".downloads");
    var mine = wrap.querySelector('[data-os="' + os + '"]');
    var theirs = wrap.querySelector('[data-os]:not([data-os="' + os + '"])');
    wrap.insertBefore(mine, wrap.firstChild);
    mine.className = "btn btn-blue btn-lg";
    theirs.className = "btn btn-white btn-lg";
  }

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !("IntersectionObserver" in window)) return; // keep the finished states

  // ---- demo engine ------------------------------------------------------------------
  function Demo(root, build, hold) {
    var timers = [];
    var playing = false;
    function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
    function clear() { timers.forEach(clearTimeout); timers = []; }
    function run() {
      clear();
      var total = build(root, later);
      later(total + (hold || 2800), run);
    }
    this.start = function () { if (!playing) { playing = true; run(); } };
    this.stop = function () { playing = false; clear(); };
  }

  // Types text into a node starting at `start` ms. Returns when it finishes.
  function typeText(node, text, start, later, speed) {
    speed = speed || 30;
    node.textContent = "";
    for (var i = 1; i <= text.length; i++) {
      (function (n) { later(start + n * speed, function () { node.textContent = text.slice(0, n); }); })(i);
    }
    return start + text.length * speed;
  }

  function all(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  var builders = {
    hero: function (r, later) {
      r.classList.add("playing");
      var cmd = r.querySelector("[data-type]");
      var steps = all(r, "[data-step]");
      steps.forEach(function (s) { s.classList.remove("in"); });
      var t = typeText(cmd, cmd.getAttribute("data-type"), 500, later, 34);
      steps.forEach(function (s, i) { later(t + 700 + i * 950, function () { s.classList.add("in"); }); });
      return t + 700 + steps.length * 950 + 1800;
    },

    inbox: function (r, later) {
      var noise = all(r, ".noise");
      var count = r.querySelector("[data-count]");
      var compose = r.querySelector(".compose");
      var text = r.querySelector(".compose-text");
      var countdown = r.querySelector("[data-countdown]");
      noise.forEach(function (li) { li.classList.remove("gone"); });
      compose.classList.remove("show");
      text.textContent = "";
      countdown.classList.remove("sent");
      countdown.textContent = "Sending in 5s";
      count.textContent = "4 unread";
      var t = 1100;
      noise.forEach(function (li, i) {
        later(t + i * 650, function () {
          li.classList.add("gone");
          count.textContent = (3 - i) + " unread";
        });
      });
      t += noise.length * 650 + 500;
      later(t, function () { compose.classList.add("show"); });
      t = typeText(text, text.getAttribute("data-type"), t + 500, later, 32);
      for (var s = 4; s >= 1; s--) {
        (function (left, at) { later(at, function () { countdown.textContent = "Sending in " + left + "s"; }); })(s, t + (5 - s) * 900);
      }
      later(t + 5 * 900, function () { countdown.textContent = "Sent"; countdown.classList.add("sent"); });
      return t + 5 * 900;
    },

    browser: function (r, later) {
      var fields = all(r, ".field[data-value]");
      var locked = r.querySelector(".field.locked");
      var foot = r.querySelector(".site-foot");
      fields.forEach(function (f) { f.classList.remove("done", "active"); f.querySelector(".val").textContent = ""; });
      locked.classList.remove("show");
      foot.classList.remove("show");
      var t = 900;
      fields.forEach(function (f) {
        later(t, function () { f.classList.add("active"); });
        t = typeText(f.querySelector(".val"), f.getAttribute("data-value"), t + 350, later, 38);
        later(t + 250, function () { f.classList.remove("active"); f.classList.add("done"); });
        t += 550;
      });
      later(t, function () { locked.classList.add("show"); });
      later(t + 900, function () { foot.classList.add("show"); });
      return t + 900;
    },

    form: function (r, later) {
      var lines = all(r, ".line[data-value]");
      var locked = r.querySelector(".line.locked");
      var saved = r.querySelector(".saved");
      lines.forEach(function (l) { l.querySelector(".ink").textContent = ""; });
      locked.classList.remove("show");
      saved.classList.remove("show");
      var t = 800;
      lines.forEach(function (l) {
        t = typeText(l.querySelector(".ink"), l.getAttribute("data-value"), t, later, 34) + 300;
      });
      later(t, function () { locked.classList.add("show"); });
      later(t + 900, function () { saved.classList.add("show"); });
      return t + 900;
    },

    memory: function (r, later) {
      var toast = r.querySelector(".toast");
      var items = all(r, ".dates li");
      toast.classList.remove("show");
      items.forEach(function (li) { li.classList.remove("show"); });
      items.forEach(function (li, i) { later(600 + i * 450, function () { li.classList.add("show"); }); });
      var t = 600 + items.length * 450 + 700;
      later(t, function () { toast.classList.add("show"); });
      return t + 2200;
    },
  };

  // ---- approval modes: tabs that also cycle on their own ------------------------------
  var MODE_TEXT = [
    ["Waits for you", "Waits for you", "Waits for you"],
    ["Runs on its own", "Runs on its own", "Waits for you"],
    ["Runs on its own", "Runs on its own", "Sends after a 5s preview"],
  ];
  var modesRoot = document.querySelector('[data-demo="modes"]');
  var tabs = all(modesRoot, "[data-mode]");
  var current = 1;
  var pausedUntil = 0;
  function showMode(i) {
    current = i;
    tabs.forEach(function (t, j) { t.setAttribute("aria-selected", String(i === j)); });
    all(modesRoot, "[data-r]").forEach(function (em) {
      var text = MODE_TEXT[i][Number(em.getAttribute("data-r"))];
      em.textContent = text;
      em.classList.toggle("wait", text === "Waits for you");
    });
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () { showMode(i); pausedUntil = Date.now() + 9000; });
  });
  var modeTimer = null;
  var modesDemo = {
    start: function () {
      if (modeTimer) return;
      modeTimer = setInterval(function () { if (Date.now() > pausedUntil) showMode((current + 1) % 3); }, 2600);
    },
    stop: function () { clearInterval(modeTimer); modeTimer = null; },
  };

  // ---- run demos only while they're near the viewport ------------------------------------
  var demos = new Map();
  all(document, "[data-demo]").forEach(function (el) {
    var name = el.getAttribute("data-demo");
    demos.set(el, name === "modes" ? modesDemo : new Demo(el, builders[name], name === "hero" ? 3500 : 2800));
  });
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var demo = demos.get(entry.target);
      if (entry.isIntersecting) demo.start();
      else demo.stop();
    });
  }, { rootMargin: "120px 0px" });
  demos.forEach(function (_, el) { observer.observe(el); });

  // Pause everything when the tab is hidden.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) demos.forEach(function (d) { d.stop(); });
    else demos.forEach(function (_, el) {
      var rect = el.getBoundingClientRect();
      if (rect.bottom > -120 && rect.top < innerHeight + 120) demos.get(el).start();
    });
  });
})();
