// @ts-check
/**
 * 翻滚的火云（豪火灭却、火卷风用；10-27 照本人给的参考图重做）：一团团正对镜头的大火团，
 * 每团按噪声起伏成不规则的云边、里面是一道道火舌的亮脊；从白黄芯烧成橙、再冷成暗红褐、最后变成黑烟。
 * 另有一层烟（黑烟、白烟），先画，火团盖在上面——参考图里火浪外缘暗红、顶上和背后压着黑烟、贴地翻白烟。
 *
 * 粒子粗：一团半径一两米，几百团就铺满半个画面；位置在 CPU 上算（支持绕着一个会动的中心螺旋上升，火卷风用），
 * 每帧按离镜头远近排序（普通混合，远的先画），再写进实例属性。
 * 普通混合而不是叠加：白天背景亮，叠加的火只剩一片淡黄（fire.js 实测过）；芯的颜色大于 1，照样过泛光。
 */
import * as THREE from 'three';

const NOISE2 = `
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(h2(i), h2(i + vec2(1., 0.)), u.x), mix(h2(i + vec2(0., 1.)), h2(i + vec2(1., 1.)), u.x), u.y); }
float fbm(vec2 p){ return n2(p) * 0.62 + n2(p * 2.13 + 7.1) * 0.38; }
float ridge(vec2 p){ return (1. - abs(n2(p) * 2. - 1.)) * 0.65 + (1. - abs(n2(p * 2.3 + 3.7) * 2. - 1.)) * 0.35; }`;

const VERT = `attribute vec3 iPos; attribute float iSize; attribute float iRot; attribute float iAspect;
  attribute float iHeat; attribute float iAlpha; attribute float iSeed;
  varying vec2 vUv; varying float vHeat; varying float vAlpha; varying float vSeed;
  void main(){
    vec4 mv = viewMatrix * vec4(iPos, 1.);
    float c = cos(iRot), s = sin(iRot);
    vec2 q = position.xy * vec2(1., iAspect);                 // 火舌：竖着拉长（拉长在转之前，转了也还是一条）
    mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y) * iSize;
    gl_Position = projectionMatrix * mv;
    vUv = position.xy; vHeat = iHeat; vAlpha = iAlpha; vSeed = iSeed; }`;

/** 火团：heat 1 白热 → 0 已冷成烟色 */
const FIRE_FRAG = `uniform float uTime; varying vec2 vUv; varying float vHeat; varying float vAlpha; varying float vSeed;
  ${NOISE2}
  void main(){
    vec2 p = vUv; float d = length(p);
    float n = fbm(p * 1.7 + vSeed * 13. + vec2(0., -uTime * 0.9));
    // 云边：半径按噪声起伏。消散不是整团变透明（半透明的老团叠在一起就糊，10-27 截图），而是边被噪声往里啃
    float e = d + (n - 0.5) * 0.75 + (1. - clamp(vAlpha, 0., 1.)) * 0.85;
    // 边要收得利落，团与团才分得开（软边那版糊成一片橙）；再乘一道按 d 的收口，不然噪声把边推到面片外，露出方方的直边（10-27 截图）
    float shape = smoothstep(1., 0.8, e) * smoothstep(1., 0.84, d);
    if (shape < 0.01) discard;
    // 往上窜的火舌亮脊。频率 2.4、权重 0.5 那版团里满是小黑洞，像麻子（10-27 截图）：放粗、减弱，热团中间不许冷成黑
    float r = ridge(p * 1.5 + vSeed * 5. + vec2(0., -uTime * 1.6));
    // 噪声的起伏越往外越强：芯里也压得太狠会冒出一个个圆的暗洞，像骷髅眼（10-27 截图）
    float w = 0.35 + 0.65 * d;
    float t = clamp(vHeat * (1.32 - d * 0.95) + ((r - 0.5) * 0.4 + (n - 0.5) * 0.3) * w * (0.5 + 0.5 * vHeat), 0., 1.);
    t = max(t, vHeat * 0.6 * (1. - d));
    vec3 c = mix(vec3(0.07, 0.05, 0.045), vec3(0.36, 0.06, 0.02), smoothstep(0.04, 0.22, t));   // 烟 → 暗红褐
    c = mix(c, vec3(1.22, 0.34, 0.045), smoothstep(0.22, 0.52, t));                          // → 橙
    c = mix(c, vec3(1.75, 0.95, 0.24), smoothstep(0.58, 0.8, t));                            // → 金黄
    c = mix(c, vec3(2.1, 1.65, 0.85), smoothstep(0.86, 1., t));                              // → 白黄的芯
    // 外缘一圈暗红褐（参考图里一个个火团就是靠这圈勾出来的）
    c = mix(c, vec3(0.3, 0.055, 0.018) * (0.55 + 0.45 * vHeat), smoothstep(0.5, 0.95, e) * 0.8);
    gl_FragColor = vec4(c, shape * min(1., vAlpha * 2.5)); }`;

