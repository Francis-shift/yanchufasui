// @ts-check
/**
 * 游戏入口：搭场景、接输入、跑主循环。施法一条龙：
 *   开口就慢放 → 回车：关键词先猜元素给法阵上色 → 咏唱（同时请模型解析，最短 0.8 秒、超时 4.5 秒改用关键词）
 *   → 清洗意图 → 裁决（消耗、降级、伤害）→ 咒语卡 → 执行（飞弹 / 爆炸 / 命中结算）。
 * 规则全在 game/rules/（纯函数、有单测）；这里只负责把结果演出来。
 * 两个模式：守关（5 波，这里管波次）、试炼（boss 关，灰盒试玩版，在 modes/trial.js；这里切换模式、把打在 boss 身上的命中交给它算冰甲）。
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { chainTargets, damageTo, planCast, regenMana, resolveTarget, twinTarget } from './rules/arbiter.js';
import { inWave } from './rules/fusion.js';
import { defaultName, sanitizeIntent } from './rules/intent.js';
import { guessElement, parseKeywords } from './rules/keywords.js';
import { maskText } from './rules/safety.js';
import {
  BOSS_COUNT, CARDS, KIND_NAMES, RUNES, RUN_STAGES, applyRunes, artBoost, beats, boostPlan, buttonMove, clock, level, limitToLearned, moveName,
  moveTargets, newRun, offer, previewMove, readRecord, recordText, reroll as rerollCards, runFusions, runMods, runeChantMs, runeSlots, runesOf,
  skip as skipCards, take as takeCard, upLabel, writeRune,
} from './rules/run.js';
import {
  GAUGE_WHITE, bindSpell, buttonGaugeGain, combineButtons, defaultIntent, elName, gaugeDragon, gaugeTo, scrollsFor, synergies, talentOpen,
  toggleTalent,
} from './rules/talents.js';
import {
  BEAM, BUTTON_CHANT_MS, CHANT_MIN_MS, CORE_HP, ELEMENTS, FORMS, INPUT_MAX_CHARS, MANA_MAX, MOMENTUM_FX, MOMENTUM_RANGE, PARSE_TIMEOUT_MS, RAIN,
  RUN, SLOWMO_MAX_SEC, SLOWMO_SCALE, SUMMONS, TALENTS, TORNADO, TRIAL, WALL,
} from './rules/numbers.js';
import { Caster } from './actors/caster.js';
import { Enemies } from './actors/enemies.js';
import { loadRig } from './actors/rig.js';
import { Trial } from './modes/trial.js';
import { DragonFx } from './fx/dragon.js';
import { Locks } from './fx/locks.js';
import { distToSegment, Walls } from './fx/walls.js';
import { FusionFx } from './fx/fusions.js';
import { GradePass } from './fx/grade.js';
import { Particles } from './fx/particles.js';
import { SpellFx } from './fx/spells.js';
import { Sound } from './fx/sound.js';
import { buildEnvironment } from './world/environment.js';
import { invasionTarget, stepInvasion } from './world/invasion.js';
import { buildBarrier } from './world/barrier.js';
import { fitFrame } from './world/framing.js';
import { FOLLOW, LOCK, SHOT, VIEW_NAMES, followPose, kickAt, lockPose, lockTarget, nextView, offscreenArrow, readView, shoulderPose, turnToward,
  viewDir } from './world/trialcam.js';
import { loadProps } from './world/props.js';
import { buildLayout, CASTER_POS, CORE_POS, groundHeightAt, OBJECTS, OBSTACLES } from './world/layout.js';
import { Hud, preloadFonts } from './ui/hud.js';
import { makeReport, topNames } from './ui/report.js';
import { asrRemote, inspireRemote, parseRemote, warmUp } from './net.js';
import { ASR_TIMEOUT_MS, MAX_SEC, Recorder } from './voice.js';
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
/** 语音没识别成的原因，写在提示行（说一次没成，玩家要知道是再说一次还是改打字） */
const ASR_FAIL = {
  silence: '没听清，靠近一点再说一次', timeout: '听写超时了，再说一次，或者直接打字', no_key: '语音识别还没开通，先打字或按按钮',
  rate: '说得太快了，歇一下再说', daily: '今天的语音次数用完了，先打字或按按钮', network: '连不上听写服务，先打字或按按钮',
  offline: '连不上听写服务，先打字或按按钮', asr_error: '听写出错了，再说一次，或者直接打字', bad_request: '这段太长了，说短一点',
};
/** 试炼开战后开口召龙：时间几乎停住（守关照常是 SLOWMO_SCALE） */
const TRIAL_VOICE_SLOW = 0.1;

