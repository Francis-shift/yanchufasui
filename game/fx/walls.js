// @ts-check
/**
 * 墙：一条线上 5 段。
 *   - 土墙是实心石块（物理引擎里也是实体），会挡路——流场把它当障碍，敌人绕着走；8 秒后沉回地下。
 *   - 火墙、冰墙、风墙是一道帘子，不挡路；敌人穿过时挨一下（伤害和元素效果由 main 结算），4 秒后散去。
 * 这里只管样子、寿命和"现在有哪些墙"，伤害与改道在 main.js 里接。
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { canvasTex, col, PALETTE, rand, scaleArr } from './common.js';
import { rockMat, wallGeo } from './earth.js';

/** 帘子的光幕：下实上虚的竖条渐变（白天只靠粒子看不出是一堵墙，10-19 截图实测） */
let _curtainTex = null;
function curtainTex() {
  if (_curtainTex) return _curtainTex;
  _curtainTex = canvasTex(128, (g, S) => {
    const grd = g.createLinearGradient(0, S, 0, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
  });
  return _curtainTex;
}
import { groundHeightAt } from '../world/layout.js';

const SEG = { w: 1.0, h: 1.6, d: 0.6 };

/**
 * @typedef {{ el: string, pts: { x: number, z: number }[], t: number, sec: number, hit: Set<string>,
 *             meshes: THREE.Mesh[], bodies: CANNON.Body[], yaw: number, payload: any,
 *             mat?: THREE.MeshStandardMaterial, crumbled?: boolean, acc?: number }} Wall
 * mat：土墙这一堵的石块材质（熔纹各自冷却）；crumbled：土墙已经碎掉；acc：风墙往上卷的笔触攒的时间
 */
/** 土墙最后多久碎掉（碎了以后石块消失，挡路还算到时间到） */
const CRUMBLE = 0.35;

export class Walls {
  /**
   * @param {THREE.Scene} scene @param {CANNON.World} world
   * @param {import('./particles.js').Particles} particles
   */
  constructor(scene, world, particles) {
    this.scene = scene; this.world = world; this.p = particles;
    /** @type {Wall[]} */
    this.list = [];
    this.geo = wallGeo(SEG.w, SEG.h, SEG.d);
    this.shape = new CANNON.Box(new CANNON.Vec3(SEG.w / 2, SEG.h / 2, SEG.d / 2));
    /** 法术画面（主循环接上）：土墙碎成碎石、风墙往上卷的笔触要用；没接上时土墙照旧沉回地下 @type {import('./spells.js').SpellFx | null} */
    this.fx = null;
  }

  /**
   * 立一堵墙。
   * @param {string} el
   * @param {{ x: number, z: number }[]} pts 每一段的中心
   * @param {number} yaw 墙沿哪个方向排开（绕 y 轴的角度）
   * @param {number} sec 持续时间
   * @param {any} payload 结算伤害要用的东西（main 塞进来，这里不看）
   * @returns {Wall}
   */
  add(el, pts, yaw, sec, payload) {
    /** @type {Wall} */
    const w = { el, pts, t: 0, sec, hit: new Set(), meshes: [], bodies: [], yaw, payload };
    if (el === 'earth') {
      w.mat = rockMat({ heat: 1.4, veinK: 2.6, veinW: 0.03 });   // 升起时熔纹亮着，一两秒冷下去，留一点余温
      for (const p of pts) {
        const y = groundHeightAt(p.x, p.z) ?? 0;
        const m = new THREE.Mesh(this.geo, w.mat);
        m.position.set(p.x, y - SEG.h / 2, p.z);
        m.rotation.y = yaw + rand(-0.06, 0.06);
        m.castShadow = true; m.receiveShadow = true;
        this.scene.add(m);
        w.meshes.push(m);
        const body = new CANNON.Body({ type: CANNON.Body.STATIC, shape: this.shape, position: new CANNON.Vec3(p.x, y + SEG.h / 2, p.z) });
        body.quaternion.setFromEuler(0, m.rotation.y, 0);
        this.world.addBody(body);
        w.bodies.push(body);
        for (let i = 0; i < 14; i++) {   // 破土的碎石和尘
          this.p.emit(p.x + rand(-0.5, 0.5), y + 0.1, p.z + rand(-0.3, 0.3), rand(-2, 2), rand(2, 5), rand(-2, 2),
            rand(0.5, 0.9), rand(0.08, 0.16), [0.75, 0.62, 0.45], [0.45, 0.38, 0.3], { grav: -14, drag: 0.8 });
        }
      }
    } else {
      const a = pts[0], b = pts[pts.length - 1], len = Math.hypot(b.x - a.x, b.z - a.z) + 1;
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const pal = PALETTE[el] || PALETTE.arcane;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.2), new THREE.MeshBasicMaterial({
        map: curtainTex(), color: col(pal.primary, el === 'fire' ? 1.6 : 1.2), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.position.set(mid.x, (groundHeightAt(mid.x, mid.z) ?? 0) + 1.1, mid.z);
      m.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);   // 平面的宽沿墙线
      this.scene.add(m);
      w.meshes.push(m);
    }
    this.list.push(w);
    return w;
  }

  /** 土墙段的位置，给流场当障碍 */
  obstacles() {
    return this.list.filter((w) => w.el === 'earth').flatMap((w) => w.pts.map((p) => ({ x: p.x, z: p.z, r: 0.6 })));
  }

  /** 正在生效的帘子（火冰风墙） */
  curtains() { return this.list.filter((w) => w.el !== 'earth'); }

  /**
   * @param {number} dt
   * @returns {boolean} 土墙有没有增减（有的话 main 要让流场重算）
   */
  update(dt) {
    let changed = false;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const w = this.list[i];
      w.t += dt;
      if (w.el === 'earth') {
        // 0.25 秒升起；到时间前碎成一把碎石（没接上法术画面就最后 0.6 秒沉回地下）
        const up = Math.min(1, w.t / 0.25), down = this.fx ? 0 : Math.max(0, (w.t - (w.sec - 0.6)) / 0.6);
        const k = up * (1 - down);
        w.meshes.forEach((m, j) => { m.position.y = (groundHeightAt(w.pts[j].x, w.pts[j].z) ?? 0) - SEG.h / 2 + k * SEG.h; });
        if (w.mat) w.mat.userData.heat.value = 0.12 + 1.3 * Math.exp(-w.t * 2.2);
        if (this.fx && !w.crumbled && w.t >= w.sec - CRUMBLE) {
          w.crumbled = true;
          for (const m of w.meshes) m.visible = false;   // 碎石的余温跟墙一样低：0.5 时塌下来的碎石比墙还亮（实测）
          this.fx.rockDebris(w.meshes.map((m) => m.position.clone()), w.meshes.length * 7, { speed: 3, spread: 0.45, size: 0.17, life: 1.3, heat: 0.2, up: 0.5 });
          const a = w.pts[0], b = w.pts[w.pts.length - 1];
          this.fx.dust(new THREE.Vector3((a.x + b.x) / 2, groundHeightAt((a.x + b.x) / 2, (a.z + b.z) / 2) ?? 0, (a.z + b.z) / 2), 2.4, 0.6);
          this.fx.shake = Math.max(this.fx.shake, 0.12);
        }
      } else {
        this.curtain(w, dt);
      }
      if (w.t >= w.sec) {
        for (const m of w.meshes) { this.scene.remove(m); if (w.el !== 'earth') { m.geometry.dispose(); /** @type {THREE.Material} */ (m.material).dispose(); } }
        if (w.mat) w.mat.dispose();
        for (const b of w.bodies) this.world.removeBody(b);
        if (w.el === 'earth') changed = true;
        this.list.splice(i, 1);
      }
    }
    return changed;
  }

  /** 帘子的样子：沿墙线一直往上冒粒子，火是火苗、冰是寒雾、风是往上卷的气流 */
  curtain(w, dt) {
    const pal = PALETTE[w.el] || PALETTE.arcane;
    const fade = Math.min(1, w.t / 0.2) * Math.min(1, (w.sec - w.t) / 0.5);
    const sheet = w.meshes[0];
    if (sheet) /** @type {THREE.MeshBasicMaterial} */ (sheet.material).opacity = fade * (0.55 + 0.1 * Math.sin(w.t * 9));
    const a = w.pts[0], b = w.pts[w.pts.length - 1];
    if (w.el === 'wind' && this.fx) {   // 风墙：沿墙线一笔笔往上卷的青色笔触（风格卡：笔触带卷成漩涡）
      w.acc = (w.acc || 0) + dt * fade;
      for (; w.acc > 0.07; w.acc -= 0.07) {
        const k = Math.random(), x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
        this.fx.windRise(x, groundHeightAt(x, z) ?? 0, z);
      }
    }
    const n = Math.round(260 * dt * fade);
    for (let i = 0; i < n; i++) {
      const k = Math.random(), x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
      const y = groundHeightAt(x, z) ?? 0;
      if (w.el === 'wind') {
        this.p.emit(x + rand(-0.2, 0.2), y + rand(0, 0.4), z + rand(-0.2, 0.2), rand(-1.5, 1.5), rand(3, 6), rand(-1.5, 1.5),
          rand(0.4, 0.8), rand(0.08, 0.14), scaleArr(pal.secondary, 1.4), scaleArr(pal.primary, 0.7), { drag: 1.5, alpha: 0.6 });
      } else if (w.el === 'ice') {
        this.p.emit(x + rand(-0.25, 0.25), y + rand(0, 1.4), z + rand(-0.25, 0.25), rand(-0.3, 0.3), rand(0.2, 0.8), rand(-0.3, 0.3),
          rand(0.6, 1.1), rand(0.12, 0.24), scaleArr(pal.secondary, 1.5), scaleArr(pal.primary, 0.8), { drag: 1.2, alpha: 0.55 });
      } else {
        this.p.emit(x + rand(-0.2, 0.2), y + rand(0, 0.2), z + rand(-0.2, 0.2), rand(-0.4, 0.4), rand(2.5, 4.5), rand(-0.4, 0.4),
          rand(0.35, 0.7), rand(0.12, 0.22), scaleArr(pal.core, 2.2), scaleArr(pal.primary, 1.2), { drag: 1.0, grav: pal.emberGravity });
      }
    }
  }

  clear() {
    for (const w of this.list) {
      for (const m of w.meshes) { this.scene.remove(m); if (w.el !== 'earth') { m.geometry.dispose(); /** @type {THREE.Material} */ (m.material).dispose(); } }
      if (w.mat) w.mat.dispose();
      for (const b of w.bodies) this.world.removeBody(b);
    }
    const had = this.list.some((w) => w.el === 'earth');
    this.list.length = 0;
    return had;
  }

  dispose() { this.clear(); }   // 墙段的几何体是共用的（earth.js 里缓存），不释放
}

/**
 * 点到线段的水平距离（判断敌人有没有穿过帘子）。
 * @param {{ x: number, z: number }} p @param {{ x: number, z: number }} a @param {{ x: number, z: number }} b
 */
export function distToSegment(p, a, b) {
  const vx = b.x - a.x, vz = b.z - a.z, len2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / len2));
  return Math.hypot(p.x - (a.x + vx * t), p.z - (a.z + vz * t));
}
