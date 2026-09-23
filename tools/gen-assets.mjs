// Генератор ассетов-заглушек для демо SofaConfigurator (Pixi v8).
// Рисует синтетический диван послойно (base/silhouette/zones/ao/sheen/details)
// и три бесшовные ткани, кодирует всё в PNG (RGBA8) без внешних зависимостей.
// Запуск:  node tools/gen-assets.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'sofa');

/* ------------------------- PNG encoder (RGBA8) ------------------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// buf: {w,h,d:Float64Array(w*h*4)} значения 0..1 (straight alpha)
function writePNG(name, { w, h, d }) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = clamp01(d[i + 3]);
      // PNG straight (non-premultiplied) alpha: записываем исходные каналы
      raw[o++] = Math.round(clamp01(d[i]) * 255);
      raw[o++] = Math.round(clamp01(d[i + 1]) * 255);
      raw[o++] = Math.round(clamp01(d[i + 2]) * 255);
      raw[o++] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const path = join(OUT, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  return path;
}

/* --------------------------- helpers --------------------------- */
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function newBuf(w, h, fill = 0) {
  const d = new Float64Array(w * h * 4);
  if (fill) for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = fill; d[i + 3] = fill; }
  return { w, h, d };
}
function put(buf, x, y, r, g, b, a) {
  const i = (y * buf.w + x) * 4;
  buf.d[i] = r; buf.d[i + 1] = g; buf.d[i + 2] = b; buf.d[i + 3] = a;
}
// SDF скруглённого прямоугольника: p — точка, x0..y1 — границы, rr — радиус
function sdRoundBox(x, y, x0, y0, x1, y1, rr) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const bx = (x1 - x0) / 2, by = (y1 - y0) / 2;
  const qx = Math.abs(x - cx) - bx, qy = Math.abs(y - cy) - by;
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - rr;
}
// покрытие (0..1) сглаженное по SDF (1px кромка)
function cov(sd) { return clamp01(0.5 - sd); }
// эллипс (приближённый SDF)
function sdEllipse(x, y, cx, cy, rx, ry) {
  const nx = (x - cx) / rx, ny = (y - cy) / ry;
  return (Math.hypot(nx, ny) - 1) * Math.min(rx, ry);
}

/* ----------------------- геометрия дивана ----------------------- */
const W = 900, H = 520;
const BACK = [150, 60, 760, 300, 48];
const SEAT = [120, 250, 790, 410, 44];
const ARM_L = [70, 150, 205, 415, 52];
const ARM_R = [705, 150, 840, 415, 52];
const PIL_L = [350, 175, 95, 95];
const PIL_R = [610, 175, 95, 95];
const LEG_L = [165, 400, 200, 470];
const LEG_R = [712, 400, 747, 470];

function sofaCoverage(x, y) {
  let a = Math.max(cov(sdRoundBox(x, y, ...BACK)), cov(sdRoundBox(x, y, ...SEAT)));
  a = Math.max(a, cov(sdRoundBox(x, y, ...ARM_L)), cov(sdRoundBox(x, y, ...ARM_R)));
  a = Math.max(a, cov(sdEllipse(x, y, ...PIL_L)), cov(sdEllipse(x, y, ...PIL_R)));
  return a;
}

/* ---------------------------- слои ---------------------------- */
// base — серая светотень (несёт яркость), непрозрачен внутри силуэта
function makeBase() {
  const b = newBuf(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = sofaCoverage(x, y);
      if (a <= 0) { put(b, x, y, 0, 0, 0, 0); continue; }
      let L = 0.86 - 0.30 * (y / H);            // вертикальный градиент: верх светлее
      L += 0.06 * (1 - x / W) * (1 - y / H);     // лёгкий свет сверху-слева
      L -= 0.05 * Math.max(0, (x / W) - 0.5);    // правый край чуть темнее (объём)
      const v = clamp01(L);
      put(b, x, y, v, v, v, a);
    }
  }
  return b;
}
// silhouette — чисто белый контур (для маски)
function makeSilhouette() {
  const b = newBuf(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = sofaCoverage(x, y);
    put(b, x, y, 1, 1, 1, a);
  }
  return b;
}
// зона-маска: произвольная область → белый с нужным альфой-покрытием
function makeZone(fn) {
  const b = newBuf(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = fn(x, y);
    put(b, x, y, 1, 1, 1, a);
  }
  return b;
}
const inBack = (x, y) => Math.max(cov(sdRoundBox(x, y, ...BACK)),
  Math.max(cov(sdEllipse(x, y, ...PIL_L)) * 0, 0)); // спинка = блок спинки
