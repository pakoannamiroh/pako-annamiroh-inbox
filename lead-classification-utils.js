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

module.exports = {
  getLeadClassificationAuthStatus,
  validateLeadClassificationPayload,
};
