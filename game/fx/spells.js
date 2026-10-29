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
import { fireball, scorchTextures } from './fire.js';
import { chipGeo, crystalGeo, frostTexture, iceMaterial } from './ice.js';
import { Trail, crescent, helix, scroll, stroke } from './wind.js';
import { chunkGeo, crackTextures, rockMat } from './earth.js';

const _plane = new THREE.PlaneGeometry(1, 1);

/** 一笔从写出来到擦掉（风的笔触）：前一半写到头，三成以后从尾巴开始擦 @param {THREE.ShaderMaterial} mat @param {number} t 这一笔自己的时间 @param {number} dur */
function sweepAt(mat, t, dur) {
  const u = mat.uniforms;
  u.uHead.value = easeOutCubic(clamp01(t / (dur * 0.5)));
  u.uTail.value = Math.pow(clamp01((t - dur * 0.32) / (dur * 0.68)), 1.4);
}

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
    /** 某处地面高度（主循环接上 layout 的 groundHeightAt；null 是悬空）：焦痕只落在平地上 @type {(x: number, z: number) => number | null} */
    this.groundAt = () => 0;
    this.scorchCount = 0;
    this.frostCount = 0;
    this.crackCount = 0;
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
    /** 音效（主循环接上；检查页之类没有就不出声）：放出、飞、炸、劈、裂地、反噬在这里出声 @type {import('./sound.js').Sound | null} */
    this.sound = null;
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
    // 挂上就先按 t = 0 摆一次：在别的特效的回调里挂上的，要到下一帧才轮到 update，中间会先画一帧没摆过的样子
    // （实例化的碎块全叠在原点、笔触整条画满）
    step(0, 0);
    this.fx.push({
      update: (dt) => { t += dt; const k = Math.min(t / duration, 1); step(k, t); return k < 1; },
      // 几何体多半是共用的不释放；风的笔触一笔一个几何体（userData.ownGeo），跟着释放
      dispose: () => { this.scene.remove(obj); obj.traverse((o) => { if (o.material) o.material.dispose(); if (o.userData.ownGeo) o.geometry.dispose(); }); },
    });
  }

  /**
   * 发一颗飞弹。target() 每帧给出当前目标点（敌人在动）；到达时调用 onHit(落点)。from：从哪飞出（默认施法者胸口；字诀「回」从落点飞回来）
   * @param {{ el: string, path: string, delay?: number, target: () => THREE.Vector3, onHit: (p: THREE.Vector3) => void, big?: boolean,
   *           from?: THREE.Vector3 }} o
   */
  bolt(o) {
    const pal = PALETTE[o.el];
    const orb = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(o.big ? 0.24 : 0.16, 20, 14), new THREE.MeshBasicMaterial({ color: col(pal.core, 3.2), fog: false }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: col(pal.primary, 1.4),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    halo.scale.setScalar(o.big ? 2 : 1.4);
    orb.add(core, halo);
    // 火：外面裹一团翻卷的火（里白外红、往后拖彗尾），白芯缩小藏在里面
    const fire = o.el === 'fire', fb = fire ? fireball() : null;
    if (fb) {
      fb.scale.setScalar(o.big ? 0.42 : 0.3); orb.add(fb); core.visible = false; halo.material.color.copy(col(pal.primary, 0.55));
      fb.material.uniforms.uHeat.value = 1.5;   // 飞着的火团比炸开时更热：正中白黄、边上橙红（1 的话整团是哑光的橙，实测）
      fb.material.uniforms.uAmp.value = 0.45;
    }
    // 冰：一根顺着飞行方向、自己转着的冰锥（半透明切面），白芯藏起来
    const ice = o.el === 'ice', spear = ice ? new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), iceMaterial()) : null;
    if (spear) {
      spear.scale.set(0.17, 0.7, 0.17).multiplyScalar(o.big ? 1.3 : 1);
      orb.add(spear); core.visible = false;
    }
    // 风：一道往前凸的青色风刃（笔触），两个尖和正中各拖一条笔触，白芯藏起来
    const wind = o.el === 'wind', bladeR = o.big ? 0.62 : 0.45;
    const blade = wind ? stroke(crescent(bladeR), o.big ? 0.14 : 0.1) : null;
    const trails = wind ? [new Trail(22, o.big ? 0.07 : 0.05), new Trail(22, o.big ? 0.07 : 0.05), new Trail(28, o.big ? 0.1 : 0.075)] : [];
    if (blade) { orb.add(blade); core.visible = false; for (const tr of trails) this.scene.add(tr.mesh); }
    const tipA = new THREE.Vector3(Math.sin(1.15) * bladeR, 0, (Math.cos(1.15) - 1) * bladeR), tipB = tipA.clone().setX(-tipA.x);
    // 土：一块透着金色熔纹、翻滚着飞的石头
    const earth = o.el === 'earth', rock = earth ? new THREE.Mesh(chunkGeo(), rockMat({ heat: 1.2, veinK: 1.8 })) : null;
    if (rock) { rock.scale.setScalar(o.big ? 0.36 : 0.26); rock.castShadow = true; orb.add(rock); core.visible = false; }
    const haloS = (o.big ? 2 : 1.4) * (ice ? 0.45 : wind ? 0.5 : earth ? 0.55 : 1);
    if (ice) halo.material.color.copy(col(pal.primary, 0.7));   // 光晕小一点、暗一点，看得出冰锥本身
    if (wind) halo.material.color.copy(col(pal.primary, 0.45));
    if (earth) halo.material.color.copy(col(pal.primary, 0.4));
    const _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion(), _spin = new THREE.Quaternion(), _w = new THREE.Vector3();
    orb.visible = false;
    this.scene.add(orb);
    const start = (o.from ?? this.origin).clone();
    const end = o.target().clone();
    const dist = start.distanceTo(end);
    const fly = THREE.MathUtils.clamp(dist / 24, 0.35, 0.95) * (o.path === 'behind' ? 1.5 : 1);
    let t = -(o.delay || 0), prev = start.clone(), done = false, flew = false;
    const pos = new THREE.Vector3();
    const side = Math.random() < 0.5 ? -1 : 1;
    this.fx.push({
      update: (dt) => {
        t += dt;
        if (t < 0) return true;
        if (!flew) { flew = true; this.sound?.play('fly'); }
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
        halo.scale.setScalar(haloS + Math.sin(t * 40) * 0.12);
        this.orbLight.position.copy(pos);
        this.orbLight.color.copy(col(pal.primary));
        this.orbLight.intensity = wind ? 10 : earth ? 6 : 26;   // 风刃、石头本身不怎么发光，青光照在白石头上还会把地面染绿
        const seg = pos.clone().sub(prev);
        const steps = Math.min(60, Math.ceil(seg.length() * 22));   // 按飞过的距离撒粒子，慢动作下密度不变
        if (fb) {
          const u = fb.material.uniforms;
          u.uTime.value += dt;
          if (seg.lengthSq() > 1e-6) u.uDir.value.copy(seg).normalize();
          u.uStretch.value = 2.8;   // 模型里的长度：乘上缩放约 0.9 米
          // 火苗（大、短命、往上飘，白黄 → 暗红）和火星（小、亮、飘得久）
          for (let i = Math.ceil(steps * 0.6); i > 0; i--) {
            const q = prev.clone().addScaledVector(seg, Math.random());
            this.p.emit(q.x + rand(-0.08, 0.08), q.y + rand(-0.08, 0.08), q.z + rand(-0.08, 0.08), rand(-0.5, 0.5), rand(0.2, 1.4), rand(-0.5, 0.5),
              rand(0.18, 0.34), rand(0.22, 0.4) * (o.big ? 1.3 : 1), [1.3, 0.5, 0.1], [0.32, 0.03, 0.005], { drag: 3, grav: 2.5, alpha: 0.4, grow: 0.3 });
            if (Math.random() < 0.35) {
              this.p.emit(q.x, q.y, q.z, rand(-1.5, 1.5), rand(0.5, 2), rand(-1.5, 1.5), rand(0.5, 1.1), rand(0.04, 0.07),
                [3, 1.9, 0.7], [1.2, 0.22, 0.02], { drag: 1.4, grav: 1.2, alpha: 0.95 });
            }
          }
        } else if (spear) {
          // 冰锥顺着飞行方向，绕自己的轴转
          if (seg.lengthSq() > 1e-6) spear.quaternion.copy(_q.setFromUnitVectors(_up, seg.clone().normalize())).multiply(_spin.setFromAxisAngle(_up, t * 9));
          // 雪尘两层：细的冰蓝亮粉（叠加、闪一下就没）+ 淡淡的冷雾（墨池普通混合、浅色，白石头上也看得出）
          for (let i = Math.ceil(steps * 0.7); i > 0; i--) {
            const q = prev.clone().addScaledVector(seg, Math.random());
            this.p.emit(q.x + rand(-0.1, 0.1), q.y + rand(-0.1, 0.1), q.z + rand(-0.1, 0.1), rand(-0.8, 0.8), rand(-0.4, 0.6), rand(-0.8, 0.8),
              rand(0.25, 0.55), rand(0.04, 0.08), [1.1, 1.7, 2.3], [0.2, 0.55, 1.0], { drag: 2.5, grav: -1.5, alpha: 0.9 });
          }
          if (this.ink && Math.random() < steps * 0.05 * this.inkK) {
            this.ink.emit(pos.x, pos.y, pos.z, rand(-0.3, 0.3), rand(-0.2, 0.2), rand(-0.3, 0.3), rand(0.6, 1), rand(0.25, 0.4),
              [0.72, 0.84, 0.96], [0.86, 0.93, 1.0], { drag: 2, alpha: 0.3, grow: 2.2 });
          }
        } else if (blade) {
          // 风刃朝着飞的方向，轻轻左右晃；两个尖和正中留下笔触
          if (seg.lengthSq() > 1e-6) blade.lookAt(_w.copy(pos).add(seg));
          blade.rotateZ(Math.sin(t * 26) * 0.18);
          orb.updateMatrixWorld(true);
          trails[0].push(_w.copy(tipA).applyMatrix4(blade.matrixWorld));
          trails[1].push(_w.copy(tipB).applyMatrix4(blade.matrixWorld));
          trails[2].push(pos);
          for (let i = Math.ceil(steps * 0.25); i > 0; i--) {   // 零星的青色亮点
            const q = prev.clone().addScaledVector(seg, Math.random());
            this.p.emit(q.x + rand(-0.25, 0.25), q.y + rand(-0.15, 0.15), q.z + rand(-0.25, 0.25), rand(-1, 1), rand(-0.3, 0.6), rand(-1, 1),
              rand(0.2, 0.4), rand(0.03, 0.06), [0.5, 1.6, 1.15], [0.1, 0.5, 0.4], { drag: 2.5, alpha: 0.8 });
          }
        } else if (rock) {
          rock.rotation.x += dt * 7; rock.rotation.z += dt * 4.5;
          // 一路掉碎屑：土色的尘（墨池普通混合，白石头上看得出）+ 几颗往下掉的金火星
          if (this.ink && Math.random() < steps * 0.08 * this.inkK) {
            this.ink.emit(pos.x, pos.y, pos.z, rand(-0.3, 0.3), rand(-0.2, 0.3), rand(-0.3, 0.3), rand(0.5, 0.9), rand(0.18, 0.32),
              [0.4, 0.33, 0.25], [0.62, 0.55, 0.46], { drag: 2, alpha: 0.35, grow: 1.8 });
          }
          for (let i = Math.ceil(steps * 0.2); i > 0; i--) {
            const q = prev.clone().addScaledVector(seg, Math.random());
            this.p.emit(q.x, q.y, q.z, rand(-0.8, 0.8), rand(-0.5, 0.5), rand(-0.8, 0.8), rand(0.3, 0.6), rand(0.03, 0.06),
              [2.4, 1.3, 0.35], [0.8, 0.3, 0.05], { drag: 1.5, grav: -8 });
          }
        } else {
          for (let i = 0; i < steps; i++) {
            const q = prev.clone().addScaledVector(seg, i / steps);
            this.p.emit(q.x + rand(-0.05, 0.05), q.y + rand(-0.05, 0.05), q.z + rand(-0.05, 0.05),
              rand(-0.6, 0.6), rand(-0.3, 0.9), rand(-0.6, 0.6), rand(0.3, 0.55), rand(0.1, 0.2),
              scaleArr(pal.secondary, 1.8), scaleArr(pal.primary, 1.1), { drag: 2.5, grav: pal.emberGravity * 0.5, alpha: 0.85 });
          }
        }
        // 墨重的元素（火的黑烟、雷）沿路留一点墨迹；火的烟多一些。风的笔触边上已经是深青、土一路掉尘，不再加墨
        if (this.ink && !wind && !earth && (pal.ink ?? 0) >= 0.75 && Math.random() < steps * (fire ? 0.07 : 0.04) * this.inkK) {
          const ic = inkColors(pal.primary);
          this.ink.emit(pos.x, pos.y, pos.z, rand(-0.4, 0.4), rand(-0.1, 0.5), rand(-0.4, 0.4), rand(0.5, 0.9), rand(0.12, 0.28),
            ic.a, ic.b, { drag: 2, alpha: 0.45, grow: 1.8 });
        }
        prev.copy(pos);
        if (k >= 1 && !done) { done = true; this.orbLight.intensity = 0; o.onHit(pos.clone()); return false; }
        return true;
      },
      dispose: () => {
        this.scene.remove(orb); core.material.dispose(); halo.material.dispose(); if (fb) fb.material.dispose(); if (spear) { spear.geometry.dispose(); spear.material.dispose(); }
        if (blade) { blade.geometry.dispose(); /** @type {THREE.Material} */ (blade.material).dispose(); this.eraseTrails(trails, 0.3); }
        if (rock) /** @type {THREE.Material} */ (rock.material).dispose();
      },
    });
  }

  /** 拖尾收尾：从尾巴往头擦掉，擦完释放 @param {Trail[]} trails @param {number} dur */
  eraseTrails(trails, dur) {
    let t = 0;
    this.fx.push({
      update: (dt) => { t += dt; for (const tr of trails) tr.mat.uniforms.uTail.value = Math.min(1, t / dur); return t < dur; },
      dispose: () => { for (const tr of trails) { this.scene.remove(tr.mesh); tr.dispose(); } },
    });
  }

  /**
   * 被风吹飞的傀儡：身后拖两道笔触（腰、肩各一道），跟一阵子再从尾巴擦掉。推下悬崖时这两道线一路跟着掉进云海。
   * @param {THREE.Object3D} obj 傀儡的模型（读它的位置和缩放） @param {number} [life]
   */
  windTrail(obj, life = 0.9) {
    const k = obj.scale.y;
    // 0.09 / 0.06 宽时只有凑近才看得见，默认机位上被吹飞的傀儡身后什么都没有（实测）
    const lanes = [[0.45, 0.14], [1.15, 0.1]].map(([h, w]) => ({ h, tr: new Trail(24, w * Math.max(1, k), 0.08) }));
    for (const { tr } of lanes) this.scene.add(tr.mesh);
    let t = 0;
    const q = new THREE.Vector3();
    this.fx.push({
      update: (dt) => {
        t += dt;
        if (t < life) for (const { h, tr } of lanes) tr.push(q.copy(obj.position).setY(obj.position.y + h * k));
        else return false;
        return true;
      },
      dispose: () => this.eraseTrails(lanes.map((l) => l.tr), 0.35),
    });
  }

  /** 风墙上往上卷的一笔（Walls 每隔一小会儿叫一次） @param {number} x @param {number} y @param {number} z */
  windRise(x, y, z) {
    // 0.07 宽、每 0.1 秒一笔时，默认机位上只剩一层淡青的光幕，看不出笔触（实测）
    const m = stroke(helix(Math.random() * 6.28, 0.9, 0.1, 0.45, rand(1.8, 2.6), 30), 0.12);
    const mat = /** @type {THREE.ShaderMaterial} */ (m.material), spin = rand(4, 7), dur = 0.8;
    m.position.set(x, y, z);
    this.addTimed(m, dur, (k, t) => { m.rotation.y = -spin * t; sweepAt(mat, t, dur); });
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
    this.sound?.play('cast', { el });
  }

  /**
   * 落点爆炸。scale：小命中 0.45，爆 1，大招以后更大。
   * @param {THREE.Vector3} p @param {string} el @param {number} radius @param {number} [scale]
   */
  burst(p, el, radius, scale = 1) {
    const pal = PALETTE[el];
    const fire = el === 'fire', ice = el === 'ice', wind = el === 'wind', earth = el === 'earth';
    // 地上的冲击环、法印：冰蓝在 2.5 倍时和白石头叠成一块白热的圆盘（实测），冰压到六成；风、土的主角是笔触和石块，也压下去
    const ringK = ice ? 0.6 : wind ? 0.35 : earth ? 0.5 : 1, P = col(pal.primary, 2.5 * ringK), S = col(pal.secondary, 2.2 * ringK);
    const R = radius;
    this.sound?.play('boom', { el, scale });
    this.blastLight.position.set(p.x, p.y + 0.6, p.z);
    this.blastLight.color.copy(col(pal.primary));
    // 冰蓝的灯光照在白石头上整片发蓝（实测），冰的落点灯光压到四成；风的青光同理
    this.blastT = 0; this.blastBoost = scale * (ice ? 0.4 : wind ? 0.35 : earth ? 0.3 : 1);
    this.shake = Math.max(this.shake, (earth ? 0.55 : 0.4) * scale);   // 土砸得沉，多震一点
    this.hitStop = Math.max(this.hitStop, 0.05 * Math.min(scale, 1.2));   // 顿帧
    this.impact(p, Math.min(1, 0.35 + 0.45 * scale));
    if (scale >= 0.9) this.pulseDim(Math.min(0.75, 0.32 + 0.3 * (scale - 0.9)), 0.25 + 0.2 * scale);
    this.inkSplash(p, el, R, scale);
    this.foregroundBokeh(p, el, scale);
    if (fire) this.fireBurst(p, R, scale);
    if (ice) this.iceBurst(p, R, scale);
    if (wind) this.windBurst(p, R, scale);
    if (earth) this.earthBurst(p, R, scale);
    // 四溅的火花：火的大头是火团和火星、冰是冰棱和晶片、风是笔触、土是石块，火花都少一些
    const n = Math.round((fire ? 160 : ice ? 240 : wind ? 60 : earth ? 30 : 420) * scale);
    // 火花刚溅出时的颜色：火用橙黄（白热的火花挤在中间，叠加起来是一团白，看不出火团，实测）；冰、风、土也别用白热（理由同火；
    // 土的金火花多了在落点叠成一团金白的光，盖住了石块，实测）
    const spark0 = fire ? [1.9, 1.0, 0.25] : ice ? [0.8, 1.3, 1.9] : wind ? [0.5, 1.6, 1.15] : earth ? [1.3, 0.7, 0.2] : scaleArr(pal.core, 2.6);
    for (let i = 0; i < n; i++) {
      const d = randDir(); d.y = Math.abs(d.y) * 0.9 + 0.1;
      const v = d.multiplyScalar(rand(3, 15) * Math.sqrt(scale));
      this.p.emit(p.x, p.y, p.z, v.x, v.y, v.z, rand(0.5, 1.3), rand(0.05, 0.12),
        spark0, scaleArr(pal.primary, 1.4), { drag: 1.6, grav: pal.sparkGravity });
    }
    for (let i = 0; i < (earth ? 0 : wind ? 25 : 50) * scale; i++) {   // 一团元素色的光雾（土用尘浪代替）
      const v = randDir().multiplyScalar(rand(1.2, 4.5));
      this.p.emit(p.x, p.y, p.z, v.x, v.y * 0.6 + 0.6, v.z, rand(0.7, 1.5), rand(0.5, 1.1),
        scaleArr(pal.primary, 0.8), scaleArr(pal.secondary, 0.3), { alpha: 0.16, drag: 1.8 });
    }
    if (!wind && !earth) {   // 冲击波壳（风不要：青色的壳在漩涡外面像一个肥皂泡；土的壳把石块罩成一团金光，实测）
      const shellK = fire ? 0.7 : ice ? 0.55 : 0;
      const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), glowShellMat(shellK ? col(pal.primary, shellK) : col(pal.secondary, 1.2)));
      flash.material.uniforms.uFill.value = 0.04;      // 只亮边缘，中间通透，像一层冲击波壳
      flash.position.copy(p);
      this.addTimed(flash, 0.4, (k) => {
        flash.scale.setScalar(0.3 + easeOutCubic(k) * R * 0.8);
        flash.material.uniforms.uAlpha.value = Math.pow(1 - k, 2.5);
      });
    }
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
      if (!fire && !ice && !wind && !earth) {   // 火用火柱代替光柱（fireBurst 里），冰的主角是冰棱、风是漩涡、土是石笋，不要光柱
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 10, 28, 1, true), glowShellMat(col(pal.primary, 1.6), 1));
        pillar.geometry.translate(0, 5, 0);
        pillar.position.set(p.x, p.y, p.z);
        this.addTimed(pillar, 0.9, (k) => {
          const w = 0.3 + easeOutCubic(k) * 1.2;
          pillar.scale.set(w, 0.4 + easeOutCubic(Math.min(k * 3, 1)) * 0.8, w);
          pillar.material.uniforms.uAlpha.value = Math.pow(1 - k, 2) * 0.9;
        });
      }
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
   * 火炸开（特效风格 v2：白黄芯红边的火团 + 满场火星 + 墨烟）：火团胀开、往上浮、冷却变红、烧穿散掉；
   * 大的再冲起一道火柱；火星往上飘 1～2.5 秒；一股黑烟往上冒；落在平地上留焦痕。
   * @param {THREE.Vector3} p @param {number} R @param {number} scale
   */
  fireBurst(p, R, scale) {
    const big = scale >= 0.9, rMax = R * (big ? 0.75 : 0.6), dur = 0.55 + 0.35 * Math.min(scale, 1.5);
    const fb = fireball();
    fb.position.copy(p);
    fb.material.uniforms.uAmp.value = 0.7;
    this.addTimed(fb, dur, (k, t) => {
      const u = fb.material.uniforms;
      u.uTime.value = t;
      fb.scale.setScalar(rMax * (0.25 + 0.75 * easeOutCubic(Math.min(1, k * 2.2))));
      fb.position.y = p.y + k * rMax * 0.6;            // 热气往上浮
      u.uHeat.value = 1 - k;
      u.uBurn.value = Math.max(0, (k - 0.35) / 0.65);
    });
    if (big) {   // 火柱：一股往上冲的火苗
      for (let i = Math.round(90 * scale); i > 0; i--) {
        const a = Math.random() * Math.PI * 2, r = rand(0, R * 0.3);
        this.p.emit(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r, rand(-1, 1), rand(5, 12), rand(-1, 1),
          rand(0.35, 0.6), rand(0.35, 0.7), [1.4, 0.55, 0.1], [0.35, 0.03, 0.005], { drag: 2.2, grav: 2, alpha: 0.4, grow: 0.5 });
      }
    }
    for (let i = Math.round(170 * scale); i > 0; i--) {   // 火星：往上飘得久，满场都是
      const a = Math.random() * Math.PI * 2, r = rand(0, R * 0.7);
      this.p.emit(p.x + Math.cos(a) * r, p.y + rand(0, 0.8), p.z + Math.sin(a) * r, Math.cos(a) * rand(0.5, 3), rand(1.5, 5), Math.sin(a) * rand(0.5, 3),
        rand(1.2, 2.6), rand(0.035, 0.07), [3.2, 1.8, 0.5], [1.3, 0.18, 0.02], { drag: 0.9, grav: 1.1, grow: 0.6 });
    }
    if (this.ink) {   // 黑烟往上冒、越胀越大（墨池普通混合，压在亮色后面）
      const ic = inkColors(PALETTE.fire.primary);
      for (let i = Math.round(7 * scale * this.inkK); i > 0; i--) {
        this.ink.emit(p.x + rand(-0.4, 0.4) * R, p.y + rand(0.3, 1.2), p.z + rand(-0.4, 0.4) * R, rand(-0.4, 0.4), rand(1.2, 2.6), rand(-0.4, 0.4),
          rand(1.6, 2.6), rand(0.7, 1.3) * Math.sqrt(scale), ic.a, ic.b, { drag: 1.1, grav: 0.6, alpha: 0.5, grow: 2.6 });
      }
    }
    this.scorch(p, R * (big ? 0.85 : 0.6));
  }

  /**
   * 焦痕：贴在平地上（广场、索桥、邻峰顶；石阶是斜的不贴）。先透着暗红的余烬（叠加发光），两秒内熄掉；
   * 焦黑留 6 秒多再淡掉。最多同时 14 块，多了就不留新的。
   * @param {THREE.Vector3} p @param {number} r
   */
  scorch(p, r) {
    const gy = this.groundAt(p.x, p.z);
    if (gy === null || Math.abs(gy) > 0.05 || p.y - gy > 2 || this.scorchCount >= 14) return;
    const tex = scorchTextures();
    const flat = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 };
    const darkMat = new THREE.MeshBasicMaterial({ ...flat, map: tex.dark, opacity: 0 });
    const glowMat = new THREE.MeshBasicMaterial({ ...flat, map: tex.glow, color: new THREE.Color(2.2, 0.55, 0.1), blending: THREE.AdditiveBlending, fog: false });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(_plane, darkMat), new THREE.Mesh(_plane, glowMat));
    g.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    g.position.set(p.x, gy + 0.02, p.z);
    g.scale.setScalar(r * 2);
    this.scorchCount++;
    const LIFE = 9;
    this.addTimed(g, LIFE, (k, t) => {
      darkMat.opacity = Math.min(1, t / 0.3) * (t < 6.5 ? 1 : Math.max(0, 1 - (t - 6.5) / 2.5));
      glowMat.opacity = Math.pow(Math.max(0, 1 - t / 2), 1.5) * (0.75 + 0.25 * Math.sin(t * 23 + r * 7));
      if (k >= 1) this.scorchCount--;
    });
  }

  /**
   * 一片地火（字诀「燎」）：sec 秒里火苗、火星一直从地上往上冒，最后半秒收掉；底下贴一块焦痕。烧谁由 main.js 按半径结算。
   * @param {THREE.Vector3} p 地面上的点 @param {number} r @param {number} sec
   */
  groundFire(p, r, sec) {
    this.scorch(p, r);
    let t = 0, acc = 0;
    this.fx.push({
      update: (dt) => {
        t += dt;
        acc += dt * 70 * r * Math.min(1, (sec - t) / 0.5);
        for (; acc >= 1; acc--) {
          const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * r, x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr;
          this.p.emit(x, p.y + 0.05, z, rand(-0.3, 0.3), rand(1.5, 3.5), rand(-0.3, 0.3), rand(0.3, 0.6), rand(0.14, 0.26),
            [1.4, 0.55, 0.1], [0.35, 0.03, 0.005], { drag: 1.5, grav: 1.5, alpha: 0.5, grow: 0.4 });
          if (Math.random() < 0.3) {
            this.p.emit(x, p.y + 0.1, z, rand(-0.6, 0.6), rand(1, 3), rand(-0.6, 0.6), rand(0.6, 1.2), rand(0.035, 0.06),
              [3.2, 1.8, 0.5], [1.3, 0.18, 0.02], { drag: 0.9, grav: 1.1 });
          }
        }
        return t < sec;
      },
      dispose: () => {},
    });
  }

  /**
   * 一道金雷（10-21 定：白芯金黄的细锯齿闪电 + 暖金外辉 + 墨点；紫色留给敌人）：从 a 到 b 的锯齿折线，中段抖得最厉害，
   * 长的带一两根分叉；0.3 秒里闪两下就灭，亮着时每两帧换一次形状（风格卡"每两帧重画"）；沿线撒电火花、落点溅墨点。
   * 白天背景是白石头和金色的天，金色叠上去没有对比：外壳用深一点的琥珀色、普通混合，在背景上压出一道边；
   * 白芯大于 1，过泛光就是那圈暖金外辉。
   * @param {THREE.Vector3} a @param {THREE.Vector3} b @param {{ delay?: number, jitter?: number, forks?: number }} [o]
   */
  arc(a, b, o = {}) {
    const pal = PALETTE.thunder;
    this.sound?.play('zap');
    const len = a.distanceTo(b), n = Math.max(6, Math.round(len * 2.2));
    const jitter = o.jitter ?? Math.min(0.9, 0.12 + len * 0.05);
    const forks = o.forks ?? (len > 3 ? 1 + Math.floor(Math.random() * 2) : 0);
    /** 一条锯齿折线：两头钉住，中段抖得最厉害 */
    const zig = (from, to, segs, amp) => {
      const d = to.clone().sub(from), pts = [];
      for (let i = 0; i <= segs; i++) {
        const q = from.clone().addScaledVector(d, i / segs);
        if (i > 0 && i < segs) q.add(randDir().multiplyScalar(amp * Math.sin((Math.PI * i) / segs) + 0.04));
        pts.push(q);
      }
      return pts;
    };
    const tube = (pts, r, radial) => {
      const path = /** @type {THREE.CurvePath<THREE.Vector3>} */ (new THREE.CurvePath());
      for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
      return new THREE.TubeGeometry(path, (pts.length - 1) * 2, r, radial, false);
    };
    // 白芯 2.2 倍：3 倍时在白石头上泛光糊成一大片白（风格卡禁止"命中整屏发白"，实测）
    const coreMat = new THREE.MeshBasicMaterial({ color: col(pal.core, 2.2), transparent: true, opacity: 0, fog: false, depthWrite: false });
    const shellMat = new THREE.MeshBasicMaterial({ color: col([0.8, 0.4, 0.05]), transparent: true, opacity: 0, fog: false, depthWrite: false });
    const line = new THREE.Group();
    this.scene.add(line);
    let main = /** @type {THREE.Vector3[]} */ ([]);
    const build = () => {
      for (const m of /** @type {THREE.Mesh[]} */ (line.children)) m.geometry.dispose();
      line.clear();
      main = zig(a, b, n, jitter);
      const paths = [[main, 1]];
      for (let f = 0; f < forks; f++) {
        const from = main[Math.floor(n * (0.25 + Math.random() * 0.5))];
        const rest = b.clone().sub(from), fl = rest.length() * (0.25 + Math.random() * 0.25);
        const to = from.clone().add(rest.normalize().add(randDir().multiplyScalar(0.9)).normalize().multiplyScalar(fl));
        paths.push([zig(from, to, Math.max(3, Math.round(fl * 2.5)), jitter * 0.6), 0.55]);
      }
      for (const [pts, w] of /** @type {[THREE.Vector3[], number][]} */ (paths)) {
        const shell = new THREE.Mesh(tube(pts, 0.13 * w, 6), shellMat), core = new THREE.Mesh(tube(pts, 0.045 * w, 5), coreMat);
        core.renderOrder = 1;   // 白芯画在外壳上面
        line.add(shell, core);
      }
    };
    build();
    let t = -(o.delay || 0), lit = false, since = 0;
    this.fx.push({
      update: (dt) => {
        t += dt;
        if (t < 0) return true;
        if (!lit) {
          lit = true;
          for (const q of main) {   // 电火花：金黄（白的叠在白石头上看不见，还会糊成一片）
            for (let k = 0; k < 2; k++) {
              this.p.emit(q.x, q.y, q.z, rand(-1, 1), rand(-1, 1), rand(-1, 1), rand(0.1, 0.22), rand(0.05, 0.1),
                scaleArr(pal.secondary, 1.8), scaleArr(pal.primary, 1.2), { drag: 5, alpha: 0.9 });
            }
          }
          for (let k = 0; k < 18; k++) {
            const v = randDir().multiplyScalar(rand(2, 7));
            this.p.emit(b.x, b.y, b.z, v.x, Math.abs(v.y), v.z, rand(0.2, 0.45), rand(0.04, 0.08),
              scaleArr(pal.secondary, 2), scaleArr(pal.primary, 1.2), { drag: 2.5, grav: pal.sparkGravity });
          }
          this.blastLight.position.copy(b).setY(b.y + 0.8);
          this.blastLight.color.copy(col(pal.primary));
          this.blastT = 0; this.blastBoost = 0.15;   // 金光亮度高，照在白石头上一下就过泛光阈值，比紫雷时调低
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
        since += dt;
        if (since > 0.035) { since = 0; build(); }   // 约两帧换一次形状（游戏时间，慢放时也跟着慢）
        const k = t / 0.32;
        const a1 = k < 0.25 ? 1 : k < 0.4 ? 0.15 : k < 0.55 ? 0.95 : Math.max(0, 1 - k);   // 闪两下
        coreMat.opacity = a1;
        shellMat.opacity = a1 * 0.7;
        return k < 1;
      },
      dispose: () => {
        this.scene.remove(line);
        for (const m of /** @type {THREE.Mesh[]} */ (line.children)) m.geometry.dispose();
        coreMat.dispose(); shellMat.dispose();
      },
    });
  }

  /**
   * 寒冰：地面炸出一圈冰棱——六棱晶柱（冰晶材质，半透明切面），实例化一次画完；一根根接连长出来，最后一起化掉。
   * @param {THREE.Vector3} p @param {number} count @param {number} k 大小
   */
  frostShards(p, count, k) {
    const mat = iceMaterial();
    const mesh = new THREE.InstancedMesh(crystalGeo(), mat, count);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    const specs = Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + rand(-0.15, 0.15), r = rand(0.5, 2.0) * k;
      return { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, h: rand(0.8, 2.0) * k, w: rand(0.1, 0.2) * k,
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * rand(0.3, 0.7), rand(0, 6.28), -Math.cos(a) * rand(0.3, 0.7))) };
    });
    const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    this.addTimed(mesh, 2.4, (kk, t) => {
      const fade = kk > 0.7 ? 1 - (kk - 0.7) / 0.3 : 1;
      specs.forEach((s, i) => {
        const grow = Math.max(easeOutBack(clamp01(t * 6 - i * 0.05)) * fade, 0.001);
        mesh.setMatrixAt(i, m4.compose(v.set(s.x, p.y, s.z), s.q, sc.set(s.w, s.h * grow, s.w)));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mat.uniforms.uAlpha.value = fade;
    });
  }

  /**
   * 冰炸开（特效风格 v2：半透明晶片 + 三层雪尘）：一把六角晶片飞散翻滚、落地弹一下再化掉；一团冷雾往外漫；
   * 落在平地上留霜痕。冰棱由 burst 里的 frostShards 长出来。
   * @param {THREE.Vector3} p @param {number} R @param {number} scale
   */
  iceBurst(p, R, scale) {
    const n = Math.round(24 + 70 * scale), mat = iceMaterial();
    const chips = new THREE.InstancedMesh(chipGeo(), mat, n);
    chips.frustumCulled = false;
    const st = Array.from({ length: n }, () => {
      const d = randDir(); d.y = Math.abs(d.y) * 0.9 + 0.25;
      return { p: p.clone(), v: d.multiplyScalar(rand(3, 9) * Math.sqrt(scale)), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6))),
        axis: randDir(), spin: rand(4, 14), s: rand(0.06, 0.2) * Math.sqrt(scale) };
    });
    const m4 = new THREE.Matrix4(), sc = new THREE.Vector3(), dq = new THREE.Quaternion();
    let last = 0;
    this.addTimed(chips, 1.6, (k, t) => {
      const dt = t - last; last = t;
      for (let i = 0; i < n; i++) {
        const c = st[i];
        c.v.y -= 12 * dt; c.v.multiplyScalar(Math.exp(-0.8 * dt));
        c.p.addScaledVector(c.v, dt);
        const fl = this.groundAt(c.p.x, c.p.z);
        if (fl !== null && c.p.y < fl + 0.03) { c.p.y = fl + 0.03; c.v.y *= -0.3; c.v.x *= 0.5; c.v.z *= 0.5; c.spin *= 0.5; }   // 落地弹一下
        c.q.multiply(dq.setFromAxisAngle(c.axis, c.spin * dt));
        chips.setMatrixAt(i, m4.compose(c.p, c.q, sc.setScalar(c.s)));
      }
      chips.instanceMatrix.needsUpdate = true;
      mat.uniforms.uAlpha.value = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    });
    if (this.ink) {   // 冷雾：浅色、普通混合，往外漫开
      for (let i = Math.round(9 * scale * this.inkK); i > 0; i--) {
        const a = Math.random() * Math.PI * 2, r = rand(0, R * 0.5);
        this.ink.emit(p.x + Math.cos(a) * r, p.y + rand(0, 0.6), p.z + Math.sin(a) * r, Math.cos(a) * rand(0.8, 2.2), rand(0.1, 0.6), Math.sin(a) * rand(0.8, 2.2),
          rand(1.2, 2), rand(0.6, 1.1) * Math.sqrt(scale), [0.74, 0.85, 0.97], [0.88, 0.94, 1.0], { drag: 1.5, grav: 0.1, alpha: 0.32, grow: 2.4 });
      }
    }
    this.frost(p, R * (scale >= 0.9 ? 0.9 : 0.6));
  }

  /**
   * 霜痕：平地上一片放射状的冰花，冷蓝色（暖白的汉白玉上才看得出），先闪一下冰蓝的光，留 6 秒多再淡掉；最多同时 14 块。
   * @param {THREE.Vector3} p @param {number} r
   */
  frost(p, r) {
    const gy = this.groundAt(p.x, p.z);
    if (gy === null || Math.abs(gy) > 0.05 || p.y - gy > 2 || this.frostCount >= 14) return;
    const flat = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 };
    const tintMat = new THREE.MeshBasicMaterial({ ...flat, map: frostTexture(), color: new THREE.Color(0.55, 0.74, 0.95), opacity: 0 });
    const glowMat = new THREE.MeshBasicMaterial({ ...flat, map: frostTexture(), color: new THREE.Color(0.5, 1.2, 2.2), blending: THREE.AdditiveBlending, fog: false, opacity: 0 });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(_plane, tintMat), new THREE.Mesh(_plane, glowMat));
    g.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    g.position.set(p.x, gy + 0.025, p.z);
    g.scale.setScalar(r * 2);
    this.frostCount++;
    this.addTimed(g, 9, (k, t) => {
      const grow = easeOutCubic(Math.min(1, t / 0.35));   // 冰花从中间长出去
      g.scale.setScalar(r * 2 * (0.4 + 0.6 * grow));
      tintMat.opacity = grow * 0.9 * (t < 6.5 ? 1 : Math.max(0, 1 - (t - 6.5) / 2.5));
      glowMat.opacity = Math.max(0, 1 - t / 1.2) * 0.6;
      if (k >= 1) this.frostCount--;
    });
  }

  /**
   * 风炸开（特效风格 v2：青色发光笔触带卷成浪与漩涡）：几股笔触从中心往外、往上绕成漩涡，整团一边转一边胀开；
   * 贴地几道浪往外推，末尾卷成小涡；地上扬起一圈灰、几片碎叶跟着转。
   * @param {THREE.Vector3} p @param {number} R @param {number} scale
   */
  windBurst(p, R, scale) {
    const big = scale >= 0.9, gy = this.groundAt(p.x, p.z), base = gy ?? p.y - 0.4;
    // 笔触宽 0.2 米时远看是一根根霓虹细线，不像毛笔（实测）
    const dur = big ? 1.1 : 0.75, w = big ? 0.32 : 0.18;
    // 漩涡：螺旋线从里往外、从下往上（高过宽，像一股旋风，矮了看着是一摞光圈，实测）；外沿要罩住大半个爆炸范围，被吹的敌人在里面；
    // 整团顺着笔触走的方向转（笔触的角度往 +z 增，等于绕 y 轴转负角）
    const vortex = new THREE.Group();
    vortex.position.set(p.x, base + 0.05, p.z);
    const nS = big ? 6 : 3, ph = Math.random() * 6.28;
    const strands = Array.from({ length: nS }, (_, j) => {
      const m = stroke(helix(ph + (j / nS) * Math.PI * 2, rand(1.2, 1.6), R * 0.15, R * rand(0.8, 1.0), R * rand(1.0, 1.35), 56), w * rand(0.7, 1.3));
      vortex.add(m);
      return { mat: /** @type {THREE.ShaderMaterial} */ (m.material), delay: j * 0.03 };
    });
    const spin = big ? 5.5 : 7;
    this.addTimed(vortex, dur + 0.2, (k, t) => {
      vortex.rotation.y = -spin * t;
      vortex.scale.setScalar(0.6 + 0.5 * easeOutCubic(Math.min(1, t / dur)));
      for (const s of strands) sweepAt(s.mat, t - s.delay, dur);
    });
    // 浪：贴地往外推的弧，末尾往里卷
    const waves = new THREE.Group();
    waves.position.set(p.x, base + 0.08, p.z);
    const nW = big ? 5 : 3;
    const arcs = Array.from({ length: nW }, (_, j) => {
      const m = stroke(scroll(ph + (j / nW) * Math.PI * 2 + rand(-0.2, 0.2), rand(0.9, 1.3), rand(0.16, 0.24)), w * 0.9);
      waves.add(m);
      return { mat: /** @type {THREE.ShaderMaterial} */ (m.material), delay: 0.05 + j * 0.02 };
    });
    this.addTimed(waves, dur + 0.25, (k, t) => {
      waves.rotation.y = -spin * 0.35 * t;
      waves.scale.setScalar(R * (0.45 + 0.75 * easeOutCubic(Math.min(1, t / dur))));
      for (const a of arcs) sweepAt(a.mat, t - a.delay, dur);
    });
    // 青色亮点顺着漩涡甩出去
    for (let i = Math.round(40 * scale); i > 0; i--) {
      const a = Math.random() * Math.PI * 2, r = rand(0.3, 1) * R, sp = rand(5, 9) * Math.sqrt(scale);
      this.p.emit(p.x + Math.cos(a) * r, base + rand(0.1, 1.2), p.z + Math.sin(a) * r,
        -Math.sin(a) * sp + Math.cos(a) * 2, rand(1, 3), Math.cos(a) * sp + Math.sin(a) * 2,
        rand(0.4, 0.8), rand(0.04, 0.08), [0.6, 1.8, 1.3], [0.1, 0.6, 0.45], { drag: 2, alpha: 0.85 });
    }
    if (!this.ink) return;
    for (let i = Math.round(12 * scale * this.inkK); i > 0; i--) {   // 地上扬起一圈灰（暖灰、普通混合，白石头上看得出）
      const a = Math.random() * Math.PI * 2, r = R * rand(0.25, 0.45);
      this.ink.emit(p.x + Math.cos(a) * r, base + rand(0.05, 0.4), p.z + Math.sin(a) * r,
        Math.cos(a) * rand(2, 3.5) - Math.sin(a) * 2.5, rand(0.2, 0.8), Math.sin(a) * rand(2, 3.5) + Math.cos(a) * 2.5,
        rand(1, 1.6), rand(0.5, 1) * Math.sqrt(scale), [0.52, 0.49, 0.44], [0.74, 0.71, 0.66], { drag: 1.6, alpha: 0.28, grow: 2.2 });
    }
    for (let i = Math.round(16 * scale); i > 0; i--) {   // 碎叶：小、深绿，跟着转、往上卷
      const a = Math.random() * Math.PI * 2, r = R * rand(0.2, 0.7), sp = rand(3, 6);
      this.ink.emit(p.x + Math.cos(a) * r, base + rand(0.1, 0.6), p.z + Math.sin(a) * r,
        -Math.sin(a) * sp, rand(2, 5), Math.cos(a) * sp, rand(0.9, 1.5), rand(0.05, 0.09), [0.1, 0.22, 0.09], [0.16, 0.3, 0.12],
        { drag: 1.2, grav: -4, alpha: 0.85, grow: 0.9 });
    }
  }

  /**
   * 土炸开（特效风格 v2：金色熔纹加黑色墨裂的石块 + 碎石尘浪）：碎石四溅、落地弹跳；大的还有一圈石笋斜着拱出地面，
   * 撑一下就碎成碎石；贴地推出一圈土黄的尘浪；几颗金火星；地上留裂纹。
   * @param {THREE.Vector3} p @param {number} R @param {number} scale
   */
  earthBurst(p, R, scale) {
    const big = scale >= 0.9, gy = this.groundAt(p.x, p.z), base = gy ?? p.y - 0.4, k = Math.sqrt(scale);
    this.rockDebris([new THREE.Vector3(p.x, base + 0.25, p.z)], Math.round(14 + 46 * scale), { speed: 7.5 * k, spread: R * 0.2, size: 0.16 * k, life: 1.9 });
    if (big && gy !== null) this.rockSpikes(p.x, base, p.z, R, scale);
    for (let i = Math.round(22 * scale); i > 0; i--) {   // 金火星：从石缝里溅出来，很快掉下去
      const d = randDir(); d.y = Math.abs(d.y) * 0.8 + 0.3;
      const v = d.multiplyScalar(rand(3, 9) * k);
      this.p.emit(p.x, base + 0.3, p.z, v.x, v.y, v.z, rand(0.4, 0.9), rand(0.04, 0.07), [2.4, 1.3, 0.35], [0.8, 0.3, 0.05], { drag: 1.2, grav: -14 });
    }
    this.dust(new THREE.Vector3(p.x, base, p.z), R, scale);
    this.crack(p, R * (big ? 0.95 : 0.6));
  }

  /**
   * 尘浪：贴地往外推的一圈土黄色尘（墨池普通混合），中间再往上冒一股。
   * @param {THREE.Vector3} at 地面上的中心 @param {number} R @param {number} scale
   */
  dust(at, R, scale) {
    if (!this.ink) return;
    for (let i = Math.round(26 * scale * this.inkK); i > 0; i--) {
      const a = Math.random() * Math.PI * 2, r = R * rand(0.15, 0.35), sp = rand(3.5, 7) * Math.sqrt(scale);
      this.ink.emit(at.x + Math.cos(a) * r, at.y + rand(0.05, 0.35), at.z + Math.sin(a) * r, Math.cos(a) * sp, rand(0.3, 1.2), Math.sin(a) * sp,
        // 淡到 0.62 时在白石地上看着是一团白里带蓝的雾，认不出是土（实测）
        rand(1.1, 1.8), rand(0.7, 1.3) * Math.sqrt(scale), [0.32, 0.25, 0.17], [0.5, 0.42, 0.31], { drag: 2.2, alpha: 0.5, grow: 2.5 });
    }
    for (let i = Math.round(7 * scale * this.inkK); i > 0; i--) {
      this.ink.emit(at.x + rand(-0.4, 0.4), at.y + rand(0.3, 1), at.z + rand(-0.4, 0.4), rand(-0.6, 0.6), rand(1.2, 2.6), rand(-0.6, 0.6),
        rand(1.3, 2), rand(0.6, 1.1) * Math.sqrt(scale), [0.36, 0.29, 0.2], [0.54, 0.46, 0.35], { drag: 1.4, alpha: 0.38, grow: 2.4 });
    }
  }

  /**
   * 一把碎石（石块材质，实例化一次画完）：从几个起点四溅，受重力，落地弹一下、慢慢停下；熔纹渐渐冷成黑缝，最后缩没。
   * @param {THREE.Vector3[]} from 起点（碎石轮流从这几个点出发）@param {number} n
   * @param {{ speed: number, size: number, spread?: number, life?: number, heat?: number, up?: number }} o up：往上溅的比例
   */
  rockDebris(from, n, o) {
    // 纹路疏一点：一块碎石上缠三四道金纹，一地都像金块（实测），一块一两道就够
    const life = o.life ?? 1.8, mat = rockMat({ heat: o.heat ?? 1, veinK: 1.2 }), heat = mat.userData.heat, h0 = heat.value, sp = o.spread ?? 0;
    const mesh = new THREE.InstancedMesh(chunkGeo(), mat, n);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    const st = Array.from({ length: n }, (_, i) => {
      const d = randDir(); d.y = Math.abs(d.y) * (o.up ?? 0.9) + 0.3;
      return { p: from[i % from.length].clone().add(new THREE.Vector3(rand(-sp, sp), rand(0, sp * 0.5), rand(-sp, sp))),
        v: d.normalize().multiplyScalar(o.speed * rand(0.45, 1.1)), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6))),
        axis: randDir(), spin: rand(3, 11), s: new THREE.Vector3(rand(0.7, 1.3), rand(0.6, 1.1), rand(0.7, 1.3)).multiplyScalar(o.size * rand(0.5, 1.4)) };
    });
    const m4 = new THREE.Matrix4(), sc = new THREE.Vector3(), dq = new THREE.Quaternion();
    let last = 0;
    this.addTimed(mesh, life, (k, t) => {
      const dt = t - last; last = t;
      heat.value = h0 * Math.max(0, 1 - t / (life * 0.6));
      const shrink = Math.max(0.001, k > 0.72 ? 1 - (k - 0.72) / 0.28 : 1);
      for (let i = 0; i < n; i++) {
        const c = st[i];
        c.v.y -= 18 * dt; c.v.multiplyScalar(Math.exp(-0.5 * dt));
        c.p.addScaledVector(c.v, dt);
        const fl = this.groundAt(c.p.x, c.p.z), r = c.s.y * 0.8;
        if (fl !== null && c.p.y < fl + r && c.p.y > fl - 0.5) { c.p.y = fl + r; c.v.y *= -0.28; c.v.x *= 0.55; c.v.z *= 0.55; c.spin *= 0.55; }   // 落地弹一下
        c.q.multiply(dq.setFromAxisAngle(c.axis, c.spin * dt));
        mesh.setMatrixAt(i, m4.compose(c.p, c.q, sc.copy(c.s).multiplyScalar(shrink)));
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  /**
   * 石笋：落点周围一圈石块从地里往外斜着拱出来（熔纹亮着），撑半秒就碎成一把碎石、扬一股尘。
   * @param {number} x @param {number} y 地面高 @param {number} z @param {number} R @param {number} scale
   */
  rockSpikes(x, y, z, R, scale) {
    const n = Math.round(6 + 3 * Math.min(scale, 2)), k = Math.min(1.5, Math.sqrt(scale));
    const mat = rockMat({ heat: 1.3, veinK: 1.6 });
    const mesh = new THREE.InstancedMesh(chunkGeo(), mat, n);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    const up = new THREE.Vector3(0, 1, 0), spinQ = new THREE.Quaternion();
    const specs = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + rand(-0.25, 0.25), r = rand(0.25, 0.65) * R, tilt = rand(0.25, 0.6);   // 往外歪
      const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
      // 一米来高时从默认机位看只是落点上一圈小疙瘩（实测），加到一人多高
      return { p: new THREE.Vector3(x + Math.cos(a) * r, y, z + Math.sin(a) * r), dir, w: rand(0.38, 0.62) * k, h: rand(1.0, 1.8) * k,
        q: new THREE.Quaternion().setFromUnitVectors(up, dir).multiply(spinQ.setFromAxisAngle(up, rand(0, 6.28))), delay: rand(0, 0.08), top: new THREE.Vector3() };
    });
    const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const HOLD = 0.5;
    let crumbled = false;
    this.addTimed(mesh, HOLD + 0.14, (kk, t) => {
      const gone = t < HOLD ? 1 : Math.max(0.001, 1 - (t - HOLD) / 0.12);
      specs.forEach((s, i) => {
        const g = easeOutBack(clamp01((t - s.delay) / 0.14));
        v.copy(s.p).addScaledVector(s.dir, (-0.9 + 1.25 * g) * s.h);   // 从地下拱上来，露出大半截
        s.top.copy(v).addScaledVector(s.dir, s.h * 0.5);
        mesh.setMatrixAt(i, m4.compose(v, s.q, sc.set(s.w * gone, s.h * gone, s.w * gone)));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (!crumbled && t >= HOLD) {
        crumbled = true;
        this.rockDebris(specs.map((s) => s.top), n * 3, { speed: 3.5 * k, size: 0.11 * k, life: 1.4, heat: 0.8, up: 0.6 });
        this.dust(new THREE.Vector3(x, y, z), R * 1.2, scale * 0.6);
        this.shake = Math.max(this.shake, 0.2 * scale);
      }
    });
  }

  /**
   * 裂地：平地上一片放射状的裂纹，缝里先透金光（叠加），一两秒熄掉；黑缝留 6 秒多再淡掉。最多同时 14 块。
   * @param {THREE.Vector3} p @param {number} r
   */
  crack(p, r) {
    const gy = this.groundAt(p.x, p.z);
    if (gy === null || Math.abs(gy) > 0.05 || p.y - gy > 2 || this.crackCount >= 14) return;
    this.sound?.play('crack');
    const tex = crackTextures();
    const flat = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 };
    const darkMat = new THREE.MeshBasicMaterial({ ...flat, map: tex.dark, opacity: 0 });
    const glowMat = new THREE.MeshBasicMaterial({ ...flat, map: tex.glow, color: new THREE.Color(2.0, 1.0, 0.28), blending: THREE.AdditiveBlending, fog: false, opacity: 0 });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(_plane, darkMat), new THREE.Mesh(_plane, glowMat));
    g.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    g.position.set(p.x, gy + 0.022, p.z);
    this.crackCount++;
    this.addTimed(g, 9, (k, t) => {
      const grow = easeOutCubic(Math.min(1, t / 0.18));   // 一下子裂开
      g.scale.setScalar(r * 2 * (0.5 + 0.5 * grow));
      darkMat.opacity = grow * (t < 6.5 ? 1 : Math.max(0, 1 - (t - 6.5) / 2.5));
      glowMat.opacity = Math.pow(Math.max(0, 1 - t / 1.6), 1.4) * 0.9;
      if (k >= 1) this.crackCount--;
    });
  }

  /** 法则反噬：脚下法阵染红、碎裂成红色碎片 */
  backlash() {
    const red = [1.6, 0.15, 0.1];
    const o = this.origin;
    this.sound?.play('backlash');
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
