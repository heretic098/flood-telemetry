/**
 * AI Vision Client & Multimodal Analysis Stubs (Phase 2 Preparation)
 * 
 * Note: Raw webcam ingestion, two-step CFH fetching, SSRF guards, and rolling buffer storage
 * have been decoupled into `src/js/api/camera_buffer.js` (Phase 1 / Issue #22).
 * This module preserves Phase 2 Gemini Vision multimodal prompt analysis stubs and local fallbacks.
 */

export { fetchWebcamImageSecure, computeBufferHash as computeImageHash } from './camera_buffer.js';

/**
 * Helper to escape HTML special characters to prevent Cross-Site Scripting (XSS) (SEC-01).
 */
export function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Evaluates whether an image was captured in daylight using solar elevation cutoff (-6.0°).
 */
export function isDaylight(date = new Date(), lat = 51.05, lon = -2.95) {
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
  const declination = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * (Math.PI / 180));
  const hourAngle = (date.getUTCHours() + lon / 15 - 12) * 15;
  const rad = Math.PI / 180;
  const elevation = Math.asin(
    Math.sin(lat * rad) * Math.sin(declination * rad) +
    Math.cos(lat * rad) * Math.cos(declination * rad) * Math.cos(hourAngle * rad)
  ) / rad;

  return elevation > -6.0; // Above civil twilight
}

/**
 * Invokes Gemini 1.5/2.5 Flash Vision API using secure HTTP Header secret transport (SEC-02).
 */
export async function callGeminiVision(imageBuffer, mimeType = 'image/jpeg', apiKey = process.env.GEMINI_API_KEY, fetchFn = globalThis.fetch) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const base64Data = imageBuffer.toString('base64');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

  const promptText = `Analyze this flood control webcam image from the Somerset Levels. 
Return ONLY a JSON object matching this exact schema:
{
  "gate_status": "OPEN" | "PARTIALLY_OPEN" | "CLOSED" | "UNCERTAIN",
  "debris_detected": boolean,
  "flow_character": "SMOOTH" | "TURBULENT" | "SLACK",
  "overtopping_detected": boolean,
  "confidence": number,
  "summary": "Plain-English single sentence describing the sluice/spillway visual state."
}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: promptText },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      response_mime_type: "application/json"
    }
  };

  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey // SEC-02: Secret header transport
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Gemini API HTTP Error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(text);

  // SEC-01: Sanitize summary string before returning/storing
  if (parsed.summary) {
    parsed.summary = escapeHTML(parsed.summary);
  }

  return parsed;
}

/**
 * Local Telemetry Fallback Generator
 */
export function generateLocalFallback(cameraConfig, telemetryState) {
  const isOpen = telemetryState.deltaH >= 0.05;
  const rawSummary = `Visual status derived from gauge telemetry (${cameraConfig.name}): ${isOpen ? 'Open & discharging' : 'Closed/Penning mode'}. (Local fallback active).`;
  return {
    gate_status: isOpen ? "OPEN" : "CLOSED",
    debris_detected: false,
    flow_character: telemetryState.deltaH > 0.15 ? "TURBULENT" : "SLACK",
    overtopping_detected: telemetryState.isOvertopping || false,
    confidence: 0.85,
    summary: escapeHTML(rawSummary)
  };
}
