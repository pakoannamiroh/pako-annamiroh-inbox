const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLeadClassificationPayload, getLeadClassificationAuthStatus } = require('../lead-classification-utils');

test('validates lead classification payload', () => {
  const ok = validateLeadClassificationPayload({
    jid: '6281234567890@s.whatsapp.net',
    no_hp: '6281234567890',
    status_lead: 'warm',
    lead_score: 72,
    lead_signals: ['tanya paket', 'mau DP'],
    ai_summary: 'Lead tertarik paket DP'
  });

  assert.equal(ok.valid, true);
  assert.deepEqual(ok.normalized, {
    jid: '6281234567890@s.whatsapp.net',
    no_hp: '6281234567890',
    status_lead: 'warm',
    lead_score: 72,
    lead_signals: ['tanya paket', 'mau DP'],
    ai_summary: 'Lead tertarik paket DP'
  });
});

test('rejects invalid lead score and status', () => {
  const result = validateLeadClassificationPayload({
    status_lead: 'purchase',
    lead_score: 101,
    lead_signals: 'bad'
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['status_lead must be one of cold,warm,hot', 'lead_score must be a number between 0 and 100', 'lead_signals must be an array']);
});

test('returns auth status for internal token', () => {
  assert.equal(getLeadClassificationAuthStatus('', ''), 'missing-token');
  assert.equal(getLeadClassificationAuthStatus('abc', 'abc'), 'ok');
  assert.equal(getLeadClassificationAuthStatus('abc', 'wrong'), 'forbidden');
});
