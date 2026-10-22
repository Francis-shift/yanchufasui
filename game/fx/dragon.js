// @ts-check
/**
 * 召唤：冰龙（从法术 Demo 移植，模型由本人用 Tripo 生成）。
 *
 * 做法：龙头沿一条预先设计的三维曲线按弧长前进；龙的模型是笔直的，
 * 每一帧把模型上每个点按"离龙头多远"贴到曲线的对应位置上（路径变形），整条龙就沿同一条路径游动。
 * 破土、盘旋、绕场、俯冲、灌进地里，全靠这条曲线编排。
 *
 * 两种演法：
 *   - summon：真召出来——施法者左前方亮法阵，龙破土而出，绕广场上空一圈，俯冲砸向目标（伤害由 main 在 onImpact 里结算）；
 *   - ghost：差一口气——只有一层发光的龙影从法阵里升起，盘到半空散成冰屑，然后 main 放同元素的雨。
 * 同一时间只演一条（共用一份网格）；正在演时再来，龙影就省掉，雨照放。
 *
 * 模型按需加载（第一次要用时，或气势槽过半时预先加载）：DRG2 格式（读法见 world/drg2.js）。没加载成功时，召唤照样结算，只是没有龙的画面。
 */
import * as THREE from 'three';
import { PALETTE, arcsTex, col, easeOutBack, easeOutCubic, perSec, rand, randDir, ringMat, scaleArr, sigilMat, sigilTex } from './common.js';
import { CASTER_POS } from '../world/layout.js';
import { decodeDRG2, fetchBytes } from '../world/drg2.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DRAGON_LEN = 20;          // 龙身长（米）
const STATIONS = 160;           // 沿龙身取多少个截面算曲线位置，顶点在相邻截面之间插值
const REST = 7;                 // 每个顶点的预计算量：截面号、插值比例、侧偏移、上偏移、法线在侧/上/前三个方向的分量
/** 破土点：施法者左前方（广场上，地面以下看不见） */
const EMERGE = new THREE.Vector3(CASTER_POS.x - 3, 0, CASTER_POS.z - 1.2);

/** 外层辉光：同一份网格再画一遍，越是侧对镜头的面越亮（菲涅尔）。法线由屏幕空间导数算出，模型不必带法线 */
function glowMat(color, alpha) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, depthFunc: THREE.LessEqualDepth,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    uniforms: { uColor: { value: color }, uAlpha: { value: alpha } },
    vertexShader: `varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vV = mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec3 vV;
      void main(){ vec3 c = cross(dFdx(vV), dFdy(vV));
        float l = length(c);
        if (l < 1e-12) discard;                    // 退化的面求不出法线，直接不画，免得归一化出 NaN
        vec3 n = c / l;
        float f = pow(1. - abs(dot(n, normalize(-vV))), 2.);
        gl_FragColor = vec4(uColor * f * uAlpha, 1.); }`,
  });
}

export class DragonFx {
  /**
   * @param {import('./spells.js').SpellFx} fx
   * @param {import('./particles.js').Particles} particles
   * @param {{ mesh?: string, tex?: string | null }} [urls]
   */
  constructor(fx, particles, urls = {}) {
    this.fx = fx; this.p = particles; this.urls = urls;
    /** @type {Promise<any> | null} */
    this.loading = null;
    /** @type {any} */
    this.model = null;
    /** @type {Flight | null} */
    this.active = null;
    this.light = new THREE.PointLight(0x66ccff, 0, 0, 2);   // 常驻，只改强度（增减灯光会让材质重编译）
    fx.scene.add(this.light);
    this.glow = glowMat(col(PALETTE.ice.secondary, 1.1), 0.55);
    // 龙影：白天只靠叠加的边缘光几乎看不见（10-19 截图），再垫一层半透明的淡蓝身体
    this.ghostMat = new THREE.MeshBasicMaterial({ color: col(PALETTE.ice.secondary, 0.95), transparent: true, opacity: 0.5, depthWrite: false });
    this.sigilTex = sigilTex(); this.arcsTex = arcsTex();
  }

  /** 开始下载模型（重复调用无妨） */
  preload() {
    if (!this.loading && this.urls.mesh) this.loading = this.load().catch((e) => { console.warn('冰龙模型加载失败：', e); return null; });
    return this.loading;
  }

