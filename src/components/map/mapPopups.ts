import type { MutableRefObject } from 'react';
import { Popup, type Map as MapLibreMap, type MapGeoJSONFeature } from 'maplibre-gl';
import { isPointInNagari, lookupAgamAtPoint } from '../../lib/agamLookup';
import type { CascadeEngine } from '../../lib/cascadeEngine';
import type { DemClient } from '../../lib/demClient';
import type {
  AgamContextData,
  CascadeSimParams,
  GeoFeatureCollection,
  GeoProperties,
  Language,
  StructureKind,
  VerifiedStructureFeature,
  VerifiedWaterwayFeature,
  ViewMode,
  WaterwayKind
} from '../../types/gis';
import { escapeHtml, subsampleCoordsForEditing } from './types';

export interface MapPopupContext {
  map: MapLibreMap;
  popupRef: MutableRefObject<Popup | null>;
  lang: Language;
  viewMode: ViewMode;
  demClient: DemClient;
  editorUnlocked: boolean;
  apiAvailable: boolean;
  requiresPassphrase: boolean;
  onVerifyCrossing: (
    draftId: string,
    coords: [number, number],
    suggestedName: string,
    suggestedKind: StructureKind
  ) => void;
  onOpenUnlock: () => void;
  onSelectStructure: (feature: VerifiedStructureFeature) => void;
  onSelectWaterway: (feature: VerifiedWaterwayFeature) => void;
  onRedrawDemSegment: (segId: string) => void;
  onPromoteDemSegment: (segId: string, coords: [number, number][]) => void;
  onSuppressDemSegment: (segId: string) => void;
  onPromoteRbiRiver: (name: string, kind: WaterwayKind, coords: [number, number][]) => void;
}

