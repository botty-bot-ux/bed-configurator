import type { BedModel, BlendMode, Fabric, LayerId } from './BedConfigurator';

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

/** Материал манифеста → проп движка Fabric (blend/прозрачность — в состоянии слоёв). */
export function toFabric(m: MaterialMeta): Fabric {
  return {
    texture: m.fabric ?? '',
    scale: m.scale,
  };
}

/** Приводит манифест к типу модели движка (фон подставляет loader). */
export function manifestToModel(m: BedManifest, background?: string): BedModel {
  return {
    background,
    base: m.layers.base,
    silhouette: m.layers.silhouette,
    ao: m.layers.ao,
    sheen: m.layers.sheen,
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

  const backgrounds = json.backgrounds ?? [];
  const defaultBg = backgrounds.find((b) => b.texture) ?? backgrounds[0] ?? null;

  return {
    model: manifestToModel(json, defaultBg?.texture ?? undefined),
    panels: json.panels,
    materials: json.materials,
    presets: json.presets ?? [],
    backgrounds,
    defaultBackgroundId: defaultBg?.id ?? null,
    defaultColor: json.color ?? null,
    defaultOpacity,
    defaultBlend,
  };
}
