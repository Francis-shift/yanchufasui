// @ts-check
/**
 * 施法者模型检查页（只给本机预览面板用：python tools/build_preview.py casters --asset public/models/caster.rig.gz --asset preview/assets/caster-192.webp）。
 * 模型 159 KB，塞进游戏页或小傀儡检查页都超过面板 512 KB 的上限，所以只摆一块地、两盏灯、几份人物（actors/caster.js 原样驱动），
 * 看动作对不对、走跑脚滑不滑、边跑边放是不是只换上半身、放招时转没转过去。游戏本身不引用这个文件。
 * 前排（左→右）：站着、蓄力 1.5 秒后出掌（反复）、轮流朝左右出掌（看转身）、闪避（反复）、残影（第二份闪避那一刻的姿势，冷蓝）；
 * 外圈绕着走：慢走、试炼的跑速、边跑边出掌。
 * 调试接口 window.cc：view('front' | 'back' | 'close' | 'side' | 'top')、pause(true/false)、step(秒) 定步推进、snap(w, h) 返回 JPEG 地址、list 每份在放什么。
 */
import * as THREE from 'three';
import { Caster } from '../actors/caster.js';
import { loadRig } from '../actors/rig.js';
import { TRIAL } from '../rules/numbers.js';

const C = new THREE.Vector3(0, 0, 0);
/** 机位：[镜头位置, 看的点]（free 由 cc.cam 改） @type {Record<string, number[][]>} */
const VIEWS = {
  front: [[0, 3.2, 10], [0, 1, 0]],
  back: [[0, 3.2, -10], [0, 1, 0]],
  close: [[0, 1.5, 4.2], [0, 1, 1.5]],
  side: [[9, 2.2, 0], [0, 1, 0]],
  top: [[0, 13, 2], [0, 0, 0]],
  free: [[0, 1.5, 4.2], [0, 1, 1.5]],
};
const ORBIT = 4.2;
const ROW_Z = 1.5;