export function openGenericPointPopup(
  ctx: MapPopupContext,
  lngLat: [number, number],
  p: GeoProperties | undefined,
  isCommunity = false
): void {
  const { map, popupRef } = ctx;
  if (!p) return;
  if (popupRef.current) popupRef.current.remove();

  const isEn = ctx.lang === 'en';
  const isDetail = ctx.viewMode === 'detail';
  const name = isEn ? p.name_en || p.name : p.name_id || p.name;
  const desc = isEn ? p.desc_en || p.notes || '' : p.desc_id || p.notes || '';
  const status = String(p.status || 'normal');

  const badgeColors: Record<string, string> = {
    unverified: 'background:rgba(100,116,139,0.14);color:#475569',
    normal: 'background:rgba(4,120,87,0.12);color:#047857',
    clogged: 'background:rgba(180,83,9,0.14);color:#b45309',
    damaged: 'background:rgba(194,65,12,0.14);color:#c2410c',
    critical: 'background:rgba(185,28,28,0.14);color:#b91c1c'
  };
  const statusNames: Record<string, { id: string; en: string }> = {
    unverified: { id: 'Perlu Cek Lapangan', en: 'Needs Field Check' },
    normal: { id: 'Normal', en: 'Normal' },
    clogged: { id: 'Tersumbat', en: 'Clogged' },
    damaged: { id: 'Rusak', en: 'Damaged' },
    critical: { id: 'Rusak Berat', en: 'Severe' }
  };
  const isSteepSlopePoint = p.kind === 'landslide';
  const isElevatedFacility = p.kind === 'evacuation';
  const st = statusNames[status] || statusNames.unverified;
  const badgeStyle = isSteepSlopePoint
    ? 'background:rgba(180,83,9,0.14);color:#b45309'
    : isElevatedFacility
    ? 'background:rgba(4,120,87,0.12);color:#047857'
    : badgeColors[status] || badgeColors.unverified;
  const badgeText = isSteepSlopePoint
    ? isEn
      ? 'DEMNAS Slope Data'
      : 'Data Kemiringan DEMNAS'
    : isElevatedFacility
    ? isEn
      ? 'Official BIG RBI 50K'
      : 'Data Resmi BIG RBI 50K'
    : isEn
    ? st.en
    : st.id;
  const tagText = isCommunity
    ? isEn
      ? 'Resident Note (Local)'
      : 'Catatan Warga (Lokal)'
    : isSteepSlopePoint
    ? isEn
      ? 'Terrain Geometry Point · BIG DEMNAS 8m'
      : 'Titik Geometri Elevasi · BIG DEMNAS 8m'
    : isElevatedFacility
    ? isEn
      ? 'Elevated Public Facility · Not an Official Evacuation Designation'
      : 'Fasilitas Umum Elevasi Tinggi · Bukan Penetapan Evakuasi Resmi'
    : status === 'unverified'
    ? isEn
      ? 'DEM Road–Channel Crossing / Reference Point (Unverified)'
      : 'Titik Silang Jalan–Alur DEM / Data Referensi (Belum Dicek)'
    : isEn
    ? 'Field Survey / Monitored Point'
    : 'Titik Pantau Lapangan';
  const elev = Math.round(ctx.demClient.getElevation(lngLat[0], lngLat[1]));

  const canVerifyCrossing =
    p.kind === 'drainage' && status === 'unverified' && ctx.editorUnlocked && ctx.apiAvailable;
  const canUnlockCrossing =
    p.kind === 'drainage' &&
    status === 'unverified' &&
    !ctx.editorUnlocked &&
    ctx.apiAvailable &&
    ctx.requiresPassphrase;

  const actionBtnHtml = canVerifyCrossing
    ? `<button id="popup-verify-crossing" type="button" style="margin-top:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#0369a1;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">
        ${isEn ? 'Verify as Culvert / Bridge' : 'Verifikasi sebagai Gorong-gorong / Jembatan'}
      </button>`
    : canUnlockCrossing
    ? `<button id="popup-unlock-crossing" type="button" style="margin-top:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#fff;color:#0369a1;font-size:12px;font-weight:700;cursor:pointer;">
        ${isEn ? 'Unlock Editor to Verify Point' : 'Buka Editor untuk Verifikasi Titik'}
      </button>`
    : '';

  const html = `
    <div>
      <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-bottom:6px;${badgeStyle}">
        ${escapeHtml(badgeText)}
      </span>
      <h4 style="margin:0 0 4px;font-size:14px;font-weight:700;color:#161c1a;">${escapeHtml(name)}</h4>
      <div style="margin-bottom:6px;font-size:11.5px;font-weight:600;color:#636f6a;">
        ${escapeHtml(tagText)}
      </div>
      ${desc ? `<p style="margin:0 0 8px;font-size:12.5px;line-height:1.45;color:#434d49;">${escapeHtml(desc)}</p>` : ''}
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#636f6a;">
        ${isDetail ? `${lngLat[1].toFixed(5)}, ${lngLat[0].toFixed(5)} · ` : ''}~${elev} mdpl
      </div>
      ${actionBtnHtml}
    </div>
  `;

  const pop = new Popup({ offset: 12 }).setLngLat(lngLat).setHTML(html).addTo(map);
  popupRef.current = pop;
  if (canVerifyCrossing) {
    pop.getElement()?.querySelector('#popup-verify-crossing')?.addEventListener('click', () => {
      pop.remove();
      const draftId = String(p.id || '');
      const suggestedKind: StructureKind =
        draftId.startsWith('br-') || draftId.startsWith('big-br-') ? 'bridge' : 'culvert';
      ctx.onVerifyCrossing(draftId, lngLat, String(name || ''), suggestedKind);
    });
  } else if (canUnlockCrossing) {
    pop.getElement()?.querySelector('#popup-unlock-crossing')?.addEventListener('click', () => {
      pop.remove();
      ctx.onOpenUnlock();
    });
  }
}

