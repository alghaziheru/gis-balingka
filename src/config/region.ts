import rawManifest from '../../regions.config.json';
import type { SoilProfileId } from '../data/soilProfiles';

export interface CameraPresetConfig {
  id: string;
  label: string;
  center: [number, number];
  zoom: number;
  pitch3D: number;
  bearing3D: number;
}

export interface FocusViewConfig {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface RegionConfig {
  id: string;
  name: string;
  shortName: string;
  adminLevelLabel: { id: string; en: string };
  subRegionLabel: { id: string; en: string };
  district: string;
  regency: string;
  province: string;
  officialBoundaryCode: string;
  officialBoundaryNameMatch: string;
  officialBoundaryCodes?: string[];
  appTitle: { id: string; en: string };
  areaKm2: number;
  uplandLandmark: { id: string; en: string };
  mainRivers: string[];
  bbox: { west: number; south: number; east: number; north: number };
  defaultView: { center: [number, number]; zoom: number };
  dataCenter: [number, number];
  cameraPresets: CameraPresetConfig[];
  subRegionSuggestions: string[];
  drainageFocus: {
    upland: FocusViewConfig;
    culverts: FocusViewConfig;
    facilities: FocusViewConfig;
  };
  authorities: {
    bpbdLabel: string;
    localOfficeId: string;
    localOfficeEn: string;
    localAuthorityShort: string;
    defaultEditorName: string;
  };
  regionalOverlays: {
    enabled: boolean;
    providerName: string;
    rbiAvailable: boolean;
    sentinelChangeAvailable: boolean;
    localDemFilename: string;
    bigRbiZipName: string;
    bigRbiGdbName: string;
    bigDesaGdbName: string;
    bigRbiDasName: string;
  };
  hydrology?: {
    soilProfile?: SoilProfileId;
    climateBiasFactor?: number;
    climateSourceNote?: string;
  };
  dataBasePath?: string;
  dbFilename?: string;
  repositoryUrl: string;
}

interface RegionsManifest {
  defaultRegionId: string;
  regions: RegionConfig[];
}

const manifest = rawManifest as RegionsManifest;

export const REGIONS: RegionConfig[] = manifest.regions;
export const DEFAULT_REGION_ID: string = manifest.defaultRegionId || REGIONS[0]?.id || 'nagari-balingka';
export const DEFAULT_REGION: RegionConfig =
  REGIONS.find(r => r.id === DEFAULT_REGION_ID) || REGIONS[0];

/** Backwards-compatible default alias */
export const REGION: RegionConfig = DEFAULT_REGION;

export function getRegionById(id?: string | null): RegionConfig {
  if (!id) return DEFAULT_REGION;
  return REGIONS.find(r => r.id === id) || DEFAULT_REGION;
}

export function isValidRegionId(id?: string | null): boolean {
  return Boolean(id && REGIONS.some(r => r.id === id));
}

export function getRegionDataBasePath(region: RegionConfig): string {
  if (region.dataBasePath) return region.dataBasePath.replace(/\/+$/, '');
  return region.id === DEFAULT_REGION_ID ? '/data' : `/data/regions/${region.id}`;
}

export interface RegionGroup {
  district: string;
  regency: string;
  regions: RegionConfig[];
}

export function groupRegionsByDistrict(regions: RegionConfig[] = REGIONS): RegionGroup[] {
  const map = new Map<string, RegionGroup>();
  for (const r of regions) {
    const key = `${r.district}||${r.regency}`;
    let grp = map.get(key);
    if (!grp) {
      grp = { district: r.district, regency: r.regency, regions: [] };
      map.set(key, grp);
    }
    grp.regions.push(r);
  }
  return Array.from(map.values());
}
