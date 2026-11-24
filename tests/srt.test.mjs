import assert from 'node:assert/strict';
import { parseSrt, formatSrt } from '../src/captions/srt.ts';

const basic = parseSrt(`1
00:00:00,500 --> 00:00:02,000
First line

2
00:00:03,000 --> 00:00:05,500
Second line
`);
assert.equal(basic.length, 2);
assert.equal(basic[0].start, 0.5);
assert.equal(basic[0].end, 2);
assert.equal(basic[1].text, 'Second line');

const messy = parseSrt(`\uFEFF1\r\n00:00:01.25 --> 00:00:03.75\r\n<i>Hello</i>\r\nworld\r\n\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\n{\\an8}Top\r\n`);
assert.equal(messy.length, 2);
assert.equal(messy[0].start, 1.25);
assert.equal(messy[0].end, 3.75);
assert.equal(messy[0].text, 'Hello\nworld');
assert.equal(messy[1].text, 'Top');

const noIndices = parseSrt(`00:01:00,000 --> 00:01:02,000
Only timing
`);
assert.equal(noIndices.length, 1);
assert.equal(noIndices[0].start, 60);

const round = parseSrt(formatSrt(basic));
assert.deepEqual(round.map((c) => [c.start, c.end, c.text]), basic.map((c) => [c.start, c.end, c.text]));
assert.equal(parseSrt('not a subtitle').length, 0);

console.log('SRT parser: all assertions passed');