export function openVerifiedStructurePopup(
  ctx: MapPopupContext,
  lngLat: [number, number],
  propsObj: GeoProperties,
  verifiedStructures: VerifiedStructureFeature[]
): void {
  const { map, popupRef } = ctx;
  if (popupRef.current) popupRef.current.remove();
  const isEn = ctx.lang === 'en';
  const stId = String(propsObj.id || '');
  const fullSt = verifiedStructures.find(s => s.properties.id === stId);
  const canEdit = ctx.editorUnlocked && ctx.apiAvailable && Boolean(fullSt);
  const canUnlock = !ctx.editorUnlocked && ctx.apiAvailable && ctx.requiresPassphrase;
  const isDetail = ctx.viewMode === 'detail';
  const kindLabel =
    propsObj.kind === 'bridge'
      ? isEn
        ? 'Bridge'
        : 'Jembatan'
      : isEn
      ? 'Culvert'
      : 'Gorong-gorong';
  const statusLabels: Record<string, { id: string; en: string; color: string; bg: string }> = {
    normal: { id: 'Normal', en: 'Normal', color: '#047857', bg: 'rgba(4,120,87,0.12)' },
    clogged: { id: 'Tersumbat', en: 'Clogged', color: '#b45309', bg: 'rgba(180,83,9,0.14)' },
    damaged: { id: 'Rusak', en: 'Damaged', color: '#c2410c', bg: 'rgba(194,65,12,0.14)' },
    critical: { id: 'Rusak Berat', en: 'Severe', color: '#b91c1c', bg: 'rgba(185,28,28,0.14)' }
  };
  const stInfo = statusLabels[String(propsObj.status)] || statusLabels.normal;
  let actionHtml = '';
  if (canEdit) {
    actionHtml = `<button id="popup-edit-st" type="button" style="margin-top:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#0369a1;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">
      ${isEn ? 'Edit Culvert / Bridge' : 'Edit Titik Gorong-gorong'}
    </button>`;
  } else if (canUnlock) {
    actionHtml = `<button id="popup-unlock-st" type="button" style="margin-top:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#fff;color:#0369a1;font-size:12px;font-weight:700;cursor:pointer;">
      ${isEn ? 'Unlock Editor to Edit' : 'Buka Editor untuk Edit'}
    </button>`;
  }
  const html = `
    <div>
      <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-bottom:6px;background:${stInfo.bg};color:${stInfo.color};">
        ${escapeHtml(isEn ? stInfo.en : stInfo.id)} · ${escapeHtml(isEn ? 'Verified' : 'Terverifikasi')}
      </span>
      <h4 style="margin:0 0 4px;font-size:14px;font-weight:700;color:#161c1a;">${escapeHtml(propsObj.name)}</h4>
      <div style="font-size:12.5px;color:#434d49;margin-bottom:6px;">
        ${escapeHtml(kindLabel)}${propsObj.size_note ? ` · ${escapeHtml(propsObj.size_note)}` : ''}
      </div>
      ${propsObj.notes ? `<p style="margin:0 0 6px;font-size:12.5px;line-height:1.45;color:#434d49;">${escapeHtml(propsObj.notes)}</p>` : ''}
      ${isDetail && propsObj.updated_by ? `<div style="font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#636f6a;">${escapeHtml(propsObj.updated_by)}</div>` : ''}
      ${actionHtml}
    </div>
  `;
  const pop = new Popup({ offset: 12 }).setLngLat(lngLat).setHTML(html).addTo(map);
  popupRef.current = pop;
  if (canEdit && fullSt) {
    pop.getElement()?.querySelector('#popup-edit-st')?.addEventListener('click', () => {
      pop.remove();
      ctx.onSelectStructure(fullSt);
    });
  } else if (canUnlock) {
    pop.getElement()?.querySelector('#popup-unlock-st')?.addEventListener('click', () => {
      pop.remove();
      ctx.onOpenUnlock();
    });
  }
}

