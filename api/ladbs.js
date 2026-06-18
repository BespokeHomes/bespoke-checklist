export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { permit, parcel, address } = req.query;

  // ── PARCEL / ADDRESS LOOKUP via LA Open Data API ──
  if (parcel || address) {
    try {
      // Query the LA Open Data LADBS Permits dataset
      // Dataset: https://data.lacity.org/City-Infrastructure-Service-Requests/LADBS-Permits/hbkd-qubn
      // We search by address since the open data uses APN not the LADBS parcel ID
      // First try to get permits by address using the parcel ID to find address
      
      let permits = [];

      // Try LA Open Data API - search for recent permits at this address
      // The LADBS open data API endpoint
      const searchAddr = address || '';
      const socrataUrl = `https://data.lacity.org/resource/hbkd-qubn.json?$where=status_date>'2024-01-01'&$limit=50&$order=status_date DESC`;
      
      // Better approach: use the LADBS internal permit search API
      // which is called by the LADBS website itself
      const ladbs_api_url = `https://www.ladbsservices2.lacity.org/OnlineServices/PermitReport/GetPermitList?parcelId=${encodeURIComponent(parcel || '')}&_=${Date.now()}`;
      
      let apiData = null;
      try {
        const apiResp = await fetch(ladbs_api_url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'application/json, text/javascript, */*',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `https://www.ladbsservices2.lacity.org/OnlineServices/PermitReport/PermitResults/${parcel}`,
          }
        });
        const text = await apiResp.text();
        // Try to parse as JSON
        try { apiData = JSON.parse(text); } catch(e) { apiData = null; }
      } catch(e) { apiData = null; }

      if (apiData && Array.isArray(apiData)) {
        permits = apiData.map(p => ({
          num: p.permitNumber || p.PermitNumber || p.permit_number || '',
          type: p.permitType || p.PermitType || '',
          status: p.status || p.Status || '',
          date: p.statusDate || p.StatusDate || '',
          workDescription: p.workDescription || p.WorkDescription || ''
        })).filter(p => p.num);
      }

      // If internal API didn't work, fall back to known permits for this parcel
      // For parcel 895239 (354 N Entrada Dr) we know the permits
      if (permits.length === 0) {
        // Return empty and let frontend fall back to manual permits
        return res.status(200).json({ 
          permits: [], 
          count: 0,
          message: 'Parcel lookup requires manual permit entry - LADBS data loads client-side only'
        });
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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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

    return res.status(200).json({
      currentStatus,
      cofoStatus,
      workDescription,
      planCheck,
      history,
      clearances,
      permit
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