/**
 * @param {HTMLElement} root
 * @param {{ parseUrl?: string | string[], lab?: boolean, dragon?: { mesh?: string, tex?: string | null, models?: Record<string, { mesh: string, tex?: string | null }> }, models?: string,
 *           grunt?: { mesh: string, tex?: string | null }, caster?: { mesh: string, tex?: string | null }, bosses?: Record<string, { mesh: string, tex?: string | null }> }} [opts]
 *   lab：直接进特效试验场； parseUrl：解析接口，给一串就按顺序当后备（见 net.js）；dragon：冰龙模型与贴图的地址，models 里按元素给另外四条龙的；models：场景物件模型的目录（不给就一直用方块占位）；
 *   grunt：小傀儡的骨骼模型与贴图（三种小怪共用；不给或下载失败用方块）；caster：施法者的（不给或下载失败用胶囊占位）；boss：寒甲傀儡王的（同上用方块）
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
  const layout = buildLayout(scene, { tex: quality.name === 'cinema' ? 2048 : 1024, reflect: quality.reflect });
  const barrier = buildBarrier(scene, { tex: quality.name === 'cinema' ? 2048 : 1024 });   // 护山大阵的金色光罩，裂纹跟阵眼血量
  if (opts.models) loadProps(scene, layout, quality.name, opts.models, renderer, env);   // 牌坊、石兽、镇山石的模型，到了替换方块占位
  const particles = new Particles(scene, quality.particles);
  particles.floorAt = (x, z) => (groundHeightAt(x, z) ?? -60) + 0.03;
  const ink = new Particles(scene, quality.ink, { ink: true });   // 墨点、墨烟（特效风格 v2）
  ink.floorAt = particles.floorAt;
  const origin = CASTER_POS.clone().setY(1.5);
  const fx = new SpellFx(scene, particles, origin, { ink, quality });
  fx.groundAt = groundHeightAt;   // 焦痕只落在平地上
  // 声音（fx/sound.js，现场合成）：法术、boss、试炼的声音经 fx.sound 出；浏览器要等第一次点击或按键才肯出声，之后每次点按顺手叫醒一下（苹果切走再回来会睡着）
  const sound = new Sound();
  fx.sound = sound;
  const unlock = () => sound.unlock();
  const UNLOCK_ON = /** @type {const} */ (['pointerdown', 'touchend', 'click', 'keydown']);
  for (const ev of UNLOCK_ON) window.addEventListener(ev, unlock, { capture: true, passive: true });
  const locks = new Locks(scene);

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
  const plaza = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Cylinder(11, 11, 1, 24), position: new CANNON.Vec3(0, -0.5, 0) });
  world.addBody(plaza);

  const walls = new Walls(scene, world, particles);
  walls.fx = fx;   // 土墙碎成碎石、风墙的笔触
  const fusions = new FusionFx(fx, particles, quality.name === 'cinema' ? 1 : 0.55);   // 手机上火云团数打折
  const dragon = new DragonFx(fx, particles, opts.dragon);
  const hud = new Hud(root);
  hud.setMuted(sound.muted, () => { sound.setMuted(!sound.muted); hud.setMuted(sound.muted); sound.play('tick'); });
  preloadFonts();   // 标题画面期间先下书法字的常用那份
  const _v = new THREE.Vector3();
  /** 场景里某点上方飘一个字 @param {THREE.Vector3} p @param {string} text @param {string} color */
  const floatAt = (p, text, color) => {
    _v.copy(p).project(camera);
    if (_v.z > 1) return;
    const c = renderer.domElement;   // 用布局尺寸：试炼横过来转了 90° 时，屏幕上量到的宽高是对调的
    hud.floatText((_v.x * 0.5 + 0.5) * c.clientWidth, (-_v.y * 0.5 + 0.5) * c.clientHeight, text, color);
  };
  const enemies = new Enemies(scene, world, particles, {
    onCoreHit: (dmg) => hitCore(dmg),
    onGone: (e, how) => {
      if (S.phase === 'title') return;   // 首页的活背景：碎了不出声
      if (how === 'kill') sound.play('shatter'); else if (how === 'fall') sound.play('fall');
      trial.onGone(e, how);   // 试炼：boss 碎了就赢
    },
    pushed: (e) => fx.windTrail(e.group),   // 被风吹飞的身后拖两道笔触，推下悬崖那一下看得清
    emerge: () => env.spawnPuff(),          // 索桥那一路从邻峰的黑雾里出来：雾鼓一下
    touch: (e) => trial.touch(e),           // 试炼：小傀儡贴身自爆
    floatText: floatAt,
  });
  if (opts.grunt) {   // 开局就下（约 170 KB）：到了以后冒出来的小怪用模型，没到之前、下载失败都用方块
    loadRig(opts.grunt.mesh, opts.grunt.tex).then((r) => enemies.useRig(r), (err) => console.warn('小傀儡模型没下载成功，继续用方块', err));
  }
  if (opts.bosses) {   // 三个 boss（各约 550～580 KB）：开局先下第一个，第一段小怪潮打完时多半已经到了；到了（或失败）再下下一个，不一起抢带宽；没到、下载失败都用方块
    const NAME = /** @type {Record<string, string>} */ ({ boss: '寒甲傀儡王', stone: '石甲巨像', flame: '火灵' });
    Object.entries(opts.bosses).reduce((prev, [type, m]) => prev.then(() => loadRig(m.mesh, m.tex).then(
      (r) => enemies.useBossRig(/** @type {any} */ (type), r), (err) => console.warn(`${NAME[type] ?? type}模型没下载成功，继续用方块`, err))), Promise.resolve());
  }
  const caster = new Caster(layout.caster);   // 施法者：蓄力、出掌、走跑、闪避的动作（模型约 200 KB，到了才换掉胶囊）
  if (opts.caster) {
    loadRig(opts.caster.mesh, opts.caster.tex).then((r) => caster.use(r), (err) => console.warn('施法者模型没下载成功，继续用胶囊占位', err));
  }
  const trial = new Trial(scene, { enemies, fx, particles, hud, caster: layout.caster, origins: [origin, fx.origin],
    dodge: () => caster.dodge(), ghost: (mat) => caster.ghost(mat),
    fireWave: (from, dir) => fusions.beam(new THREE.Vector3(from.x, 1.3, from.z), new THREE.Vector3(dir.x, 0, dir.z), null),   // 火灵的火浪借豪火灭却的火云
    canvas: renderer.domElement, mobile, floatText: floatAt, win: trialWon, lose: trialLost,
    blockers: () => walls.obstacles(),   // 土墙挡得住冰锥
    reward: (mana, gauge) => {   // 完美闪避：回法力、加气势；拿了刹那、反手的开窗口
      S.mana = Math.min(MANA_MAX, S.mana + mana); setGauge(Math.min(S.mods.ult, S.gauge + gauge));
      if (S.mods.chana) { S.slowT = RUN.arts.slow.sec; floatAt(new THREE.Vector3(CASTER_POS.x, 3.1, CASTER_POS.z), '刹那', '#cfe6ff'); }
      if (S.mods.fanshou) S.counterT = RUN.arts.counter.sec;
    },
    local: (x, y) => toLocal(x, y), pick: (insight, done) => openPick(insight, done),
    strike: (e, dmg, at) => hitEnemy(e, { el: 'earth' }, dmg, new THREE.Vector3(at.x, 1, at.z), {}) });   // 字诀「返」弹回去的冰锥

  // ---------------------------------------------------------------- 镜头：第三人称，平时固定；开口时轻推近
  const cam = { base: new THREE.Vector3(), look: new THREE.Vector3(), near: new THREE.Vector3(), nearLook: new THREE.Vector3(), focus: 0 };
  /**
   * 试炼的跟随镜头（world/trialcam.js）：平滑后的看的点、离多远；on 为 false 时下一帧直接跳到位。
   * perfects、kickT：上一帧数到的完美闪避次数、推近开始后几秒；shot：正在演的召龙肩后镜头（跟哪条龙、龙开飞后几秒、召了几秒），
   * w：肩后镜头占几成（拉回时 shot 已清掉，照最后的机位退回来），pos / at：肩后机位和看的点
   */
  const tcam = { look: new THREE.Vector3(), dist: 0, on: false, perfects: 0, kickT: Infinity,
    /** @type {{ f: any, t: number, wait: number } | null} */ shot: null, w: 0, pos: new THREE.Vector3(), at: new THREE.Vector3(), aimed: false };
  /** 试炼里"往前"是哪个方向（trial.update 按它算摇杆和按键）：跟俯视跟随的朝向走，演肩后镜头时不跟着转 */
  const steer = { dir: viewDir(FOLLOW.pitch, FOLLOW.yaw).negate(), getWorldDirection: (/** @type {THREE.Vector3} */ v) => v.copy(steer.dir) };
  /**
   * 试炼的视角（三档，world/trialcam.js VIEWS）：存在这台设备的浏览器里，下次打开还是这一档。
   * dir：肩后、第一人称锁着目标转的"往前"；fromPos / fromLook、sw：切档时从哪个机位滑过来、滑到几成；hid：上一帧藏没藏施法者；
   * low：平视了几成（俯视 0、肩后 / 第一人称 1，切档时慢慢变），太阳和台面反光按它压暗
   */
  const VIEW_KEY = 'yc-view';
  const view = { mode: (() => { try { return readView(localStorage.getItem(VIEW_KEY)); } catch { return readView(null); } })(),
    dir: viewDir(FOLLOW.pitch, FOLLOW.yaw).negate().setY(0).normalize(), fromPos: new THREE.Vector3(), fromLook: new THREE.Vector3(), sw: 1, hid: false,
    low: 0 };
  function cycleView() {
    view.mode = nextView(view.mode);
    try { localStorage.setItem(VIEW_KEY, view.mode); } catch { /* 存不进去就只记在这次打开里 */ }
    view.fromPos.copy(camPos); view.fromLook.copy(camLook); view.sw = 0;
    view.dir.copy(steer.dir).setY(0).normalize();   // 从现在的"往前"开始转向目标，不一下子扭过去
    hud.setView(VIEW_NAMES[view.mode], true);
    sound.play('tick');
  }
  hud.onView = cycleView;
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
    tcam.on = false;   // 试炼的跟随镜头下一帧按新的宽高比重新取景（雾色也跟着重取）
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
  // 试炼要横着玩。手机竖着拿（锁了自动旋转、或苹果锁不了方向）时，把整个游戏区域顺时针转 90°：
  // 左上角钉在屏幕右上角，宽取屏幕的高、高取屏幕的宽；人把手机往左一横就是正的。界面跟着一起转，按钮照常点得到。
  let rotated = false, locked = false, wentFull = false;
  /** 屏幕坐标 → 游戏区域里的坐标（转了 90° 时：区域的 x 轴朝屏幕下方，y 轴朝屏幕左方） @param {number} x @param {number} y */
  function toLocal(x, y) {
    const r = root.getBoundingClientRect();
    return rotated ? { x: y - r.top, y: r.right - x } : { x: x - r.left, y: y - r.top };
  }
  const ROT_KEYS = /** @type {const} */ (['left', 'top', 'right', 'bottom', 'width', 'height', 'transformOrigin', 'transform']);
  const onResize = () => {
    const rot = S.mode === 'trial' && mobile && window.innerHeight > window.innerWidth;
    if (rot) {
      const zoomed = vv && Math.abs(vv.scale - 1) > 0.01;
      const H = Math.round(vv && !zoomed ? vv.height : window.innerHeight), W = window.innerWidth;   // 键盘弹起时（写咒）只用看得见的那段
      Object.assign(root.style, { left: `${W}px`, top: `${Math.round(vv && !zoomed ? vv.offsetTop : 0)}px`, right: 'auto', bottom: 'auto',
        width: `${H}px`, height: `${W}px`, transformOrigin: '0 0', transform: 'rotate(90deg)' });
      rotated = true; vvCovered = false;
      layoutCamera();
      return;
    }
    if (rotated) { for (const k of ROT_KEYS) root.style[k] = ''; rotated = false; }
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
    mode: /** @type {'defense' | 'trial'} */ ('defense'),   // 守关 / 试炼
    phase: 'title', mana: MANA_MAX, core: CORE_HP, gauge: 0,
    /** 气势槽每一格是哪种元素的招加的（完美闪避加的是白格）：召哪条龙看这个（talents.js gaugeDragon） */
    gaugeCols: /** @type {string[]} */ ([]),
    lastCombo: /** @type {{ key: string, streak: number } | null} */ (null), seen: /** @type {string[]} */ ([]),
    said: new Set(), wave: 0, queue: /** @type {string[]} */ ([]), spawnT: 0, spawned: 0, busy: false,
    last: /** @type {any} */ (null),
    endless: false,   // 检查页用：打空了也不判胜
    restT: 0,         // 波与波之间的休息倒计时（游戏时间）
    inv: 0,           // 入侵程度（画面用，见 world/invasion.js）：0 目标图的傍晚，1 全暗
    /** 选的天赋（开局界面上选，默认火冰风：三者之间有两种融合、两种反应） */
    talents: /** @type {string[]} */ (['fire', 'ice', 'wind']),
    /**
     * 给按钮写过的咒：天赋 → 这句话清洗后的意图、名字、原话（重开一局还在，换掉的天赋就丢掉）。
     * auto：试炼里一键把字诀写进还没写过咒的按钮生成的（按钮照常放本命招或换过的招，原话只是「疾·火弹」），新开一局就丢掉
     */
    binds: /** @type {Record<string, { intent: import('./rules/intent.js').Intent, name: string, text: string, auto?: boolean }>} */ ({}),
    /** 试炼这一局拿过的卡（rules/run.js）与合成的加成；守关一直是原值 */
    run: newRun(), mods: runMods(newRun()),
    /** 心法的三个窗口还剩几秒（玩家的时间）：刹那全场慢放、反手下一招加伤、余威龙落地后加伤 */
    slowT: 0, counterT: 0, afterT: 0,
  };
  /** 按游戏时间延后执行（慢放、顿帧时一起变慢） */
  const timers = [];
  const after = (sec, fn) => timers.push({ t: sec, fn });

  /** 咏唱开始（四种施法入口都走这里）：法阵起光，台面阵纹里一道金光扫向阵眼，施法者蓄力 @param {string} el */
  function beginChant(el) {
    fx.beginChant(el);
    sound.play('chant', { el, short: buttonChant });
    layout.plaza.flow();
    caster.charge();
  }

  /**
   * 这一步打的方向（施法者转过去出掌）：有落点用落点，没有就用锁定的第一只
   * @param {{ ids: string[], point: { x: number, z: number } | null } | undefined} res
   */
  const aimOf = (res) => res?.point ?? (res?.ids.length ? enemies.get(res.ids[0])?.pos : null) ?? null;

  function hitCore(dmg) {
    if (S.phase !== 'playing') return;
    S.core = Math.max(0, S.core - dmg);
    hud.setCore(S.core, CORE_HP);
    barrier.hit();
    layout.plaza.hit();
    barrier.setDamage(1 - S.core / CORE_HP);
    fx.shake = Math.max(fx.shake, 0.35);
    layout.crystal.material.emissiveIntensity = 3;
    sound.play('core');
    if (S.core <= 0) {
      S.phase = 'lost';
      barrier.shatter();
      sound.play('lose');
      hud.showOverlay('阵眼破碎', { lead: '傀儡冲破了护山大阵。换个说法再来一次？', main: 'defense', defense: '重新守关', trial: '去试炼',
        report: reportOf('阵眼破碎', false, `守到第 ${S.wave + 1} 波`) });
    }
  }

  /** 清场：敌人、墙、融合、龙、火种与旋风、战报的账、排着的延时、没放出去的按键、对话框（开局、回首页都要） */
  function clearField() {
    enemies.clear();
    if (walls.clear()) enemies.setObstacles([]);
    fusions.clear();
    dragon.clear();
    embers.length = 0;
    gales.length = 0;
    resetTallies();
    timers.length = 0;   // 上一局没跑完的延时（第二步法术、收锁定标记）不能带进新的一局
    if (pend) { clearTimeout(pend.t); pend = null; }
    buttonChant = false; frozen = false;
    hud.closeWrite();
    hud.closePicks();
  }

  /** @param {'defense' | 'trial'} [mode] */
  function startGame(mode = 'defense') {
    preloadFonts(true);   // 开局后把其余一级字也下好，免得冷门字第一次出现时先闪成别的字体
    clearField();
    Object.assign(S, { mode, phase: 'playing', mana: MANA_MAX, core: CORE_HP, gauge: 0, lastCombo: null, seen: [], said: new Set(),
      wave: 0, queue: [], busy: false, restT: 0, inv: 0, run: newRun(), slowT: 0, counterT: 0, afterT: 0 });   // 新的一局天先放晴，再随第一波慢慢压上来
    S.mods = runMods(S.run);
    trial.mods = S.mods;
    barrier.reset();
    S.talents = [...S.talents].sort((a, b) => TALENTS.indexOf(a) - TALENTS.indexOf(b));
    S.binds = Object.fromEntries(Object.entries(S.binds).filter(([k, b]) => S.talents.includes(k) && !b.auto));
    hud.setSkills(S.talents.map((el) => ({ el, ...skillLabel(el) })),
      { cast: pressTalent, pen: openWrite, summon: pressSummon, dash: mode === 'trial' ? () => trial.dash() : undefined });
    hud.setCore(S.core, CORE_HP);
    if (mode === 'trial') trial.prepare();   // 试炼：战前先写咒、试招，点"开战"boss 才出来
    else { trial.stop(); startWave(0); }
    setGauge(0);
    hud.hideOverlay();
    if (mobile) landscape(mode === 'trial');
    onResize();   // 试炼要不要转过来；按钮栏出现后，底下被挡住的高度也变了
    if (mode === 'defense') hud.input.focus();
  }

  /**
   * 手机进试炼时锁横屏：安卓的浏览器要先全屏才锁得了（而且得在点按钮的那一下里调）。锁不了的（苹果、部分内置浏览器）
   * 就靠 onResize 把画面转过来。回守关时解锁、退出全屏。
   * @param {boolean} on
   */
  function landscape(on) {
    const doc = /** @type {any} */ (document), so = /** @type {any} */ (screen.orientation);
    if (!on) {
      if (locked) so?.unlock?.();
      if (wentFull && doc.fullscreenElement) doc.exitFullscreen?.().catch(() => {});
      locked = wentFull = false;
      return;
    }
    if (locked || !so?.lock || !doc.documentElement.requestFullscreen) return;
    // 全屏了却锁不了方向：留着全屏（地址栏收起，转过来的画面也大一些），画面由 onResize 转
    (doc.fullscreenElement ? Promise.resolve() : doc.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => { wentFull = true; }))
      .then(() => so.lock('landscape')).then(() => { locked = true; }).catch(() => {});
  }

  // ---------------------------------------------------------------- 首页与结算页（设计文档第 4 节"首页""结算"）
  /**
   * 本机最佳：存在这台设备的浏览器里（rules/run.js 的 RunRecord），打开页面时读一次，之后以这里为准——
   * 存不进去（无痕窗口、禁了网站存储）也至少这次打开期间记得住。
   */
  const BEST_KEY = 'yc-trial-best';
  let best = (() => { try { return readRecord(localStorage.getItem(BEST_KEY)); } catch { return null; } })();
  /** 这一局记进本机最佳：破了纪录就存下来 @param {import('./rules/run.js').RunRecord} cur @returns {boolean} 破了以前的纪录（第一局不算） */
  function record(cur) {
    if (!beats(cur, best)) return false;
    const had = !!best;
    best = cur;
    try { localStorage.setItem(BEST_KEY, JSON.stringify(cur)); } catch { /* 存不进去就只记在这次打开里 */ }
    return had;
  }

  /** 首页：活的封面（hud.showCover；背后的画面见主循环前的 coverLife）；点了模式再选天赋、开始。试炼主推，排前面 */
  function showTitle() {
    hud.showCover({ best: best ? `本机最佳　${recordText(best)}` : '', modes: {
      trial: { name: '试炼', sub: `${BOSS_COUNT} 个 boss 轮番上阵`,
        desc: `小怪潮与 ${BOSS_COUNT} 个 boss 轮番上阵。开局只会本命招，每过一段三选一学新字，看你能走到哪。（试玩版）` },
      defense: { name: '守关', sub: '五波傀儡攻上山门',
        desc: '傀儡大军沿石阶和索桥攻上山门。打字施法，守住身后的护山大阵。' },
    } }, (mode) => startGame(mode));
  }
  showTitle();

  /** 结算页"回首页"：清场、回到封面（镜头接着摆，法术接着自己放） */
  function backToTitle() {
    clearField();
    trial.stop();
    landscape(false);
    Object.assign(S, { mode: 'defense', phase: 'title', mana: MANA_MAX, core: CORE_HP, gauge: 0, wave: 0, queue: [], busy: false, restT: 0 });
    barrier.reset();
    hud.setCore(S.core, CORE_HP);
    setGauge(0);
    showTitle();
    onResize();
  }

  /** 试炼结算页（won：打通了） @param {boolean} won */
  function trialResult(won) {
    const cur = { stage: won ? RUN_STAGES.length : trial.stage, sec: Math.round(trial.runT) };
    const fresh = record(cur);
    const fell = won ? null : trial.fell();
    const line = `${won ? `${BOSS_COUNT} 个 boss 尽数击碎` : recordText(cur)} · 用时 ${clock(cur.sec)} · 完美闪避 ${trial.perfects} 次`;
    hud.showOverlay(won ? '试炼通过' : '败下阵来', {
      lead: fell ? fell.where : `${BOSS_COUNT} 个 boss 尽数击碎，气血还剩 ${Math.ceil(trial.hp)}。`,
      stats: [{ k: '用时', v: clock(cur.sec) }, { k: '完美闪避', v: `${trial.perfects} 次` }, { k: '发现法术', v: `${S.seen.length} 种` }],
      tip: fell ? `${fell.tip}。` : '', best: best ? recordText(best) : '', fresh,
      main: 'trial', trial: '再战试炼', defense: '去守关', report: reportOf(won ? '试炼通过' : '败下阵来', won, line),
    });
  }
  /** 试炼打通了：最后一个 boss 碎掉，过一会儿出结算页（可以再战或回去守关） */
  function trialWon() {
    S.phase = 'won';
    hud.bigText('试炼通过', '#16202b', 1600);
    sound.play('win');
    after(1.6, () => { if (S.phase === 'won' && S.mode === 'trial') trialResult(true); });
  }
  /** 试炼输了 */
  function trialLost() {
    S.phase = 'lost';
    hud.bigText('败下阵来', '#b3261e', 1400);
    sound.play('lose');
    after(1.4, () => { if (S.phase === 'lost' && S.mode === 'trial') trialResult(false); });
  }

  /**
   * 气势槽：改数、更新界面；满了亮出召唤按钮，过半先把要召的那条龙的模型下好（满几格看 S.mods.ult：拿了心法「龙吟」变少）。
   * 加的格染这一招用到的元素（完美闪避加的是白格），哪种颜色最多，点"召唤"召哪条龙（设计文档第 4 节"五元素龙"）。
   * @param {number} g @param {string | string[]} [el] 新加的格染什么（一串就轮着染）
   */
  function setGauge(g, el = GAUGE_WHITE) {
    const ult = S.mods.ult;
    S.gauge = g;
    S.gaugeCols = gaugeTo(S.gaugeCols, g, el);
    const next = gaugeDragon(S.gaugeCols);
    hud.setGauge(g, ult, S.gaugeCols, SUMMONS[/** @type {keyof typeof SUMMONS} */ (next)].name);
    hud.setSummonReady(g >= ult);
    if (g >= ult / 2) dragon.preload(next);
  }
  /** 这一招用到哪些元素（融合的两种都算），加的气势格染这几种颜色 @param {{ el: string, fusion?: string }[]} steps */
  const stepEls = (steps) => steps.flatMap((s) => (s.fusion ? s.fusion.split('>') : [s.el]));

  // ---------------------------------------------------------------- 试炼的三选一（设计文档第 4 节"试炼模式：一局与奖励"）
  /**
   * 出三张卡，游戏停住（同写咒对话框）；拿一张、或一张不拿换回满气血与法力，之后接着打。
   * @param {boolean} insight 打完 boss 那次：第三张是领悟 @param {() => void} done
   */
  function openPick(insight, done) {
    const ctx = { els: S.talents, insight };
    let cards = offer(S.run, ctx, Math.random);
    S.phase = 'pick'; frozen = true;
    sound.play('pick');
    const show = () => hud.showPicks(cards.map((c) => ({ kind: KIND_NAMES[c.kind], name: c.name + upLabel(S.run, c), text: c.text, el: c.el,
      insight: c.kind === 'insight' })), {
      sub: !cards.length ? '这回没有能学的，回满气血与法力再上'
        : cards.some((c) => c.kind === 'insight') ? '打完 boss：第三张是领悟' : '拿一张；也可以不拿，换回满气血与法力',
      rerolls: S.run.rerolls,
      pick: (i) => {
        const c = cards[i];
        if (!c) return;
        sound.play('take');
        if (c.kind === 'move') { chooseButton(c); return; }
        S.run = takeCard(S.run, c);
        applyMods();
        hud.floatText(hud.root.clientWidth / 2, hud.root.clientHeight * 0.4, `学会「${c.name}」`, '#16202b');
        if (c.kind === 'rune') { chooseRune(c); return; }
        if (c.id === 'slot') for (const el of S.talents) { const l = skillLabel(el); hud.setSkillLabel(el, l.label, l.named); }   // 双诀：按钮上多认一个字
        close();
      },
      reroll: () => {
        const r = rerollCards(S.run, ctx, Math.random, cards);
        if (!r) return;
        S.run = r.run; cards = r.cards;
        sound.play('tick');
        show();
      },
      skip: () => {
        S.run = skipCards(S.run);
        trial.hp = TRIAL.hp; hud.setCore(trial.hp, TRIAL.hp);
        S.mana = MANA_MAX;
        close();
      },
    });
    /** 拿了招式字：选把哪个按钮换掉（卡上写换完是什么招；同一个形态再换进来是升级）；"返回"回到三张卡 @param {import('./rules/run.js').Card} c */
    const chooseButton = (c) => {
      const els = moveTargets(S.run, c, S.talents);
      hud.showPicks(els.map((el) => {
        const now = buttonMove(S.run, el), next = previewMove(S.run, c, el);
        // 弹换成别的：学过的天降、绕后、三颗从此不起作用（换不回弹），写明（10-27 本人要的提醒）
        const lost = next.lost.length ? `。换掉后，${next.lost.join('、')}不再生效` : '';
        return { kind: `${elName(el)}的按钮`, name: next.name, el, insight: false,
          text: next.up ? `「${c.name}」升级：范围 ×${RUN.up}、伤害 ×${RUN.upDmg}`
            : `现在是${moveName(S.run, el, now)}，换成「${c.name}」${lost}` };
      }), {
        title: `把哪个按钮换成「${c.name}」`, sub: '点一下就换好；写过咒的按钮，这个元素的那一步也跟着换', rerolls: null, skipText: '返回',
        pick: (i) => {
          const el = els[i];
          if (!el) return;
          S.run = takeCard(S.run, c, el);
          applyMods();
          const l = skillLabel(el);
          hud.setSkillLabel(el, l.label, l.named);
          hud.floatText(hud.root.clientWidth / 2, hud.root.clientHeight * 0.4, `${elName(el)}的按钮学会「${c.name}」`, '#16202b');
          close();
        },
        reroll: () => {},
        skip: show,
      });
    };
    /**
     * 拿了字诀（已经学会）：选写进哪个按钮——一键加在那句咒的开头（如「疾·怒火炸开」），没写过咒的按钮写成「疾·火弹」；
     * 元素字诀只列那个元素的按钮。卡上写写完是哪句、会不会把原来的字诀挤出槽。也可以先不写，战前点笔自己写。
     * @param {import('./rules/run.js').Card} c
     */
    const chooseRune = (c) => {
      const plans = S.talents.filter((el) => !c.el || el === c.el).map((el) => runePlan(el, c));
      const brief = (/** @type {string} */ t) => ([...t].length > 16 ? `${[...t].slice(0, 15).join('')}…` : t);
      hud.showPicks(plans.map((p) => ({ kind: `${elName(p.el)}的按钮`, name: `${c.name}·${p.base}`, el: p.el, insight: false,
        text: `写成「${brief(p.text)}」${p.out.length ? `；${p.out.join('')}挤出字诀槽` : ''}` })), {
        title: `把「${c.name}」写进哪个按钮`, sub: '写在那句咒的开头；也可以先不写，开战前点按钮上的笔自己写进句子里', rerolls: null, skipText: '先不写',
        pick: (i) => {
          const p = plans[i];
          if (!p) return;
          writeIn(p);
          hud.floatText(hud.root.clientWidth / 2, hud.root.clientHeight * 0.4, `${elName(p.el)}的按钮写进「${c.name}」`, '#16202b');
          close();
        },
        reroll: () => {},
        skip: close,
      });
    };
    const close = () => {
      hud.closePicks();
      frozen = false;
      if (S.phase === 'pick') S.phase = 'playing';
      done();
    };
    show();
  }

  /**
   * 把字诀 c 一键写进 el 的按钮会怎样：写成哪句、挤掉哪几个原来的字诀、卡上怎么叫这个按钮
   * @param {string} el @param {import('./rules/run.js').Card} c
   */
  function runePlan(el, c) {
    // 一键写的（auto）原话是「字诀·…·招名」：后来换过招式字的，招名跟着换成现在的
    const b = S.binds[el], old = b ? (b.auto ? b.text.replace(/[^·]*$/, moveLabel(el)) : b.text) : moveLabel(el);
    const stepEls = (b?.intent ?? defaultIntent(el)).steps.map((s) => s.el);
    // 写之前这句已经认出的字诀（刚学会的这个字原本就写在句子里的不算）：槽满了才会挤掉一个
    const was = runesOf(old, S.run, stepEls).runes.filter((r) => r !== c);
    const text = writeRune(old, c.name, was.length >= runeSlots(S.run));
    const now = runesOf(text, S.run, stepEls).runes;
    return { el, text, out: was.filter((r) => !now.includes(r)).map((r) => `「${r.name}」`), base: b && !b.auto ? b.name : moveLabel(el) };
  }
  /** 照 runePlan 写进去：写过咒的只换原话（意图不变，不用再解析）；没写过的记成一键生成的（auto） @param {{ el: string, text: string }} p */
  function writeIn(p) {
    const b = S.binds[p.el];
    S.binds[p.el] = b && !b.auto ? { ...b, text: p.text } : { intent: defaultIntent(p.el), name: moveLabel(p.el), text: p.text, auto: true };
    const l = skillLabel(p.el);
    hud.setSkillLabel(p.el, l.label, l.named);
  }

  /** 拿了卡：心法的加成写进去（闪避窗口、聚气在试炼里用；召龙要几格换了，气势槽重画） */
  function applyMods() {
    S.mods = runMods(S.run);
    trial.mods = S.mods;
    setGauge(Math.min(S.gauge, S.mods.ult));
  }

  // ---------------------------------------------------------------- 选天赋（封面第二步与结算页上）
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
    sound.play('drums');
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
        sound.play('clear');
        hud.setHint(`喘口气，${REST_SEC} 秒后下一波：${WAVES[S.wave + 1].tip}`);
      } else {
        S.phase = 'won';
        sound.play('win');
        hud.showOverlay('护山大阵守住了', { lead: `五波傀儡尽数退去，阵眼还剩 ${Math.ceil(S.core)} 点。换个说法，再守一次？`,
          main: 'defense', defense: '再守一次', trial: '去试炼',
          report: reportOf('护山大阵守住了', true, `守住 ${WAVES.length} 波 · 阵眼还剩 ${Math.ceil(S.core)}`) });
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
    if (hud.pickOn) {   // 三选一开着：1～3 拿那一张，别的键不管
      const k = '123'.indexOf(e.key);
      if (k >= 0) { e.preventDefault(); hud.pickOn.pick(k); }
      return;
    }
    if (document.activeElement instanceof HTMLInputElement) return;   // 在打字（主输入框或写咒对话框）
    if (S.mode === 'trial' && S.phase === 'playing' && hud.write.hidden) {
      // 试炼：走位、闪避；V 切视角；战前按回车开战。不打字，所以不抢焦点
      if (e.code === 'KeyV' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); cycleView(); return; }
      if (trial.key(e.code, true)) { e.preventDefault(); return; }
      if (e.key === 'Enter' && !trial.fighting) { e.preventDefault(); trial.engage(); return; }
    }
    if (hotkey(e)) return;
    if (S.mode === 'defense' && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && S.phase === 'playing') input.focus();
  };
  const onGlobalKeyUp = (/** @type {KeyboardEvent} */ e) => { trial.key(e.code, false); };
  const onBlur = () => trial.keys.clear();   // 切走窗口时松开的键收不到，免得一直往一个方向走
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onGlobalKey);
  window.addEventListener('keyup', onGlobalKeyUp);
  window.addEventListener('blur', onBlur);
  const startBtn = /** @type {HTMLButtonElement} */ (hud.overlay.querySelector('[data-start]'));
  startBtn.addEventListener('click', () => startGame());
  /** @type {HTMLButtonElement} */ (hud.overlay.querySelector('[data-trial]')).addEventListener('click', () => startGame('trial'));
  /** @type {HTMLButtonElement} */ (hud.overlay.querySelector('[data-home]')).addEventListener('click', backToTitle);
  hud.go.addEventListener('click', () => trial.engage());
  warmUp(opts.parseUrl);   // 玩家看标题的这几秒，把连接先建好

  // ---------------------------------------------------------------- 语音施法：按住说话，松开后识别成文字，再照打字那样施法
  /** 录音与听写；预览页没有麦克风，demo.voice.fake 换成假的 @type {Pick<Recorder, 'start' | 'stop' | 'dispose'> | null} */
  let recorder = Recorder.supported() ? new Recorder() : null;
  /** @param {string} b64 */
  let listen = (b64) => asrRemote(opts.parseUrl, b64, ASR_TIMEOUT_MS);
  /** idle 没在录；wait 等麦克风打开（第一次要授权）；on 按住在录；tap 点一下开始的、再点一下结束；busy 在听写 */
  let mic = /** @type {'idle' | 'wait' | 'on' | 'tap' | 'busy'} */ ('idle'), micPress = 0, micUpEarly = false, micTimer = 0;
  /** 现在能不能开口：守关随时；试炼战前随时，开战后只在气势满了的时候（战中只能开口召龙） */
  const micAllowed = () => !!recorder && S.phase === 'playing' && (S.mode !== 'trial' || !trial.fighting || S.gauge >= S.mods.ult);
  function micReset() {
    clearTimeout(micTimer);
    mic = 'idle';
    hud.setMicState('idle');
    sound.duck(false);
    slowSince = 0;
    fx.setListening(!!input.value.trim());
  }
  /** 大字只用字表里有的（charset.js BIG_CHARS），原因写在提示行 @param {string} why */
  function micFailed(why) { micReset(); hud.bigText('未能成咒', '#5d6b7a', 900); hud.setHint(why); }
  async function micDown() {
    if (mic === 'tap') { micFinish(); return; }
    if (!recorder || mic !== 'idle' || !micAllowed() || S.busy || pend || !hud.write.hidden || hud.pickOn) return;
    mic = 'wait'; micUpEarly = false; micPress = performance.now();
    hud.setMicState('wait');
    slowSince = micPress; slowSpent = false;   // 开口就慢放
    sound.duck(true);                          // 游戏声压低，免得录进爆炸声
    fx.setListening(true);
    try {
      await recorder.start();
    } catch (e) {
      const name = /** @type {{ name?: string }} */ (e)?.name;
      micFailed(name === 'NotAllowedError' || name === 'SecurityError' ? '没有麦克风权限：在浏览器设置里允许本站用麦克风，或者直接打字'
        : name === 'NotFoundError' ? '没找到麦克风，先打字或按按钮' : '麦克风打不开，先打字或按按钮');
      return;
    }
    if (mic !== 'wait' || S.phase !== 'playing') { recorder.stop(); if (mic === 'wait') micReset(); return; }
    // 等了很久才打开：多半是第一次弹了授权框，手指早松开去点"允许"了，这一段不算
    if (micUpEarly && performance.now() - micPress > 800) { recorder.stop(); micReset(); hud.setHint('麦克风已打开，再按住说一次'); return; }
    mic = micUpEarly ? 'tap' : 'on';
    hud.setMicState(mic);
    micTimer = window.setTimeout(micFinish, MAX_SEC * 1000);   // 最长录这么久，到了自动收
  }
  function micUp() {
    if (mic === 'wait') { micUpEarly = true; return; }
    if (mic !== 'on') return;
    if (performance.now() - micPress < 300) { mic = 'tap'; hud.setMicState('tap'); return; }   // 只点了一下：改成再点一下结束
    micFinish();
  }
  async function micFinish() {
    if (!recorder || (mic !== 'on' && mic !== 'tap')) return;
    clearTimeout(micTimer);
    mic = 'busy';
    hud.setMicState('busy');
    sound.duck(false);
    const clip = recorder.stop();
    if (!clip) { micFailed('按住麦克风说一句咒，说完再松开（太短或太小声的不算）'); return; }
    const r = await listen(clip.b64);
    if (mic !== 'busy') return;   // 等的时候这一局结束了
    if ('fail' in r) { micFailed(ASR_FAIL[r.fail] || `听写没成（${r.fail}），再说一次，或者直接打字`); return; }
    micReset();
    submit(r.text, { ms: r.ms });
  }
  if (recorder) hud.setMic({ down: micDown, up: micUp });

  // ---------------------------------------------------------------- 施法
  const groundPt = (pt) => new THREE.Vector3(pt.x, (groundHeightAt(pt.x, pt.z) ?? 0) + 0.4, pt.z);
  let castSeq = 0;

  // ---------------------------------------------------------------- 战报卡的账（ui/report.js）
  // 放出去的每一招（打字、语音、按键、召龙）记一本账：名字、打出了多少伤害。哪一招的账超过了最佳，就在它打中后
  // SHOT_DELAY 秒（游戏时间，等爆炸开到最大）截一张画面，结算时画进战报卡
  /** @typedef {{ name: string, dmg: number }} Tally */
  /** 步骤、召唤 → 这一招的账（召龙、火海、旋风打中时用的是临时的步骤，直接带 tally 字段） @type {WeakMap<object, Tally>} */
  const tallyOf = new WeakMap();
  /** @type {Tally[]} */
  let tallies = [];
  let bestTally = /** @type {Tally | null} */ (null), shotDue = -1, shotTaken = false;
  /** 上一次为哪一招、在它累计多少伤害时排的截图 */
  let shotOf = /** @type {Tally | null} */ (null), shotDmg = 0;
  const SHOT_DELAY = 0.15, SHOT_GROW = 1.5, shotCanvas = document.createElement('canvas');
  /** @param {string} name */
  const newTally = (name) => { const t = { name, dmg: 0 }; tallies.push(t); return t; };
  /** 开新的一局：账清零，旧截图作废 */
  function resetTallies() {
    tallies = []; bestTally = shotOf = null; shotDmg = 0; shotDue = -1; shotTaken = false;
  }
  /** @param {Tally} t @param {number} dmg */
  function addDamage(t, dmg) {
    if (!(dmg > 0) || S.phase !== 'playing') return;
    t.dmg += dmg;
    if (bestTally && t !== bestTally && t.dmg <= bestTally.dmg) return;
    bestTally = t;
    // 同一招接着打（旋风、火海每零点几秒一下）：累计伤害又涨了一半才重截，不然下下都要截一张
    if (t === shotOf && t.dmg < shotDmg * SHOT_GROW) return;
    shotOf = t; shotDmg = t.dmg; shotDue = idleT + SHOT_DELAY;
  }
  /** 刚画完这一帧时调（WebGL 画布只在这一刻还留着画面）：缩到长边 720 存下来 */
  function captureShot() {
    const src = renderer.domElement, w = src.width, h = src.height;
    if (!w || !h) return;
    const k = Math.min(1, 720 / Math.max(w, h));
    shotCanvas.width = Math.round(w * k); shotCanvas.height = Math.round(h * k);
    shotCanvas.getContext('2d')?.drawImage(src, 0, 0, shotCanvas.width, shotCanvas.height);
    shotTaken = true;
  }
  /**
   * 结算页"看战报"要画的那张 @param {string} sub 胜负那行大字 @param {boolean} won @param {string} stats
   * @returns {() => Promise<Blob | null>}
   */
  function reportOf(sub, won, stats) {
    const best = bestTally && bestTally.dmg > 0 ? { ...bestTally } : null, names = topNames(tallies);
    if (!shotTaken) shotDue = idleT;   // 一招也没打中：截下一帧（结算这一刻）的画面
    // 点了才画：结算页开着时不会再截（addDamage 只认 playing），开新的一局会先关掉结算页
    return () => makeReport({ title: '言出法随', sub, won, best, shot: shotTaken ? shotCanvas : null, names, stats });
  }

  /** 墙有几段：升过级的（「墙·二」）按范围倍数加长 @param {{ wide?: number }} s */
  const wallSegments = (s) => Math.round(FORMS.wall.segments * (s.wide ?? 1));

  /**
   * 每一步打谁，在放出之前就定下来：锁定标记亮的就是之后真正打的。
   * @param {{ el: string, form: string, target: string, count: number, wide?: number }[]} steps
   * @param {number} [m] 气势档（范围随气势变大，圈也跟着大）
   */
  function lockSteps(steps, m = 0) {
    const views = enemies.views();
    const resolved = steps.map((s) => resolveTarget(s.target, views, { count: s.count, caster: CASTER_POS, objects: OBJECTS }));
    const marks = steps.map((s, i) => {
      const res = resolved[i], k = (MOMENTUM_RANGE[m] ?? 1) * (s.wide ?? 1);
      const heads = s.form === 'bolt' ? res.ids.slice(0, s.count) : [];
      const ring = !heads.length && res.point
        ? { x: res.point.x, y: groundHeightAt(res.point.x, res.point.z) ?? 0, z: res.point.z,
            r: { bolt: 0.8, burst: FORMS.burst.radius * k, rain: RAIN.spread * k, wall: ((wallSegments(s) - 1) / 2) * WALL.gap + 0.5 }[s.form] ?? 1 }
        : null;
      return { el: s.el, ids: heads, ring };
    });
    return { resolved, marks };
  }

  /** @param {string} text @param {{ ms: number }} [voice] 说出来的（识别成的文字）：ms 是服务器上听写花的毫秒数 */
  async function submit(text, voice) {
    text = [...text.trim()].slice(0, INPUT_MAX_CHARS).join('');
    if (!text || S.busy || S.phase !== 'playing') return;
    text = maskText(text).text;   // 敏感词换成＊：咒语卡上看不到，模型也收不到，其余照常施法
    S.busy = true;
    slowSince = 0; slowSpent = false;
    const t0 = performance.now();
    const castId = ++castSeq;
    beginChant(guessElement(text) || 'arcane');          // 回车 0.1 秒内先给反应
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
    if (voice) source = `语音${voice.ms ? `（听写 ${voice.ms} 毫秒）` : ''} → ${source}`;
    perform(intent, { text, source, ms, raw, castId, voice: !!voice });
  }

  /** 天赋按键放出的法术：每一步的命中记在这里，按打法加气势槽（talents.js buttonGaugeGain） */
  const stepStats = new WeakMap();
  let buttonChant = false;   // 按键的咏唱很短：不慢放、不推镜头

  /**
   * 意图 → 裁决 → 咒语卡 → 放出。打字和天赋按键都走这里。
   * @param {import('./rules/intent.js').Intent} intent
   * @param {{ text: string, source: string, ms: number, raw: any, castId: number, button?: boolean, voice?: boolean }} c voice：说出来的
   */
  function perform(intent, c) {
    const { text, source, ms, raw, castId } = c;
    if (S.phase !== 'playing') { fx.endChant(); caster.endCharge(); buttonChant = false; locks.clear(castId); S.busy = false; return; }
    if (c.voice && trial.fighting && !intent.summon) {   // 试炼开战后只能开口召龙（设计文档第 2 节"试炼模式"）
      fx.endChant(); caster.endCharge(); locks.clear(castId); S.busy = false;
      hud.bigText('未能成咒', '#5d6b7a', 1000);
      hud.setHint(`听到的是「${text}」：开战后开口只能召龙，说一句召龙的话；别的招用按钮放`);
      sound.play('fail');
      return;
    }
    const firstEl = intent.summon && intent.summon !== 'thunder' ? intent.summon : intent.steps[0]?.el;
    if (firstEl) fx.retint(firstEl);
    let plan = planCast(intent, { mana: S.mana, lastCombo: S.lastCombo, seen: S.seen, said: S.said, text: c.button ? '' : text,
      gauge: S.gauge, ult: S.mods.ult, button: !!c.button, fusions: castFusions() });
    // 心法反手、余威：窗口里放出去的这一招加伤（按放出那一刻算，飞到时窗口关了也照样加）；反手只管一招
    const boost = plan.ok ? artBoost({ counter: S.counterT, after: S.afterT }) : null;
    if (boost && boost.k !== 1) {
      plan = boostPlan(plan, boost.k);
      if (boost.counter) S.counterT = 0;
      const tag = [boost.counter ? '反手' : '', boost.after ? '余威' : ''].filter(Boolean).join('·');
      floatAt(new THREE.Vector3(CASTER_POS.x, 2.6, CASTER_POS.z), `${tag} ×${+boost.k.toFixed(2)}`, '#ffd76a');
    }
    S.mana -= plan.cost;
    setGauge(plan.gaugeSpent ? 0 : Math.min(S.mods.ult, S.gauge + plan.gaugeGain), stepEls(plan.steps));
    if (intent.summon) dragon.preload(intent.summon);
    S.lastCombo = plan.lastCombo;
    S.seen.push(...plan.newlySeen);
    if (plan.saidKey) S.said.add(plan.saidKey);
    S.last = { text, source, ms, raw, plan };
    // 融合了、而名字只是按步骤自动拼的（模型没起名），就用融合的名字（"火卷风"而不是"风弹·火弹"）
    const fused = plan.steps.find((s) => s.fusion);
    const autoNamed = !intent.name || intent.name === defaultName(intent.steps);
    const name = fused && autoNamed ? /** @type {string} */ (fused.fusionName) : intent.name || (plan.ok ? defaultName(plan.steps) : '');
    // 试炼开战后不出咒语卡：顶上是 boss 血条，眼睛要看地上（开口召的龙另有"××现世"的大字）
    if (!(trial.fighting && (c.button || c.voice))) hud.showCard({ name, text, plan, intent, source, ms });
    if (plan.backlash) { fx.backlash(); hud.bigText('天道不允', '#b3261e', 1300); }
    fx.endChant();
    buttonChant = false;
    if (!plan.ok) {
      locks.clear(castId);
      caster.endCharge();
      if (!plan.backlash) { hud.bigText(intent.steps.length ? '法力不足' : '未能成咒', '#5d6b7a', 1000); sound.play('fail'); }
      S.busy = false;
      return;
    }
    const tally = newTally(name || plan.summon?.name || '无名');   // 战报卡的账：之后这一招每打中一下都记上
    for (const s of plan.steps) tallyOf.set(s, tally);
    if (plan.summon) tallyOf.set(plan.summon, tally);
    const m = plan.momentum;
    if (!c.button) { if (m >= 3) sound.play('surge'); else sound.play('card'); }   // 开口念成的咒"叮"一声；气势如虹换成锣鼓
    if (plan.summon?.cast) {
      caster.cast(null);
      runSummon(plan.summon, castId);
      S.busy = false;
      return;
    }
    if (c.button) {
      // 按键：打中几个、有没有打出融合或反应，边打边加气势槽（融合在放出时就算）
      const stats = { hits: new Set(), combo: plan.steps.some((s) => s.fusion), awarded: 0, els: stepEls(plan.steps) };
      for (const s of plan.steps) stepStats.set(s, stats);
      awardButton(stats);
    }
    if (plan.steps.some((s) => s.runes?.includes('zhong'))) trial.lockDash(RUN.runes.zhong.lock);   // 字诀「重」：放完一会儿不能闪避
    const { resolved, marks } = lockSteps(plan.steps, m);
    locks.show(castId, marks);
    fx.launchBurst(plan.steps[0].el);
    caster.cast(aimOf(resolved[0]));
    const go = () => {
      plan.steps.forEach((step, i) => after(i * 0.45, () => runStep(step, resolved[i], m)));
      after((plan.steps.length - 1) * 0.45 + 1.2, () => locks.clear(castId));
      // 字诀「连」：最后一步放出 lian.sec 秒后，带「连」的几步再放一次
      const again = plan.steps.filter((s) => s.runes?.includes('lian'));
      if (again.length) after((plan.steps.length - 1) * 0.45 + RUN.runes.lian.sec, () => castAgain(again, m));
    };
    if (plan.summon?.ghost) {
      // 差一口气：龙影升起、散开，再落雨
      hud.bigText('差一口气', '#2f5d8a', 1200);
      sound.play('ghost');
      dragon.ghost(plan.summon.el, go);
    } else go();
    if (m >= 3 && !c.button) hud.bigText('气势如虹', '#16202b', 900);
    S.busy = false;
  }

  /**
   * 字诀「连」再放一次：伤害 × lian.mult、不花法力、不会再连；打谁这时重新定（第一次可能已经打死了）。按键的命中照样攒气势
   * @param {import('./rules/arbiter.js').PlannedStep[]} steps @param {number} m
   */
  function castAgain(steps, m) {
    if (S.phase !== 'playing') return;
    const half = boostPlan({ steps }, RUN.runes.lian.mult).steps;
    half.forEach((s, i) => {
      const st = stepStats.get(steps[i]), t = tallyOf.get(steps[i]);
      if (st) stepStats.set(s, st);
      if (t) tallyOf.set(s, t);   // 再放的这一下记在原来那一招的账上
    });
    const castId = ++castSeq;
    const { resolved, marks } = lockSteps(half, m);
    locks.show(castId, marks);
    caster.cast(aimOf(resolved[0]));
    floatAt(new THREE.Vector3(CASTER_POS.x, 2.6, CASTER_POS.z), '连', '#2a8a7a');
    fx.launchBurst(half[0].el);
    half.forEach((step, i) => after(i * 0.45, () => runStep(step, resolved[i], m)));
    after((half.length - 1) * 0.45 + 1.2, () => locks.clear(castId));
  }

  // ---------------------------------------------------------------- 天赋按键（设计文档第 4 节"天赋与按键"）
  /** 按键的这一招打出了新的命中或反应：补上该加的气势 @param {{ hits: Set<string>, combo: boolean, awarded: number, els: string[] }} st */
  function awardButton(st) {
    const g = buttonGaugeGain({ hits: st.hits.size, combo: st.combo });
    if (g <= st.awarded || S.phase !== 'playing') return;
    setGauge(Math.min(S.mods.ult, S.gauge + g - st.awarded), st.els);
    st.awarded = g;
  }

  /** @param {string} el */
  const buttonIntent = (el) => trialLimit(S.binds[el]?.intent ?? defaultIntent(el), el, S.binds[el]?.text ?? '');
  /**
   * 试炼里按钮只放学会了的招（run.js limitToLearned），再认写进这句咒的字诀（applyRunes）；守关全开、不认字诀
   * @param {import('./rules/intent.js').Intent} it @param {string} el @param {string} text 写进按钮的原话
   */
  const trialLimit = (it, el, text) => (S.mode === 'trial' ? applyRunes(limitToLearned(it, S.run, el), S.run, text) : it);
  /** 这个按钮认出的字诀（卡的 id） @param {string} el @returns {string[]} */
  const buttonRunes = (el) => [...new Set(buttonIntent(el).steps.flatMap((s) => s.runes ?? []))];
  /** 能合成哪些融合：试炼里只有领悟了的合字，守关按默认全开 */
  const castFusions = () => (S.mode === 'trial' ? runFusions(S.run) : undefined);
  /** 按钮现在的招叫什么（试炼里换过招式字的，如「火爆」） @param {string} el */
  const moveLabel = (el) => elName(el) + FORMS[buttonMove(S.run, el).form].name;
  /**
   * 按钮上写什么：写过咒的写咒语名；试炼里换过招式字的写现在的招（如「火爆」）；都没有就是元素名。
   * 试炼里认出了字诀，后面带上（如「火弹·疾」）
   * @param {string} el @returns {{ label: string, named: boolean }}
   */
  function skillLabel(el) {
    const b = S.binds[el];
    const tag = S.mode === 'trial' ? (buttonIntent(el).runes ?? []).map((r) => r.ch).join('') : '';
    const plus = tag ? `·${tag}` : '';
    if (b && !b.auto) return { label: b.name + plus, named: true };
    if (S.mode === 'trial' && (S.run.moves[el] || tag)) return { label: moveLabel(el) + plus, named: true };
    return { label: elName(el), named: false };
  }
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
    // 咏唱多久看先按的这个按钮：字诀「疾」快、「重」慢（守关不认字诀）
    const ms = S.mode === 'trial' ? runeChantMs(buttonRunes(el)) : BUTTON_CHANT_MS;
    pend = { els: [el], castId, t: window.setTimeout(fireButtons, ms) };
    hud.setCharging(pend.els);
    buttonChant = true;
    beginChant(el);
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

  /** 气势满了点"召唤"：召气势槽里颜色最多的那条龙（gaugeDragon），按气势 0 档召（开口召的吃那句话的气势，更猛） */
  function pressSummon() {
    if (S.phase !== 'playing' || S.busy || pend || S.gauge < S.mods.ult || !hud.write.hidden) return;
    S.busy = true;
    buttonChant = true;
    const el = /** @type {keyof typeof SUMMONS} */ (gaugeDragon(S.gaugeCols));
    beginChant(el);
    const intent = { steps: [], momentum: 0, name: SUMMONS[el].name, unknown: [], overreach: false, notes: [], summon: el };
    perform(intent, { text: '按键 · 召唤', source: '天赋按键', ms: 0, raw: null, castId: ++castSeq, button: true });
  }

  // 给按钮写咒：对话框开着时游戏暂停（写咒不限时）；写好的这句解析后装进按钮
  let frozen = false;
  /** @param {string} el */
  function openWrite(el) {
    if (!(S.phase === 'playing' || S.phase === 'rest') || pend || trial.fighting) return;   // 试炼只能战前写咒
    frozen = true;
    const close = () => { hud.closeWrite(); frozen = false; };
    hud.openWrite(elName(el), el, {
      ok: (t) => bindButton(el, t, close),
      cancel: close,
      reset: () => { delete S.binds[el]; const l = skillLabel(el); hud.setSkillLabel(el, l.label, l.named); close(); },
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
    const l = skillLabel(el);
    hud.setSkillLabel(el, l.label, l.named);
    close();
    // 预览：这一招每次放要花多少、气势几档（不扣法力）；试炼里没学会的字标灰、按现在会的放，认出的字诀加下划线
    const shown = trialLimit(r.intent, el, text);
    const plan = planCast(shown, { mana: MANA_MAX, seen: S.seen, text: '', button: true, fusions: castFusions() });
    hud.showCard({ name, text, plan, intent: shown, source: `${fromModel ? '模型解析' : '关键词解析'} · 装进「${elName(el)}」的按钮`, ms: 0 });
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
    // 试炼里学会了字诀：没用上的句子在句首轮着加一个（写进按钮的咒才生效，灵感要带上）
    const runes = S.mode === 'trial' ? RUNES.filter((c) => level(S.run, c.id) > 0 && (!c.el || c.el === el)) : [];
    const withRune = (/** @type {string} */ t, /** @type {number} */ i) => (runes.length && !runes.some((c) => t.includes(c.name))
      ? `${runes[i % runes.length].name}·${t}` : t);
    const ideas = lines.length ? lines.map((text, i) => ({ text: withRune(text, i), from: '模型现写' }))
      : scrollsFor(el, S.talents, 3, from).map((text, i) => ({ text: withRune(text, i), from: '卷轴' }));
    hud.setWriteIdeas(ideas);
  }
  /** @type {Record<string, number>} */
  const scrollTurn = {};

  /** 召唤时那行大字的颜色 */
  const SUMMON_INK = { ice: '#1f5f9a', fire: '#b5481c', thunder: '#9a7410', wind: '#1f7a5a', earth: '#7a5428' };

  /**
   * 真召唤：龙照自己的一套动作飞（fx/dragon.js flightPlan），砸中、劈雷时在这里结算（设计文档第 4 节"五元素龙"）：
   *   - 冰、火、土：落下（土龙是从地里钻出来）那一下，范围内每个敌人按"从天而降"吃一下（盾挡不住）；
   *     火龙再留一片火海，土龙把范围里的小怪顶起来、在钻出来的地方围一圈土墙；
   *   - 风：不砸，卷起旋风——几秒里一下下割、把小怪往中心卷，顺带吹散 boss 的冰锥；
   *   - 雷：不砸，绕圈时劈五道雷，轮着劈锁定的那几只，每道连锁比平常多跳一下，劈过的冰锥全碎。
   * 气势、首次发现的加成（sm.dmg 比表里的 dmg 大多少）按同样的比例乘到火海、旋风、雷上。
   * 试炼里领悟了"怎么召"（设计文档第 4 节"领悟"）：
   *   - 双龙：第二条晚 twin.delay 秒出，扑离第一条落点够远的另一群（twinTarget），没有就在同一处再砸一下；两条各打满额（10-28 本人定）；
   *   - 护身：龙不扑出去，绕着人转（guardDragons）；两张都拿了就两条一里一外反着转。
   * @param {import('./rules/arbiter.js').SummonPlan} sm
   * @param {number} castId
   */
  function runSummon(sm, castId) {
    const views = enemies.views();
    const res = resolveTarget(sm.target, views, { count: 3, caster: CASTER_POS, objects: OBJECTS });
    const el = /** @type {keyof typeof SUMMONS} */ (sm.el), k = sm.dmg / SUMMONS[el].dmg;
    const twin = S.mods.twin, guard = S.mods.guard && S.mode === 'trial';
    hud.bigText(`${sm.name}现世`, SUMMON_INK[el] ?? SUMMON_INK.ice, 1400);
    fx.launchBurst(el);
    sound.play('dragon', { el });
    if (twin || guard) floatAt(new THREE.Vector3(CASTER_POS.x, 3.1, CASTER_POS.z), twin && guard ? '双龙·护身' : twin ? '双龙' : '护身', '#ffd76a');
    if (guard) { guardDragons(sm, el, twin); return; }
    flyAt(sm, el, k, res, castId);
    if (S.mode === 'trial' && trial.on) tcam.shot = { f: dragon.flights[dragon.flights.length - 1], t: 0, wait: 0 };   // 大招镜头：推到肩后看龙飞出去
    if (!twin) return;
    const other = twinTarget(res.point ?? DEFAULT_AIM, views, { apart: RUN.dragon.twin.apart, count: 3 });
    after(RUN.dragon.twin.delay, () => { if (S.phase === 'playing') flyAt(sm, el, k, other.point ? other : res, ++castSeq); });
  }

  /** 地面上的一点 @param {number} x @param {number} z */
  const atGround = (x, z) => new THREE.Vector3(x, groundHeightAt(x, z) ?? 0, z);

  /**
   * 一条龙扑一群（res：锁定的几只与落点），砸中、劈雷时结算（runSummon 的说明）
   * @param {import('./rules/arbiter.js').SummonPlan} sm @param {keyof typeof SUMMONS} el @param {number} k 加成倍数
   * @param {{ ids: string[], point: { x: number, z: number } | null }} res @param {number} castId
   */
  function flyAt(sm, el, k, res, castId) {
    const pt = res.point ?? { x: DEFAULT_AIM.x, z: DEFAULT_AIM.z };
    // 龙要飞五六秒，锁定的几只一直在走：落点跟着它们（还活着的几只的中心）走；全死了就砸最后看到的位置
    const ids = res.ids;
    const follow = () => {
      const live = ids.map((id) => enemies.get(id)).filter(Boolean);
      if (!live.length) return null;
      return atGround(live.reduce((a, e) => a + e.pos.x, 0) / live.length, live.reduce((a, e) => a + e.pos.z, 0) / live.length);
    };
    const T = atGround(pt.x, pt.z);
    locks.show(castId, [{ el, ids, ring: ids.length ? null : { x: pt.x, y: T.y, z: pt.z, r: sm.radius } }]);
    const tally = tallyOf.get(sm);   // 战报卡的账：砸中、火海、旋风、劈雷都记在这一招上
    const impact = (/** @type {THREE.Vector3} */ p) => {
      locks.clear(castId);
      if (S.phase !== 'playing') return;
      if (el === 'wind') gale(p, sm.radius, k, tally);
      else if (el !== 'thunder') {
        for (const e of [...enemies.list]) {
          if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > sm.radius) continue;
          hitEnemy(e, { el, tally }, sm.dmg, p, { fromAbove: true });
          if (el === 'earth') enemies.fling(e, (Math.random() - 0.5) * 2, 7, (Math.random() - 0.5) * 2);   // 顶飞，落回圈里
        }
        if (el === 'fire') fireSea(p, sm.radius * 0.8, k, tally);
        if (el === 'earth') earthRing(p);
      }
      dragonLanded();
    };
    const strike = (/** @type {THREE.Vector3} */ from, /** @type {number} */ i) => dragonStrike(from, i, ids, follow() ?? T, SUMMONS.thunder.strike * k, tally);
    dragon.summon(T, el, { impact, strike: el === 'thunder' ? strike : undefined }, ids.length ? follow : undefined);
  }

  /** 龙落地（护身是转完）：心法余威开窗口，之后一段时间所有招加伤 */
  function dragonLanded() {
    if (!S.mods.yuwei || S.phase !== 'playing') return;
    S.afterT = RUN.arts.after.sec;
    floatAt(new THREE.Vector3(CASTER_POS.x, 2.6, CASTER_POS.z), '余威', '#ffd76a');
  }

  /**
   * 领悟「护身」：龙绕着人转（fx/dragon.js guardPlan），人走圈跟着走。转的时候每帧看龙身中线上贴地的那几段（离地 2.6 米以内）：
   * 两侧 block 米内的冰锥打碎（trial.shatter）；碰到的敌人（reach 米加身宽）挨这条龙伤害的 touch 倍、吃它的元素效果，
   * 同一只每 every 秒最多挨一下（两条护身共用这份计时）。转完算龙落地（余威）。
   * @param {import('./rules/arbiter.js').SummonPlan} sm @param {keyof typeof SUMMONS} el @param {boolean} twin 两条：外圈那条反着转
   */
  function guardDragons(sm, el, twin) {
    const G = RUN.dragon.guard, tally = tallyOf.get(sm);
    const me = () => atGround(trial.p.x, trial.p.z);
    /** @type {Map<string, number>} 敌人 → 到几秒（clock）才能再挨 */
    const next = new Map();
    let clock = 0;
    const rings = [{ r: G.r, h: G.h, dir: 1 }];
    if (twin) rings.push({ r: G.r + G.outer.dr, h: G.h + G.outer.dh, dir: -1 });
    rings.forEach((g, ri) => {
      const tick = (/** @type {THREE.Vector3[]} */ spine, /** @type {number} */ dt) => {
        if (ri === 0) clock += dt;   // 只让第一条走钟，两条一起走就快了一倍
        if (S.phase !== 'playing') return;
        const y0 = me().y;
        for (let i = 0; i + 1 < spine.length; i++) {
          const a = spine[i], b = spine[i + 1];
          if (Math.min(a.y, b.y) < y0 - 0.3 || Math.max(a.y, b.y) > y0 + 2.6) continue;   // 还在地里、或已经飞高了
          trial.shatter(a, b, G.block);
          for (const e of [...enemies.list]) {
            if ((next.get(e.id) ?? 0) > clock || distToSegment(e.pos, a, b) > G.reach + trial.bodyR(e)) continue;
            next.set(e.id, clock + G.every);
            hitEnemy(e, { el, tally }, sm.dmg * G.touch, a.clone().setY(e.pos.y), {});
          }
        }
      };
      dragon.summon(me(), el, { impact: dragonLanded, tick }, me, { ...g, speed: G.speed, sec: G.sec });
    });
  }

  /**
   * 火龙落下的火海：和字诀「燎」的地火一样每 tick 秒烧一下，只是大、烧得久
   * @param {THREE.Vector3} p @param {number} r @param {number} k @param {Tally} [tally] 烧的伤害记在哪一招的账上
   */
  function fireSea(p, r, k, tally) {
    const { sec, dps } = SUMMONS.fire.sea, tick = RUN.runes.liao.tick;
    embers.push({ p: p.clone(), r, t: sec, tick, dmg: dps * tick * k, src: { el: 'fire', tally } });
    fx.groundFire(p, r, sec);
  }

  /**
   * 土龙钻出来的地方围一圈土墙（一段一个点，各自顺着圈的切线立），把圈里的困住；
   * 落在柱子、石兽、香炉、石灯上，或者悬空的那几段不立。
   * @param {THREE.Vector3} p
   */
  function earthRing(p) {
    const { ring: R, wallSec } = SUMMONS.earth, n = Math.round((2 * Math.PI * R) / WALL.gap), pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, x = p.x + Math.cos(a) * R, z = p.z + Math.sin(a) * R;
      if (groundHeightAt(x, z) === null || OBSTACLES.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 0.5)) continue;
      pts.push({ x, z, yaw: Math.atan2(-Math.sin(a), Math.cos(a)) + Math.PI / 2 });
    }
    if (!pts.length) return;
    walls.add('earth', pts, 0, wallSec, { el: 'earth' });
    enemies.setObstacles(walls.obstacles());
  }

  /**
   * 风龙卷起的旋风：中心、半径、还剩几秒、离下一下还有几秒、每下多疼、打中时当哪一步（带着战报卡的账）
   * @type {{ p: THREE.Vector3, r: number, t: number, tick: number, dmg: number, src: { el: string, tally?: Tally } }[]}
   */
  const gales = [];
  const GALE_TICK = 0.25;
  /** @param {THREE.Vector3} p @param {number} r @param {number} k @param {Tally} [tally] */
  function gale(p, r, k, tally) {
    const { sec, total } = SUMMONS.wind;
    gales.push({ p: p.clone(), r, t: sec, tick: 0, dmg: (total * k * GALE_TICK) / sec, src: { el: 'wind', tally } });
    fusions.gale(p, r, sec);
    if (S.mode === 'trial') {   // 风一起，boss 射出来的冰锥全吹散
      const n = trial.shatter(p, p, 999);
      if (n) floatAt(p.clone().setY(p.y + 1.5), `吹散冰锥 ×${n}`, '#2fbf86');
    }
  }
  /** 每帧：旋风里的每 GALE_TICK 秒割一下，小怪往中心卷、绕着转（boss 卷不动，照样挨割）；新飞进来的冰锥也吹散 @param {number} dt */
  function updateGales(dt) {
    for (let i = gales.length - 1; i >= 0; i--) {
      const g = gales[i];
      g.t -= dt; g.tick -= dt;
      if (g.tick <= 0) {
        g.tick += GALE_TICK;
        for (const e of [...enemies.list]) {
          const dx = g.p.x - e.pos.x, dz = g.p.z - e.pos.z, d = Math.hypot(dx, dz);
          if (d > g.r + (e.mode === 'boss' ? 1 : 0)) continue;
          hitEnemy(e, g.src, g.dmg, g.p, {});
          const ux = dx / (d || 1), uz = dz / (d || 1), pull = Math.min(d, 2.5) * 1.6;
          enemies.fling(e, ux * pull - uz * 4, 2.5, uz * pull + ux * 4);
        }
        if (S.mode === 'trial') trial.shatter(g.p, g.p, g.r * 1.5);
      }
      if (g.t <= 0) gales.splice(i, 1);
    }
  }

  /**
   * 雷龙劈的第 i 道雷：轮着劈锁定的那几只（死了的跳过），都没了就劈离目标最近的（10 米外的不劈，打在地上）；
   * 从龙嘴劈下去，从天而降、盾挡不住，连锁一共跳 SUMMONS.thunder.jumps 下（平常是 ELEMENTS.thunder.chain.jumps），劈过的地方冰锥全碎。
   * @param {THREE.Vector3} from @param {number} i @param {string[]} ids @param {THREE.Vector3} T @param {number} dmg @param {Tally} [tally]
   */
  function dragonStrike(from, i, ids, T, dmg, tally) {
    if (S.phase !== 'playing') return;
    const live = ids.map((id) => enemies.get(id)).filter(Boolean);
    let e = live.length ? live[i % live.length] : nearest(T);
    if (e && !live.length && Math.hypot(e.pos.x - T.x, e.pos.z - T.z) > 10) e = null;
    const to = e ? enemies.aimPoint(e).clone() : T.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4));
    fx.arc(from, to, { forks: 2 });
    fx.burst(to, 'thunder', 1.4, 0.6);
    fx.shake = Math.max(fx.shake, 0.2);
    zapShards(from, to, SUMMONS.thunder.clear);   // 和字诀「引」一样，劈过的地方冰锥全碎，只是宽得多
    if (e) hitEnemy(e, { el: 'thunder', extraJumps: SUMMONS.thunder.jumps - ELEMENTS.thunder.chain.jumps, tally }, dmg, from, { fromAbove: true });
  }

  /**
   * 放一发：别的元素是飞弹；雷不飞，是一道闪电——直线就从施法者手上劈过去，从天而降就从头顶劈下来
   * （绕到背后的仍是一颗电球绕过去）。落点与命中结算和飞弹一样走 onHit。
   * shatter：带着字诀「引」，闪电劈过的地方冰锥全碎
   * @param {{ el: string, path: string, delay?: number, target: () => THREE.Vector3, onHit: (p: THREE.Vector3) => void, big?: boolean,
   *           shatter?: boolean }} o
   */
  function shoot(o) {
    if (o.el !== 'thunder' || o.path === 'behind') { fx.bolt(o); return; }
    after(o.delay || 0, () => {
      if (S.phase !== 'playing') return;
      const end = o.target().clone();
      const from = o.path === 'sky' ? end.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 15, 1.5)) : origin.clone();
      fx.arc(from, end);
      if (o.shatter) zapShards(from, end);
      o.onHit(end);
    });
  }

  /** 字诀「引」：一道闪电从 a 劈到 b，两侧 r 米内的冰锥全碎（试炼），碎了几颗飘在落点上 @param {THREE.Vector3} a @param {THREE.Vector3} b */
  function zapShards(a, b, r = RUN.runes.yin.r) {
    if (S.mode !== 'trial') return;
    const n = trial.shatter(a, b, r);
    if (n) floatAt(b.clone().setY(b.y + 1.2), `碎冰锥 ×${n}`, '#e0a816');
  }

  /** 离 p 最近的敌人（广场不大，不设上限） @param {{ x: number, z: number }} p */
  function nearest(p) {
    let best = null, d = Infinity;
    for (const e of enemies.list) { const k = (e.pos.x - p.x) ** 2 + (e.pos.z - p.z) ** 2; if (k < d) { d = k; best = e; } }
    return best;
  }

  /**
   * 字诀「随」：盯住一只敌人，它倒了就改盯离上次位置最近的；返回此刻该落的地面点（都没了就停在最后看到的地方）
   * @param {string | null} id @param {THREE.Vector3} at
   */
  function follow(id, at) {
    const p = at.clone();
    return () => {
      let e = id ? enemies.get(id) : null;
      if (!e) { e = nearest(p); id = e ? e.id : null; }
      if (e) p.copy(groundPt(e.pos));
      return p;
    };
  }

  /**
   * 字诀「燎」落地留的火：地面上的点、半径、还剩几秒、离下一次烧还有几秒、每次烧多疼、烧到时当哪一步（带着战报卡的账）
   * @type {{ p: THREE.Vector3, r: number, t: number, tick: number, dmg: number, src: { el: string, tally?: Tally } }[]}
   */
  const embers = [];
  /** @param {THREE.Vector3} p @param {number} r @param {number} dmg @param {Tally} [tally] */
  function leaveFire(p, r, dmg, tally) {
    const L = RUN.runes.liao;
    if (embers.length >= L.max) return;   // 一场火雨就是六片，再多不留
    const at = new THREE.Vector3(p.x, groundHeightAt(p.x, p.z) ?? 0, p.z);
    embers.push({ p: at, r, t: L.sec, tick: L.tick, dmg, src: { el: 'fire', tally } });
    fx.groundFire(at, r, L.sec);
  }
  /** 每帧：地火里的敌人每 tick 秒烧一下（boss 身子大，碰到火边就算；火照样削冰甲） @param {number} dt */
  function updateEmbers(dt) {
    const L = RUN.runes.liao;
    for (let i = embers.length - 1; i >= 0; i--) {
      const f = embers[i];
      f.t -= dt; f.tick -= dt;
      if (f.tick <= 0) {
        f.tick += L.tick;
        for (const e of [...enemies.list]) {
          if (Math.hypot(e.pos.x - f.p.x, e.pos.z - f.p.z) <= f.r + (e.mode === 'boss' ? 1 : 0)) hitEnemy(e, f.src, f.dmg, f.p, {});
        }
      }
      if (f.t <= 0) embers.splice(i, 1);
    }
  }

  /**
   * 字诀「回」：风从落点飞回施法者手上；到手时，飞回来那条路两侧 hui.r 米内的敌人再挨一下（伤害 × hui.mult），往外推
   * @param {any} step @param {THREE.Vector3} from
   */
  function windBack(step, from) {
    if (S.phase !== 'playing') return;
    const H = RUN.runes.hui, a = from.clone().setY(from.y + 0.6);
    fx.bolt({ el: step.el, path: 'straight', from: a, target: () => origin,
      onHit: () => {
        if (S.phase !== 'playing') return;
        for (const e of [...enemies.list]) if (distToSegment(e.pos, a, CASTER_POS) <= H.r) hitEnemy(e, step, step.dmgEach * H.mult, CASTER_POS, {});
      } });
  }

  /**
   * @param {import('./rules/arbiter.js').PlannedStep} step
   * @param {{ ids: string[], point: { x: number, z: number } | null }} res 施法时就定好的目标（与锁定标记一致）
   * @param {number} [m] 气势档：范围 × MOMENTUM_RANGE，特效 × MOMENTUM_FX，第 3 档每次命中加顿帧
   */
  function runStep(step, res, m = 0) {
    if (S.phase !== 'playing') return;
    if (step.fusion) { runFusion(step, res); return; }
    const range = (MOMENTUM_RANGE[m] ?? 1) * (step.wide ?? 1), big = MOMENTUM_FX[m] ?? 1;   // wide：试炼里升过级的招式字
    const boom = (p, R, scale) => { fx.burst(p, step.el, R, scale * big); if (m >= 3) fx.hitStop = Math.max(fx.hitStop, 0.12); };
    const dir = { fromAbove: step.path === 'sky', fromBehind: step.path === 'behind' };
    // 试炼里写进按钮的字诀（run.js applyRunes）：随——追着打；引——闪电劈碎冰锥；燎——落地留火；回——风飞回手上再打一下
    const rs = step.runes ?? [], sui = rs.includes('sui'), shatter = rs.includes('yin'), hui = rs.includes('hui');
    const burn = (/** @type {THREE.Vector3} */ p, /** @type {number} */ r) => { if (rs.includes('liao')) leaveFire(p, r, step.dmgEach * RUN.runes.liao.k, tallyOf.get(step)); };
    if (step.form === 'bolt') {
      for (let i = 0; i < step.count; i++) {
        let id = res.ids.length ? res.ids[i % res.ids.length] : null;
        let last = res.point ? groundPt(res.point) : DEFAULT_AIM.clone();
        shoot({
          el: step.el, path: step.path, delay: i * 0.14, big: m >= 2, shatter,
          target: () => {
            let e = id ? enemies.get(id) : null;
            if (!e && sui) { e = nearest(last); id = e ? e.id : null; }   // 目标倒了，改追离落点最近的
            if (e) enemies.aimPoint(e, last);
            return last;
          },
          onHit: (p) => {
            boom(p, 1.3, 0.45);
            const e = id ? enemies.get(id) : null;
            if (e) hitEnemy(e, step, step.dmgEach, CASTER_POS, dir);
            burn(p, RUN.runes.liao.r);
            if (hui) windBack(step, p);
          },
        });
      }
    } else if (step.form === 'rain') {
      // 雨：2 秒里从天上落 6 次，落点撒在目标周围；从天而降，盾傀儡挡不住（「随」：落点围着目标现在的位置撒）
      const c = res.point ? groundPt(res.point) : DEFAULT_AIM.clone();
      const center = sui ? follow(res.ids[0] ?? null, c) : () => c;
      for (let i = 0; i < FORMS.rain.hits; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * RAIN.spread * range, ox = Math.cos(a) * r, oz = Math.sin(a) * r;
        let tp = groundPt({ x: c.x + ox, z: c.z + oz });
        shoot({
          el: step.el, path: 'sky', delay: (i * FORMS.rain.sec) / FORMS.rain.hits, shatter,
          target: () => { if (sui) { const q = center(); tp = groundPt({ x: q.x + ox, z: q.z + oz }); } return tp; },
          onHit: (p) => {
            boom(p, RAIN.hitR * range, 0.4);
            for (const e of [...enemies.list]) {
              if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= RAIN.hitR * range) hitEnemy(e, step, step.dmgEach, p, { fromAbove: true });
            }
            burn(p, RAIN.hitR * range * 0.6);
          },
        });
      }
      if (hui) after(FORMS.rain.sec + 0.3, () => windBack(step, center()));
    } else if (step.form === 'wall') {
      raiseWall(step, res);
    } else {
      const pt = res.point ? groundPt(res.point) : DEFAULT_AIM.clone();
      const aim = sui ? follow(res.ids[0] ?? null, pt) : () => pt;
      const R = FORMS.burst.radius * range;
      shoot({
        el: step.el, path: 'straight', big: true, target: aim, shatter,
        onHit: (p) => {
          boom(p, R, 1);
          for (const e of [...enemies.list]) {
            if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= R) hitEnemy(e, step, step.dmgEach, p, {});
          }
          burn(p, R * 0.5);
          if (hui) windBack(step, p);
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
      // 打的是敌人：墙立在它前面 2 米（挡在它和阵眼之间；试炼里挡在它和自己之间），而不是砸在它身上
      const guard = S.mode === 'trial' ? CASTER_POS : CORE_POS;
      const tx = guard.x - c.x, tz = guard.z - c.z, tl = Math.hypot(tx, tz) || 1;
      const off = S.mode === 'trial' ? Math.min(2, Math.max(0, tl - 1.8)) : Math.min(2, tl - 3);
      c = { x: c.x + (tx / tl) * off, z: c.z + (tz / tl) * off };
    }
    let dx = c.x - CASTER_POS.x, dz = c.z - CASTER_POS.z, len = Math.hypot(dx, dz);
    if (len < 2.2) { c = { x: CASTER_POS.x, z: CASTER_POS.z - 2.6 }; dx = 0; dz = -1; len = 1; }   // 「自己脚下」：立在身前，别把自己围住
    const ux = -dz / len, uz = dx / len;   // 墙沿这个方向排开
    const n = wallSegments(step), half = (n - 1) / 2;
    const pts = Array.from({ length: n }, (_, k) => ({ x: c.x + ux * (k - half) * WALL.gap, z: c.z + uz * (k - half) * WALL.gap }));
    const earth = step.el === 'earth';
    const w = walls.add(step.el, pts, Math.atan2(ux, uz) + Math.PI / 2, earth ? WALL.earthSec : WALL.curtainSec, step);
    fx.burst(groundPt(c), step.el, 1.6, 0.5);
    if (step.runes?.includes('hui')) after(0.3, () => windBack(step, groundPt(c)));   // 字诀「回」：风墙也飞回来一道
    if (earth) {
      enemies.setObstacles(walls.obstacles());
      for (const e of [...enemies.list]) {
        if (distToSegment(e.pos, pts[0], pts[n - 1]) < 0.8) { w.hit.add(e.id); hitEnemy(e, step, step.dmgEach, e.pos.clone().add(new THREE.Vector3(0, 0, 1)), {}); }
      }
    }
  }

  /**
   * 融合法术。方向一律是"从施法者看向目标"：火卷风从目标身前起、往外卷；豪火灭却从施法者身前喷出去。
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
      fusions.beam(CASTER_POS.clone().setY(1.3).addScaledVector(dir, 0.8), dir, step);   // 浪头扫到谁才烧谁，见 fusionContacts
    }
  }

  /**
   * 每帧：火卷风碰到谁，烧一下并把它卷起来甩出去；豪火灭却的浪头推到谁，烧一下并顺着浪推出去。
   * 每道卷风、每片火浪对每个敌人只算一次。
   */
  function fusionContacts() {
    for (const tw of fusions.tornadoes) {
      for (const e of [...enemies.list]) {
        if (tw.hit.has(e.id) || Math.hypot(e.pos.x - tw.pos.x, e.pos.z - tw.pos.z) > TORNADO.r) continue;
        tw.hit.add(e.id);
        hitEnemy(e, tw.step, tw.step.dmgEach, tw.pos, {});
        enemies.fling(e, tw.dir.x * 8 + (Math.random() - 0.5) * 3, 6, tw.dir.z * 8 + (Math.random() - 0.5) * 3);
      }
    }
    for (const wv of fusions.waves) {
      if (!wv.step) continue;   // 火灵放的火浪：只烧人，试炼模式里判
      const front = wv.t * BEAM.speed, at = wv.from.clone().setY(1.3);
      for (const e of [...enemies.list]) {
        if (wv.hit.has(e.id) || !inWave(e.pos, wv.from, wv.dir, front, 0.4)) continue;
        wv.hit.add(e.id);
        hitEnemy(e, wv.step, wv.step.dmgEach, at, {});
        enemies.fling(e, wv.dir.x * 11, 2.5, wv.dir.z * 11);
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
    const wasFrozen = e.frozen > 0, rs = step.runes ?? [];
    let r = damageTo({ type: e.type, frozen: wasFrozen }, { el: step.el, dmg, ...dir });
    if (r.freezeSec && rs.includes('ning')) r = { ...r, freezeSec: r.freezeSec * RUN.runes.ning.freeze };   // 字诀「凝」：冻得更久
    if (e.mode === 'boss') {
      r = trial.hitBoss(e, step.el, r, rs.includes('po'));   // 试炼的 boss：冰甲只怕火（字诀「破」什么元素都削甲）
      if (r.freezeSec > 0 && rs.includes('ning')) trial.chill();   // 「凝」冻住了 boss：下一招预警变慢
    }
    const at = e.pos.clone(), t = step.tally ?? tallyOf.get(step);   // 这一下记在哪一招的账上（战报卡）
    enemies.applyHit(e, r, from, step.el);
    if (t) addDamage(t, r.dmg);
    if (step.el === 'thunder' && !dir.chain) chain(e, at, wasFrozen, step, dmg);
    const st = stepStats.get(step);   // 天赋按键放的：记命中与反应，按打法加气势
    if (st) { st.hits.add(e.id); if (r.reaction) st.combo = true; awardButton(st); }
    if (r.aoeBonus) {
      // 蒸汽爆：冻住的目标被火打中，炸开一圈额外伤害
      fx.burst(at.clone().setY(at.y + 0.6), 'fire', 2.5, 0.7);
      for (const o of [...enemies.list]) {
        if (o === e || Math.hypot(o.pos.x - at.x, o.pos.z - at.z) > 3) continue;
        const hit = { dmg: r.aoeBonus, freezeSec: 0, burnSec: 0, unfreeze: true, push: 0, reaction: '蒸汽爆', stunSec: 0 };
        const h = o.mode === 'boss' ? trial.hitBoss(o, 'fire', hit) : hit;
        enemies.applyHit(o, h, at, 'fire');
        if (t) addDamage(t, h.dmg);
      }
    }
  }

  /**
   * 雷的连锁：从被劈中的那只（已经死了也算，用它倒下前的位置）一跳一跳劈向旁边的，每跳隔一小会儿，
   * 打谁、打多疼由 chainTargets 定；跳出来的这几下不再连锁。step.extraJumps：雷龙劈的雷多跳几下。
   */
  function chain(e, at, wasFrozen, step, dmg) {
    const views = [{ id: e.id, x: at.x, z: at.z, frozen: wasFrozen },
      ...enemies.list.filter((o) => o !== e).map((o) => ({ id: o.id, x: o.pos.x, z: o.pos.z, frozen: o.frozen > 0 }))];
    const yin = !!step.runes?.includes('yin');   // 字诀「引」：多跳几下，劈过的地方冰锥全碎
    const jumps = chainTargets(e.id, views, dmg, (yin ? RUN.runes.yin.jumps : 0) + (step.extraJumps ?? 0));
    let prev = at.clone().setY(at.y + 0.8);
    jumps.forEach((j, k) => after(0.08 * (k + 1), () => {
      const o = enemies.get(j.id);
      if (!o || S.phase !== 'playing') return;
      const to = enemies.aimPoint(o);
      fx.arc(prev, to, { jitter: 0.35 });
      if (yin) zapShards(prev, to);
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
  const lab = { on: false, dim: -1, inv: -1, shield: -1, speed: 1, panel: /** @type {ReturnType<typeof mountLab> | null} */ (null) };
  /** 放一发：raw 是模型格式的意图，走和玩家一样的清洗、裁决、演出；不扣法力、不计重复衰减 @param {any} raw @param {string} label */
  function labCast(raw, label) {
    if (S.phase !== 'playing') return;
    S.mana = MANA_MAX; S.lastCombo = null; S.said = new Set(); S.busy = false;
    if (raw.c) setGauge(S.mods.ult, raw.c);
    const castId = ++castSeq;
    const intent = sanitizeIntent(raw, label);
    locks.show(castId, lockSteps(intent.steps, intent.momentum).marks);
    beginChant(intent.summon || intent.steps[0]?.el || 'arcane');
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
      cast: labCast, speed: (s) => { lab.speed = s; }, dim: (v) => { lab.dim = v; }, inv: (v) => { lab.inv = v; }, shield: (v) => { lab.shield = v; },
      targets: labTargets, clear: () => { for (const e of [...enemies.list]) enemies.kill(e, e.pos); },
      quality: quality.name,
    });
  }

  // ---------------------------------------------------------------- 主循环
  let raf = 0, lastNow = performance.now(), timeScale = 1, fpsAcc = 0, fpsN = 0, fps = 0, dbgT = 0, idleT = 0, worldDim = 0, labT = 0;
  const impactUv = new THREE.Vector2(0.5, 0.5);
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), shakeOff = new THREE.Vector3();
  /** boss 有多高（边缘箭头和跟随镜头取景时框它的头顶；三个 boss 差不多高，取一个数） */
  const BOSS_H = 3.2;

  /**
   * 首页的活背景（设计文档第 4 节"首页"）：小傀儡沿石阶、索桥上来，施法者隔几秒自己放一招（五种元素轮着来）把走在最前的打碎，
   * 冰龙模型下好以后隔一阵飞下来砸一次。只演画面：不扣法力、不攒气势、不出咒语卡；法术、碎裂不出声（首页只放背景乐）。
   * 点开始时 startGame 清场（敌人、龙、排着的延时一起清掉）。
   */
  const COVER = { first: 1.6, every: 3.2, foeEvery: 2.4, foes: 4, dragonFirst: 13, dragonEvery: 30 };
  const COVER_ELS = ['fire', 'ice', 'wind', 'thunder', 'earth'];
  const cover = { spell: COVER.first, foe: 0.4, dragon: COVER.dragonFirst, i: 0, n: 0, t: 0 };
  /** 走在最前的那只（离阵眼最近） */
  const coverLead = () => enemies.list.reduce((a, e) => (!a || e.pos.distanceTo(CORE_POS) < a.pos.distanceTo(CORE_POS) ? e : a), /** @type {any} */ (null));
  /** 落点 p 周围 R 米内的小傀儡打碎（封面上的那几只） @param {THREE.Vector3} p @param {number} R */
  const coverHit = (p, R) => {
    if (S.phase !== 'title') return;   // 飞在半路时已经开局了：别打到新一局的敌人
    for (const e of [...enemies.list]) if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= R) enemies.kill(e, origin);
  };
  /** @param {number} dt */
  function coverLife(dt) {
    cover.t += dt;
    if ((cover.foe -= dt) <= 0) {
      cover.foe = COVER.foeEvery;
      if (enemies.alive < COVER.foes) enemies.spawn('grunt', cover.n++ % 2);
    }
    if (cover.t > 5) dragon.preload('ice');
    if ((cover.dragon -= dt) <= 0 && dragon.lookFor('ice') && !dragon.flights.length) {
      cover.dragon = COVER.dragonEvery;
      const e = coverLead();
      dragon.summon(e ? atGround(e.pos.x, e.pos.z) : atGround(DEFAULT_AIM.x, DEFAULT_AIM.z), 'ice', { impact: (p) => coverHit(p, 4.5) });
      cover.spell = Math.max(cover.spell, 6);   // 龙在飞，先别放别的
      return;
    }
    if ((cover.spell -= dt) > 0 || dragon.flights.length) return;
    cover.spell = COVER.every + Math.random() * 1.2;
    const el = COVER_ELS[cover.i++ % COVER_ELS.length];
    fx.beginChant(el);   // 不走 beginChant：那里出咏唱声
    layout.plaza.flow();
    caster.charge();
    after(0.7, () => {
      if (S.phase !== 'title') return;
      fx.endChant();
      const foe = coverLead(), id = foe?.id ?? null;
      const last = foe ? enemies.aimPoint(foe) : atGround(DEFAULT_AIM.x + (Math.random() - 0.5) * 6, DEFAULT_AIM.z - Math.random() * 3);
      const target = () => { const e = id ? enemies.get(id) : null; if (e) enemies.aimPoint(e, last); return last; };
      fx.launchBurst(el);
      caster.cast(last);
      if (el === 'thunder') {   // 雷：从天上劈下来
        const end = target().clone();
        fx.arc(end.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 15, 1.5)), end);
        fx.burst(end, el, 1.8, 0.9);
        coverHit(end, 1.8);
      } else if (el === 'ice') {   // 冰：一阵冰雨落在它周围
        for (let k = 0; k < 5; k++) {
          const ox = (Math.random() - 0.5) * 3, oz = (Math.random() - 0.5) * 3;
          fx.bolt({ el, path: 'sky', delay: k * 0.18, target: () => (k ? atGround(last.x + ox, last.z + oz) : target()),
            onHit: (p) => { fx.burst(p, el, 1.4, 0.45); coverHit(p, 1.4); } });
        }
      } else {
        fx.bolt({ el, path: 'straight', big: true, target, onHit: (p) => { fx.burst(p, el, 2.2, 1); coverHit(p, 2.2); } });
      }
    });
  }
  /**
   * 首页的镜头：照平时的机位，绕着看的点左右慢慢摆（不转到背面去，背面是没修的山体）；
   * 横屏时看的点往左挪一点，画面主体让到标题右边；竖屏标题在上面，看的点往上挪，主体落到下半截
   * @param {number} rdt
   */
  function coverCamera(rdt) {
    coverT += rdt;
    const a = Math.sin((coverT / 64) * Math.PI * 2) * 0.42;
    const off = _v.subVectors(cam.base, cam.look).applyAxisAngle(UP, a);
    camPos.copy(cam.look).add(off);
    camPos.y += Math.sin(coverT * 0.23) * 0.35;
    const wide = camera.aspect >= 1.2;
    _side.crossVectors(off, UP).normalize();   // 镜头的左手方向
    camLook.copy(cam.look).addScaledVector(_side, wide ? 3.2 : 0);
    camLook.y += wide ? 0 : 2.2;
  }
  let coverT = 0;
  const UP = new THREE.Vector3(0, 1, 0), _side = new THREE.Vector3();

  /**
   * 试炼的镜头（设计文档第 4 节"10-29 定：试炼的镜头与三档视角"）：按现在是哪一档算机位；刚切档时从切的那一刻的机位滑过去
   * @param {number} rdt 现实时间（慢放、顿帧时镜头照常跟）
   */
  function trialCamera(rdt) {
    if (view.mode === 'follow') followCamera(rdt); else lockCamera(rdt);
    if (view.sw < 1) {
      view.sw = Math.min(1, view.sw + rdt / 0.45);
      const k = THREE.MathUtils.smoothstep(view.sw, 0, 1);
      _v.copy(camPos); camPos.copy(view.fromPos).lerp(_v, k);
      _v.copy(camLook); camLook.copy(view.fromLook).lerp(_v, k);
    }
  }

  /**
   * 肩后 / 第一人称：锁着目标转（有 boss 锁 boss，小怪潮锁最近的一只，没敌人保持朝向；转速有上限），"往前"跟着它；
   * 开口时肩后推近一点。大招镜头、完美闪避推近只在俯视里演（肩后本来就近，第一人称推过去会看见自己）
   * @param {number} rdt
   */
  function lockCamera(rdt) {
    const b = trial.boss;
    const t = lockTarget(trial.p, b && b.pos, b ? [] : enemies.list.filter((e) => e.mode !== 'fall').map((e) => e.pos));
    if (!tcam.on) {   // 开局、换了窗口大小：直接朝着目标
      tcam.on = true; tcam.shot = null; tcam.w = 0; tcam.kickT = Infinity; tcam.perfects = trial.perfects;
      turnToward(view.dir, trial.p, t, 1e3);
    }
    tcam.shot = null; tcam.perfects = trial.perfects;   // 切回俯视时不补演
    turnToward(view.dir, trial.p, t, rdt);
    steer.dir.copy(view.dir);
    const pose = lockPose(view.mode === 'first' ? 'first' : 'shoulder', trial.p, view.dir, camera.aspect);
    camPos.copy(pose.pos); camLook.copy(pose.look);
    if (view.mode === 'shoulder') camPos.lerp(camLook, 0.18 * cam.focus);
    env.aim(_v.subVectors(camLook, camPos).normalize());   // 雾取镜头朝向那段天边的颜色
  }

  /** 第一人称：法术从镜头前面、偏右一点出手（不从镜头里钻出来）；trial.sync 每帧放回胸口，这里接着挪 */
  function firstHand() {
    const h = LOCK.hand, d = view.dir;
    for (const o of [origin, fx.origin]) o.set(trial.p.x + d.x * h.ahead - d.z * h.side, h.y, trial.p.z + d.z * h.ahead + d.x * h.side);
  }

  /**
   * 俯视跟随：看的点跟得快、离多远拉远快推近慢（boss 冲过来时先把它框进来，走近了再慢慢推回去）；
   * 开口时推近一点；完美闪避推近一下；召龙时推到肩后（ultShot）
   * @param {number} rdt
   */
  function followCamera(rdt) {
    const b = trial.boss;
    const safe = { ...FOLLOW.safe, top: Math.min(FOLLOW.safe.top, hud.safeTop()) };   // 矮屏幕上 boss 血条占得多，量着它来
    const pose = followPose(camera, trial.p, b ? { x: b.pos.x, z: b.pos.z, h: BOSS_H } : null, { safe });
    steer.dir.copy(pose.dir).negate();
    if (!tcam.on) {
      tcam.on = true; tcam.look.copy(pose.look); tcam.dist = pose.dist;
      tcam.perfects = trial.perfects; tcam.kickT = Infinity; tcam.shot = null; tcam.w = 0;
      env.aim(steer.dir);
    }
    if (trial.perfects !== tcam.perfects) { tcam.perfects = trial.perfects; tcam.kickT = 0; }
    tcam.kickT += rdt;
    tcam.look.lerp(pose.look, 1 - Math.exp(-rdt * 6));
    tcam.dist += (pose.dist - tcam.dist) * (1 - Math.exp(-rdt * (pose.dist > tcam.dist ? 4 : 1.2)));
    camLook.copy(tcam.look);
    camPos.copy(tcam.look).addScaledVector(pose.dir, tcam.dist * (1 - 0.25 * cam.focus) * (1 - SHOT.kick.push * kickAt(tcam.kickT)));
    ultShot(rdt);
  }

  /**
   * 召龙的肩后镜头：一召就推到人的肩后、朝龙要砸的地方，龙开飞（召唤法阵亮完）后停 SHOT.sec 秒或到龙砸中，再拉回俯视。
   * 模型还在下载时法阵先亮着等（最多 3 秒），从召的那一刻算起最多停 SHOT.wait 秒——boss 照常出招，不能一直看龙。
   * 走位方向照旧按俯视（steer 不跟着转）
   * @param {number} rdt
   */
  function ultShot(rdt) {
    const s = tcam.shot;
    if (s) {
      const f = s.f;
      s.wait += rdt;
      if (f.started) s.t += rdt;
      if (!dragon.flights.includes(f) || f.impacted || s.t > SHOT.sec || s.wait > SHOT.wait || S.phase !== 'playing') tcam.shot = null;
      else {
        const sp = shoulderPose(trial.p, f.target, f.emerged ? f.headPos : null, steer.dir, camera.aspect);
        const k = tcam.w > 0 ? 1 - Math.exp(-rdt * 5) : 1;   // 刚开始直接放到位（这时还没混进画面）
        tcam.pos.lerp(sp.pos, k);
        tcam.at.lerp(sp.look, k);
      }
    }
    tcam.w = THREE.MathUtils.clamp(tcam.w + (tcam.shot ? rdt / SHOT.in : -rdt / SHOT.out), 0, 1);
    const w = THREE.MathUtils.smoothstep(tcam.w, 0, 1);
    if (w > 0) {
      camPos.lerp(tcam.pos, w);
      camLook.lerp(tcam.at, w);
    }
    if (w > 0 || tcam.aimed) env.aim(w > 0 ? _v.subVectors(camLook, camPos).normalize() : steer.dir);   // 雾取镜头朝向那段天边的颜色
    tcam.aimed = w > 0;
  }

  /** boss 跑出画面时，屏幕边缘出一个箭头指着它（只在试炼打 boss 时） */
  function bossArrow() {
    const b = trial.boss;
    if (!(S.mode === 'trial' && trial.on && b && S.phase === 'playing')) { hud.setArrow(null); return; }
    camera.updateMatrixWorld();
    const a = offscreenArrow(_v.set(b.pos.x, BOSS_H * 0.5, b.pos.z), camera);
    hud.setArrow(a && { x: (a.x + 1) / 2, y: (1 - a.y) / 2, angle: a.angle });
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const realDt = Math.min((now - lastNow) / 1000, 1 / 30);
    lastNow = now;
    // 开口就慢放：输入中（单次最多 8 秒）与咏唱中都是 0.3 倍
    if (slowSince && now - slowSince > SLOWMO_MAX_SEC * 1000) { slowSince = 0; slowSpent = true; }
    const slow = (slowSince > 0 || (fx.chanting > 0 && !buttonChant)) && S.phase === 'playing';
    timeScale += ((slow ? (trial.fighting ? TRIAL_VOICE_SLOW : SLOWMO_SCALE) : 1) - timeScale) * Math.min(1, realDt * 10);
    // 麦克风：录着、听写着的时候这一局结束了就收掉；按钮按能不能开口显示（试炼开战后气势满了才出来）
    if (mic !== 'idle' && S.phase !== 'playing') { if (mic === 'on' || mic === 'tap') recorder?.stop(); micReset(); }
    hud.setMicShown(micAllowed() || mic !== 'idle');
    let dt = frozen ? 0 : realDt * timeScale * lab.speed;   // 写咒对话框开着：游戏停住，画面照画；试验场可放慢、定格
    // 施法者自己的钟：开口慢放时世界慢、人照常（不然 0.8 秒的咏唱里手还没抬起来）；顿帧照样顿
    let cdt = frozen ? 0 : realDt * lab.speed;
    if (fx.hitStop > 0) { fx.hitStop -= realDt; dt *= 0.06; cdt *= 0.06; }
    // 心法刹那：完美闪避后全场慢下来，玩家自己照常快。pdt 是玩家的时间：走位、闪避冷却、回法力、心法窗口都按它走
    const pdt = dt;
    if (S.slowT > 0) { S.slowT -= pdt; dt *= RUN.arts.slow.scale; }
    S.counterT = Math.max(0, S.counterT - pdt); S.afterT = Math.max(0, S.afterT - pdt);
    idleT += dt;

    for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { const t = timers.splice(i, 1)[0]; t.fn(); } }
    if (S.phase === 'playing' || S.phase === 'rest') {
      S.mana = regenMana(S.mana, pdt, S.mods.manaRegen);
      if (S.mode === 'trial') {   // 试炼：走位、小怪潮与 boss 轮换（三选一时停住）
        trial.update(dt, steer, pdt);
        if (view.mode === 'first' && trial.on) firstHand();
      }
      else updateWave(dt);
    }
    fx.sound = S.phase === 'title' ? null : sound;   // 首页的法术不出声
    if (S.phase === 'title') coverLife(dt);
    world.step(1 / 60, dt, 3);
    updateCubes(dt);
    if (walls.update(dt)) enemies.setObstacles(walls.obstacles());   // 土墙沉下去了，流场重算
    curtainContacts();
    if (S.phase === 'playing') { updateEmbers(dt); updateGales(dt); }
    fusions.update(dt, camera);
    fusionContacts();
    dragon.update(dt);
    enemies.update(dt, camera);
    caster.update(cdt, S.mode === 'trial' && trial.on);
    fx.update(dt);
    locks.update(dt, enemies);
    const live = particles.update(dt);
    const inkLive = ink.update(dt);
    // 压暗世界：大招（fx.dimLevel）或开口咏唱时轻压一点；试验场可以锁定
    const dimTarget = lab.dim >= 0 ? lab.dim : Math.max(fx.dimLevel, fx.chanting > 0 && !buttonChant ? 0.18 : 0, S.slowT > 0 ? 0.22 : 0);
    worldDim += (dimTarget - worldDim) * Math.min(1, realDt * 6);
    env.setDim(worldDim);
    // 入侵：天色跟波次走、守住散开、输了全暗；试验场可以锁定某一档
    // 试炼按 boss 的三个阶段压（第三阶段与守关最后一波一样暗）
    const invT = S.mode === 'trial' ? invasionTarget({ phase: S.phase, wave: Math.max(0, trial.round - 1), waves: BOSS_COUNT, progress: trial.progress() })
      : invasionTarget({ phase: S.phase, wave: S.wave, waves: WAVES.length, progress: S.spawned / Math.max(1, S.spawned + S.queue.length) });
    S.inv = lab.inv >= 0 ? lab.inv : stepInvasion(S.inv, invT, S.phase, dt);
    env.setInvasion(S.inv);
    layout.plaza.setInvasion(S.inv);   // 台面裂缝、焦痕
    layout.plaza.update(dt, realDt);
    layout.ambience.setInvasion(S.inv);
    layout.ambience.update(dt);   // 浮尘、飘落的松针
    if (lab.shield >= 0) barrier.setDamage(lab.shield);   // 试验场锁定光罩裂到几成
    barrier.update(dt, worldDim);
    layout.coreSigil.rotation.z += dt * 0.2;
    layout.crystal.rotation.y += dt * 0.8;
    layout.crystal.position.y = 1.7 + Math.sin(idleT * 1.6) * 0.12;
    // 背景乐：首页、战前、喘口气、三选一是静的；小怪潮是战的；boss 与守关后两波是 boss 的；结算时停（胜负的那一段已经放了）
    sound.mood(S.phase === 'title' ? 'calm' : S.phase === 'won' || S.phase === 'lost' ? null
      : S.mode === 'trial' ? (!trial.fighting ? 'calm' : trial.boss ? 'boss' : trial.state === 'wave' ? 'battle' : 'calm')
      : S.phase === 'rest' ? 'calm' : S.wave >= 3 ? 'boss' : 'battle');
    const cm = layout.crystal.material;
    cm.emissiveIntensity += (0.8 - cm.emissiveIntensity) * Math.min(1, dt * 3);
    hud.setMana(S.mana, MANA_MAX);
    if (lab.on) {   // 试验场：法力、阵眼一直满
      S.mana = MANA_MAX;
      if (S.core < CORE_HP) { S.core = CORE_HP; hud.setCore(S.core, CORE_HP); if (lab.shield < 0) barrier.setDamage(0); }
      labT += realDt;
      if (lab.panel && labT > 0.3) {
        labT = 0;
        lab.panel.setStatus(`帧率 ${fps} · 粒子 ${live} · 墨 ${inkLive}\n压暗 ${worldDim.toFixed(2)} · 时间 ×${(timeScale * lab.speed).toFixed(2)}`);
      }
    }

    // 镜头：咏唱时推近，动完回到固定位置
    const focusT = (fx.chanting > 0 && !buttonChant) || (slowSince > 0 && S.phase === 'playing') ? 0.35 : 0;
    cam.focus += (focusT - cam.focus) * Math.min(1, realDt * 3);
    if (S.mode === 'trial' && trial.on) trialCamera(realDt);
    else if (S.phase === 'title') coverCamera(realDt);
    else {
      tcam.on = false;
      camPos.copy(cam.base).lerp(cam.near, cam.focus);
      camLook.copy(cam.look).lerp(cam.nearLook, cam.focus);
    }
    // 第一人称：藏起施法者的身体（挨打时一闪一闪也不闪出来），切走、离开试炼时放回来；视角按钮只在试炼里出
    const inTrial = S.mode === 'trial' && trial.on;
    const hide = inTrial && view.mode === 'first' && view.sw > 0.5;
    if (hide) layout.caster.visible = false;
    else if (view.hid) layout.caster.visible = true;
    view.hid = hide;
    // 肩后、第一人称平着看：太阳本体会进画（压到两成），台面也会把太阳镜面反射过来，泛光晕成半屏白、盖住敌人（压到 5%，留一小点夕阳反光）
    view.low += ((inTrial && view.mode !== 'follow' ? 1 : 0) - view.low) * Math.min(1, realDt * 4);
    env.setGlare(1 - 0.8 * view.low);
    layout.plaza.setGlint(1 - 0.95 * view.low);
    hud.setView(VIEW_NAMES[view.mode], inTrial && S.phase === 'playing');
    shakeOff.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(fx.shake * 0.5);
    camera.position.copy(camPos).add(shakeOff);
    camera.lookAt(camLook);
    bossArrow();
    env.update(dt, camera.position);   // 云、雾流动，雾里的闪电（游戏时间，慢放时一起变慢）
    fx.cameraPos.copy(camera.position);
    fx.impactK *= Math.exp(-realDt * 9);
    _v.copy(fx.impactPos).project(camera);
    impactUv.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
    grade.tick(realDt, _v.z < 1 ? fx.impactK : 0, impactUv, camera.aspect);
    renderer.info.reset();
    composer.render();
    if (shotDue >= 0 && idleT >= shotDue) { shotDue = -1; captureShot(); }   // 战报卡的最佳一击：紧跟在画完之后截

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
    /** 回首页（封面）；coverState() 看封面的活背景排到哪了 */
    home: () => backToTitle(),
    coverState: () => ({ phase: S.phase, onCover: hud.onCover, foes: enemies.alive, flights: dragon.flights.length, ...cover }),
    /** 试炼：trial() 进战前准备，engage() 开战；walk(x, z) 把玩家挪过去；bossHp(n) 改 boss 的血（看换阶段） */
    trial: () => startGame('trial'),
    engage: () => trial.engage(),
    walk: (x = 0, z = 5.2) => { trial.p.set(x, 0, z); trial.sync(); },
    bossHp: (n) => { if (trial.boss) trial.boss.hp = n; },
    /**
     * 让 boss 马上出这一招，看招用：寒甲傀儡王 slam / sweep / summon / homing / spiral，石甲巨像 slam / rocks / charge / spikes / summon，
     * 火灵 pyre / homing / nova / wave / summon
     */
    bossMove: (m) => trial.force(m),
    trialState: () => {
      const b = trial.boss;
      return { on: trial.on, fighting: trial.fighting, hp: trial.hp, at: [+trial.p.x.toFixed(2), +trial.p.z.toFixed(2)], phase: trial.phase,
        armor: Math.round(trial.armor), state: trial.state, move: trial.move, t: +trial.t.toFixed(2),
        boss: b && { hp: Math.round(b.hp), at: [+b.pos.x.toFixed(2), +b.pos.z.toFixed(2)], frozen: +b.frozen.toFixed(2) },
        minions: enemies.list.filter((o) => o.chase).length, bullets: trial.bullets.length,
        stage: trial.stage, round: trial.round, waveLeft: trial.waveLeft, runT: Math.round(trial.runT), perfects: trial.perfects,
        run: { picks: S.run.picks, rerolls: S.run.rerolls, have: { ...S.run.have } }, mods: { ...S.mods },
        arts: { slow: +S.slowT.toFixed(2), counter: +S.counterT.toFixed(2), after: +S.afterT.toFixed(2), ghost: +trial.ghostT.toFixed(2) },
        stamina: +trial.stamina.toFixed(2), pending: trial.pending.length, dashLock: +trial.dashLock.toFixed(2), slowTele: trial.slowTele,
        teleLen: +trial.teleLen.toFixed(2), embers: embers.length, friendly: trial.bullets.filter((o) => o.friendly).length,
        ghostAt: [+trial.ghost.position.x.toFixed(2), +trial.ghost.position.z.toFixed(2)], shots: trial.bullets.map((o) => [+o.x.toFixed(1), +o.z.toFixed(1)]),
        crew: enemies.list.filter((o) => o.chase).map((o) => [o.type, o.act, +o.pos.x.toFixed(1), +o.pos.z.toFixed(1)]),
        orbs: trial.bullets.filter((o) => o.orb).length, strips: trial.strips.size };
    },
    /** 试炼：直接拿一张卡；招式字给 el 就换进那个元素的按钮，字诀给 el 就一键写进那个按钮 */
    give: (id, el) => {
      const c = CARDS.find((x) => x.id === id);
      if (c) { S.run = takeCard(S.run, c, c.kind === 'move' ? el : undefined); applyMods(); }
      if (c && el && c.kind === 'rune') writeIn(runePlan(el, c));
      for (const t of S.talents) { const l = skillLabel(t); hud.setSkillLabel(t, l.label, l.named); }
      return { ...S.mods };
    },
    /** 试炼：某个按钮现在认出的字诀、放出去每一步带哪些字诀 */
    runes: (el) => { const it = buttonIntent(el); return { text: S.binds[el]?.text ?? '', label: skillLabel(el).label, runes: it.runes ?? [], notes: it.notes,
      steps: it.steps.map((s) => ({ el: s.el, form: s.form, runes: s.runes ?? [], dmgK: s.dmgK ?? 1, costK: s.costK ?? 1 })), chantMs: runeChantMs(buttonRunes(el)) }; },
    /** 试炼：把玩家的气血设成 n（测的时候别被打死） */
    hp: (n = TRIAL.hp) => { trial.hp = n; hud.setCore(n, TRIAL.hp); },
    /** 试炼：跳过这一段（小怪潮清场 / boss 直接碎），看下一段 */
    skipStage: () => {
      trial.waveLeft = 0; trial.pending.length = 0;
      for (const e of [...enemies.list]) if (e.chase) enemies.kill(e, e.pos);
      if (trial.boss) enemies.kill(trial.boss, trial.boss.pos);
    },
    /** 试炼：在 (x, z) 放一只小怪潮里的小怪（'grunt' | 'archer' | 'charger'） */
    minion: (/** @type {string} */ kind = 'archer', x = 0, z = -4) => { trial.spawnChaser({ x, z, kind }); },
    /** 试炼：在 (x, z) 放一颗不动、不伤人的冰锥，活 life 秒（看护身、字诀「引」打不打得碎） */
    shard: (x = 0, z = 1.6, life = 8) => trial.fire(x, 1, z, 0, 0, { life, dmg: 0, r: 0.3 }),
    cast: (text) => submit(text),
    spawn: (/** @type {any} */ type = 'grunt', path = 0) => enemies.spawn(type, path),
    state: () => ({ phase: S.phase, mana: Math.round(S.mana), core: S.core, gauge: S.gauge, enemies: enemies.views(), last: S.last && { source: S.last.source, ms: S.last.ms, plan: S.last.plan } }),
    view: (px, py, pz, tx, ty, tz) => { cam.base.set(px, py, pz); cam.look.set(tx, ty, tz); },
    debug: (on = true) => { hud.debug.hidden = !on; },
    // 先停掉排着的那一帧再续：没停着时调 pause(false) 会多起一条循环，之后 pause(true) 只停得住其中一条（实测）
    pause: (on = true) => { cancelAnimationFrame(raf); if (!on) { lastNow = performance.now(); frame(); } },
    block: (list = []) => enemies.setObstacles(list),
    wave: (i = 0) => { enemies.clear(); S.phase = 'playing'; startWave(i); },
    lab: () => enterLab(),
    killAll: () => { S.queue.length = 0; for (const e of [...enemies.list]) enemies.kill(e, e.pos); },
    /** 打碎某一只（看飞弹半路目标没了会怎样） */
    kill: (id) => { const e = enemies.get(id); if (e) enemies.kill(e, e.pos); },
    /** 气势槽设成 n 格，新加的格染 el（一串就轮着染；不给是白格）；gaugeCols() 看每一格的颜色 */
    gauge: (n = S.mods.ult, /** @type {string | string[] | undefined} */ el = undefined) => setGauge(n, el),
    gaugeCols: () => [...S.gaugeCols],
    /** 天赋按键：按一个，或在 0.6 秒内按两个（press('wind','fire') 出火卷风）；summonBtn 是金色召唤按钮 */
    press: (...els) => els.forEach((el) => pressTalent(el)),
    summonBtn: () => pressSummon(),
    /** 单独劈一道闪电看样子：zap([x,y,z], [x,y,z]) */
    zap: (a, b) => fx.arc(new THREE.Vector3(...a), new THREE.Vector3(...b)),
    /** 单独炸一下看样子：boom(元素, [x,y,z], 半径, 规模)；shot(元素, [x,y,z]) 从施法者打一发飞弹过去（不结算伤害） */
    boom: (el = 'fire', at = [0, 0.4, -4], R = 2.5, scale = 1) => fx.burst(new THREE.Vector3(...at), el, R, scale),
    shot: (el = 'fire', to = [0, 1, -5], big = true) => fx.bolt({ el, path: 'straight', big, target: () => new THREE.Vector3(...to), onHit: (p) => fx.burst(p, el, 1.3, 0.45) }),
    /** 入侵程度锁在 k（0～1），不给就回到跟着波次走；flash 在黑雾里劈一道闪电 */
    invade: (k = -1) => { lab.inv = k; },
    /** 光罩裂到几成（0～1），不给就回到跟着阵眼血量走 */
    shield: (d = -1) => { lab.shield = d; if (d < 0) barrier.setDamage(1 - S.core / CORE_HP); },
    flash: () => env.flash(),
    /** 声音：play(名字, 参数) 放一个音效（名字见 fx/sound.js 的 RECIPES）；measure(名字或 calm / battle / boss) 离线渲染量峰值与响多久 */
    sound: { play: (/** @type {string} */ n, o = {}) => sound.play(n, o), measure: (/** @type {string} */ n, o = {}, sec = 5) => Sound.measure(n, o, sec), obj: sound },
    /**
     * 语音：fake(听写结果) 换上假的麦克风与听写（预览页没有麦克风、也没有服务器），之后照常按住、松开麦克风按钮；
     * 结果给 { fail: 原因 } 就当听写没成，给 null 就当录到的太短太小声。state() 看麦克风在哪一步
     */
    voice: {
      fake(/** @type {string | { fail: string } | null} */ result) {
        recorder = { start: async () => {}, stop: () => (result === null ? null : { b64: 'A'.repeat(200), sec: 1, rms: 0.1 }), dispose() {} };
        listen = async () => { await new Promise((r) => setTimeout(r, 400)); return typeof result === 'string' ? { text: result, ms: 400 } : result ?? { fail: 'silence' }; };
        hud.setMic({ down: micDown, up: micUp });
      },
      state: () => mic,
    },
    talents: (list) => { if (list) { S.talents = list; renderPicker(); } return [...S.talents]; },
    binds: () => Object.fromEntries(Object.entries(S.binds).map(([k, v]) => [k, { name: v.name, text: v.text }])),
    // 面板太小时看不清：按 w×h 横屏重画当前这一帧（先 pause 定格），返回 JPEG 的 data URL。
    // at = [机位 xyz, 看向 xyz]：凑近看一个东西（带泛光和色调，跟游戏里一样亮）
    snap: (w = 960, h = 540, focus = 0, /** @type {number[] | null} */ at = null) => {
      const css = root.style.cssText, ratio = renderer.getPixelRatio();
      root.style.cssText += `;width:${w}px;height:${h}px;right:auto;bottom:auto`;
      renderer.setPixelRatio(1);
      layoutCamera();
      if (at) { camera.position.set(at[0], at[1], at[2]); camera.lookAt(at[3], at[4], at[5]); }
      else { camera.position.copy(cam.base).lerp(cam.near, focus); camera.lookAt(_v.copy(cam.look).lerp(cam.nearLook, focus)); }
      composer.render();
      const url = renderer.domElement.toDataURL('image/jpeg', 0.72);
      root.style.cssText = css;
      renderer.setPixelRatio(ratio);
      layoutCamera();
      return url;
    },
    /** 竖屏取景的参数（调镜头用：改完这些向量再触发一次 resize） */
    framing: { dir: NARROW_DIR, look: NARROW_LOOK, wide: FRAME_WIDE, near: FRAME_NEAR },
    /** 试炼跟随镜头的参数（直接改，下一帧生效）；cam() 看镜头现在离多远、人和 boss 在画面上哪儿 */
    follow: FOLLOW,
    /** 直接来一次完美闪避（看推镜、白光；要在开战后） */
    perfect: () => { trial.perfectUsed = false; trial.perfect(); },
    cam: () => {
      const at = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => { const p = _v.set(x, y, z).project(camera); return [+p.x.toFixed(2), +p.y.toFixed(2)]; };
      const b = trial.boss;
      return { dist: +tcam.dist.toFixed(2), feet: at(trial.p.x, 0, trial.p.z), head: at(trial.p.x, 1.9, trial.p.z),
        boss: b && [at(b.pos.x, 0, b.pos.z), at(b.pos.x, BOSS_H, b.pos.z)] };
    },
    dragon: (el = 'ice') => dragon.preload(el),
    flight: () => {
      const f = dragon.active, r = (/** @type {THREE.Vector3} */ v) => v.toArray().map((x) => +x.toFixed(1));
      return f && { kind: f.kind, el: f.el, pick: f.plan.pick, s: +f.s.toFixed(1), sHit: +f.sHit.toFixed(1), L: +f.L.toFixed(1), impacted: f.impacted,
        strikes: f.nextStrike, mesh: !!f.model, target: r(f.target), head: r(f.headPos) };
    },
    /** 同时在飞的每一条（双龙、护身）：落点或绕的中心、龙头在哪、飞到哪了 */
    flights: () => dragon.flights.map((f) => ({ kind: f.kind, el: f.el, s: +f.s.toFixed(1), sHit: +f.sHit.toFixed(1), impacted: f.impacted,
      target: f.target.toArray().map((x) => +x.toFixed(1)), head: f.headPos.toArray().map((x) => +x.toFixed(1)) })),
    locks: () => ({ heads: locks.heads.filter((h) => h.mesh.visible).map((h) => h.id), rings: locks.rings.filter((r) => r.mesh.visible).length }),
    // 以下给检查页用
    refill: () => { S.mana = MANA_MAX; S.core = CORE_HP; hud.setCore(S.core, CORE_HP); },
    endless: (on = true) => { S.endless = on; },
    cubes: (n = 300, life = 12) => dropCubes(n, life),
    /** 调画面：env.look 里改灯的基准强度与天空、云海的颜色，renderer.toneMappingExposure 改曝光 */
    world: { scene, renderer, env, camera },
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
    window.removeEventListener('keyup', onGlobalKeyUp);
    window.removeEventListener('blur', onBlur);
    for (const ev of UNLOCK_ON) window.removeEventListener(ev, unlock, { capture: true });
    clearTimeout(micTimer);
    recorder?.dispose();
    sound.dispose();
    trial.dispose();
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