export function openVerifiedWaterwayPopup(
  ctx: MapPopupContext,
  lngLat: [number, number],
  propsObj: GeoProperties,
  verifiedWaterways: VerifiedWaterwayFeature[]
): void {
  const { map, popupRef } = ctx;
  if (popupRef.current) popupRef.current.remove();
  const isEn = ctx.lang === 'en';
  const wwId = String(propsObj.id || '');
  const fullFeat = verifiedWaterways.find(w => w.properties.id === wwId);
  const canEdit = ctx.editorUnlocked && ctx.apiAvailable && Boolean(fullFeat);
  const canUnlock = !ctx.editorUnlocked && ctx.apiAvailable && ctx.requiresPassphrase;
  const isDetail = ctx.viewMode === 'detail';
  const kindLabels: Record<string, { id: string; en: string }> = {
    river: { id: 'Sungai Utama', en: 'River' },
    stream: { id: 'Anak Sungai', en: 'Stream' },
    canal: { id: 'Bandar / Irigasi', en: 'Canal' },
    drain: { id: 'Parit / Drainase', en: 'Drain' },
    culvert: { id: 'Gorong-gorong', en: 'Culvert' }
  };
  const statusLabels: Record<string, { id: string; en: string }> = {
    normal: { id: 'Normal', en: 'Normal' },
    clogged: { id: 'Tersumbat', en: 'Clogged' },
    damaged: { id: 'Rusak', en: 'Damaged' },
    critical: { id: 'Rusak Berat', en: 'Severe' }
  };
  const kLabel = kindLabels[String(propsObj.kind)]?.[isEn ? 'en' : 'id'] || String(propsObj.kind || '');
  const sLabel = statusLabels[String(propsObj.status)]?.[isEn ? 'en' : 'id'] || String(propsObj.status || '');
  let actionHtml = '';
  if (canEdit) {
    actionHtml = `<button id="popup-edit-ww" type="button" style="margin-top:6px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#0369a1;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">
      ${isEn ? 'Correct Alignment / Direction' : 'Koreksi Jalur & Arah'}
    </button>`;
  } else if (canUnlock) {
    actionHtml = `<button id="popup-unlock-ww" type="button" style="margin-top:6px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#fff;color:#0369a1;font-size:12px;font-weight:700;cursor:pointer;">
      ${isEn ? 'Unlock Editor to Correct' : 'Buka Editor untuk Koreksi'}
    </button>`;
  } else if (!ctx.apiAvailable) {
    actionHtml = `<div style="margin-top:6px;padding:6px 8px;border-radius:6px;background:#f2f3ef;font-size:11px;color:#434d49;">
      ${isEn ? 'Read-only preview: editing waterways & embedding into DEM requires the application server.' : 'Mode baca saja: pengeditan jalur sungai & penyisipan ke DEM hanya aktif saat terhubung ke server aplikasi.'}
    </div>`;
  }
  const html = `
    <div>
      <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-bottom:6px;background:rgba(3,105,161,0.12);color:#0369a1;">
        ${escapeHtml(isEn ? 'Verified Waterway' : 'Sungai / Saluran Terverifikasi')}
      </span>
      <h4 style="margin:0 0 4px;font-size:14px;font-weight:700;color:#161c1a;">${escapeHtml(propsObj.name)}</h4>
      <div style="font-size:12.5px;color:#434d49;margin-bottom:6px;">
        ${escapeHtml(kLabel)} · ${escapeHtml(sLabel)} · ${escapeHtml(propsObj.length_m)} m
      </div>
      ${propsObj.notes ? `<p style="margin:0 0 6px;font-size:12.5px;line-height:1.45;color:#434d49;">${escapeHtml(propsObj.notes)}</p>` : ''}
      ${isDetail && propsObj.updated_by ? `<div style="font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#636f6a;margin-bottom:6px;">${escapeHtml(propsObj.updated_by)}</div>` : ''}
      ${actionHtml}
    </div>
  `;
  const pop = new Popup({ offset: 12 }).setLngLat(lngLat).setHTML(html).addTo(map);
  popupRef.current = pop;
  if (canEdit && fullFeat) {
    pop.getElement()?.querySelector('#popup-edit-ww')?.addEventListener('click', () => {
      pop.remove();
      ctx.onSelectWaterway(fullFeat);
    });
  } else if (canUnlock) {
    pop.getElement()?.querySelector('#popup-unlock-ww')?.addEventListener('click', () => {
      pop.remove();
      ctx.onOpenUnlock();
    });
  }
}

