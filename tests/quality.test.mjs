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

test('设置里选的档：没有 ?q= 时用它，认不出当自动；?q= 仍然优先', () => {
  assert.equal(pickQuality('', false, 'smooth').name, 'smooth');
  assert.equal(pickQuality('', true, 'cinema').name, 'cinema');
  assert.equal(pickQuality('', true, 'auto').name, 'smooth');
  assert.equal(pickQuality('', false, null).name, 'cinema');
  assert.equal(pickQuality('?q=cinema', true, 'smooth').name, 'cinema');
});

test('水洼平面反射只给电影档；?refl=0 关掉，别的不变', () => {
  assert.ok(pickQuality('', false).reflect > 0);
  assert.equal(pickQuality('', true).reflect, 0);
  const off = pickQuality('?refl=0', false);
  assert.equal(off.reflect, 0);
  assert.equal(off.name, 'cinema');
  assert.equal(off.particles, TIERS.cinema.particles);
  assert.equal(TIERS.cinema.reflect, 1024, '关掉的是副本，档位表本身不动');
});

test('电影档比流畅档给得多，流畅档不开冲击模糊与前景层', () => {
  const c = TIERS.cinema, s = TIERS.smooth;
  assert.ok(c.particles > s.particles && c.ink > s.ink && c.shadowMap > s.shadowMap && c.inkK > s.inkK);
  assert.equal(s.grade.impact, 0);
  assert.equal(s.foreground, false);
  assert.ok(s.particles <= 4500, '手机粒子池不超过原来的 4500');
});
