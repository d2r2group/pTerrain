// Renders assets/mockup.png, the README's figure of the app in a browser on a phone, a tablet and
// a desktop. Each screen is a real screenshot of the built site, taken at the viewport the
// device's browser leaves below its status bar and toolbar; the chrome and frames are drawn in
// CSS and composited on a transparent background. Run `npm run build` and `npm run preview`
// first, then `npm run mockup`.

import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const SITE = process.env.MOCKUP_URL ?? "http://localhost:4173/";
const OUTPUT = new URL("../assets/mockup.png", import.meta.url).pathname;
const FAVICON = `data:image/svg+xml;base64,${readFileSync(new URL("../public/favicon.svg", import.meta.url)).toString("base64")}`;
const HOST = "pterrain.d2r2group.com";

/**
 * Screen size (CSS px), height of the browser chrome above the page, device pixel ratio, touch,
 * and the zoom that fits the screen into its frame in the figure.
 */
const DEVICES = {
  phone: { width: 390, height: 844, chrome: 110, scale: 3, mobile: true, zoom: 0.82 },
  tablet: { width: 820, height: 1180, chrome: 74, scale: 2, mobile: true, zoom: 0.6 },
  desktop: { width: 1512, height: 982, chrome: 82, scale: 2, mobile: false, zoom: 0.75 },
};

const browser = await chromium.launch();

const shots = {};
for (const [name, d] of Object.entries(DEVICES)) {
  const page = await browser.newPage({
    viewport: { width: d.width, height: d.height - d.chrome },
    deviceScaleFactor: d.scale,
    isMobile: d.mobile,
    hasTouch: d.mobile,
    colorScheme: "light",
  });
  await page.goto(SITE);
  // Lets the slice's axis transition settle.
  await page.waitForTimeout(1500);
  shots[name] = `data:image/png;base64,${(await page.screenshot()).toString("base64")}`;
  await page.close();
}

