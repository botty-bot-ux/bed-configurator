// build-layers.mjs — раскладывает реальный фоторендер дивана на слои-спрайты
// для PixiJS-конфигуратора (base/silhouette/zones/ao/sheen/details).
// Только Node + sharp, без ML-сегментации: фон убирается flood-fill'ом от границ,
// зоны режутся геометрически по bounding box силуэта.
//
// Запуск:  node scripts/build-layers.mjs [path/to/render.png]
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'sofa');

const W = 900;
const H = 520;

const src = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'assets_src', 'render.png');

/* ----------------------------- утилиты ----------------------------- */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Разделимая свёртка box-blur по одноканальному Float32Array (радиус r).
function boxBlur(srcArr, w, h, r) {
  if (r <= 0) return srcArr.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = r * 2 + 1;
  // горизонтально
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += srcArr[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      acc += srcArr[row + clamp(x + r + 1, 0, w - 1)] - srcArr[row + clamp(x - r, 0, w - 1)];
    }
  }
  // вертикально
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

// Сохраняет RGBA-буфер как PNG (с альфой).
async function saveRGBA(rgba, w, h, file) {
  await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width: w, height: h, channels: 4 },
  })
    .png()
    .toFile(file);
}

/* ----------------------------- загрузка ----------------------------- */

const { data, info } = await sharp(src)
  .resize(W, H, { fit: 'fill' }) // незначительное сжатие по вертикали (16:9 → 900×520)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const N = W * H;
const rgb = data; // RGB, 3 канала
console.log(`src=${path.relative(ROOT, src)} -> ${W}x${H}`);

/* ------------------- 1. удаление фона (flood-fill) ------------------- */
// Фон = почти-белые пиксели, СВЯЗНЫЕ с границей кадра. Interior-блики
// (ограниченные внутри дивана) не считаются фоном, поэтому дырок нет.

// Верхняя кромка дивана ~209-223, фон 253-255 → держим GROW_MIN между ними,
// чтобы flood не затёк в светлые блики подушек (иначе дырки в base).
const SEED_MIN = 246; // порог «почти чистый белый» для старта с границы
const GROW_MIN = 234; // светлее затопляем, темнее — граница силуэта

const minCh = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
  minCh[i] = Math.min(r, g, b);
}

const bg = new Uint8Array(N); // 1 = фон
const stack = new Int32Array(N);
let sp = 0;
const push = (i) => { if (!bg[i]) { bg[i] = 1; stack[sp++] = i; } };
// старт со всех пикселей границы, если они почти-белые
for (let x = 0; x < W; x++) {
  if (minCh[x] >= SEED_MIN) push(x);
  if (minCh[(H - 1) * W + x] >= SEED_MIN) push((H - 1) * W + x);
}
for (let y = 0; y < H; y++) {
  const l = y * W, rr = y * W + (W - 1);
  if (minCh[l] >= SEED_MIN) push(l);
  if (minCh[rr] >= SEED_MIN) push(rr);
}
// BFS 4-связности
while (sp > 0) {
  const i = stack[--sp];
  const x = i % W, y = (i / W) | 0;
  if (x > 0 && !bg[i - 1] && minCh[i - 1] >= GROW_MIN) push(i - 1);
  if (x < W - 1 && !bg[i + 1] && minCh[i + 1] >= GROW_MIN) push(i + 1);
  if (y > 0 && !bg[i - W] && minCh[i - W] >= GROW_MIN) push(i - W);
  if (y < H - 1 && !bg[i + W] && minCh[i + W] >= GROW_MIN) push(i + W);
}

// fg-альфа = 1-фон, с лёгким feather (blur) для мягкого края
let fgA = new Float32Array(N);
for (let i = 0; i < N; i++) fgA[i] = bg[i] ? 0 : 1;
fgA = boxBlur(fgA, W, H, 1); // feather ~1px
// нормализуем: поднимаем значения ядра до 1, чтобы тело не полупрозрачнело
for (let i = 0; i < N; i++) fgA[i] = clamp((fgA[i] - 0.12) / 0.78, 0, 1);

// bounding box силуэта по fg-пикселям (alpha > 0.5)
let x0 = W, y0 = H, x1 = 0, y1 = 0, fgCount = 0, lumSum = 0;
const L = new Float32Array(N);
for (let i = 0; i < N; i++) {
  L[i] = lum(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  if (fgA[i] > 0.5) {
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    fgCount++; lumSum += L[i];
  }
}
const bw = x1 - x0, bh = y1 - y0;
const meanL = lumSum / Math.max(1, fgCount);
console.log(`bbox x[${x0}..${x1}] y[${y0}..${y1}] w=${bw} h=${bh}  meanLum=${meanL.toFixed(1)}  fg=${fgCount}`);

/* ------------------------- 2. base.png (grayscale) ------------------------- */
{
  const rgba = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const g = Math.round(L[i]); // яркость = реальная светотень
    rgba[i * 4] = g; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = g;
    rgba[i * 4 + 3] = Math.round(fgA[i] * 255);
  }
  await saveRGBA(rgba, W, H, path.join(OUT, 'base.png'));
}

