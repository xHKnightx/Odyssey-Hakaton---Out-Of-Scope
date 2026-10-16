import test from 'node:test';
import assert from 'node:assert/strict';
import { expertiseKey, normalizeExpertiseAreas } from '../lib/expertise.mjs';

test('expertise normalization ignores case and whitespace while preserving the first label',()=>{
  assert.deepEqual(
    normalizeExpertiseAreas(['CRM',' crm ','CRM   ','Data   quality',' data quality ']),
    ['CRM','Data quality']
  );
  assert.equal(expertiseKey('  Data   Quality '),expertiseKey('data quality'));
});

test('expertise normalization keeps related but different concepts separate',()=>{
  assert.deepEqual(normalizeExpertiseAreas(['CRM','CRM automation']),['CRM','CRM automation']);
});

test('expertise normalization preserves order and applies its limit',()=>{
  assert.deepEqual(normalizeExpertiseAreas([' SQL ','Python','sql','Figma'],{limit:2}),['SQL','Python']);
});
