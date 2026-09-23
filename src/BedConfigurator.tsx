import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Application, Container, Sprite, TilingSprite, Assets, Texture } from 'pixi.js';

/* ============================ Типы ============================ */

/** Слой, которым управляет пользователь (ползунок прозрачности). */
export type LayerId = 'background' | 'base' | 'color' | 'fabric' | 'ao' | 'sheen';

/**
 * Модель изделия: набор путей к спрайтам-слоям и размер «холста» в пикселях арта.
 * Без зон — перекрашивается весь корпус одним цветом (blend 'color' по силуэту).
 */
export interface BedModel {
  /** сцена-фон (комната); кладётся вниз без маски, может отсутствовать */
  background?: string;
  /** рендер изделия с собственной альфой (несёт яркость/светотень) */
  base: string;
  /** маска контура изделия — клиппинг ткани и перекраски */
  silhouette: string;
  /** запечённые тени (multiply) */
  ao?: string;
  /** блики (screen) */
  sheen?: string;
  width: number;
  height: number;
}

/** Ткань/материал — тайлинг поверх поверхности. */
export interface Fabric {
  texture: string;
  /** множитель размера тайла (1 = исходный тайл) */
  scale?: number;
  blend?: 'overlay' | 'soft-light' | 'hard-light';
}

export interface BedConfiguratorProps {
  model: BedModel;
  fabric: Fabric;
  /** цвет корпуса через blend 'color' (null — оставить исходный рендер без перекраски) */
  color: string | null;
  /** прозрачность каждого слоя 0..1 (слой «color» = интенсивность перекраски) */
  opacity: Record<LayerId, number>;
  style?: CSSProperties;
}

/** Императивный движок: точечные обновления без пересоздания сцены. */
export interface Engine {
  setColor(hex: string | null): void;
  setFabric(fabric: Fabric): void;
  setLayerOpacity(id: LayerId, v: number): void;
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
 *   background (normal) → base (normal) → color (по силуэту, blend 'color' + tint)
 *   → fabric (masked tiling) → ao (multiply) → sheen (screen).
 * Каждый слой получает независимую прозрачность через setLayerOpacity; слой «color»
 * задаёт интенсивность единой перекраски корпуса.
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

  /* --- состояние прозрачности слоёв + цвет корпуса --- */
  const alpha: Record<LayerId, number> = {
    background: 1,
    base: 1,
    color: 1,
    fabric: 1,
    ao: 1,
    sheen: 1,
  };
  let bodyColor: string | null = null;

  /* --- background: сцена-фон (комната) --- */
  let background: Sprite | null = null;
  if (model.background) {
    background = fit(new Sprite(await load(model.background)));
    background.blendMode = 'normal';
    root.addChild(background);
  }

  /* --- base: рендер изделия (имеет альфу контура) --- */
  const base = fit(new Sprite(await load(model.base)));
  base.blendMode = 'normal';
  root.addChild(base);

  /* --- color: единая перекраска корпуса = маска силуэта с blend 'color' + tint --- */
  const colorSprite = fit(new Sprite(await load(model.silhouette)));
  colorSprite.blendMode = 'color';
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

  /* --- ao: multiply (запечённые тени) --- */
  let ao: Sprite | null = null;
  if (model.ao) {
    ao = fit(new Sprite(await load(model.ao)));
    ao.blendMode = 'multiply';
    root.addChild(ao);
  }

  /* --- sheen: screen (блики) --- */
  let sheen: Sprite | null = null;
  if (model.sheen) {
    sheen = fit(new Sprite(await load(model.sheen)));
    sheen.blendMode = 'screen';
    root.addChild(sheen);
  }

  /* ------------------- единый пересчёт видимости/альфы ------------------- */
  const refresh = () => {
    if (background) {
      background.alpha = clamp01(alpha.background);
      background.visible = alpha.background > 0;
    }

    base.alpha = clamp01(alpha.base);

    // слой «color» = интенсивность перекраски; цвет — единый tint по силуэту
    const colorOn = clamp01(alpha.color);
    if (bodyColor && colorOn > 0) {
      colorSprite.tint = hexToNum(bodyColor);
      colorSprite.alpha = colorOn;
      colorSprite.visible = true;
    } else {
      colorSprite.visible = false;
    }

    if (fabricSprite) {
      fabricSprite.alpha = clamp01(alpha.fabric);
      fabricSprite.visible = alpha.fabric > 0;
    }

    if (ao) {
      ao.alpha = clamp01(alpha.ao);
      ao.visible = alpha.ao > 0;
    }

    if (sheen) {
      sheen.alpha = clamp01(alpha.sheen);
      sheen.visible = alpha.sheen > 0;
    }
  };

  /* ------------------------- публичный API ------------------------- */

  const engine: Engine = {
    setColor(hex) {
      if (destroyed) return;
      bodyColor = hex;
      refresh();
      invalidate();
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
        fabricSprite.blendMode = fabric.blend ?? 'soft-light';
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

    destroy() {
      if (destroyed) return;
      destroyed = true;
      fabricToken++; // отменяем незавершённую загрузку ткани
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
  opacity,
  style,
}: BedConfiguratorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const latest = useRef({ fabric, color, opacity });
  latest.current = { fabric, color, opacity };

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
      const { fabric: f, color: c, opacity: o } = latest.current;
      for (const id of Object.keys(o) as LayerId[]) eng.setLayerOpacity(id, o[id]);
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
  useEffect(() => { engineRef.current?.setFabric(fabric); }, [fabric]);
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    for (const id of Object.keys(opacity) as LayerId[]) eng.setLayerOpacity(id, opacity[id]);
  }, [opacity]);

  return (
    <div
      ref={hostRef}
      style={{ width: '100%', aspectRatio: `${model.width} / ${model.height}`, ...style }}
    />
  );
}
