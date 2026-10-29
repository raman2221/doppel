// Draws website/golden-gate.svg: an original illustration of the Golden Gate
// Bridge in fog, used as the desktop wallpaper behind the app in the hero.
// The main cable is a parabola between the tower tops; the vertical
// suspenders are computed from it so they meet the cable exactly.
import fs from "node:fs";

const W = 1600, H = 1000;
const LIFT = 200; // the scene sits high, leaving open water below for the app window
const DECK = 590, WATER = 668;
const TOWERS = [520, 1080];
const TOP = 268; // tower top
const SADDLE = TOP + 2; // the cables rest on the top crossbeam
const SAG = 572; // lowest point of the main cable, mid-span
const f = (n) => Math.round(n * 10) / 10;

// Quadratic Bezier through both tower tops whose midpoint sits at SAG.
const ctrlY = 2 * SAG - SADDLE;
const cableAt = (x) => {
  const t = (x - TOWERS[0]) / (TOWERS[1] - TOWERS[0]);
  return (1 - t) ** 2 * SADDLE + 2 * (1 - t) * t * ctrlY + t ** 2 * SADDLE;
};

let suspenders = "";
for (let x = TOWERS[0] + 18; x < TOWERS[1] - 10; x += 18) suspenders += `<line x1="${x}" y1="${f(cableAt(x))}" x2="${x}" y2="${DECK}"/>`;
// Side spans hang from the tower tops down to the anchorages at each shore.
const side = (x0, x1) => {
  const cx = (x0 + x1) / 2, cy = SADDLE + (DECK - 8 - SADDLE) * 0.78;
  let lines = "";
  const step = x1 > x0 ? 18 : -18;
  for (let x = x0 + step; Math.abs(x - x1) > 30; x += step) {
    const t = (x - x0) / (x1 - x0);
    const y = (1 - t) ** 2 * SADDLE + 2 * (1 - t) * t * cy + t ** 2 * (DECK - 8);
    lines += `<line x1="${x}" y1="${f(y)}" x2="${x}" y2="${DECK}"/>`;
  }
  return { path: `M${x0} ${SADDLE} Q${f(cx)} ${f(cy)} ${x1} ${DECK - 8}`, lines };
};
const left = side(TOWERS[0], 150), right = side(TOWERS[1], 1450);