  async load() {
    const urls = /** @type {{ mesh: string, tex?: string | null }} */ (this.urls);
    const [buf, tex] = await Promise.all([fetchBytes(urls.mesh), urls.tex ? new THREE.TextureLoader().loadAsync(urls.tex).catch(() => null) : null]);
    const d = decodeDRG2(buf);
    let material;
    if (tex && d.uv) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;                               // 贴图坐标按 glTF 约定（v 从上往下）
      tex.anisotropy = 4;
      // 上色版：贴图当底色，同一张贴图再当自发光贴图，冰会透出自己的颜色，泛光也是冰蓝而不是白
      material = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0.35, 0.55, 0.9), roughness: 0.3, metalness: 0.1 });
    } else {
      // 没有贴图（预览页用的减面版）：冰晶材质，平面着色，不需要法线
      material = new THREE.MeshStandardMaterial({ color: 0xa8e2ff, emissive: new THREE.Color(0.05, 0.3, 0.72), roughness: 0.12, metalness: 0.15, flatShading: true });
    }
    const { nv, lo, hi, axis, anc, P, uv, index, N } = d;
    // 每个顶点：在龙身上的位置（换成相邻两个截面号 + 插值比例），相对中心线的侧向、上向偏移（米），
    // 以及法线在"侧、上、前"三个方向上的分量（模型坐标里侧 = x、上 = y、前 = z）
    const len = hi[2] - lo[2], scale = DRAGON_LEN / len;
    const toRest = (x, y, z, out, o) => {
      const f = THREE.MathUtils.clamp((hi[2] - z) / len, 0, 1) * (STATIONS - 1);
      const k0 = Math.min(Math.floor(f), STATIONS - 2);
      out[o] = k0; out[o + 1] = f - k0; out[o + 2] = (x - axis[0]) * scale; out[o + 3] = (y - axis[1]) * scale;
      return out;
    };
    const rest = new Float32Array(nv * REST);
    for (let i = 0; i < nv; i++) {
      toRest(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], rest, i * REST);
      if (N) {
        let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        // 零长度法线在着色器里归一化会得到 NaN，泛光把它放大成整屏闪烁。打包时已修补，这里再兜一次底：改成朝上
        if (Math.hypot(nx, ny, nz) < 0.01) { nx = 0; ny = 1; nz = 0; }
        rest[i * REST + 4] = nx; rest[i * REST + 5] = ny; rest[i * REST + 6] = nz;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    if (N) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const tail = [];                                     // 后 40% 龙身的顶点，尾部霜雾从这里冒
    for (let i = 0; i < nv; i++) if (rest[i * REST] > STATIONS * 0.6) tail.push(i);
    const anchor = (j) => toRest(anc[j * 3], anc[j * 3 + 1], anc[j * 3 + 2], new Float32Array(4), 0);
    this.model = { geo, rest, nv, tail, hasNormals: !!N, material,
      anchors: { whiskers: [anchor(0), anchor(1)], mouth: anchor(2) } };
    return this.model;
  }

  /**
   * 真召唤：龙破土、绕场、俯冲砸向 target，砸中时调用 onImpact（伤害在 main 里结算）。
   * 模型还没下好就先亮法阵等着；等 3 秒还没好，直接结算（没有龙的画面）。
   * 龙要飞好几秒，敌人在走：follow 每帧给出目标现在的位置，龙的俯冲段跟着挪，砸的就是锁定的那几只。
   * @param {THREE.Vector3} target @param {string} el @param {(p: THREE.Vector3) => void} onImpact
   * @param {() => THREE.Vector3 | null} [follow]
   */
  summon(target, el, onImpact, follow) {
    this.preload();
    if (this.active) this.active.finish();
    this.active = new Flight(this, 'summon', target, el, onImpact, follow);
    this.fx.pulseDim(0.85, 3.2);   // 龙出场：世界压暗，龙和它的光成为画面里最亮的东西
  }

  /**
   * 差一口气：龙影升起又散去，然后调用 onDone（main 在这里放雨）。正在演别的龙时不演，直接 onDone。
   * @param {string} el @param {() => void} onDone
   */
  ghost(el, onDone) {
    this.preload();
    if (this.active || !this.model) { onDone(); return; }
    this.active = new Flight(this, 'ghost', EMERGE.clone().add(new THREE.Vector3(0, 7, 0)), el, () => onDone());
  }

  /** @param {number} dt */
  update(dt) {
    if (this.active && !this.active.update(dt)) this.active = null;
  }

  clear() { if (this.active) { this.active.finish(); this.active = null; } }
}