/* ---------------------- silhouette.png (белый + альфа) ---------------------- */
{
  const rgba = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = Math.round(fgA[i] * 255);
  }
  await saveRGBA(rgba, W, H, path.join(OUT, 'silhouette.png'));
}

/* ----------------------------- 3. зоны ----------------------------- */
// Нормализованные координаты внутри bbox дивана: fx,fy ∈ [0,1].
// Зоны не пересекаются (разрез по горизонтали + боковые колонки), затем
// каждая обрезается по fg-альфе и получает мягкий feather.
//
//   pillows : верхняя мелкая полоска спинки      fy < 0.22
//   back    : спинка/подушки                      0.22 ≤ fy < 0.50
//   seat    : сиденье                             0.50 ≤ fy < 0.68
//   arms    : левая+правая колонки подлокотников (fx<0.14 | fx>0.86) & 0.28≤fy<0.82

const ZONES = {
  pillows: (fx, fy) => fy < 0.22,
  back:    (fx, fy) => fy >= 0.22 && fy < 0.50,
  seat:    (fx, fy) => fy >= 0.50 && fy < 0.68,
  arms:    (fx, fy) => (fx < 0.14 || fx > 0.86) && fy >= 0.28 && fy < 0.82,
};

const FEATHER = 3;
for (const [name, fn] of Object.entries(ZONES)) {
  // бинарная область
  let a = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i / W) | 0;
    const fx = (x - x0) / bw, fy = (y - y0) / bh;
    a[i] = fn(fx, fy) ? 1 : 0;
  }
  a = boxBlur(a, W, H, FEATHER);            // мягкий край зоны
  const rgba = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const alpha = clamp(a[i], 0, 1) * fgA[i]; // обрезаем по контуру
    rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = Math.round(alpha * 255);
  }
  await saveRGBA(rgba, W, H, path.join(OUT, 'zones', `${name}.png`));
}

/* --------------------------- 4. ao.png (multiply) --------------------------- */
// Чёрный + альфа там, где яркость НИЖЕ среднего по дивану (складки/щели).
{
  let a = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (fgA[i] < 0.5) { a[i] = 0; continue; }
    const d = (meanL - L[i]) / Math.max(1, meanL); // >0 в тёмных местах
    a[i] = clamp(d * 3.2, 0, 1) * fgA[i] * 0.85;
  }
  a = boxBlur(a, W, H, 2);
  const rgba = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    rgba[i * 4] = 0; rgba[i * 4 + 1] = 0; rgba[i * 4 + 2] = 0;
    rgba[i * 4 + 3] = Math.round(clamp(a[i], 0, 1) * 255);
  }
  await saveRGBA(rgba, W, H, path.join(OUT, 'ao.png'));
}

/* ------------------------- 5. sheen.png (screen) ------------------------- */
// Белый + альфа там, где яркость ВЫШЕ среднего (верхние блики).
{
  let a = new Float32Array(N);
  const hi = 255 - meanL;
  for (let i = 0; i < N; i++) {
    if (fgA[i] < 0.5) { a[i] = 0; continue; }
    const d = (L[i] - meanL) / Math.max(1, hi);
    a[i] = clamp(d * 2.6, 0, 1) * fgA[i] * 0.9;
  }
  a = boxBlur(a, W, H, 2);
  const rgba = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = Math.round(clamp(a[i], 0, 1) * 255);
  }
  await saveRGBA(rgba, W, H, path.join(OUT, 'sheen.png'));
}

/* ------------------------- 6. details.png (edges) ------------------------- */
// Тонкий кант по рёбрам яркости (Sobel-магнитуда) — белый с малой альфой.
{
  let a = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (fgA[i] < 0.5) continue;
      const tl = L[i - W - 1], t = L[i - W], tr = L[i - W + 1];
      const l = L[i - 1], r = L[i + 1];
      const bl = L[i + W - 1], b = L[i + W], br = L[i + W + 1];
      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const gy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      const mag = Math.sqrt(gx * gx + gy * gy);
      a[i] = clamp((mag - 26) / 90, 0, 1) * 0.5; // порог/сила канта
    }
  }
  a = boxBlur(a, W, H, 1);
  const rgba = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = Math.round(clamp(a[i], 0, 1) * 255);
  }
  await saveRGBA(rgba, W, H, path.join(OUT, 'details.png'));
}

console.log('done: base, silhouette, zones{pillows,back,seat,arms}, ao, sheen, details');