/** 烟：heat 拿来当白度，0 黑烟、1 白烟 */
const SMOKE_FRAG = `uniform float uTime; varying vec2 vUv; varying float vHeat; varying float vAlpha; varying float vSeed;
  ${NOISE2}
  void main(){
    vec2 p = vUv; float d = length(p);
    float n = fbm(p * 1.5 + vSeed * 11. + vec2(uTime * 0.15, -uTime * 0.35));
    float shape = smoothstep(1., 0.4, d + (n - 0.5) * 0.9) * smoothstep(1., 0.7, d);   // 同火团：收口，免得露出直边
    if (shape < 0.01) discard;
    float shade = 0.75 + 0.45 * (n - 0.5) + 0.25 * (-p.y);                                   // 下面背光、暗一些
    vec3 c = mix(vec3(0.06, 0.05, 0.05), vec3(0.88, 0.86, 0.83), vHeat) * shade;
    gl_FragColor = vec4(c, shape * vAlpha * mix(0.85, 0.6, vHeat)); }`;

/**
 * @typedef {{ x: number, y: number, z: number, vx: number, vy: number, vz: number, t: number, life: number,
 *   r0: number, r1: number, heat: number, cool: number, alpha: number, rot: number, spin: number, aspect: number, seed: number,
 *   drag: number, rise: number, orbit: { c: THREE.Vector3, a: number, r: number, w: number, grow: number } | null, depth: number }} Puff
 */

/** 一组实例化的面片：同一个材质，按远近排好再写属性 */
class Layer {
  /** @param {THREE.Scene} scene @param {number} max @param {string} frag @param {number} order @param {{ value: number }} uTime */
  constructor(scene, max, frag, order, uTime) {
    this.max = max;
    /** @type {Puff[]} */
    this.list = [];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    /** @type {Record<string, THREE.InstancedBufferAttribute>} */
    this.attr = {};
    for (const [k, n] of /** @type {[string, number][]} */ ([['iPos', 3], ['iSize', 1], ['iRot', 1], ['iAspect', 1], ['iHeat', 1], ['iAlpha', 1], ['iSeed', 1]])) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(k, a); this.attr[k] = a;
    }
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, uniforms: { uTime },
      vertexShader: VERT, fragmentShader: frag }));
    this.mesh.frustumCulled = false;   // 顶点在着色器里才展开
    this.mesh.renderOrder = order;
    scene.add(this.mesh);
  }

  /** @param {THREE.Vector3} camPos @param {THREE.Vector3} camDir */
  write(camPos, camDir) {
    const L = this.list, A = this.attr;
    for (const p of L) p.depth = (p.x - camPos.x) * camDir.x + (p.y - camPos.y) * camDir.y + (p.z - camPos.z) * camDir.z;
    L.sort((a, b) => b.depth - a.depth);   // 远的先画
    const pos = /** @type {Float32Array} */ (A.iPos.array);
    L.forEach((p, i) => {
      const k = p.t / p.life;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      A.iSize.array[i] = p.r0 + (p.r1 - p.r0) * (1 - (1 - k) * (1 - k));   // 先胀得快、后慢
      A.iRot.array[i] = p.rot;
      A.iAspect.array[i] = p.aspect;
      A.iHeat.array[i] = p.heat * Math.pow(1 - k, p.cool);
      // 晚一点才淡：火团冷成暗红褐、再成烟的那一段要看得见（参考图火浪外缘、背后都是这一层）
      A.iAlpha.array[i] = p.alpha * Math.min(1, k * 8) * (k < 0.72 ? 1 : 1 - (k - 0.72) / 0.28);
      A.iSeed.array[i] = p.seed;
    });
    for (const a of Object.values(A)) a.needsUpdate = true;
    /** @type {THREE.InstancedBufferGeometry} */ (this.mesh.geometry).instanceCount = L.length;
  }
}

/** 火团中心离实心东西至少这么远（米）：面片正对镜头，中心不进墙，从正面看就不会被墙面切出一道直线 */
const SOLID_GAP = 0.35;

export class FlameClouds {
  /**
   * @param {THREE.Scene} scene @param {number} [density] 手机流畅档给小一点，团数按它打折
   * @param {{ min: number[], max: number[] }[]} [solids] 场景里实心的盒子：火团撞上就停住、贴着往上爬，生在里面的直接不要
   * （豪火灭却往牌坊方向推时，尽头的火团插进门墙，被墙面切成方块，10-27 截图）
   */
  constructor(scene, density = 1, solids = []) {
    this.density = density;
    this.solids = solids;
    this.uTime = { value: 0 };
    this.smoke = new Layer(scene, 400, SMOKE_FRAG, 3, this.uTime);
    this.fire = new Layer(scene, 700, FIRE_FRAG, 4, this.uTime);
    this._cp = new THREE.Vector3(); this._cd = new THREE.Vector3();
  }

