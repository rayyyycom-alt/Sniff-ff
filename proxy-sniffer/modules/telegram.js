// modules/telegram.js
const https = require('https');

// ============================================================
// CONFIG — bisa pakai ENV var atau hardcode di sini
// ============================================================
const TOKEN   = process.env.TG_TOKEN   || '8345153131:AAFjE3ym3vuxonbXtczTlEiANUtmYO_8hZM';
const CHAT_ID = process.env.TG_CHAT_ID || '7711546886';

// ============================================================
// INTERNAL: fire and forget https POST ke TG
// ============================================================
function tgPost(path, payload) {
    const body = JSON.stringify(payload);
    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${TOKEN}/${path}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000,
    };

    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
            if (res.statusCode !== 200) {
                try {
                    const parsed = JSON.parse(data);
                    console.log(`[TG ERROR] ${path}: ${parsed.description}`);
                } catch {
                    console.log(`[TG ERROR] ${path}: HTTP ${res.statusCode}`);
                }
            }
        });
    });

    req.on('error', (err) => console.log(`[TG ERROR] ${err.message}`));
    req.on('timeout', () => { req.destroy(); console.log('[TG ERROR] Timeout'); });

    req.write(body);
    req.end();
}

// ============================================================
// EXPORTS
// ============================================================
function sendText(message, options = {}) {
    tgPost('sendMessage', {
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options,
    });
}

function sendPhoto(photoUrl, caption = '') {
    tgPost('sendPhoto', {
        chat_id: CHAT_ID,
        photo: photoUrl,
        caption: caption || `Asset Detected:\n${photoUrl}`,
    });
}

function sendDocument(docUrl, caption = '') {
    tgPost('sendDocument', {
        chat_id: CHAT_ID,
        document: docUrl,
        caption,
    });
}

// Init: pasang middleware intercept .jpg ke TG
function init(app) {
    app.use((req, res, next) => {
        if (req.originalUrl.toLowerCase().endsWith('.jpg')) {
            const fullUrl = req.originalUrl.startsWith('http')
                ? req.originalUrl
                : `https://dl.cdn.freefiremobile.com${req.originalUrl}`;
            sendPhoto(fullUrl);
        }
        next();
    });
}

module.exports = { sendText, sendPhoto, sendDocument, init };
