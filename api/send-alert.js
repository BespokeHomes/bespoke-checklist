export const config = { runtime: 'edge' };

const RECIPIENT = 'matthew@bespokehomesca.com';
const FROM = 'Bespoke Homes <alerts@bespokehomesca.com>';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  let body;
  try { body = await req.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const { project, address, tab, item, isPhase, completedBy, timestamp } = body;
  const subject = isPhase ? `✅ ${project} — ${item} Complete` : `✅ ${project} — ${item} Checklist Complete`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:'Helvetica Neue',Arial,sans-serif;background:#F6F2EB;margin:0;padding:20px}.card{background:#fff;border-radius:6px;max-width:520px;margin:0 auto;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)}.header{background:#0E0E0C;padding:24px 28px}.logo{font-size:15px;letter-spacing:0.2em;color:#FAFAF7;text-transform:uppercase;font-weight:300}.logo em{color:#B8872A;font-style:normal}.gold-rule{height:2px;background:linear-gradient(90deg,#B8872A 0%,rgba(184,135,42,0.1) 100%)}.body{padding:28px}.badge{display:inline-block;background:#EAF2ED;color:#2D5238;font-size:11px;font-weight:600;padding:4px 12px;border-radius:20px;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:16px}.title{font-size:22px;font-weight:300;color:#1A1A18;margin-bottom:4px}.subtitle{font-size:13px;color:#888880;margin-bottom:20px}.detail-row{display:flex;align-items:baseline;gap:10px;padding:8px 0;border-bottom:1px solid #EAE4D8}.detail-label{font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#B8872A;font-weight:700;width:80px;flex-shrink:0}.detail-value{font-size:13px;color:#2C2C28;font-weight:500}.cta{display:block;background:#0E0E0C;color:#FAFAF7;text-decoration:none;text-align:center;padding:13px 20px;border-radius:3px;font-size:12px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;margin-top:22px}.footer{padding:16px 28px;font-size:10px;color:#888880;text-align:center;border-top:1px solid #EAE4D8}</style></head><body><div class="card"><div class="header"><div class="logo">BESPOKE <em>Homes</em></div></div><div class="gold-rule"></div><div class="body"><div class="badge">${isPhase?'Phase Complete':'Checklist Complete'}</div><div class="title">${item}</div><div class="subtitle">${project}${address?' · '+address:''}</div><div class="detail-row"><span class="detail-label">Completed by</span><span class="detail-value">${completedBy}</span></div><div class="detail-row"><span class="detail-label">Section</span><span class="detail-value">${tab}</span></div><div class="detail-row"><span class="detail-label">Time</span><span class="detail-value">${timestamp}</span></div><a href="https://bespoke-checklist.vercel.app" class="cta">Open Project Checklist →</a></div><div class="footer">Bespoke Homes Project Management · Automated alert</div></div></body></html>`;
  try {
    const resp = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [RECIPIENT], subject, html }) });
    const result = await resp.json();
    if (!resp.ok) return new Response(JSON.stringify({ error: result }), { status: resp.status, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ success: true, id: result.id }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
