/**
 * Zero-Dependency Tigris S3 Forensic Archive Store (Phase 2 / Issue #23)
 *
 * Archives event transition keyframes (EVENT_START, EVENT_PEAK, EVENT_END) and
 * ±60m transition sequences directly to Fly Tigris S3 object storage using
 * AWS Signature V4 (`AWS4-HMAC-SHA256` via `node:crypto`).
 *
 * Governing Invariants:
 * - [RULE-SEC-02] Cloud storage bucket names and internal identifiers are NEVER
 *   hardcoded or logged; injected strictly at runtime via environment variables.
 * - [RULE-DEP-01] Zero external SDK bloat; uses built-in `node:crypto` and `fetch`.
 * - [RULE-INFRA-01] Never writes permanent event archives to the local `/data`
 *   SQLite NVMe volume. When cloud credentials are absent (local offline dev / tests),
 *   falls back to an isolated OS temporary directory (`os.tmpdir()`).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALLOWED_CAMERA_IDS } from './camera_buffer.js';

const EMPTY_PAYLOAD_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const DEFAULT_TIGRIS_ENDPOINT = 'https://fly.storage.tigris.dev';
const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9._-]+\.(?:jpg|json)$/;

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Validates eventId, cameraId, and filename to prevent path traversal and injection.
 */
export function validateArchiveCoordinates(eventId, cameraId, filename) {
  const numId = Number(eventId);
  if (!Number.isInteger(numId) || numId <= 0) {
    throw new Error(`Invalid archive eventId: ${eventId}`);
  }
  if (cameraId !== null && !ALLOWED_CAMERA_IDS.has(cameraId)) {
    throw new Error(`Security Violation: Unrecognized cameraId '${cameraId}'`);
  }
  if (!filename || typeof filename !== 'string' || filename.includes('..') || !SAFE_FILENAME_REGEX.test(filename)) {
    throw new Error(`Security Violation: Invalid archive filename '${filename}'`);
  }
  return numId;
}

/**
 * Generates AWS Signature V4 headers for S3 path-style requests.
 *
 * @param {object} params
 * @param {string} params.method - 'PUT' | 'GET' | 'HEAD'
 * @param {URL} params.url - Full target URL
 * @param {Buffer|string} [params.body] - Request payload
 * @param {string} params.accessKeyId
 * @param {string} params.secretAccessKey
 * @param {string} [params.region='auto']
 * @param {string} [params.contentType]
 * @param {Date} [params.now=new Date()]
 * @returns {Record<string, string>}
 */