// An Art Deco tower: two tapering legs tied by portal struts.
const tower = (x) => {
  const legs = [-34, 20].map((dx) => `<path d="M${x + dx} ${TOP - 6} h14 l3 ${WATER - TOP + 16} h-20 z" fill="url(#steel)"/>`).join("");
  const struts = [TOP + 22, TOP + 92, TOP + 170, TOP + 252].map((y, i) => `<rect x="${x - 22}" y="${y}" width="44" height="${i === 0 ? 16 : 11}" fill="#a8341f"/>`).join("");
  // Solid top crossbeam the cables pass over, with the leg caps above it.
  const caps = `<rect x="${x - 36}" y="${TOP - 8}" width="72" height="22" fill="#b83c26"/><rect x="${x - 39}" y="${TOP - 16}" width="24" height="10" rx="2" fill="#c8452b"/><rect x="${x + 15}" y="${TOP - 16}" width="24" height="10" rx="2" fill="#c8452b"/>`;
  const base = `<rect x="${x - 46}" y="${WATER - 6}" width="92" height="22" rx="3" fill="#6f8fb8"/>`;
  return base + legs + struts + caps;
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2c74f0"/><stop offset=".18" stop-color="#5a9cf7"/><stop offset=".33" stop-color="#9fcbff"/><stop offset=".42" stop-color="#d6ebff"/>
  </linearGradient>
  <radialGradient id="sun" cx=".78" cy=".08" r=".4"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6aa3e8"/><stop offset=".35" stop-color="#3f7fd6"/><stop offset="1" stop-color="#1f56b0"/></linearGradient>
  <linearGradient id="steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d2502f"/><stop offset=".55" stop-color="#c0432a"/><stop offset="1" stop-color="#93311f"/></linearGradient>
  <linearGradient id="farhill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8db6e6"/><stop offset="1" stop-color="#b9d6f5"/></linearGradient>
  <linearGradient id="nearhill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f7fbf"/><stop offset="1" stop-color="#6e98cf"/></linearGradient>
  <filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="16"/></filter>
  <filter id="softer" x="-20%" y="-80%" width="140%" height="260%"><feGaussianBlur stdDeviation="28"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<rect width="${W}" height="${H}" fill="url(#sun)"/>
<g transform="translate(0 -${LIFT})">
<!-- far headlands -->
<path d="M0 560 C120 470 230 455 330 500 C420 540 470 548 560 600 L0 640 Z" fill="url(#farhill)"/>
<path d="M980 610 C1090 520 1230 470 1350 488 C1460 505 1540 540 ${W} 520 L${W} 650 L980 650 Z" fill="url(#farhill)"/>
<!-- high fog behind the bridge -->
<g filter="url(#softer)" fill="#fff" opacity=".85">
  <ellipse cx="300" cy="575" rx="380" ry="46"/><ellipse cx="1240" cy="560" rx="420" ry="52"/><ellipse cx="800" cy="610" rx="520" ry="40"/>
</g>
<!-- near headlands -->
<path d="M0 600 C70 560 150 548 230 575 C290 595 330 620 380 668 L0 668 Z" fill="url(#nearhill)"/>
<path d="M1300 668 C1360 600 1450 572 1530 580 C1565 583 1585 590 ${W} 596 L${W} 668 Z" fill="url(#nearhill)"/>
<!-- water -->
<rect y="${WATER}" width="${W}" height="${H - WATER + LIFT}" fill="url(#sea)"/>
<g stroke="#ffffff" stroke-opacity=".28" stroke-width="2" stroke-linecap="round">
  <line x1="180" y1="712" x2="300" y2="712"/><line x1="640" y1="728" x2="820" y2="728"/><line x1="1040" y1="704" x2="1150" y2="704"/>
  <line x1="420" y1="770" x2="520" y2="770"/><line x1="1220" y1="760" x2="1380" y2="760"/><line x1="880" y1="812" x2="960" y2="812"/><line x1="120" y1="880" x2="260" y2="880"/><line x1="1300" y1="900" x2="1440" y2="900"/><line x1="560" y1="950" x2="700" y2="950"/><line x1="980" y1="1010" x2="1120" y2="1010"/><line x1="300" y1="1060" x2="420" y2="1060"/><line x1="1180" y1="1100" x2="1300" y2="1100"/>
</g>
<!-- the bridge -->
<g stroke="#b13b26" stroke-width="1.6" opacity=".9">${suspenders}${left.lines}${right.lines}</g>
<g fill="none" stroke="#c4442b" stroke-width="5" stroke-linecap="round">
  <path d="M${TOWERS[0]} ${SADDLE} Q800 ${f(ctrlY)} ${TOWERS[1]} ${SADDLE}"/><path d="${left.path}"/><path d="${right.path}"/>
</g>
${TOWERS.map(tower).join("")}
<rect x="40" y="${DECK}" width="${W - 80}" height="12" fill="#c0432a"/>
<rect x="40" y="${DECK + 12}" width="${W - 80}" height="8" fill="#8f2f1d"/>
<g stroke="#8f2f1d" stroke-width="3">${Array.from({ length: 6 }, (_, i) => `<line x1="${150 + i * 260}" y1="${DECK + 20}" x2="${150 + i * 260}" y2="${WATER}"/>`).join("")}</g>
<!-- low fog rolling under the deck -->
<g filter="url(#soft)" fill="#fff">
  <ellipse cx="230" cy="660" rx="330" ry="30" opacity=".9"/><ellipse cx="760" cy="676" rx="400" ry="26" opacity=".75"/><ellipse cx="1330" cy="664" rx="360" ry="30" opacity=".9"/>
</g>
</g>
</svg>
`;
fs.writeFileSync("website/golden-gate.svg", svg);
console.log(`wrote website/golden-gate.svg (${(svg.length / 1024).toFixed(1)} KB)`);
