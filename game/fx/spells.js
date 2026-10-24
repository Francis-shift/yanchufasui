// @ts-check
/**
 * 法术的画面：咏唱法阵、飞弹（直线 / 从天而降 / 绕到背后）、落点爆炸、冰棱、法则反噬。
 * 只管"看起来怎样"；打谁、打多疼由裁决器算好再传进来。
 * 灯光常驻场景、只改强度（增减灯光会让所有材质重编译，第一次施法时卡一下）。
 */
import * as THREE from 'three';
import {
  PALETTE, arcsTex, clamp01, col, easeOutBack, easeOutCubic, glowShellMat, glowTex, inkColors, perSec, rand, randDir, ringMat,
  scaleArr, sigilMat, sigilTex,
} from './common.js';

export class SpellFx {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./particles.js').Particles} particles
   * @param {THREE.Vector3} origin 施法者胸口位置
   * @param {{ ink?: import('./particles.js').Particles, quality?: import('../quality.js').Quality }} [o] ink：墨池；quality：画质档
   */
  constructor(scene, particles, origin, o = {}) {
    this.scene = scene; this.p = particles; this.origin = origin.clone();
    this.ink = o.ink || null;
    this.inkK = o.quality ? o.quality.inkK : 1;
    this.foreground = !!o.quality?.foreground;
    /** 镜头位置（主循环每帧更新）：前景光斑要摆在镜头和落点之间 */
    this.cameraPos = new THREE.Vector3(0, 8, 14);
    /** 压暗世界：dimLevel 由大招冲上去，撑 dimHold 秒后慢慢退；主循环把它交给 environment.setDim */
    this.dimLevel = 0; this.dimHold = 0;
    /** 冲击后期：impactK 一瞬间冲到 1 再很快衰减（主循环按真实时间衰减，慢放、定格时不糊着不走），impactPos 是落点 */
    this.impactK = 0; this.impactPos = new THREE.Vector3();
    /** @type {{ update(dt: number): boolean, dispose(): void }[]} */
    this.fx = [];
    this.shake = 0;
    this.hitStop = 0;
    this.orbLight = new THREE.PointLight(0xffffff, 0, 0, 2);
    this.blastLight = new THREE.PointLight(0xffffff, 0, 0, 2);
    scene.add(this.orbLight, this.blastLight);
    this.blastT = -1;

    // 施法者脚下常驻法阵：开口就亮，回车后按猜到的元素上色，咏唱时转得更快
    this.groundSigil = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), sigilMat(sigilTex(), col(PALETTE.arcane.primary, 1.2)));
    this.groundSigil.rotation.x = -Math.PI / 2;
    this.groundSigil.position.set(origin.x, 0.03, origin.z);
    scene.add(this.groundSigil);
    this.chantEl = 'arcane';
    this.chantColor = col(PALETTE.arcane.primary, 1.2);
    this.chanting = 0;       // 0～1，咏唱时升高
    this.listening = 0;      // 0～1，玩家在输入时升高
    this.idleT = 0;
  }

  /** 回车瞬间：按关键词猜的元素先上色（猜不出用法阵本色：我方的金） @param {string} el */
  beginChant(el) {
    this.chantEl = PALETTE[el] ? el : 'arcane';
    this.chantColor = col(PALETTE[this.chantEl].primary, 1.4);
    this.chanting = 1;
  }

  /** 模型结果回来后元素和猜的不一样，就平滑过渡过去 @param {string} el */
  retint(el) { if (PALETTE[el] && el !== this.chantEl) this.beginChant(el); }

  endChant() { this.chanting = 0; }

  /** @param {boolean} on */
  setListening(on) { this.listening = on ? 1 : 0; }

  /** 压暗世界一段时间（取较大的那个，不叠加）@param {number} level 0～1 @param {number} hold 秒 */
  pulseDim(level, hold) {
    if (level >= this.dimLevel) { this.dimLevel = level; this.dimHold = Math.max(this.dimHold, hold); }
  }

  /** 冲击后期（径向模糊、色散）@param {THREE.Vector3} p @param {number} k 0～1 */
  impact(p, k) {
    if (k >= this.impactK * 0.6) { this.impactK = Math.max(this.impactK, k); this.impactPos.copy(p); }
  }

  /**
   * 墨：随冲击飞散的小墨点，加几团慢慢胀开的墨烟把亮色框住（特效风格 v2）。
   * 元素的 ink 系数与画质档的 inkK 决定多少；没有墨池（检查页之类）就不画。
   * @param {THREE.Vector3} p @param {string} el @param {number} R 爆炸半径 @param {number} scale
   */
  inkSplash(p, el, R, scale) {
    const pal = PALETTE[el];
    const k = (pal.ink ?? 0.6) * this.inkK;
    if (!this.ink || k <= 0) return;
    const { a, b } = inkColors(pal.primary);
    for (let i = Math.round(46 * scale * k); i > 0; i--) {
      const d = randDir(); d.y = Math.abs(d.y) * 0.8 + 0.2;
      const v = d.multiplyScalar(rand(4, 13) * Math.sqrt(scale));
      this.ink.emit(p.x, p.y + 0.15, p.z, v.x, v.y, v.z, rand(0.5, 1.1), rand(0.07, 0.2), a, b,
        { drag: 1.3, grav: -10, alpha: 0.9, grow: 0.8 });
    }
    for (let i = Math.round(9 * scale * k); i > 0; i--) {
      const ang = Math.random() * Math.PI * 2, r = rand(0.3, R * 0.9);
      this.ink.emit(p.x + Math.cos(ang) * r, p.y + rand(0.2, 1.4), p.z + Math.sin(ang) * r,
        Math.cos(ang) * rand(0.6, 2.2), rand(0.3, 1.3), Math.sin(ang) * rand(0.6, 2.2),
        rand(1.1, 2.1), rand(0.7, 1.5) * Math.sqrt(scale), a, b, { drag: 1.4, alpha: 0.5, grow: 2.3 });
    }
  }

  /**
   * 前景光斑（电影档）：镜头和落点之间、偏到画面两侧的几颗大而虚的光点，慢慢飘——参考里的"粒子分前中后三层"。
   * @param {THREE.Vector3} p @param {string} el @param {number} scale
   */
  foregroundBokeh(p, el, scale) {
    if (!this.foreground) return;
    const pal = PALETTE[el];
    const toP = p.clone().sub(this.cameraPos);
    const side = new THREE.Vector3(-toP.z, 0, toP.x).normalize();
    for (let i = Math.round(7 * Math.min(scale, 2)); i > 0; i--) {
      const q = this.cameraPos.clone().addScaledVector(toP, rand(0.22, 0.5))
        .addScaledVector(side, (Math.random() < 0.5 ? -1 : 1) * rand(1.2, 3.2)).add(new THREE.Vector3(0, rand(-0.8, 1.2), 0));
      this.p.emit(q.x, q.y, q.z, rand(-0.3, 0.3), rand(-0.1, 0.4), rand(-0.3, 0.3), rand(1.4, 2.4), rand(0.25, 0.6),
        scaleArr(pal.secondary, 0.9), scaleArr(pal.primary, 0.5), { alpha: 0.22, drag: 0.8, grow: 1.4 });
    }
  }

  /** 通用：挂一个有时长的特效 */
  addTimed(obj, duration, step) {
    this.scene.add(obj);
    let t = 0;
    this.fx.push({
      update: (dt) => { t += dt; const k = Math.min(t / duration, 1); step(k, t); return k < 1; },
      dispose: () => { this.scene.remove(obj); obj.traverse((o) => { if (o.material) o.material.dispose(); }); },
    });
  }

  /**
   * 发一颗飞弹。target() 每帧给出当前目标点（敌人在动）；到达时调用 onHit(落点)。
   * @param {{ el: string, path: string, delay?: number, target: () => THREE.Vector3, onHit: (p: THREE.Vector3) => void, big?: boolean }} o
   */
  bolt(o) {
    const pal = PALETTE[o.el];
    const orb = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(o.big ? 0.24 : 0.16, 20, 14), new THREE.MeshBasicMaterial({ color: col(pal.core, 3.2), fog: false }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: col(pal.primary, 1.4),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    halo.scale.setScalar(o.big ? 2 : 1.4);
    orb.add(core, halo);
    orb.visible = false;
    this.scene.add(orb);
    const start = this.origin.clone();
    const end = o.target().clone();
    const dist = start.distanceTo(end);
    const fly = THREE.MathUtils.clamp(dist / 24, 0.35, 0.95) * (o.path === 'behind' ? 1.5 : 1);
    let t = -(o.delay || 0), prev = start.clone(), done = false;
    const pos = new THREE.Vector3();
    const side = Math.random() < 0.5 ? -1 : 1;
    this.fx.push({
      update: (dt) => {
        t += dt;
        if (t < 0) return true;
        orb.visible = true;
        const k = Math.min(t / fly, 1);
        end.lerp(o.target(), 0.25);        // 跟着目标走
        if (o.path === 'sky') {
          // 从目标正上方高处砸下来
          const top = end.clone().add(new THREE.Vector3(0, 16, 2));
          const kk = k * k;
          pos.copy(top).lerp(end, kk);
          if (k < 0.15) pos.lerp(start, (0.15 - k) / 0.15 * 0.5);
        } else if (o.path === 'behind') {
          // 绕到目标背后（远离阵眼一侧）再打回来
          const ctrl = end.clone().add(new THREE.Vector3(side * 7, 3, -8));
          const a = start.clone().lerp(ctrl, k), b = ctrl.clone().lerp(end, k);
          pos.copy(a).lerp(b, k);
        } else {
          const e = k * k * (1.6 - 0.6 * k);
          pos.copy(start).lerp(end, e);
          pos.y += Math.sin(Math.PI * e) * 0.9;
        }
        orb.position.copy(pos);
        halo.scale.setScalar((o.big ? 2 : 1.4) + Math.sin(t * 40) * 0.12);
        this.orbLight.position.copy(pos);
        this.orbLight.color.copy(col(pal.primary));
        this.orbLight.intensity = 26;
        const seg = pos.clone().sub(prev);
        const steps = Math.min(60, Math.ceil(seg.length() * 22));   // 按飞过的距离撒粒子，慢动作下密度不变
        for (let i = 0; i < steps; i++) {
          const q = prev.clone().addScaledVector(seg, i / steps);
          this.p.emit(q.x + rand(-0.05, 0.05), q.y + rand(-0.05, 0.05), q.z + rand(-0.05, 0.05),
            rand(-0.6, 0.6), rand(-0.3, 0.9), rand(-0.6, 0.6), rand(0.3, 0.55), rand(0.1, 0.2),
            scaleArr(pal.secondary, 1.8), scaleArr(pal.primary, 1.1), { drag: 2.5, grav: pal.emberGravity * 0.5, alpha: 0.85 });
        }
        // 墨重的元素（火的黑烟、土、雷）沿路留一点墨迹
        if (this.ink && (pal.ink ?? 0) >= 0.75 && Math.random() < steps * 0.04 * this.inkK) {
          const ic = inkColors(pal.primary);
          this.ink.emit(pos.x, pos.y, pos.z, rand(-0.4, 0.4), rand(-0.1, 0.5), rand(-0.4, 0.4), rand(0.5, 0.9), rand(0.12, 0.28),
            ic.a, ic.b, { drag: 2, alpha: 0.45, grow: 1.8 });
        }
        prev.copy(pos);
        if (k >= 1 && !done) { done = true; this.orbLight.intensity = 0; o.onHit(pos.clone()); return false; }
        return true;
      },
      dispose: () => { this.scene.remove(orb); core.material.dispose(); halo.material.dispose(); },
    });
  }

  /** 发射瞬间的一圈火花 */
  launchBurst(el) {
    const pal = PALETTE[el];
    for (let i = 0; i < 50; i++) {
      const v = randDir().multiplyScalar(rand(2, 6));
      this.p.emit(this.origin.x, this.origin.y, this.origin.z, v.x, v.y, v.z, rand(0.3, 0.6), rand(0.06, 0.12),
        scaleArr(pal.core, 4), scaleArr(pal.secondary, 1.5), { drag: 3 });
    }
    this.shake = Math.max(this.shake, 0.06);
  }

  /**
   * 落点爆炸。scale：小命中 0.45，爆 1，大招以后更大。
   * @param {THREE.Vector3} p @param {string} el @param {number} radius @param {number} [scale]
   */
  burst(p, el, radius, scale = 1) {
    const pal = PALETTE[el];
    const P = col(pal.primary, 2.5), S = col(pal.secondary, 2.2);
    const R = radius;
    this.blastLight.position.set(p.x, p.y + 0.6, p.z);
    this.blastLight.color.copy(col(pal.primary));
    this.blastT = 0; this.blastBoost = scale;
    this.shake = Math.max(this.shake, 0.4 * scale);
    this.hitStop = Math.max(this.hitStop, 0.05 * Math.min(scale, 1.2));   // 顿帧
    this.impact(p, Math.min(1, 0.35 + 0.45 * scale));
    if (scale >= 0.9) this.pulseDim(Math.min(0.75, 0.32 + 0.3 * (scale - 0.9)), 0.25 + 0.2 * scale);
    this.inkSplash(p, el, R, scale);
    this.foregroundBokeh(p, el, scale);
    const n = Math.round(420 * scale);
    for (let i = 0; i < n; i++) {
      const d = randDir(); d.y = Math.abs(d.y) * 0.9 + 0.1;
      const v = d.multiplyScalar(rand(3, 15) * Math.sqrt(scale));
      this.p.emit(p.x, p.y, p.z, v.x, v.y, v.z, rand(0.5, 1.3), rand(0.05, 0.12),
        scaleArr(pal.core, 2.6), scaleArr(pal.primary, 1.4), { drag: 1.6, grav: pal.sparkGravity });
    }
    for (let i = 0; i < 50 * scale; i++) {
      const v = randDir().multiplyScalar(rand(1.2, 4.5));
      this.p.emit(p.x, p.y, p.z, v.x, v.y * 0.6 + 0.6, v.z, rand(0.7, 1.5), rand(0.5, 1.1),
        scaleArr(pal.primary, 0.8), scaleArr(pal.secondary, 0.3), { alpha: 0.16, drag: 1.8 });
    }
    if (el === 'wind') {
      // 风：一圈向外卷的气流
      for (let i = 0; i < 160 * scale; i++) {
        const a = Math.random() * Math.PI * 2, r = rand(0.3, R);
        this.p.emit(p.x + Math.cos(a) * r, p.y + rand(0, 1.5), p.z + Math.sin(a) * r,
          Math.cos(a) * 9 - Math.sin(a) * 6, rand(0.5, 2), Math.sin(a) * 9 + Math.cos(a) * 6,
          rand(0.4, 0.8), rand(0.08, 0.16), scaleArr(pal.secondary, 1.6), scaleArr(pal.primary, 0.8), { drag: 2.2, alpha: 0.7 });
      }
    }
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), glowShellMat(col(pal.secondary, 1.2)));
    flash.material.uniforms.uFill.value = 0.04;      // 只亮边缘，中间通透，像一层冲击波壳
    flash.position.copy(p);
    this.addTimed(flash, 0.4, (k) => {
      flash.scale.setScalar(0.3 + easeOutCubic(k) * R * 0.8);
      flash.material.uniforms.uAlpha.value = Math.pow(1 - k, 2.5);
    });
    for (const [delay, size, dur] of [[0, R * 3.2, 0.85], [0.08, R * 2.1, 1.1]]) {
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMat(delay ? S.clone() : P.clone()));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, p.y + 0.05, p.z);
      ring.scale.setScalar(0.01);
      this.addTimed(ring, dur + delay, (k, t) => {
        const q = clamp01((t - delay) / dur);          // 超过 1 会让 pow 出 NaN，泛光会把它放大成黑块
        ring.scale.setScalar(0.01 + easeOutCubic(q) * size);
        ring.material.uniforms.uAlpha.value = q > 0 ? Math.pow(1 - q, 1.6) * 1.4 : 0;
      });
    }
    if (scale >= 0.9) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 10, 28, 1, true), glowShellMat(col(pal.primary, 1.6), 1));
      pillar.geometry.translate(0, 5, 0);
      pillar.position.set(p.x, p.y, p.z);
      this.addTimed(pillar, 0.9, (k) => {
        const w = 0.3 + easeOutCubic(k) * 1.2;
        pillar.scale.set(w, 0.4 + easeOutCubic(Math.min(k * 3, 1)) * 0.8, w);
        pillar.material.uniforms.uAlpha.value = Math.pow(1 - k, 2) * 0.9;
      });
      const seal = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sigilMat(sigilTex(), P.clone()));
      seal.rotation.x = -Math.PI / 2;
      seal.position.set(p.x, p.y + 0.04, p.z);
      this.addTimed(seal, 2.6, (k, t) => {
        seal.scale.setScalar(R * 1.3 * easeOutBack(Math.min(t * 3, 1)) + 0.01);
        seal.rotation.z = t * 0.5;
        seal.material.opacity = k < 0.15 ? k / 0.15 : Math.pow(1 - (k - 0.15) / 0.85, 1.5);
      });
    }
    if (el === 'ice') this.frostShards(p, Math.round(14 * scale), Math.max(scale, 0.5));
    if (el === 'thunder' && scale >= 0.9) {
      // 雷爆：几道闪电从天上劈进爆圈里
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2, r = rand(0, R * 0.7);
        const end = new THREE.Vector3(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r);
        this.arc(end.clone().add(new THREE.Vector3(rand(-2, 2), 14, rand(-2, 2))), end, { delay: i * 0.06 });
      }
    }
  }

  /**
   * 一道闪电：从 a 到 b 的一条折线（中段抖得最厉害），0.3 秒里闪两下就灭，沿线撒电火花、落点亮一下。
   * 白天背景很亮，一像素的发光线叠上去就看不见：做成两层管子——白芯（泛光）+ 半透明的紫色外壳（在亮处也有对比）。
   * @param {THREE.Vector3} a @param {THREE.Vector3} b @param {{ delay?: number, jitter?: number }} [o]
   */
  arc(a, b, o = {}) {
    const pal = PALETTE.thunder;
    const len = a.distanceTo(b), n = Math.max(6, Math.round(len * 2.2));
    const jitter = o.jitter ?? Math.min(0.9, 0.12 + len * 0.05);
    const dir = b.clone().sub(a);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const q = a.clone().addScaledVector(dir, i / n);
      if (i > 0 && i < n) q.add(randDir().multiplyScalar(jitter * Math.sin((Math.PI * i) / n) + 0.04));
      pts.push(q);
    }
    const path = /** @type {THREE.CurvePath<THREE.Vector3>} */ (new THREE.CurvePath());
    for (let i = 0; i < n; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    const coreGeo = new THREE.TubeGeometry(path, n * 2, 0.05, 5, false);
    const shellGeo = new THREE.TubeGeometry(path, n * 2, 0.16, 6, false);
    const coreMat = new THREE.MeshBasicMaterial({ color: col(pal.core, 3.2), transparent: true, opacity: 0, fog: false, depthWrite: false });
    const mat = new THREE.MeshBasicMaterial({ color: col([0.42, 0.28, 1.0], 1.1), transparent: true, opacity: 0, fog: false, depthWrite: false });
    const line = new THREE.Group();
    line.add(new THREE.Mesh(shellGeo, mat), new THREE.Mesh(coreGeo, coreMat));
    this.scene.add(line);
    let t = -(o.delay || 0), lit = false;
    this.fx.push({
      update: (dt) => {
        t += dt;
        if (t < 0) return true;
        if (!lit) {
          lit = true;
          for (const q of pts) {
            for (let k = 0; k < 3; k++) {
              this.p.emit(q.x, q.y, q.z, rand(-1, 1), rand(-1, 1), rand(-1, 1), rand(0.1, 0.22), rand(0.05, 0.11),
                scaleArr(pal.core, 3), scaleArr(pal.primary, 1.6), { drag: 5, alpha: 0.9 });
            }
          }
          for (let k = 0; k < 18; k++) {
            const v = randDir().multiplyScalar(rand(2, 7));
            this.p.emit(b.x, b.y, b.z, v.x, Math.abs(v.y), v.z, rand(0.2, 0.45), rand(0.04, 0.08),
              scaleArr(pal.secondary, 3), scaleArr(pal.primary, 1.2), { drag: 2.5, grav: pal.sparkGravity });
          }
          this.blastLight.position.copy(b).setY(b.y + 0.8);
          this.blastLight.color.copy(col(pal.primary));
          this.blastT = 0; this.blastBoost = 0.5;
          this.shake = Math.max(this.shake, 0.12);
          this.impact(b, 0.35);
          if (this.ink) {   // 落雷处溅起墨点（沧元图式：亮线配墨点）
            const ic = inkColors(pal.primary);
            for (let k = Math.round(14 * this.inkK); k > 0; k--) {
              const v = randDir().multiplyScalar(rand(2, 8));
              this.ink.emit(b.x, b.y + 0.1, b.z, v.x, Math.abs(v.y) + 1, v.z, rand(0.4, 0.8), rand(0.05, 0.14), ic.a, ic.b, { drag: 1.5, grav: -10, alpha: 0.85, grow: 0.8 });
            }
          }
        }
        const k = t / 0.32;
        const a1 = k < 0.25 ? 1 : k < 0.4 ? 0.15 : k < 0.55 ? 0.95 : Math.max(0, 1 - k);   // 闪两下
        coreMat.opacity = a1;
        mat.opacity = a1 * 0.6;
        return k < 1;
      },
      dispose: () => { this.scene.remove(line); coreGeo.dispose(); shellGeo.dispose(); coreMat.dispose(); mat.dispose(); },
    });
  }

  /** 寒冰：地面炸出一圈冰棱 */
  frostShards(p, count, k) {
    const pal = PALETTE.ice;
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    const shards = [];
    for (let i = 0; i < count; i++) {
      const h = rand(0.8, 2.0) * k;
      const m = new THREE.Mesh(new THREE.ConeGeometry(rand(0.1, 0.2) * k, h, 5).translate(0, h / 2, 0),
        new THREE.MeshStandardMaterial({ color: 0xcfefff, emissive: col(pal.primary), emissiveIntensity: 1.2,
          roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 }));
      const a = (i / count) * Math.PI * 2 + rand(-0.15, 0.15), r = rand(0.5, 2.0) * k;
      m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      m.rotation.set(Math.sin(a) * rand(0.3, 0.7), 0, -Math.cos(a) * rand(0.3, 0.7));
      m.castShadow = true;
      shards.push(m); g.add(m);
    }
    this.addTimed(g, 2.4, (kk, t) => {
      shards.forEach((m, i) => {
        const grow = easeOutBack(clamp01(t * 6 - i * 0.05));
        const fade = kk > 0.7 ? 1 - (kk - 0.7) / 0.3 : 1;
        m.scale.set(1, Math.max(grow * fade, 0.001), 1);
        m.material.opacity = 0.92 * fade;
      });
    });
  }

  /** 法则反噬：脚下法阵染红、碎裂成红色碎片 */
  backlash() {
    const red = [1.6, 0.15, 0.1];
    const o = this.origin;
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(0.2, 2.1);
      this.p.emit(o.x + Math.cos(a) * r, 0.1, o.z + Math.sin(a) * r, Math.cos(a) * rand(1, 5), rand(2, 6), Math.sin(a) * rand(1, 5),
        rand(0.5, 1.1), rand(0.06, 0.14), red, [0.4, 0.02, 0.02], { drag: 1.2, grav: -9 });
    }
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), sigilMat(arcsTex(), new THREE.Color(1.8, 0.2, 0.15)));
    crack.rotation.x = -Math.PI / 2;
    crack.position.set(o.x, 0.05, o.z);
    this.addTimed(crack, 1.2, (k) => {
      crack.scale.setScalar(1 + k * 0.6);
      crack.material.opacity = Math.pow(1 - k, 1.5);
      crack.rotation.z = k * 2;
    });
    this.shake = Math.max(this.shake, 0.5);
  }

  /** @param {number} dt */
  update(dt) {
    this.idleT += dt;
    for (let i = this.fx.length - 1; i >= 0; i--) if (!this.fx[i].update(dt)) { this.fx[i].dispose(); this.fx.splice(i, 1); }
    // 脚下法阵：输入时亮起，咏唱时更亮、转得更快，颜色向当前元素过渡
    const target = this.chanting ? 1 : this.listening ? 0.55 : 0.22;
    const m = this.groundSigil.material;
    m.opacity += (target - m.opacity) * Math.min(1, dt * 8);
    m.color.lerp(this.chanting ? this.chantColor : col(PALETTE.arcane.primary, 1.2), Math.min(1, dt * 10));
    this.groundSigil.rotation.z += dt * (0.15 + (this.chanting ? 3 : this.listening ? 0.8 : 0));
    if (this.chanting) {
      const pal = PALETTE[this.chantEl];
      for (let i = perSec(220, dt); i > 0; i--) {
        const a = Math.random() * Math.PI * 2, r = rand(1.4, 2.0);
        this.p.emit(this.origin.x + Math.cos(a) * r, 0.1, this.origin.z + Math.sin(a) * r,
          -Math.cos(a) * 1.2, rand(1.5, 3), -Math.sin(a) * 1.2, rand(0.5, 0.8), rand(0.05, 0.09),
          scaleArr(pal.secondary, 1.8), scaleArr(pal.primary, 1.4), { drag: 0.6, alpha: 0.9 });
      }
    }
    if (this.blastT >= 0) {
      this.blastT += dt;
      this.blastLight.intensity = (200 * Math.exp(-this.blastT * 12) + 6 * Math.exp(-this.blastT * 1.8)) * (this.blastBoost || 1);
      if (this.blastT > 4) { this.blastT = -1; this.blastLight.intensity = 0; }
    }
    this.shake *= Math.exp(-dt * 5.5);
    if (this.dimHold > 0) this.dimHold -= dt; else this.dimLevel *= Math.exp(-dt * 1.6);
  }
}
