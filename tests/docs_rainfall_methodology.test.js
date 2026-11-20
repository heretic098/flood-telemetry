import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve('.');
const methodologyHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/methodology.html'), 'utf8');
const llmsTxt = fs.readFileSync(path.join(ROOT_DIR, 'src/llms.txt'), 'utf8');
const llmsFullTxt = fs.readFileSync(path.join(ROOT_DIR, 'src/llms-full.txt'), 'utf8');
const thresholdProvenanceMd = fs.readFileSync(path.join(ROOT_DIR, 'docs/threshold_provenance.md'), 'utf8');

const DOC_FILES = [
  { name: 'src/methodology.html', text: methodologyHtml, allowRuleTags: false },
  { name: 'src/llms.txt', text: llmsTxt, allowRuleTags: true },
  { name: 'src/llms-full.txt', text: llmsFullTxt, allowRuleTags: true }
];

test('Issue #62 Docs: All 3 docs document TBR 0.20 mm quantization, 15-min interval accumulation, and ghost tips', () => {
  for (const doc of DOC_FILES) {
    assert.ok(doc.text.includes('0.20 mm'), `${doc.name} must document 0.20 mm tip quantization`);
    assert.ok(/15-minute/i.test(doc.text), `${doc.name} must contrast discrete 15-minute accumulation vs continuous stage`);
    assert.ok(/ghost tips/i.test(doc.text), `${doc.name} must document residual moisture ghost tips`);
  }
});

test('Issue #62 Docs: All 3 docs document 15%–25% wind undercatch on Brendon & Blackdown Hills and raw display', () => {
  for (const doc of DOC_FILES) {
    assert.ok(/15%.*25%/.test(doc.text), `${doc.name} must document 15%–25% aerodynamic wind undercatch`);
    assert.ok(doc.text.includes('Brendon Hills'), `${doc.name} must reference Brendon Hills`);
    assert.ok(doc.text.includes('Blackdown Hills'), `${doc.name} must reference Blackdown Hills`);
    assert.ok(/Atlantic gales/i.test(doc.text), `${doc.name} must reference SW Atlantic gales`);
    assert.ok(/raw empirical/i.test(doc.text), `${doc.name} must explain why raw empirical data is displayed without speculative multipliers`);
  }
});

test('Issue #62 Docs: All 3 docs document unheated funnels and freezing / snow blindness melt-spike hazard', () => {
  for (const doc of DOC_FILES) {
    assert.ok(/unheated/i.test(doc.text), `${doc.name} must document unheated funnels`);
    assert.ok(/snow[- ]capping|frozen funnel/i.test(doc.text), `${doc.name} must document snow-capping / frozen funnels`);
    assert.ok(/snow blindness/i.test(doc.text), `${doc.name} must document snow blindness`);
    assert.ok(/false zero/i.test(doc.text), `${doc.name} must document false zero readings`);
    assert.ok(/melt(water)? spike/i.test(doc.text), `${doc.name} must document delayed meltwater spike`);
  }
});

test('Issue #62 Docs: All 3 docs enforce OGL v3.0 provenance, ambient-sensor status, and no volumetric runoff inference', () => {
  const forbiddenVolumetricRegex = /cumec|m3\/s|m³\/s|megalitre/i;

  for (const doc of DOC_FILES) {
    assert.ok(doc.text.includes('Open Government Licence v3.0') || doc.text.includes('OGL v3.0'), `${doc.name} must cite OGL v3.0`);
    assert.ok(doc.text.includes('Crown copyright'), `${doc.name} must include Crown copyright attribution`);
    assert.ok(/ambient environmental sensor/i.test(doc.text), `${doc.name} must classify raingauges as ambient environmental sensors`);
    assert.ok(/\*{0,2}not\*{0,2} civil( hydraulic)? state-machine entities/i.test(doc.text), `${doc.name} must state raingauges are not civil state-machine entities`);
    assert.ok(/volumetric runoff/i.test(doc.text), `${doc.name} must prohibit volumetric runoff inference from mm rainfall`);
    if (doc.name === 'src/methodology.html') {
      const tbrSection = doc.text.slice(doc.text.indexOf('id="rainfall-sensor-methodology"'), doc.text.indexOf('<!-- Section 5:'));
      assert.ok(!forbiddenVolumetricRegex.test(tbrSection), 'Section 4B of src/methodology.html must not contain forbidden volumetric terms [RULE-CALC-01]');
    } else {
      assert.ok(!forbiddenVolumetricRegex.test(doc.text), `${doc.name} must not contain forbidden volumetric terms [RULE-CALC-01]`);
    }

    if (!doc.allowRuleTags) {
      assert.ok(!doc.text.includes('[RULE-'), `${doc.name} must not expose internal [RULE-*] tokens to readers`);
    }
  }
});

test('Issue #62 Docs: methodology.html defines #rainfall-sensor-methodology anchor and balanced section tags', () => {
  assert.ok(methodologyHtml.includes('id="rainfall-sensor-methodology"'), 'methodology.html must define #rainfall-sensor-methodology');
  const openSections = (methodologyHtml.match(/<section\b/g) || []).length;
  const closeSections = (methodologyHtml.match(/<\/section>/g) || []).length;
  assert.equal(openSections, closeSections, 'methodology.html <section> tags must be balanced');
  const openDivs = (methodologyHtml.match(/<div\b/g) || []).length;
  const closeDivs = (methodologyHtml.match(/<\/div>/g) || []).length;
  assert.equal(openDivs, closeDivs, 'methodology.html <div> tags must be balanced');
});

test('Docs Threshold Parity: removed bicknells_bridge_access & wet_moor/huish_episcopi_ps thresholds are absent across docs', () => {
  const docs = [
    { name: 'src/methodology.html', text: methodologyHtml },
    { name: 'src/llms.txt', text: llmsTxt },
    { name: 'src/llms-full.txt', text: llmsFullTxt },
    { name: 'docs/threshold_provenance.md', text: thresholdProvenanceMd }
  ];

  for (const doc of docs) {
    assert.ok(!/Huish Episcopi[^.\n]*6\.30|6\.30m AOD[^.\n]*6\.75m/i.test(doc.text), `${doc.name} must not advertise removed 6.30m/6.75m Huish Episcopi pump triggers`);
    assert.ok(!/6\.70m[^.\n]*6\.90m[^.\n]*(Huish|Wet Moor|Summer)/i.test(doc.text), `${doc.name} must not advertise removed 6.70m/6.90m Huish Episcopi summer triggers`);
    assert.ok(!/Bicknell's Bridge[^.\n]*7\.30m|bicknells_bridge_access[^.\n]*7\.30/i.test(doc.text), `${doc.name} must not advertise removed 7.00m/7.30m Bicknell's Bridge thresholds`);
  }

  assert.ok(methodologyHtml.includes('UNSURVEYED') && methodologyHtml.includes('8.20m AOD (Receiving-River Cut-off Only)'));
  assert.ok(llmsTxt.includes("Bicknell's Bridge & Huish Level: `UNSURVEYED`"));
  assert.ok(llmsFullTxt.includes('### Wet Moor Polder Basin (`UNSURVEYED`'));
  assert.ok(llmsFullTxt.includes('8.20m AOD'));
  assert.ok(thresholdProvenanceMd.includes('Wet Moor (`UNSURVEYED`'));
  assert.ok(thresholdProvenanceMd.includes('`bicknells_bridge_access`'));
});
