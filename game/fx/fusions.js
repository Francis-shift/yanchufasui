// @ts-check
/**
 * 融合法术的样子（伤害在 main.js 结算）：
 *   - 火卷风（先风后火）：一根燃烧的旋风柱，从目标处往外卷 3 秒，碰到的敌人被点着、卷起来甩出去；
 *   - 豪火灭却（先火后风，10-27 由"烈焰冲击"改名）：从施法者身前喷出一道又宽又长的火柱，一路烧穿。
 */
import * as THREE from 'three';
import { col, easeOutCubic, glowShellMat, PALETTE, rand, scaleArr } from './common.js';
import { groundHeightAt } from '../world/layout.js';
import { BEAM, TORNADO } from '../rules/numbers.js';

export class FusionFx {
  /** @param {import('./spells.js').SpellFx} fx @param {import('./particles.js').Particles} particles */
  constructor(fx, particles) {
    this.fx = fx; this.p = particles;
    /** @type {{ pos: THREE.Vector3, dir: THREE.Vector3, t: number, hit: Set<string>, step: any, shell: THREE.Mesh }[]} */
    this.tornadoes = [];
  }

  /**
   * 放一根火卷风，返回它（main 每帧拿它的位置判断碰到了谁）。
   * @param {THREE.Vector3} at 起点 @param {THREE.Vector3} dir 往哪边卷（水平单位向量）
   */
  tornado(at, dir, step) {
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(TORNADO.r * 0.55, TORNADO.r * 0.25, 5, 28, 1, true),
      glowShellMat(col(PALETTE.fire.primary, 1.05), 1));   // 1.5 倍在白天天空前冲成了白色（10-19 截图）
    shell.geometry.translate(0, 2.5, 0);
    this.fx.scene.add(shell);
    const tw = { pos: at.clone(), dir: dir.clone(), t: 0, hit: new Set(), step, shell };
    this.tornadoes.push(tw);
    this.fx.shake = Math.max(this.fx.shake, 0.3);
    this.fx.pulseDim(0.6, 2.4);   // 融合是招牌：火卷风卷着走的这几秒压暗
    return tw;
  }

  /**
   * 豪火灭却：只管样子，0.7 秒。
   * @param {THREE.Vector3} from 施法者胸口 @param {THREE.Vector3} dir 水平单位向量
   */
  beam(from, dir) {
    const fire = PALETTE.fire, wind = PALETTE.wind;
    const len = BEAM.len;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, len, 32, 1, true), glowShellMat(col(fire.primary, 1.8), 0));
    shell.geometry.rotateX(Math.PI / 2).translate(0, 0, len / 2);
    shell.position.copy(from);
    shell.lookAt(from.clone().add(dir));
    this.fx.addTimed(shell, 0.7, (k) => {
      const grow = easeOutCubic(Math.min(1, k * 4));
      shell.scale.set(BEAM.halfW * (0.4 + 0.6 * grow) * (1 - 0.3 * k), BEAM.halfW * (0.4 + 0.6 * grow) * (1 - 0.3 * k), Math.max(0.01, grow));
      /** @type {THREE.ShaderMaterial} */ (shell.material).uniforms.uAlpha.value = Math.pow(1 - k, 1.5);
    });
    // 沿火柱喷一大片火星和气流
    for (let i = 0; i < 700; i++) {
      const s = Math.random() * len, lat = rand(-1, 1) * BEAM.halfW * (0.3 + 0.7 * s / len);
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const x = from.x + dir.x * s * 0.3 + side.x * lat * 0.3, z = from.z + dir.z * s * 0.3 + side.z * lat * 0.3;
      const v = dir.clone().multiplyScalar(rand(14, 26)).addScaledVector(side, lat * 1.5);
      const w = i % 4 === 0;
      this.p.emit(x, from.y + rand(-0.4, 0.4), z, v.x, rand(-0.5, 1.5), v.z, rand(0.4, 0.8), rand(0.12, 0.3),
        scaleArr(w ? wind.secondary : fire.core, w ? 1.4 : 2.6), scaleArr(w ? wind.primary : fire.primary, 1.1), { drag: 1.4, alpha: w ? 0.6 : 0.9 });
    }
    this.fx.shake = Math.max(this.fx.shake, 0.55);
    this.fx.hitStop = Math.max(this.fx.hitStop, 0.06);
    this.fx.pulseDim(0.65, 0.8);
    this.fx.impact(from.clone().addScaledVector(dir, len * 0.5), 0.8);
  }

  /** @param {number} dt */
  update(dt) {
    const fire = PALETTE.fire, wind = PALETTE.wind;
    for (let i = this.tornadoes.length - 1; i >= 0; i--) {
      const tw = this.tornadoes[i];
      tw.t += dt;
      tw.pos.addScaledVector(tw.dir, TORNADO.speed * dt);
      tw.pos.y = groundHeightAt(tw.pos.x, tw.pos.z) ?? tw.pos.y;
      const fade = Math.min(1, tw.t / 0.25) * Math.min(1, (TORNADO.sec - tw.t) / 0.4);
      tw.shell.position.copy(tw.pos);
      tw.shell.rotation.y += dt * 9;
      tw.shell.scale.set(1 + 0.08 * Math.sin(tw.t * 20), 1, 1 + 0.08 * Math.cos(tw.t * 20));
      /** @type {THREE.ShaderMaterial} */ (tw.shell.material).uniforms.uAlpha.value = 0.75 * fade;
      // 螺旋往上卷的火与风
      const n = Math.round(420 * dt * fade);
      for (let k = 0; k < n; k++) {
        const h = Math.random() * 5, a = tw.t * 9 + h * 1.6 + Math.random() * 0.8, r = TORNADO.r * (0.25 + 0.6 * h / 5);
        const x = tw.pos.x + Math.cos(a) * r, z = tw.pos.z + Math.sin(a) * r;
        const w = k % 3 === 0;
        this.p.emit(x, tw.pos.y + h, z, -Math.sin(a) * 7, rand(2, 5), Math.cos(a) * 7, rand(0.3, 0.6), rand(0.12, 0.26),
          scaleArr(w ? wind.secondary : fire.core, w ? 1.3 : 2.4), scaleArr(w ? wind.primary : fire.primary, 1.0), { drag: 2, alpha: w ? 0.55 : 0.9 });
      }
      if (tw.t >= TORNADO.sec) {
        this.fx.scene.remove(tw.shell);
        tw.shell.geometry.dispose(); /** @type {THREE.Material} */ (tw.shell.material).dispose();
        this.tornadoes.splice(i, 1);
      }
    }
  }

  clear() {
    for (const tw of this.tornadoes) { this.fx.scene.remove(tw.shell); tw.shell.geometry.dispose(); /** @type {THREE.Material} */ (tw.shell.material).dispose(); }
    this.tornadoes.length = 0;
  }
}
