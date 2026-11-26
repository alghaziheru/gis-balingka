import type { RoutedReachState } from './reachRouter';
import type { CascadeKpis, CascadeSimParams, SimNetworkData } from '../types/gis';

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Exports simulated rainfall hyetograph and routed channel discharge ensemble as RFC-4180 CSV.
 */
export function buildHydrographCsv(kpis: CascadeKpis): string {
  const header = [
    'time_min',
    'time_hr',
    'phase',
    'rain_mm_hr',
    'q_clear_nominal_m3s',
    'q_bulked_nominal_m3s',
    'q_sensitivity_low_m3s',
    'q_sensitivity_high_m3s'
  ].join(',');
  const rows = kpis.hydrograph.map(pt =>
    [
      pt.timeMin,
      (pt.timeMin / 60).toFixed(2),
      pt.isRecession ? 'recession' : 'storm',
      pt.rainMmHr.toFixed(1),
      pt.qP50.toFixed(2),
      pt.qBulkP50.toFixed(2),
      pt.qP10.toFixed(2),
      pt.qP90.toFixed(2)
    ].join(',')
  );
  return [header, ...rows].join('\n') + '\n';
}

/**
 * Exports active scenario parameters, summary KPIs, hydrograph, and reach-level hydraulic diagnostics as JSON.
 */
export function buildScenarioExportJson(
  params: CascadeSimParams,
  kpis: CascadeKpis,
  network: SimNetworkData | null,
  routed: RoutedReachState | null
): string {
  const reachesSummary =
    network && routed
      ? network.reaches
          .filter(r => r.insideNagariFrac >= 0.1)
          .map(r => ({
            reachId: r.id,
            waterwayId: r.verifiedWaterwayId,
            waterwayName: r.waterwayName,
            upstreamAreaKm2: r.upstreamAreaKm2,
            slope: r.slope,
            measuredWidthM: r.measuredWidthM,
            measuredDepthM: r.measuredDepthM,
            dataConfidence: r.dataConfidence,
            qWaterM3s: Number((routed.qWater[r.id] || 0).toFixed(2)),
            qBulkM3s: Number((routed.qBulk[r.id] || 0).toFixed(2)),
            stageNormalM: Number((routed.stageNormal[r.id] || 0).toFixed(2)),
            backwaterHeadM: Number((routed.backwaterHead[r.id] || 0).toFixed(2)),
            sedimentCv: Number((routed.sedimentCv[r.id] || 0).toFixed(3)),
            streamPowerWm2: Math.round(routed.streamPowerWm2[r.id] || 0)
          }))
      : [];

  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      modelNotice:
        'Exploratory open-literature screening simulation (uncalibrated against live stream gauges). Not an official BNPB/BPBD/BMKG hazard forecast.',
      params,
      kpis,
      reaches: reachesSummary
    },
    null,
    2
  );
}

/**
 * Generates a prioritized field-survey checklist CSV for Karang Taruna, Nagari staff, and university teams
 * targeting the highest-drainage-area unmeasured crossings and river reaches first.
 */
export function buildFieldSurveyPriorityCsv(network: SimNetworkData | null): string {
  const header = [
    'priority_rank',
    'feature_type',
    'id',
    'name',
    'lng',
    'lat',
    'upstream_area_km2',
    'current_assumption',
    'observed_width_m',
    'observed_height_or_depth_m',
    'condition_status',
    'blockage_pct',
    'surveyor_name',
    'survey_date',
    'notes'
  ].join(',');

  if (!network) return header + '\n';

  const reachById = new Map(network.reaches.map(r => [r.id, r]));

  const crossingRows = network.crossings
    .filter(c => !c.measuredOpening)
    .map(c => {
      const reach = reachById.get(c.reachId);
      return {
        featureType: 'crossing',
        id: c.id,
        name: c.name,
        lng: c.coords[0],
        lat: c.coords[1],
        upstreamKm2: reach ? reach.upstreamAreaKm2 : 0,
        assumption: `${c.kind}; assumed_qCap=${c.qCapM3s.toFixed(1)}m3s; verified=${c.verified}`
      };
    })
    .sort((a, b) => b.upstreamKm2 - a.upstreamKm2)
    .slice(0, 25);

  const reachRows = network.reaches
    .filter(r => r.insideNagariFrac >= 0.15 && (r.measuredWidthM == null || r.measuredDepthM == null))
    .map(r => ({
      featureType: 'river_reach',
      id: r.verifiedWaterwayId || `reach-${r.id}`,
      name: r.waterwayName || `Alur DEMNAS #${r.id + 1}`,
      lng: r.midCoord[0],
      lat: r.midCoord[1],
      upstreamKm2: r.upstreamAreaKm2,
      assumption: `slope=${(r.slope * 100).toFixed(1)}%; regional hydraulic geometry prior`
    }))
    .sort((a, b) => b.upstreamKm2 - a.upstreamKm2)
    .slice(0, 20);

  const combined = [...crossingRows, ...reachRows];
  const lines = combined.map((item, idx) =>
    [
      idx + 1,
      item.featureType,
      csvEscape(item.id),
      csvEscape(item.name),
      item.lng.toFixed(6),
      item.lat.toFixed(6),
      item.upstreamKm2.toFixed(3),
      csvEscape(item.assumption),
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ].join(',')
  );

  return [header, ...lines].join('\n') + '\n';
}

export function triggerBrowserDownload(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