const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _s = new THREE.Vector3(), _u = new THREE.Vector3();
const _d = new THREE.Vector3(), _anc = new Float32Array(3);

/** 一次飞行（真召唤或龙影） */
class Flight {
  /**
   * @param {DragonFx} owner @param {'summon' | 'ghost'} kind @param {THREE.Vector3} target
   * @param {string} el @param {(p: THREE.Vector3) => void} onImpact @param {() => THREE.Vector3 | null} [follow]
   */
  constructor(owner, kind, target, el, onImpact, follow) {
    this.o = owner; this.kind = kind; this.el = el; this.onImpact = onImpact; this.follow = follow;
    this.pal = PALETTE[el] || PALETTE.ice;
    const T = this.target = target.clone(), E = EMERGE;
    const v = (x, y, z) => new THREE.Vector3(x, y, z);
    if (kind === 'summon') {
      const dive = v(T.x + 1.5, T.y + 5, T.z + 5);
      this.dir = T.clone().sub(dive).normalize();
      this.curve = new THREE.CatmullRomCurve3([
        E.clone().add(v(0, -4, 0)), E.clone().add(v(0, -0.5, 0)),                  // 地下 → 破土
        E.clone().add(v(0.9, 1.6, -0.7)), E.clone().add(v(2.1, 3.1, 0.5)),         // 螺旋上升
        E.clone().add(v(0.7, 4.4, 1.9)), E.clone().add(v(-1.6, 5.2, 0.8)),
        // 绕广场上空一圈。高度按固定镜头算过：后排 10 米高会出画面顶边（10-19 截图），压到 7～7.5 米
        v(-6.5, 7, 0.5), v(-4, 7.5, -8.5), v(5, 7.5, -8), v(7, 6.5, 0.5),
        dive, T.clone(),                                                            // 俯冲撞向目标
        T.clone().add(this.dir.clone().multiplyScalar(1.2)).add(v(0, -3, 0)),        // 之后钻进地下，身体跟着灌进去
        T.clone().add(v(this.dir.x * 2, -30, this.dir.z * 2)),
      ], false, 'centripetal');
    } else {
      this.dir = v(0, 1, 0);
      this.curve = new THREE.CatmullRomCurve3([
        E.clone().add(v(0, -4, 0)), E.clone().add(v(0, -0.5, 0)), E.clone().add(v(0.9, 1.8, -0.7)),
        E.clone().add(v(2, 3.6, 0.5)), E.clone().add(v(0.5, 5.2, 1.6)), E.clone().add(v(-1.8, 6.4, 0.6)), E.clone().add(v(-2.4, 7.6, -1.5)),
      ], false, 'centripetal');
    }
    this.curve.arcLengthDivisions = 1500;
    this.L = this.curve.getLength();
    let best = Infinity; this.sHit = 0; this.sEmerge = 0;
    for (let i = 0; i <= 3000; i++) {
      const s = (i / 3000) * this.L, q = this.curve.getPointAt(i / 3000);
      const d = q.distanceToSquared(T);
      if (d < best) { best = d; this.sHit = s; }
      if (!this.sEmerge && q.y > 0) this.sEmerge = s;
    }
    if (kind === 'ghost') this.sHit = this.L;
    this.age = 0; this.s = 0; this.emerged = false; this.impacted = false; this.waitT = 0;
    this.lastS = new THREE.Vector3(1, 0, 0);
    this.st = new Float32Array(STATIONS * 12);    // 每个截面的位置、侧向、上向、前向（各 3 个数），每帧重算
    this.headPos = new THREE.Vector3(0, -50, 0); this.headT = new THREE.Vector3(0, 0, 1); this.headU = new THREE.Vector3(0, 1, 0);
    this.tailPos = new THREE.Vector3(0, -50, 0);
    /** @type {THREE.Mesh | null} */ this.body = null;
    /** @type {THREE.Mesh | null} */ this.glowMesh = null;

    // 召唤法阵：先亮 0.45 秒，龙才破土
    const scene = owner.fx.scene;
    this.sigil = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 7.2), sigilMat(owner.sigilTex, col(this.pal.primary, 1.6)));
    this.arcs = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 8.4), sigilMat(owner.arcsTex, col(this.pal.secondary, 1.3)));
    for (const m of [this.sigil, this.arcs]) { m.rotation.x = -Math.PI / 2; m.position.set(E.x, 0.04, E.z); scene.add(m); }
    owner.light.color.copy(col(this.pal.primary));
  }

  /** 模型到了才挂上网格 */
  attach() {
    const model = this.o.model, scene = this.o.fx.scene;
    this.body = new THREE.Mesh(model.geo, this.kind === 'summon' ? model.material : this.o.ghostMat);
    this.body.castShadow = this.kind === 'summon';
    this.body.frustumCulled = false;
    scene.add(this.body);
    this.glowMesh = new THREE.Mesh(model.geo, this.o.glow);
    this.glowMesh.frustumCulled = false;
    this.glowMesh.renderOrder = 1;
    scene.add(this.glowMesh);
    this.o.glow.uniforms.uAlpha.value = this.kind === 'ghost' ? 1.1 : 0.55;
    this.o.ghostMat.opacity = 0.5;
  }

  /**
   * 目标走动了：只挪曲线最后四个点（俯冲起点、落点、钻地的两点），前面的盘旋绕场不动。
   * 落点在第 11 个控制点上；曲线参数 t = 11/13 处的弧长就是撞上目标的位置。
   * @param {THREE.Vector3 | null} p
   */
  retarget(p) {
    if (!p || p.distanceToSquared(this.target) < 0.0025) return;
    const T = this.target.copy(p), pts = this.curve.points;
    const dive = new THREE.Vector3(T.x + 1.5, T.y + 5, T.z + 5);
    this.dir.copy(T).sub(dive).normalize();
    pts[10].copy(dive); pts[11].copy(T);
    pts[12].copy(T).addScaledVector(this.dir, 1.2).add(new THREE.Vector3(0, -3, 0));
    pts[13].copy(T).add(new THREE.Vector3(this.dir.x * 2, -30, this.dir.z * 2));
    this.curve.updateArcLengths();
    this.L = this.curve.getLength();
    const lens = this.curve.getLengths();
    this.sHit = lens[Math.round((11 / 13) * (lens.length - 1))];
  }

  speedAt(s) {
    if (this.kind === 'ghost') return s < this.sEmerge ? 16 : 10;
    if (s < this.sEmerge) return 14;            // 地下段快速通过
    if (s < this.sEmerge + 9) return 8.5;       // 破土盘旋，放慢让人看清
    if (s < this.sHit - 8) return 17;           // 绕场
    return 30;                                  // 俯冲与灌入
  }

  frameAt(s, outP, outT) {                      // 弧长 s 处的位置、切线，以及侧向 _s、上向 _u
    const u = THREE.MathUtils.clamp(s / this.L, 0, 1);
    this.curve.getPointAt(u, outP); this.curve.getTangentAt(u, outT);
    // 必须是右手系（侧 × 上 = 前），否则 makeBasis 得到的是镜像矩阵：朝向算错、正反面颠倒
    _s.crossVectors(WORLD_UP, outT);
    if (_s.lengthSq() < 1e-4) _s.copy(this.lastS); else { _s.normalize(); this.lastS.copy(_s); }
    _u.crossVectors(outT, _s).normalize();
  }

  // 模型上一点（rest 里从 ri 起：截面号、插值比例、侧偏移、上偏移）→ 世界坐标，写进 out[oi..oi+2]
  restToWorld(rest, ri, out, oi) {
    const st = this.st, k = rest[ri] * 12, t = rest[ri + 1], ox = rest[ri + 2], oy = rest[ri + 3];
    for (let c = 0; c < 3; c++) {
      const p = st[k + c] + (st[k + 12 + c] - st[k + c]) * t;
      const sv = st[k + 3 + c] + (st[k + 15 + c] - st[k + 3 + c]) * t;
      const uv = st[k + 6 + c] + (st[k + 18 + c] - st[k + 6 + c]) * t;
      out[oi + c] = p + sv * ox + uv * oy;
    }
  }

  // 法线跟着截面一起转：世界法线 = 侧向 × 侧分量 + 上向 × 上分量 + 前向 × 前分量
  restNormal(rest, ri, out, oi) {
    const st = this.st, k = rest[ri] * 12, t = rest[ri + 1], ns = rest[ri + 4], nu = rest[ri + 5], nf = rest[ri + 6];
    for (let c = 0; c < 3; c++) {
      const sv = st[k + 3 + c] + (st[k + 15 + c] - st[k + 3 + c]) * t;
      const uv = st[k + 6 + c] + (st[k + 18 + c] - st[k + 6 + c]) * t;
      const tv = st[k + 9 + c] + (st[k + 21 + c] - st[k + 9 + c]) * t;
      out[oi + c] = sv * ns + uv * nu + tv * nf;
    }
  }

  anchor(a, v) { this.restToWorld(a, 0, _anc, 0); return v.set(_anc[0], _anc[1], _anc[2]); }

  emit(...a) { /** @type {any} */ (this.o.p).emit(...a); }

  /** @param {number} dt @returns {boolean} 还要继续 */
  update(dt) {
    this.age += dt;
    const E = EMERGE, T = this.target, pal = this.pal, o = this.o;

    // 法阵：亮起 → 旋转 → 龙出完后淡出
    const sk = Math.min(this.age / 0.35, 1), fade = 1 - THREE.MathUtils.clamp((this.age - 2.6) / 0.8, 0, 1);
    this.sigil.material.opacity = sk * fade; this.arcs.material.opacity = sk * fade * 0.8;
    this.sigil.scale.setScalar(Math.max(easeOutBack(sk), 0.001)); this.arcs.scale.copy(this.sigil.scale);
    this.sigil.rotation.z += dt * 0.8; this.arcs.rotation.z -= dt * 1.5;

    // 模型还没到：法阵转着等；3 秒还没到就不等了（真召唤直接结算）
    if (!o.model) {
      this.waitT += dt;
      this.chargeParticles(dt);
      if (this.waitT > 3) {
        if (this.kind === 'summon') { this.impactFx(); this.onImpact(T.clone()); }
        else this.onImpact(T.clone());
        this.finish(); return false;
      }
      return true;
    }
    if (!this.glowMesh) { this.attach(); this.age = Math.min(this.age, 0.45); }
    if (this.age < 0.5) this.chargeParticles(dt);
    if (this.age > 0.45) this.s += this.speedAt(this.s) * dt;
    if (this.follow && !this.impacted && this.s < this.sHit - 3) this.retarget(this.follow());

    // 沿龙身取截面：第 k 个截面在龙头身后 k/(N−1) × 龙身长处，再叠一点左右摆动（越靠尾摆得越大）
    const st = this.st, N = STATIONS;
    for (let k = 0; k < N; k++) {
      this.frameAt(this.s - (k / (N - 1)) * DRAGON_LEN, _p, _t);
      if (k === 0) { this.headPos.copy(_p); this.headT.copy(_t); this.headU.copy(_u); }
      _p.addScaledVector(_s, Math.sin(this.age * 7 - k * 0.13) * 0.18 * (0.3 + k / N));
      const q = k * 12;
      st[q] = _p.x; st[q + 1] = _p.y; st[q + 2] = _p.z;
      st[q + 3] = _s.x; st[q + 4] = _s.y; st[q + 5] = _s.z;
      st[q + 6] = _u.x; st[q + 7] = _u.y; st[q + 8] = _u.z;
      st[q + 9] = _t.x; st[q + 10] = _t.y; st[q + 11] = _t.z;
    }
    this.tailPos.set(st[(N - 1) * 12], st[(N - 1) * 12 + 1], st[(N - 1) * 12 + 2]);
    // 路径变形：每个顶点 = 两个截面之间插值出的中心点 + 侧向 × 侧偏移 + 上向 × 上偏移；有法线的模型法线一起转
    const model = o.model, rest = model.rest, attrs = model.geo.attributes, out = attrs.position.array;
    for (let i = 0, nv = model.nv; i < nv; i++) this.restToWorld(rest, i * REST, out, i * 3);
    attrs.position.needsUpdate = true;
    if (model.hasNormals && this.kind === 'summon') {
      const nout = attrs.normal.array;
      for (let i = 0, nv = model.nv; i < nv; i++) this.restNormal(rest, i * REST, nout, i * 3);
      attrs.normal.needsUpdate = true;
    }
    const headPos = this.headPos, headT = this.headT, headU = this.headU;

    if (!this.emerged && headPos.y > -0.1) {                               // 破土瞬间
      this.emerged = true;
      o.fx.shake = Math.max(o.fx.shake, this.kind === 'ghost' ? 0.12 : 0.3);
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMat(col(pal.secondary, 2)));
      ring.rotation.x = -Math.PI / 2; ring.position.set(E.x, 0.06, E.z);
      o.fx.addTimed(ring, 0.9, (k) => { ring.scale.setScalar(0.01 + easeOutCubic(k) * 10); ring.material.uniforms.uAlpha.value = Math.pow(1 - k, 1.6) * 1.3; });
      for (let i = 0; i < 120; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 1.5;
        this.emit(E.x + Math.cos(a) * r, 0.1, E.z + Math.sin(a) * r, Math.cos(a) * rand(1, 3), rand(4, 10), Math.sin(a) * rand(1, 3),
          rand(0.6, 1.2), rand(0.06, 0.12), scaleArr(pal.secondary, 2.4), scaleArr(pal.primary, 1), { drag: 1.2, grav: -5 });
      }
      if (this.kind === 'summon' && this.el === 'ice') o.fx.frostShards(E, 10, 0.7);
    }

    if (this.kind === 'ghost') return this.updateGhost(dt);

    // 粒子：龙身表面的冰晶闪光、尾部霜雾、两道龙须拖痕
    if (this.emerged && !this.impacted) {
      const pos = attrs.position.array, nv = model.nv, tail = model.tail;
      for (let i = perSec(260, dt); i > 0; i--) {
        const j = Math.floor(Math.random() * nv) * 3;
        if (pos[j + 1] < 0.1) continue;
        const v3 = randDir().multiplyScalar(0.6);
        this.emit(pos[j] + v3.x * 0.2, pos[j + 1] + v3.y * 0.2, pos[j + 2] + v3.z * 0.2, v3.x, v3.y + 0.3, v3.z, rand(0.6, 1.2), rand(0.05, 0.1),
          scaleArr(pal.secondary, 2.4), scaleArr(pal.primary, 1.0), { drag: 1.2 });
      }
      for (let i = perSec(30, dt); i > 0; i--) {
        const j = tail[Math.floor(Math.random() * tail.length)] * 3;
        if (pos[j + 1] < 0.1) continue;
        this.emit(pos[j], pos[j + 1], pos[j + 2], rand(-0.3, 0.3), rand(-0.2, 0.2), rand(-0.3, 0.3), rand(1, 1.6), rand(0.5, 0.9),
          scaleArr(pal.primary, 0.7), scaleArr(pal.secondary, 0.3), { alpha: 0.12, drag: 1 });
      }
      for (const a of model.anchors.whiskers) {
        const w = this.anchor(a, _d);
        for (let i = perSec(120, dt); i > 0; i--) {
          this.emit(w.x, w.y, w.z, rand(-0.1, 0.1), rand(-0.1, 0.1), rand(-0.1, 0.1), 0.5, rand(0.035, 0.05),
            scaleArr(pal.secondary, 3), scaleArr(pal.primary, 1.2));
        }
      }
      if (this.s > this.sHit - 7) {                                        // 俯冲时喷出龙息
        const m = this.anchor(model.anchors.mouth, _d);
        for (let i = perSec(500, dt); i > 0; i--) {
          const v3 = randDir().multiplyScalar(2.5).addScaledVector(headT, rand(8, 14));
          this.emit(m.x, m.y, m.z, v3.x, v3.y, v3.z, rand(0.35, 0.6), rand(0.1, 0.22),
            scaleArr(pal.core, 2.2), scaleArr(pal.secondary, 1.2), { drag: 2 });
        }
      }
    }

    // 光跟着龙头：照亮身体和地面。灯放在龙头上方 4.5 米、身后 1.5 米，否则近景龙头发白
    o.light.position.copy(headPos).addScaledVector(headU, 4.5).addScaledVector(headT, -1.5);
    o.light.intensity = this.emerged && !this.impacted ? 22 : Math.max(o.light.intensity - dt * 60, 0);

    // 命中：大号爆炸 + 地面霜雾 + 落雪；之后身体继续灌进爆点
    if (!this.impacted && this.s >= this.sHit) {
      this.impacted = true;
      this.impactFx();
      this.onImpact(T.clone());
    }
    if (this.impacted) {
      if (this.tailPos.y > T.y - 0.3) {
        for (let i = perSec(300, dt); i > 0; i--) {
          const v3 = randDir(); v3.y = Math.abs(v3.y); v3.multiplyScalar(rand(3, 9));
          this.emit(T.x, T.y + 0.2, T.z, v3.x, v3.y, v3.z, rand(0.6, 1.2), rand(0.06, 0.12),
            scaleArr(pal.secondary, 2.4), scaleArr(pal.primary, 1), { drag: 1, grav: -6 });
        }
      }
      if (this.s - DRAGON_LEN > this.sHit + 1 && this.age > 3.6) { this.finish(); return false; }
    }
    return true;
  }

  /** 龙影：升到半空、发光变淡，最后整条散成冰屑 */
  updateGhost(dt) {
    const o = this.o, pal = this.pal, model = o.model, pos = model.geo.attributes.position.array;
    const end = 1.9;   // 升起后多久开始散
    const k = this.age < end ? 1 : Math.max(0, 1 - (this.age - end) / 0.4);
    o.glow.uniforms.uAlpha.value = 1.1 * k;
    o.ghostMat.opacity = 0.5 * k;
    o.light.position.copy(this.headPos).add(new THREE.Vector3(0, 3, 0));
    o.light.intensity = this.age < end + 0.4 ? 10 : 0;
    if (this.age >= end && !this.impacted) {
      this.impacted = true;
      for (let i = 0; i < 700; i++) {
        const j = Math.floor(Math.random() * model.nv) * 3;
        if (pos[j + 1] < 0.1) continue;
        const v3 = randDir().multiplyScalar(rand(1, 4));
        this.emit(pos[j], pos[j + 1], pos[j + 2], v3.x, v3.y, v3.z, rand(0.6, 1.3), rand(0.05, 0.12),
          scaleArr(pal.secondary, 2.2), scaleArr(pal.primary, 1), { drag: 1.5, grav: -2 });
      }
      this.onImpact(this.target.clone());
    }
    if (this.age > end + 0.45) { this.finish(); return false; }
    return true;
  }

  /** 蓄力：元素碎屑沿地面旋入法阵中心 */
  chargeParticles(dt) {
    const E = EMERGE, pal = this.pal;
    for (let i = perSec(320, dt); i > 0; i--) {
      const a = Math.random() * Math.PI * 2, r = rand(2.6, 3.4);
      const cx = Math.cos(a), cz = Math.sin(a);
      this.emit(E.x + cx * r, 0.08, E.z + cz * r, -cx * 4 - cz * 3, rand(0.2, 0.8), -cz * 4 + cx * 3, 0.45, rand(0.05, 0.1),
        scaleArr(pal.secondary, 2), scaleArr(pal.primary, 1.5), { drag: 0.6 });
    }
  }

  /** 砸中：大号爆炸 + 冰棱 + 地面霜雾 + 一阵落雪 */
  impactFx() {
    const T = this.target, fx = this.o.fx, pal = this.pal;
    fx.burst(T, this.el, 4.5, 1.6);
    fx.impact(T, 1);
    fx.pulseDim(0.62, 1.2);
    fx.shake = Math.max(fx.shake, 0.55);
    fx.hitStop = Math.max(fx.hitStop, 0.09);
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(3, 7);
      this.emit(T.x, T.y + 0.3, T.z, Math.cos(a) * sp, rand(0, 0.4), Math.sin(a) * sp, rand(1.2, 2), rand(0.8, 1.4),
        scaleArr(pal.primary, 0.9), scaleArr(pal.secondary, 0.25), { alpha: 0.12, drag: 1.4 });
    }
    if (this.el === 'ice') {
      fx.frostShards(T, 22, 1.4);
      let t = 0;
      fx.fx.push({
        update: (dt) => {
          t += dt;
          for (let i = perSec(110 * (1 - t / 4), dt); i > 0; i--) {
            this.emit(T.x + rand(-9, 9), T.y + rand(6, 9), T.z + rand(-7, 7), rand(-0.3, 0.3), rand(-1.4, -0.8), rand(-0.3, 0.3),
              rand(3, 5), rand(0.04, 0.07), [1.6, 1.9, 2.2], [0.5, 0.7, 1.0], { alpha: 0.8, drag: 0.2 });
          }
          return t < 4;
        },
        dispose() {},
      });
    }
  }

  finish() {
    const scene = this.o.fx.scene;
    for (const m of [this.body, this.glowMesh, this.sigil, this.arcs]) if (m) scene.remove(m);
    this.sigil.material.dispose(); this.arcs.material.dispose();
    this.o.light.intensity = 0;
  }
}
