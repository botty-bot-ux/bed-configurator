import { useMemo, useState } from 'react';
import SofaConfigurator from './SofaConfigurator.tsx';

/* Модель изделия — стабильная ссылка, чтобы движок пересоздавался только при её смене. */
const MODEL = {
  base: '/sofa/base.png',
  silhouette: '/sofa/silhouette.png',
  zones: {
    back: '/sofa/zones/back.png',
    seat: '/sofa/zones/seat.png',
    arms: '/sofa/zones/arms.png',
    pillows: '/sofa/zones/pillows.png',
  },
  ao: '/sofa/ao.png',
  sheen: '/sofa/sheen.png',
  details: ['/sofa/details.png'],
  width: 900,
  height: 520,
};

const ZONE_LABELS = {
  back: 'Спинка',
  seat: 'Сидушка',
  arms: 'Подлокотники',
  pillows: 'Подушки',
};

/* Готовые ткани-заглушки (бесшовные тайлы). */
const FABRICS = {
  none: { label: 'Без ткани', fabric: { texture: '/sofa/fabrics/velour.png', strength: 0 } },
  velour: { label: 'Велюр (soft-light)', fabric: { texture: '/sofa/fabrics/velour.png', scale: 1.4, strength: 0.9, blend: 'soft-light' } },
  linen: { label: 'Лён (overlay)', fabric: { texture: '/sofa/fabrics/linen.png', scale: 1.0, strength: 0.75, blend: 'overlay' } },
  twill: { label: 'Твил (hard-light)', fabric: { texture: '/sofa/fabrics/twill.png', scale: 0.9, strength: 0.65, blend: 'hard-light' } },
};

/* Палитра-пресеты для быстрой примерки. */
const PRESETS = {
  Графит: { back: '#5b6472', seat: '#69737f', arms: '#5b6472', pillows: '#c98f5f' },
  Песок: { back: '#c8b79a', seat: '#d8c9ad', arms: '#c8b79a', pillows: '#7a6a54' },
  Индиго: { back: '#3f4e6b', seat: '#4a5b7a', arms: '#3f4e6b', pillows: '#d9a441' },
  Бургунди: { back: '#6e2233', seat: '#7d2b3c', arms: '#6e2233', pillows: '#c9a227' },
};

const DEFAULT_COLORS = { back: '#5b6472', seat: '#69737f', arms: '#5b6472', pillows: '#c98f5f' };

export default function App() {
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [fabricKey, setFabricKey] = useState('velour');
  const [sheen, setSheen] = useState(0.35);

  const fabric = useMemo(() => FABRICS[fabricKey].fabric, [fabricKey]);

  const setColor = (zone, hex) => setColors((c) => ({ ...c, [zone]: hex }));

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-100 to-slate-200 text-slate-800">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Конфигуратор дивана · PixiJS v8</h1>
          <p className="text-sm text-slate-500">
            Слои-спрайты со blend-режимами: base → зоны(color+tint) → ткань(tiling) → AO(multiply) → блики(screen) → детали.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
          {/* Сцена */}
          <div className="rounded-2xl bg-white/70 p-6 shadow-sm ring-1 ring-slate-900/5">
            <div className="rounded-xl bg-[radial-gradient(120%_120%_at_50%_0%,#ffffff_0%,#e9edf3_60%,#dbe1ea_100%)] p-4">
              <SofaConfigurator
                model={MODEL}
                fabric={fabric}
                colors={colors}
                sheenOpacity={sheen}
              />
            </div>
          </div>

          {/* Панель управления */}
          <div className="space-y-6">
            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Цвет зон
              </h2>
              <div className="space-y-3">
                {Object.keys(ZONE_LABELS).map((zone) => (
                  <div key={zone} className="flex items-center justify-between gap-3">
                    <span className="text-sm">{ZONE_LABELS[zone]}</span>
                    <div className="flex items-center gap-2">
                      <code className="w-20 text-right text-xs text-slate-400">{colors[zone]}</code>
                      <input
                        type="color"
                        value={colors[zone]}
                        onChange={(e) => setColor(zone, e.target.value)}
                        className="h-8 w-10 rounded-lg"
                        aria-label={ZONE_LABELS[zone]}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(PRESETS).map(([name, preset]) => (
                  <button
                    key={name}
                    onClick={() => setColors(preset)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium transition hover:border-slate-300 hover:bg-slate-100"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Ткань</h2>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(FABRICS).map(([key, { label }]) => (
                  <button
                    key={key}
                    onClick={() => setFabricKey(key)}
                    className={
                      'rounded-lg border px-3 py-2 text-left text-xs font-medium transition ' +
                      (fabricKey === key
                        ? 'border-slate-800 bg-slate-800 text-white'
                        : 'border-slate-200 bg-white hover:bg-slate-50')
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Блики</h2>
                <span className="text-xs tabular-nums text-slate-500">{sheen.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={sheen}
                onChange={(e) => setSheen(parseFloat(e.target.value))}
                className="w-full accent-slate-800"
              />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
