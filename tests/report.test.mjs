// 战报卡：念成的咒怎么挑、怎么排（ui/report.js），卡上的二维码（ui/qr.js）。画卡要浏览器的画布，在预览页里看。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, topNames, wrapNames } from '../game/ui/report.js';
import { formatBits, qrMatrix, rsEcc } from '../game/ui/qr.js';

test('战报卡：同名的咒合在一起，按伤害从高到低取前几个，没打出伤害的不算', () => {
  const t = [{ name: '冰墙', dmg: 0 }, { name: '火雨', dmg: 30 }, { name: '雷龙', dmg: 50 }, { name: '火雨', dmg: 40 }, { name: '', dmg: 99 }, { name: '风刃', dmg: -3 }];
  assert.deepEqual(topNames(t), ['火雨', '雷龙']);
  assert.deepEqual(topNames(t, 1), ['火雨']);
  assert.deepEqual(topNames([]), []);
});

test('战报卡：名字一排排摆，超宽换排，最多几排，一个就超宽的跳过', () => {
  const w = (/** @type {string} */ s) => s.length * 10;
  assert.deepEqual(wrapNames(['aa', 'bbb', 'cc'], w, 60, 10, 2), [['aa', 'bbb'], ['cc']]);
  assert.deepEqual(wrapNames(['aaaa', 'bbbb', 'cccc', 'dddd'], w, 50, 10, 2), [['aaaa'], ['bbbb']]);
  assert.deepEqual(wrapNames(['aa', 'x'.repeat(9), 'bb'], w, 60, 10, 1), [['aa', 'bb']]);
  assert.deepEqual(wrapNames([], w, 60, 10, 2), []);
});

test('二维码：里德-所罗门纠错码和标准里的样例一致（1-M）', () => {
  // ISO/IEC 18004 附录的 "01234567"（数字模式）
  assert.deepEqual(rsEcc([16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17], 10),
    [165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
  // 常见教程里的 "HELLO WORLD"（字母数字模式）
  assert.deepEqual(rsEcc([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10),
    [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('二维码：格式信息（M 级）和标准里的表一致', () => {
  const s = (/** @type {number} */ m) => formatBits(m).toString(2).padStart(15, '0');
  assert.equal(s(0), '101010000010010');
  assert.equal(s(4), '100010111111001');
  assert.equal(s(7), '100101010100000');
});

/** 从矩阵里读回两份格式信息 @param {boolean[][]} m */
function readFormat(m) {
  const n = m.length, at = (/** @type {number} */ x, /** @type {number} */ y) => (m[y][x] ? 1 : 0);
  let a = 0, b = 0;
  const bitA = (/** @type {number} */ i) => {
    if (i <= 5) return at(8, i);
    if (i === 6) return at(8, 7);
    if (i === 7) return at(8, 8);
    if (i === 8) return at(7, 8);
    return at(14 - i, 8);
  };
  for (let i = 0; i < 15; i++) {
    a |= bitA(i) << i;
    b |= (i < 8 ? at(n - 1 - i, 8) : at(8, n - 15 + i)) << i;
  }
  return [a, b];
}

test('二维码：网址装进版本 3；三个定位图形、时序线、固定深色模块都在，两份格式信息一致且是合法的 M 级', () => {
  const m = qrMatrix(SITE), n = m.length;
  assert.equal(n, 29);
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        assert.equal(m[oy + y][ox + x], d !== 2, `定位图形 (${ox}, ${oy}) 的 (${x}, ${y})`);
      }
    }
  }
  for (let i = 8; i < n - 8; i++) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); }
  assert.equal(m[n - 8][8], true);
  const [a, b] = readFormat(m);
  assert.equal(a, b);
  assert.ok([0, 1, 2, 3, 4, 5, 6, 7].some((k) => formatBits(k) === a), '格式信息不是 M 级的八种之一');
});

test('二维码：越长版本越大，最多 62 个字节，再长就报错', () => {
  assert.equal(qrMatrix('A').length, 21);
  assert.equal(qrMatrix('x'.repeat(62)).length, 33);
  assert.equal(qrMatrix('言出法随').length, 21);   // 中文按 UTF-8 字节算，12 个字节
  assert.throws(() => qrMatrix('x'.repeat(63)));
});
