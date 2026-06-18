export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { permit } = req.query;
  if (!permit) return res.status(400).json({ error: 'permit parameter required' });

  try {
    const parts = permit.split('-');
    if (parts.length !== 3) return res.status(400).json({ error: 'Invalid permit format' });

    const [id1, id2, id3] = parts;
    const url = `https://www.ladbsservices2.lacity.org/OnlineServices/PermitReport/PcisPermitDetail?id1=${id1}&id2=${id2}&id3=${id3}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });

    const html = await response.text();

    if (html.length < 500 || !html.includes('Permit Application Status History')) {
      return res.status(200).json({ permit, _empty: true });
    }

    let workDescription = '';
    const wdMatch = html.match(/Work\s*Description\s*<\/\w+>\s*([^<]{3,200})/i);
    if (wdMatch) workDescription = wdMatch[1].trim();

    let currentStatus = '';
    const csMatch = html.match(/Current\s*Status\s*<\/\w+>\s*([^<]{3,100})/i);
    if (csMatch) currentStatus = csMatch[1].trim();

    let cofoStatus = '';
    const cofoMatch = html.match(/Certificate\s*of\s*Occupancy\s*<\/\w+>\s*([^<]{3,100})/i);
    if (cofoMatch) cofoStatus = cofoMatch[1].trim();

    const planCheck = [];
    const pcSection = html.match(/Permit\s*Application\s*Status\s*History[\s\S]*?(<table[\s\S]*?<\/table>)/i);
    if (pcSection) {
      const rows = pcSection[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      for (const row of rows) {
        if (row.includes('<th')) continue;
        const cells = [];
        const cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cm;
        while ((cm = cellRx.exec(row)) !== null) cells.push(cm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
        if (cells.length >= 2 && cells[0]) planCheck.push({ status: cells[0], date: cells[1] || '', person: cells[2] || '' });
      }
    }

    // Derive current status from last plan check entry if not found
    if (!currentStatus && planCheck.length > 0) {
      currentStatus = planCheck[planCheck.length - 1].status;
    }

    const history = [];
    const inspSection = html.match(/Inspection\s*Request\s*History[\s\S]*?(<table[\s\S]*?<\/table>)/i);
    if (inspSection) {
      const rows = inspSection[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      for (const row of rows) {
        if (row.includes('<th')) continue;
        const cells = [];
        const cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cm;
        while ((cm = cellRx.exec(row)) !== null) cells.push(cm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
        if (cells.length >= 3 && cells[0]) history.push({ name: cells[0], date: cells[1] || '', status: cells[2] || '', inspector: cells[3] || '' });
      }
    }

    const clearances = [];
    const clrSection = html.match(/Permit\s*Application\s*Clearance\s*Information[\s\S]*?(<table[\s\S]*?<\/table>)/i);
    if (clrSection) {
      const rows = clrSection[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      for (const row of rows) {
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