const inSeat = (x, y) => cov(sdRoundBox(x, y, ...SEAT));
const inArms = (x, y) => Math.max(cov(sdRoundBox(x, y, ...ARM_L)), cov(sdRoundBox(x, y, ...ARM_R)));
const inPillows = (x, y) => Math.max(cov(sdEllipse(x, y, ...PIL_L)), cov(sdEllipse(x, y, ...PIL_R)));

// gaussian band helper (для AO/бликов): пик в position, ширина sigma
function band(v, center, sigma) { return Math.exp(-((v - center) ** 2) / (2 * sigma * sigma)); }

// ao — белая подложка, тёмные складки (multiply). Значение 1 = без изменения.
function makeAO() {
  const b = newBuf(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = sofaCoverage(x, y);
    let ao = 1.0;
    // тень под подушками на спинке
    ao -= 0.30 * band(y, 265, 34) * band(x, 350, 120) * inside;
    ao -= 0.30 * band(y, 265, 34) * band(x, 610, 120) * inside;
    // залом между сидушкой и спинкой
    ao -= 0.26 * band(y, 250, 22) * inside;
    // внутренние кромки подлокотников
    ao -= 0.22 * band(x, 205, 30) * band(y, 300, 90) * inside;
    ao -= 0.22 * band(x, 705, 30) * band(y, 300, 90) * inside;
    // тень у нижнего края
    ao -= 0.28 * band(y, 405, 26) * inside;
    const v = clamp01(ao);
    put(b, x, y, v, v, v, inside); // альфа = силуэт: вне дивана no-op (multiply не красит фон)
  }
  return b;
}
// sheen — чёрная подложка + мягкие блики (screen), альфа = силуэт
function makeSheen() {
  const b = newBuf(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = sofaCoverage(x, y);
    let s = 0;
    // блик по верхней кромке спинки
    s += 0.5 * band(y, 90, 40) * insideX(x, 150, 760);
    // верхние точки подушек
    s += 0.45 * Math.exp(-(((x - 330) ** 2 + (y - 140) ** 2) / (2 * 55 * 55)));
    s += 0.45 * Math.exp(-(((x - 590) ** 2 + (y - 140) ** 2) / (2 * 55 * 55)));
    // блик на передней кромке сидушки
    s += 0.30 * band(y, 300, 26) * insideX(x, 220, 700);
    const v = clamp01(s);
    put(b, x, y, v, v, v, inside); // screen: вне дивана alpha 0 → фон не трогается
  }
  return b;
}
function insideX(x, a, c) { return clamp01((x - a) * (c - x)) > 0 ? 1 : 0; }

// details — ножки + кант, не перекрашиваются (normal, поверх)
function makeDetails() {
  const b = newBuf(W, H);
  const legColor = [0.20, 0.13, 0.08];
  const legs = [LEG_L, LEG_R];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // ножки (каждая со своим диапазоном x для градиента объёма)
    let aLeg = 0, legT = 0;
    for (const [x0, , x1] of legs) {
      const c = cov(sdRoundBox(x, y, x0, 400, x1, 470, 6));
      if (c > aLeg) { aLeg = c; legT = (x - x0) / (x1 - x0); }
    }
    // кант — тонкая светлая линия по верху спинки и низу сидушки
    let piping = 0;
    piping = Math.max(piping, band(y, 62, 3) * insideX(x, 155, 755) * 0.9);
    piping = Math.max(piping, band(y, 408, 3) * insideX(x, 125, 785) * 0.7);
    const a = Math.max(aLeg, piping);
    if (a <= 0) { put(b, x, y, 0, 0, 0, 0); continue; }
    if (aLeg >= piping) {
      // градиент по ножке (объём): левый край светлее
      const g = 0.6 + 0.4 * (1 - clamp01(legT));
      put(b, x, y, legColor[0] * g, legColor[1] * g, legColor[2] * g, aLeg);
    } else {
      put(b, x, y, 0.92, 0.88, 0.80, piping * 0.85); // кант почти белый
    }
  }
  return b;
}

