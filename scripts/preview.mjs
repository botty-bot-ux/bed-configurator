// preview.mjs — офлайн-реконструкция итоговой сцены кровати (стек слоёв Pixi) через sharp,
// чтобы получить PNG результата без браузера. Стек без зон:
//   background → base → color (единая перекраска корпуса: L из базы + H/S цвета, по маске силуэта)
//            → ткань (blend материала, по силуэту) → ao (multiply) → sheen (screen).
// Дефолты читаются из манифеста, чтобы превью совпадало с приложением.
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const S = (p) => path.join(ROOT, 'public', 'bed', p);

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'public', 'beds', 'default', 'manifest.json'), 'utf8'));
const W = manifest.width, H = manifest.height;
const N = W * H;

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function hexHsl(hex) {
  let h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let hh = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) hh = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh /= 6;
  }
  return [hh, s];
}
function hsl2rgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
async function raw(file) {
  const { data } = await sharp(file).resize(W, H).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
}
const toBuf = (u8) => sharp(Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength), { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();

const panel = (id) => manifest.panels.find((p) => p.id === id)?.default ?? 1;

const base = await raw(S('base.png'));
const sil = await raw(S('silhouette.png'));

// base поверх прозрачного — несём RGB+альфу рендера изделия
const bed = Buffer.from(base);

// единая перекраска корпуса: L из базы, H/S из цвета, покрытие = альфа силуэта * интенсивность цвета
const colorHex = manifest.color;
const colorOpacity = panel('color');
if (colorHex && colorOpacity > 0) {
  const [hh, ss] = hexHsl(colorHex);
  for (let i = 0; i < N; i++) {
    const za = (sil[i * 4 + 3] / 255) * colorOpacity;
    if (za <= 0) continue;
    const L = lum(base[i * 4], base[i * 4 + 1], base[i * 4 + 2]) / 255;
    const [r, g, b] = hsl2rgb(hh, ss, L);
    bed[i * 4] = bed[i * 4] * (1 - za) + r * za;
    bed[i * 4 + 1] = bed[i * 4 + 1] * (1 - za) + g * za;
    bed[i * 4 + 2] = bed[i * 4 + 2] * (1 - za) + b * za;
  }
}
const bedBuf = await toBuf(bed);

// ткань: затайлить, обрезать по силуэту, понизить альфу до силы материала
const material = manifest.materials[0];
const fabOpacity = material.strength ?? panel('fabric');
let fabricBuf = null;
if (material.fabric) {
  const fab = new Uint8ClampedArray(await raw(S(`fabrics/${material.id}.png`)));
  for (let i = 0; i < N; i++) fab[i * 4 + 3] = Math.round((fab[i * 4 + 3] / 255) * (sil[i * 4 + 3] / 255) * fabOpacity * 255);
  fabricBuf = await toBuf(fab);
}

// ao (multiply) и sheen (screen *opacity)
const aoBuf = await sharp(S('ao.png')).resize(W, H).png().toBuffer();
const sheenOpacity = material.sheenOpacity ?? panel('sheen');
const sheen = new Uint8ClampedArray(await raw(S('sheen.png')));
for (let i = 0; i < N; i++) sheen[i * 4 + 3] = Math.round((sheen[i * 4 + 3] / 255) * sheenOpacity * 255);
const sheenBuf = await toBuf(sheen);

// сцена: фон-комната вниз, затем слои изделия
const layers = [{ input: bedBuf, blend: 'over' }];
if (fabricBuf) layers.push({ input: fabricBuf, blend: material.blend || 'soft-light' });
layers.push({ input: aoBuf, blend: 'multiply' });
layers.push({ input: sheenBuf, blend: 'screen' });

const bgInput = manifest.layers.background
  ? await sharp(S('background.png')).resize(W, H).png().toBuffer()
  : await sharp({ create: { width: W, height: H, channels: 3, background: { r: 238, g: 241, b: 245 } } }).png().toBuffer();

await sharp(bgInput)
  .composite(layers)
  .png()
  .toFile(path.join(ROOT, 'outputs', 'bed-final-preview.png'));

console.log(`wrote outputs/bed-final-preview.png (color=${colorHex ?? 'off'}, material=${material.id})`);
