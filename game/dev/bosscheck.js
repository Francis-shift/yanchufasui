// @ts-check
/**
 * boss 模型检查页（只给本机预览面板用：python tools/build_preview.py bosses --asset preview/assets/boss.rig.gz --asset preview/assets/boss-192.webp；
 * 石甲巨像、火灵把 boss 换成 stone、flame）。看哪个 boss 按内嵌的模型文件名定。
 * 正式模型 315～352 KB、贴图 226～252 KB，塞不进面板 512 KB 的上限，检查页用减面版（tools/lite_rig.py，约 4500 面、动作隔帧取）和缩到 192 的贴图：
 * 看身高、朝向、甲罩没罩住、各招的动作跟预警对不对得上；细节以正式模型为准。游戏本身不引用这个文件。
 * 同一套天光、广场和敌人代码（actors/enemies.js），每招摆哪段动作的第几秒用和试炼模式同一个函数（actors/bossanim.js）；
 * 招的顺序、预警和喘息的长短照 rules/numbers.js：吼 → 这个 boss 的各招（落石的预警加上后面几块落地的时间；冲撞蓄力完接被打断的硬直）→ 绕圈走一圈。
 * 调试接口 window.bc：view('front' | 'close' | 'side' | 'top')、cam(镜头位置, 看的点)、pause、step(秒)、snap(w, h) 返回 JPEG 地址、
 * pose(动作, 第几秒) 定住某一帧（cycle() 接着循环）、seek(第几步) 跳到某一招、armor(0～1) 甲剩多少（0 是碎了）、now 当前在哪一步。
 * 面板是竖长的：先 snap(innerWidth, innerHeight) 让画布和窗口同比例再截图，不然画面被横向拉扁。
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Enemies, FLAME_SHELL_K } from '../actors/enemies.js';
import { loadRig } from '../actors/rig.js';
import { BOSS_CLIPS, bossPose } from '../actors/bossanim.js';
import { GradePass } from '../fx/grade.js';
import { BOSS, ENEMIES, FLAME, STONE } from '../rules/numbers.js';
import { TIERS } from '../quality.js';
import { buildEnvironment } from '../world/environment.js';
import { buildLayout } from '../world/layout.js';

const C = new THREE.Vector3(0, 0, 2);
/** 机位：[镜头位置, 看的点]（free 由 bc.cam 改） @type {Record<string, number[][]>} */
const VIEWS = {
  front: [[0, 4.2, 14], [0, 1.9, 2]],
  close: [[0, 3, 8], [0, 2, 2]],
  side: [[11, 3, 2], [0, 1.9, 2]],
  top: [[0, 14, 6], [0, 0, 2]],
  free: [[0, 3, 8], [0, 2, 2]],
};
const ORBIT = 2.4;
const REST = BOSS.recover[0];
const ROCK_LEAD = (STONE.rocks.n[0] - 1) * STONE.rocks.gap;
/** 一步：[试炼的状态, 招, 几秒, 预警最后几秒算出手以后（落石后面几块）]；每个 boss 最后再绕圈走一圈 @type {Record<string, [string, string, number, number?][]>} */
const SEQS = {
  boss: [
    ['roar', '', BOSS.roarSec], ['idle', '', 0.8],
    ['tele', 'slam', BOSS.slam.tele], ['recover', 'slam', REST],
    ['tele', 'sweep', BOSS.sweep.tele], ['recover', 'sweep', REST],
    ['tele', 'summon', BOSS.summon.tele], ['recover', 'summon', REST],
    ['tele', 'homing', BOSS.homing.tele], ['recover', 'homing', REST],
    ['tele', 'spiral', BOSS.spiral.tele], ['channel', 'spiral', BOSS.spiral.sec], ['recover', 'spiral', REST],
  ],
  stone: [
    ['roar', '', BOSS.roarSec], ['idle', '', 0.8],
    ['tele', 'slam', STONE.slam.tele], ['recover', 'slam', REST],
    ['tele', 'rocks', STONE.rocks.tele + ROCK_LEAD, ROCK_LEAD], ['recover', 'rocks', REST],
    ['tele', 'charge', STONE.charge.tele[0]], ['stagger', '', STONE.charge.stagger], ['recover', '', REST],
    ['tele', 'spikes', STONE.spikes.tele], ['recover', 'spikes', REST],
    ['tele', 'summon', STONE.summon.tele], ['recover', 'summon', REST],
  ],
  flame: [
    ['roar', '', BOSS.roarSec], ['idle', '', 0.8],
    ['tele', 'wave', FLAME.wave.tele], ['recover', 'wave', REST],
    ['tele', 'homing', FLAME.homing.tele], ['recover', 'homing', REST],
    ['tele', 'pyre', FLAME.pyre.tele], ['recover', 'pyre', REST],
    ['tele', 'nova', FLAME.nova.tele], ['recover', 'nova', REST],
    ['tele', 'summon', FLAME.summon.tele], ['recover', 'summon', REST],
  ],
};

