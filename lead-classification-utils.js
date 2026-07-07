function getLeadClassificationAuthStatus(headerToken, expectedToken) {
  if (!expectedToken) return 'missing-token';
  if (!headerToken || headerToken !== expectedToken) return 'forbidden';
  return 'ok';
}

function validateLeadClassificationPayload(payload) {
  const errors = [];
  const data = payload || {};
  const jid = typeof data.jid === 'string' ? data.jid.trim() : '';
  const noHp = typeof data.no_hp === 'string' ? data.no_hp.trim() : '';

  const statusLead = typeof data.status_lead === 'string' ? data.status_lead.toLowerCase() : '';
  if (!['cold', 'warm', 'hot'].includes(statusLead)) {
    errors.push('status_lead must be one of cold,warm,hot');
  }

  const leadScore = Number(data.lead_score);
  if (!Number.isFinite(leadScore) || leadScore < 0 || leadScore > 100) {
    errors.push('lead_score must be a number between 0 and 100');
  }

  let leadSignals = data.lead_signals;
  if (!Array.isArray(leadSignals)) {
    errors.push('lead_signals must be an array');
  } else {
    leadSignals = leadSignals.filter((item) => item !== undefined && item !== null);
  }

  const aiSummary = typeof data.ai_summary === 'string' ? data.ai_summary.trim() : null;
  const normalized = {
    jid: jid || null,
    no_hp: noHp || null,
    status_lead: statusLead || null,
    lead_score: Number.isFinite(leadScore) ? leadScore : null,
    lead_signals: Array.isArray(leadSignals) ? leadSignals : [],
    ai_summary: aiSummary || null,
  };

  return { valid: errors.length === 0, normalized, errors };
}

function validateAutoSignalPayload(payload) {
  const data = payload || {};
  const kualitas = typeof data.kualitas === 'string' ? data.kualitas.toLowerCase() : '';
  const errors = [];
  if (!['warm', 'hot'].includes(kualitas)) errors.push('kualitas must be warm or hot');
  const kontakId = Number(data.kontak_id);
  if (!Number.isInteger(kontakId) || kontakId <= 0) errors.push('kontak_id must be a positive integer');
  const source = typeof data.source === 'string' && data.source.trim() ? data.source.trim() : 'n8n-cs-baru-auto';
  const dedupeKey = `auto-lead-${kontakId}-${kualitas}`;
  return { valid: errors.length === 0, normalized: { kontak_id: kontakId, kualitas, source, dedupe_key: dedupeKey }, errors };
}

function buildAutoSignalDedupeKey(kontakId, kualitas) {
  return `auto-lead-${Number(kontakId)}-${String(kualitas || '').toLowerCase()}`;
}

module.exports = {
  getLeadClassificationAuthStatus,
  validateLeadClassificationPayload,
  validateAutoSignalPayload,
  buildAutoSignalDedupeKey,
};