export function openDemFlowPopup(
  ctx: MapPopupContext,
  lngLat: [number, number],
  propsObj: GeoProperties,
  flowPaths: GeoFeatureCollection
): void {
  const { map, popupRef } = ctx;
  if (popupRef.current) popupRef.current.remove();
  const isEn = ctx.lang === 'en';
  const segId = String(propsObj.id || '');
  const rawFlow = flowPaths.features.find(f => String(f.properties?.id) === segId);
  const coords =
    rawFlow?.geometry.type === 'LineString' ? subsampleCoordsForEditing(rawFlow.geometry.coordinates, 18) : [];
  const canEdit = ctx.editorUnlocked && ctx.apiAvailable && coords.length >= 2;
  const canUnlock = !ctx.editorUnlocked && ctx.apiAvailable && ctx.requiresPassphrase;
  const isDetail = ctx.viewMode === 'detail';
  let flowActionHtml = '';
  if (canEdit) {
    flowActionHtml = `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
      <button id="popup-redraw-dem" type="button" style="padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#0369a1;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">
        ${isEn ? 'Trace Real River Fresh' : 'Gambar Ulang Sungai Asli'}
      </button>
      <button id="popup-promote-dem" type="button" style="padding:6px 10px;border-radius:8px;border:1px solid #0369a1;background:#fff;color:#0369a1;font-size:12px;font-weight:700;cursor:pointer;">
        ${isEn ? 'Adjust Existing Vertices' : 'Geser Titik Jalur'}
      </button>
      <button id="popup-suppress-dem" type="button" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(22,28,26,0.2);background:#fff;color:#b91c1c;font-size:12px;font-weight:700;cursor:pointer;">
        ${isEn ? 'Mark False & Hide Segment' : 'Tandai Keliru & Sembunyikan'}
      </button>
    </div>`;
  } else if (canUnlock) {
    flowActionHtml = `<button id="popup-unlock-dem" type="button" style="margin-top:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#fff;color:#0369a1;font-size:12px;font-weight:700;cursor:pointer;">
      ${isEn ? 'Unlock Editor to Fix Path' : 'Buka Editor untuk Koreksi Jalur'}
    </button>`;
  } else if (!ctx.apiAvailable) {
    flowActionHtml = `<div style="margin-top:8px;padding:6px 8px;border-radius:6px;background:#f2f3ef;font-size:11px;color:#434d49;">
      ${isEn ? 'Read-only preview: correcting this estimated path requires the application server.' : 'Mode baca saja: koreksi garis perkiraan ini hanya aktif saat terhubung ke server aplikasi.'}
    </div>`;
  }
  const html = `
    <div>
      <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-bottom:6px;background:rgba(180,83,9,0.14);color:#b45309;">
        ${escapeHtml(isEn ? 'DEMNAS Elevation Computation' : 'Perkiraan Elevasi DEMNAS')}
      </span>
      <h4 style="margin:0 0 4px;font-size:13.5px;font-weight:700;color:#161c1a;">
        ${isDetail ? escapeHtml(segId) : escapeHtml(isEn ? 'Runoff Flow Path (DEM Estimate)' : 'Alur Limpasan Air (Perkiraan DEM)')}
      </h4>
      <p style="margin:0 0 6px;font-size:12.5px;line-height:1.45;color:#434d49;">
        ${
          isEn
            ? 'Mathematically computed (D8) from BIG DEMNAS 8m elevation — not a permanent river or field survey.'
            : 'Dihitung otomatis secara matematis (D8) dari elevasi BIG DEMNAS 8m — bukan sungai permanen maupun survei lapangan.'
        }
      </p>
      ${
        isDetail
          ? `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#636f6a;margin-bottom:6px;">
              DAS ~${escapeHtml(propsObj.catchment_ha)} ha · ${escapeHtml(propsObj.length_m)} m · ${escapeHtml(propsObj.slope_pct)}%
            </div>`
          : ''
      }
      ${flowActionHtml}
    </div>
  `;
  const pop = new Popup({ offset: 12 }).setLngLat(lngLat).setHTML(html).addTo(map);
  popupRef.current = pop;
  if (canEdit) {
    pop.getElement()?.querySelector('#popup-redraw-dem')?.addEventListener('click', () => {
      pop.remove();
      ctx.onRedrawDemSegment(segId);
    });
    pop.getElement()?.querySelector('#popup-promote-dem')?.addEventListener('click', () => {
      pop.remove();
      ctx.onPromoteDemSegment(segId, coords);
    });
    pop.getElement()?.querySelector('#popup-suppress-dem')?.addEventListener('click', () => {
      pop.remove();
      ctx.onSuppressDemSegment(segId);
    });
  } else if (canUnlock) {
    pop.getElement()?.querySelector('#popup-unlock-dem')?.addEventListener('click', () => {
      pop.remove();
      ctx.onOpenUnlock();
    });
  }
}

