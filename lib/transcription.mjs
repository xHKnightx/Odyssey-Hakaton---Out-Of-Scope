const DEFAULT_MODEL = 'gpt-4o-mini-transcribe';

export function transcriptionModel() {
  return process.env.TRANSCRIPTION_MODEL || DEFAULT_MODEL;
}

export function transcriptionConfigured() {
  return Boolean(process.env.LLM_BASE_URL && transcriptionModel());
}

function extensionFor(contentType) {
  if (contentType.includes('mp4')) return 'm4a';
  if (contentType.includes('ogg')) return 'ogg';
  if (contentType.includes('wav')) return 'wav';
  return 'webm';
}

export async function transcribeAudio(audio, contentType, fetchImpl = fetch) {
  if (!transcriptionConfigured()) throw new Error('Voice transcription is not configured.');
  if (!audio?.length) throw new Error('No microphone audio was received.');
  const base = process.env.LLM_BASE_URL.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const endpoint = base.endsWith('/audio/transcriptions') ? base : `${base}/audio/transcriptions`;
  const form = new FormData();
  form.append('file', new Blob([audio], { type:contentType }), `voice.${extensionFor(contentType)}`);
  form.append('model', transcriptionModel());
  const headers = {};
  if (process.env.LLM_API_KEY) headers.authorization = `Bearer ${process.env.LLM_API_KEY}`;
  const response = await fetchImpl(endpoint, { method:'POST', headers, body:form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Speech gateway returned HTTP ${response.status}.`);
  const text = String(payload.text || '').trim();
  if (!text) throw new Error('No speech was recognized.');
  return { text, model:transcriptionModel() };
}
