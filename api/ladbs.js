export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { permit, parcel, street_number, street_name } = req.query;

  // ── ADDRESS LOOKUP via LA Open Data ──
  // When parcel ID is passed, we also need the address to query open data
  // The app passes street_number and street_name separately for the lookup
  if (street_number && street_name) {
    try {
      const encodedNum = encodeURIComponent(street_number.trim());
      const encodedName = encodeURIComponent(street_name.trim().toUpperCase());
      // Socrata SoQL query — filter by address, get recent permits
      const url = `https://data.lacity.org/resource/hbkd-qubn.json?address_start=${encodedNum}&street_name=${encodedName}&$limit=50&$order=issue_date+DESC`;
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      const data = await resp.json();
      const permits = (data || []).map(p => ({
        num: (p['pcis_permit_'] || p['pcis_permit_number'] || '').trim(),
        type: p['permit_type'] || '',
        status: p['status'] || '',
        date: p['issue_date'] ? p['issue_date'].split('T')[0] : '',
        workDescription: p['work_description'] || ''
      })).filter(p => p.num.match(/\d{5}-\d{5}-\d{5}/));
      return res.status(200).json({ permits, count: permits.length });
    } catch(err) {
      return res.status(500).json({ error: err.message, permits: [] });
    }
  }

  // ── PERMIT DETAIL LOOKUP ──
  if (!permit) {
    return res.status(400).json({ error: 'permit, or street_number+street_name required' });
  }

  try {
    const parts = permit.split('-');
    if (parts.length !== 3) {
      return res.status(400).json({ error: 'Invalid permit format. Expected: XXXXX-XXXXX-XXXXX' });
    }
    const [id1, id2, id3] = parts;
    const detailUrl = `https://www.ladbsservices2.lacity.org/OnlineServices/PermitReport/PcisPermitDetail?id1=${id1}&id2=${id2}&id3=${id3}`;
    const response = await fetch(detailUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });
    const html = await response.text();

    let currentStatus = '';
    for (const pat of [/Status[:\s]*<[^>]*>([^<]+)</i, /<td[^>]*>\s*Status\s*<\/td>\s*<td[^>]*>([^<]+)</i]) {
      const m = html.match(pat);
      if (m && m[1].trim()) { currentStatus = m[1].trim(); break; }
    }

    let cofoStatus = '';
    const cofoMatch = html.match(/C\s*of\s*O[:\s]*([^<\n,;]+)/i);
    if (cofoMatch) cofoStatus = cofoMatch[1].trim();

    let workDescription = '';
    const wdMatch = html.match(/Work\s*Description[:\s]*<[^>]*>([^<]+)</i);
    if (wdMatch) workDescription = wdMatch[1].trim();

    const planCheck = [];
    const pcSection = html.match(/Plan\s*Check[\s\S]{0,200}?(<table[\s\S]*?<\/table>)/i);
    if (pcSection) {
      for (const row of (pcSection[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [])) {
        if (row.includes('<th')) continue;
        const cells = [];
        const cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cm;
        while ((cm = cellRx.exec(row)) !== null) cells.push(cm[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim());
        if (cells.length >= 2 && cells[0]) planCheck.push({ status: cells[0], date: cells[1]||'', person: cells[2]||'' });
      }
    }

    const history = [];
    const inspSection = html.match(/Inspection\s*History[\s\S]{0,200}?(<table[\s\S]*?<\/table>)/i) ||
                        html.match(/INSPECTION[\s\S]{0,100}?(<table[\s\S]*?<\/table>)/i);
    if (inspSection) {
      for (const row of (inspSection[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [])) {
        if (row.includes('<th')) continue;
        const cells = [];
        const cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cm;
        while ((cm = cellRx.exec(row)) !== null) cells.push(cm[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim());
        if (cells.length >= 3 && cells[0]) history.push({ name: cells[0], date: cells[1]||'', status: cells[2]||'', inspector: cells[3]||'' });
      }
    }

    const clearances = [];
    const clrSection = html.match(/Clearance[\s\S]{0,200}?(<table[\s\S]*?<\/table>)/i);
    if (clrSection) {
      for (const row of (clrSection[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [])) {
        if (row.includes('<th')) continue;
        const cells = [];
        const cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cm;
        while ((cm = cellRx.exec(row)) !== null) cells.push(cm[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim());
        if (cells.length >= 2 && cells[0]) clearances.push({ name: cells[0], status: cells[1]||'', date: cells[2]||'' });
      }
    }

    return res.status(200).json({ currentStatus, cofoStatus, workDescription, planCheck, history, clearances, permit });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
