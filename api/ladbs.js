export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const permit = searchParams.get('permit');
  if (!permit) return respond({ error: 'No permit number provided' });
  const parts = permit.split('-');
  if (parts.length !== 3) return respond({ error: 'Invalid permit format. Expected XXXXX-XXXXXX-XXXXX' });
  const url = `https://www.ladbsservices2.lacity.org/OnlineServices/PermitReport/PcisPermitDetail?id1=${parts[0]}&id2=${parts[1]}&id3=${parts[2]}`;
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.ladbsservices2.lacity.org/OnlineServices/?service=plr',
      }
    });
    if (!resp.ok) return respond({ error: `LADBS returned ${resp.status}` });
    const html = await resp.text();
    const parseTable = (label) => {
      const idx = html.indexOf(label);
      if (idx === -1) return [];
      const section = html.slice(idx, idx + 6000);
      const tableMatch = section.match(/<table[\s\S]*?<\/table>/i);
      if (!tableMatch) return [];
      const rows = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) || [];
      return rows.map(row => {
        const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
          .map(c => c.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#39;/g,"'").trim());
        return cells;
      }).filter(cells => cells.length >= 1 && cells[0] && cells[0] !== 'No Data Available.');
    };
    const planCheck = parseTable('Permit Application Status History').map(c => ({ status: c[0]||'', date: c[1]||'', person: c[2]||'' }));
    const clearances = parseTable('Permit Application Clearance Information').map(c => ({ name: c[0]||'', status: c[1]||'', date: c[2]||'', person: c[3]||'' }));
    const pending = parseTable('Pending Inspections').map(c => ({ name: c[0], date: c[1]||'', status: c[2]||'Pending', inspector: c[3]||'' }));
    const history = parseTable('Inspection Request History').map(c => ({ name: c[0], date: c[1]||'', status: c[2]||'', inspector: c[3]||'' }));
    const inspMatch = html.match(/Inspector Information[\s\S]{0,500}/i);
    const inspCells = inspMatch ? (inspMatch[0].match(/<td[^>]*>([\s\S]*?)<\/td>/gi)||[]).map(c=>c.replace(/<[^>]+>/g,'').trim()) : [];
    const inspector = inspCells[0] || '';
    const currentStatusMatch = html.match(/Current Status\s*<\/[^>]+>\s*([\s\S]{0,100})/i);
    const currentStatus = currentStatusMatch ? currentStatusMatch[1].replace(/<[^>]+>/g,'').trim().split('\n')[0].trim() : '';
    const workDescMatch = html.match(/Work Description\s*<\/[^>]+>\s*([\s\S]{0,300})/i);
    const workDescription = workDescMatch ? workDescMatch[1].replace(/<[^>]+>/g,'').trim().split('\n')[0].trim() : '';
    const cofoPendingMatch = html.match(/Certificate of Occupancy\s*<\/[^>]+>\s*([\s\S]{0,100})/i);
    const cofoStatus = cofoPendingMatch ? cofoPendingMatch[1].replace(/<[^>]+>/g,'').trim().split('\n')[0].trim() : '';
    const addrMatch = html.match(/Certificate Information:\s*([^<\n]+)/i);
    const address = addrMatch ? addrMatch[1].trim() : '';
    return respond({ permit, address, currentStatus, cofoStatus, workDescription, inspector, planCheck, clearances, pending, history, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return respond({ error: err.message });
  }
}

function respond(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 's-maxage=180' }
  });
}
