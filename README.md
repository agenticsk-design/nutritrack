# 🥗 NutriTrack

A clean, private nutrition tracker powered by **Claude AI** (Anthropic). Describe food in text or upload a photo — Claude identifies calories, macros, fats, sodium, vitamins, and more. Everything is saved locally to your browser.

## Quick Start

### 1. Get an Anthropic API key
Sign up at [console.anthropic.com](https://console.anthropic.com) and create an API key.

### 2. Run the server
```bash
node server.js
```

### 3. Open the app
Visit [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Enter your API key
On first load, a prompt will ask for your Anthropic API key (`sk-ant-...`). It's stored in your browser's localStorage — never sent anywhere except directly to Anthropic's API.

---

## Features

- **Text or photo input** — describe food or upload a picture
- **Full nutrient breakdown** — calories, carbs (total/sugar/fiber), protein, fat (total/saturated/unsaturated/trans), sodium, vitamins
- **Daily food log** — auto-saved to localStorage
- **Browse past days** — navigate with prev/next arrows
- **Daily totals** — running sum of calories, carbs, protein, fat

## Privacy

- No database, no account, no tracking
- Food data stored only in your browser's `localStorage`
- API key stored in your browser's `localStorage`
- The only external call is to `api.anthropic.com` to analyze food

## Requirements

- Node.js (any recent version — no npm install needed)
- An Anthropic API key with Claude access

## Optional: .env file

Instead of entering the key in the browser, you can set it server-side:

```bash
echo "ANTHROPIC_API_KEY=sk-ant-your-key-here" > .env
node server.js
```

The browser-entered key takes priority if both are set.
