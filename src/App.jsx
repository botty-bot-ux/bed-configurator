import { useEffect, useMemo, useState } from 'react';
import SofaConfigurator from './SofaConfigurator.tsx';
import { loadSofaManifest, toFabric } from './sofaManifest';

const MANIFEST_URL = '/sofas/default/manifest.json';

export default function App() {
  const [sofa, setSofa] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    loadSofaManifest(MANIFEST_URL)
      .then((s) => alive && setSofa(s))
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
  if (!sofa) {
    return (
      <Shell>
        <div className="flex h-[52vh] items-center justify-center text-sm text-slate-400">
          Загружаем конфигуратор…
        </div>
      </Shell>
    );
  }
  return <Configurator sofa={sofa} />;
}

function Configurator({ sofa }) {
  const { model, zones, materials, presets, defaultColors } = sofa;

  const [colors, setColors] = useState(defaultColors);
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? 'none');
  const [sheen, setSheen] = useState(materials[0]?.sheenOpacity ?? 0.35);

  const material = useMemo(
    () => materials.find((m) => m.id === materialId) ?? materials[0],
    [materials, materialId],
  );
  const fabric = useMemo(() => (material ? toFabric(material) : { texture: '' }), [material]);

  const setColor = (id, hex) => {
    setColors((c) => {
      const next = { ...c, [id]: hex };
      // связанные зоны (сидушка/подлокотники) наследуют цвет корпуса
      for (const z of zones) if (z.linkedTo === id) next[z.id] = hex;
      return next;
    });
  };

  const pickMaterial = (m) => {
    setMaterialId(m.id);
    setSheen(m.sheenOpacity ?? 0);
  };

  return (
    <Shell title={sofa.label}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Сцена */}
        <div className="rounded-2xl bg-white/70 p-6 shadow-sm ring-1 ring-slate-900/5">
          <div className="rounded-xl bg-[radial-gradient(120%_120%_at_50%_0%,#ffffff_0%,#e9edf3_60%,#dbe1ea_100%)] p-4">
            <SofaConfigurator
              model={model}
              fabric={fabric}
              colors={colors}
              sheenOpacity={sheen}
            />
          </div>
        </div>

        {/* Управление */}
        <div className="space-y-6">
          <Card title="Цвет зон">
            <div className="space-y-3">
              {zones.map((z) => (
                <div key={z.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{z.label}</span>
                  <div className="flex items-center gap-2">
                    <code className="w-20 text-right text-xs text-slate-400">{colors[z.id]}</code>
                    <input
                      type="color"
                      value={colors[z.id]}
                      onChange={(e) => setColor(z.id, e.target.value)}
                      className="h-8 w-10 rounded-lg"
                      aria-label={z.label}
                    />
                  </div>
                </div>
              ))}
            </div>
            {presets.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setColors({ ...colors, ...p.colors })}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium transition hover:border-slate-300 hover:bg-slate-100"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
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

          <Card title="Блики">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-slate-400">интенсивность</span>
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
            base → зоны(color+tint) → материал(tiling + свой блик) → AO(multiply) → детали.
            Модель и палитра берутся из JSON-манифеста.
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
