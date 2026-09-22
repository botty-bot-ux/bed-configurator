// gen-linen.mjs — процедурная БЕСШОВНАЯ тайловая текстура льна (512×512).
// Резерв на случай, когда медиа-сервис недоступен. Полотняное переплетение
// строится целочастотными синусами → тайлится без шва по построению.
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'sofa', 'fabrics', 'linen.png');
const S = 512;

const TAU = Math.PI * 2;
// целочастотные гармоники (cycles на весь тайл) — гарантированно seamless
const warpF = 96, weftF = 96;      // частота нитей
const slubF = 7;                    // неровности («утолщения» нити)

const buf = Buffer.alloc(S * S * 3);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 3;
    const u = x / S, v = y / S;
    // вертикальные нити (warp) и горизонтальные (weft) в шахматном переплетении
    const warp = Math.sin(TAU * warpF * u);
    const weft = Math.sin(TAU * weftF * v);
    const over = Math.sin(TAU * warpF * u + TAU * weftF * v); // где нить сверху
    const checker = Math.sign(Math.cos(TAU * warpF * u) * Math.cos(TAU * weftF * v));
    const weave = 0.5 + 0.22 * (checker > 0 ? warp : weft) + 0.06 * over;
    // slub — лёгкие продольные неровности нити (seamless гармоника)
    const slub = 0.05 * Math.sin(TAU * slubF * v + 2.1 * Math.sin(TAU * slubF * u));
    let val = weave + slub;
    // тёплый светло-серый/бежевый тон льна
    const base = 198;
    const r = Math.max(0, Math.min(255, base * val + 6));
    const g = Math.max(0, Math.min(255, (base - 6) * val + 2));
    const b = Math.max(0, Math.min(255, (base - 18) * val - 4));
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
  }
}

await sharp(buf, { raw: { width: S, height: S, channels: 3 } }).png().toFile(OUT);
console.log('wrote', path.relative(process.cwd(), OUT), S + 'x' + S);
