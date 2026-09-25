// Google News angle: feed parsing, the verbatim-quote check, and the full step with fetch faked.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const FEED = `<?xml version="1.0"?><rss><channel><title>x</title>
<item><title>India Finally Has A Sunscreen Rulebook — Here’s What That Means For Your Skin - ELLE India</title>
<link>https://news.google.com/rss/articles/ABC?oc=5</link><pubDate>Mon, 14 Sep 2026 07:00:00 GMT</pubDate>
<description>&lt;a href="https://news.google.com/rss/articles/ABC"&gt;India Finally Has A Sunscreen Rulebook&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;ELLE India&lt;/font&gt;</description>
<source url="https://elle.in">ELLE India</source></item>
<item><title>Celebrity shares her 12-step glow routine - Some Mag</title><link>https://news.google.com/rss/articles/DEF</link>
<pubDate>Tue, 15 Sep 2026 07:00:00 GMT</pubDate><source url="https://x.com">Some Mag</source></item>
</channel></rss>`;

let news;
let claudeReply;
before(async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith('https://news.google.com/rss/search')) return new Response(FEED);
    if (u.includes('api.anthropic.com')) {
      return new Response(JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(claudeReply) }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  news = await import('../lib/news.js');
});

test('parseFeed splits the publication off the headline and dates the item', () => {
  const [first] = news.parseFeed(FEED);
  assert.equal(first.title, 'India Finally Has A Sunscreen Rulebook — Here’s What That Means For Your Skin');
  assert.equal(first.source, 'ELLE India');
  assert.equal(first.date, '2026-09-14');
  assert.equal(first.link, 'https://news.google.com/rss/articles/ABC?oc=5');
});

test('quoteIsInItem accepts exact quotes (curly quotes/dashes normalised) and rejects paraphrase', () => {
  const [item] = news.parseFeed(FEED);
  assert.ok(news.quoteIsInItem("India Finally Has A Sunscreen Rulebook - Here's", item));
  assert.ok(!news.quoteIsInItem('India has introduced strict new SPF testing laws', item));
  assert.ok(!news.quoteIsInItem('Sunscreen', item), 'too short to count as a fact');
});

test('findNewsAngle returns the linked item when the quote checks out', async () => {
  claudeReply = { pick: 1, fact_quote: 'India Finally Has A Sunscreen Rulebook', relevance: 'New rules on SPF labelling.' };
  const angle = await news.findNewsAngle({ core_idea: 'SPF labels overstate protection', category: 'Consumer Education', search_query: 'sunscreen SPF India' });
  assert.equal(angle.usable, true);
  assert.equal(angle.source, 'ELLE India');
  assert.equal(angle.date, '2026-09-14');
  assert.deepEqual(angle.sources.map((s) => s.uri), ['https://news.google.com/rss/articles/ABC?oc=5']);
});

test('findNewsAngle drops the angle when Claude paraphrases instead of quoting', async () => {
  claudeReply = { pick: 1, fact_quote: 'India now requires SPF to be tested in vivo', relevance: 'x' };
  const angle = await news.findNewsAngle({ core_idea: 'x', category: 'Consumer Education', search_query: 'sunscreen' });
  assert.equal(angle.usable, false);
  assert.equal(angle.reason, 'quote did not match the item');
});

test('findNewsAngle returns no angle when Claude picks nothing', async () => {
  claudeReply = { pick: 0, fact_quote: '', relevance: '' };
  const angle = await news.findNewsAngle({ core_idea: 'x', category: 'Consumer Education', search_query: 'sunscreen' });
  assert.equal(angle.usable, false);
});
