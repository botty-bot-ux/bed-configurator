import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Application, Container, Sprite, TilingSprite, Assets, Texture } from 'pixi.js';

/* ============================ Типы ============================ */

/** Слой, которым управляет пользователь (ползунок прозрачности). */
export type LayerId = 'base' | 'color' | 'fabric' | 'ao' | 'sheen' | 'details';

/** Модель изделия: набор путей к спрайтам-слоям и размер «холста» в пикселях арта. */
export interface SofaModel {
  /** серая светотень (несёт яркость) */
  base: string;
  /** маска контура: и для перекраски (blend 'color'), и для клиппинга ткани */
  silhouette: string;
  /** запечённые тени (multiply) */
  ao?: string;
  /** дефолтный блик (screen), если материал не задал свой */
  sheen?: string;
  /** детали поверх — ножки/кант, не перекрашиваются (normal) */
  details?: string[];
  width: number;
  height: number;
}

/** Ткань/материал — тайлинг поверх поверхности + собственный блик. */
export interface Fabric {
  texture: string;
  /** множитель размера тайла (1 = исходный тайл) */
  scale?: number;
  blend?: 'overlay' | 'soft-light' | 'hard-light';
  /** своя карта блика для материала (screen). Иначе — model.sheen */
  sheenTex?: string;
}

export interface SofaConfiguratorProps {
  model: SofaModel;
  fabric: Fabric;
  /** цвет корпуса через blend 'color' (null — оставить серую базу) */
  color: string | null;
  /** прозрачность каждого слоя 0..1 */
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
 * Создаёт Pixi-сцену внутри host и собирает изделие слоями снизу вверх:
 *   base (normal) → color (silhouette, 'color'+tint) → fabric (masked tiling)
 *   → ao (multiply) → sheen (screen) → details (normal).
 * Каждый слой получает независимую прозрачность через setLayerOpacity.
 */
export async function createEngine(host: HTMLElement, model: SofaModel): Promise<Engine> {
  const app = new Application();
  const resolution = Math.min(window.devicePixelRatio || 1, 2);

  await app.init({
    width: model.width,
    height: model.height,
    antialias: true,
    resolution,
    autoDensity: true,
    backgroundAlpha: 0, // прозрачный фон — страница просвечивает вокруг силуэта
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

  /* --- состояние прозрачности слоёв + выбранный цвет --- */
  const alpha: Record<LayerId, number> = {
    base: 1,
    color: 1,
    fabric: 1,
    ao: 1,
    sheen: 1,
    details: 1,
  };
  let currentColor: string | null = null;

  /* --- base: светотень --- */
  const base = new Sprite(await load(model.base));
  base.blendMode = 'normal';
  root.addChild(base);

  /* --- color: перекраска корпуса = силуэт с blend 'color' + tint --- */
  const colorSprite = new Sprite(await load(model.silhouette));
  colorSprite.blendMode = 'color';
  colorSprite.visible = false; // покажем при выборе цвета
  root.addChild(colorSprite);

  /* --- surface: тканевый тайлинг, обрезанный по силуэту --- */
  const surface = new Container();
  root.addChild(surface);
  const silhouetteMask = new Sprite(await load(model.silhouette));
  surface.mask = silhouetteMask;

  let fabricSprite: TilingSprite | null = null;
  let fabricUrl: string | null = null;
  let fabricToken = 0;

  /* --- ao: multiply (запечённые тени) --- */
  let ao: Sprite | null = null;
  if (model.ao) {
    ao = new Sprite(await load(model.ao));
    ao.blendMode = 'multiply';
    root.addChild(ao);
  }

  /* --- sheen: screen (блики); текстуру задаёт материал --- */
  const sheen = new Sprite();
  sheen.blendMode = 'screen';
  sheen.visible = false;
  root.addChild(sheen);
  let sheenUrl: string | null = null;
  let sheenToken = 0;

  /* --- details: normal поверх (не перекрашиваются) --- */
  const details: Sprite[] = [];
  for (const url of model.details ?? []) {
    const s = new Sprite(await load(url));
    s.blendMode = 'normal';
    details.push(s);
    root.addChild(s);
  }

  /* ------------------- единый пересчёт видимости/альфы ------------------- */
  const refresh = () => {
    base.alpha = clamp01(alpha.base);

    if (currentColor && alpha.color > 0) {
      colorSprite.tint = hexToNum(currentColor);
      colorSprite.alpha = clamp01(alpha.color);
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

    sheen.alpha = clamp01(alpha.sheen);
    sheen.visible = sheenUrl != null && alpha.sheen > 0;

    for (const d of details) {
      d.alpha = clamp01(alpha.details);
      d.visible = alpha.details > 0;
    }
  };

  const applySheenTex = (url: string | null) => {
    const token = ++sheenToken;
    if (!url) {
      sheenUrl = null;
      sheen.texture = Texture.EMPTY;
      refresh();
      invalidate();
      return;
    }
    if (url === sheenUrl) {
      refresh();
      invalidate();
      return;
    }
    load(url)
      .then((tex) => {
        if (destroyed || token !== sheenToken) return; // устаревшая загрузка блика
        sheen.texture = tex;
        sheenUrl = url;
        refresh();
        invalidate();
      })
      .catch((e) => console.error('sheen load failed', url, e));
  };
  if (model.sheen) applySheenTex(model.sheen);

  /* ------------------------- публичный API ------------------------- */

  const engine: Engine = {
    setColor(hex) {
      if (destroyed) return;
      currentColor = hex;
      refresh();
      invalidate();
    },

    setFabric(fabric) {
      if (destroyed) return;
      if (!fabric?.texture) {
        if (fabricSprite) fabricSprite.visible = false;
        applySheenTex(fabric?.sheenTex ?? model.sheen ?? null);
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
      applySheenTex(fabric.sheenTex ?? model.sheen ?? null);
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
      fabricToken++; // отменяем незавершённые загрузки ткани/блика
      sheenToken++;
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

export default function SofaConfigurator({
  model,
  fabric,
  color,
  opacity,
  style,
}: SofaConfiguratorProps) {
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
        console.error('SofaConfigurator: не удалось инициализировать движок', e);
        return;
      }
      if (!alive) {
        eng.destroy();
        return;
      }
      engineRef.current = eng;
      const { fabric: f, color: c, opacity: o } = latest.current;
      for (const id of Object.keys(o) as LayerId[]) eng.setLayerOpacity(id, o[id]);
      eng.setColor(c);
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
  useEffect(() => { engineRef.current?.setColor(color); }, [color]);
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
