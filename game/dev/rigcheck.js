// @ts-check
/**
 * 小傀儡模型检查页（只给本机预览面板用：python tools/build_preview.py rigs --asset public/models/grunt.rig.gz --asset preview/assets/grunt-192.webp）。
 * 游戏页加上模型就超过面板 512 KB 的上限，所以单拎出来：同一套天光、广场和敌人代码（actors/enemies.js），
 * 摆出三种小怪的几种状态看动作对不对、挂件挂没挂上、染色认不认得出。游戏本身不引用这个文件。
 * 中间一排（左→右）：小傀儡待机、符箓傀儡出拳（蓄力）、铁头傀儡发晕、小傀儡冻住（走了一秒再冻）；
 * 外圈绕着走：小傀儡慢走、小傀儡快跑、符箓傀儡倒退（背着前进方向挪）、铁头傀儡冲锋。
 * 调试接口 window.rc：view('front' | 'close' | 'side' | 'top')、pause(true/false)、step(秒) 定步推进、snap(w, h) 返回 JPEG 地址、list 全部敌人。
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Enemies } from '../actors/enemies.js';
import { loadRig } from '../actors/rig.js';
import { GradePass } from '../fx/grade.js';
import { ENEMIES } from '../rules/numbers.js';
import { TIERS } from '../quality.js';
import { buildEnvironment } from '../world/environment.js';
import { buildLayout } from '../world/layout.js';

const C = new THREE.Vector3(0, 0, 2);
/** 机位：[镜头位置, 看的点]（free 由 rc.cam 改） @type {Record<string, number[][]>} */
const VIEWS = {
  front: [[0, 3.4, 10.5], [0, 0.8, 2]],
  close: [[0, 1.6, 4.6], [0, 0.8, 2]],
  side: [[7.5, 2.2, 2], [0, 0.8, 2]],
  top: [[0, 11, 4], [0, 0, 2]],
  free: [[0, 1.6, 4.6], [0, 0.8, 2]],
};
const ORBIT = 3.4;

/** @param {HTMLElement} root @param {Record<string, string>} assets 文件名 → 地址 */
export function startRigCheck(root, assets) {
  const q = TIERS.cinema;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';   // 画布按 w×h 出图，铺满窗口显示（面板截图看的是窗口）
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

  /** 外圈的：[类型, 招, 每秒走几米, 起始角, 倒退] */
  const ring = /** @type {const} */ ([
    ['grunt', '', ENEMIES.grunt.speed, 0, false],
    ['grunt', '', 2.4, Math.PI / 2, false],
    ['archer', '', ENEMIES.archer.speed, Math.PI, true],
    ['charger', 'rush', 6, Math.PI * 1.5, false],
  ]);
  /** @type {{ e: any, v: number, a: number, back: boolean }[]} */
  const movers = [];
  let t = 0, frozenAt = Infinity, paused = false;
  // 贴图用正式的 512 就超过面板上限，检查页可以换一张缩小的（grunt-192.webp）：看颜色和挂件够了
  const tex = Object.keys(assets).find((f) => f.startsWith('grunt-') && f.endsWith('.webp'));
  const ready = loadRig(assets['grunt.rig.gz'], tex && assets[tex]).then((rig) => {
    enemies.useRig(rig);
    const row = /** @type {const} */ ([['grunt', ''], ['archer', 'aim'], ['charger', 'daze'], ['grunt', '']]);
    row.forEach(([type, act], i) => {
      const e = enemies.spawnAt(type, C.x + (i - 1.5) * 1.4, C.z, 'boss');
      e.act = act; e.dir.set(0, 0, 1);
    });
    frozenAt = t + 1;
    for (const [type, act, v, a, back] of ring) {
      const e = enemies.spawnAt(type, 0, 0, 'boss');
      e.act = act;
      movers.push({ e, v, a, back });
    }
    place(0);
    return rig;
  });

  /** 外圈的挪一步：按角速度绕圈，朝向是前进方向（倒退的反过来） @param {number} dt */
  function place(dt) {
    for (const m of movers) {
      m.a += (m.v / ORBIT) * dt;
      const x = C.x + Math.cos(m.a) * ORBIT, z = C.z + Math.sin(m.a) * ORBIT;
      m.e.pos.set(x, 0, z);
      m.e.dir.set(-Math.sin(m.a), 0, Math.cos(m.a)).multiplyScalar(m.back ? -1 : 1);
      m.e.moving = true;
    }
  }

  /** @param {number} dt */
  function tick(dt) {
    t += dt;
    place(dt);
    const last = enemies.list[3];
    if (t >= frozenAt && last) { last.frozen = 1e9; frozenAt = Infinity; }
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

  const rc = {
    ready, enemies, scene,
    get list() { return enemies.list.map((e) => ({ type: e.type, act: e.act, clip: e.rig?.cur, spd: +e.spd.toFixed(2), frozen: e.frozen > 0 })); },
    /** @param {keyof typeof VIEWS} v */
    view: (v) => { view = v; render(); return v; },
    /** 随手摆一个机位（凑近看挂件） @param {number[]} p 镜头位置 @param {number[]} t 看的点 */
    cam: (p, t) => { VIEWS.free = [p, t]; view = 'free'; render(); },
    /** @param {boolean} on */
    pause: (on) => { paused = on; },
    /** 停着时手动推进 sec 秒（每步 1/60） @param {number} sec */
    step: (sec) => { for (let s = 0; s < sec; s += 1 / 60) tick(1 / 60); render(); },
    snap: (sw = 960, sh = 540) => { w = sw; h = sh; render(); return renderer.domElement.toDataURL('image/jpeg', 0.8); },
  };
  /** @type {any} */ (window).rc = rc;
  return rc;
}
