export type SoilProfileId = 'volcanic_andosol' | 'cambisol_loam' | 'alluvial_clay' | 'karst_limestone';

export interface SoilProfilePreset {
  id: SoilProfileId;
  labelId: string;
  labelEn: string;
  gammaS: number;
  phiDeg: number;
  cSoilKpa: number;
  defaultDepthM: number;
  kLatMmHr: number;
  drainablePorosityMmPerM: number;
  cnForestDelta: number;
  sRetentionBase: number;
  sRetentionForestBonus: number;
  percolationBaseMmHr: number;
  percolationForestMmHr: number;
  percolationUplandMmHr: number;
}

export const SOIL_PROFILES: Record<SoilProfileId, SoilProfilePreset> = {
  volcanic_andosol: {
    id: 'volcanic_andosol',
    labelId: 'Andosol Vulkanik',
    labelEn: 'Volcanic Andosol',
    gammaS: 17.4,
    phiDeg: 27.5,
    cSoilKpa: 2.0,
    defaultDepthM: 1.25,
    kLatMmHr: 1.2,
    drainablePorosityMmPerM: 155,
    cnForestDelta: -4.0,
    sRetentionBase: 1.06,
    sRetentionForestBonus: 0.08,
    percolationBaseMmHr: 0.9,
    percolationForestMmHr: 1.1,
    percolationUplandMmHr: 0.4
  },
  cambisol_loam: {
    id: 'cambisol_loam',
    labelId: 'Kambisol / Lempung Lereng',
    labelEn: 'Cambisol Loam',
    gammaS: 18.8,
    phiDeg: 30.8,
    cSoilKpa: 3.0,
    defaultDepthM: 1.0,
    kLatMmHr: 0.95,
    drainablePorosityMmPerM: 130,
    cnForestDelta: -3.0,
    sRetentionBase: 1.0,
    sRetentionForestBonus: 0.06,
    percolationBaseMmHr: 0.75,
    percolationForestMmHr: 0.85,
    percolationUplandMmHr: 0.3
  },
  alluvial_clay: {
    id: 'alluvial_clay',
    labelId: 'Lempung Aluvial / Dataran Rendah',
    labelEn: 'Alluvial Clay',
    gammaS: 18.6,
    phiDeg: 24.0,
    cSoilKpa: 6.5,
    defaultDepthM: 1.6,
    kLatMmHr: 0.45,
    drainablePorosityMmPerM: 95,
    cnForestDelta: -2.0,
    sRetentionBase: 0.96,
    sRetentionForestBonus: 0.04,
    percolationBaseMmHr: 0.45,
    percolationForestMmHr: 0.55,
    percolationUplandMmHr: 0.15
  },
  karst_limestone: {
    id: 'karst_limestone',
    labelId: 'Karst / Batu Gamping',
    labelEn: 'Karst Limestone',
    gammaS: 19.2,
    phiDeg: 34.0,
    cSoilKpa: 4.2,
    defaultDepthM: 0.65,
    kLatMmHr: 1.85,
    drainablePorosityMmPerM: 110,
    cnForestDelta: -3.5,
    sRetentionBase: 1.18,
    sRetentionForestBonus: 0.08,
    percolationBaseMmHr: 1.6,
    percolationForestMmHr: 0.9,
    percolationUplandMmHr: 0.5
  }
};

export function resolveSoilProfile(id?: string | null): SoilProfilePreset {
  if (id && id in SOIL_PROFILES) {
    return SOIL_PROFILES[id as SoilProfileId];
  }
  return SOIL_PROFILES.volcanic_andosol;
}
