import type { Fabric, SofaModel } from './SofaConfigurator';

/** Метаданные зоны для UI (подпись, дефолтный цвет, связь «красить вместе»). */
export interface ZoneMeta {
  id: string;
  label: string;
  default: string;
  /** id другой зоны, цвет которой наследуется при смене (напр. сидушка/подлокотники ← спинка) */
  linkedTo?: string;
}

/** Материал в манифесте: ткань + собственный блик + параметры смешивания. */
export interface MaterialMeta {
  id: string;
  label: string;
  fabric: string | null;
  blend?: 'overlay' | 'soft-light' | 'hard-light';
  scale?: number;
  strength?: number;
  sheen: string | null;
  sheenOpacity: number;
}

export interface ColorPreset {
  label: string;
  colors: Record<string, string>;
}

export interface SofaManifest {
  id: string;
  label: string;
  width: number;
  height: number;
  layers: {
    base: string;
    silhouette: string;
    zones: Record<string, string>;
    ao?: string;
    sheen?: string;
    details?: string[];
  };
  zones: ZoneMeta[];
  materials: MaterialMeta[];
  presets?: ColorPreset[];
}

export interface LoadedSofa {
  model: SofaModel;
  zones: ZoneMeta[];
  materials: MaterialMeta[];
  presets: ColorPreset[];
  defaultColors: Record<string, string>;
}

/** Материал манифеста → проп движка Fabric. */
export function toFabric(m: MaterialMeta): Fabric {
  return {
    texture: m.fabric ?? '',
    scale: m.scale,
    strength: m.strength,
    blend: m.blend,
    sheenTex: m.sheen ?? '',
    sheenOpacity: m.sheenOpacity,
  };
}

/** Приводит манифест к типу модели движка. */
export function manifestToModel(m: SofaManifest): SofaModel {
  return {
    base: m.layers.base,
    silhouette: m.layers.silhouette,
    zones: m.layers.zones,
    ao: m.layers.ao,
    sheen: m.layers.sheen,
    details: m.layers.details,
    width: m.width,
    height: m.height,
  };
}

/**
 * Грузит манифест изделия по URL и разворачивает его в пропы конфигуратора.
 * Новые модели добавляются файлом JSON — без правки кода и без деплоя.
 */
export async function loadSofaManifest(url: string): Promise<LoadedSofa> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Манифест не найден: ${url} (${res.status})`);
  const json = (await res.json()) as SofaManifest;

  const defaultColors: Record<string, string> = {};
  for (const z of json.zones) defaultColors[z.id] = z.default;

  return {
    model: manifestToModel(json),
    zones: json.zones,
    materials: json.materials,
    presets: json.presets ?? [],
    defaultColors,
  };
}
