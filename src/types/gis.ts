export type Language = 'id' | 'en';
export type ViewMode = 'simple' | 'detail';
export type TabId = 'terrain' | 'sim' | 'drainage' | 'editor';
export type BasemapId = 'sat' | 'elev' | 'relief' | 'slope' | 'topo' | 'osm';
export type DrainageStatus = 'unverified' | 'normal' | 'clogged' | 'damaged' | 'critical';
export type WaterwayKind = 'river' | 'stream' | 'canal' | 'drain' | 'culvert';
export type WaterwaySource = 'osm' | 'dem_promoted' | 'manual';
export type StructureKind = 'culvert' | 'bridge';
export type StructureSource = 'manual' | 'crossing_promoted' | 'osm';
export type FeatureCategory = 'drainage' | 'floodmark' | 'landslide' | 'mitigation' | 'evacuation';
export type SoilMoisture = 'dry' | 'moist' | 'saturated';
export type RainPattern = 'uniform' | 'upland' | 'storm_core';
export type DrainCondition = 'cleared' | 'clogged' | 'surge';
export type ForestScenario = 'actual' | 'degraded30' | 'degraded50';
export type HyetographType = 'uniform' | 'convective_front' | 'alternating_block' | 'double_burst';
export type DebrisCouplingMode = 'clear' | 'coupled' | 'surge';
export type SimMapViewMode = 'depth' | 'confidence' | 'scour' | 'survey';
export type DataConfidenceLevel = 'high' | 'medium' | 'low';
export type CalibrationMarkKind = 'hwm' | 'scour' | 'landslide_scar';
export type CascadeAlertLevel = 'normal' | 'waspada' | 'siaga' | 'kritis';
export type ActiveTool =
  | null
  | 'raindrop'
  | 'profileA'
  | 'profileB'
  | 'drawWaterway'
  | 'redrawWaterway'
  | 'placeStructure'
  | 'drawJorong'
  | 'placeStormCore'
  | 'placeCalibrationMark';

export type GeoProperties = Record<string, string | number | boolean | null | undefined>;

export type GeoGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] };

export interface GeoFeature {
  type: 'Feature';
  properties: GeoProperties;
  geometry: GeoGeometry;
}

export interface GeoFeatureCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface DemGridData {
  width: number;
  height: number;
  bbox: BBox;
  cellSizeX: number;
  cellSizeY: number;
  minElev: number;
  maxElev: number;
  elevBase64: string;
}

export interface SimAreasHa {
  clogged: { low: number; med: number; high: number };
  cleared: { low: number; med: number; high: number };
}

export interface SimReachNode {
  id: number;
  downstreamId: number;
  lengthM: number;
  slope: number;
  upstreamAreaKm2: number;
  localAreaKm2: number;
  meanElevM: number;
  meanSlopePct: number;
  meanCn: number;
  forestFrac: number;
  meanTwi: number;
  uplandFrac: number;
  insideNagariFrac: number;
  headCoord: [number, number];
  midCoord: [number, number];
  outletCoord: [number, number];
  coords: [number, number][];
  kRef: number[];
  topW: number[];
  verifiedWaterwayId: string | null;
  waterwayName: string | null;
  waterwayKind: string | null;
  measuredWidthM: number | null;
  measuredWidthPreM: number | null;
  measuredDepthM: number | null;
  dataConfidence: DataConfidenceLevel;
}

export interface SimCrossingNode {
  id: string;
  name: string;
  kind: string;
  status: string;
  verified: boolean;
  measuredOpening: boolean;
  openingWidthM: number | null;
  openingHeightM: number | null;
  defaultBlockagePct: number;
  qCapM3s: number;
  reachId: number;
  longFrac: number;
  coords: [number, number];
}

export interface SimNetworkData {
  version: number;
  srcStagesM: number[];
  reachCount: number;
  crossingCount: number;
  reaches: SimReachNode[];
  crossings: SimCrossingNode[];
}

