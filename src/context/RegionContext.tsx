import { createContext, useContext } from 'react';
import { DEFAULT_REGION, type RegionConfig } from '../config/region';
import { getTranslations } from '../i18n/translations';
import type { Language } from '../types/gis';

export const RegionContext = createContext<RegionConfig>(DEFAULT_REGION);

export function useActiveRegion(): RegionConfig {
  return useContext(RegionContext);
}

export function useT(lang: Language) {
  const region = useActiveRegion();
  return getTranslations(region)[lang];
}