export function openAgamRbiPopup(
  ctx: MapPopupContext,
  lngLat: [number, number],
  propsObj: GeoProperties,
  geometry: MapGeoJSONFeature['geometry'] | null | undefined
): void {
  const { map, popupRef } = ctx;
  if (popupRef.current) popupRef.current.remove();
  const isEn = ctx.lang === 'en';
  const rbiName = String(propsObj.name || 'Anak Sungai RBI');
  const rbiKind: WaterwayKind = propsObj.kind === 'river' ? 'river' : 'stream';
  const rawCoords = (geometry?.type === 'LineString' ? geometry.coordinates : []) as [number, number][];
  const coords = rawCoords.map((c: [number, number]) => [Number(c[0]), Number(c[1])] as [number, number]);
  const canEdit = ctx.editorUnlocked && ctx.apiAvailable;
  const canUnlock = !ctx.editorUnlocked && ctx.apiAvailable && ctx.requiresPassphrase;
  const actionHtml = canEdit
    ? `<button id="popup-promote-rbi" type="button" style="margin-top:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#0369a1;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">
        ${isEn ? 'Promote to Verified Waterway' : 'Jadikan Jalur Air Terverifikasi'}
      </button>`
    : canUnlock
    ? `<button id="popup-unlock-rbi" type="button" style="margin-top:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#fff;color:#0369a1;font-size:12px;font-weight:700;cursor:pointer;">
        ${isEn ? 'Unlock Editor to Promote' : 'Buka Editor untuk Verifikasi'}
      </button>`
    : '';
  const html = `
    <div>
      <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-bottom:6px;background:rgba(14,116,144,0.14);color:#0e7490">
        Pemkab Agam · RBI 1:50k
      </span>
      <h4 style="margin:0 0 4px;font-size:14px;font-weight:700;color:#161c1a;">${escapeHtml(rbiName)}</h4>
      <div style="font-size:11.5px;color:#434d49;">DAS ${escapeHtml(propsObj.das || 'MASANG KIRI')}</div>
      ${actionHtml}
    </div>
  `;
  const pop = new Popup({ offset: 12 }).setLngLat(lngLat).setHTML(html).addTo(map);
  popupRef.current = pop;
  if (canEdit) {
    pop.getElement()?.querySelector('#popup-promote-rbi')?.addEventListener('click', () => {
      pop.remove();
      ctx.onPromoteRbiRiver(rbiName, rbiKind, coords);
    });
  } else if (canUnlock) {
    pop.getElement()?.querySelector('#popup-unlock-rbi')?.addEventListener('click', () => {
      pop.remove();
      ctx.onOpenUnlock();
    });
  }
}

