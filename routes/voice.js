const express = require('express');
const multer = require('multer');

const { authenticateToken } = require('../middleware/auth');
const { adminCheck } = require('../middleware/adminCheck');

const router = express.Router();

router.use(authenticateToken);
router.use(adminCheck);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024 // 8MB
  }
});

const boolFromEnv = (value) => String(value || '').trim().toLowerCase() === 'true';

const getAzureConfig = () => {
  const key = String(process.env.AZURE_SPEECH_KEY || '').trim();
  const region = String(process.env.AZURE_SPEECH_REGION || '').trim();
  const enabled = boolFromEnv(process.env.AZURE_SPEECH_ENABLED) && !!key && !!region;

  const ttsVoice = String(process.env.AZURE_TTS_VOICE || 'en-IN-NeerjaNeural').trim();
  const language = String(process.env.AZURE_SPEECH_LANGUAGE || 'en-IN').trim();
  const outputFormat = String(process.env.AZURE_TTS_OUTPUT_FORMAT || 'audio-24khz-48kbitrate-mono-mp3').trim();

  return { enabled, key, region, ttsVoice, language, outputFormat };
};

const escapeXml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const withTimeout = async (promiseFactory, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

router.get('/config', (req, res) => {
  const cfg = getAzureConfig();
  return res.json({
    enabled: cfg.enabled,
    ttsEnabled: cfg.enabled,
    sttEnabled: cfg.enabled,
    language: cfg.language,
    voice: cfg.ttsVoice
  });
});

// Text-to-Speech: returns MP3 audio.
router.post('/tts', async (req, res) => {
  try {
    const cfg = getAzureConfig();
    if (!cfg.enabled) {
      return res.status(503).json({ error: 'Azure Speech is not configured.' });
    }

    const text = String(req.body?.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'text is required.' });
    }

    const safeText = escapeXml(text).slice(0, 2000);
    const voice = String(req.body?.voice || cfg.ttsVoice).trim() || cfg.ttsVoice;
    const lang = String(req.body?.language || cfg.language).trim() || cfg.language;

    const ssml = `<?xml version="1.0" encoding="utf-8"?>
<speak version="1.0" xml:lang="${escapeXml(lang)}" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts">
  <voice name="${escapeXml(voice)}">${safeText}</voice>
</speak>`;

    const url = `https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`;

    const response = await withTimeout(
      (signal) => fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': cfg.key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': cfg.outputFormat,
          'User-Agent': 'mountain-made-ecommerce'
        },
        body: ssml,
        signal
      }),
      20000
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return res.status(502).json({ error: 'Azure TTS failed.', detail: errText.slice(0, 500) });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  } catch (err) {
    const isAbort = String(err?.name || '').toLowerCase() === 'aborterror';
    return res.status(502).json({ error: isAbort ? 'Azure TTS timed out.' : 'Azure TTS error.' });
  }
});

// Speech-to-Text: expects a short WAV (PCM 16kHz mono recommended).
router.post('/stt', upload.single('audio'), async (req, res) => {
  try {
    const cfg = getAzureConfig();
    if (!cfg.enabled) {
      return res.status(503).json({ error: 'Azure Speech is not configured.' });
    }

    if (!req.file || !req.file.buffer || req.file.size === 0) {
      return res.status(400).json({ error: 'audio file is required (multipart field name: audio).' });
    }

    const allowed = new Set(['audio/wav', 'audio/x-wav', 'audio/wave']);
    const contentType = String(req.file.mimetype || '').toLowerCase();
    if (!allowed.has(contentType)) {
      return res.status(400).json({ error: 'Only WAV audio is supported for STT right now.' });
    }

    const language = String(req.body?.language || cfg.language).trim() || cfg.language;

    const url = `https://${cfg.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}`;

    const response = await withTimeout(
      (signal) => fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': cfg.key,
          'Content-Type': contentType,
          'Accept': 'application/json'
        },
        body: req.file.buffer,
        signal
      }),
      25000
    );

    const dataText = await response.text().catch(() => '');
    let data = null;
    try { data = dataText ? JSON.parse(dataText) : null; } catch (_) { data = null; }

    if (!response.ok) {
      return res.status(502).json({ error: 'Azure STT failed.', detail: (data?.message || dataText || '').slice(0, 500) });
    }

    const text = String(data?.DisplayText || data?.displayText || '').trim();
    return res.json({ ok: true, text, raw: data });
  } catch (err) {
    const isAbort = String(err?.name || '').toLowerCase() === 'aborterror';
    return res.status(502).json({ error: isAbort ? 'Azure STT timed out.' : 'Azure STT error.' });
  }
});

module.exports = router;
