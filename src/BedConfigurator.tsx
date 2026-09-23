import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Application, Container, Sprite, TilingSprite, Assets, Texture, Filter } from 'pixi.js';
import type { BLEND_MODES } from 'pixi.js';

// PixiJS #11311: продвинутые blend-режимы (overlay, soft-light, color, hue, ...)
// рисуются фильтром с resolution по умолчанию 1; при разрешении рендерера не-степени-двух
// (HiDPI dpr 1.25/1.5) фильтр покрывает лишь часть кадра → чёрные зоны / «не работает».
// «inherit» заставляет все фильтры наследовать разрешение рендерера.
Filter.defaultOptions.resolution = 'inherit';

/* ============================ Типы ============================ */

/** Слой, которым управляет пользователь (прозрачность + стиль наложения). */
export type LayerId = 'background' | 'base' | 'color' | 'fabric' | 'ao' | 'sheen';

/** Стиль наложения — строка blend-режима Pixi ('normal', 'multiply', 'color', ...). */
export type BlendMode = string;

/**
 * Модель изделия: набор путей к спрайтам-слоям и размер «холста» в пикселях арта.
 * Без зон — перекрашивается весь корпус одним цветом (blend по силуэту).
 */
export interface BedModel {
  /** фон по умолчанию (из галереи фонов); может отсутствовать */
  background?: string;
  /** рендер изделия с собственной альфой (несёт яркость/светотень) */
  base: string;
  /** маска контура изделия — клиппинг ткани и перекраски */
  silhouette: string;
  /** запечённые тени */
  ao?: string;
  /** блики */
  sheen?: string;
  width: number;
  height: number;
}

/** Ткань/материал — тайлинг поверх поверхности (blend теперь у слоя «fabric»). */
export interface Fabric {
  texture: string;
  /** множитель размера тайла (1 = исходный тайл) */
  scale?: number;
}

export interface BedConfiguratorProps {
  model: BedModel;
  fabric: Fabric;
  /** цвет корпуса (null — оставить исходный рендер без перекраски) */
  color: string | null;
  /** активный фон из галереи (null — без фона) */
  background: string | null;
  /** прозрачность каждого слоя 0..1 */
  opacity: Record<LayerId, number>;
  /** стиль наложения каждого слоя */
  blend: Record<LayerId, BlendMode>;
  style?: CSSProperties;
}

/** Императивный движок: точечные обновления без пересоздания сцены. */
export interface Engine {
  setColor(hex: string | null): void;
  setBackground(url: string | null): void;
  setFabric(fabric: Fabric): void;
  setLayerOpacity(id: LayerId, v: number): void;
  setLayerBlend(id: LayerId, mode: BlendMode): void;
  destroy(): void;
}

/* ============================ Утилиты ============================ */

