// @ts-check
/**
 * 锁定标记：念咒期间先把"要打谁"亮出来，让玩家看到"它听懂了"。
 *   - 弹：被锁定的傀儡头顶出一个朝下的发光尖角，跟着傀儡走；
 *   - 爆、雨、墙，以及打场景物件：落点地面出一个发光圆环，大小等于作用范围。
 * 回车瞬间先按关键词解析亮一次，模型结果回来再更正；法术放完就收掉。
 */
import * as THREE from 'three';
import { col, PALETTE } from './common.js';

const HEAD_MAX = 12;
const RING_MAX = 3;

export class Locks {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    const cone = new THREE.ConeGeometry(0.22, 0.44, 4);
    cone.rotateX(Math.PI);                       // 尖朝下
    this.heads = Array.from({ length: HEAD_MAX }, () => {
      const m = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false }));
      m.renderOrder = 6; m.visible = false; scene.add(m);
      return { mesh: m, id: '' };
    });
    const ring = new THREE.RingGeometry(0.8, 1, 64);
    ring.rotateX(-Math.PI / 2);
    this.rings = Array.from({ length: RING_MAX }, () => {
      // 不做深度测试：落点常在石阶斜坡上，环会被坡面挡掉一半（实测）；白天地面亮，环要粗一点才看得见
      const m = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
      m.renderOrder = 4; m.visible = false; scene.add(m);
      return { mesh: m };
    });
    this.t = 0;
    /** 当前这组标记属于哪一次施法；收标记时对不上就不收（下一句已经接手） */
    this.owner = 0;
  }

  /**
   * 换上一组新标记（旧的全部撤掉）。
   * @param {number} owner 施法编号
   * @param {{ el: string, ids: string[], ring: { x: number, y: number, z: number, r: number } | null }[]} marks
   */
  show(owner, marks) {
    this.owner = owner;
    this.hideAll();
    let h = 0, r = 0;
    for (const m of marks) {
      // 亮度略超过泛光阈值：有一圈光晕，又不至于冲成白色看不出元素（2.2 倍时实测成了一团白）
      const c = col((PALETTE[m.el] || PALETTE.arcane).primary, 1.25);
      for (const id of m.ids) {
        if (h >= HEAD_MAX) break;
        const slot = this.heads[h++];
        slot.id = id;
        /** @type {THREE.MeshBasicMaterial} */ (slot.mesh.material).color.copy(c);
        slot.mesh.visible = true;
      }
      if (m.ring && r < RING_MAX) {
        const slot = this.rings[r++];
        slot.mesh.position.set(m.ring.x, m.ring.y + 0.05, m.ring.z);
        slot.mesh.scale.setScalar(m.ring.r);
        /** @type {THREE.MeshBasicMaterial} */ (slot.mesh.material).color.copy(c);
        slot.mesh.visible = true;
      }
    }
  }

  /** @param {number} owner */
  clear(owner) { if (owner === this.owner) this.hideAll(); }

  hideAll() {
    for (const s of this.heads) { s.mesh.visible = false; s.id = ''; }
    for (const s of this.rings) s.mesh.visible = false;
  }

  /**
   * @param {number} dt
   * @param {import('../actors/enemies.js').Enemies} enemies
   */
  update(dt, enemies) {
    this.t += dt;
    const bob = Math.sin(this.t * 6) * 0.08;
    for (const s of this.heads) {
      if (!s.mesh.visible) continue;
      const e = enemies.get(s.id);
      if (!e) { s.mesh.visible = false; continue; }       // 目标已死或坠崖
      s.mesh.position.set(e.pos.x, e.pos.y + 2.15 * e.scale + bob, e.pos.z);
      s.mesh.rotation.y = this.t * 2.5;
    }
    for (const s of this.rings) {
      if (!s.mesh.visible) continue;
      s.mesh.rotation.y = this.t * 0.6;
      /** @type {THREE.MeshBasicMaterial} */ (s.mesh.material).opacity = 0.8 + 0.15 * Math.sin(this.t * 5);
    }
  }

  dispose() {
    for (const s of [...this.heads, ...this.rings]) { this.scene.remove(s.mesh); /** @type {THREE.Material} */ (s.mesh.material).dispose(); }
    this.heads[0]?.mesh.geometry.dispose();
    this.rings[0]?.mesh.geometry.dispose();
  }
}
