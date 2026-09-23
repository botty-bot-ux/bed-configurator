// build-layers.mjs — раскладывает реальный фоторендер дивана на слои-спрайты
// для PixiJS-конфигуратора (base/silhouette/zones/ao/sheen/details + per-material
// sheens + бесшовные тайлы тканей). Только Node + sharp, без ML-сегментации:
// фон убирается flood-fill'ом от границ, зоны режутся геометрически по bbox силуэта.
//
// Запуск:  node scripts/build-layers.mjs [path/to/render.png]
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'sofa');
const SRC_FAB = path.join(ROOT, 'assets_src', 'fabrics');

const W = 1024;
const H = 1024;

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
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += srcArr[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      acc += srcArr[row + clamp(x + r + 1, 0, w - 1)] - srcArr[row + clamp(x - r, 0, w - 1)];
    }
  }
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
  mkdirSync(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width: w, height: h, channels: 4 },
  })
    .png()
    .toFile(file);
}

/* ----------------------------- загрузка ----------------------------- */
const { data } = await sharp(src)
  .resize(W, H, { fit: 'fill' }) // исходный рендер квадратный 1024×1024 — fit без искажений
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const N = W * H;
const rgb = data; // RGB, 3 канала
console.log(`src=${path.relative(ROOT, src)} -> ${W}x${H}`);

/* ------------------- 1. удаление фона (flood-fill) ------------------- */
// Фон = почти-белые пиксели, СВЯЗНЫЕ с границей кадра. Interior-блики внутри
// дивана не считаются фоном, поэтому дырок в base нет.
const SEED_MIN = 246; // «почти чистый белый» для старта с границы
const GROW_MIN = 222; // светлее затопляем (ловим мягкую тень под диваном), темнее — граница

const minCh = new Float32Array(N);
for (let i = 0; i < N; i++) {
  minCh[i] = Math.min(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
}

const bg = new Uint8Array(N);
const stack = new Int32Array(N);
let sp = 0;
const push = (i) => { if (!bg[i]) { bg[i] = 1; stack[sp++] = i; } };
for (let x = 0; x < W; x++) {
  if (minCh[x] >= SEED_MIN) push(x);
  if (minCh[(H - 1) * W + x] >= SEED_MIN) push((H - 1) * W + x);
}
for (let y = 0; y < H; y++) {
  const l = y * W, r = y * W + (W - 1);
  if (minCh[l] >= SEED_MIN) push(l);
  if (minCh[r] >= SEED_MIN) push(r);
}
while (sp > 0) {
  const i = stack[--sp];
  const x = i % W, y = (i / W) | 0;
  if (x > 0 && !bg[i - 1] && minCh[i - 1] >= GROW_MIN) push(i - 1);
  if (x < W - 1 && !bg[i + 1] && minCh[i + 1] >= GROW_MIN) push(i + 1);
  if (y > 0 && !bg[i - W] && minCh[i - W] >= GROW_MIN) push(i - W);
  if (y < H - 1 && !bg[i + W] && minCh[i + W] >= GROW_MIN) push(i + W);
}

let fgA = new Float32Array(N);
for (let i = 0; i < N; i++) fgA[i] = bg[i] ? 0 : 1;
fgA = boxBlur(fgA, W, H, 1); // feather ~1px
for (let i = 0; i < N; i++) fgA[i] = clamp((fgA[i] - 0.12) / 0.78, 0, 1);

// bbox + средняя яркость по силуэту
let x0 = W, y0 = H, x1 = 0, y1 = 0, fgCount = 0, lumSum = 0;
const L = new Float32Array(N);
const SAT = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
  L[i] = lum(r, g, b);
  SAT[i] = Math.max(r, g, b) - Math.min(r, g, b);
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
// Мягкая гамма-кривая затемняет светлые тона базы: blend 'color' наследует
// яркость базы, поэтому более тёмная база даёт сочнее перекраску (меньше пастели).
{
  const GAMMA = 1.32;
  const rgba = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const g = Math.round(255 * Math.pow(L[i] / 255, GAMMA));
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

/* ----------------------------- 3. зоны (упразднены) ----------------------------- */
// Цветовые зоны по деталям убраны: перекраска теперь одна на весь корпус —
// движок красит base через silhouette (blend 'color'). Отдельные маски зон не нужны.

/* --------------------------- 4. ao.png (multiply) --------------------------- */
{
  let a = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (fgA[i] < 0.5) { a[i] = 0; continue; }
    const d = (meanL - L[i]) / Math.max(1, meanL);
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

/* ------------------- 5. sheen.png + per-material sheens (screen) ------------------- */
// Базовая карта блика: белый + альфа там, где яркость ВЫШЕ среднего.
let sheenBase;
{
  let a = new Float32Array(N);
  const hi = 255 - meanL;
  for (let i = 0; i < N; i++) {
    if (fgA[i] < 0.5) { a[i] = 0; continue; }
    const d = (L[i] - meanL) / Math.max(1, hi);
    a[i] = clamp(d * 2.6, 0, 1) * fgA[i] * 0.9;
  }
  sheenBase = boxBlur(a, W, H, 2);
}
async function writeSheen(arr, file) {
  const rgba = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = Math.round(clamp(arr[i], 0, 1) * 255);
  }
  await saveRGBA(rgba, W, H, file);
}
const scaleArr = (arr, k) => { const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = clamp(arr[i] * k, 0, 1); return o; };
const powArr = (arr, p) => { const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = clamp(Math.pow(arr[i], p), 0, 1); return o; };

await writeSheen(sheenBase, path.join(OUT, 'sheen.png'));
// материал → характер блика (все выровнены по реальному рендеру)
await writeSheen(boxBlur(sheenBase, W, H, 5), path.join(OUT, 'sheens', 'velour.png'));      // широкое мягкое свечение
await writeSheen(scaleArr(sheenBase, 0.4), path.join(OUT, 'sheens', 'linen.png'));           // почти без блика
await writeSheen(boxBlur(powArr(sheenBase, 2.0), W, H, 1), path.join(OUT, 'sheens', 'leather.png')); // узкие specular-искры
await writeSheen(boxBlur(scaleArr(sheenBase, 0.8), W, H, 3), path.join(OUT, 'sheens', 'boucle.png')); // рассеянный

/* --------------------- 6. details.png: возврат цвета ножек --------------------- */
// Ткань почти обесцвечена (низкая насыщенность), а деревянные ножки — насыщенные.
// details = исходный цвет там, где насыщенность высокая (ножки/акценты), иначе пусто.
// Слой идёт normal поверх → ножки не перекрашиваются tint'ом зон.
{
  const SAT_MIN = 26;
  let a = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (fgA[i] < 0.4) { a[i] = 0; continue; }
    a[i] = clamp((SAT[i] - SAT_MIN) / 40, 0, 1) * fgA[i];
  }
  a = boxBlur(a, W, H, 1);
  const rgba = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = Math.round(clamp(a[i], 0, 1) * 255);
  }
  await saveRGBA(rgba, W, H, path.join(OUT, 'details.png'));
}

