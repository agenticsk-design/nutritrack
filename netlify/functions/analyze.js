const https = require('https');

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

function callAnthropic(payload, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const apiKey = event.headers['x-api-key'] || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No API key provided' }) };

  let input;
  try { input = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  let userContent;
  if (input.type === 'image') {
    userContent = [
      { type: 'image', source: { type: 'base64', media_type: input.mediaType || 'image/jpeg', data: input.data } },
      { type: 'text', text: 'Analyze the nutritional content of this food.' },
    ];
  } else {
    userContent = `Analyze the nutritional content of: ${input.description}`;
  }

  try {
    const result = await callAnthropic({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }, apiKey);

    return { statusCode: result.status, headers, body: result.body };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