export function openCorridorExplainPopup(
  map: MapLibreMap,
  popupRef: MutableRefObject<Popup | null>,
  lngLat: [number, number],
  opts: {
    lang: Language;
    demClient: DemClient;
    cascadeEngine: CascadeEngine;
    cascadeParams: CascadeSimParams;
  }
): void {
  if (popupRef.current) popupRef.current.remove();
  const isEn = opts.lang === 'en';
  const elev = Math.round(opts.demClient.getElevation(lngLat[0], lngLat[1]));
  const sample = opts.cascadeEngine.sampleAtLngLat(lngLat[0], lngLat[1]);
  const cp = opts.cascadeParams;
  const drainLabel =
    cp.drainCondition === 'cleared'
      ? isEn
        ? 'Cleared'
        : 'Lancar'
      : cp.drainCondition === 'surge'
        ? isEn
          ? 'Clogged + Surge'
          : 'Tersumbat + Gelombang'
        : isEn
          ? 'Clogged'
          : 'Tersumbat';
  const soilLabel =
    cp.soilMoisture === 'dry'
      ? isEn
        ? 'Dry'
        : 'Kering'
      : cp.soilMoisture === 'moist'
        ? isEn
          ? 'Moist'
          : 'Lembab'
        : isEn
          ? 'Saturated'
          : 'Jenuh';
  const html = `
    <div style="min-width:235px;max-width:290px;">
      <div style="font-size:11px;font-weight:700;color:#0369a1;margin-bottom:4px;padding-right:18px;line-height:1.35;">
        ${
          isEn
            ? 'Low-Lying River Corridor Zone (~40 m Model)'
            : 'Zona Elevasi Rendah Koridor Sungai (Model ~40 m)'
        }
      </div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#434d49;margin-bottom:6px;">
        ${elev} mdpl · HAND ~${sample.handM.toFixed(1)} m
      </div>
      <div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid rgba(22,28,26,0.08);font-size:11.5px;">
        <span style="color:#636f6a;">${isEn ? 'Scenario' : 'Skenario'}</span>
        <strong style="color:#161c1a;text-align:right;">${cp.rainMmHr} mm/${isEn ? 'hr' : 'jam'} · ${drainLabel} · ${soilLabel}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid rgba(22,28,26,0.08);font-size:11.5px;">
        <span style="color:#636f6a;">${isEn ? 'Effective runoff' : 'Limpasan efektif'}</span>
        <strong style="color:#161c1a;">~${Math.round(sample.runoffMm)} mm</strong>
      </div>
      <div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid rgba(22,28,26,0.08);font-size:11.5px;">
        <span style="color:#636f6a;">${isEn ? 'Indicative depth' : 'Kedalaman indikatif'}</span>
        <strong style="color:#0369a1;">~${sample.depthM.toFixed(1)} m</strong>
      </div>
      <div style="margin-top:6px;font-size:10.5px;line-height:1.4;color:#434d49;">
        ${
          isEn
            ? 'This shaded zone marks low-lying valley/river-corridor cells (~40 m grid) relative to the nearest drainage channel. When culverts clog during heavy rain, runoff can spread around this corridor. It is NOT a house-level flood survey or an official BNPB/BPBD/BMKG warning.'
            : 'Area biru ini menandakan koridor lembah/sungai yang elevasinya rendah terhadap alur air terdekat pada skala grid ~40 m. Bila gorong-gorong/saluran tersumbat saat hujan deras, limpasan berpotensi meluas ke sekitar area ini. Ini BUKAN pengukuran banjir per rumah dan bukan peringatan resmi BNPB/BPBD/BMKG.'
        }
      </div>
    </div>
  `;
  const pop = new Popup({ offset: 12, maxWidth: '320px' })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map);
  popupRef.current = pop;
}

