export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { permit, parcel } = req.query;

  // ── PARCEL LOOKUP ──
  if (parcel) {
    try {
      const url = `https://www.ladbsservices2.lacity.org/OnlineServices/PermitReport/PermitResults/${encodeURIComponent(parcel)}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BespokeHomes/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        }
      });
      const html = await response.text();

      const permits = [];

      // Parse table rows
      const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
      const rows = html.match(rowRegex) || [];

      for (const row of rows) {
        if (row.includes('<th') || row.includes('Application/Permit')) continue;

        // Extract permit number from link
        const permitMatch = row.match(/PcisPermitDetail[^"]*">([^<]+)<\/a>/i) ||
                           row.match(/<a[^>]*>(\d{5}-\d{5}-\d{5})<\/a>/i);
        if (!permitMatch) continue;

        const num = permitMatch[1].trim();
        if (!num.match(/\d{5}-\d{5}-\d{5}/)) continue;

        // Extract cells
        const cells = [];
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(row)) !== null) {
          const text = cellMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
          cells.push(text);
        }

        // cells: [permit#, job#, type, status+date, workDesc]
        const type = cells[2] || '';
        const statusRaw = cells[3] || '';
        const statusMatch = statusRaw.match(/^(.+?)\s+(\d+\/\d+\/\d{4})$/);
        const status = statusMatch ? statusMatch[1].trim() : statusRaw;
        const date = statusMatch ? statusMatch[2] : '';
        const workDesc = cells[4] || '';

        permits.push({ num, type, status, date, workDescription: workDesc });
      }

      // Fallback: extract permit numbers directly from HTML if table parsing yielded nothing
      if (permits.length === 0) {
        const altMatches = html.match(/\d{5}-\d{5}-\d{5}/g) || [];
        const unique = [...new Set(altMatches)];
        for (const num of unique) {
          permits.push({ num, type: '', status: '', date: '', workDescription: '' });
        }
      }

      return res.status(200).json({ permits, count: permits.length });
    } catch (err) {
      return res.status(500).json({ error: err.message, permits: [] });
    }
  }

  // ── PERMIT DETAIL LOOKUP ──
  if (!permit) {
    return res.status(400).json({ error: 'permit or parcel parameter required' });
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
        'User-Agent': 'Mozilla/5.0 (compatible; BespokeHomes/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });

    const html = await response.text();

    // ── Current status ──
    let currentStatus = '';
    const statusPatterns = [
      /Status[:\s]*<[^>]*>([^<]+)</i,
      /<td[^>]*>\s*Status\s*<\/td>\s*<td[^>]*>([^<]+)</i,
      /class="[^"]*status[^"]*"[^>]*>([^<]+)</i,
    ];
    for (const pat of statusPatterns) {
      const m = html.match(pat);
      if (m && m[1].trim()) { currentStatus = m[1].trim(); break; }
    }

    // ── C of O ──
    let cofoStatus = '';
    const cofoMatch = html.match(/C\s*of\s*O[:\s]*([^<\n,;]+)/i) ||
                      html.match(/Certificate\s*of\s*Occupancy[:\s]*([^<\n,;]+)/i);
    if (cofoMatch) cofoStatus = cofoMatch[1].trim();

    // ── Work description ──
    let workDescription = '';
    const wdMatch = html.match(/Work\s*Description[:\s]*<[^>]*>([^<]+)</i) ||
                    html.match(/<td[^>]*>\s*Work\s*Description\s*<\/td>\s*<td[^>]*>([^<]+)</i);
    if (wdMatch) workDescription = wdMatch[1].trim();

    // ── Plan check history ──
    const planCheck = [];
    const pcSection = html.match(/Plan\s*Check[\s\S]{0,200}?(<table[\s\S]*?<\/table>)/i);
    if (pcSection) {
      const rowMatches = pcSection[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      for (const row of rowMatches) {
        if (row.includes('<th')) continue;
        const cells = [];
        const cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cm;
        while ((cm = cellRx.exec(row)) !== null) {
          cells.push(cm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
        }
        if (cells.length >= 2 && cells[0]) {
          planCheck.push({ status: cells[0], date: cells[1] || '', person: cells[2] || '' });
        }
      }
    }

    // ── Inspection history ──
    const history = [];
    const inspSection = html.match(/Inspection\s*History[\s\S]{0,200}?(<table[\s\S]*?<\/table>)/i) ||
                        html.match(/INSPECTION[\s\S]{0,100}?(<table[\s\S]*?<\/table>)/i);
    if (inspSection) {
      const rowMatches = inspSection[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      for (const row of rowMatches) {
        if (row.includes('<th')) continue;
        const cells = [];
        const cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cm;
        while ((cm = cellRx.exec(row)) !== null) {
          cells.push(cm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
        }
        if (cells.length >= 3 && cells[0]) {
          history.push({ name: cells[0], date: cells[1] || '', status: cells[2] || '', inspector: cells[3] || '' });
        }
      }
    }

    // ── Clearances ──
    const clearances = [];
    const clrSection = html.match(/Clearance[\s\S]{0,200}?(<table[\s\S]*?<\/table>)/i);
    if (clrSection) {
      const rowMatches = clrSection[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      for (const row of rowMatches) {
        if (row.includes('<th')) continue;
        const cells = [];
        const cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cm;
        while ((cm = cellRx.exec(row)) !== null) {
          cells.push(cm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
        }
        if (cells.length >= 2 && cells[0]) {
          clearances.push({ name: cells[0], status: cells[1] || '', date: cells[2] || '' });
        }
      }
    }

    // ── Inspector ──
    let inspector = '';
    const inspMatch = html.match(/Inspector[:\s]*<[^>]*>([^<]+)</i);
    if (inspMatch) inspector = inspMatch[1].trim();

    return res.status(200).json({
      currentStatus,
      cofoStatus,
      workDescription,
      planCheck,
      history,
      clearances,
      inspector,
      permit
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