/* --------------------- 7. ткани: сделать тайлами и разложить --------------------- */
// roll на полпиксела (центральный шов уходит на края) + кроссфейд краёв → tileable.
async function makeFabricTile(inPath, outPath, size = 512) {
  if (!existsSync(inPath)) { console.log('  (пропуск, нет исходника)', path.basename(inPath)); return; }
  const { data: raw, info } = await sharp(inPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;
  const rolled = new Float64Array(w * h * ch);
  const rx = w >> 1, ry = h >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = (x + rx) % w, sy = (y + ry) % h;
    for (let c = 0; c < ch; c++) rolled[(y * w + x) * ch + c] = raw[(sy * w + sx) * ch + c];
  }
  const out = Float64Array.from(rolled);
  const b = Math.max(16, Math.floor(Math.min(w, h) * 0.14));
  for (let x = w - b; x < w; x++) { // правая полоса → левая
    const u = (x - (w - b)) / (b - 1);
    for (let y = 0; y < h; y++) for (let c = 0; c < ch; c++) {
      const i = (y * w + x) * ch + c, j = (y * w + (x - (w - b))) * ch + c;
      out[i] = rolled[i] * (1 - u) + rolled[j] * u;
    }
  }
  for (let y = h - b; y < h; y++) { // нижняя полоса → верхняя
    const u = (y - (h - b)) / (b - 1);
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
      const i = (y * w + x) * ch + c, j = ((y - (h - b)) * w + x) * ch + c;
      out[i] = out[i] * (1 - u) + out[j] * u;
    }
  }
  const u8 = new Uint8ClampedArray(w * h * ch);
  // Нормализуем средний уровень тайла к нейтральному 127: тогда soft-light/overlay
  // дают контраст плетения, но не выбеливают и не обесцвечивают перекраску.
  if (ch >= 3) {
    let mean = 0;
    for (let i = 0; i < w * h; i++) {
      const o = i * ch;
      mean += 0.2126 * out[o] + 0.7152 * out[o + 1] + 0.0722 * out[o + 2];
    }
    mean /= w * h;
    const gain = 127 / Math.max(1, mean);
    for (let i = 0; i < out.length; i++) out[i] *= gain;
  }
  for (let i = 0; i < u8.length; i++) u8[i] = out[i];
  await sharp(Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength), { raw: { width: w, height: h, channels: ch } })
    .resize(size, size, { fit: 'cover' })
    .png()
    .toFile(outPath);
  console.log('  tile →', path.relative(ROOT, outPath));
}
for (const name of ['velour', 'linen']) {
  await makeFabricTile(path.join(SRC_FAB, `${name}.png`), path.join(OUT, 'fabrics', `${name}.png`));
}

console.log('done: base, silhouette, ao, sheen(+velour/linen/leather/boucle), details, fabrics{velour,linen}');