export interface SimFieldsData {
  version?: number;
  width: number;
  height: number;
  bbox: BBox;
  cellSizeX: number;
  cellSizeY: number;
  sourceDemResM?: number;
  hiResWidth?: number;
  hiResHeight?: number;
  hiResHandDmBase64?: string;
  minElev: number;
  maxElev: number;
  p90TravelMin: number;
  elevMBase64?: string;
  handDmBase64: string;
  slopePctBase64: string;
  accNormBase64: string;
  travelTimeTenthMinBase64: string;
  cnBaseBase64: string;
  rootCohesionBase64: string;
  isForestBase64: string;
  uplandWeightBase64: string;
  uplandAccRatioBase64: string;
  twiBase64?: string;
  curvatureBase64?: string;
  soilDepthCmBase64?: string;
  geologyFactorBase64?: string;
  reachIdBase64?: string;
  reachLongFracBase64?: string;
  bottleneckProxBase64: string;
  soilErodibilityBase64?: string;
  officialLandslideBase64?: string;
  scourMaskBase64?: string;
  nagariMaskBase64?: string;
  agamSummary?: AgamSummaryStats;
  network?: SimNetworkData;
}

export interface CalibrationProfile {
  manningMult: number;
  cnOffset: number;
  cohesionMult: number;
  rmseM?: number | null;
  scourCsi?: number | null;
  landslideAuc?: number | null;
  updatedBy?: string;
  updatedAt?: string;
  notes?: string;
}

