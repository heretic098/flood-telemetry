import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderHtmlWithPartials } from '../server.js';

const ROOT_DIR = path.resolve('.');

const indexHtml = renderHtmlWithPartials(fs.readFileSync(path.join(ROOT_DIR, 'src/index.html'), 'utf8'), 'index.html');
const roadsHtml = renderHtmlWithPartials(fs.readFileSync(path.join(ROOT_DIR, 'src/roads.html'), 'utf8'), 'roads.html');
const topologyHtml = renderHtmlWithPartials(fs.readFileSync(path.join(ROOT_DIR, 'src/topology.html'), 'utf8'), 'topology.html');
const methodologyHtml = renderHtmlWithPartials(fs.readFileSync(path.join(ROOT_DIR, 'src/methodology.html'), 'utf8'), 'methodology.html');
const stylesCss = fs.readFileSync(path.join(ROOT_DIR, 'src/css/styles.css'), 'utf8');
const serverJs = fs.readFileSync(path.join(ROOT_DIR, 'server.js'), 'utf8');

const htmlPages = [
  { name: 'index.html', html: indexHtml },
  { name: 'roads.html', html: roadsHtml },
  { name: 'topology.html', html: topologyHtml },
  { name: 'methodology.html', html: methodologyHtml }
];

test('Branding: favicon.svg, og-image.svg, and site.webmanifest exist with valid contents', () => {
  const faviconSvg = fs.readFileSync(path.join(ROOT_DIR, 'src/favicon.svg'), 'utf8');
  assert.ok(faviconSvg.includes('<svg'), 'favicon.svg must be an SVG file');
  assert.ok(faviconSvg.includes('viewBox="0 0 32 32"'), 'favicon.svg must have 32x32 viewBox');
  assert.ok(faviconSvg.includes('prefers-color-scheme'), 'favicon.svg must include light/dark adaptive media query');

  const ogImageSvg = fs.readFileSync(path.join(ROOT_DIR, 'src/og-image.svg'), 'utf8');
  assert.ok(ogImageSvg.includes('<svg'), 'og-image.svg must be an SVG file');
  assert.ok(ogImageSvg.includes('viewBox="0 0 1200 630"'), 'og-image.svg must match standard 1200x630 social dimensions');
  assert.ok(ogImageSvg.includes('Somerset Levels Flood Status'), 'og-image.svg must feature platform title');

  const manifestStr = fs.readFileSync(path.join(ROOT_DIR, 'src/site.webmanifest'), 'utf8');
  const manifest = JSON.parse(manifestStr);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#0f172a');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
});

test('Branding: All 4 HTML templates contain favicon, apple-touch-icon, manifest, and Open Graph tags', () => {
  for (const page of htmlPages) {
    assert.ok(page.html.includes('rel="icon"'), `${page.name} must have rel="icon"`);
    assert.ok(page.html.includes('href="favicon.svg"'), `${page.name} favicon link must point to favicon.svg`);
    assert.ok(page.html.includes('rel="apple-touch-icon"'), `${page.name} must have rel="apple-touch-icon"`);
    assert.ok(page.html.includes('rel="manifest"'), `${page.name} must have rel="manifest"`);
    assert.ok(page.html.includes('name="theme-color"'), `${page.name} must have meta theme-color`);
    assert.ok(page.html.includes('property="og:title"'), `${page.name} must have og:title`);
    assert.ok(page.html.includes('property="og:description"'), `${page.name} must have og:description`);
    assert.ok(page.html.includes('property="og:image"'), `${page.name} must have og:image`);
  }
});

test('Monetization & Ko-fi: Top navigation header contains neutral .nav-btn-kofi across all 4 pages', () => {
  for (const page of htmlPages) {
    assert.ok(page.html.includes('class="nav-btn nav-link nav-btn-kofi"'), `${page.name} must contain .nav-btn-kofi in navigation`);
    assert.ok(page.html.includes('https://ko-fi.com/heretic098'), `${page.name} must link to official Ko-fi page`);
    assert.ok(page.html.includes('target="_blank"'), `${page.name} Ko-fi nav link must open in new tab`);
    assert.ok(page.html.includes('rel="noopener noreferrer"'), `${page.name} Ko-fi nav link must have noopener noreferrer`);
    assert.ok(page.html.includes('aria-label='), `${page.name} Ko-fi nav link must have accessible aria-label`);
  }
});

test('Monetization & Ko-fi: Footer support banner is standardized across all 4 pages including methodology.html', () => {
  for (const page of htmlPages) {
    assert.ok(page.html.includes('class="kofi-support-banner"'), `${page.name} must contain .kofi-support-banner in footer`);
    assert.ok(page.html.includes('class="kofi-link"'), `${page.name} must contain .kofi-link in footer banner`);
  }
});

test('Monetization & Ko-fi: styles.css enforces neutral tokens and hides header pill on mobile (< 640px)', () => {
  assert.ok(stylesCss.includes('.nav-btn-kofi'), 'styles.css must include .nav-btn-kofi rule');
  assert.ok(stylesCss.includes('.kofi-support-banner'), 'styles.css must style .kofi-support-banner');
  assert.ok(stylesCss.includes('.kofi-link'), 'styles.css must style .kofi-link');

  // Verify neutral styling (does NOT use red/coral alert tokens in base nav-btn-kofi)
  const kofiBtnMatch = stylesCss.match(/\.nav-btn-kofi\s*\{[\s\S]*?\}/);
  assert.ok(kofiBtnMatch, '.nav-btn-kofi rule must exist in styles.css');
  assert.ok(!kofiBtnMatch[0].includes('#ff5f5f'), '.nav-btn-kofi must not use red/coral alert border');

  // Verify mobile hiding rule in media query
  const mobileMatch = stylesCss.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(mobileMatch, '@media (max-width: 640px) block must exist in styles.css');
  assert.ok(mobileMatch[1].includes('.nav-btn-kofi'), '@media (max-width: 640px) must hide or adapt .nav-btn-kofi');
  assert.ok(mobileMatch[1].includes('display: none !important;'), 'mobile nav must hide .nav-btn-kofi from vertical button stack');
});

test('Server: MIME_TYPES serves .webmanifest, .ico, .svg, and .png with correct headers', () => {
  assert.ok(serverJs.includes("'.webmanifest': 'application/manifest+json'"), 'server.js must map .webmanifest to application/manifest+json');
  assert.ok(serverJs.includes("'.ico': 'image/x-icon'"), 'server.js must map .ico to image/x-icon');
  assert.ok(serverJs.includes("'.svg': 'image/svg+xml'"), 'server.js must map .svg to image/svg+xml');
  assert.ok(serverJs.includes("'.png': 'image/png'"), 'server.js must map .png to image/png');
});