/** @param {HTMLElement} root @param {Record<string, string>} assets 文件名 → 地址 */
export function startCasterCheck(root, assets) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';
  root.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc9d6e2);
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xeef4ff, 0x6b6257, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(5, 9, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.9 }));
  ground.receiveShadow = true;
  scene.add(ground);
  // 地上画几道 1 米的刻度线：看走跑时脚有没有打滑
  const lines = new THREE.Group();
  for (let i = -8; i <= 8; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9a9284 }));
    m.position.set(i, 0.005, 0);
    lines.add(m);
  }
  scene.add(lines);

  /** 一份人物：和游戏里一样，组里先放一个胶囊占位（袍子材质），模型到了换掉 */
  const make = () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 4, 12), new THREE.MeshStandardMaterial({ color: 0xe8eef5, roughness: 0.8 })));
    scene.add(g);
    return new Caster(g);
  };
  /** 前排：每 3 秒蓄力 1.5 秒再出掌、每 2 秒换一边出掌、每 1.5 秒闪避一次（见 tick） */
  const row = ['站着', '蓄力→出掌', '左右出掌', '闪避'];
  const front = row.map((name, i) => { const c = make(); c.group.position.set(C.x + (i - 2) * 1.6, 0, ROW_Z); return { name, c }; });
  /** 外圈：[名字, 每秒走几米, 起始角, 边跑边出掌] */
  const ring = /** @type {const} */ ([['慢走', 1.2, 0, false], ['试炼跑速', TRIAL.speed, (Math.PI * 2) / 3, false], ['边跑边出掌', TRIAL.speed, (Math.PI * 4) / 3, true]]);
  const movers = ring.map(([name, v, a, cast]) => ({ name, v, a, cast, c: make() }));
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x5aa8ff, transparent: true, opacity: 0.55, depthWrite: false });
  /** @type {THREE.Object3D | null} */
  let ghost = null;
  let t = 0, paused = false, side = 1;
  const all = [...front.map((f) => f.c), ...movers.map((m) => m.c)];

  const tex = Object.keys(assets).find((f) => f.startsWith('caster-') && f.endsWith('.webp'));
  const ready = loadRig(assets['caster.rig.gz'], tex && assets[tex]).then((rig) => {
    for (const c of all) c.use(rig);
    for (const f of front) f.c.yaw = 0;   // 前排面朝镜头（游戏里守关是背对镜头、面朝山门）
    place(0);
    return rig;
  });

  /** 外圈的挪一步：按角速度绕圈（朝向由 Caster 按位移自己转） @param {number} dt */
  function place(dt) {
    for (const m of movers) {
      m.a += (m.v / ORBIT) * dt;
      m.c.group.position.set(C.x + Math.cos(m.a) * ORBIT, 0, C.z + Math.sin(m.a) * ORBIT);
    }
  }

  /** 每隔 every 秒到点一次 @param {number} prev @param {number} every @param {number} [off] */
  const due = (prev, every, off = 0) => every > 0 && Math.floor((t - off) / every) > Math.floor((prev - off) / every);

  /** @param {number} dt */
  function tick(dt) {
    const prev = t;
    t += dt;
    place(dt);
    const [, charger, turner, dodger] = front.map((f) => f.c);
    if (due(prev, 3)) charger.charge();
    if (due(prev, 3, 1.5)) charger.cast({ x: charger.group.position.x, z: 9 });
    if (due(prev, 2)) { side = -side; const p = turner.group.position; turner.cast({ x: p.x + side * 5, z: p.z + 2 }); }
    if (due(prev, 1.5)) dodger.dodge();
    if (due(prev, 1.5, 0.25)) {   // 残影：闪避开始 0.25 秒时的姿势，摆在闪避那份的右边
      const g = dodger.ghost(ghostMat);
      if (g && !ghost) { ghost = g; scene.add(g); }
      if (ghost) { ghost.position.copy(dodger.group.position).setX(dodger.group.position.x + 1.6); ghost.quaternion.copy(dodger.group.quaternion); }
    }
    for (const m of movers) if (m.cast && due(prev, 1.5)) m.c.cast(null);
    for (const c of all) c.update(dt, true);
  }

  let w = 960, h = 540, view = /** @type {keyof typeof VIEWS} */ ('front');
  const render = () => {
    if (renderer.domElement.width !== w || renderer.domElement.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    const [p, at] = VIEWS[view];
    camera.position.set(...p); camera.lookAt(new THREE.Vector3(...at));
    renderer.render(scene, camera);
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

  const cc = {
    ready, scene, all,
    get list() {
      const one = (/** @type {Caster} */ c) => ({ base: c.r?.cur, act: c.cur, w: Object.fromEntries(Object.entries(c.acts).map(([k, o]) => [k, +o.w.toFixed(2)])),
        spd: +c.speed.toFixed(2), yaw: +c.yaw.toFixed(2) });
      return [...front.map((f) => ({ name: f.name, ...one(f.c) })), ...movers.map((m) => ({ name: m.name, ...one(m.c) }))];
    },
    /** @param {keyof typeof VIEWS} v */
    view: (v) => { view = v; render(); return v; },
    /** @param {number[]} p 镜头位置 @param {number[]} at 看的点 */
    cam: (p, at) => { VIEWS.free = [p, at]; view = 'free'; render(); },
    /** @param {boolean} on */
    pause: (on) => { paused = on; },
    /** 停着时手动推进 sec 秒（每步 1/60） @param {number} sec */
    step: (sec) => { for (let s = 0; s < sec; s += 1 / 60) tick(1 / 60); render(); },
    snap: (sw = 960, sh = 540) => { w = sw; h = sh; render(); return renderer.domElement.toDataURL('image/jpeg', 0.8); },
  };
  /** @type {any} */ (window).cc = cc;
  return cc;
}
