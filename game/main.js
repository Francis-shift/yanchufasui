// @ts-check
/**
 * 游戏入口：搭场景、接输入、跑主循环。施法一条龙：
 *   开口就慢放 → 回车：关键词先猜元素给法阵上色 → 咏唱（同时请模型解析，最短 0.8 秒、超时 4.5 秒改用关键词）
 *   → 清洗意图 → 裁决（消耗、降级、伤害）→ 咒语卡 → 执行（飞弹 / 爆炸 / 命中结算）。
 * 规则全在 game/rules/（纯函数、有单测）；这里只负责把结果演出来。
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { chainTargets, damageTo, planCast, regenMana, resolveTarget } from './rules/arbiter.js';
import { defaultName, sanitizeIntent } from './rules/intent.js';
import { guessElement, parseKeywords } from './rules/keywords.js';
import { maskText } from './rules/safety.js';
import {
  bindSpell, buttonGaugeGain, combineButtons, defaultIntent, elName, scrollsFor, synergies, talentOpen, toggleTalent,
} from './rules/talents.js';
import {
  BEAM, BUTTON_CHANT_MS, CHANT_MIN_MS, CORE_HP, FORMS, INPUT_MAX_CHARS, MANA_MAX, MOMENTUM_FX, MOMENTUM_RANGE, PARSE_TIMEOUT_MS, RAIN,
  SLOWMO_MAX_SEC, SLOWMO_SCALE, TALENTS, TORNADO, ULT_GAUGE, WALL,
} from './rules/numbers.js';
import { Enemies } from './actors/enemies.js';
import { DragonFx } from './fx/dragon.js';
import { Locks } from './fx/locks.js';
import { distToSegment, Walls } from './fx/walls.js';
import { FusionFx } from './fx/fusions.js';
import { GradePass } from './fx/grade.js';
import { Particles } from './fx/particles.js';
import { SpellFx } from './fx/spells.js';
import { buildEnvironment } from './world/environment.js';
import { invasionTarget, stepInvasion } from './world/invasion.js';
import { fitFrame } from './world/framing.js';
import { loadProps } from './world/props.js';
import { buildLayout, CASTER_POS, CORE_POS, groundHeightAt, OBJECTS } from './world/layout.js';
import { Hud, preloadFonts } from './ui/hud.js';
import { inspireRemote, parseRemote, warmUp } from './net.js';
import { pickQuality } from './quality.js';
import { mountLab } from './ui/lab.js';

/**
 * 5 波（设计文档第 4 节）。每波一道题：开场提示就是这一波的解法方向。
 * 敌人按顺序出场，石阶和索桥轮流走；巨像太宽，只走石阶。
 */
const WAVES = [
  { mix: { grunt: 6 }, interval: 2.2, tip: '小傀儡成群上山——风能把它们吹下悬崖' },
  { mix: { grunt: 8, shield: 2 }, interval: 2.0, tip: '盾傀儡正面挡八成——试试「从天而降」或「绕到背后」' },
  { mix: { grunt: 10, shield: 4 }, interval: 1.7, tip: '人多了——一句话说两三步，组合打八折' },
  { mix: { grunt: 6, shield: 3, colossus: 1 }, interval: 2.0, tip: '巨像来了——先冻住，再用火，蒸汽爆' },
  { mix: { grunt: 12, shield: 4, colossus: 2 }, interval: 1.5, tip: '最后一波，守住阵眼' },
];
const REST_SEC = 15;

/** 把一波的配比排成出场顺序：盾傀儡均匀插在小傀儡中间，巨像压在后半段 */
function waveQueue(mix) {
  const q = Array(mix.grunt || 0).fill('grunt');
  const insert = (type, n, from) => {
    for (let k = 0; k < n; k++) q.splice(Math.round(from * q.length + ((k + 1) / (n + 1)) * (1 - from) * q.length), 0, type);
  };
  insert('shield', mix.shield || 0, 0.2);
  insert('colossus', mix.colossus || 0, 0.5);
  return q;
}
const DEFAULT_AIM = new THREE.Vector3(0, 0.6, -6);

/**
 * 竖屏取景（framing.js）：镜头在右前方高处（俯角约 43°）往左后方看，石阶（正后方）和索桥（左后方）都落在画面上半；
 * 平时要框进施法者、石阶上段、索桥中段和广场两侧；开口推近时只保证施法者和两个入口。
 * 俯角试过约 30°：画面上三分之一全是天空，广场太小。
 */
const NARROW_DIR = new THREE.Vector3(0.36, 1.0, 1);
const NARROW_LOOK = new THREE.Vector3(-2, 0, -2);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FRAME_WIDE = [V(0, 2.2, 5.2), V(0, 0, 6.8), V(0, 0, -10.4), V(0, -3.5, -15), V(-9.2, 0, -5.4), V(-14, 0, -8.3), V(7, 0, -3), V(-8, 0, 2)];
const FRAME_NEAR = [V(0, 2.2, 5.2), V(0, 0, 6.4), V(0, 0, -10.4), V(-9.2, 0, -5.4)];
/** 解析失败的原因，显示在咒语卡上（方便现场判断是哪一段出了问题） */
const FAIL_TEXT = {
  timeout: '超时', model_error: '模型出错', network: '网络不通', no_key: '服务器未配置密钥', rate: '说得太快', daily: '今日额度已满',
  too_long: '太长', empty: '空', bad_request: '请求有误', warm_failed: '预热失败',
};

/**
 * @param {HTMLElement} root
 * @param {{ parseUrl?: string | string[], lab?: boolean, dragon?: { mesh?: string, tex?: string | null }, models?: string }} [opts] lab：直接进特效试验场； parseUrl：解析接口，给一串就按顺序当后备（见 net.js）；dragon：冰龙模型与贴图的地址；models：场景物件模型的目录（不给就一直用方块占位）
 * @returns {() => void} 卸载
 */
