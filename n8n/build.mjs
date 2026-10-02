// Builds n8n/pirch26-bots.json from public/js/bots-core.js (so bot logic lives in one place).
// Usage: node n8n/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const here = new URL('.', import.meta.url);
const core = readFileSync(new URL('../public/js/bots-core.js', here), 'utf8').replace(/^export /gm, '');
const header = '// ---- generated from public/js/bots-core.js — edit that file, then run: node n8n/build.mjs ----\n';

const brain = `${header}${core}
// ---- n8n glue ----
const data = $getWorkflowStaticData('global');
data.bots = data.bots || {};
const evt = $input.first().json.body || {};
const r = handleEvent(evt, data.bots, { youtube: true });
const rows = r.replies.map(x => ({ json: { action: 'reply', room: x.room, kind: x.kind, body: x.body, sender: BOTS[x.bot].id } }));
if (r.search) rows.push({ json: { action: 'search', search: r.search } });
return rows;
`;
const dj = `${header}${core}
// ---- n8n glue ----
const data = $getWorkflowStaticData('global');
data.bots = data.bots || {};
const search = $('Bot brain').all().map(i => i.json).find(j => j.action === 'search').search;
const res = parseYouTubeSearch($input.first().json);
return searchResult(search, res, data.bots).map(x => ({ json: { room: x.room, kind: x.kind, body: x.body, sender: BOTS[x.bot].id } }));
`;

const node = (name, type, typeVersion, position, parameters, extra = {}) => ({ id: randomUUID(), name, type, typeVersion, position, parameters, ...extra });
const field = (id, v) => ({ fieldId: id, fieldValue: v });
const nodes = [
  node('Chat event (from Supabase)', 'n8n-nodes-base.webhook', 2, [0, 300],
    { httpMethod: 'POST', path: 'pirch26-bots', authentication: 'headerAuth', responseMode: 'onReceived', options: {} },
    { webhookId: randomUUID() }),
  node('Bot brain', 'n8n-nodes-base.code', 2, [240, 300], { jsCode: brain }),
  node('Need YouTube search?', 'n8n-nodes-base.if', 2.2, [480, 300], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ id: randomUUID(), leftValue: '={{ $json.action }}', rightValue: 'search', operator: { type: 'string', operation: 'equals' } }],
      combinator: 'and',
    },
    options: {},
  }),
  node('Search YouTube', 'n8n-nodes-base.httpRequest', 4.2, [720, 180], {
    url: 'https://www.googleapis.com/youtube/v3/search',
    authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth',
    sendQuery: true,
    queryParameters: { parameters: [
      { name: 'part', value: 'snippet' }, { name: 'type', value: 'video' }, { name: 'videoEmbeddable', value: 'true' },
      { name: 'maxResults', value: '1' }, { name: 'regionCode', value: 'TH' }, { name: 'q', value: '={{ $json.search.query }}' },
    ] },
    options: {},
  }, { onError: 'continueRegularOutput' }),
  node('DJ picks the song', 'n8n-nodes-base.code', 2, [960, 180], { jsCode: dj }),
  node('Bot says (insert message)', 'n8n-nodes-base.supabase', 1, [1200, 320], {
    operation: 'create', tableId: 'messages', dataToSend: 'defineBelow',
    fieldsUi: { fieldValues: [field('room', '={{ $json.room }}'), field('kind', '={{ $json.kind }}'), field('body', '={{ $json.body }}'), field('sender', '={{ $json.sender }}')] },
  }),
  node('README', 'n8n-nodes-base.stickyNote', 1, [-40, -60], { width: 760, height: 300, content:
`## PIRCH26 Bots 🤖
ตั้ง credential 3 ตัวก่อนกด Active:
1. **Chat event** → Header Auth: Name = \`X-Pirch-Secret\`, Value = รหัสลับเดียวกับใน bot_config ของ Supabase
2. **Search YouTube** → Query Auth: Name = \`key\`, Value = YouTube Data API v3 key
3. **Bot says** → Supabase API: Host = URL โปรเจกต์ Supabase, Service Role Secret = service_role key

Production URL ของ webhook นี้ → ใส่ใน \`bot_config.webhook_url\` (ดู supabase/v4-bots.sql)
โค้ดบอทสร้างจาก public/js/bots-core.js — อย่าแก้ในนี้ ให้แก้ไฟล์นั้นแล้วรัน \`node n8n/build.mjs\`` }),
];
const by = n => nodes.find(x => x.name === n).name;
const connections = {
  [by('Chat event (from Supabase)')]: { main: [[{ node: 'Bot brain', type: 'main', index: 0 }]] },
  'Bot brain': { main: [[{ node: 'Need YouTube search?', type: 'main', index: 0 }]] },
  'Need YouTube search?': { main: [
    [{ node: 'Search YouTube', type: 'main', index: 0 }],
    [{ node: 'Bot says (insert message)', type: 'main', index: 0 }],
  ] },
  'Search YouTube': { main: [[{ node: 'DJ picks the song', type: 'main', index: 0 }]] },
  'DJ picks the song': { main: [[{ node: 'Bot says (insert message)', type: 'main', index: 0 }]] },
};
const wf = { id: 'PIRCH26botsWF001', name: 'PIRCH26 Bots', nodes, connections, active: false, settings: { executionOrder: 'v1' }, pinData: {} };
writeFileSync(new URL('pirch26-bots.json', here), JSON.stringify(wf, null, 2));
console.log('wrote n8n/pirch26-bots.json', nodes.length, 'nodes');