  /**
   * 放一团。o.heat：起始热度（1 白热）；o.cool：热度掉得多快（大于 1 先快后慢）；o.rise：往上浮的加速度；
   * o.orbit：绕着 c（会动的点，存引用）转——a 起始角、r 半径、w 每秒转多少弧度、grow 比 c 每高 1 米半径加多少；有它时 x、z 由它定。
   * @param {'fire' | 'smoke'} kind
   * @param {{ x: number, y: number, z: number, vx?: number, vy?: number, vz?: number, life: number, r0: number, r1: number,
   *   heat?: number, cool?: number, alpha?: number, rot?: number, spin?: number, aspect?: number, drag?: number, rise?: number,
   *   orbit?: { c: THREE.Vector3, a: number, r: number, w: number, grow: number } }} o
   */
  puff(kind, o) {
    const layer = kind === 'fire' ? this.fire : this.smoke;
    if (layer.list.length >= layer.max || (!o.orbit && this.inSolid(o) >= 0)) return;
    layer.list.push({ x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, t: 0, life: o.life, r0: o.r0, r1: o.r1,
      heat: o.heat ?? 1, cool: o.cool ?? 1, alpha: o.alpha ?? 1, rot: o.rot ?? Math.random() * Math.PI * 2, spin: o.spin ?? (Math.random() - 0.5) * 2,
      aspect: o.aspect ?? 1, seed: Math.random(), drag: o.drag ?? 0, rise: o.rise ?? 0, orbit: o.orbit || null, depth: 0 });
  }

  /** @param {number} dt @param {THREE.Camera} camera */
  update(dt, camera) {
    this.uTime.value += dt;
    camera.getWorldPosition(this._cp); camera.getWorldDirection(this._cd);
    for (const layer of [this.smoke, this.fire]) {
      const L = layer.list;
      for (let i = L.length - 1; i >= 0; i--) {
        const p = L[i];
        p.t += dt;
        if (p.t >= p.life) { L[i] = L[L.length - 1]; L.pop(); continue; }
        const damp = Math.exp(-p.drag * dt);
        p.vx *= damp; p.vz *= damp; p.vy = p.vy * damp + p.rise * dt;
        p.rot += p.spin * dt;
        if (p.orbit) {
          const o = p.orbit;
          o.a += o.w * dt; p.y += p.vy * dt;
          const r = o.r + o.grow * Math.max(0, p.y - o.c.y);
          p.x = o.c.x + Math.cos(o.a) * r; p.z = o.c.z + Math.sin(o.a) * r;
        } else {
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          this.pushOut(p);
        }
      }
      layer.write(this._cp, this._cd);
    }
  }

  /** p 落在哪个（往外放宽了 SOLID_GAP 的）实心盒子里，没有返回 -1 @param {{ x: number, y: number, z: number }} p */
  inSolid(p) {
    const S = this.solids, g = SOLID_GAP;
    for (let i = 0; i < S.length; i++) {
      const { min, max } = S[i];
      if (p.x > min[0] - g && p.x < max[0] + g && p.y > min[1] - g && p.y < max[1] + g && p.z > min[2] - g && p.z < max[2] + g) return i;
    }
    return -1;
  }

  /** 飘进了实心盒子：从进得最浅的那个面推出去，那个方向的速度清零（于是贴着墙往两边、往上铺开） @param {Puff} p */
  pushOut(p) {
    const i = this.inSolid(p);
    if (i < 0) return;
    const { min, max } = this.solids[i], g = SOLID_GAP, c = /** @type {const} */ (['x', 'y', 'z']), v = /** @type {const} */ (['vx', 'vy', 'vz']);
    let best = Infinity, axis = 0, to = 0;
    for (let a = 0; a < 3; a++) {
      const lo = p[c[a]] - (min[a] - g), hi = max[a] + g - p[c[a]];
      if (lo < best) { best = lo; axis = a; to = min[a] - g; }
      if (hi < best) { best = hi; axis = a; to = max[a] + g; }
    }
    p[c[axis]] = to; p[v[axis]] = 0;
  }

  /** 场上还有几团（调试面板、测试用） */
  get live() { return this.fire.list.length + this.smoke.list.length; }

  clear() {
    for (const layer of [this.smoke, this.fire]) { layer.list.length = 0; /** @type {THREE.InstancedBufferGeometry} */ (layer.mesh.geometry).instanceCount = 0; }
  }
}
