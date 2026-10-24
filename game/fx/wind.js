// @ts-check
/**
 * 风的专用画面（特效风格 v2 元素对照：青色发光笔触带卷成浪与漩涡）。
 *   - 笔触带：沿一条线、朝着镜头摊开的带子，两头尖、中间宽，像毛笔扫过去；先从尾往头"写"出来，再从尾往头"擦"掉。
 *     边上深青、带干笔的飞白，中线亮青（大于 1，过泛光发光）。普通混合：白石头和亮天上叠加的青色只剩一片淡白（火、冰都实测过）；
 *   - 拖尾：跟着一个会动的点（风刃的两个尖、被吹飞的傀儡）一路留下的笔触，越往后越细越淡。
 * 漩涡、浪的走线和时间在 spells.js 里排。
 */
import * as THREE from 'three';

/** 笔触的两种颜色：边（深青，压得住白石头）、芯（亮青，过泛光） */
// 芯 1.8 倍时整条笔触在泛光下糊成白青色的光圈，看不出笔触（实测），压到刚过泛光阈值
export const WIND_EDGE = new THREE.Color(0.0, 0.36, 0.3), WIND_CORE = new THREE.Color(0.35, 1.25, 0.95);

/**
 * 笔触材质。uHead、uTail：这一笔现在从哪画到哪（0 是线的起点、1 是终点）；uWidth：最宽处的半宽（米，不随物体缩放）。
 */
export function strokeMaterial(width = 0.12) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { uHead: { value: 1 }, uTail: { value: 0 }, uWidth: { value: width }, uAlpha: { value: 1 }, uSeed: { value: Math.random() * 50 },
      uEdge: { value: WIND_EDGE }, uCore: { value: WIND_CORE } },
    vertexShader: `attribute vec3 aTan; attribute float aSide; attribute float aU;
      uniform float uHead; uniform float uTail; uniform float uWidth;
      varying float vU; varying float vV; varying float vQ;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        vec3 t = normalize((modelViewMatrix * vec4(aTan, 0.)).xyz);
        vec3 s = cross(t, normalize(-mv.xyz));                       // 带子朝着镜头摊开
        s = dot(s, s) > 1e-6 ? normalize(s) : vec3(0., 1., 0.);
        float q = clamp((aU - uTail) / max(uHead - uTail, 1e-3), 0., 1.);
        float prof = pow(sin(3.14159 * q), 0.7) * (0.55 + 0.45 * q);   // 两头尖，靠前那头粗一点（下笔重）
        mv.xyz += s * aSide * uWidth * prof;
        vU = aU; vV = aSide; vQ = q;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uHead; uniform float uTail; uniform float uAlpha; uniform float uSeed; uniform vec3 uEdge; uniform vec3 uCore;
      varying float vU; varying float vV; varying float vQ;
      float h1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
      float n1(float x){ float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.), f * f * (3. - 2. * f)); }
      void main(){
        if (vU < uTail || vU > uHead) discard;
        float v = abs(vV);                                                   // 0 中线，1 边
        float lane = floor((vV * 0.5 + 0.5) * 12.);                          // 横着分成十几丝，每丝沿长度时断时续：干笔的飞白
        float dry = smoothstep(0.3, 0.62, n1(vU * 22. + h1(lane + uSeed) * 60.));
        float a = smoothstep(1., 0.72, v) * mix(1., dry, smoothstep(0.3, 0.85, v)) * smoothstep(0., 0.1, vQ) * uAlpha;
        if (a < 0.01) discard;
        float core = smoothstep(0.3, 0., v);   // 亮的只有中间一线，边上大半是深青（在白石头上压出笔触的形）
        gl_FragColor = vec4(mix(uEdge, uCore, core), a * (0.6 + 0.4 * core)); }`,
  });
}

/**
 * 笔触的几何体：线上每个点左右各一个顶点（aSide ±1），aTan 是切线，aU 是沿线走过的比例。
 * @param {number} n 点数
 */
function stripGeo(n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aTan', new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aU', new THREE.BufferAttribute(new Float32Array(n * 2), 1).setUsage(THREE.DynamicDrawUsage));
  const side = new Float32Array(n * 2), idx = [];
  for (let i = 0; i < n; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; }
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setIndex(idx);
  return g;
}

