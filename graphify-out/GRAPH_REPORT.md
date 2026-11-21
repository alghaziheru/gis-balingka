# Graph Report - gis-balingka  (2026-11-21)

## Corpus Check
- Corpus is ~35,469 words - fits in a single context window. You may not need a graph.

## Summary
- 299 nodes · 752 edges · 10 communities (9 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- UI Panels & Field Mapping
- Hydrology & Raster Pipeline
- Package & Dependencies
- SQLite Store & HTTP API
- App State & Modals
- TypeScript Configuration
- MapLibre 2D/3D Engine
- Client DEM & Elevation Profile
- Architecture & Documentation

## God Nodes (most connected - your core abstractions)
1. `App()` - 35 edges
2. `Language` - 29 edges
3. `compilerOptions` - 16 edges
4. `main()` - 15 edges
5. `I18N` - 14 edges
6. `lucide-react` - 13 edges
7. `react` - 13 edges
8. `MapViewProps` - 12 edges
9. `DemClient` - 12 edges
10. `apiFetch()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `GIS Nagari Balingka — Medan, Drainase & Mitigasi Galodo` --semantically_similar_to--> `Nagari Balingka Community GIS`  [INFERRED] [semantically similar]
  index.html → README.md
- `App()` --calls--> `FieldMappingTab()`  [EXTRACTED]
  src/App.tsx → src/components/FieldMappingTab.tsx
- `App()` --calls--> `MapView()`  [EXTRACTED]
  src/App.tsx → src/components/MapView.tsx
- `loadAll()` --calls--> `DemClient`  [EXTRACTED]
  src/App.tsx → src/lib/demClient.ts
- `EditorUnlockModalProps` --references--> `Language`  [EXTRACTED]
  src/components/EditorUnlockModal.tsx → src/types/gis.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Community Waterway Correction and Hydro-Reconditioning Loop** — readme_citizen_suggestion_box, readme_two_layer_waterway_correction, readme_sqlite_audit_trail, readme_stream_burning_pipeline, readme_hand_flood_simulator [INFERRED 0.85]

## Communities (10 total, 1 thin omitted)

### Community 0 - "UI Panels & Field Mapping"
Cohesion: 0.10
Nodes (49): lucide-react, ACTION_BADGE, AuditLogPanel(), AuditLogPanelProps, canRevertLog(), summarizeDiff(), DrainageTabProps, EditorUnlockModalProps (+41 more)

### Community 1 - "Hydrology & Raster Pipeline"
Cohesion: 0.09
Nodes (44): burnStreamsIntoDem(), cellToLngLat(), chaikinSmooth(), clamp255(), computeD8(), computeHAND(), computeSlopePercent(), crc32() (+36 more)

### Community 2 - "Package & Dependencies"
Cohesion: 0.06
Nodes (40): dependencies, lucide-react@^1.77.0, maplibre-gl@^6.19.0, react@^19.3.1, react-dom@^19.3.1, description, devDependencies, geotiff@^3.0.5 (+32 more)

### Community 3 - "SQLite Store & HTTP API"
Cohesion: 0.08
Nodes (25): computeLineLengthMeters(), createStore(), appendAudit(), seedFromOsmIfNeeded(), DEFAULT_DB_PATH, DEFAULT_SEED_PATH, __dirname, haversineMeters() (+17 more)

### Community 4 - "App State & Modals"
Cohesion: 0.15
Nodes (36): App(), loadAll(), DrainageTab(), EditorUnlockModal(), ElevationProfileModal(), OssLicenseModal(), SimulationTab(), TelemetryDock() (+28 more)

### Community 5 - "TypeScript Configuration"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+9 more)

### Community 6 - "MapLibre 2D/3D Engine"
Cohesion: 0.19
Nodes (14): asGeoInput(), EMPTY_FC, escapeHtml(), FlyRequest, HAND_LAYERS, interpolateLine(), LoadedDatasets, MapGeoInput (+6 more)

### Community 7 - "Client DEM & Elevation Profile"
Cohesion: 0.27
Nodes (6): ElevationProfileModalProps, DemClient, haversineMeters(), DemGridData, ElevationProfileResult, ProfileSample

### Community 8 - "Architecture & Documentation"
Cohesion: 0.27
Nodes (11): GIS Nagari Balingka — Medan, Drainase & Mitigasi Galodo, index.html SPA Root Entry, Public Citizen Suggestion Box (Kotak Saran), CutSheetRX Surface Switcher (Medan & Aliran), Drainage Conditions & Map-Linked Mitigation (Drainase & Aksi), November 2025 Flood Replay & HAND Simulator (Simulasi 2025), Nagari Balingka Community GIS, Balingka GIS REST API (/api/*) (+3 more)

## Knowledge Gaps
- **2 isolated node(s):** `CutSheetRX Surface Switcher (Medan & Aliran)`, `index.html SPA Root Entry`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 68 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `geotiff` connect `Package & Dependencies` to `Hydrology & Raster Pipeline`?**
  _High betweenness centrality (0.365) - this node is a cross-community bridge._
- **What connects `CutSheetRX Surface Switcher (Medan & Aliran)`, `index.html SPA Root Entry` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UI Panels & Field Mapping` be split into smaller, more focused modules?**
  _Cohesion score 0.10087045570916539 - nodes in this community are weakly interconnected._
- **Why does `react` connect `Package & Dependencies` to `UI Panels & Field Mapping`, `App State & Modals`, `MapLibre 2D/3D Engine`, `Client DEM & Elevation Profile`?**
  _High betweenness centrality (0.189) - this node is a cross-community bridge._
- **Should `Hydrology & Raster Pipeline` be split into smaller, more focused modules?**
  _Cohesion score 0.0859538784067086 - nodes in this community are weakly interconnected._
- **Why does `lucide-react` connect `UI Panels & Field Mapping` to `Package & Dependencies`, `App State & Modals`?**
  _High betweenness centrality (0.169) - this node is a cross-community bridge._
- **Should `Package & Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06025369978858351 - nodes in this community are weakly interconnected._