export interface CalibrationMarkFeature {
  type: 'Feature';
  properties: {
    id: string;
    name: string;
    kind: CalibrationMarkKind;
    observed_depth_m: number | null;
    rain_mm_hr: number;
    duration_min: number;
    antecedent_5d_mm: number;
    notes: string;
    updated_by: string;
    updated_at: string;
  };
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

export interface CascadeSimParams {
  rainMmHr: number;
  durationMin: number;
  progress: number;
  soilMoisture: SoilMoisture;
  rainPattern: RainPattern;
  drainCondition: DrainCondition;
  forestScenario: ForestScenario;
  hyetograph?: HyetographType;
  antecedent5dMm?: number;
  orographicPctPerKm?: number;
  stormCore?: [number, number] | null;
  culvertBlockagePct?: number;
  structureBlockageOverrides?: Record<string, number>;
  debrisCoupling?: DebrisCouplingMode;
  calibrationProfile?: CalibrationProfile | null;
}

export interface EnsembleRange {
  p10: number;
  p50: number;
  p90: number;
}

export interface InputCoverageStats {
  insideReaches: number;
  verifiedReaches: number;
  measuredReaches: number;
  totalCrossings: number;
  verifiedCrossings: number;
  measuredCrossings: number;
  hwmCount: number;
  isCalibrated: boolean;
}

export interface HydrographPoint {
  timeMin: number;
  rainMmHr: number;
  qP10: number;
  qP50: number;
  qP90: number;
  qBulkP50: number;
  isRecession: boolean;
}

export interface ValidationMetrics {
  scourCsi: number | null;
  scourPod: number | null;
  scourFar: number | null;
  scourSampleCount: number;
  landslideAuc: number | null;
  landslidePod: number | null;
  landslideCsi: number | null;
  hwmRmseM: number | null;
  hwmHitRatePct: number | null;
  hwmCount: number;
  validationSplit?: 'all' | 'calibration' | 'holdout';
}

export interface WaterBalanceSummary {
  rainInputMm: number;
  interceptionMm: number;
  totalRunoffMm: number;
  soilStorageDeltaMm: number;
  deepPercolationMm: number;
  closureErrorMm: number;
  closureErrorPct: number;
}

export interface CascadeKpis {
  stage: 0 | 1 | 2 | 3 | 4;
  alertLevel: CascadeAlertLevel;
  elapsedMin: number;
  totalWindowMin: number;
  isRecession: boolean;
  accumulatedMm: number;
  effectiveRunoffMm: number;
  floodAreaHa: number;
  landslideAreaHa: number;
  affectedBuildingsFlood: number;
  affectedBuildingsDeep: number;
  affectedBuildingsLandslide: number;
  representativeStageM: number;
  representativeStageP10M: number;
  representativeStageP90M: number;
  chokeCount: number;
  reductionPct: number;
  peakTravelMin: number;
  runoffIndex: number;
  officialLandslideOverlapPct: number;
  peakDischargeM3s: number;
  maxStreamPowerWm2: number;
  meanSedimentCv: number;
  scourReachCount: number;
  dataConfidenceScore: number;
  dataConfidenceLevel: DataConfidenceLevel;
  inputCoverage?: InputCoverageStats;
  runoutAreaHa?: number;
  ensemble: {
    floodAreaHa: EnsembleRange;
    landslideAreaHa: EnsembleRange;
    affectedBuildingsFlood: EnsembleRange;
    affectedBuildingsLandslide: EnsembleRange;
    peakDischargeM3s: EnsembleRange;
  };
  hydrograph: HydrographPoint[];
  validation: ValidationMetrics;
  waterBalance?: WaterBalanceSummary;
}

export interface LandCoverStats {
  source: string;
  forestPct: number;
  shrubGrassPct: number;
  croplandPct: number;
  builtupPct: number;
  barePct: number;
  waterPct: number;
}

export interface ScourStats {
  source: string;
  preDate: string;
  postDate: string;
  preSceneId: string;
  postSceneId: string;
  clearCoveragePct: number;
  totalScourHa: number;
  severeScourHa: number;
  corridorScourHa: number;
}

export interface SettlementStats {
  osmBuildings: number;
  googleOpenBuildingsAdded: number;
  totalBuildings: number;
  residentialZones: number;
  openBuildingsConfidenceMin: number;
}

export interface AgamSummaryStats {
  andosolPct: number;
  officialHighPct: number;
  officialMedPct: number;
  officialLowPct: number;
  hutanLindungPct: number;
}

export interface AgamStats extends AgamSummaryStats {
  source: string;
  rbiRiversCount: number;
}

export interface AgamContextData {
  source: string;
  bbox: BBox;
  landslideHazard: GeoFeatureCollection;
  forestStatus: GeoFeatureCollection;
  soil: GeoFeatureCollection;
  geology: GeoFeatureCollection;
  morphology: GeoFeatureCollection;
  rainfallZone: GeoFeatureCollection;
}

export interface AgamPointProfile {
  landslideLevel: string | null;
  forestStatus: string | null;
  forestLabel: string | null;
  soilType: string | null;
  soilSensitivity: string | null;
  geology: string | null;
  morphology: string | null;
  rainfallAnnualMm: string | null;
}

export interface DatasetMetadata {
  generatedAt: string;
  center: [number, number];
  bbox: BBox;
  demSource: string;
  gridDimensions: string;
  resolutionMeters: number;
  minElevM: number;
  maxElevM: number;
  studyAreaKm2: number;
  streamNetworkKm: number;
  osmPlaceCount: number;
  osmWaterwayCount: number;
  osmRoadCount: number;
  buildingCount?: number;
  residentialZoneCount?: number;
  crossingsDetected: number;
  bridgesDetected: number;
  simAreasHa: SimAreasHa;
  verifiedWaterwayCount?: number;
  hydroConditioned?: boolean;
  hydroRecomputedAt?: string;
  burnedCellCount?: number;
  landCoverStats?: LandCoverStats;
  scourStats?: ScourStats;
  settlementStats?: SettlementStats;
  agamStats?: AgamStats;
  nagariBoundarySource?: string;
  licenses: { name: string; license: string }[];
}

export interface HydroStatus {
  dirty: boolean;
  lastRecomputedAt: string | null;
  burnedCellCount: number;
  verifiedWaterwayCount: number;
}

export interface RaindropTrace {
  coordinates: [number, number][];
  startElev: number;
  endElev: number;
  dropM: number;
  lengthM: number;
  avgSlopePct: number;
  snappedToWaterway?: string;
}

export interface ProfileSample {
  dist: number;
  elev: number;
  lng: number;
  lat: number;
}

export interface ElevationProfileResult {
  samples: ProfileSample[];
  totalDistM: number;
  minElev: number;
  maxElev: number;
  maxSlopePct: number;
}

export interface CommunityFeature {
  type: 'Feature';
  properties: {
    id: string;
    name: string;
    category: FeatureCategory;
    status: DrainageStatus;
    notes: string;
    createdAt: string;
  };
  geometry:
    | { type: 'Point'; coordinates: [number, number] }
    | { type: 'LineString'; coordinates: [number, number][] };
}

export interface LayerToggles {
  verifiedWaterways: boolean;
  structures: boolean;
  unverifiedCrossings: boolean;
  settlements: boolean;
  landCover: boolean;
  scourChange: boolean;
  agamLandslide: boolean;
  agamRbiRivers: boolean;
  agamForestStatus: boolean;
  agamSoilGeology: boolean;
  hillshade: boolean;
  das: boolean;
  contours: boolean;
  slope: boolean;
  osmContext: boolean;
  landslide: boolean;
  evac: boolean;
}

export interface VerifiedStructureFeature {
  type: 'Feature';
  properties: {
    id: string;
    name: string;
    kind: StructureKind;
    status: Exclude<DrainageStatus, 'unverified'>;
    source: StructureSource;
    source_ref: string | null;
    size_note: string;
    opening_width_m?: number | null;
    opening_height_m?: number | null;
    default_blockage_pct?: number | null;
    notes: string;
    updated_by: string;
    updated_at: string;
  };
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

export interface VerifiedWaterwayFeature {
  type: 'Feature';
  properties: {
    id: string;
    name: string;
    kind: WaterwayKind;
    status: DrainageStatus;
    source: WaterwaySource;
    source_ref: string | null;
    notes: string;
    length_m: number;
    width_pre_m?: number | null;
    width_post_m?: number | null;
    depth_m?: number | null;
    updated_by: string;
    updated_at: string;
  };
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
}

export type JorongBoundaryStatus = 'indicative' | 'verified';

export interface JorongBoundaryFeature {
  type: 'Feature';
  properties: {
    id: string;
    name: string;
    status: JorongBoundaryStatus;
    source_note: string;
    area_ha: number;
    updated_by: string;
    updated_at: string;
  };
  geometry: {
    type: 'Polygon';
    coordinates: [number, number][][];
  };
}

export interface SuppressedDemSegment {
  seg_id: string;
  reason: string;
  replaced_by_waterway_id: string | null;
  updated_by: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: number;
  created_at: string;
  actor: string;
  action: 'seed' | 'create' | 'update' | 'delete' | 'promote_dem' | 'suppress_dem' | 'restore_dem' | 'revert' | 'resolve_suggestion' | string;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  reason: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reverted_log_id: number | null;
}

export type SuggestionStatus = 'open' | 'reviewing' | 'resolved' | 'rejected';

export interface CitizenSuggestion {
  id: number;
  created_at: string;
  reporter_name: string;
  contact: string;
  category: string;
  location_name: string;
  message: string;
  lng: number | null;
  lat: number | null;
  status: SuggestionStatus;
  resolution_note: string;
  resolved_at: string | null;
}

export interface EditorStatus {
  requiresPassphrase: boolean;
  unlockedByDefault: boolean;
}

export interface ExportBundle {
  exportedAt: string;
  verifiedWaterways: { type: 'FeatureCollection'; features: VerifiedWaterwayFeature[] };
  verifiedStructures?: { type: 'FeatureCollection'; features: VerifiedStructureFeature[] };
  jorongBoundaries?: { type: 'FeatureCollection'; features: JorongBoundaryFeature[] };
  calibrationMarks?: { type: 'FeatureCollection'; features: CalibrationMarkFeature[] };
  calibrationProfile?: CalibrationProfile | null;
  suppressedDem: SuppressedDemSegment[];
  auditLogs: AuditLogEntry[];
  suggestionsCount: number;
}