export function signAwsV4Request({
  method,
  url,
  body = Buffer.alloc(0),
  accessKeyId,
  secretAccessKey,
  region = 'auto',
  contentType = null,
  now = new Date()
}) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  const payloadHash = payloadBuffer.length === 0 ? EMPTY_PAYLOAD_SHA256 : sha256Hex(payloadBuffer);

  const canonicalUri = url.pathname
    .split('/')
    .map(seg => encodeURIComponent(decodeURIComponent(seg)))
    .join('/');
  const canonicalQueryString = '';

  const canonicalHeaders =
    `host:${url.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n');

  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const headers = {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return headers;
}

export class TigrisArchiveStore {
  constructor(options = {}) {
    this.bucketName = options.bucketName ?? process.env.BUCKET_NAME ?? null;
    this.accessKeyId = options.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID ?? null;
    this.secretAccessKey = options.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY ?? null;
    this.region = options.region ?? process.env.AWS_REGION ?? 'auto';
    this.endpoint = (options.endpoint ?? process.env.LITESTREAM_ENDPOINT ?? DEFAULT_TIGRIS_ENDPOINT).replace(/\/+$/, '');
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || 10000;

    // Fallback ephemeral directory in OS temp when cloud credentials are not configured (never /data)
    this.fallbackDir = options.fallbackDir || path.join(os.tmpdir(), 'flood-telemetry-ephemeral-archive');
  }

  /**
   * Returns true if Tigris S3 credentials and bucket are configured.
   */
  isCloudConfigured() {
    return Boolean(this.bucketName && this.accessKeyId && this.secretAccessKey);
  }

  /**
   * Builds canonical S3 object key for a frame or manifest.
   */
  buildObjectKey(eventId, cameraId, filename) {
    const cleanEventId = validateArchiveCoordinates(eventId, cameraId, filename);
    if (cameraId === null) {
      return `archived_events/${cleanEventId}/${filename}`;
    }
    return `archived_events/${cleanEventId}/${cameraId}/${filename}`;
  }

  /**
   * Builds canonical relative proxy URL stored in SQLite (`camera_analysis.image_url`).
   * Never exposes internal S3 bucket names ([RULE-SEC-02]).
   */
  buildProxyUrl(eventId, cameraId, filename) {
    const cleanEventId = validateArchiveCoordinates(eventId, cameraId, filename);
    return `/api/events/${cleanEventId}/frames/${cameraId}/${filename}`;
  }

  /**
   * Uploads a binary JPEG frame to Tigris S3 (or ephemeral fallback in local dev/tests).
   *
   * @param {number} eventId
   * @param {string} cameraId
   * @param {string} filename
   * @param {Buffer} buffer
   * @returns {Promise<{stored: boolean, backend: 'tigris_s3'|'ephemeral_fallback', objectKey: string, proxyUrl: string, sizeBytes: number}>}
   */
  async uploadFrame(eventId, cameraId, filename, buffer) {
    const objectKey = this.buildObjectKey(eventId, cameraId, filename);
    const proxyUrl = this.buildProxyUrl(eventId, cameraId, filename);

    if (!Buffer.isBuffer(buffer) || buffer.length < 3 || buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
      throw new Error('Invalid frame buffer: Missing JPEG magic bytes (0xFF 0xD8 0xFF)');
    }

    if (this.isCloudConfigured()) {
      const targetUrl = new URL(`${this.endpoint}/${this.bucketName}/${objectKey}`);
      const headers = signAwsV4Request({
        method: 'PUT',
        url: targetUrl,
        body: buffer,
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
        region: this.region,
        contentType: 'image/jpeg'
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchFn(targetUrl.href, {
          method: 'PUT',
          headers,
          body: buffer,
          signal: controller.signal
        });
        if (!res.ok) {
          throw new Error(`Tigris S3 PUT failed with HTTP ${res.status}`);
        }
        return {
          stored: true,
          backend: 'tigris_s3',
          objectKey,
          proxyUrl,
          sizeBytes: buffer.length
        };
      } finally {
        clearTimeout(timer);
      }
    }

    // Ephemeral OS temp fallback for local offline dev / unit tests without cloud credentials
    const targetPath = path.join(this.fallbackDir, objectKey);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, buffer);
    return {
      stored: true,
      backend: 'ephemeral_fallback',
      objectKey,
      proxyUrl,
      sizeBytes: buffer.length
    };
  }

  /**
   * Uploads or updates the JSON manifest for an archived event (`archived_events/<eventId>/manifest.json`).
   *
   * @param {number} eventId
   * @param {object} manifestObj
   * @returns {Promise<{stored: boolean, backend: 'tigris_s3'|'ephemeral_fallback', objectKey: string}>}
   */
  async uploadManifest(eventId, manifestObj) {
    const objectKey = this.buildObjectKey(eventId, null, 'manifest.json');
    const bodyBuffer = Buffer.from(JSON.stringify(manifestObj, null, 2), 'utf8');

    if (this.isCloudConfigured()) {
      const targetUrl = new URL(`${this.endpoint}/${this.bucketName}/${objectKey}`);
      const headers = signAwsV4Request({
        method: 'PUT',
        url: targetUrl,
        body: bodyBuffer,
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
        region: this.region,
        contentType: 'application/json'
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchFn(targetUrl.href, {
          method: 'PUT',
          headers,
          body: bodyBuffer,
          signal: controller.signal
        });
        if (!res.ok) {
          throw new Error(`Tigris S3 manifest PUT failed with HTTP ${res.status}`);
        }
        return { stored: true, backend: 'tigris_s3', objectKey };
      } finally {
        clearTimeout(timer);
      }
    }

    const targetPath = path.join(this.fallbackDir, objectKey);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, bodyBuffer);
    return { stored: true, backend: 'ephemeral_fallback', objectKey };
  }

  /**
   * Fetches an archived JPEG frame from Tigris S3 (or ephemeral fallback).
   *
   * @param {number} eventId
   * @param {string} cameraId
   * @param {string} filename
   * @returns {Promise<Buffer|null>}
   */
  async fetchFrame(eventId, cameraId, filename) {
    const objectKey = this.buildObjectKey(eventId, cameraId, filename);

    if (this.isCloudConfigured()) {
      const targetUrl = new URL(`${this.endpoint}/${this.bucketName}/${objectKey}`);
      const headers = signAwsV4Request({
        method: 'GET',
        url: targetUrl,
        body: Buffer.alloc(0),
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
        region: this.region
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchFn(targetUrl.href, {
          method: 'GET',
          headers,
          signal: controller.signal
        });
        if (res.status === 404) return null;
        if (!res.ok) {
          throw new Error(`Tigris S3 GET failed with HTTP ${res.status}`);
        }
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
      } finally {
        clearTimeout(timer);
      }
    }

    const targetPath = path.join(this.fallbackDir, objectKey);
    if (!fs.existsSync(targetPath)) return null;
    return fs.readFileSync(targetPath);
  }
}
