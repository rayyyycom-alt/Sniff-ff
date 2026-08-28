// modules/proxy.js - INTERCEPTOR + SNIFFER MODE
// Nangkep key strings dari response Garena, kirim ke Telegram
const https = require('https');
const zlib = require('zlib');
const { sendText } = require('./telegram');

const GARENA_LOGIN  = 'loginbp.ggpolarbear.com';
const GARENA_CLIENT = 'clientbp.ggpolarbear.com';

// ============================================================
// KEY STRINGS TO SNIFF
// Tambahin / kurangin sesuai kebutuhan lo
// ============================================================
const SNIFF_KEYS = [
    'enableUGCFullCustom',
    'enable_ugc',
    'ugc_full_custom',
    'workshop_switch',
    'enableUGC',
    'EnableUGC',
    'anti_hack_open',
    'anti_addiction_switch',
    'enableMod',
    'modEnabled',
    'TestModeEnabled',
    'DebugHack',
    'CheckHacker',
    'EnableNativeCheck',
    'EnablePlatformCheck',
    'enableIceWall',
    'enableHeadShot',
    'ForceHeadShot',
    'AimAssistMode',
    'HitBoxScale',
    'GravityScale',
    'JumpHeight',
    'MaxJumpCount',
    'free_rematch',
    'free_guest_login',
];

// ============================================================
// FORMAT ALERT MESSAGE
// ============================================================
function buildAlertMessage(endpoint, method, matches) {
    const ts = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    let msg = `🔍 <b>[REZA PROXY SNIFFER]</b>\n`;
    msg += `📡 <b>Endpoint:</b> <code>${endpoint}</code>\n`;
    msg += `📨 <b>Method:</b> <code>${method}</code>\n`;
    msg += `🕐 <b>Time:</b> <code>${ts} WIB</code>\n\n`;
    msg += `<b>🎯 Detected Strings:</b>\n`;
    for (const { key, value } of matches) {
        msg += `  • <code>${key}</code>: <b>${value}</b>\n`;
    }
    return msg;
}