/** 把一串点写进笔触几何体（点数不能超过建的时候） @param {THREE.BufferGeometry} g @param {THREE.Vector3[]} pts */
function writeStrip(g, pts) {
  const pos = /** @type {THREE.BufferAttribute} */ (g.attributes.position), tan = /** @type {THREE.BufferAttribute} */ (g.attributes.aTan),
    u = /** @type {THREE.BufferAttribute} */ (g.attributes.aU);
  const n = pts.length;
  let total = 0;
  for (let i = 1; i < n; i++) total += pts[i].distanceTo(pts[i - 1]);
  let walked = 0;
  const t = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (i) walked += pts[i].distanceTo(pts[i - 1]);
    t.copy(pts[Math.min(n - 1, i + 1)]).sub(pts[Math.max(0, i - 1)]);
    if (t.lengthSq() < 1e-10) t.set(1, 0, 0);
    for (let k = 0; k < 2; k++) {
      pos.setXYZ(i * 2 + k, pts[i].x, pts[i].y, pts[i].z);
      tan.setXYZ(i * 2 + k, t.x, t.y, t.z);
      u.setX(i * 2 + k, total > 0 ? walked / total : i / Math.max(1, n - 1));
    }
  }
  g.setDrawRange(0, Math.max(0, (n - 1) * 6));
  pos.needsUpdate = tan.needsUpdate = u.needsUpdate = true;
}

/**
 * 一笔固定走线的笔触（模型坐标），用物体的位置、转动、缩放让它动起来。
 * @param {THREE.Vector3[]} pts @param {number} [width]
 */
export function stroke(pts, width) {
  const g = stripGeo(pts.length);
  writeStrip(g, pts);
  const m = new THREE.Mesh(g, strokeMaterial(width));
  m.frustumCulled = false;
  m.userData.ownGeo = true;   // 一笔一个几何体，特效结束时跟着释放
  return m;
}

/**
 * 拖尾：每帧给一个世界坐标，留下最近 n 个点连成的笔触。新的一头在 aU = 1。
 * 直接放在场景下（不挂到会动的物体上），点就是世界坐标。
 */
export class Trail {
  /** @param {number} [n] 最多几个点 @param {number} [width] @param {number} [minStep] 走多远记一个点（米） */
  constructor(n = 26, width = 0.1, minStep = 0.06) {
    this.n = n; this.minStep = minStep;
    /** @type {THREE.Vector3[]} */
    this.pts = [];
    this.mesh = new THREE.Mesh(stripGeo(n), strokeMaterial(width));
    this.mesh.frustumCulled = false;
    this.mesh.geometry.setDrawRange(0, 0);
    this.mat = /** @type {THREE.ShaderMaterial} */ (this.mesh.material);
  }

  /** @param {THREE.Vector3} p */
  push(p) {
    const last = this.pts[this.pts.length - 1];
    if (last && last.distanceToSquared(p) < this.minStep * this.minStep) { last.copy(p); }
    else { this.pts.push(p.clone()); if (this.pts.length > this.n) this.pts.shift(); }
    if (this.pts.length >= 2) writeStrip(this.mesh.geometry, this.pts);
  }

  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

/**
 * 漩涡的一股：从里往外、从下往上绕的螺旋线（模型坐标，原点在地面中心）。
 * 半径带一点起伏（太规整像一根弹簧，实测）。
 * @param {number} phase 起始角 @param {number} turns 绕几圈 @param {number} r0 @param {number} r1 @param {number} h 高
 */
export function helix(phase, turns, r0, r1, h, n = 40) {
  return Array.from({ length: n }, (_, i) => {
    const s = i / (n - 1), a = phase + s * turns * Math.PI * 2, r = (r0 + (r1 - r0) * s) * (1 + 0.14 * Math.sin(s * 9 + phase * 3));
    return new THREE.Vector3(Math.cos(a) * r, h * s * s * (3 - 2 * s), Math.sin(a) * r);
  });
}

/**
 * 浪：贴地顺着转的一道弧，末尾往里卷成一个小涡（像卷云纹、浪花）。模型坐标，半径 1 附近。
 * @param {number} a0 起始角 @param {number} len 弧长（弧度） @param {number} curl 末尾小涡的半径
 */
export function scroll(a0, len, curl, n = 44) {
  const pts = [], m = Math.round(n * 0.6);
  for (let i = 0; i < m; i++) {
    const s = i / (m - 1), a = a0 + s * len, r = 0.7 + 0.35 * s;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  // 末尾：沿前进方向往里卷一圈半，越卷越小
  const end = pts[pts.length - 1], aEnd = a0 + len, fwd = new THREE.Vector3(-Math.sin(aEnd), 0, Math.cos(aEnd)), inward = new THREE.Vector3(-Math.cos(aEnd), 0, -Math.sin(aEnd));
  const c = end.clone().addScaledVector(inward, curl);
  for (let i = 1; i <= n - m; i++) {
    const s = i / (n - m), th = s * Math.PI * 3, r = curl * (1 - 0.8 * s);
    pts.push(c.clone().addScaledVector(inward, -Math.cos(th) * r).addScaledVector(fwd, Math.sin(th) * r).setY(0.04 * s));
  }
  return pts;
}

/**
 * 风刃：一道往前凸的月牙（模型坐标，+z 是飞的方向，x 是两侧），两个尖往后掠。
 * @param {number} r 月牙的半径
 */
export function crescent(r, n = 24) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / (n - 1) - 0.5) * 2.3;
    return new THREE.Vector3(Math.sin(a) * r, 0, (Math.cos(a) - 1) * r);
  });
}
