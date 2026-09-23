import { useEffect, useMemo, useState } from 'react';
import BedConfigurator from './BedConfigurator.tsx';
import { loadBedManifest, toFabric } from './bedManifest';

const MANIFEST_URL = `${import.meta.env.BASE_URL}beds/default/manifest.json`;

/** Стили наложения, доступные в UI (значение = blend-режим Pixi). */
const BLEND_MODES = [
  ['normal', 'Обычный'],
  ['multiply', 'Умнение'],
  ['screen', 'Экран'],
  ['overlay', 'Перекрытие'],
  ['soft-light', 'Мягкий свет'],
  ['hard-light', 'Жёсткий свет'],
  ['color-dodge', 'Осветление'],
  ['color-burn', 'Затемнение'],
  ['difference', 'Разность'],
  ['exclusion', 'Исключение'],
  ['hue', 'Тон'],
  ['saturation', 'Насыщенность'],
  ['color', 'Цвет'],
  ['luminosity', 'Светлота'],
  ['add', 'Добавить'],
  ['darken', 'Затемнить'],
  ['lighten', 'Осветлить'],
];

export default function App() {
  const [bed, setBed] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    loadBedManifest(MANIFEST_URL)
      .then((b) => alive && setBed(b))
      .catch((e) => alive && setError(String(e?.message || e)));
    return () => { alive = false; };
  }, []);

  if (error) {
    return (
      <Shell>
        <div className="rounded-xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-200">
          Не удалось загрузить модель: {error}
        </div>
      </Shell>
    );
  }
  if (!bed) {
    return (
      <Shell>
        <div className="flex h-[52vh] items-center justify-center text-sm text-slate-400">
          Загружаем конфигуратор…
        </div>
      </Shell>
    );
  }
  return <Configurator bed={bed} />;
}

function Configurator({ bed }) {
  const {
    model, panels, materials, presets, backgrounds,
    defaultBackgroundId, defaultColor, defaultOpacity, defaultBlend,
  } = bed;

  const [color, setColor] = useState(defaultColor);
  const [backgroundId, setBackgroundId] = useState(defaultBackgroundId);
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? 'none');
  const [opacity, setOpacity] = useState(defaultOpacity);
  const [blend, setBlend] = useState(defaultBlend);

  const material = useMemo(
    () => materials.find((m) => m.id === materialId) ?? materials[0],
    [materials, materialId],
  );
  const fabric = useMemo(() => (material ? toFabric(material) : { texture: '' }), [material]);
  const background = useMemo(
    () => backgrounds.find((b) => b.id === backgroundId)?.texture ?? null,
    [backgrounds, backgroundId],
  );

  const setLayer = (id, v) => setOpacity((o) => ({ ...o, [id]: v }));
  const setLayerBlend = (id, mode) => setBlend((b) => ({ ...b, [id]: mode }));

  const pickMaterial = (m) => {
    setMaterialId(m.id);
    // материал задаёт дефолты прозрачности ткани/бликов и стиль наложения ткани
    setOpacity((o) => ({
      ...o,
      fabric: m.strength ?? o.fabric,
      sheen: m.sheenOpacity ?? o.sheen,
    }));
    if (m.blend) setLayerBlend('fabric', m.blend);
  };

  const colorOn = color != null;

  return (
    <Shell title={bed.label}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Сцена */}
        <div className="rounded-2xl bg-white/70 p-6 shadow-sm ring-1 ring-slate-900/5">
          <div className="overflow-hidden rounded-xl ring-1 ring-slate-900/5">
            <BedConfigurator
              model={model}
              fabric={fabric}
              color={color}
              background={background}
              opacity={opacity}
              blend={blend}
            />
          </div>
        </div>

        {/* Управление */}
        <div className="space-y-6">
          <Card title="Цвет корпуса">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {colorOn ? `Перекраска: ${color}` : 'Исходный рендер (без цвета)'}
              </span>
              <button
                onClick={() => setColor(colorOn ? null : defaultColor ?? '#c9a878')}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium transition hover:border-slate-300 hover:bg-slate-100"
              >
                {colorOn ? 'Выключить' : 'Включить'}
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 py-1">
              <span className="text-sm">Цвет</span>
              <div className="flex items-center gap-2">
                <code className="w-16 text-right text-xs text-slate-400">{color ?? '—'}</code>
                <input
                  type="color"
                  value={color ?? '#cccccc'}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-8 w-10 rounded"
                  aria-label="Цвет корпуса"
                />
              </div>
            </div>
            {presets.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setColor(p.color)}
                    className={
                      'flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition ' +
                      (color === p.color
                        ? 'border-slate-800 bg-slate-800 text-white'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100')
                    }
                  >
                    <span className="h-3 w-3 rounded-full ring-1 ring-black/10" style={{ background: p.color }} />
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title="Фон">
            <div className="flex flex-wrap gap-2">
              {backgrounds.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setBackgroundId(b.id)}
                  className={
                    'rounded-lg border px-3 py-2 text-xs font-medium transition ' +
                    (b.id === backgroundId
                      ? 'border-slate-800 bg-slate-800 text-white'
                      : 'border-slate-200 bg-white hover:bg-slate-50')
                  }
                >
                  {b.label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Материал">
            <div className="grid grid-cols-2 gap-2">
              {materials.map((m) => (
                <button
                  key={m.id}
                  onClick={() => pickMaterial(m)}
                  className={
                    'rounded-lg border px-3 py-2 text-left text-xs font-medium transition ' +
                    (m.id === materialId
                      ? 'border-slate-800 bg-slate-800 text-white'
                      : 'border-slate-200 bg-white hover:bg-slate-50')
                  }
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Слои">
            <div className="space-y-4">
              {panels.map((p) => (
                <div key={p.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">{p.label}</span>
                    <select
                      value={blend[p.id] ?? 'normal'}
                      onChange={(e) => setLayerBlend(p.id, e.target.value)}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400"
                      aria-label={`Стиль наложения: ${p.label}`}
                    >
                      {BLEND_MODES.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={opacity[p.id] ?? 0}
                      onChange={(e) => setLayer(p.id, parseFloat(e.target.value))}
                      className="w-full accent-slate-800"
                      aria-label={`Прозрачность: ${p.label}`}
                    />
                    <span className="w-9 text-right text-xs tabular-nums text-slate-500">
                      {(opacity[p.id] ?? 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ title, children }) {
  return (
    <div className="min-h-full bg-gradient-to-b from-slate-100 to-slate-200 text-slate-800">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            {title ? `${title} · ` : ''}Конфигуратор · PixiJS v8
          </h1>
          <p className="text-sm text-slate-500">
            Единый цвет корпуса (перекраска по силуэту) · галерея фонов · материал-ткань. У каждого
            слоя — свой стиль наложения и ползунок прозрачности: фон-сцена · основа · цвет · ткань ·
            тени · блики. Модель и палитра берутся из JSON-манифеста.
          </p>
        </header>
        {children}
      </div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      {children}
    </section>
  );
}
