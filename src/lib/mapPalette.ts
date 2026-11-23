import type { BasemapId } from '../types/gis';

export interface OverlayContrastPalette {
  roads: {
    casingColor: string;
    casingOpacity: number;
    secondaryCasingWidth: number;
    localCasingWidth: number;
    secondaryCoreColor: string;
    localCoreColor: string;
    secondaryCoreWidth: number;
    localCoreWidth: number;
  };
  contours: {
    majorCasingOpacity: number;
    majorColor: string;
    minorColor: string;
    majorOpacity: number;
    minorOpacity: number;
  };
  flows: {
    backingColor: string;
    backingOpacity: number;
    lineColor: string;
    lineOpacity: number;
  };
  agamRbi: {
    casingColor: string;
    casingOpacity: number;
    lineColor: string;
    lineOpacity: number;
  };
  agamForest: {
    hlFill: string;
    ksaFill: string;
    aplFill: string;
    fillOpacity: number;
    casingColor: string;
    casingOpacity: number;
    lineColor: string;
    lineWidth: number;
  };
  agamSoil: {
    andosolFill: string;
    otherFill: string;
    fillOpacity: number;
    casingColor: string;
    casingOpacity: number;
    lineColor: string;
    lineWidth: number;
  };
  agamLandslide: {
    highFill: string;
    medFill: string;
    lowFill: string;
    fillOpacity: number;
    casingColor: string;
    casingOpacity: number;
    highLine: string;
    medLine: string;
    lowLine: string;
    lineWidth: number;
  };
}

/** Satellite imagery has dark forest/terrain backgrounds that need luminous cased vectors. */
export function isDarkBasemap(basemap: BasemapId): boolean {
  return basemap === 'sat';
}

/** Return basemap-adaptive paint tokens tuned for Satellite vs light daylight basemaps. */
export function getOverlayContrastPalette(basemap: BasemapId): OverlayContrastPalette {
  if (isDarkBasemap(basemap)) {
    return {
      roads: {
        casingColor: '#161c1a',
        casingOpacity: 0.9,
        secondaryCasingWidth: 5.2,
        localCasingWidth: 3.4,
        secondaryCoreColor: '#fde047',
        localCoreColor: '#f8fafc',
        secondaryCoreWidth: 2.8,
        localCoreWidth: 1.8
      },
      contours: {
        majorCasingOpacity: 0.55,
        majorColor: '#fef3c7',
        minorColor: '#fde68a',
        majorOpacity: 0.92,
        minorOpacity: 0.58
      },
      flows: {
        backingColor: '#161c1a',
        backingOpacity: 0.48,
        lineColor: '#fbbf24',
        lineOpacity: 0.92
      },
      agamRbi: {
        casingColor: '#082f49',
        casingOpacity: 0.78,
        lineColor: '#22d3ee',
        lineOpacity: 0.96
      },
      agamForest: {
        hlFill: '#22c55e',
        ksaFill: '#14b8a6',
        aplFill: '#e2e8f0',
        fillOpacity: 0.24,
        casingColor: '#052e16',
        casingOpacity: 0.75,
        lineColor: '#86efac',
        lineWidth: 1.8
      },
      agamSoil: {
        andosolFill: '#f59e0b',
        otherFill: '#94a3b8',
        fillOpacity: 0.26,
        casingColor: '#1c1917',
        casingOpacity: 0.68,
        lineColor: '#fde68a',
        lineWidth: 1.6
      },
      agamLandslide: {
        highFill: '#ef4444',
        medFill: '#f59e0b',
        lowFill: '#84cc16',
        fillOpacity: 0.3,
        casingColor: '#161c1a',
        casingOpacity: 0.65,
        highLine: '#fca5a5',
        medLine: '#fde047',
        lowLine: '#bef264',
        lineWidth: 1.6
      }
    };
  }

  return {
    roads: {
      casingColor: '#334155',
      casingOpacity: 0.85,
      secondaryCasingWidth: 4.8,
      localCasingWidth: 3.0,
      secondaryCoreColor: '#fde047',
      localCoreColor: '#ffffff',
      secondaryCoreWidth: 2.6,
      localCoreWidth: 1.6
    },
    contours: {
      majorCasingOpacity: 0,
      majorColor: '#78350f',
      minorColor: '#b45309',
      majorOpacity: 0.85,
      minorOpacity: 0.48
    },
    flows: {
      backingColor: '#fef3c7',
      backingOpacity: 0.45,
      lineColor: '#b45309',
      lineOpacity: 0.84
    },
    agamRbi: {
      casingColor: '#ffffff',
      casingOpacity: 0.82,
      lineColor: '#0e7490',
      lineOpacity: 0.94
    },
    agamForest: {
      hlFill: '#166534',
      ksaFill: '#0f766e',
      aplFill: '#cbd5e1',
      fillOpacity: 0.22,
      casingColor: '#ffffff',
      casingOpacity: 0.75,
      lineColor: '#15803d',
      lineWidth: 1.6
    },
    agamSoil: {
      andosolFill: '#b45309',
      otherFill: '#57534e',
      fillOpacity: 0.22,
      casingColor: '#ffffff',
      casingOpacity: 0.7,
      lineColor: '#78350f',
      lineWidth: 1.4
    },
    agamLandslide: {
      highFill: '#dc2626',
      medFill: '#d97706',
      lowFill: '#65a30d',
      fillOpacity: 0.26,
      casingColor: '#ffffff',
      casingOpacity: 0.7,
      highLine: '#991b1b',
      medLine: '#b45309',
      lowLine: '#3f6212',
      lineWidth: 1.4
    }
  };
}