const icon = (d, size = 20, color = "currentColor", width = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const BACK = '<path d="M15 5l-7 7 7 7"/>';
const FORWARD = '<path d="M9 5l7 7-7 7"/>';
const RELOAD = '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>';
const LOCK =
  '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
const SHARE = '<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11v9h12v-9"/>';
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const TABS =
  '<rect x="7" y="7" width="13" height="13" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>';
const SIDEBAR = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>';
const STATUS_ICONS = `<svg width="68" height="13" viewBox="0 0 68 13" fill="#000">
  <rect x="0" y="8" width="3" height="5" rx="1"/><rect x="5" y="5.5" width="3" height="7.5" rx="1"/>
  <rect x="10" y="3" width="3" height="10" rx="1"/><rect x="15" y="0" width="3" height="13" rx="1"/>
  <path d="M30 2.5a10 10 0 0 1 7.5 3.2l-1.6 1.6a7.7 7.7 0 0 0-11.8 0l-1.6-1.6A10 10 0 0 1 30 2.5zm0 4.3a5.7 5.7 0 0 1 4.3 1.9L30 13l-4.3-4.3A5.7 5.7 0 0 1 30 6.8z"/>
  <rect x="42.5" y="0.5" width="22" height="12" rx="3.5" fill="none" stroke="#000" stroke-opacity=".4"/>
  <rect x="44.5" y="2.5" width="18" height="8" rx="2"/><path d="M66 4.5v4a2 2 0 0 0 0-4z" fill-opacity=".4"/>
</svg>`;
const AA = '<span class="aa"><small>A</small>A</span>';

const desktopChrome = `<div class="mac">
  <div class="tabs"><span class="lights"><i></i><i></i><i></i></span>
    <span class="tab"><img src="${FAVICON}">pTerrain<b>×</b></span><span class="newtab">${icon(PLUS, 16, "#4a4d51")}</span></div>
  <div class="bar">${icon(BACK, 18, "#4a4d51")}${icon(FORWARD, 18, "#b5b8bc")}${icon(RELOAD, 17, "#4a4d51")}
    <span class="omni">${icon(LOCK, 14, "#4a4d51")}${HOST}</span><span class="dot">⋮</span></div>
</div>`;

const tabletChrome = `<div class="ipad">
  <div class="status"><span>9:41&nbsp;&nbsp;Mon Oct 26</span>${STATUS_ICONS}</div>
  <div class="bar"><span class="group">${icon(SIDEBAR, 22, "#007aff")}${icon(BACK, 24, "#007aff")}${icon(FORWARD, 24, "#b5c9e8")}</span>
    <span class="field">${AA}<span class="host">${icon(LOCK, 12, "#000", 2.4)}${HOST}</span>${icon(RELOAD, 16, "#000")}</span>
    <span class="group">${icon(SHARE, 22, "#007aff")}${icon(PLUS, 22, "#007aff")}${icon(TABS, 22, "#007aff")}</span></div>
</div>`;

const phoneChrome = `<div class="iphone">
  <div class="status"><span>9:41</span>${STATUS_ICONS}</div>
  <div class="bar"><span class="field">${AA}<span class="host">${icon(LOCK, 12, "#000", 2.4)}${HOST}</span>${icon(RELOAD, 17, "#000")}</span></div>
</div>`;

const screen = (name, chrome) => {
  const d = DEVICES[name];
  return `<div class="native" style="width:${d.width}px;height:${d.height}px;zoom:${d.zoom}">${chrome}<img src="${shots[name]}" style="width:${d.width}px;height:${d.height - d.chrome}px"></div>`;
};

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent}
.stage{position:relative;width:1600px;height:1000px;font-family:-apple-system,"Helvetica Neue",Helvetica,sans-serif}
.native{background:#fff;overflow:hidden}
.native>img{display:block}
svg{flex:none;display:block}
.monitor{position:absolute;left:150px;top:20px;padding:22px;background:#1c1c1e;border-radius:26px;box-shadow:0 30px 60px rgba(0,0,0,.28),inset 0 0 0 2px #3a3a3c}
.monitor .screen{border-radius:6px;overflow:hidden}
.monitor::after{content:"";position:absolute;left:50%;bottom:-130px;transform:translateX(-50%);width:200px;height:130px;background:linear-gradient(#b9bcc2,#9a9ea6);clip-path:polygon(18% 0,82% 0,92% 100%,8% 100%)}
.base{position:absolute;left:549px;top:930px;width:380px;height:18px;border-radius:9px 9px 4px 4px;background:linear-gradient(#c9ccd1,#8e9299);box-shadow:0 14px 24px rgba(0,0,0,.25)}
.tablet{position:absolute;right:40px;top:200px;padding:24px;background:#1c1c1e;border-radius:44px;box-shadow:0 30px 60px rgba(0,0,0,.35),inset 0 0 0 2px #3a3a3c}
.tablet .screen{border-radius:20px;overflow:hidden}
.phone{position:absolute;left:40px;top:270px;padding:13px;background:#1c1c1e;border-radius:56px;box-shadow:0 30px 60px rgba(0,0,0,.4),inset 0 0 0 2px #3a3a3c}
.phone .screen{position:relative;border-radius:44px;overflow:hidden}
.island{position:absolute;top:9px;left:50%;transform:translateX(-50%);width:103px;height:30px;border-radius:15px;background:#000}

.mac{height:82px;box-sizing:border-box;border-bottom:1px solid #d7d9dc}
.mac .tabs{height:40px;background:#dfe3e8;display:flex;align-items:flex-end;padding-left:12px}
.mac .lights{display:flex;gap:8px;align-self:center;margin-right:18px}
.mac .lights i{width:12px;height:12px;border-radius:50%;background:#ff5f57}
.mac .lights i:nth-child(2){background:#febc2e}.mac .lights i:nth-child(3){background:#28c840}
.mac .tab{height:32px;width:220px;background:#fff;border-radius:10px 10px 0 0;display:flex;align-items:center;gap:8px;padding:0 12px;box-sizing:border-box;font-size:12.5px;color:#1f1f1f}
.mac .tab img{width:16px;height:16px}.mac .tab b{margin-left:auto;font-weight:400;color:#5f6368;font-size:15px}
.mac .newtab{align-self:center;margin-left:10px}
.mac .bar{height:41px;display:flex;align-items:center;gap:16px;padding:0 14px}
.mac .omni{flex:1;height:30px;border-radius:15px;background:#edf0f3;display:flex;align-items:center;gap:10px;padding:0 14px;font-size:14px;color:#1f1f1f}
.mac .dot{color:#4a4d51;font-size:18px;font-weight:700}

.status{display:flex;align-items:center;justify-content:space-between;font-weight:600;color:#000}
.field{display:flex;align-items:center;background:#eeeef0;border-radius:12px;color:#000;box-sizing:border-box}
.field .host{flex:1;display:flex;align-items:center;justify-content:center;gap:5px}
.aa{font-weight:600;font-size:17px;letter-spacing:-.5px}.aa small{font-size:12px}

.ipad{height:74px;border-bottom:1px solid #d9d9dc;box-sizing:border-box;background:#f9f9f9}
.ipad .status{height:24px;padding:0 22px;font-size:13px}
.ipad .bar{height:49px;display:flex;align-items:center;justify-content:space-between;padding:0 18px}
.ipad .group{display:flex;gap:22px;width:160px}.ipad .group:last-child{justify-content:flex-end}
.ipad .field{width:400px;height:36px;padding:0 12px;font-size:15px;border-radius:10px}

.iphone{height:110px;background:#f9f9f9;border-bottom:1px solid #d9d9dc;box-sizing:border-box}
.iphone .status{height:54px;padding:4px 30px 0 50px;font-size:17px;box-sizing:border-box}
.iphone .bar{height:55px;display:flex;align-items:center;padding:0 12px}
.iphone .field{flex:1;height:44px;padding:0 14px;font-size:16px}
</style></head><body><div class="stage">
<div class="monitor"><div class="screen">${screen("desktop", desktopChrome)}</div></div><div class="base"></div>
<div class="tablet"><div class="screen">${screen("tablet", tabletChrome)}</div></div>
<div class="phone"><div class="screen">${screen("phone", phoneChrome)}<div class="island"></div></div></div>
</div></body></html>`;

const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1.5,
});
await page.setContent(html, { waitUntil: "load" });
await page.locator(".stage").screenshot({ path: OUTPUT, omitBackground: true });
await browser.close();
console.log(`Wrote ${OUTPUT}`);
