/**
 * Cloudflare Worker: Anonymous GitHub Issue Reporter for IPTV Live TV
 *
 * Allows LG webOS, Android TV, and Web users to submit bug reports with
 * automatic redacted diagnostic logs directly to GitHub Issues without
 * requiring a user GitHub account.
 *
 * Secret required:
 *   GITHUB_TOKEN — Fine-grained PAT with `Issues: Write` on `maorisraelii/iptv-webos` ONLY.
 */

const GITHUB_OWNER = 'maorisraelii';
const GITHUB_REPO = 'iptv-webos';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }
  });
}

function clampStr(val, maxLen) {
  if (val === null || typeof val === 'undefined') return '';
  const s = String(val).trim();
  return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
    }

    if (!env || !env.GITHUB_TOKEN) {
      return jsonResponse({ ok: false, error: 'Missing GITHUB_TOKEN secret' }, 500);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const title = clampStr(payload && payload.title, 120) || 'In-App Bug Report';
    const description = clampStr(payload && payload.description, 2000) || 'No description provided.';
    const meta = (payload && typeof payload.meta === 'object' && payload.meta) || {};
    const rawLogs = Array.isArray(payload && payload.logs) ? payload.logs.slice(-80) : [];
    const safeLogs = rawLogs.map((line) => clampStr(line, 360)).filter(Boolean);

    const bodyLines = [
      '### תיאור התקלה',
      description,
      '',
      '### פרטי מערכת (אוטומטי)',
      `- **גרסה:** \`v${clampStr(meta.version || 'unknown', 32)}\` (בסיס: \`v${clampStr(meta.baseVersion || 'unknown', 32)}\`)`,
      `- **פלטפורמה:** ${clampStr(meta.platform || 'unknown', 40)} (${clampStr(meta.viewport || '', 24)})`,
      `- **ערכת נושא / פריסט:** \`${clampStr(meta.theme || 'classic', 24)}\` / \`${clampStr(meta.uiPreset || 'clean', 24)}\``,
      `- **באפר / השוואת סאונד:** \`${clampStr(meta.bufferMode || 'smart', 24)}\` / \`${clampStr(meta.audioNormMode || 'off', 24)}\``,
      `- **ערוצים / EPG:** ${Number(meta.channelsCount) || 0} | EPG: ${meta.epgLoaded ? 'Active' : 'Empty'}`,
      `- **זמן דיווח:** \`${clampStr(meta.timestamp || new Date().toISOString(), 40)}\``,
      '',
      '<details>',
      `<summary>לוגים טכניים אוטומטיים (${safeLogs.length} שורות)</summary>`,
      '',
      '```text',
      safeLogs.length > 0 ? safeLogs.join('\n') : '(no errors logged)',
      '```',
      '</details>'
    ];

    const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'IPTV-Live-Issue-Reporter',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: `[In-App] ${title}`,
        body: bodyLines.join('\n'),
        labels: ['bug', 'in-app-report']
      })
    });

    if (!ghRes.ok) {
      const errText = await ghRes.text();
      return jsonResponse({ ok: false, error: `GitHub API ${ghRes.status}: ${clampStr(errText, 200)}` }, 502);
    }

    const created = await ghRes.json();
    return jsonResponse(
      {
        ok: true,
        issueNumber: created.number,
        issueUrl: created.html_url
      },
      201
    );
  }
};
