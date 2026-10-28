import crypto from 'node:crypto';

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
 * Secure Webcam Image Fetcher with Server-Side Request Forgery (SSRF) protection (SEC-03).
 */
export async function fetchWebcamImageSecure(imageUrl, fetchFn = globalThis.fetch) {
  const parsed = new URL(imageUrl);
  const allowedHost = 'environment.data.gov.uk';

  if (parsed.hostname !== allowedHost && !parsed.hostname.endsWith('.environment-agency.gov.uk')) {
    throw new Error(`SSRF Blocked: Host '${parsed.hostname}' is not in allowed domain list.`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

  try {
    const res = await fetchFn(imageUrl, {
      signal: controller.signal,
      redirect: 'error' // Disallow HTTP redirects
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} fetching webcam image`);

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > 5 * 1024 * 1024) { // 5MB buffer limit
      throw new Error('Webcam payload exceeds 5MB size limit');
    }

    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Computes SHA-256 hash of an image Buffer for pre-flight zero-cost deduplication.
 */
export function computeImageHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
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
