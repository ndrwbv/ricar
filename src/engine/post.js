/* Постобработка «как в Bonehold»: сцена рисуется в буфер того же низкого разрешения,
   затем один полноэкранный проход красит кадр.

   Что делает проход (по порядку):
     1. насыщенность — общий цвет приглушается, но источники света остаются сочными;
     2. контраст вокруг средней точки — тени проваливаются в черноту, огонь и руны выбиваются;
     3. тонирование зоны — тени уходят в цвет подземелья (бирюза склепа, багрянец кузни),
        света чуть подкрашиваются тёплым;
     4. постеризация — необязательная, даёт «рисованные» ступеньки цвета;
     5. виньетка — тяжёлые тёмные углы, взгляд держится в центре.

   Параметры берутся из окружения уровня (env.grade), поэтому каждая зона красится по-своему.
   Один проход на полкадра — на Steam Deck это доли миллисекунды. */
import * as THREE from 'three';

export const DEFAULT_GRADE = {
  sat: .88,          // насыщенность: <1 приглушает
  contrast: 1.18,    // контраст вокруг pivot
  pivot: .26,        // середина сцены тёмная — иначе контраст съедает всё в чёрное
  lift: .02,         // общий подъём/провал яркости
  shadow: '#0e1a20', // цвет, в который уходят тени
  light: '#ffe8cc',  // подкраска светов
  tint: .55,         // сила тонирования теней
  vig: .62,          // сила виньетки
  vigStart: .30,     // радиус, с которого виньетка начинается
  steps: 0,          // постеризация: 0 — выкл, 12…32 — заметные ступени
};

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform sampler2D tDiffuse;
uniform vec3 uShadow;
uniform vec3 uLight;
uniform float uSat, uContrast, uPivot, uLift, uTint, uVig, uVigStart, uSteps, uAspect;
varying vec2 vUv;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

void main() {
  /* Кадр лежит в render target с colorSpace = sRGB, поэтому железо при выборке
     само переводит его в линейное пространство. Красить удобнее в перцептивном —
     переводим обратно один раз, а на выход отдаём уже без преобразований
     (холст ждёт именно sRGB). Без этого шага кадр выходил заметно темнее. */
  vec3 c = pow(max(texture2D(tDiffuse, vUv).rgb, 0.0), vec3(0.4545));

  // 1. насыщенность
  c = mix(vec3(dot(c, LUMA)), c, uSat);
  // 2. контраст
  c = clamp((c - uPivot) * uContrast + uPivot + uLift, 0.0, 1.0);
  // 3. тонирование: тени — в цвет зоны, света — тёплые
  float l = dot(c, LUMA);
  c = mix(c, uShadow * (l + 0.18), uTint * (1.0 - smoothstep(0.0, 0.55, l)));
  c = mix(c, c * uLight, 0.35 * smoothstep(0.42, 1.0, l));
  // 4. постеризация
  if (uSteps > 1.5) c = floor(c * uSteps + 0.5) / uSteps;
  // 5. виньетка
  vec2 d = (vUv - 0.5) * vec2(uAspect > 1.0 ? 1.0 : uAspect, uAspect > 1.0 ? 1.0 / uAspect : 1.0);
  float v = 1.0 - smoothstep(uVigStart, 0.72, length(d) * 1.42);
  c *= mix(1.0, v, uVig);

  gl_FragColor = vec4(c, 1.0);
}
`;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this.target = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      depthBuffer: true, stencilBuffer: false,
    });
    // кадр уже закодирован в sRGB — шейдер работает прямо в этих числах и отдаёт их как есть
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.target.texture.generateMipmaps = false;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uShadow: { value: new THREE.Color(DEFAULT_GRADE.shadow) },
        uLight: { value: new THREE.Color(DEFAULT_GRADE.light) },
        uSat: { value: DEFAULT_GRADE.sat },
        uContrast: { value: DEFAULT_GRADE.contrast },
        uPivot: { value: DEFAULT_GRADE.pivot },
        uLift: { value: DEFAULT_GRADE.lift },
        uTint: { value: DEFAULT_GRADE.tint },
        uVig: { value: DEFAULT_GRADE.vig },
        uVigStart: { value: DEFAULT_GRADE.vigStart },
        uSteps: { value: DEFAULT_GRADE.steps },
        uAspect: { value: 16 / 9 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.Camera();
  }

  setSize(w, h) { this.target.setSize(w, h); this.material.uniforms.uAspect.value = w / Math.max(1, h); }

  // применить настройки зоны: env.grade поверх значений по умолчанию
  setGrade(grade) {
    const g = { ...DEFAULT_GRADE, ...(grade || {}) };
    const u = this.material.uniforms;
    u.uShadow.value.set(g.shadow); u.uLight.value.set(g.light);
    u.uSat.value = g.sat; u.uContrast.value = g.contrast; u.uPivot.value = g.pivot;
    u.uLift.value = g.lift; u.uTint.value = g.tint;
    u.uVig.value = g.vig; u.uVigStart.value = g.vigStart; u.uSteps.value = g.steps;
    this.grade = g;
  }

  // сила виньетки/тонирования на время (удар, казнь) — возвращает прежние значения
  pulse(vig, tint) {
    const u = this.material.uniforms;
    u.uVig.value = vig; u.uTint.value = tint;
  }

  begin() { if (this.enabled) this.renderer.setRenderTarget(this.target); }
  end() {
    if (!this.enabled) return;
    this.renderer.setRenderTarget(null);
    const ac = this.renderer.autoClear; this.renderer.autoClear = false;
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = ac;
  }
  dispose() { this.target.dispose(); this.material.dispose(); this.quad.geometry.dispose(); }
}
