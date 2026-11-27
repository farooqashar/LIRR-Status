// Tests for the arrivals proxy, run through the handler with a stubbed fetch.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/arrivals.js';

const realFetch = globalThis.fetch;
const realConsoleError = console.error;
let calls;

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realConsoleError;
});

const stubFetch = (impl) => {
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return impl(url, opts);
  };
};

const respond = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const fakeRes = () => {
  const res = { headers: {}, statusCode: null, body: undefined };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
    return res;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

const run = async (query = {}) => {
  const res = fakeRes();
  await handler({ query }, res);
  return res;
};

const assertError = (res, status, error) => {
  assert.equal(res.statusCode, status);
  assert.deepEqual(res.body, { error });
  assert.equal(res.headers['Cache-Control'], 's-maxage=5');
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
};

test('rejects a bad station code without calling upstream', async () => {
  stubFetch(() => respond({}));
  const res = await run({ station: '../x' });
  assertError(res, 400, 'bad station code');
  assert.equal(calls.length, 0);
});

test('defaults to HUN and sends Accept-Version 3.0', async () => {
  stubFetch(() => respond({}));
  const res = await run();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://backend-unified.mylirr.org/arrivals/HUN');
  assert.equal(calls[0].opts.headers['Accept-Version'], '3.0');
  assert.equal(res.body.station, 'HUN');
});

test('upper-cases the station code', async () => {
  stubFetch(() => respond({}));
  const res = await run({ station: 'hun' });
  assert.equal(calls[0].url, 'https://backend-unified.mylirr.org/arrivals/HUN');
  assert.equal(res.body.station, 'HUN');
});

test('upstream error status becomes 502', async () => {
  stubFetch(() => respond({}, 500));
  const res = await run({ station: 'NYK' });
  assertError(res, 502, 'upstream 500');
});

test('upstream timeout becomes 504', async () => {
  console.error = () => {};
  stubFetch(() => {
    throw new DOMException('timed out', 'TimeoutError');
  });
  const res = await run({ station: 'NYK' });
  assertError(res, 504, 'upstream timeout');
});

test('other fetch failures become 502', async () => {
  console.error = () => {};
  stubFetch(() => {
    throw new TypeError('fetch failed');
  });
  const res = await run({ station: 'NYK' });
  assertError(res, 502, 'upstream error');
});

test('trims trains to the documented fields', async () => {
  stubFetch(() =>
    respond({
      arrivals: [
        {
          train_id: 'T1',
          train_num: '1234',
          time: 1700000000,
          direction: 'W',
          branch: 'PJ',
          stops: ['HUN', 'NYK'],
          track: '2',
          sched_track: '1',
          track_change: true,
          nonstandard_track: 1,
          status: { canceled: false, held: true, otp: -120, otp_location: 'SYT' },
          peak_code: 'P',
          extra: 'dropped',
        },
        { train_id: 'T2', status: { otp: '-60' }, peak_code: 'O' },
      ],
    })
  );
  const before = Date.now() / 1000;
  const res = await run({ station: 'HUN' });
  const after = Date.now() / 1000;
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 's-maxage=15, stale-while-revalidate=30');
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  assert.ok(Number.isInteger(res.body.fetchedAt));
  assert.ok(res.body.fetchedAt >= Math.floor(before) && res.body.fetchedAt <= after);
  assert.deepEqual(res.body.alerts, []);
  assert.deepEqual(res.body.trains, [
    {
      id: 'T1',
      num: '1234',
      time: 1700000000,
      dir: 'W',
      branch: 'PJ',
      stops: ['HUN', 'NYK'],
      track: '2',
      schedTrack: '1',
      trackChange: true,
      nonstandard: true,
      canceled: false,
      held: true,
      otp: -120,
      otpAt: 'SYT',
      peak: true,
    },
    {
      id: 'T2',
      num: undefined,
      time: undefined,
      dir: undefined,
      branch: undefined,
      stops: [],
      track: null,
      schedTrack: null,
      trackChange: false,
      nonstandard: false,
      canceled: false,
      held: false,
      otp: null,
      otpAt: null,
      peak: false,
    },
  ]);
});

const alertText = async (text, header = '') => {
  stubFetch(() => respond({ alerts: [{ status: 'x', header, text, branches: ['PJ'], is_planned: 1 }] }));
  const res = await run({ station: 'HUN' });
  return res.body.alerts[0];
};

test('alert shape', async () => {
  const alert = await alertText('<p>Hi</p>', '<b>Head</b>');
  assert.deepEqual(alert, { status: 'x', header: 'Head', text: 'Hi', branches: ['PJ'], planned: true });
});

test('alert text turns <br> and </p> into line breaks and drops tags', async () => {
  const { text } = await alertText('<p>One</p><p>Two<br>Three<br/>Four</p><span>Five</span>');
  assert.equal(text, 'One\nTwo\nThree\nFour\nFive');
});

test('alert text decodes named and numeric entities', async () => {
  const { text } = await alertText('A &amp; B&nbsp;C &ndash; D&#8217;s E&#x2019;s');
  assert.equal(text, 'A & B C – D’s E’s');
});

test('alert text decodes &amp;#39; only once', async () => {
  const { text } = await alertText('it&amp;#39;s');
  assert.equal(text, 'it&#39;s');
});

test('alert text leaves unknown entities as is', async () => {
  const { text } = await alertText('a &foo; b');
  assert.equal(text, 'a &foo; b');
});