/* ------------------------- ткани (тайлы) ------------------------- */
// Бесшовные: все частоты — целые циклы на тайл, поэтому края совпадают.
function tile(fn, S = 256) {
  const b = newBuf(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const g = clamp01(fn(u, v));
    put(b, x, y, g, g, g, 1);
  }
  return b;
}
const TAU = Math.PI * 2;
function velour() {
  return tile((u, v) =>
    0.5 +
    0.05 * Math.sin(TAU * (14 * v)) +              // мягкий вертикальный ворс
    0.03 * Math.sin(TAU * (5 * u + 3 * v)) +
    0.04 * Math.sin(TAU * (3 * u)) * Math.sin(TAU * (4 * v)));
}
function linen() {
  return tile((u, v) => {
    const warp = 0.5 + 0.14 * Math.sign(Math.sin(TAU * 40 * u));
    const weft = 0.5 + 0.14 * Math.sign(Math.sin(TAU * 40 * v));
    const weave = ((Math.floor(40 * u) + Math.floor(40 * v)) % 2) === 0 ? warp : weft;
    return 0.5 + (weave - 0.5) * 0.8;
  });
}
function twill() {
  return tile((u, v) =>
    0.5 +
    0.16 * Math.sin(TAU * 16 * (u + v)) +          // диагональный рубчик
    0.06 * Math.sin(TAU * 32 * u) +
    0.06 * Math.sin(TAU * 32 * v));
}
// кожа — мелкая «галечная» фактура (низкоконтрастная, средняя серость)
function leather() {
  return tile((u, v) =>
    0.5 +
    0.05 * Math.sin(TAU * 22 * u) * Math.sin(TAU * 22 * v) +
    0.03 * Math.sin(TAU * (11 * u + 11 * v)) +
    0.02 * Math.sin(TAU * 44 * v));
}
// букле/рогожка — крупные «петли» (периодические бугорки)
function boucle() {
  return tile((u, v) => {
    const n = 10; // число петель на тайл
    const px = (u * n) % 1 - 0.5;
    const py = (v * n) % 1 - 0.5;
    const loop = Math.exp(-(px * px + py * py) / (2 * 0.16 * 0.16)); // бугорок
    return 0.46 + 0.16 * loop;
  });
}

/* --------------------- per-material sheen-карты --------------------- */
// Обобщённый блик: fn(x,y)→0..1 интенсивность, альфа = силуэт (иначе чёрный фон).
function makeSheenBaked(fn) {
  const b = newBuf(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = sofaCoverage(x, y);
    const v = clamp01(fn(x, y));
    put(b, x, y, v, v, v, inside);
  }
  return b;
}
const gauss = (x, y, cx, cy, s) => Math.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / (2 * s * s)));
// велюр: широкое мягкое свечение сверху + по подушкам
function sheenVelour() {
  return makeSheenBaked((x, y) =>
    0.45 * band(y, 95, 55) * insideX(x, 150, 760) +
    0.5 * gauss(x, y, 350, 165, 70) + 0.5 * gauss(x, y, 610, 165, 70) +
    0.25 * band(y, 300, 30) * insideX(x, 220, 700));
}
// кожа: редкие узкие specular-блики (отблески на изгибах)
function sheenLeather() {
  return makeSheenBaked((x, y) => {
    let s = 0.7 * gauss(x, y, 300, 120, 26) + 0.7 * gauss(x, y, 640, 130, 24);
    s += 0.55 * gauss(x, y, 200, 300, 20) + 0.55 * gauss(x, y, 720, 300, 20);
    s += 0.5 * band(y, 88, 12) * insideX(x, 160, 750); // тонкая кромка спинки
    return s;
  });
}
// лён: почти без блика — едва заметное ровное свечение
function sheenLinen() {
  return makeSheenBaked((x, y) => 0.12 * band(y, 110, 70) * insideX(x, 150, 760));
}
// букле: частые микро-искры по всей поверхности
function sheenBoucle() {
  return makeSheenBaked((x, y) => {
    const sp = 0.5 * (Math.sin(x * 0.9) * Math.sin(y * 0.9) + 1); // сетка искр
    return 0.35 * sp * band(y, 150, 160) + 0.25 * sp * insideX(x, 150, 760) * band(y, 300, 90);
  });
}

/* ------------------------------ run ------------------------------ */
const files = {
  'base.png': makeBase(),
  'silhouette.png': makeSilhouette(),
  'ao.png': makeAO(),
  'sheen.png': makeSheen(),
  'details.png': makeDetails(),
  'zones/back.png': makeZone((x, y) => Math.max(inBack(x, y), inPillows(x, y) ? 0 : 0)),
  'zones/seat.png': makeZone(inSeat),
  'zones/arms.png': makeZone(inArms),
  'zones/pillows.png': makeZone(inPillows),
  'fabrics/velour.png': velour(),
  'fabrics/linen.png': linen(),
  'fabrics/twill.png': twill(),
  'fabrics/leather.png': leather(),
  'fabrics/boucle.png': boucle(),
  'sheens/velour.png': sheenVelour(),
  'sheens/leather.png': sheenLeather(),
  'sheens/linen.png': sheenLinen(),
  'sheens/boucle.png': sheenBoucle(),
};
// Спинку не дублируем подушками: перерисуем back строго как блок спинки.
files['zones/back.png'] = makeZone((x, y) => cov(sdRoundBox(x, y, ...BACK)));

let n = 0;
for (const [name, buf] of Object.entries(files)) {
  const p = writePNG(name, buf);
  console.log('✓', p.replace(ROOT + '\\', ''), `${buf.w}×${buf.h}`);
  n++;
}
console.log(`\nСгенерировано файлов: ${n}`);