function hexToNum(hex: string): number {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(n) ? n : 0xffffff;
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ============================ Движок ============================ */

/**
 * Собирает Pixi-сцену слоями снизу вверх:
 *   background → base → color (по силуэту) → fabric (masked tiling) → ao → sheen.
 * Каждый слой имеет независимые прозрачность (setLayerOpacity) и стиль наложения
 * (setLayerBlend). Фон переключается галереей через setBackground.
 */
export async function createEngine(host: HTMLElement, model: BedModel): Promise<Engine> {
  const app = new Application();
  const resolution = Math.min(window.devicePixelRatio || 1, 2);

  await app.init({
    width: model.width,
    height: model.height,
    antialias: true,
    resolution,
    autoDensity: true,
    backgroundAlpha: 0, // прозрачный фон страницы; сцена-фон рисуется слоем background
  });

  const canvas = app.canvas as HTMLCanvasElement;
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.style.display = 'block';
  host.appendChild(canvas);

  const root = new Container();
  app.stage.addChild(root);

  let destroyed = false;
  const load = (url: string) => Assets.load<Texture>(url);
  /** растягивает полнокадровый спрайт точно на размер холста (независимо от исходного разрешения). */
  const fit = (s: Sprite) => {
    s.width = model.width;
    s.height = model.height;
    return s;
  };

  // Рендер по требованию: конфигуратор статичен — не крутим автоцикл.
  // Перерисовку коалесим на ближайший кадр (rAF): сразу после назначения
  // свежезагруженной текстуры GPU-ресурс ещё не поднят, и синхронный
  // app.render() падает в батчере. rAF даёт пикселю загрузиться.
  app.ticker.stop();
  let renderQueued = false;
  const invalidate = () => {
    if (destroyed || renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (!destroyed) app.render();
    });
  };

  /* --- состояние слоёв: прозрачность, стиль наложения, цвет, фон --- */
  const alpha: Record<LayerId, number> = {
    background: 1,
    base: 1,
    color: 1,
    fabric: 1,
    ao: 1,
    sheen: 1,
  };
  const blend: Record<LayerId, BLEND_MODES> = {
    background: 'normal',
    base: 'normal',
    color: 'color',
    fabric: 'soft-light',
    ao: 'multiply',
    sheen: 'screen',
  } as unknown as Record<LayerId, BLEND_MODES>;
  let bodyColor: string | null = null;

  /* --- background: сцена-фон (галерея) — спрайт есть всегда, скрываем при null --- */
  const background = fit(new Sprite());
  background.blendMode = blend.background;
  background.visible = false;
  root.addChild(background);
  let bgUrl: string | null = null;
  let bgToken = 0;

  const applyBackground = (url: string | null) => {
    const token = ++bgToken;
    if (!url) {
      bgUrl = null;
      background.texture = Texture.EMPTY;
      refresh();
      invalidate();
      return;
    }
    if (url === bgUrl) {
      refresh();
      invalidate();
      return;
    }
    load(url)
      .then((tex) => {
        if (destroyed || token !== bgToken) return; // устаревшая загрузка фона
        background.texture = tex;
        fit(background);
        bgUrl = url;
        refresh();
        invalidate();
      })
      .catch((e) => console.error('background load failed', url, e));
  };

  /* --- base: рендер изделия (имеет альфу контура) --- */
  const base = fit(new Sprite(await load(model.base)));
  base.blendMode = blend.base;
  root.addChild(base);

  /* --- color: перекраска корпуса = маска силуэта + tint (blend задаётся слоем) --- */
  const colorSprite = fit(new Sprite(await load(model.silhouette)));
  colorSprite.blendMode = blend.color;
  colorSprite.visible = false; // покажем при выборе цвета
  root.addChild(colorSprite);

  /* --- surface: тканевый тайлинг, обрезанный по силуэту --- */
  const surface = new Container();
  root.addChild(surface);
  const silhouetteMask = fit(new Sprite(await load(model.silhouette)));
  surface.mask = silhouetteMask;

  let fabricSprite: TilingSprite | null = null;
  let fabricUrl: string | null = null;
  let fabricToken = 0;

  /* --- ao: запечённые тени --- */
  let ao: Sprite | null = null;
  if (model.ao) {
    ao = fit(new Sprite(await load(model.ao)));
    ao.blendMode = blend.ao;
    root.addChild(ao);
  }

  /* --- sheen: блики --- */
  let sheen: Sprite | null = null;
  if (model.sheen) {
    sheen = fit(new Sprite(await load(model.sheen)));
    sheen.blendMode = blend.sheen;
    root.addChild(sheen);
  }

  /* ------------------- единый пересчёт видимости/альфы/наложения ------------------- */
  function refresh() {
    background.blendMode = blend.background;
    background.alpha = clamp01(alpha.background);
    background.visible = bgUrl != null && alpha.background > 0;

    base.blendMode = blend.base;
    base.alpha = clamp01(alpha.base);

    colorSprite.blendMode = blend.color;
    const colorOn = clamp01(alpha.color);
    if (bodyColor && colorOn > 0) {
      colorSprite.tint = hexToNum(bodyColor);
      colorSprite.alpha = colorOn;
      colorSprite.visible = true;
    } else {
      colorSprite.visible = false;
    }

    if (fabricSprite) {
      fabricSprite.blendMode = blend.fabric;
      fabricSprite.alpha = clamp01(alpha.fabric);
      fabricSprite.visible = alpha.fabric > 0;
    }

    if (ao) {
      ao.blendMode = blend.ao;
      ao.alpha = clamp01(alpha.ao);
      ao.visible = alpha.ao > 0;
    }

    if (sheen) {
      sheen.blendMode = blend.sheen;
      sheen.alpha = clamp01(alpha.sheen);
      sheen.visible = alpha.sheen > 0;
    }
  }

  if (model.background) applyBackground(model.background);

  /* ------------------------- публичный API ------------------------- */

  const engine: Engine = {
    setColor(hex) {
      if (destroyed) return;
      bodyColor = hex;
      refresh();
      invalidate();
    },

    setBackground(url) {
      if (destroyed) return;
      applyBackground(url ?? null);
    },

    setFabric(fabric) {
      if (destroyed) return;
      if (!fabric?.texture) {
        if (fabricSprite) fabricSprite.visible = false;
        refresh();
        invalidate();
        return;
      }
      const token = ++fabricToken;
      const url = fabric.texture;
      const apply = (tex: Texture) => {
        if (destroyed || token !== fabricToken) return; // устаревшая загрузка
        if (!fabricSprite) {
          fabricSprite = new TilingSprite({ texture: tex, width: model.width, height: model.height });
          surface.addChild(fabricSprite);
          fabricUrl = url;
        } else if (fabricUrl !== url) {
          fabricSprite.texture = tex;
          fabricUrl = url;
        }
        fabricSprite.width = model.width;
        fabricSprite.height = model.height;
        const sc = fabric.scale ?? 1;
        fabricSprite.tileScale.set(sc, sc);
        refresh();
        invalidate();
      };
      if (fabricUrl === url && fabricSprite) {
        apply(fabricSprite.texture); // уже загружено — просто перенастроить
      } else {
        load(url).then(apply).catch((e) => console.error('fabric load failed', url, e));
      }
    },

    setLayerOpacity(id, v) {
      if (destroyed) return;
      alpha[id] = clamp01(v);
      refresh();
      invalidate();
    },

    setLayerBlend(id, mode) {
      if (destroyed) return;
      blend[id] = mode as unknown as BLEND_MODES;
      refresh();
      invalidate();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      fabricToken++; // отменяем незавершённые загрузки ткани/фона
      bgToken++;
      try {
        // НЕ разрушаем текстуры — они закешированы в Assets для повторного движка
        app.destroy(true, { children: true, texture: false, textureSource: false });
      } catch (e) {
        console.error('engine destroy failed', e);
      }
      if (canvas.parentNode === host) host.removeChild(canvas);
    },
  };

  refresh();
  invalidate(); // первый кадр после сборки сцены
  return engine;
}