// ============================================================
// EXTRACT KEY-VALUE MATCHES FROM BODY STRING
// Handles both JSON {"key":true} and flat string "key":true
// ============================================================
function extractMatches(bodyStr) {
    const found = [];
    for (const key of SNIFF_KEYS) {
        // Regex: match "key": value (string, number, bool)
        const pattern = new RegExp(`"${key}"\\s*:\\s*([^,}\\]\\s]+|"[^"]*")`, 'gi');
        let match;
        while ((match = pattern.exec(bodyStr)) !== null) {
            const value = match[1].replace(/"/g, '').trim();
            // Avoid duplicate same key+value
            if (!found.find(f => f.key === key && f.value === value)) {
                found.push({ key, value });
            }
        }
    }
    return found;
}

// ============================================================
// DECOMPRESS RESPONSE (gzip / deflate / br / raw)
// ============================================================
function decompress(encoding, buffer) {
    return new Promise((resolve) => {
        if (!encoding) return resolve(buffer);
        const enc = encoding.toLowerCase();
        if (enc.includes('br')) {
            zlib.brotliDecompress(buffer, (err, result) => resolve(err ? buffer : result));
        } else if (enc.includes('gzip')) {
            zlib.gunzip(buffer, (err, result) => resolve(err ? buffer : result));
        } else if (enc.includes('deflate')) {
            zlib.inflate(buffer, (err, result) => resolve(err ? buffer : result));
        } else {
            resolve(buffer);
        }
    });
}

// ============================================================
// FORWARD REQUEST + INTERCEPT RESPONSE
// ============================================================
function forwardRequest(targetHost, req, res) {
    // Build options
    const options = {
        hostname: targetHost,
        path: req.originalUrl,
        method: req.method,
        headers: {
            ...req.headers,
            'Host': targetHost,
        },
        timeout: 15000,
    };

    // Remove headers yang bisa bikin masalah
    delete options.headers['host'];
    delete options.headers['content-length']; // kita set ulang nanti

    // Fix content-length kalau ada body
    const bodyBuf = Buffer.isBuffer(req.body) ? req.body : null;
    if (bodyBuf && bodyBuf.length > 0) {
        options.headers['content-length'] = bodyBuf.length;
    }

    const endpoint = `/${req.path.replace(/^\//, '')}`;
    console.log(`[PROXY] ${req.method} ${targetHost}${endpoint}`);

    const proxyReq = https.request(options, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', (chunk) => chunks.push(chunk));
        proxyRes.on('end', async () => {
            const rawBuffer = Buffer.concat(chunks);
            const encoding = proxyRes.headers['content-encoding'] || '';

            // Decompress buat sniffing
            let decompressed;
            try {
                decompressed = await decompress(encoding, rawBuffer);
            } catch {
                decompressed = rawBuffer;
            }

            const bodyStr = decompressed.toString('utf8');

            // ===== SNIFF =====
            try {
                const matches = extractMatches(bodyStr);
                if (matches.length > 0) {
                    const msg = buildAlertMessage(
                        `${targetHost}${endpoint}`,
                        req.method,
                        matches
                    );
                    sendText(msg);
                    console.log(`[SNIFFER] 🎯 Found ${matches.length} key(s) on ${endpoint}`);
                    matches.forEach(m => console.log(`  >> "${m.key}": ${m.value}`));
                }
            } catch (err) {
                console.log(`[SNIFFER] Parse error: ${err.message}`);
            }
            // ===== END SNIFF =====

            // Forward response as-is ke client (raw compressed)
            const resHeaders = { ...proxyRes.headers };
            // Hapus transfer-encoding biar ga double
            delete resHeaders['transfer-encoding'];

            res.writeHead(proxyRes.statusCode, resHeaders);
            res.end(rawBuffer);
        });

        proxyRes.on('error', (err) => {
            console.log(`[PROXY] Response error: ${err.message}`);
            if (!res.headersSent) res.status(502).end();
        });
    });

    proxyReq.on('error', (err) => {
        console.log(`[PROXY] Request error: ${err.message}`);
        if (!res.headersSent) res.status(502).json({ code: 502, message: 'Proxy error' });
    });

    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!res.headersSent) res.status(504).json({ code: 504, message: 'Timeout' });
    });

    // Write body ke upstream
    if (bodyBuf && bodyBuf.length > 0) {
        proxyReq.write(bodyBuf);
    }
    proxyReq.end();
}

// ============================================================
// INIT
// ============================================================
function init(app) {
    // === STATUS ENDPOINT ===
    app.get('/api/proxy/status', (req, res) => {
        res.json({
            status: 'online',
            mode: 'interceptor_sniffer',
            sniff_keys: SNIFF_KEYS,
            targets: {
                login: `https://${GARENA_LOGIN}`,
                client: `https://${GARENA_CLIENT}`,
            },
            timestamp: Date.now(),
        });
    });

    // === WILDCARD PROXY ===
    app.all('*', (req, res, next) => {
        const p = req.path;

        // Skip CDN, asset, ver.php, static
        if (p.startsWith('/cdn/') || p.startsWith('/public/')) return next();
        if (p === '/ver.php' || p === '/api/gamevar') return next();
        if (p === '/api/proxy/status' || p === '/api/device') return next();
        if (p.startsWith('/auth/')) return next();
        if (p.startsWith('/localconfig')) return next();
        if (/\.(jpg|png|gif|css|js|html|ico|svg)$/i.test(p)) return next();

        // Route ke server yang tepat
        if (p === '/MajorLogin' || p === '/Ping' && req.headers.host?.includes('login')) {
            return forwardRequest(GARENA_LOGIN, req, res);
        }

        // Default: semua ke clientbp
        return forwardRequest(GARENA_CLIENT, req, res);
    });

    console.log('[PROXY] Interceptor+Sniffer mode active');
    console.log(`[PROXY] Watching ${SNIFF_KEYS.length} key strings`);
    console.log(`[PROXY] Login  => https://${GARENA_LOGIN}`);
    console.log(`[PROXY] Client => https://${GARENA_CLIENT}`);
}

module.exports = { init };
