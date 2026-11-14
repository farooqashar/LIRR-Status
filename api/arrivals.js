// Proxy for the MTA TrainTime backend. Trims the payload and adds caching + CORS.
const UPSTREAM = 'https://backend-unified.mylirr.org/arrivals/';

const ENTITIES = {
  amp: '&', nbsp: ' ', quot: '"', lt: '<', gt: '>', apos: "'",
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', bull: '\u2022',
};

// Single pass, so `&amp;#39;` becomes `&#39;` and is not decoded again.
const decode = (s) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? m;
    const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });

const strip = (html = '') =>
  decode(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{2,}/g, '\n')
    .trim();

export default async function handler(req, res) {
  const station = String(req.query.station || 'HUN').toUpperCase();
  if (!/^[A-Z0-9]{2,4}$/.test(station)) {
    res.status(400).json({ error: 'bad station code' });
    return;
  }
  try {
    const r = await fetch(UPSTREAM + station, {
      headers: { 'Accept-Version': '3.0', Accept: 'application/json' },
    });
    if (!r.ok) {
      res.status(502).json({ error: `upstream ${r.status}` });
      return;
    }
    const j = await r.json();
    const trains = (j.arrivals || []).map((a) => ({
      id: a.train_id,
      num: a.train_num,
      time: a.time,
      dir: a.direction,
      branch: a.branch,
      stops: a.stops || [],
      track: a.track || null,
      schedTrack: a.sched_track || null,
      trackChange: !!a.track_change,
      nonstandard: !!a.nonstandard_track,
      canceled: !!a.status?.canceled,
      held: !!a.status?.held,
      otp: typeof a.status?.otp === 'number' ? a.status.otp : null,
      otpAt: a.status?.otp_location || null,
      peak: a.peak_code === 'P',
    }));
    const alerts = (j.alerts || []).map((a) => ({
      status: a.status,
      header: strip(a.header),
      text: strip(a.text),
      branches: a.branches || [],
      planned: !!a.is_planned,
    }));
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    res.status(200).json({ station, fetchedAt: Math.floor(Date.now() / 1000), trains, alerts });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
