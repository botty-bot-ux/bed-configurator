import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Application, Container, Sprite, TilingSprite, Assets } from 'pixi.js';
import type { Texture } from 'pixi.js';

/* ============================ Типы ============================ */

/** Модель изделия: набор путей к спрайтам-слоям и размер «холста» в пикселях арта. */
export interface SofaModel {
  /** серая светотень (несёт яркость) */
  base: string;
  /** маска контура (для поверхности с тканью) */
  silhouette: string;
  /** маски зон: seat / back / arms / pillows — перекрашиваются tint'ом */
  zones: Record<string, string>;
  /** запечённые тени (multiply) */
  ao?: string;
  /** блики (screen) */
  sheen?: string;
  /** детали поверх — ножки/кант, не перекрашиваются (normal) */
  details?: string[];
  width: number;
  height: number;
}

/** Ткань — тайлинг поверх поверхности. */
export interface Fabric {
  texture: string;
  /** множитель размера тайла (1 = исходный тайл) */
  scale?: number;
  /** интенсивность 0..1 (через alpha слоя) */
  strength?: number;
  blend?: 'overlay' | 'soft-light' | 'hard-light';
}

export interface SofaConfiguratorProps {
  model: SofaModel;
  fabric: Fabric;
  colors: Record<string, string>;
  sheenOpacity?: number;
  style?: CSSProperties;
}

/** Императивный движок: точечные обновления без пересоздания сцены. */
export interface Engine {
  setColors(colors: Record<string, string>): void;
  setFabric(fabric: Fabric): void;
  setSheen(opacity: number): void;
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
 *   base (normal) → zones (color, tint) → [fabric (masked)] → ao (multiply)
 *   → sheen (screen) → details (normal).
 * Возвращает движок после загрузки всех текстур модели.
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

  // канвас фиксированного внутреннего размера, растягивается по CSS
  const canvas = app.canvas as HTMLCanvasElement;
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.style.display = 'block';
  host.appendChild(canvas);

  const root = new Container();
  app.stage.addChild(root);

  let destroyed = false;
  const load = (url: string) => Assets.load<Texture>(url);

  /* --- base: светотень --- */
  const base = new Sprite(await load(model.base));
  base.blendMode = 'normal';
  root.addChild(base);

  /* --- zones: маски зон с blend 'color' + tint --- */
  const zoneSprites: Record<string, Sprite> = {};
  const zoneLayer = new Container();
  root.addChild(zoneLayer);
  for (const [name, url] of Object.entries(model.zones)) {
    const s = new Sprite(await load(url));
    s.blendMode = 'color';
    s.visible = false; // покажем при назначении цвета
    zoneSprites[name] = s;
    zoneLayer.addChild(s);
  }

  /* --- surface: тканевый тайлинг, обрезанный по силуэту --- */
  const surface = new Container();
  root.addChild(surface);
  const silhouetteSprite = new Sprite(await load(model.silhouette));
  surface.mask = silhouetteSprite;

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

  /* --- sheen: screen (блики) --- */
  let sheen: Sprite | null = null;
  if (model.sheen) {
    sheen = new Sprite(await load(model.sheen));
    sheen.blendMode = 'screen';
    sheen.visible = false;
    root.addChild(sheen);
  }

  /* --- details: normal поверх (не перекрашиваются) --- */
  const details: Sprite[] = [];
  for (const url of model.details ?? []) {
    const s = new Sprite(await load(url));
    s.blendMode = 'normal';
    details.push(s);
    root.addChild(s);
  }

  /* ------------------------- публичный API ------------------------- */

  const engine: Engine = {
    setColors(colors) {
      if (destroyed) return;
      for (const name of Object.keys(zoneSprites)) {
        const s = zoneSprites[name];
        const hex = colors[name];
        if (hex) {
          s.tint = hexToNum(hex);
          s.visible = true;
        } else {
          s.visible = false; // нет цвета → остаётся серая база
        }
      }
    },

    setFabric(fabric) {
      if (destroyed || !fabric?.texture) {
        if (fabricSprite) fabricSprite.visible = false;
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
        fabricSprite.alpha = clamp01(fabric.strength ?? 1);
        fabricSprite.visible = true;
      };
      if (fabricUrl === url && fabricSprite) {
        apply(fabricSprite.texture); // уже загружено — просто перенастроить
      } else {
        load(url).then(apply).catch((e) => console.error('fabric load failed', url, e));
      }
    },

    setSheen(opacity) {
      if (destroyed || !sheen) return;
      const o = clamp01(opacity);
      sheen.alpha = o;
      sheen.visible = o > 0;
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      fabricToken++; // отменяем незавершённые загрузки ткани
      try {
        // НЕ разрушаем текстуры — они закешированы в Assets для повторного движка
        app.destroy(true, { children: true, texture: false, textureSource: false });
      } catch (e) {
        console.error('engine destroy failed', e);
      }
      if (canvas.parentNode === host) host.removeChild(canvas);
    },
  };

  return engine;
}

/* ======================== React-обёртка ======================== */

export default function SofaConfigurator({
  model,
  fabric,
  colors,
  sheenOpacity = 0.35,
  style,
}: SofaConfiguratorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const latest = useRef({ fabric, colors, sheenOpacity });
  latest.current = { fabric, colors, sheenOpacity };

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
      const { fabric: f, colors: c, sheenOpacity: s } = latest.current;
      eng.setColors(c);
      eng.setFabric(f);
      eng.setSheen(s);
    })();

    return () => {
      alive = false;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // Точечные обновления при смене пропсов (движок уже готов).
  useEffect(() => { engineRef.current?.setColors(colors); }, [colors]);
  useEffect(() => { engineRef.current?.setFabric(fabric); }, [fabric]);
  useEffect(() => { engineRef.current?.setSheen(sheenOpacity); }, [sheenOpacity]);

  return (
    <div
      ref={hostRef}
      style={{ width: '100%', aspectRatio: `${model.width} / ${model.height}`, ...style }}
    />
  );
}
