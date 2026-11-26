import rawConfig from '../../region.config.json';
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
  repositoryUrl: string;
}

export const REGION = rawConfig as RegionConfig;
