// @ts-check
/**
 * 游戏入口：搭场景、接输入、跑主循环。施法一条龙：
 *   开口就慢放 → 回车：关键词先猜元素给法阵上色 → 咏唱（同时请模型解析，最短 0.8 秒、超时 3.5 秒改用关键词）
 *   → 清洗意图 → 裁决（消耗、降级、伤害）→ 咒语卡 → 执行（飞弹 / 爆炸 / 命中结算）。
 * 规则全在 game/rules/（纯函数、有单测）；这里只负责把结果演出来。
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { damageTo, planCast, regenMana, resolveTarget } from './rules/arbiter.js';
import { defaultName, sanitizeIntent } from './rules/intent.js';
import { guessElement, parseKeywords } from './rules/keywords.js';
import {
  CHANT_MIN_MS, CORE_HP, FORMS, INPUT_MAX_CHARS, MANA_MAX, PARSE_TIMEOUT_MS, SLOWMO_MAX_SEC, SLOWMO_SCALE,
} from './rules/numbers.js';
import { Enemies } from './actors/enemies.js';
import { Particles } from './fx/particles.js';
import { SpellFx } from './fx/spells.js';
import { buildEnvironment } from './world/environment.js';
import { buildLayout, CASTER_POS, CORE_POS, groundHeightAt, OBJECTS } from './world/layout.js';
import { Hud } from './ui/hud.js';
import { parseRemote } from './net.js';

/** 中期：一波 6 个小傀儡，石阶和索桥轮流出 */
const WAVES = [{ list: ['grunt', 'grunt', 'grunt', 'grunt', 'grunt', 'grunt'], interval: 2.4 }];
const DEFAULT_AIM = new THREE.Vector3(0, 0.6, -6);

/**
 * @param {HTMLElement} root
 * @param {{ parseUrl?: string }} [opts]
 * @returns {() => void} 卸载
 */
