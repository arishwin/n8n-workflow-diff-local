const HASH_KEY = 'diff';
const LONG_URL_THRESHOLD = 8000;

export function encodeDiffFragment(oldWorkflow, newWorkflow) {
  const payload = {
    version: 1,
    oldWorkflow,
    newWorkflow,
  };
  return `${HASH_KEY}=${encodeBase64Url(JSON.stringify(payload))}`;
}

export function decodeDiffFragment(hash) {
  const rawHash = String(hash ?? '').replace(/^#/, '');
  if (!rawHash) {
    return null;
  }
  const params = new URLSearchParams(rawHash);
  const encoded = params.get(HASH_KEY);
  if (!encoded) {
    return null;
  }
  const payload = JSON.parse(decodeBase64Url(encoded));
  if (payload?.version !== 1 || !payload.oldWorkflow || !payload.newWorkflow) {
    throw new Error('Unsupported diff link format');
  }
  return {
    oldWorkflow: payload.oldWorkflow,
    newWorkflow: payload.newWorkflow,
  };
}

export function analyzeShareUrl(oldWorkflow, newWorkflow, baseUrl) {
  const fragment = encodeDiffFragment(oldWorkflow, newWorkflow);
  const url = `${baseUrl.replace(/#.*$/, '')}#${fragment}`;
  const payloadText = JSON.stringify({ oldWorkflow, newWorkflow });
  const hasCredentials = /"credentials"\s*:|"nodeCredentialType"\s*:|"authentication"\s*:/i.test(payloadText);
  const hasUrls = /https?:\/\//i.test(payloadText);
  const isLong = url.length > LONG_URL_THRESHOLD;
  const warnings = [];

  if (hasCredentials) {
    warnings.push('Workflow contains credential references. The share URL exposes their names/IDs to anyone who can see the link.');
  }
  if (hasUrls) {
    warnings.push('Workflow contains URLs. The share URL exposes those endpoints to anyone who can see the link.');
  }
  if (isLong) {
    warnings.push(`Share URL is ${url.length.toLocaleString()} characters. GitHub/browser handling may be awkward; exported HTML is safer for large workflows.`);
  }

  return {
    url,
    length: url.length,
    hasCredentials,
    hasUrls,
    isLong,
    warnings,
  };
}

function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return base64Encode(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function decodeBase64Url(encoded) {
  const padded = encoded
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const binary = base64Decode(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function base64Encode(binary) {
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

function base64Decode(encoded) {
  if (typeof atob === 'function') {
    return atob(encoded);
  }
  return Buffer.from(encoded, 'base64').toString('binary');
}
