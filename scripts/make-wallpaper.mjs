// Renders website/wallpaper.webp: an original abstract wallpaper of soft,
// layered waves of light in Doppel's blues. It's drawn as SVG (with blur for
// soft edges), then rendered once in Chrome and saved as a compressed WebP, so
// the browser only has to draw a plain image.
//   node scripts/make-wallpaper.mjs
import fs from "node:fs";
import { createRequire } from "node:module";

const W = 2400, H = 1500;

// A wave is the area between two S-shaped cubic curves that rise from the
// lower left toward the upper right. Waves are layered back to front, and
// each gets a soft bright crest along its top edge for depth.
function edges({ y, thick, lift, b1, b2 }) {
  const top = [[-300, y], [650, y - b1], [1550, y + b2 - lift * 0.55], [W + 300, y - lift]];
  const bot = [[-300, y + thick], [750, y + thick - b1 * 0.8], [1650, y + thick * 0.5 + b2 * 0.8 - lift * 0.5], [W + 300, y - lift + thick * 0.45]];
  return { top, bot };
}
const p = (pt) => pt.join(" ");
const wavePath = (w) => {
  const { top, bot } = edges(w);
  return `M${p(top[0])} C${p(top[1])} ${p(top[2])} ${p(top[3])} L${p(bot[3])} C${p(bot[2])} ${p(bot[1])} ${p(bot[0])} Z`;
};
const crestPath = (w) => {
  const { top } = edges(w);
  return `M${p(top[0])} C${p(top[1])} ${p(top[2])} ${p(top[3])}`;
};

const waves = [
  { y: 860, thick: 760, lift: 520, b1: 300, b2: 220, fill: "far", blur: 40, opacity: 0.75 },
  { y: 1020, thick: 600, lift: 660, b1: 380, b2: 280, fill: "deep", blur: 22, opacity: 0.95, crest: 0.35 },
  { y: 1160, thick: 480, lift: 780, b1: 430, b2: 320, fill: "mid", blur: 14, opacity: 0.9, crest: 0.55 },
  { y: 1300, thick: 420, lift: 860, b1: 380, b2: 360, fill: "sky", blur: 10, opacity: 0.85, crest: 0.8 },
  { y: 1440, thick: 360, lift: 880, b1: 300, b2: 380, fill: "front", blur: 8, opacity: 0.9, crest: 0.5 },
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0a2a78"/><stop offset=".5" stop-color="#1a50cf"/><stop offset="1" stop-color="#3a8bff"/>
  </linearGradient>
  <radialGradient id="glow" cx=".8" cy=".12" r=".55"><stop offset="0" stop-color="#e3f3ff" stop-opacity=".8"/><stop offset=".5" stop-color="#8cc8ff" stop-opacity=".22"/><stop offset="1" stop-color="#8cc8ff" stop-opacity="0"/></radialGradient>
  <radialGradient id="low" cx=".05" cy="1" r=".6"><stop offset="0" stop-color="#051a52" stop-opacity=".75"/><stop offset="1" stop-color="#051a52" stop-opacity="0"/></radialGradient>
  <linearGradient id="far" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#0c2f8c"/><stop offset="1" stop-color="#2f74ee"/></linearGradient>
  <linearGradient id="deep" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#0f3cae"/><stop offset=".6" stop-color="#2c6ff0"/><stop offset="1" stop-color="#63aaff"/></linearGradient>
  <linearGradient id="mid" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#1a55da"/><stop offset=".55" stop-color="#4b97ff"/><stop offset="1" stop-color="#a6d4ff"/></linearGradient>
  <linearGradient id="sky" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2a6ef0"/><stop offset=".5" stop-color="#78b9ff"/><stop offset="1" stop-color="#d4ecff"/></linearGradient>
  <linearGradient id="front" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#123fae"/><stop offset=".55" stop-color="#2f78f2"/><stop offset="1" stop-color="#7fbfff"/></linearGradient>
  <linearGradient id="crest" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity=".7"/></linearGradient>
  ${[3, 8, 10, 14, 22, 40].map((b) => `<filter id="b${b}" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="${b}"/></filter>`).join("")}
</defs>
<rect width="${W}" height="${H}" fill="url(#base)"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
${waves.map((w) => `<path d="${wavePath(w)}" fill="url(#${w.fill})" opacity="${w.opacity}" filter="url(#b${w.blur})"/>` +
  (w.crest ? `<path d="${crestPath(w)}" fill="none" stroke="url(#crest)" stroke-width="5" opacity="${w.crest}" filter="url(#b3)"/>` : "")).join("")}
<rect width="${W}" height="${H}" fill="url(#low)"/>
</svg>`;

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const dataUrl = await page.evaluate(async ({ svg, W, H }) => {
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  canvas.getContext("2d").drawImage(img, 0, 0, W, H);
  return canvas.toDataURL("image/webp", 0.82);
}, { svg, W, H });
await browser.close();
const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
fs.writeFileSync("website/wallpaper.webp", bytes);
console.log(`wrote website/wallpaper.webp (${Math.round(bytes.length / 1024)} KB, ${W}x${H})`);