/* ======================== React-обёртка ======================== */

export default function BedConfigurator({
  model,
  fabric,
  color,
  background,
  opacity,
  blend,
  style,
}: BedConfiguratorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const latest = useRef({ fabric, color, background, opacity, blend });
  latest.current = { fabric, color, background, opacity, blend };

  // Пересоздаём движок только при смене модели.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let alive = true;

    (async () => {
      let eng: Engine | null = null;
      try {
        eng = await createEngine(host, model);
      } catch (e) {
        console.error('BedConfigurator: не удалось инициализировать движок', e);
        return;
      }
      if (!alive) {
        eng.destroy();
        return;
      }
      engineRef.current = eng;
      const { fabric: f, color: c, background: bg, opacity: o, blend: b } = latest.current;
      for (const id of Object.keys(o) as LayerId[]) eng.setLayerOpacity(id, o[id]);
      for (const id of Object.keys(b) as LayerId[]) eng.setLayerBlend(id, b[id]);
      eng.setBackground(bg ?? null);
      eng.setColor(c ?? null);
      eng.setFabric(f);
    })();

    return () => {
      alive = false;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // Точечные обновления при смене пропсов (движок уже готов).
  useEffect(() => { engineRef.current?.setColor(color ?? null); }, [color]);
  useEffect(() => { engineRef.current?.setBackground(background ?? null); }, [background]);
  useEffect(() => { engineRef.current?.setFabric(fabric); }, [fabric]);
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    for (const id of Object.keys(opacity) as LayerId[]) eng.setLayerOpacity(id, opacity[id]);
  }, [opacity]);
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    for (const id of Object.keys(blend) as LayerId[]) eng.setLayerBlend(id, blend[id]);
  }, [blend]);

  return (
    <div
      ref={hostRef}
      style={{ width: '100%', aspectRatio: `${model.width} / ${model.height}`, ...style }}
    />
  );
}
