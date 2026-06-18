export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { permit } = req.query;

  if (!permit) return res.status(400).json({ error: 'permit parameter required' });

  try {
    const parts = permit.split('-');
    if (parts.length !== 3) return res.status(400).json({ error: 'Invalid permit format. Expected: XXXXX-XXXXX-XXXXX' });

    const [id1, id2, id3] = parts;
    const detailUrl = `https://www.ladbsservices2.lacity.org/OnlineServices/PermitReport/PcisPermitDetail?id1=${id1}&id2=${id2}&id3=${id3}`;

    const response = await fetch(detailUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });

    const html = await response.text();

    // Return _empty if permit doesn't exist
    if (
      html.length < 500 ||
      html.includes('No record found') ||
      html.includes('Record Not Found') ||
      html.includes('no permits found') ||
      !html.includes('Work Description') ||
      !html.includes('Permit Type')
    ) {
      return res.status(200).json({ permit, _empty: true });
    }

    // Current status
    let currentStatus = '';
    for (const pat of [/Status[:\s]*<[^>]*>([^<]+)</i, /<td[^>]*>\s*Status\s*<\/td>\s*<td[^>]*>([^<]+)</i]) {
      const m = html.match(pat);
      if (m && m[1].trim()) { currentStatus = m[1].trim(); break; }
    }

    // C of O
    let cofoStatus = '';
    const cofoMatch = html.match(/C\s*of\s*O[:\s]*([^<\n,;]+)/i);
    if (cofoMatch) cofoStatus = cofoMatch[1].trim();

    // Work description
    let workDescription = '';
    const wdMatch = html.match(/Work\s*Description[:\s]*<[^>]*>([^<]+)</i) ||
                    html.match(/<td[^>]*>\s*Work\s*Description\s*<\/td>\s*<td[^>]*>([^<]+)</i);
    if (wdMatch) workDescription = wdMatch[1].trim();

    // Plan check history
    const planCheck = [];
    const pcSection = html.match(/Plan\s*Check[\s\S]{0,200}?(<table[\s\S]*?<\/table>)/i);
    if (pcSection) {
      for (const row of (pcSection[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [])) {
        if (row.includes('<th')) continue;
        const cells = [];
        const cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cm;
        while ((cm = cellRx.exec(row)) !== null) cells.push(cm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
        if (cells.length >= 2 && cells[0]) planCheck.push({ status: cells[0], date: cells[1] || '', person: cells[2] || '' });
      }
    }

    // Inspection history
    const history = [];
    const inspSection = html.match(/Inspection\s*History[\s\S]{0,200}?(<table[\s\S]*?<\/table>)/i) ||
                        html.match(/INSPECTION[\s\S]{0,100}?(<table[\s\S]*?<\/table>)/i);
    if (inspSection) {
      for (const row of (inspSection[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [])) {
        if (row.includes('<th')) continue;
        const cells = [];
        const cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cm;
        while ((cm = cellRx.exec(row)) !== null) cells.push(cm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
        if (cells.length >= 3 && cells[0]) history.push({ name: cells[0], date: cells[1] || '', status: cells[2] || '', inspector: cells[3] || '' });
      }
    }

    // Clearances
    const clearances = [];
    const clrSection = html.match(/Clearance[\s\S]{0,200}?(<table[\s\S]*?<\/table>)/i);
    if (clrSection) {
      for (const row of (clrSection[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [])) {
        if (row.includes('<th')) continue;
        const cells = [];
        const cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cm;
        while ((cm = cellRx.exec(row)) !== null) cells.push(cm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
        if (cells.length >= 2 && cells[0]) clearances.push({ name: cells[0], status: cells[1] || '', date: cells[2] || '' });
      }
    }

    return res.status(200).json({ permit, currentStatus, cofoStatus, workDescription, planCheck, history, clearances });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
