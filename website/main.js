// Doppel site: OS-aware download buttons and the looping feature demos.
// Every demo is a complete, fixed-size card in every frame. The animation only
// changes state inside it (a row turns "Done", a field fills, a chip changes),
// so nothing ever looks empty and nothing on the page jumps. Demos run only
// while near the viewport and pause when the tab is hidden.
(function () {
  "use strict";

  var RELEASES = "https://github.com/raman2221/doppel/releases/latest/download/";
  var FILES = { mac: "Doppel-mac-arm64.dmg", windows: "Doppel-windows-x64-setup.exe" };
  var platform = navigator.userAgentData && navigator.userAgentData.platform ? navigator.userAgentData.platform : navigator.platform || navigator.userAgent;
  var os = /mac|iphone|ipad/i.test(platform) ? "mac" : /win/i.test(platform) ? "windows" : null;

  // ---- downloads ---------------------------------------------------------------
  if (os) {
    var otherOs = os === "mac" ? "windows" : "mac";
    var primary = document.getElementById("primary-download");
    document.getElementById("primary-label").textContent = "Download for " + (os === "mac" ? "Mac" : "Windows");
    primary.href = RELEASES + FILES[os];
    document.getElementById("secondary-line").innerHTML =
      'Also for <a href="' + RELEASES + FILES[otherOs] + '">' + (otherOs === "mac" ? "Mac" : "Windows") + "</a> · Free and open source";
    // In the closing band, the visitor's platform comes first and gets the blue button.
    var wrap = document.querySelector(".downloads");
    var mine = wrap.querySelector('[data-os="' + os + '"]');
    var theirs = wrap.querySelector('[data-os="' + otherOs + '"]');
    wrap.insertBefore(mine, wrap.firstChild);
    mine.className = "btn btn-blue btn-lg";
    theirs.className = "btn btn-white btn-lg";
  }

  // ---- the desktop's menu-bar clock shows the visitor's own time -------------------
  var clock = document.querySelector("[data-clock]");
  function tick() {
    var now = new Date();
    clock.textContent = now.toLocaleDateString(undefined, { weekday: "short" }) + " " + now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (clock) { tick(); setInterval(tick, 30000); }

  // ---- approval-mode tabs work even without motion -------------------------------
  var MODE_TEXT = [
    ["Waits for you", "Waits for you", "Waits for you"],
    ["Runs on its own", "Runs on its own", "Waits for you"],
    ["Runs on its own", "Runs on its own", "5-second preview"],
  ];
  var modesRoot = document.querySelector('[data-demo="modes"]');
  var tabs = Array.prototype.slice.call(modesRoot.querySelectorAll("[data-mode]"));
  var thumb = modesRoot.querySelector(".seg-thumb");
  var currentMode = 1;
  var pausedUntil = 0;
  function showMode(i) {
    currentMode = i;
    tabs.forEach(function (t, j) { t.setAttribute("aria-selected", String(i === j)); });
    thumb.style.setProperty("--i", i);
    Array.prototype.forEach.call(modesRoot.querySelectorAll("[data-r]"), function (em) {
      var text = MODE_TEXT[i][Number(em.getAttribute("data-r"))];
      em.textContent = text;
      em.classList.toggle("wait", text === "Waits for you");
    });
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () { showMode(i); pausedUntil = Date.now() + 9000; });
  });

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !("IntersectionObserver" in window)) return; // keep the finished states

  // ---- demo engine ------------------------------------------------------------------
  function Demo(root, build, hold) {
    var timers = [];
    var frames = [];
    var playing = false;
    function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
    // Runs fn on every animation frame until it returns false.
    function frame(fn) {
      function step(now) { if (fn(now)) frames.push(requestAnimationFrame(step)); }
      frames.push(requestAnimationFrame(step));
    }
    function clear() {
      timers.forEach(clearTimeout);
      frames.forEach(cancelAnimationFrame);
      timers = [];
      frames = [];
    }
    function run() {
      clear();
      var total = build(root, later, frame);
      later(total + hold, run);
    }
    this.start = function () { if (!playing) { playing = true; run(); } };
    this.stop = function () { playing = false; clear(); };
  }

  // Types text into a node starting at `start` ms, on animation frames, so the
  // page writes to the DOM at most once per frame. Returns the finish time.
  function typeText(node, text, start, later, frame, speed) {
    node.textContent = "";
    later(start, function () {
      var t0 = performance.now();
      var shown = 0;
      frame(function (now) {
        var n = Math.min(text.length, Math.floor((now - t0) / speed) + 1);
        if (n !== shown) { shown = n; node.textContent = text.slice(0, n); }
        return n < text.length;
      });
    });
    return start + text.length * speed;
  }

  function $$(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  var builders = {
    // Steps flip from Working to Done, then the reply waits for you and you send it.
    hero: function (r, later) {
      var tools = $$(r, "[data-tool]");
      var approve = r.querySelector("[data-approve]");
      var state = r.querySelector("[data-state]");
      var send = r.querySelector("[data-send]");
      tools.forEach(function (t) { t.classList.add("working"); t.querySelector("b").textContent = "Working"; });
      approve.classList.remove("waiting", "sent");
      state.textContent = "Preparing";
      var t = 900;
      tools.forEach(function (tool, i) {
        later(t + i * 1100, function () { tool.classList.remove("working"); tool.querySelector("b").textContent = "Done"; });
      });
      t += tools.length * 1100;
      later(t, function () { approve.classList.add("waiting"); state.textContent = "Waiting for you"; });
      later(t + 2200, function () { send.classList.add("pressed"); });
      later(t + 2400, function () {
        send.classList.remove("pressed");
        approve.classList.remove("waiting");
        approve.classList.add("sent");
        state.textContent = "Sent";
      });
      return t + 2400;
    },

    // Newsletters get archived one by one; the reply types itself and counts down.
    inbox: function (r, later, frame) {
      var noise = $$(r, ".noise");
      var keep = r.querySelector(".keep");
      var count = r.querySelector("[data-count]");
      var text = r.querySelector(".compose-text");
      var countdown = r.querySelector("[data-countdown]");
      noise.forEach(function (li) { li.classList.remove("archived"); });
      keep.classList.remove("replied");
      text.textContent = "";
      countdown.classList.remove("sent");
      countdown.textContent = "Drafting";
      count.textContent = "4 unread";
      var t = 900;
      noise.forEach(function (li, i) {
        later(t + i * 700, function () {
          li.classList.add("archived");
          count.textContent = (3 - i) + " unread";
        });
      });
      t += noise.length * 700 + 300;
      t = typeText(text, text.getAttribute("data-type"), t, later, frame, 30);
      for (var s = 5; s >= 1; s--) {
        (function (left, at) { later(at, function () { countdown.textContent = "Sending in " + left + "s"; }); })(s, t + (5 - s) * 800);
      }
      later(t + 5 * 800, function () {
        countdown.textContent = "Sent";
        countdown.classList.add("sent");
        keep.classList.add("replied");
      });
      return t + 5 * 800;
    },

    // Fields fill one at a time; the final click waits for you.
    browser: function (r, later, frame) {
      var fields = $$(r, ".field[data-value]");
      var chip = r.querySelector("[data-chip]");
      var submit = r.querySelector("[data-submit]");
      fields.forEach(function (f) { f.classList.remove("active"); f.querySelector(".val").textContent = ""; });
      chip.classList.remove("waiting");
      chip.textContent = "Filling in";
      submit.classList.remove("held");
      var t = 800;
      fields.forEach(function (f) {
        later(t, function () { f.classList.add("active"); });
        t = typeText(f.querySelector(".val"), f.getAttribute("data-value"), t + 300, later, frame, 36);
        later(t + 200, function () { f.classList.remove("active"); });
        t += 450;
      });
      later(t, function () {
        chip.classList.add("waiting");
        chip.textContent = "Waiting for your OK";
        submit.classList.add("held");
      });
      return t;
    },

    // The lease fills in by hand; the SSN line stays blank on purpose.
    form: function (r, later, frame) {
      var lines = $$(r, ".line[data-value]");
      var saved = r.querySelector("[data-saved]");
      lines.forEach(function (l) { l.querySelector(".ink").textContent = ""; });
      saved.classList.remove("done");
      saved.textContent = "Filling in 4 fields";
      var t = 700;
      lines.forEach(function (l) {
        t = typeText(l.querySelector(".ink"), l.getAttribute("data-value"), t, later, frame, 34) + 250;
      });
      later(t + 300, function () {
        saved.classList.add("done");
        saved.textContent = "Saved “lease (filled).pdf”";
      });
      return t + 300;
    },

    // The notification cycles through what's coming up, highlighting each one.
    memory: function (r, later) {
      var NOTES = [
        ["Mom's birthday is Friday", "Want me to order flowers from the usual shop?"],
        ["Follow up with the landlord", "No reply since last Tuesday. I drafted a polite nudge for you."],
        ["Car registration renews May 1", "I'll open the renewal page and fill it in when it's due."],
      ];
      var toast = r.querySelector("[data-toast]");
      var title = r.querySelector("[data-toast-title]");
      var body = r.querySelector("[data-toast-body]");
      var rows = $$(r, ".dates li");
      NOTES.forEach(function (note, i) {
        later(i * 3200, function () {
          title.textContent = note[0];
          body.textContent = note[1];
          rows.forEach(function (row, j) { row.classList.toggle("hl", i === j); });
          toast.classList.remove("pop");
          void toast.offsetWidth; // restart the animation
          toast.classList.add("pop");
        });
      });
      return NOTES.length * 3200 - 2600;
    },
  };

  var modesDemo = {
    timer: null,
    start: function () {
      if (this.timer) return;
      this.timer = setInterval(function () { if (Date.now() > pausedUntil) showMode((currentMode + 1) % 3); }, 2600);
    },
    stop: function () { clearInterval(this.timer); this.timer = null; },
  };

  // ---- run demos only while they're near the viewport ------------------------------------
  var HOLD = { hero: 3200, inbox: 2600, browser: 2600, form: 2600, memory: 2600 };
  var demos = new Map();
  $$(document, "[data-demo]").forEach(function (el) {
    var name = el.getAttribute("data-demo");
    demos.set(el, name === "modes" ? modesDemo : new Demo(el, builders[name], HOLD[name]));
  });
  var visible = new Set();
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) { visible.add(entry.target); demos.get(entry.target).start(); }
      else { visible.delete(entry.target); demos.get(entry.target).stop(); }
    });
  }, { rootMargin: "80px 0px" });
  demos.forEach(function (_, el) { observer.observe(el); });

  document.addEventListener("visibilitychange", function () {
    visible.forEach(function (el) { document.hidden ? demos.get(el).stop() : demos.get(el).start(); });
  });
})();
