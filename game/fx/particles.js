// @ts-check
/**
 * 粒子池：所有火花、拖尾、光雾共用一组顶点，叠加混合。
 * 颜色允许大于 1（HDR），交给泛光去晕开；按"每秒多少个"发射，慢动作下密度不变。
 *
 * 墨池（ink: true）：另一组顶点，普通混合、颜色很深、边缘不规则，画墨点和墨烟。
 * 先于所有发光特效画（renderOrder -1），亮的芯叠在墨上，就是参考里"墨色框住亮色"的样子。
 */
import * as THREE from 'three';

const GLOW_FRAG = `varying vec3 vColor; varying float vAlpha;
  void main(){ float d = length(gl_PointCoord - 0.5) * 2.; if (d > 1.) discard;
    float a = pow(1. - d, 1.7); float core = pow(max(1. - d * 2.4, 0.), 2.);
    gl_FragColor = vec4(vColor * (a + core * 1.6) * vAlpha, 1.); }`;

// 墨团：圆的边缘按角度起伏（每颗粒子的起伏不同），中间实、边上化开，再撒几个小墨点
const INK_FRAG = `varying vec3 vColor; varying float vAlpha; varying float vSeed;
  float h(float x){ return fract(sin(x * 91.7) * 43758.5453); }
  void main(){ vec2 q = gl_PointCoord - 0.5; float d = length(q) * 2.; if (d > 1.) discard;
    float ang = atan(q.y, q.x);
    float wob = 0.;
    for (int k = 1; k <= 3; k++) { float f = float(k) * 3.; wob += sin(ang * f + vSeed * 40. * float(k)) * (0.12 / float(k)); }
    float edge = 0.7 + wob;
    float body = smoothstep(edge, edge - 0.32, d);
    float dots = step(0.82, h(floor(ang * 5. + vSeed * 17.))) * smoothstep(0.08, 0., abs(d - 0.86 - 0.08 * h(vSeed)));
    float a = max(body, dots) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a); }`;

export class Particles {
  /** @param {THREE.Scene} scene @param {number} max @param {{ ink?: boolean }} [o] */
  constructor(scene, max = 9000, o = {}) {
    this.max = max;
    this.next = 0;
    this.ink = !!o.ink;
    const F = (n) => new Float32Array(max * n);
    this.pos = F(3); this.colA = F(3); this.size = F(1); this.alpha = F(1); this.seed = F(1);
    this.vel = F(3); this.c0 = F(3); this.c1 = F(3); this.life = F(1); this.maxLife = F(1);
    this.s0 = F(1); this.a0 = F(1); this.drag = F(1); this.grav = F(1); this.grow = F(1);
    /** 地面高度（粒子落地会弹一下）；没有地面的地方用很低的值 */
    this.floorAt = (x, z) => 0.03;
    const geo = this.geo = new THREE.BufferGeometry();
    const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', dyn(this.pos, 3));
    geo.setAttribute('aColor', dyn(this.colA, 3));
    geo.setAttribute('aSize', dyn(this.size, 1));
    geo.setAttribute('aAlpha', dyn(this.alpha, 1));
    geo.setAttribute('aSeed', dyn(this.seed, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: this.ink ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: { uScale: { value: 1 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute float aSeed;
        uniform float uScale; varying vec3 vColor; varying float vAlpha; varying float vSeed;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          // 贴着镜头的淡掉（第一人称、肩后时镜头就在粒子堆里，离 0.2 米的一颗会放大成几百像素，叠起来糊成一片白）
          vColor = aColor; vAlpha = aAlpha * smoothstep(0.4, 1.6, -mv.z); vSeed = aSeed; }`,
      fragmentShader: this.ink ? INK_FRAG : GLOW_FRAG,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    if (this.ink) this.points.renderOrder = -1;
    scene.add(this.points);
  }

  /** 画面高度变化时更新点的像素缩放 @param {number} heightPx @param {number} fovDeg */
  resize(heightPx, fovDeg) {
    this.mat.uniforms.uScale.value = (heightPx * 0.5) / Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
  }

  /** grow：寿命结束时的大小是开始的几倍（火花默认 0.45 越飞越小，墨烟给 2 左右越胀越大） */
  emit(px, py, pz, vx, vy, vz, life, size, c0, c1, { alpha = 1, drag = 0, grav = 0, grow = 0.45 } = {}) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = px; this.pos[i3 + 1] = py; this.pos[i3 + 2] = pz;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.c0[i3] = c0[0]; this.c0[i3 + 1] = c0[1]; this.c0[i3 + 2] = c0[2];
    this.c1[i3] = c1[0]; this.c1[i3 + 1] = c1[1]; this.c1[i3 + 2] = c1[2];
    this.life[i] = life; this.maxLife[i] = life; this.s0[i] = size; this.a0[i] = alpha;
    this.drag[i] = drag; this.grav[i] = grav; this.grow[i] = grow; this.seed[i] = Math.random();
  }

  /** @param {number} dt */
  update(dt) {
    const { pos, vel, life, maxLife } = this;
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { this.size[i] = 0; continue; }
      live++;
      life[i] -= dt;
      const i3 = i * 3, t = 1 - Math.max(life[i], 0) / maxLife[i];
      const damp = Math.exp(-this.drag[i] * dt);
      vel[i3] *= damp; vel[i3 + 1] = vel[i3 + 1] * damp + this.grav[i] * dt; vel[i3 + 2] *= damp;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      const fl = this.floorAt(pos[i3], pos[i3 + 2]);
      if (pos[i3 + 1] < fl) { pos[i3 + 1] = fl; vel[i3 + 1] *= -0.3; vel[i3] *= 0.6; vel[i3 + 2] *= 0.6; }
      for (let k = 0; k < 3; k++) this.colA[i3 + k] = this.c0[i3 + k] + (this.c1[i3 + k] - this.c0[i3 + k]) * t;
      const fadeIn = Math.min(1, t * 12);
      // 墨淡得慢一些（化开后才慢慢褪），火花按原来的曲线
      this.alpha[i] = this.a0[i] * fadeIn * Math.pow(Math.max(1 - t, 0), this.ink ? 0.9 : 1.4);
      this.size[i] = this.s0[i] * (1 + (this.grow[i] - 1) * t);
    }
    for (const n of ['position', 'aColor', 'aSize', 'aAlpha', 'aSeed']) this.geo.attributes[n].needsUpdate = true;
    return live;
  }
}