export function start(root, opts = {}) {
  const mobile = window.matchMedia('(pointer: coarse)').matches;

  // ---------------------------------------------------------------- 渲染
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';   // 界面层要以它为定位基准
  root.append(renderer.domElement);
  renderer.domElement.style.display = 'block';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1500);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // 白天天空本身就接近 1，阈值必须高于它，否则整屏发白；只让亮度超过 1 的法术特效泛光
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), mobile ? 0.45 : 0.6, 0.45, 1.05);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const env = buildEnvironment(scene);
  const layout = buildLayout(scene);
  const particles = new Particles(scene, mobile ? 4500 : 9000);
  particles.floorAt = (x, z) => (groundHeightAt(x, z) ?? -60) + 0.03;
  const origin = CASTER_POS.clone().setY(1.5);
  const fx = new SpellFx(scene, particles, origin);

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
  const plaza = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Cylinder(11, 11, 1, 24), position: new CANNON.Vec3(0, -0.5, 0) });
  world.addBody(plaza);

  const hud = new Hud(root);
  const _v = new THREE.Vector3();
  const enemies = new Enemies(scene, world, particles, {
    onCoreHit: (dmg) => hitCore(dmg),
    onGone: () => {},
    floatText: (p, text, color) => {
      _v.copy(p).project(camera);
      if (_v.z > 1) return;
      const r = renderer.domElement.getBoundingClientRect();
      hud.floatText((_v.x * 0.5 + 0.5) * r.width, (-_v.y * 0.5 + 0.5) * r.height, text, color);
    },
  });

  // ---------------------------------------------------------------- 镜头：第三人称，平时固定；开口时轻推近到施法者肩后
  const cam = { base: new THREE.Vector3(), look: new THREE.Vector3(), near: new THREE.Vector3(), nearLook: new THREE.Vector3(), focus: 0 };
  function layoutCamera() {
    const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    const portrait = w / h < 0.8;
    camera.aspect = w / h;
    camera.fov = portrait ? 62 : 50;
    camera.updateProjectionMatrix();
    if (portrait) { cam.base.set(3.2, 12.5, 23); cam.look.set(0, 0, -5); }   // 竖屏：抬高拉远，敌人从屏幕上方往下走
    else { cam.base.set(5.6, 7.4, 16.8); cam.look.set(0, 1.0, -3.5); }
    cam.near.copy(CASTER_POS).add(new THREE.Vector3(1.6, 2.9, 4.6));
    cam.nearLook.set(0, 1.2, -6);
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    particles.resize(renderer.getDrawingBufferSize(new THREE.Vector2()).y, camera.fov);
  }
  layoutCamera();
  const onResize = () => layoutCamera();
  window.addEventListener('resize', onResize);

  // ---------------------------------------------------------------- 状态
  const S = {
    phase: 'title', mana: MANA_MAX, core: CORE_HP, gauge: 0,
    lastCombo: /** @type {{ key: string, streak: number } | null} */ (null), seen: /** @type {string[]} */ ([]),
    said: new Set(), wave: 0, queue: /** @type {string[]} */ ([]), spawnT: 0, spawned: 0, busy: false,
    last: /** @type {any} */ (null),
    endless: false,   // 检查页用：打空了也不判胜
  };
  /** 按游戏时间延后执行（慢放、顿帧时一起变慢） */
  const timers = [];
  const after = (sec, fn) => timers.push({ t: sec, fn });

  function hitCore(dmg) {
    if (S.phase !== 'playing') return;
    S.core = Math.max(0, S.core - dmg);
    hud.setCore(S.core, CORE_HP);
    fx.shake = Math.max(fx.shake, 0.35);
    layout.crystal.material.emissiveIntensity = 3;
    if (S.core <= 0) {
      S.phase = 'lost';
      hud.showOverlay('阵眼破碎', '傀儡冲破了护山大阵。换个说法再来一次？', '重新守关');
    }
  }

  function startGame() {
    enemies.clear();
    Object.assign(S, { phase: 'playing', mana: MANA_MAX, core: CORE_HP, gauge: 0, lastCombo: null, seen: [], said: new Set(),
      wave: 0, busy: false });
    startWave(0);
    hud.setCore(S.core, CORE_HP);
    hud.hideOverlay();
    hud.input.focus();
  }

  function startWave(i) {
    S.wave = i;
    S.queue = [...WAVES[i].list];
    S.spawnT = 1.2; S.spawned = 0;
    hud.bigText(`第 ${i + 1} 波`, '#16202b', 1200);
  }

  function updateWave(dt) {
    if (S.phase !== 'playing') return;
    S.spawnT -= dt;
    if (S.queue.length && S.spawnT <= 0) {
      enemies.spawn(/** @type {any} */ (S.queue.shift()), S.spawned++ % 2);
      S.spawnT = WAVES[S.wave].interval;
    }
    const left = S.queue.length + enemies.alive;
    hud.setWave(`第 ${S.wave + 1} / ${WAVES.length} 波`, `剩 ${left}`);
    if (!S.queue.length && !enemies.alive && !S.endless) {
      if (S.wave + 1 < WAVES.length) { S.phase = 'rest'; after(4, () => { S.phase = 'playing'; startWave(S.wave + 1); }); }
      else { S.phase = 'won'; hud.showOverlay('守住了', `阵眼还剩 ${Math.ceil(S.core)} 点。下一版会有更多波次和 Boss 巨像。`, '再守一次'); }
    }
  }

  // ---------------------------------------------------------------- 输入与慢放
  const input = hud.input;
  let slowSince = 0, slowSpent = false;
  const onInput = () => {
    if (input.value.trim() && !slowSince && !slowSpent) slowSince = performance.now();
    fx.setListening(!!input.value.trim());
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const t = input.value; input.value = ''; onInput(); submit(t); }
    else if (e.key === 'Escape') input.blur();
  };
  const onGlobalKey = (e) => {
    if (e.key === '`') { hud.debug.hidden = !hud.debug.hidden; return; }
    if (document.activeElement !== input && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && S.phase === 'playing') input.focus();
  };
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onGlobalKey);
  const startBtn = /** @type {HTMLButtonElement} */ (hud.overlay.querySelector('button'));
  startBtn.addEventListener('click', startGame);

  // ---------------------------------------------------------------- 施法
  /** @param {string} text */
  async function submit(text) {
    text = [...text.trim()].slice(0, INPUT_MAX_CHARS).join('');
    if (!text || S.busy || S.phase !== 'playing') return;
    S.busy = true;
    slowSince = 0; slowSpent = false;
    const t0 = performance.now();
    fx.beginChant(guessElement(text) || 'arcane');          // 回车 0.1 秒内先给反应
    const kwRaw = parseKeywords(text);
    const remoteP = parseRemote(opts.parseUrl, text, PARSE_TIMEOUT_MS);
    await new Promise((r) => setTimeout(r, CHANT_MIN_MS));
    const remote = await remoteP;
    let raw, source, ms = Math.round(performance.now() - t0);
    if ('raw' in remote) { raw = remote.raw; source = '模型解析'; ms = remote.ms; }
    else {
      raw = kwRaw;
      source = remote.fail === 'timeout' ? '简易解析（超时）' : remote.fail === 'offline' ? '关键词解析（离线）'
        : remote.fail === 'rate' || remote.fail === 'daily' ? '关键词解析（额度已满）' : '关键词解析';
    }
    let intent = sanitizeIntent(raw, text);
    if (!intent.steps.length && 'raw' in remote) {
      const k = sanitizeIntent(kwRaw, text);
      if (k.steps.length) { intent = { ...k, unknown: intent.unknown, overreach: intent.overreach || k.overreach }; source += '＋关键词'; }
    }
    if (S.phase !== 'playing') { fx.endChant(); S.busy = false; return; }
    if (intent.steps[0]) fx.retint(intent.steps[0].el);
    const plan = planCast(intent, { mana: S.mana, lastCombo: S.lastCombo, seen: S.seen, said: S.said, text });
    S.mana -= plan.cost;
    S.gauge += plan.gaugeGain;
    S.lastCombo = plan.lastCombo;
    S.seen.push(...plan.newlySeen);
    if (plan.saidKey) S.said.add(plan.saidKey);
    S.last = { text, source, ms, raw, plan };
    const name = intent.name || (plan.ok ? defaultName(plan.steps) : '');
    hud.showCard({ name, text, plan, intent, source, ms });
    if (plan.backlash) { fx.backlash(); hud.bigText('天道不允', '#b3261e', 1300); }
    fx.endChant();
    if (!plan.ok) {
      if (!plan.backlash) hud.bigText(intent.steps.length ? '法力不足' : '未能成咒', '#5d6b7a', 1000);
      S.busy = false;
      return;
    }
    fx.launchBurst(plan.steps[0].el);
    plan.steps.forEach((step, i) => after(i * 0.45, () => runStep(step)));
    if (plan.momentum >= 3) hud.bigText('气势如虹', '#16202b', 900);
    S.busy = false;
  }

  /** @param {import('./rules/arbiter.js').PlannedStep} step */
  function runStep(step) {
    if (S.phase !== 'playing') return;
    const res = resolveTarget(step.target, enemies.views(), { count: step.count, caster: CASTER_POS, objects: OBJECTS });
    const groundPt = (pt) => new THREE.Vector3(pt.x, (groundHeightAt(pt.x, pt.z) ?? 0) + 0.4, pt.z);
    const dir = { fromAbove: step.path === 'sky', fromBehind: step.path === 'behind' };
    if (step.form === 'bolt') {
      for (let i = 0; i < step.count; i++) {
        const id = res.ids.length ? res.ids[i % res.ids.length] : null;
        let last = res.point ? groundPt(res.point) : DEFAULT_AIM.clone();
        fx.bolt({
          el: step.el, path: step.path, delay: i * 0.14,
          target: () => { const e = id && enemies.get(id); if (e) enemies.aimPoint(e, last); return last; },
          onHit: (p) => {
            fx.burst(p, step.el, 1.3, 0.45);
            const e = id && enemies.get(id);
            if (e) hitEnemy(e, step, step.dmgEach, CASTER_POS, dir);
          },
        });
      }
    } else {
      const pt = res.point ? groundPt(res.point) : DEFAULT_AIM.clone();
      const R = FORMS.burst.radius;
      fx.bolt({
        el: step.el, path: 'straight', big: true, target: () => pt,
        onHit: (p) => {
          fx.burst(p, step.el, R, 1);
          for (const e of [...enemies.list]) {
            if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= R) hitEnemy(e, step, step.dmgEach, p, {});
          }
        },
      });
    }
  }

  function hitEnemy(e, step, dmg, from, dir) {
    const r = damageTo({ type: e.type, frozen: e.frozen > 0 }, { el: step.el, dmg, ...dir });
    const at = e.pos.clone();
    enemies.applyHit(e, r, from, step.el);
    if (r.aoeBonus) {
      // 蒸汽爆：冻住的目标被火打中，炸开一圈额外伤害
      fx.burst(at.clone().setY(at.y + 0.6), 'fire', 2.5, 0.7);
      for (const o of [...enemies.list]) {
        if (o !== e && Math.hypot(o.pos.x - at.x, o.pos.z - at.z) <= 3) enemies.applyHit(o, { dmg: r.aoeBonus, freezeSec: 0, burnSec: 0, unfreeze: true, push: 0, reaction: '蒸汽爆' }, at, 'fire');
      }
    }
  }

  // ---------------------------------------------------------------- 压力测试：从广场上空撒物理方块，到时收走
  // 方块合成一个批次画（一次绘制），这样测到的是物理的负担，不是绘制次数
  const STRESS_MAX = 400;
  const stressGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const stressMat = new THREE.MeshStandardMaterial({ color: 0x9a8f80, roughness: 0.9 });
  const stressMesh = new THREE.InstancedMesh(stressGeo, stressMat, STRESS_MAX);
  stressMesh.castShadow = true;
  stressMesh.frustumCulled = false;
  stressMesh.count = 0;
  scene.add(stressMesh);
  const stressShape = new CANNON.Box(new CANNON.Vec3(0.15, 0.15, 0.15));
  /** @type {{ body: CANNON.Body, t: number }[]} */
  const stressList = [];
  const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _p4 = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  function dropCubes(n, life) {
    for (let i = 0; i < n && stressList.length < STRESS_MAX; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 8;
      const body = new CANNON.Body({ mass: 1, shape: stressShape, position: new CANNON.Vec3(Math.cos(a) * r, 3 + Math.random() * 6, Math.sin(a) * r - 2) });
      body.angularVelocity.set(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2);
      world.addBody(body);
      stressList.push({ body, t: life });
    }
  }
  function updateCubes(dt) {
    if (!stressList.length && !stressMesh.count) return;
    for (let i = stressList.length - 1; i >= 0; i--) {
      const c = stressList[i];
      c.t -= dt;
      if (c.t <= 0 || c.body.position.y < -20) { world.removeBody(c.body); stressList.splice(i, 1); }
    }
    stressList.forEach((c, i) => {
      const p = c.body.position, q = c.body.quaternion;
      stressMesh.setMatrixAt(i, _m4.compose(_p4.set(p.x, p.y, p.z), _q4.set(q.x, q.y, q.z, q.w), _one));
    });
    stressMesh.count = stressList.length;
    stressMesh.instanceMatrix.needsUpdate = true;
  }
  renderer.info.autoReset = false;   // 后期处理一帧要画好几遍，手动清零才能数出整帧的绘制次数

  // ---------------------------------------------------------------- 主循环
  let raf = 0, lastNow = performance.now(), timeScale = 1, fpsAcc = 0, fpsN = 0, fps = 0, dbgT = 0, idleT = 0;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), shakeOff = new THREE.Vector3();
  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const realDt = Math.min((now - lastNow) / 1000, 1 / 30);
    lastNow = now;
    // 开口就慢放：输入中（单次最多 8 秒）与咏唱中都是 0.3 倍
    if (slowSince && now - slowSince > SLOWMO_MAX_SEC * 1000) { slowSince = 0; slowSpent = true; }
    const slow = (slowSince > 0 || fx.chanting > 0) && S.phase === 'playing';
    timeScale += ((slow ? SLOWMO_SCALE : 1) - timeScale) * Math.min(1, realDt * 10);
    let dt = realDt * timeScale;
    if (fx.hitStop > 0) { fx.hitStop -= realDt; dt *= 0.06; }
    idleT += dt;

    for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { const t = timers.splice(i, 1)[0]; t.fn(); } }
    if (S.phase === 'playing' || S.phase === 'rest') {
      S.mana = regenMana(S.mana, dt);
      updateWave(dt);
    }
    world.step(1 / 60, dt, 3);
    updateCubes(dt);
    enemies.update(dt, camera);
    fx.update(dt);
    const live = particles.update(dt);
    env.clouds.uniforms.uTime.value += dt;
    layout.coreSigil.rotation.z += dt * 0.2;
    layout.crystal.rotation.y += dt * 0.8;
    layout.crystal.position.y = 1.7 + Math.sin(idleT * 1.6) * 0.12;
    const cm = layout.crystal.material;
    cm.emissiveIntensity += (0.8 - cm.emissiveIntensity) * Math.min(1, dt * 3);
    hud.setMana(S.mana, MANA_MAX);

    // 镜头：咏唱时推近，动完回到固定位置
    const focusT = fx.chanting > 0 || (slowSince > 0 && S.phase === 'playing') ? 0.35 : 0;
    cam.focus += (focusT - cam.focus) * Math.min(1, realDt * 3);
    camPos.copy(cam.base).lerp(cam.near, cam.focus);
    camLook.copy(cam.look).lerp(cam.nearLook, cam.focus);
    shakeOff.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(fx.shake * 0.5);
    camera.position.copy(camPos).add(shakeOff);
    camera.lookAt(camLook);
    renderer.info.reset();
    composer.render();

    fpsAcc += realDt; fpsN++;
    if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    dbgT += realDt;
    if (!hud.debug.hidden && dbgT > 0.25) {
      dbgT = 0;
      const l = S.last;
      hud.debug.textContent = [`帧率 ${fps}`, `粒子 ${live}`, `敌人 ${enemies.alive}`, `法力 ${Math.floor(S.mana)}  气势槽 ${S.gauge}`,
        `时间 ×${timeScale.toFixed(2)}`, l ? `上一句：${l.source} ${l.ms} 毫秒` : '', l ? `意图：${JSON.stringify(l.raw).slice(0, 80)}` : ''].join('\n');
    }
  }
  frame();

  // ---------------------------------------------------------------- 调试接口（面板里用：地址参数不可用）
  const demo = {
    start: () => startGame(),
    cast: (text) => submit(text),
    spawn: (/** @type {any} */ type = 'grunt', path = 0) => enemies.spawn(type, path),
    state: () => ({ phase: S.phase, mana: Math.round(S.mana), core: S.core, gauge: S.gauge, enemies: enemies.views(), last: S.last && { source: S.last.source, ms: S.last.ms, plan: S.last.plan } }),
    view: (px, py, pz, tx, ty, tz) => { cam.base.set(px, py, pz); cam.look.set(tx, ty, tz); },
    debug: (on = true) => { hud.debug.hidden = !on; },
    pause: (on = true) => { if (on) cancelAnimationFrame(raf); else { lastNow = performance.now(); frame(); } },
    // 以下给检查页用
    refill: () => { S.mana = MANA_MAX; S.core = CORE_HP; hud.setCore(S.core, CORE_HP); },
    endless: (on = true) => { S.endless = on; },
    cubes: (n = 300, life = 12) => dropCubes(n, life),
    gl: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, ratio: renderer.getPixelRatio(),
      size: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(), cubes: stressList.length, mobile }),
  };
  /** @type {any} */ (window).demo = demo;

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onGlobalKey);
    enemies.clear();
    for (const c of stressList) world.removeBody(c.body);
    scene.remove(stressMesh); stressMesh.dispose(); stressGeo.dispose(); stressMat.dispose();
    hud.dispose();
    composer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    if (/** @type {any} */ (window).demo === demo) delete /** @type {any} */ (window).demo;
  };
}
