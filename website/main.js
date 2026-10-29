// Three small behaviors: point the download button at the visitor's OS,
// run the send countdown in the hero window, and switch approval modes.
(function () {
  var REPO = "https://github.com/raman2221/doppel/releases/latest/download/";
  var ua = navigator.userAgent;
  var os = /Mac|iPhone|iPad/.test(navigator.platform || ua) ? "mac" : /Win/.test(navigator.platform || ua) ? "windows" : null;

  var heroButton = document.getElementById("hero-download");
  var heroLabel = document.getElementById("hero-download-label");
  if (os === "mac") {
    heroLabel.textContent = "Download for Mac";
    heroButton.href = REPO + "Doppel-mac-arm64.dmg";
  } else if (os === "windows") {
    heroLabel.textContent = "Download for Windows";
    heroButton.href = REPO + "Doppel-windows-x64-setup.exe";
  }
  if (os) {
    var card = document.querySelector('.platform[data-os="' + os + '"]');
    if (card) card.classList.add("detected");
  }

  // The hero's "Sending in 5s" counts down, sends, and starts over.
  var countdown = document.getElementById("hero-countdown");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (countdown && !reduced) {
    var left = 5;
    setInterval(function () {
      left -= 1;
      if (left > 0) {
        countdown.textContent = "Sending in " + left + "s";
        countdown.classList.remove("sent");
      } else if (left === 0) {
        countdown.textContent = "Sent";
        countdown.classList.add("sent");
      } else if (left <= -3) {
        left = 6;
      }
    }, 1000);
  }

  // Approval mode cards behave as tabs.
  var modes = Array.prototype.slice.call(document.querySelectorAll(".mode"));
  modes.forEach(function (mode) {
    mode.addEventListener("click", function () {
      modes.forEach(function (m) { m.setAttribute("aria-selected", String(m === mode)); });
    });
    mode.addEventListener("keydown", function (e) {
      var i = modes.indexOf(mode);
      var next = e.key === "ArrowRight" ? modes[(i + 1) % modes.length] : e.key === "ArrowLeft" ? modes[(i + modes.length - 1) % modes.length] : null;
      if (next) {
        e.preventDefault();
        next.focus();
        next.click();
      }
    });
  });
})();
