import type { BedModel, Fabric, LayerId } from './BedConfigurator';

/** Слой с ползунком прозрачности (подпись + дефолт 0..1). */
export interface PanelMeta {
  id: LayerId;
  label: string;
  default: number;
}

/** Материал = ткань-тайл + параметры смешивания (без зон и без своего блика). */
export interface MaterialMeta {
  id: string;
  label: string;
  fabric: string | null;
  blend?: 'overlay' | 'soft-light' | 'hard-light';
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
    background?: string;
    base: string;
    silhouette: string;
    ao?: string;
    sheen?: string;
  };
  /** цвет корпуса по умолчанию (null — показать исходный рендер без перекраски) */
  color: string | null;
  /** слои, у которых в UI есть ползунок прозрачности */
  panels: PanelMeta[];
  materials: MaterialMeta[];
  presets?: ColorPreset[];
}

export interface LoadedBed {
  model: BedModel;
  panels: PanelMeta[];
  materials: MaterialMeta[];
  presets: ColorPreset[];
  defaultColor: string | null;
  defaultOpacity: Record<LayerId, number>;
}

/** Материал манифеста → проп движка Fabric (без прозрачности — она в opacity). */
export function toFabric(m: MaterialMeta): Fabric {
  return {
    texture: m.fabric ?? '',
    scale: m.scale,
    blend: m.blend,
  };
}

/** Приводит манифест к типу модели движка. */
export function manifestToModel(m: BedManifest): BedModel {
  return {
    background: m.layers.background,
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
  for (const p of json.panels) defaultOpacity[p.id] = p.default;

  return {
    model: manifestToModel(json),
    panels: json.panels,
    materials: json.materials,
    presets: json.presets ?? [],
    defaultColor: json.color ?? null,
    defaultOpacity,
  };
}
