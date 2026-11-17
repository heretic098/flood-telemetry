/**
 * Staff-gauge camera → telemetry station mapping (Issue #54, PR 1: data only).
 *
 * Maps cameras whose lens frames a physical metric board to the EA telemetry
 * station they sit closest to. Data only: no UI, no API, no inference.
 *
 * What a mapping means ([RULE-CAM-01] / [RULE-PROV-01]):
 * - It says "this camera is at/near this station". It does NOT say the board
 *   reads the same water body as the electronic sensor, and no board has a
 *   documented zero level (mAOD) in this repo. Never compute a board-vs-sensor
 *   delta or read a stage off an image from this data.
 * - `board_type` is taken from the repo owner's optical inspection (Issue #54
 *   comment): `water_stage` boards are read against the water surface;
 *   `gate_lift_indicator` is a position board on the dry pier, not a water gauge.
 *
 * Unmapped cameras are listed explicitly with a reason rather than guessed
 * ([RULE-HUM-01], [RULE-THRESH-01]). Station ids must exist in STATION_REGISTRY
 * and camera ids in CAMERA_CATALOG (enforced by tests/staff_gauge_cameras.test.js).
 */

export const STAFF_GAUGE_CAMERA_MAP = Object.freeze({
  huish_episcopi_ps: Object.freeze({
    station_id: '52120',
    board_type: 'water_stage',
    confidence: 'high',
    note: 'Camera is at the Huish Episcopi PS gauge site. Which side of the intake the board reads is unverified.'
  }),
  midelney_ps: Object.freeze({
    station_id: '52153',
    board_type: 'water_stage',
    confidence: 'high',
    note: 'Camera is at the Midelney PS gauge site. Description says "rear" board; river vs moor side unverified.'
  }),
  beer_wall_sluice_gb: Object.freeze({
    station_id: '52157',
    board_type: 'water_stage',
    confidence: 'medium',
    note: 'Camera name says "Upstream", matching the 52157 Beer Wall Upstream gauge. Unverified.'
  }),
  westonzoyland_ps: Object.freeze({
    station_id: '52159',
    board_type: 'water_stage',
    confidence: 'low',
    note: 'Board is beside the weed screen on the right of the shot and shows the level of the drain coming into the pumping station intake (per repo owner). 52159 is the nearest basin gauge (Northmoor Basin), not necessarily the same water, so treat as location context only.'
  }),
  monks_leaze_clyse: Object.freeze({
    station_id: '52234',
    board_type: 'water_stage',
    // Two boards in frame (per repo owner): the RIGHT board reads downstream water level
    // (the one tied to 52234); the LEFT board shows sluice gate height, not water level,
    // and must never be used as a stage cross-check.
    boards: Object.freeze({ left: 'gate_lift_indicator', right: 'water_stage' }),
    confidence: 'high',
    // Downstream Sowy stilling well often reads a static level (ponding) when the clyse is shut,
    // so a flatline here is expected, not a fault. Only auto-show the camera for offline/stale.
    flatline_is_expected: true,
    note: 'Right board = downstream water level (52234 Monk\'s Leaze Clyse Downstream), per repo owner. Left board = sluice gate height, not water level.'
  })
});

export const UNMAPPED_STAFF_GAUGE_CAMERAS = Object.freeze({
  athelney_gauge: Object.freeze({
    board_type: 'water_stage',
    reason: 'No EA station of its own. Board stands in dry grass and only meets water in extreme floods; marks are decimetres from an unsurveyed local zero (not mAOD). Post appears to be on the downslope side of the embankment (unconfirmed), so it is not tied to the Tone (52118) or Curry Moor (52127) gauges.'
  }),
  west_sedgemoor_ps: Object.freeze({
    board_type: 'water_stage',
    reason: 'Camera shows the pumping station drain intake (weed screen on the right of the shot) with a board reading the intake drain level. Catalog says curry_moor (52127), topology says 52233; neither is the pump intake drain, so no station is assigned. Awaiting a gauge on that drain.'
  })
});

/** @returns {{station_id:string, board_type:string, confidence:string, note:string}|null} */
export function getStaffGaugeCameraForStation(stationId) {
  const id = String(stationId);
  for (const [cameraId, m] of Object.entries(STAFF_GAUGE_CAMERA_MAP)) {
    if (m.station_id === id) return { camera_id: cameraId, ...m };
  }
  return null;
}
