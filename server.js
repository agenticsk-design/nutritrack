#!/usr/bin/env node
/**
 * NutriTrack - Minimal Node.js proxy server
 * No npm required — uses only built-in modules
 * 
 * Usage:
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   node server.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
  });
}

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'text/plain';
  if (fs.existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}

function proxyToAnthropic(body, res, reqApiKey) {
  const key = reqApiKey || API_KEY;
  if (!key) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set. Add it to .env, export it, or enter it in the app.' }));
    return;
  }

  const payload = JSON.stringify(body);
  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
  };

  const req = https.request(options, apiRes => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
      res.end(data);
    });
  });

  req.on('error', err => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });

  req.write(payload);
  req.end();
}

const SYSTEM_PROMPT = `You are a nutrition expert. Given a food description or image, return a JSON object with accurate nutritional estimates for a typical serving. Return ONLY valid JSON, no markdown, no code fences.

Schema:
{
  "foodName": "string",
  "servingSize": "string (e.g. 1 cup, 100g, 1 medium apple)",
  "calories": number,
  "carbohydrates": { "total": number, "sugar": number, "fiber": number },
  "protein": number,
  "fat": { "total": number, "saturated": number, "unsaturated": number, "trans": number },
  "sodium": number,
  "vitamins": [{ "name": "string", "amount": "string" }],
  "confidence": "high|medium|low",
  "notes": "string"
}

All numeric values are in grams unless specified. Sodium in mg. Calories in kcal.`;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/api/analyze') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const input = JSON.parse(body);
        const reqApiKey = req.headers['x-api-key'] || '';
        let userContent;

        if (input.type === 'image') {
          userContent = [
            {
              type: 'image',
              source: { type: 'base64', media_type: input.mediaType || 'image/jpeg', data: input.data },
            },
            { type: 'text', text: 'Analyze the nutritional content of this food.' },
          ];
        } else {
          userContent = `Analyze the nutritional content of: ${input.description}`;
        }

        proxyToAnthropic({
          model: 'claude-sonnet-4-5',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userContent }],
        }, res, reqApiKey);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // Serve static files
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`\n🥗 NutriTrack running at http://localhost:${PORT}`);
  if (!API_KEY) console.warn('⚠️  ANTHROPIC_API_KEY not set — add it to .env or export it before analyzing food.');
  else console.log('✅ Anthropic API key loaded');
});
