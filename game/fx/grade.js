// @ts-check
/**
 * 调色与冲击后期：放在色调映射之后（画面已是显示用的颜色），做电影常用的几件事——
 * S 形对比、饱和度、暗部偏青亮部偏暖、暗角、细颗粒；命中的一瞬间朝落点径向模糊、边缘轻微色散。
 * 只处理整屏的观感；"大招时世界变暗、特效照样亮"由场景灯光与天空完成（environment.js setDim），不在这里压。
 */
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uTime: { value: 0 },
    uImpact: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uContrast; uniform float uSaturation; uniform float uVignette;
    uniform float uGrain; uniform float uTime; uniform float uImpact; uniform vec2 uCenter; uniform float uAspect;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 toC = uCenter - vUv;
      vec3 c;
      if (uImpact > 0.001) {
        // 径向模糊：沿着朝落点的方向取 8 个样本，越靠外越糊；色散只在边缘
        vec3 acc = vec3(0.); float wsum = 0.;
        for (int i = 0; i < 8; i++) {
          float k = float(i) / 7.;
          float w = 1. - k * 0.6;
          acc += texture2D(tDiffuse, vUv + toC * k * 0.024 * uImpact).rgb * w; wsum += w;
        }
        c = acc / wsum;
        vec2 ca = (vUv - 0.5) * 0.0028 * uImpact;
        c.r = mix(c.r, texture2D(tDiffuse, vUv + ca).r, 0.6);
        c.b = mix(c.b, texture2D(tDiffuse, vUv - ca).b, 0.6);
      } else {
        c = texture2D(tDiffuse, vUv).rgb;
      }
      // S 形对比（以中灰为轴）与饱和度
      c = clamp((c - 0.5) * uContrast + 0.5, 0., 1.);
      c = mix(c, c * c * (3. - 2. * c), (uContrast - 1.) * 1.5);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      // 暗部偏青、亮部偏暖（电影里常见的冷暖分离，压得很轻）
      c += vec3(-0.012, 0.004, 0.02) * (1. - l) * (1. - l) + vec3(0.018, 0.008, -0.012) * l * l;
      // 暗角：按画面比例做成椭圆
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.);
      c *= 1. - uVignette * smoothstep(0.35, 1.05, length(d) * 1.25);
      // 细颗粒：每帧换图案
      c += (hash(vUv * 1000. + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(c, 0., 1.), 1.);
    }`,
};

export class GradePass extends ShaderPass {
  /** @param {import('../quality.js').Quality['grade']} g */
  constructor(g) {
    super(GradeShader);
    this.g = g;
    const u = this.uniforms;
    u.uContrast.value = g.contrast;
    u.uSaturation.value = g.saturation;
    u.uVignette.value = g.vignette;
    u.uGrain.value = g.grain;
  }

  /**
   * 每帧调用。impact 0～1 是这一刻的冲击强度（落点爆炸时冲上去、很快衰减），center 是落点在屏幕上的位置（0～1）。
   * @param {number} dt @param {number} impact @param {THREE.Vector2} center @param {number} aspect
   */
  tick(dt, impact, center, aspect) {
    const u = this.uniforms;
    u.uTime.value = (u.uTime.value + dt) % 100;
    u.uImpact.value = impact * this.g.impact;
    u.uCenter.value.copy(center);
    u.uAspect.value = aspect;
  }
}
