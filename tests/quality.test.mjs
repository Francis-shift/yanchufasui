// 画质分档：电脑电影档、手机流畅档，?q= 可强制；电影档的粒子、墨、阴影都比流畅档多。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickQuality, TIERS } from '../game/quality.js';

test('默认：电脑电影档、手机流畅档', () => {
  assert.equal(pickQuality('', false).name, 'cinema');
  assert.equal(pickQuality('?lab', true).name, 'smooth');
});

test('?q= 强制某一档；不认识的值不理', () => {
  assert.equal(pickQuality('?q=smooth', false).name, 'smooth');
  assert.equal(pickQuality('?lab=1&q=cinema', true).name, 'cinema');
  assert.equal(pickQuality('?q=ultra', true).name, 'smooth');
});

test('电影档比流畅档给得多，流畅档不开冲击模糊与前景层', () => {
  const c = TIERS.cinema, s = TIERS.smooth;
  assert.ok(c.particles > s.particles && c.ink > s.ink && c.shadowMap > s.shadowMap && c.inkK > s.inkK);
  assert.equal(s.grade.impact, 0);
  assert.equal(s.foreground, false);
  assert.ok(s.particles <= 4500, '手机粒子池不超过原来的 4500');
});
