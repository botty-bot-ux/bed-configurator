import type { BedModel, BlendMode, Fabric, LayerId } from './BedConfigurator';

/**
 * Приводит путь из манифеста (вид `/bed/base.png`) к URL относительно базы сборки.
 * На dev BASE_URL='/', на GitHub Pages — '/<repo>/'. Пустые/null проходят как есть.
 */
const BASE = import.meta.env.BASE_URL;
const withBase = (p: string | null | undefined): string | null =>
  p ? BASE + p.replace(/^\/+/, '') : null;

/** Слой с ползунком прозрачности и выбором стиля наложения. */
export interface PanelMeta {
  id: LayerId;
  label: string;
  /** дефолт прозрачности 0..1 */
  default: number;
  /** дефолтный стиль наложения (blend-режим Pixi) */
  blend: BlendMode;
}

/** Фон из галереи (texture: null — «без фона»). */
export interface BackgroundMeta {
  id: string;
  label: string;
  texture: string | null;
}

/** Материал = ткань-тайл + дефолтный стиль наложения слоя «Ткань». */
export interface MaterialMeta {
  id: string;
  label: string;
  fabric: string | null;
  blend?: BlendMode;
  scale?: number;
  /** дефолтная прозрачность слоя «Ткань» при выборе материала */
  strength?: number;
  /** дефолтная прозрачность слоя «Блики» при выборе материала */
  sheenOpacity?: number;
}

/** Пресет = единый цвет корпуса (одним кликом). */
export interface ColorPreset {
  label: string;
  color: string;
}

export interface BedManifest {
  id: string;
  label: string;
  width: number;
  height: number;
  layers: {
    base: string;
    silhouette: string;
    ao?: string;
    sheen?: string;
  };
  /** галерея фонов; первый с непустой texture — фон по умолчанию */
  backgrounds?: BackgroundMeta[];
  /** цвет корпуса по умолчанию (null — показать исходный рендер без перекраски) */
  color: string | null;
  /** слои с ползунками прозрачности и выбором стиля наложения */
  panels: PanelMeta[];
  materials: MaterialMeta[];
  presets?: ColorPreset[];
}

export interface LoadedBed {
  model: BedModel;
  panels: PanelMeta[];
  materials: MaterialMeta[];
  presets: ColorPreset[];
  backgrounds: BackgroundMeta[];
  defaultBackgroundId: string | null;
  defaultColor: string | null;
  defaultOpacity: Record<LayerId, number>;
  defaultBlend: Record<LayerId, BlendMode>;
}

/** Материал манифеста → проп движка Fabric (путь уже с базой; blend — в состоянии слоёв). */
export function toFabric(m: MaterialMeta): Fabric {
  return {
    texture: withBase(m.fabric) ?? '',
    scale: m.scale,
  };
}

/** Приводит манифест к типу модели движка (все пути — с базой сборки). */
export function manifestToModel(m: BedManifest, background?: string | null): BedModel {
  return {
    background: withBase(background) ?? undefined,
    base: withBase(m.layers.base) as string,
    silhouette: withBase(m.layers.silhouette) as string,
    ao: withBase(m.layers.ao) ?? undefined,
    sheen: withBase(m.layers.sheen) ?? undefined,
    width: m.width,
    height: m.height,
  };
}

/**
 * Грузит манифест изделия по URL и разворачивает его в пропы конфигуратора.
 * Новые модели добавляются файлом JSON — без правки кода и без деплоя.
 */
export async function loadBedManifest(url: string): Promise<LoadedBed> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Манифест не найден: ${url} (${res.status})`);
  const json = (await res.json()) as BedManifest;

  const defaultOpacity = {} as Record<LayerId, number>;
  const defaultBlend = {} as Record<LayerId, BlendMode>;
  for (const p of json.panels) {
    defaultOpacity[p.id] = p.default;
    defaultBlend[p.id] = p.blend;
  }

  const rawBackgrounds = json.backgrounds ?? [];
  const defaultBgRaw = rawBackgrounds.find((b) => b.texture) ?? rawBackgrounds[0] ?? null;
  // текстуры фонов отдаём уже с базой — App подставляет их в движок как есть
  const backgrounds: BackgroundMeta[] = rawBackgrounds.map((b) => ({
    ...b,
    texture: withBase(b.texture),
  }));

  return {
    model: manifestToModel(json, defaultBgRaw?.texture ?? null),
    panels: json.panels,
    materials: json.materials,
    presets: json.presets ?? [],
    backgrounds,
    defaultBackgroundId: defaultBgRaw?.id ?? null,
    defaultColor: json.color ?? null,
    defaultOpacity,
    defaultBlend,
  };
}