export function openAgamPointAttributesPopup(
  map: MapLibreMap,
  popupRef: MutableRefObject<Popup | null>,
  pt: [number, number],
  opts: {
    lang: Language;
    demClient: DemClient;
    nagariBoundary: GeoFeatureCollection;
    agamContext: AgamContextData | null;
  }
): void {
  if (!isPointInNagari(opts.nagariBoundary, pt[0], pt[1])) return;
  const prof = lookupAgamAtPoint(opts.agamContext, pt[0], pt[1]);
  if (!prof) return;

  if (popupRef.current) popupRef.current.remove();
  const isEn = opts.lang === 'en';
  const elev = Math.round(opts.demClient.getElevation(pt[0], pt[1]));
  const slope = Math.round(opts.demClient.getSlopePercent(pt[0], pt[1]));
  const lsLevel =
    prof.landslideLevel ||
    (isEn
      ? 'Outside mapped polygon (not a safety guarantee)'
      : 'Tidak termasuk poligon peta (bukan jaminan aman)');
  const lsColor =
    prof.landslideLevel === 'Tinggi'
      ? '#b91c1c'
      : prof.landslideLevel === 'Sedang'
      ? '#b45309'
      : prof.landslideLevel === 'Rendah'
      ? '#3f6212'
      : '#636f6a';
  const row = (label: string, val: string | null) =>
    val
      ? `<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px solid rgba(22,28,26,0.08);font-size:12px;">
          <span style="color:#636f6a;flex-shrink:0;">${escapeHtml(label)}</span>
          <strong style="color:#161c1a;text-align:right;">${escapeHtml(val)}</strong>
        </div>`
      : '';

  const html = `
    <div style="min-width:220px;">
      <div style="font-size:11px;font-weight:700;color:#0369a1;margin-bottom:4px;">
        ${isEn ? 'Pemkab Agam Open Map Attributes' : 'Atribut Peta Terbuka Pemkab Agam'}
      </div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#434d49;margin-bottom:6px;">
        ${elev} mdpl · ${isEn ? 'Slope' : 'Lereng'} ${slope}%
      </div>
      <div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px solid rgba(22,28,26,0.08);font-size:12px;">
        <span style="color:#636f6a;">${isEn ? 'Ground Movement Map' : 'Peta Gerakan Tanah'}</span>
        <strong style="color:${lsColor};text-align:right;">${escapeHtml(lsLevel)}</strong>
      </div>
      ${row(isEn ? 'Soil Type' : 'Jenis Tanah', prof.soilType ? `${prof.soilType}${prof.soilSensitivity ? ` (${prof.soilSensitivity})` : ''}` : null)}
      ${row(isEn ? 'Geology' : 'Geologi', prof.geology)}
      ${row(isEn ? 'Forest SK 35' : 'Kawasan Hutan', prof.forestLabel ? `${prof.forestStatus} · ${prof.forestLabel}` : prof.forestStatus)}
      ${row(isEn ? 'BMKG Rainfall' : 'Curah Hujan', prof.rainfallAnnualMm)}
      <div style="margin-top:6px;font-size:10.5px;line-height:1.35;color:#636f6a;">
        ${escapeHtml(
          isEn
            ? 'Source: Pemkab Agam Open GIS (reference polygon attributes, not a house-level survey).'
            : 'Sumber: Pemkab Agam Open GIS (atribut poligon referensi, bukan pengukuran per rumah).'
        )}
      </div>
    </div>
  `;
  popupRef.current = new Popup({ offset: 10 }).setLngLat(pt).setHTML(html).addTo(map);
}
