import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { embed, dot } from './lib/embed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

const mapPath = path.join(here, 'data/map.json');
if (!fs.existsSync(mapPath)) {
  console.error('data/map.json is missing. Run: npm run build-map');
  process.exit(1);
}
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(here, 'public')));
app.use('/vendor/three', express.static(path.join(here, 'node_modules/three/build')));
// The world, without the embeddings (the client only needs names and positions).
app.get('/api/map', (req, res) => {
  res.json({
    categories: map.categories,
    islands: map.islands,
    landmarks: map.landmarks.map(({ name, cat, x, y, z, face }) => ({ name, cat, x, y, z, face })),
  });
});

// Question -> a place in the world. Embed the question, find the nearest
// landmarks in embedding space, and blend their world positions.
app.post('/api/ask', async (req, res) => {
  const question = String(req.body?.question ?? '').trim().slice(0, 300);
  if (!question) return res.status(400).json({ error: 'Empty question' });
  try {
    const [q] = await embed([question]);
    const top = map.landmarks
      .map((l) => ({ l, sim: dot(q, l.v) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 5);
    // The answer lives on the best match's island. Blend the positions of the
    // matches on that island (best match pulls hardest), then pull the spot
    // in from the rim so it stands on open ground.
    const island = map.islands[top[0].l.cat];
    let x = 0, z = 0, total = 0;
    for (const { l, sim } of top) {
      if (l.cat !== top[0].l.cat) continue;
      const w = Math.exp(sim * 12);
      x += l.x * w;
      z += l.z * w;
      total += w;
    }
    x = island.x + (x / total - island.x) * 0.55;
    z = island.z + (z / total - island.z) * 0.55;
    const d = Math.hypot(x - island.x, z - island.z);
    if (d < 26) {   // keep clear of the launch shaft and tower in the middle
      const a = d > 0.01 ? Math.atan2(z - island.z, x - island.x) : 0;
      x = island.x + Math.cos(a) * 26;
      z = island.z + Math.sin(a) * 26;
    }
    res.json({
      question,
      target: { x, y: island.y, z, island: top[0].l.cat },
      near: top.map(({ l, sim }) => ({ name: l.name, sim: +sim.toFixed(3) })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not embed the question' });
  }
});

const SYSTEM = `You write the "pages" of Vector Web, a walkable 3D alternative to the internet.
The visitor asked a question and walked across the world to reach this spot, so reward the trip.
Answer the question directly in plain text, at most 120 words, no markdown or lists.
Finish with one line starting "Nearby:" that links the answer to one or two of the neighbouring landmarks you are given.`;

// Streams the page text for a destination (or a landmark) as plain text.
app.post('/api/answer', async (req, res) => {
  const question = String(req.body?.question ?? '').trim().slice(0, 300);
  const near = (Array.isArray(req.body?.near) ? req.body.near : []).slice(0, 5).map((n) => String(n).slice(0, 60));
  if (!question) return res.status(400).end('Empty question');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const client = new Anthropic();
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low' }, // short pages: favour speed
      // If the model declines a question, the API retries on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [
        { role: 'user', content: `Question: ${question}\nNeighbouring landmarks: ${near.join(', ') || 'none'}` },
      ],
    });
    res.on('close', () => stream.abort());
    stream.on('text', (delta) => res.write(delta));
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') res.write('\n[This page could not be generated.]');
    res.end();
  } catch (err) {
    if (res.writableEnded || res.destroyed) return;
    let note;
    if (err instanceof Anthropic.AuthenticationError) note = 'The Claude API key was rejected.';
    else if (err instanceof Anthropic.RateLimitError) note = 'Rate limited. Try again in a moment.';
    else if (err instanceof Anthropic.APIError) note = `Claude API error ${err.status}.`;
    else note = 'No Claude credentials found. Add ANTHROPIC_API_KEY to .env and restart.';
    console.error('answer failed:', err?.message ?? err);
    res.end(`[OFFLINE PAGE] ${note}\n\nYou asked: ${question}\nYou are standing near: ${near.join(', ') || 'nothing yet'}.`);
  }
});

app.listen(PORT, () => {
  console.log(`Vector Web running at http://localhost:${PORT}`);
  embed(['warm up']).catch((err) => console.error('Embedding model failed to load:', err.message));
});