export function start(root, opts = {}) {
  const mobile = window.matchMedia('(pointer: coarse)').matches;
  const quality = pickQuality(location.search, mobile);   // 电脑电影档、手机流畅档（?q= 可强制）

  // ---------------------------------------------------------------- 渲染
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
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
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), quality.bloom.strength, quality.bloom.radius, quality.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // 调色放在色调映射之后：对比、饱和、冷暖分离、暗角、颗粒，命中时径向模糊（fx/grade.js）
  const grade = new GradePass(quality.grade);
  composer.addPass(grade);

  const env = buildEnvironment(scene, renderer);
  env.setShadowMap(quality.shadowMap);
  const layout = buildLayout(scene);
  if (opts.models) loadProps(scene, layout, quality.name, opts.models, renderer);   // 牌坊、石兽、镇山石的模型，到了替换方块占位
  const particles = new Particles(scene, quality.particles);
  particles.floorAt = (x, z) => (groundHeightAt(x, z) ?? -60) + 0.03;
  const ink = new Particles(scene, quality.ink, { ink: true });   // 墨点、墨烟（特效风格 v2）
  ink.floorAt = particles.floorAt;
  const origin = CASTER_POS.clone().setY(1.5);
  const fx = new SpellFx(scene, particles, origin, { ink, quality });
  const locks = new Locks(scene);

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
  const plaza = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Cylinder(11, 11, 1, 24), position: new CANNON.Vec3(0, -0.5, 0) });
  world.addBody(plaza);

  const walls = new Walls(scene, world, particles);
  const fusions = new FusionFx(fx, particles);
  const dragon = new DragonFx(fx, particles, opts.dragon);
  const hud = new Hud(root);
  preloadFonts();   // 标题画面期间先下书法字的常用那份
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

  // ---------------------------------------------------------------- 镜头：第三人称，平时固定；开口时轻推近
  const cam = { base: new THREE.Vector3(), look: new THREE.Vector3(), near: new THREE.Vector3(), nearLook: new THREE.Vector3(), focus: 0 };
  function layoutCamera() {
    const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 62 : 50;
    camera.updateProjectionMatrix();
    hud.setLayout(w, h);
    if (w / h < 1.2) {
      // 竖屏、键盘弹起：界面占掉上下一大截，按没被挡住的那一条自动取景；开口时推近也要看得见两个入口
      const ins = hud.insets();
      const f = fitFrame(camera, { dir: NARROW_DIR, look: NARROW_LOOK, points: FRAME_WIDE, ...ins });
      cam.base.copy(f.pos); cam.look.copy(f.look);
      const n = fitFrame(camera, { dir: NARROW_DIR, look: NARROW_LOOK, points: FRAME_NEAR, ...ins });
      cam.near.copy(n.pos); cam.nearLook.copy(n.look);
    } else {
      cam.base.set(5.6, 7.4, 16.8); cam.look.set(0, 1.0, -3.5);
      cam.near.copy(CASTER_POS).add(new THREE.Vector3(1.6, 2.9, 4.6));   // 横屏开口时推到施法者肩后
      cam.nearLook.set(0, 1.2, -6);
    }
    env.aim(_v.copy(cam.look).sub(cam.base));   // 雾取镜头朝向那段天边的颜色
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    const hpx = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    particles.resize(hpx, camera.fov);
    ink.resize(hpx, camera.fov);
  }
  layoutCamera();
  // iOS 的 Safari 弹出键盘时页面本身不变矮，只是下半截被盖住：把游戏区域缩到看得见的那块（微信、安卓会自己变矮，不受影响）
  const vv = window.visualViewport;
  let vvCovered = false;
  const onResize = () => {
    if (vv) {
      const covered = vv.height < window.innerHeight - 60 && Math.abs(vv.scale - 1) < 0.01;   // 双指放大时也会变小，那不算
      if (covered) {
        root.style.height = `${Math.round(vv.height)}px`;
        root.style.transform = `translateY(${Math.round(vv.offsetTop)}px)`;
      } else if (vvCovered) {
        root.style.height = ''; root.style.transform = '';
      }
      vvCovered = covered;
    }
    layoutCamera();
  };
  window.addEventListener('resize', onResize);
  vv?.addEventListener('resize', onResize);
  vv?.addEventListener('scroll', onResize);

  // ---------------------------------------------------------------- 状态
  const S = {
    phase: 'title', mana: MANA_MAX, core: CORE_HP, gauge: 0,
    lastCombo: /** @type {{ key: string, streak: number } | null} */ (null), seen: /** @type {string[]} */ ([]),
    said: new Set(), wave: 0, queue: /** @type {string[]} */ ([]), spawnT: 0, spawned: 0, busy: false,
    last: /** @type {any} */ (null),
    endless: false,   // 检查页用：打空了也不判胜
    restT: 0,         // 波与波之间的休息倒计时（游戏时间）
    inv: 0,           // 入侵程度（画面用，见 world/invasion.js）：0 目标图的傍晚，1 全暗
    /** 选的天赋（开局界面上选，默认火冰风：三者之间有两种融合、两种反应） */
    talents: /** @type {string[]} */ (['fire', 'ice', 'wind']),
    /** 给按钮写过的咒：天赋 → 这句话清洗后的意图、名字、原话（重开一局还在，换掉的天赋就丢掉） */
    binds: /** @type {Record<string, { intent: import('./rules/intent.js').Intent, name: string, text: string }>} */ ({}),
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
    preloadFonts(true);   // 开局后把其余一级字也下好，免得冷门字第一次出现时先闪成别的字体
    enemies.clear();
    if (walls.clear()) enemies.setObstacles([]);
    fusions.clear();
    dragon.clear();
    timers.length = 0;   // 上一局没跑完的延时（第二步法术、收锁定标记）不能带进新的一局
    if (pend) { clearTimeout(pend.t); pend = null; }
    buttonChant = false; frozen = false;
    hud.closeWrite();
    Object.assign(S, { phase: 'playing', mana: MANA_MAX, core: CORE_HP, gauge: 0, lastCombo: null, seen: [], said: new Set(),
      wave: 0, busy: false, restT: 0, inv: 0 });   // 新的一局天先放晴，再随第一波慢慢压上来
    S.talents = [...S.talents].sort((a, b) => TALENTS.indexOf(a) - TALENTS.indexOf(b));
    S.binds = Object.fromEntries(Object.entries(S.binds).filter(([k]) => S.talents.includes(k)));
    hud.setSkills(S.talents.map((el) => ({ el, label: S.binds[el]?.name || elName(el), named: !!S.binds[el] })),
      { cast: pressTalent, pen: openWrite, summon: pressSummon });
    startWave(0);
    hud.setCore(S.core, CORE_HP);
    setGauge(0);
    hud.hideOverlay();
    layoutCamera();   // 按钮栏出现后，底下被挡住的高度变了
    hud.input.focus();
  }

  /** 气势槽：改数、更新界面；满了亮出召唤按钮，过半先把龙的模型下好 @param {number} g */
  function setGauge(g) {
    S.gauge = g;
    hud.setGauge(g, ULT_GAUGE);
    hud.setSummonReady(g >= ULT_GAUGE);
    if (g >= ULT_GAUGE / 2) dragon.preload();
  }

  // ---------------------------------------------------------------- 选天赋（开始与结算页上）
  function renderPicker() {
    hud.renderPicker(TALENTS.map((el) => ({ el, name: elName(el), open: talentOpen(el), on: S.talents.includes(el) })),
      synergies(S.talents), (el) => { S.talents = toggleTalent(S.talents, el); renderPicker(); });
  }
  renderPicker();

  function startWave(i) {
    S.wave = i;
    S.queue = waveQueue(WAVES[i].mix);
    S.spawnT = 1.2; S.spawned = 0;
    hud.bigText(`第 ${i + 1} 波`, '#16202b', 1400);
    hud.setHint(WAVES[i].tip);
  }

  function updateWave(dt) {
    if (S.phase === 'rest') {
      S.restT -= dt;
      hud.setWave(`第 ${S.wave + 1} 波已守住`, `下一波 ${Math.ceil(Math.max(0, S.restT))} 秒`);
      if (S.restT <= 0) { S.phase = 'playing'; startWave(S.wave + 1); }
      return;
    }
    if (S.phase !== 'playing') return;
    S.spawnT -= dt;
    if (S.queue.length && S.spawnT <= 0) {
      const type = /** @type {any} */ (S.queue.shift());
      enemies.spawn(type, type === 'colossus' ? 0 : S.spawned % 2);
      S.spawned++;
      S.spawnT = WAVES[S.wave].interval * (type === 'colossus' ? 2 : 1);   // 巨像后面多留点空当
    }
    const left = S.queue.length + enemies.alive;
    hud.setWave(`第 ${S.wave + 1} / ${WAVES.length} 波`, `剩 ${left}`);
    if (!S.queue.length && !enemies.alive && !S.endless) {
      if (S.wave + 1 < WAVES.length) {
        S.phase = 'rest'; S.restT = REST_SEC;
        hud.bigText('守住了这一波', '#16202b', 1400);
        hud.setHint(`喘口气，${REST_SEC} 秒后下一波：${WAVES[S.wave + 1].tip}`);
      } else {
        S.phase = 'won';
        hud.showOverlay('护山大阵守住了', `五波傀儡尽数退去，阵眼还剩 ${Math.ceil(S.core)} 点。换个说法，再守一次？`, '再守一次');
      }
    }
  }

  // ---------------------------------------------------------------- 输入与慢放
  const input = hud.input;
  let slowSince = 0, slowSpent = false;
  const onInput = () => {
    if (input.value.trim() && !slowSince && !slowSpent) slowSince = performance.now();
    fx.setListening(!!input.value.trim());
  };
  /** 电脑上：输入框空着（或没在打字）时，1、2、3 放对应的天赋，4 召唤 @param {KeyboardEvent} e */
  const hotkey = (e) => {
    const k = '1234'.indexOf(e.key);
    if (k < 0 || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || S.phase !== 'playing') return false;
    e.preventDefault();
    if (k < 3) { const el = S.talents[k]; if (el) pressTalent(el); } else pressSummon();
    return true;
  };
  const onKey = (e) => {
    if (!input.value && hotkey(e)) return;
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const t = input.value; input.value = ''; onInput(); submit(t); }
    else if (e.key === 'Escape') input.blur();
  };
  const onGlobalKey = (e) => {
    if (e.key === '`') { hud.debug.hidden = !hud.debug.hidden; return; }
    if (document.activeElement instanceof HTMLInputElement) return;   // 在打字（主输入框或写咒对话框）
    if (hotkey(e)) return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && S.phase === 'playing') input.focus();
  };
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onGlobalKey);
  const startBtn = /** @type {HTMLButtonElement} */ (hud.overlay.querySelector('[data-start]'));
  startBtn.addEventListener('click', startGame);
  warmUp(opts.parseUrl);   // 玩家看标题的这几秒，把连接先建好

  // ---------------------------------------------------------------- 施法
  const groundPt = (pt) => new THREE.Vector3(pt.x, (groundHeightAt(pt.x, pt.z) ?? 0) + 0.4, pt.z);
  let castSeq = 0;

  /**
   * 每一步打谁，在放出之前就定下来：锁定标记亮的就是之后真正打的。
   * @param {{ el: string, form: string, target: string, count: number }[]} steps
   * @param {number} [m] 气势档（范围随气势变大，圈也跟着大）
   */
  function lockSteps(steps, m = 0) {
    const views = enemies.views();
    const resolved = steps.map((s) => resolveTarget(s.target, views, { count: s.count, caster: CASTER_POS, objects: OBJECTS }));
    const k = MOMENTUM_RANGE[m] ?? 1;
    const marks = steps.map((s, i) => {
      const res = resolved[i];
      const heads = s.form === 'bolt' ? res.ids.slice(0, s.count) : [];
      const ring = !heads.length && res.point
        ? { x: res.point.x, y: groundHeightAt(res.point.x, res.point.z) ?? 0, z: res.point.z,
            r: { bolt: 0.8, burst: FORMS.burst.radius * k, rain: RAIN.spread * k, wall: ((FORMS.wall.segments - 1) / 2) * WALL.gap + 0.5 }[s.form] ?? 1 }
        : null;
      return { el: s.el, ids: heads, ring };
    });
    return { resolved, marks };
  }

  /** @param {string} text */
  async function submit(text) {
    text = [...text.trim()].slice(0, INPUT_MAX_CHARS).join('');
    if (!text || S.busy || S.phase !== 'playing') return;
    text = maskText(text).text;   // 敏感词换成＊：咒语卡上看不到，模型也收不到，其余照常施法
    S.busy = true;
    slowSince = 0; slowSpent = false;
    const t0 = performance.now();
    const castId = ++castSeq;
    fx.beginChant(guessElement(text) || 'arcane');          // 回车 0.1 秒内先给反应
    const kwRaw = parseKeywords(text);
    locks.show(castId, lockSteps(sanitizeIntent(kwRaw, text).steps).marks);   // 先按关键词亮锁定，模型回来再更正
    const remoteP = parseRemote(opts.parseUrl, text, PARSE_TIMEOUT_MS);
    await new Promise((r) => setTimeout(r, CHANT_MIN_MS));
    const remote = await remoteP;
    // ms 是玩家实际等的总时间；括号里是服务器调模型花的时间，两者之差就是网络路上的时间
    let raw, source;
    const ms = Math.round(performance.now() - t0);
    const server = remote.ms ? `，模型 ${remote.ms} 毫秒` : '';
    if ('raw' in remote) {
      raw = remote.raw;
      const notes = [remote.ms ? `模型 ${remote.ms} 毫秒` : '', remote.via ? '走后备线路' : ''].filter(Boolean);   // 首选线路不通时注明
      source = notes.length ? `模型解析（${notes.join('，')}）` : '模型解析';
    }
    else {
      raw = kwRaw;
      source = remote.fail === 'offline' ? '关键词解析（离线）'
        : `${remote.fail === 'timeout' ? '简易解析' : '关键词解析'}（${FAIL_TEXT[remote.fail] || remote.fail}${server}）`;
    }
    let intent = sanitizeIntent(raw, text);
    if (!intent.steps.length && 'raw' in remote) {
      const k = sanitizeIntent(kwRaw, text);
      if (k.steps.length) { intent = { ...k, unknown: intent.unknown, overreach: intent.overreach || k.overreach }; source += '＋关键词'; }
    }
    perform(intent, { text, source, ms, raw, castId });
  }

  /** 天赋按键放出的法术：每一步的命中记在这里，按打法加气势槽（talents.js buttonGaugeGain） */
  const stepStats = new WeakMap();
  let buttonChant = false;   // 按键的咏唱很短：不慢放、不推镜头

  /**
   * 意图 → 裁决 → 咒语卡 → 放出。打字和天赋按键都走这里。
   * @param {import('./rules/intent.js').Intent} intent
   * @param {{ text: string, source: string, ms: number, raw: any, castId: number, button?: boolean }} c
   */
  function perform(intent, c) {
    const { text, source, ms, raw, castId } = c;
    if (S.phase !== 'playing') { fx.endChant(); buttonChant = false; locks.clear(castId); S.busy = false; return; }
    const firstEl = intent.summon && intent.summon !== 'thunder' ? intent.summon : intent.steps[0]?.el;
    if (firstEl) fx.retint(firstEl);
    const plan = planCast(intent, { mana: S.mana, lastCombo: S.lastCombo, seen: S.seen, said: S.said, text: c.button ? '' : text,
      gauge: S.gauge, button: !!c.button });
    S.mana -= plan.cost;
    setGauge(plan.gaugeSpent ? 0 : Math.min(ULT_GAUGE, S.gauge + plan.gaugeGain));
    if (intent.summon) dragon.preload();
    S.lastCombo = plan.lastCombo;
    S.seen.push(...plan.newlySeen);
    if (plan.saidKey) S.said.add(plan.saidKey);
    S.last = { text, source, ms, raw, plan };
    // 融合了、而名字只是按步骤自动拼的（模型没起名），就用融合的名字（"火卷风"而不是"风弹·火弹"）
    const fused = plan.steps.find((s) => s.fusion);
    const autoNamed = !intent.name || intent.name === defaultName(intent.steps);
    const name = fused && autoNamed ? /** @type {string} */ (fused.fusionName) : intent.name || (plan.ok ? defaultName(plan.steps) : '');
    hud.showCard({ name, text, plan, intent, source, ms });
    if (plan.backlash) { fx.backlash(); hud.bigText('天道不允', '#b3261e', 1300); }
    fx.endChant();
    buttonChant = false;
    if (!plan.ok) {
      locks.clear(castId);
      if (!plan.backlash) hud.bigText(intent.steps.length ? '法力不足' : '未能成咒', '#5d6b7a', 1000);
      S.busy = false;
      return;
    }
    const m = plan.momentum;
    if (plan.summon?.cast) {
      runSummon(plan.summon, castId);
      S.busy = false;
      return;
    }
    if (c.button) {
      // 按键：打中几个、有没有打出融合或反应，边打边加气势槽（融合在放出时就算）
      const stats = { hits: new Set(), combo: plan.steps.some((s) => s.fusion), awarded: 0 };
      for (const s of plan.steps) stepStats.set(s, stats);
      awardButton(stats);
    }
    const { resolved, marks } = lockSteps(plan.steps, m);
    locks.show(castId, marks);
    fx.launchBurst(plan.steps[0].el);
    const go = () => {
      plan.steps.forEach((step, i) => after(i * 0.45, () => runStep(step, resolved[i], m)));
      after((plan.steps.length - 1) * 0.45 + 1.2, () => locks.clear(castId));
    };
    if (plan.summon?.ghost) {
      // 差一口气：龙影升起、散开，再落雨
      hud.bigText('差一口气', '#2f5d8a', 1200);
      dragon.ghost(plan.summon.el, go);
    } else go();
    if (m >= 3 && !c.button) hud.bigText('气势如虹', '#16202b', 900);
    S.busy = false;
  }

  // ---------------------------------------------------------------- 天赋按键（设计文档第 4 节"天赋与按键"）
  /** 按键的这一招打出了新的命中或反应：补上该加的气势 @param {{ hits: Set<string>, combo: boolean, awarded: number }} st */
  function awardButton(st) {
    const g = buttonGaugeGain({ hits: st.hits.size, combo: st.combo });
    if (g <= st.awarded || S.phase !== 'playing') return;
    setGauge(Math.min(ULT_GAUGE, S.gauge + g - st.awarded));
    st.awarded = g;
  }

  /** @param {string} el */
  const buttonIntent = (el) => S.binds[el]?.intent ?? defaultIntent(el);
  /** 正在咏唱的按键：0.6 秒里再按另一个天赋，就合成一句（先后是语序） */
  let pend = /** @type {{ els: string[], castId: number, t: number } | null} */ (null);

  /** @param {string} el */
  function pressTalent(el) {
    if (S.phase !== 'playing' || !S.talents.includes(el) || !hud.write.hidden) return;
    if (pend) {
      if (pend.els.length < 2 && !pend.els.includes(el)) { pend.els.push(el); hud.setCharging(pend.els); fireButtons(); }
      return;
    }
    if (S.busy) return;
    S.busy = true;
    const castId = ++castSeq;
    pend = { els: [el], castId, t: window.setTimeout(fireButtons, BUTTON_CHANT_MS) };
    hud.setCharging(pend.els);
    buttonChant = true;
    fx.beginChant(el);
    locks.show(castId, lockSteps(buttonIntent(el).steps).marks);
  }

  function fireButtons() {
    if (!pend) return;
    clearTimeout(pend.t);
    const p = pend;
    pend = null;
    hud.setCharging([]);
    const intent = combineButtons(p.els.map(buttonIntent));
    const names = p.els.map((e) => S.binds[e]?.name || elName(e));
    perform(intent, { text: `按键 · ${names.join(' → ')}`, source: '天赋按键', ms: 0, raw: null, castId: p.castId, button: true });
  }

  /** 气势满了点"召唤"：冰龙按气势 0 档召（开口召的吃那句话的气势，更猛） */
  function pressSummon() {
    if (S.phase !== 'playing' || S.busy || pend || S.gauge < ULT_GAUGE || !hud.write.hidden) return;
    S.busy = true;
    buttonChant = true;
    fx.beginChant('ice');
    const intent = { steps: [], momentum: 0, name: '冰龙', unknown: [], overreach: false, notes: [], summon: 'ice' };
    perform(intent, { text: '按键 · 召唤', source: '天赋按键', ms: 0, raw: null, castId: ++castSeq, button: true });
  }

  // 给按钮写咒：对话框开着时游戏暂停（写咒不限时）；写好的这句解析后装进按钮
  let frozen = false;
  /** @param {string} el */
  function openWrite(el) {
    if (!(S.phase === 'playing' || S.phase === 'rest') || pend) return;
    frozen = true;
    const close = () => { hud.closeWrite(); frozen = false; };
    hud.openWrite(elName(el), el, {
      ok: (t) => bindButton(el, t, close),
      cancel: close,
      reset: () => { delete S.binds[el]; hud.setSkillLabel(el, elName(el), false); close(); },
      inspire: () => inspire(el),
    });
  }

  /** @param {string} el @param {string} text @param {() => void} close */
  async function bindButton(el, text, close) {
    text = maskText([...text.trim()].slice(0, INPUT_MAX_CHARS).join('')).text;
    if (!text) { hud.setWriteMsg('先写一句，或者点"求灵感"'); return; }
    hud.setWriteBusy(true);
    hud.setWriteMsg('正在领会这句话……');
    const kwRaw = parseKeywords(text);
    const remote = await parseRemote(opts.parseUrl, text, PARSE_TIMEOUT_MS);
    const fromModel = 'raw' in remote;
    let intent = sanitizeIntent(fromModel ? remote.raw : kwRaw, text);
    if (!intent.steps.length && fromModel) { const k = sanitizeIntent(kwRaw, text); if (k.steps.length) intent = { ...k, unknown: intent.unknown }; }
    hud.setWriteBusy(false);
    const r = bindSpell(el, intent, S.talents);
    if (!r.ok) { hud.setWriteMsg(r.why); return; }
    const name = r.intent.name || defaultName(r.intent.steps);
    S.binds[el] = { intent: r.intent, name, text };
    hud.setSkillLabel(el, name, true);
    close();
    // 预览：这一招每次放要花多少、气势几档（不扣法力）
    const plan = planCast(r.intent, { mana: MANA_MAX, seen: S.seen, text: '', button: true });
    hud.showCard({ name, text, plan, intent: r.intent, source: `${fromModel ? '模型解析' : '关键词解析'} · 装进「${elName(el)}」的按钮`, ms: 0 });
  }

  /** 求灵感：先请模型看着天赋和眼前的敌人现写 3 句；连不上就从写好的卷轴里挑 @param {string} el */
  async function inspire(el) {
    hud.setWriteBusy(true);
    hud.setWriteMsg('');
    /** @type {Record<string, number>} */
    const foes = {};
    for (const e of enemies.list) foes[e.type] = (foes[e.type] || 0) + 1;
    const lines = await inspireRemote(opts.parseUrl, { el, talents: S.talents, foes }, PARSE_TIMEOUT_MS);
    hud.setWriteBusy(false);
    const from = scrollTurn[el] || 0;
    if (!lines.length) scrollTurn[el] = from + 3;   // 每求一次换一批
    const ideas = lines.length ? lines.map((text) => ({ text, from: '模型现写' }))
      : scrollsFor(el, S.talents, 3, from).map((text) => ({ text, from: '卷轴' }));
    hud.setWriteIdeas(ideas);
  }
  /** @type {Record<string, number>} */
  const scrollTurn = {};

  /**
   * 真召唤：龙从施法者左前方破土，绕场一周，俯冲砸向目标；砸中时范围内每个敌人按"从天而降"吃一下（盾挡不住）。
   * @param {import('./rules/arbiter.js').SummonPlan} sm
   * @param {number} castId
   */
  function runSummon(sm, castId) {
    const res = resolveTarget(sm.target, enemies.views(), { count: 3, caster: CASTER_POS, objects: OBJECTS });
    const pt = res.point ?? { x: DEFAULT_AIM.x, z: DEFAULT_AIM.z };
    const at = (x, z) => new THREE.Vector3(x, groundHeightAt(x, z) ?? 0, z);
    // 龙要飞五六秒，锁定的几只一直在走：落点跟着它们（还活着的几只的中心）走；全死了就砸最后看到的位置
    const ids = res.ids;
    const follow = () => {
      const live = ids.map((id) => enemies.get(id)).filter(Boolean);
      if (!live.length) return null;
      return at(live.reduce((a, e) => a + e.pos.x, 0) / live.length, live.reduce((a, e) => a + e.pos.z, 0) / live.length);
    };
    locks.show(castId, [{ el: sm.el, ids, ring: ids.length ? null : { x: pt.x, y: groundHeightAt(pt.x, pt.z) ?? 0, z: pt.z, r: sm.radius } }]);
    hud.bigText(`${sm.name}现世`, '#1f5f9a', 1400);
    fx.launchBurst(sm.el);
    dragon.summon(at(pt.x, pt.z), sm.el, (p) => {
      locks.clear(castId);
      if (S.phase !== 'playing') return;
      for (const e of [...enemies.list]) {
        if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= sm.radius) hitEnemy(e, { el: sm.el }, sm.dmg, p, { fromAbove: true });
      }
    }, ids.length ? follow : undefined);
  }

  /**
   * 放一发：别的元素是飞弹；雷不飞，是一道闪电——直线就从施法者手上劈过去，从天而降就从头顶劈下来
   * （绕到背后的仍是一颗电球绕过去）。落点与命中结算和飞弹一样走 onHit。
   * @param {{ el: string, path: string, delay?: number, target: () => THREE.Vector3, onHit: (p: THREE.Vector3) => void, big?: boolean }} o
   */
  function shoot(o) {
    if (o.el !== 'thunder' || o.path === 'behind') { fx.bolt(o); return; }
    after(o.delay || 0, () => {
      if (S.phase !== 'playing') return;
      const end = o.target().clone();
      const from = o.path === 'sky' ? end.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 15, 1.5)) : origin.clone();
      fx.arc(from, end);
      o.onHit(end);
    });
  }

  /**
   * @param {import('./rules/arbiter.js').PlannedStep} step
   * @param {{ ids: string[], point: { x: number, z: number } | null }} res 施法时就定好的目标（与锁定标记一致）
   * @param {number} [m] 气势档：范围 × MOMENTUM_RANGE，特效 × MOMENTUM_FX，第 3 档每次命中加顿帧
   */
  function runStep(step, res, m = 0) {
    if (S.phase !== 'playing') return;
    if (step.fusion) { runFusion(step, res); return; }
    const range = MOMENTUM_RANGE[m] ?? 1, big = MOMENTUM_FX[m] ?? 1;
    const boom = (p, R, scale) => { fx.burst(p, step.el, R, scale * big); if (m >= 3) fx.hitStop = Math.max(fx.hitStop, 0.12); };
    const dir = { fromAbove: step.path === 'sky', fromBehind: step.path === 'behind' };
    if (step.form === 'bolt') {
      for (let i = 0; i < step.count; i++) {
        const id = res.ids.length ? res.ids[i % res.ids.length] : null;
        let last = res.point ? groundPt(res.point) : DEFAULT_AIM.clone();
        shoot({
          el: step.el, path: step.path, delay: i * 0.14, big: m >= 2,
          target: () => { const e = id && enemies.get(id); if (e) enemies.aimPoint(e, last); return last; },
          onHit: (p) => {
            boom(p, 1.3, 0.45);
            const e = id && enemies.get(id);
            if (e) hitEnemy(e, step, step.dmgEach, CASTER_POS, dir);
          },
        });
      }
    } else if (step.form === 'rain') {
      // 雨：2 秒里从天上落 6 次，落点撒在目标周围；从天而降，盾傀儡挡不住
      const c = res.point ? groundPt(res.point) : DEFAULT_AIM.clone();
      for (let i = 0; i < FORMS.rain.hits; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * RAIN.spread * range;
        const tp = groundPt({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r });
        shoot({
          el: step.el, path: 'sky', delay: (i * FORMS.rain.sec) / FORMS.rain.hits, target: () => tp,
          onHit: (p) => {
            boom(p, RAIN.hitR * range, 0.4);
            for (const e of [...enemies.list]) {
              if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= RAIN.hitR * range) hitEnemy(e, step, step.dmgEach, p, { fromAbove: true });
            }
          },
        });
      }
    } else if (step.form === 'wall') {
      raiseWall(step, res);
    } else {
      const pt = res.point ? groundPt(res.point) : DEFAULT_AIM.clone();
      const R = FORMS.burst.radius * range;
      shoot({
        el: step.el, path: 'straight', big: true, target: () => pt,
        onHit: (p) => {
          boom(p, R, 1);
          for (const e of [...enemies.list]) {
            if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= R) hitEnemy(e, step, step.dmgEach, p, {});
          }
        },
      });
    }
  }

  /**
   * 墙：在目标处横着立一道（垂直于施法者看过去的方向），5 段。
   * 土墙压到的敌人挨一下，然后挡路；火冰风墙是帘子，谁穿过去谁挨一下（每堵墙每个敌人只算一次）。
   */
  function raiseWall(step, res) {
    let c = res.point ? { x: res.point.x, z: res.point.z } : { x: DEFAULT_AIM.x, z: DEFAULT_AIM.z };
    if (res.ids.length) {
      // 打的是敌人：墙立在它前面 2 米（挡在它和阵眼之间），而不是砸在它身上
      const tx = CORE_POS.x - c.x, tz = CORE_POS.z - c.z, tl = Math.hypot(tx, tz) || 1;
      c = { x: c.x + (tx / tl) * Math.min(2, tl - 3), z: c.z + (tz / tl) * Math.min(2, tl - 3) };
    }
    let dx = c.x - CASTER_POS.x, dz = c.z - CASTER_POS.z, len = Math.hypot(dx, dz);
    if (len < 2.2) { c = { x: CASTER_POS.x, z: CASTER_POS.z - 2.6 }; dx = 0; dz = -1; len = 1; }   // 「自己脚下」：立在身前，别把自己围住
    const ux = -dz / len, uz = dx / len;   // 墙沿这个方向排开
    const n = FORMS.wall.segments, half = (n - 1) / 2;
    const pts = Array.from({ length: n }, (_, k) => ({ x: c.x + ux * (k - half) * WALL.gap, z: c.z + uz * (k - half) * WALL.gap }));
    const earth = step.el === 'earth';
    const w = walls.add(step.el, pts, Math.atan2(ux, uz) + Math.PI / 2, earth ? WALL.earthSec : WALL.curtainSec, step);
    fx.burst(groundPt(c), step.el, 1.6, 0.5);
    if (earth) {
      enemies.setObstacles(walls.obstacles());
      for (const e of [...enemies.list]) {
        if (distToSegment(e.pos, pts[0], pts[n - 1]) < 0.8) { w.hit.add(e.id); hitEnemy(e, step, step.dmgEach, e.pos.clone().add(new THREE.Vector3(0, 0, 1)), {}); }
      }
    }
  }

  /**
   * 融合法术。方向一律是"从施法者看向目标"：火卷风从目标身前起、往外卷；烈焰冲击从施法者身前喷出去。
   * 两种都把敌人往外甩（远离阵眼），靠近悬崖的会被甩下云海。
   */
  function runFusion(step, res) {
    const c = res.point ? groundPt(res.point) : DEFAULT_AIM.clone();
    const dir = new THREE.Vector3(c.x - CASTER_POS.x, 0, c.z - CASTER_POS.z);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
    dir.normalize();
    hud.bigText(step.idiom || step.fusionName, '#b5481c', 1100);
    if (step.fusion === 'wind>fire') {
      const start = c.clone().addScaledVector(dir, -2.5);
      start.y = groundHeightAt(start.x, start.z) ?? 0;
      fusions.tornado(start, dir, step);
    } else if (step.fusion === 'fire>wind') {
      const from = CASTER_POS.clone().setY(1.3).addScaledVector(dir, 0.8);
      fusions.beam(from, dir);
      for (const e of [...enemies.list]) {
        const rx = e.pos.x - from.x, rz = e.pos.z - from.z;
        const along = rx * dir.x + rz * dir.z, lat = Math.abs(rx * dir.z - rz * dir.x);
        if (along < 0 || along > BEAM.len || lat > BEAM.halfW) continue;
        hitEnemy(e, step, step.dmgEach, from, {});
        enemies.fling(e, dir.x * 11, 2.5, dir.z * 11);
      }
    }
  }

  /** 每帧：火卷风碰到谁，烧一下并把它卷起来甩出去（每根卷风每个敌人一次） */
  function tornadoContacts() {
    for (const tw of fusions.tornadoes) {
      for (const e of [...enemies.list]) {
        if (tw.hit.has(e.id) || Math.hypot(e.pos.x - tw.pos.x, e.pos.z - tw.pos.z) > TORNADO.r) continue;
        tw.hit.add(e.id);
        hitEnemy(e, tw.step, tw.step.dmgEach, tw.pos, {});
        enemies.fling(e, tw.dir.x * 8 + (Math.random() - 0.5) * 3, 6, tw.dir.z * 8 + (Math.random() - 0.5) * 3);
      }
    }
  }

  /** 每帧：谁穿过了火冰风墙，挨一下 */
  function curtainContacts() {
    for (const w of walls.curtains()) {
      const a = w.pts[0], b = w.pts[w.pts.length - 1];
      for (const e of [...enemies.list]) {
        if (w.hit.has(e.id) || distToSegment(e.pos, a, b) > 0.7) continue;
        w.hit.add(e.id);
        hitEnemy(e, w.payload, w.payload.dmgEach, groundPt({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }).setY(0), {});
      }
    }
  }

  function hitEnemy(e, step, dmg, from, dir) {
    const wasFrozen = e.frozen > 0;
    const r = damageTo({ type: e.type, frozen: wasFrozen }, { el: step.el, dmg, ...dir });
    const at = e.pos.clone();
    enemies.applyHit(e, r, from, step.el);
    if (step.el === 'thunder' && !dir.chain) chain(e, at, wasFrozen, step, dmg);
    const st = stepStats.get(step);   // 天赋按键放的：记命中与反应，按打法加气势
    if (st) { st.hits.add(e.id); if (r.reaction) st.combo = true; awardButton(st); }
    if (r.aoeBonus) {
      // 蒸汽爆：冻住的目标被火打中，炸开一圈额外伤害
      fx.burst(at.clone().setY(at.y + 0.6), 'fire', 2.5, 0.7);
      for (const o of [...enemies.list]) {
        if (o !== e && Math.hypot(o.pos.x - at.x, o.pos.z - at.z) <= 3) enemies.applyHit(o, { dmg: r.aoeBonus, freezeSec: 0, burnSec: 0, unfreeze: true, push: 0, reaction: '蒸汽爆' }, at, 'fire');
      }
    }
  }

  /**
   * 雷的连锁：从被劈中的那只（已经死了也算，用它倒下前的位置）一跳一跳劈向旁边的，每跳隔一小会儿，
   * 打谁、打多疼由 chainTargets 定；跳出来的这几下不再连锁。
   */
  function chain(e, at, wasFrozen, step, dmg) {
    const views = [{ id: e.id, x: at.x, z: at.z, frozen: wasFrozen },
      ...enemies.list.filter((o) => o !== e).map((o) => ({ id: o.id, x: o.pos.x, z: o.pos.z, frozen: o.frozen > 0 }))];
    const jumps = chainTargets(e.id, views, dmg);
    let prev = at.clone().setY(at.y + 0.8);
    jumps.forEach((j, k) => after(0.08 * (k + 1), () => {
      const o = enemies.get(j.id);
      if (!o || S.phase !== 'playing') return;
      const to = enemies.aimPoint(o);
      fx.arc(prev, to, { jitter: 0.35 });
      hitEnemy(o, step, j.dmg, prev.clone(), { chain: true });
      prev = to.clone();
    }));
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

  // ---------------------------------------------------------------- 特效试验场（?lab 或 demo.lab()；面板在 ui/lab.js）
  const lab = { on: false, dim: -1, inv: -1, speed: 1, panel: /** @type {ReturnType<typeof mountLab> | null} */ (null) };
  /** 放一发：raw 是模型格式的意图，走和玩家一样的清洗、裁决、演出；不扣法力、不计重复衰减 @param {any} raw @param {string} label */
  function labCast(raw, label) {
    if (S.phase !== 'playing') return;
    S.mana = MANA_MAX; S.lastCombo = null; S.said = new Set(); S.busy = false;
    if (raw.c) setGauge(ULT_GAUGE);
    const castId = ++castSeq;
    const intent = sanitizeIntent(raw, label);
    locks.show(castId, lockSteps(intent.steps, intent.momentum).marks);
    fx.beginChant(intent.summon || intent.steps[0]?.el || 'arcane');
    after(0.2, () => perform(intent, { text: label, source: '试验场', ms: 0, raw, castId }));
  }
  function labTargets() {
    for (let i = 0; i < 4; i++) enemies.spawn('grunt', i % 2);
    enemies.spawn('shield', 0);
    enemies.spawn('grunt', 1);
  }
  function enterLab() {
    if (lab.on) return;
    lab.on = true;
    S.endless = true;
    startGame();
    S.queue.length = 0;
    hud.setHint('特效试验场：在面板里挑招放，可放慢、定格、锁定压暗');
    labTargets();
    lab.panel = mountLab(root, {
      cast: labCast, speed: (s) => { lab.speed = s; }, dim: (v) => { lab.dim = v; }, inv: (v) => { lab.inv = v; },
      targets: labTargets, clear: () => { for (const e of [...enemies.list]) enemies.kill(e, e.pos); },
      quality: quality.name,
    });
  }

  // ---------------------------------------------------------------- 主循环
  let raf = 0, lastNow = performance.now(), timeScale = 1, fpsAcc = 0, fpsN = 0, fps = 0, dbgT = 0, idleT = 0, worldDim = 0, labT = 0;
  const impactUv = new THREE.Vector2(0.5, 0.5);
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), shakeOff = new THREE.Vector3();
  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const realDt = Math.min((now - lastNow) / 1000, 1 / 30);
    lastNow = now;
    // 开口就慢放：输入中（单次最多 8 秒）与咏唱中都是 0.3 倍
    if (slowSince && now - slowSince > SLOWMO_MAX_SEC * 1000) { slowSince = 0; slowSpent = true; }
    const slow = (slowSince > 0 || (fx.chanting > 0 && !buttonChant)) && S.phase === 'playing';
    timeScale += ((slow ? SLOWMO_SCALE : 1) - timeScale) * Math.min(1, realDt * 10);
    let dt = frozen ? 0 : realDt * timeScale * lab.speed;   // 写咒对话框开着：游戏停住，画面照画；试验场可放慢、定格
    if (fx.hitStop > 0) { fx.hitStop -= realDt; dt *= 0.06; }
    idleT += dt;

    for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { const t = timers.splice(i, 1)[0]; t.fn(); } }
    if (S.phase === 'playing' || S.phase === 'rest') {
      S.mana = regenMana(S.mana, dt);
      updateWave(dt);
    }
    world.step(1 / 60, dt, 3);
    updateCubes(dt);
    if (walls.update(dt)) enemies.setObstacles(walls.obstacles());   // 土墙沉下去了，流场重算
    curtainContacts();
    fusions.update(dt);
    tornadoContacts();
    dragon.update(dt);
    enemies.update(dt, camera);
    fx.update(dt);
    locks.update(dt, enemies);
    const live = particles.update(dt);
    const inkLive = ink.update(dt);
    // 压暗世界：大招（fx.dimLevel）或开口咏唱时轻压一点；试验场可以锁定
    const dimTarget = lab.dim >= 0 ? lab.dim : Math.max(fx.dimLevel, fx.chanting > 0 && !buttonChant ? 0.18 : 0);
    worldDim += (dimTarget - worldDim) * Math.min(1, realDt * 6);
    env.setDim(worldDim);
    // 入侵：天色跟波次走、守住散开、输了全暗；试验场可以锁定某一档
    const invT = invasionTarget({ phase: S.phase, wave: S.wave, waves: WAVES.length, progress: S.spawned / Math.max(1, S.spawned + S.queue.length) });
    S.inv = lab.inv >= 0 ? lab.inv : stepInvasion(S.inv, invT, S.phase, dt);
    env.setInvasion(S.inv);
    layout.coreSigil.rotation.z += dt * 0.2;
    layout.crystal.rotation.y += dt * 0.8;
    layout.crystal.position.y = 1.7 + Math.sin(idleT * 1.6) * 0.12;
    const cm = layout.crystal.material;
    cm.emissiveIntensity += (0.8 - cm.emissiveIntensity) * Math.min(1, dt * 3);
    hud.setMana(S.mana, MANA_MAX);
    if (lab.on) {   // 试验场：法力、阵眼一直满
      S.mana = MANA_MAX;
      if (S.core < CORE_HP) { S.core = CORE_HP; hud.setCore(S.core, CORE_HP); }
      labT += realDt;
      if (lab.panel && labT > 0.3) {
        labT = 0;
        lab.panel.setStatus(`帧率 ${fps} · 粒子 ${live} · 墨 ${inkLive}\n压暗 ${worldDim.toFixed(2)} · 时间 ×${(timeScale * lab.speed).toFixed(2)}`);
      }
    }

    // 镜头：咏唱时推近，动完回到固定位置
    const focusT = (fx.chanting > 0 && !buttonChant) || (slowSince > 0 && S.phase === 'playing') ? 0.35 : 0;
    cam.focus += (focusT - cam.focus) * Math.min(1, realDt * 3);
    camPos.copy(cam.base).lerp(cam.near, cam.focus);
    camLook.copy(cam.look).lerp(cam.nearLook, cam.focus);
    shakeOff.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(fx.shake * 0.5);
    camera.position.copy(camPos).add(shakeOff);
    camera.lookAt(camLook);
    env.update(dt, camera.position);   // 云、雾流动，雾里的闪电（游戏时间，慢放时一起变慢）
    fx.cameraPos.copy(camera.position);
    fx.impactK *= Math.exp(-realDt * 9);
    _v.copy(fx.impactPos).project(camera);
    impactUv.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
    grade.tick(realDt, _v.z < 1 ? fx.impactK : 0, impactUv, camera.aspect);
    renderer.info.reset();
    composer.render();

    fpsAcc += realDt; fpsN++;
    if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    dbgT += realDt;
    if (!hud.debug.hidden && dbgT > 0.25) {
      dbgT = 0;
      const l = S.last;
      hud.debug.textContent = [`帧率 ${fps}  ${quality.label}`, `粒子 ${live}  墨 ${inkLive}`, `敌人 ${enemies.alive}`, `法力 ${Math.floor(S.mana)}  气势槽 ${S.gauge}`,
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
    block: (list = []) => enemies.setObstacles(list),
    wave: (i = 0) => { enemies.clear(); S.phase = 'playing'; startWave(i); },
    lab: () => enterLab(),
    killAll: () => { S.queue.length = 0; for (const e of [...enemies.list]) enemies.kill(e, e.pos); },
    gauge: (n = ULT_GAUGE) => setGauge(n),
    /** 天赋按键：按一个，或在 0.6 秒内按两个（press('wind','fire') 出火卷风）；summonBtn 是金色召唤按钮 */
    press: (...els) => els.forEach((el) => pressTalent(el)),
    summonBtn: () => pressSummon(),
    /** 单独劈一道闪电看样子：zap([x,y,z], [x,y,z]) */
    zap: (a, b) => fx.arc(new THREE.Vector3(...a), new THREE.Vector3(...b)),
    /** 入侵程度锁在 k（0～1），不给就回到跟着波次走；flash 在黑雾里劈一道闪电 */
    invade: (k = -1) => { lab.inv = k; },
    flash: () => env.flash(),
    talents: (list) => { if (list) { S.talents = list; renderPicker(); } return [...S.talents]; },
    binds: () => Object.fromEntries(Object.entries(S.binds).map(([k, v]) => [k, { name: v.name, text: v.text }])),
    // 面板太小时看不清：按 w×h 横屏重画当前这一帧（先 pause 定格），返回 JPEG 的 data URL
    snap: (w = 960, h = 540, focus = 0) => {
      const css = root.style.cssText, ratio = renderer.getPixelRatio();
      root.style.cssText += `;width:${w}px;height:${h}px;right:auto;bottom:auto`;
      renderer.setPixelRatio(1);
      layoutCamera();
      camera.position.copy(cam.base).lerp(cam.near, focus); camera.lookAt(_v.copy(cam.look).lerp(cam.nearLook, focus));
      composer.render();
      const url = renderer.domElement.toDataURL('image/jpeg', 0.72);
      root.style.cssText = css;
      renderer.setPixelRatio(ratio);
      layoutCamera();
      return url;
    },
    /** 竖屏取景的参数（调镜头用：改完这些向量再触发一次 resize） */
    framing: { dir: NARROW_DIR, look: NARROW_LOOK, wide: FRAME_WIDE, near: FRAME_NEAR },
    dragon: () => dragon.preload(),
    flight: () => { const f = dragon.active; return f && { kind: f.kind, s: +f.s.toFixed(1), sHit: +f.sHit.toFixed(1), impacted: f.impacted, target: f.target.toArray().map((v) => +v.toFixed(1)) }; },
    locks: () => ({ heads: locks.heads.filter((h) => h.mesh.visible).map((h) => h.id), rings: locks.rings.filter((r) => r.mesh.visible).length }),
    // 以下给检查页用
    refill: () => { S.mana = MANA_MAX; S.core = CORE_HP; hud.setCore(S.core, CORE_HP); },
    endless: (on = true) => { S.endless = on; },
    cubes: (n = 300, life = 12) => dropCubes(n, life),
    /** 调画面：env.look 里改灯的基准强度与天空、云海的颜色，renderer.toneMappingExposure 改曝光 */
    world: { scene, renderer, env },
    gl: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, ratio: renderer.getPixelRatio(),
      size: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(), cubes: stressList.length, mobile }),
  };
  /** @type {any} */ (window).demo = demo;
  if (opts.lab) enterLab();

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    vv?.removeEventListener('resize', onResize);
    vv?.removeEventListener('scroll', onResize);
    window.removeEventListener('keydown', onGlobalKey);
    enemies.clear();
    for (const c of stressList) world.removeBody(c.body);
    scene.remove(stressMesh); stressMesh.dispose(); stressGeo.dispose(); stressMat.dispose();
    locks.dispose();
    walls.dispose();
    fusions.clear();
    dragon.clear();
    hud.dispose();
    composer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    if (/** @type {any} */ (window).demo === demo) delete /** @type {any} */ (window).demo;
  };
}
