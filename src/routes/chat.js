const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();
const client = new Anthropic();

const SYSTEM_PROMPT = `Eres VitalShell, el asistente inteligente del edificio. Habla en primera persona como si fueras el edificio. Tienes acceso a estos datos en tiempo real:

[DATOS_JSON_ACTUALES]

Responde de forma concisa y amigable. Máximo 3 frases. Usa los datos reales cuando sean relevantes. Si no sabes algo, dilo con honestidad.`;

// POST /api/chat
router.post('/', async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "message" field' });
  }

  let systemData = {};
  try {
    const port = process.env.PORT || 3001;
    const dataRes = await axios.get(`http://localhost:${port}/api/data`, {
      headers: { 'x-api-key': process.env.API_KEY },
      timeout: 5000,
    });
    systemData = dataRes.data;
  } catch (err) {
    console.warn('[chat] Could not fetch /api/data:', err.message);
  }

  const systemPrompt = SYSTEM_PROMPT.replace(
    '[DATOS_JSON_ACTUALES]',
    JSON.stringify(systemData, null, 2)
  );

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
    });

    const reply = response.content[0]?.text ?? '';
    res.json({ reply });
  } catch (err) {
    console.error('[chat] Anthropic error:', err.message);
    res.status(502).json({ error: 'Could not get a response from the AI service' });
  }
});

module.exports = router;
