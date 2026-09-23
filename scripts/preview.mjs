// preview.mjs — офлайн-реконструкция итоговой сцены (стек слоёв Pixi) через sharp,
// чтобы получить PNG-скриншот результата без браузера.
// base → зоны(color-blend) → ткань(soft-light, по силуэту) → ao(multiply) → sheen(screen).
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const S = (p) => path.join(ROOT, 'public', 'sofa', p);
const W = 900, H = 520;

// цвета зон = DEFAULT_COLORS из App.jsx
const ZONE_COLORS = { back: '#1c5bd0', seat: '#2b6fe0', arms: '#1c5bd0', pillows: '#f08c00' };
const FABRIC = 'fabrics/velour.png', FABRIC_STRENGTH = 0.9;
const SHEEN_OPACITY = 0.35;

/* ---- цвет: hex → hsl → перекраска с сохранением яркости базы (blend 'color') ---- */
function hexHsl(hex) {
  let h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let hh = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) hh = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh /= 6;
  }
  return [hh, s, l];
}
function hsl2rgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

async function raw(file) {
  const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
}

const base = await raw(S('base.png'));
const out = Buffer.from(base); // RGBA копия

// применяем зоны (color blend): L из базы, H/S из цвета
for (const [name, hex] of Object.entries(ZONE_COLORS)) {
  const z = await raw(S(`zones/${name}.png`));
  const [hh, ss] = hexHsl(hex);
  for (let i = 0; i < W * H; i++) {
    const za = z[i * 4 + 3] / 255;
    if (za <= 0) continue;
    const L = lum(base[i * 4], base[i * 4 + 1], base[i * 4 + 2]) / 255;
    const [r, g, b] = hsl2rgb(hh, ss, L);
    out[i * 4] = out[i * 4] * (1 - za) + r * za;
    out[i * 4 + 1] = out[i * 4 + 1] * (1 - za) + g * za;
    out[i * 4 + 2] = out[i * 4 + 2] * (1 - za) + b * za;
  }
}

// слой-источник с альфой базы (силуэт)
const sofaBuf = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();

// ткань: затайлить, обрезать по силуэту, понизить альфу до силы
const sil = await raw(S('silhouette.png'));
const fab = new Uint8ClampedArray(await (await sharp(FABRIC ? S(FABRIC) : S('fabrics/velour.png')).resize(W, H, { fit: 'cover' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data);
for (let i = 0; i < W * H; i++) fab[i * 4 + 3] = Math.round((fab[i * 4 + 3] / 255) * (sil[i * 4 + 3] / 255) * FABRIC_STRENGTH * 255);
const fabricBuf = await sharp(fab, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();

// ao (multiply) и sheen (screen, *opacity)
const aoBuf = await sharp(S('ao.png')).png().toBuffer();
const sheen = new Uint8ClampedArray(await raw(S('sheen.png')));
for (let i = 0; i < W * H; i++) sheen[i * 4 + 3] = Math.round((sheen[i * 4 + 3] / 255) * SHEEN_OPACITY * 255);
const sheenBuf = await sharp(sheen, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();

// фон страницы + слои
const bg = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 238, g: 241, b: 245 } } }).png().toBuffer();
await sharp(bg)
  .composite([
    { input: sofaBuf, blend: 'over' },
    { input: fabricBuf, blend: 'soft-light' },
    { input: aoBuf, blend: 'multiply' },
    { input: sheenBuf, blend: 'screen' },
  ])
  .png()
  .toFile(path.join(ROOT, 'outputs', 'sofa-final-preview.png'));

console.log('wrote outputs/sofa-final-preview.png');
