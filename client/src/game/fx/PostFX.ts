/** Final-image effects: vignette, film grain, chromatic aberration on danger, capture pulse. */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    danger: { value: 0 },
    pulse: { value: 0 },
    flash: { value: 0 },
    vignette: { value: 1 },
    brightness: { value: 1 },
    hide: { value: 0 },
    desat: { value: 0 },
    grain: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, danger, pulse, flash, vignette, brightness, hide, desat, grain;
    varying vec2 vUv;
    float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233)) + time*7.13) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 dc = uv - 0.5;
      float ab = 0.0015 + danger * 0.006;
      // subtle warping when the Nower is very close
      uv += dc * danger * 0.015 * sin(time * 3.0 + uv.y * 10.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dc * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dc * ab).b;
      col *= brightness;
      float lum = dot(col, vec3(0.299,0.587,0.114));
      col = mix(col, vec3(lum), 0.25 + desat * 0.6);
      float v = smoothstep(0.85, 0.25, length(dc) * (1.0 + danger * 0.35)) ;
      col *= mix(1.0, v, 0.75 * vignette);
      col += (rand(uv) - 0.5) * (0.035 + danger * 0.04) * grain;
      col = mix(col, vec3(lum * 0.9, 0.0, 0.0) + vec3(0.25,0.0,0.0) * pulse, pulse * 0.6);
      // hiding: slightly heavier vignette only; the framing comes from the real furniture geometry
      col *= mix(1.0, smoothstep(0.95, 0.35, length(dc)), hide * 0.35);
      col += flash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFX {
  composer: EffectComposer;
  pass: ShaderPass;
  private render: RenderPass;
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.render = new RenderPass(scene, camera);
    this.pass = new ShaderPass(HorrorShader);
    this.composer.addPass(this.render);
    this.composer.addPass(this.pass);
    this.composer.addPass(new OutputPass());
  }
  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }
  set(u: Partial<Record<'time' | 'danger' | 'pulse' | 'flash' | 'vignette' | 'brightness' | 'hide' | 'desat' | 'grain', number>>) {
    for (const [k, v] of Object.entries(u)) this.pass.uniforms[k].value = v;
  }
  renderFrame() {
    this.composer.render();
  }
  dispose() {
    this.composer.dispose();
  }
}