/** @param {HTMLElement} root @param {Record<string, string>} assets 文件名 → 地址 */
export function startBossCheck(root, assets) {
  const file = Object.keys(assets).find((f) => f.endsWith('.rig.gz')) ?? 'boss.rig.gz';
  const type = /** @type {'boss' | 'stone' | 'flame'} */ (file.replace('.rig.gz', ''));
  const speed = ENEMIES[type].speed;
  const SEQ = [...SEQS[type], /** @type {[string, string, number]} */ (['walk', '', (2 * Math.PI * ORBIT) / speed])];
  const clips = /** @type {import('../actors/bossanim.js').BossClips} */ (BOSS_CLIPS[type]);
  const q = TIERS.cinema;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';
  root.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1500);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), q.bloom.strength, q.bloom.radius, q.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new GradePass(q.grade);
  composer.addPass(grade);
  const env = buildEnvironment(scene, renderer);
  env.setShadowMap(q.shadowMap);
  buildLayout(scene, { tex: 1024, reflect: false });
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.8, 0) });
  const enemies = new Enemies(scene, world, /** @type {any} */ ({ emit() {} }),
    { onCoreHit() {}, onGone() {}, floatText() {} });

  /** @type {any} */
  let b = null;
  let i = 0, t = SEQ[0][2], chT = 0, a = 0, paused = false;
  /** @type {{ move: string, t: number } | null} */
  let tail = null;
  /** @type {{ clip: string, time: number } | null} 定住的那一帧（bc.pose） */
  let fixed = null;
  const tex = Object.keys(assets).find((f) => f.startsWith(`${type}-`) && f.endsWith('.webp'));
  const ready = loadRig(assets[file], tex && assets[tex]).then((rig) => {
    enemies.useBossRig(type, rig);
    b = enemies.spawnAt(type, C.x, C.z, 'boss');
    b.dir.set(0, 0, 1);
    return rig;
  });

  /** 进第 n 步：出手（预警结束）和喷完时记下收招从哪算起，吼、硬直清掉，同试炼模式 @param {number} n */
  function enter(n) {
    const [prev, move, , lead = 0] = SEQ[i];
    if (prev === 'tele' && SEQ[n % SEQ.length][0] !== 'channel') tail = { move, t: lead };
    if (prev === 'channel') tail = { move, t: 0 };
    i = n % SEQ.length; t = SEQ[i][2]; chT = 0;
    if (SEQ[i][0] === 'roar' || SEQ[i][0] === 'stagger') tail = null;
  }

  /** @param {number} dt */
  function tick(dt) {
    if (!b) return;
    t -= dt;
    if (SEQ[i][0] === 'channel') chT += dt;
    if (tail) tail.t += dt;
    if (t <= 0) enter(i + 1);
    const [state, move, len, lead] = SEQ[i];
    if (state === 'walk') {
      a += (speed / ORBIT) * dt;
      b.pos.set(C.x + Math.sin(a) * ORBIT, 0, C.z - ORBIT + Math.cos(a) * ORBIT);
      b.dir.set(Math.cos(a), 0, -Math.sin(a));
    } else {
      b.pos.set(C.x + Math.sin(a) * ORBIT, 0, C.z - ORBIT + Math.cos(a) * ORBIT);
      b.dir.set(0, 0, 1);
    }
    b.moving = state === 'walk';
    b.pose = fixed ?? bossPose(clips, { state, move, t, len, chT, tail, lead });
    enemies.update(dt, camera);
  }

  let w = 960, h = 540, view = /** @type {keyof typeof VIEWS} */ ('front');
  const render = () => {
    if (renderer.domElement.width !== w || renderer.domElement.height !== h) {
      renderer.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    const [p, at] = VIEWS[view];
    camera.position.set(...p); camera.lookAt(new THREE.Vector3(...at));
    env.aim(new THREE.Vector3(...at).sub(camera.position));
    grade.tick(0, 0, new THREE.Vector2(0.5, 0.5), w / h);
    composer.render();
  };
  let last = performance.now();
  const loop = () => {
    const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!paused) tick(dt);
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const bc = {
    ready, enemies, scene, type,
    get boss() { return b; },
    get now() { return b && { step: i, state: SEQ[i][0], move: SEQ[i][1], left: +t.toFixed(2), pose: b.pose, clip: b.rig?.cur, time: +(b.rig?.actions[b.rig.cur]?.time ?? 0).toFixed(3) }; },
    /** @param {keyof typeof VIEWS} v */
    view: (v) => { view = v; render(); return v; },
    /** @param {number[]} p 镜头位置 @param {number[]} at 看的点 */
    cam: (p, at) => { VIEWS.free = [p, at]; view = 'free'; render(); },
    /** @param {boolean} on */
    pause: (on) => { paused = on; },
    /** 手动推进 sec 秒（每步 1/60） @param {number} sec */
    step: (sec) => { for (let s = 0; s < sec; s += 1 / 60) tick(1 / 60); render(); },
    /** @param {string} clip @param {number} time */
    pose: (clip, time) => { fixed = { clip, time }; tick(1 / 60); tick(0.25); render(); return bc.now; },
    cycle: () => { fixed = null; },
    /** @param {number} n */
    seek: (n) => { tail = null; i = n % SEQ.length; t = SEQ[i][2]; chT = 0; render(); return bc.now; },
    /** 甲剩多少：冰甲、火罩的透明度用试炼模式同一个式子（火罩不闪），0 是碎了（整层不画） @param {number} k */
    armor: (k) => {
      const m = enemies;
      if (type === 'boss') m.armorMat.opacity = m.shells.boss.opacity = 0.2 + 0.4 * k;
      if (type === 'flame') m.shells.flame.opacity = (m.flameMat.opacity = 0.14 + 0.26 * k) * FLAME_SHELL_K;
      if (b?.armorMesh) b.armorMesh.visible = k > 0;
      render();
    },
    snap: (sw = 960, sh = 540) => { w = sw; h = sh; render(); return renderer.domElement.toDataURL('image/jpeg', 0.8); },
  };
  /** @type {any} */ (window).bc = bc;
  return bc;
}
