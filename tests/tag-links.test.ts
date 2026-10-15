import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagLinks } from '../lib/tag-links.ts';

const hrefs = (k: string, v: string) => tagLinks(k, v)?.map((l) => l.href) ?? null;

test('web links need an http(s) URL', () => {
  assert.deepEqual(hrefs('website', 'https://example.org/a'), ['https://example.org/a']);
  assert.deepEqual(hrefs('website', 'https://a.org;https://b.org'), ['https://a.org', 'https://b.org']);
  assert.deepEqual(hrefs('website', 'https://a.org/x?p=1;q=2'), ['https://a.org/x?p=1;q=2']);
  assert.equal(hrefs('website', 'javascript:alert(1)'), null);
  assert.equal(hrefs('website', 'example.org'), null);
});

test('wikipedia links from both tag forms', () => {
  assert.deepEqual(hrefs('wikipedia', 'en:Eiffel Tower'), ['https://en.wikipedia.org/wiki/Eiffel_Tower']);
  assert.deepEqual(hrefs('wikipedia:de', 'Kölner Dom'), ['https://de.wikipedia.org/wiki/K%C3%B6lner_Dom']);
  assert.deepEqual(hrefs('wikipedia', 'en:AC/DC'), ['https://en.wikipedia.org/wiki/AC/DC']);
  assert.deepEqual(hrefs('wikipedia', 'en:A?b#c'), ['https://en.wikipedia.org/wiki/A%3Fb%23c']);
  assert.equal(hrefs('wikipedia', 'Eiffel Tower'), null);
  assert.equal(hrefs('wikipedia', 'evil.com/x:y'), null);
  assert.equal(hrefs('wikipedia:evil.com/', 'x'), null);
});

test('wikidata and commons', () => {
  assert.deepEqual(hrefs('wikidata', 'Q243'), ['https://www.wikidata.org/wiki/Q243']);
  assert.deepEqual(hrefs('brand:wikidata', 'Q37158'), ['https://www.wikidata.org/wiki/Q37158']);
  assert.equal(hrefs('wikidata', 'Q12x'), null);
  assert.equal(hrefs('wikidata', 'P31'), null);
  assert.deepEqual(hrefs('wikimedia_commons', 'Category:Tour Eiffel'), ['https://commons.wikimedia.org/wiki/Category:Tour_Eiffel']);
  assert.equal(hrefs('wikimedia_commons', 'https://evil.com'), null);
});

test('phone and email', () => {
  assert.deepEqual(hrefs('phone', '+33 1 23 45 67 89'), ['tel:+33123456789']);
  assert.deepEqual(hrefs('contact:phone', '+44 20 1234 5678; +44 20 8765 4321'), ['tel:+442012345678', 'tel:+442087654321']);
  assert.deepEqual(tagLinks('phone', '+33 1 23')?.map((l) => l.text), ['+33 1 23']);
  assert.equal(hrefs('phone', 'ask inside'), null);
  assert.deepEqual(hrefs('email', 'info@example.org'), ['mailto:info@example.org']);
  assert.equal(hrefs('email', 'a@b.org?bcc=c@d.org'), null);
});

test('other tags are not linked', () => {
  assert.equal(tagLinks('name', 'https://example.org'), null);
});
