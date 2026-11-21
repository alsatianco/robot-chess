// The render pipeline: WebGL renderer, HDR post-processing (bloom, vignette, grain) and the quality levels. Everything visual is drawn through this one class.
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** What each graphics quality level turns on. Low is tuned for weak phones, high for desktops. */
export const QUALITY = {
  low: { dpr: 1, msaa: 0, bloom: false, shadows: false, shadowSize: 0, reflection: false, clearcoat: false, skySize: 512, particles: 0.5 },
  medium: { dpr: 1.5, msaa: 2, bloom: true, shadows: true, shadowSize: 1024, reflection: false, clearcoat: true, skySize: 1024, particles: 0.8 },
  high: { dpr: 2, msaa: 4, bloom: true, shadows: true, shadowSize: 2048, reflection: true, clearcoat: true, skySize: 1024, particles: 1 },
};

// The one full-screen pass that turns the HDR scene into the final picture. It adds the bloom glow, then gives the final look in linear HDR (a soft vignette, a very small color fringe near the edges, a light film grain that hides banding in dark gradients, and the screen flash), and at the end applies the renderer's tone mapping and output color space. Doing all of this in one pass means the full-size image is read once and written once per frame.
export const FinishShader = {
  name: 'FinishShader',
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.42 },
    uFringe: { value: 0.0005 },
    uGrain: { value: 0.022 },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform float uTime;
    uniform float uVignette;
    uniform float uFringe;
    uniform float uGrain;
    uniform vec4 uFlash;
    varying vec2 vUv;
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * uFringe * 8.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      #ifdef USE_BLOOM
        // The glow is a plain addition, read at the same fringe offsets as the scene so it shifts with it.
        col.r += texture2D(tBloom, vUv + off).r;
        col.g += texture2D(tBloom, vUv).g;
        col.b += texture2D(tBloom, vUv - off).b;
      #endif
      float vig = smoothstep(0.95, 0.25, sqrt(r2) * 1.25);
      col *= mix(1.0 - uVignette, 1.0, vig);
      float g = hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain * (0.35 + col);
      col = mix(col, uFlash.rgb, uFlash.a);
      // Last line of defense: a pixel that is not a number is shown black instead of spreading.
      if (!(col.r == col.r && col.g == col.g && col.b == col.b)) col = vec3(0.0);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/**
 * Bloom that only makes the glow texture. The stock three.js pass ends with one more full-screen pass that adds the glow onto the full-size scene image (a plain additive copy). Here the finish pass adds the glow while it reads the scene anyway, so that extra pass is not needed and the result is the same. Steps 1 to 3 below are the stock pass's own steps, unchanged.
 */
export class BloomTexturePass extends UnrealBloomPass {
  /** The finished glow, ready to be added to the scene. */
  get texture() {
    return this.renderTargetsHorizontal[0].texture;
  }

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.WebGLRenderTarget|null} writeBuffer Not used: the glow stays in this pass's own targets.
   * @param {THREE.WebGLRenderTarget} readBuffer The scene image.
   */
  render(renderer, writeBuffer, readBuffer) {
    if (!this.quad) this.quad = new FullScreenQuad(null);
    const quad = this.quad;
    renderer.getClearColor(this._oldClearColor);
    this._oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    try {
      // 1. Keep only the bright areas.
      this.highPassUniforms.tDiffuse.value = readBuffer.texture;
      this.highPassUniforms.luminosityThreshold.value = this.threshold;
      quad.material = this.materialHighPassFilter;
      renderer.setRenderTarget(this.renderTargetBright);
      renderer.clear();
      quad.render(renderer);

      // 2. Blur them into smaller and smaller levels.
      let input = this.renderTargetBright;
      for (let i = 0; i < this.nMips; i++) {
        const blur = this.separableBlurMaterials[i];
        quad.material = blur;
        blur.uniforms.colorTexture.value = input.texture;
        blur.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
        renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
        renderer.clear();
        quad.render(renderer);
        blur.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
        blur.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
        renderer.setRenderTarget(this.renderTargetsVertical[i]);
        renderer.clear();
        quad.render(renderer);
        input = this.renderTargetsVertical[i];
      }

      // 3. Combine the levels into the glow texture.
      quad.material = this.compositeMaterial;
      this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
      this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
      this.compositeMaterial.uniforms.bloomTintColors.value = this.bloomTintColors;
      renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
      renderer.clear();
      quad.render(renderer);
    } finally {
      renderer.setClearColor(this._oldClearColor, this._oldClearAlpha);
      renderer.autoClear = oldAutoClear;
    }
  }

  dispose() {
    super.dispose();
    this.quad?.dispose();
  }
}

export class Stage {
  /** One pixel, the target of the read in `waitForGpu`. */
  #pixel = new Uint8Array(4);

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {'low'|'medium'|'high'} quality
   */
  constructor(canvas, quality) {
    this.canvas = canvas;
    this.qualityName = quality;
    this.quality = QUALITY[quality];
    // No depth buffer on the canvas itself: the 3D scene is drawn into its own target, and only the flat finish pass is drawn on the canvas.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x050818, 1);

    this.scene = new THREE.Scene();
    // `render` updates the scene's matrices once per frame itself, so the passes before the main pass and the main pass share that one update instead of each walking the whole scene again.
    this.scene.matrixWorldAutoUpdate = false;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
    this.camera.position.set(0, 12, 10);
    this.camera.lookAt(0, 0, 0);

    this.width = 1;
    this.height = 1;
    this.time = 0;
    /** Called after a quality change so scene objects can adapt (shadows, reflection, materials). */
    this.onQualityChange = new Set();
    /** @type {Set<(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void>} Work that draws into its own target before the main scene pass (the floor mirror). It runs after the scene's matrices are up to date. */
    this.prePasses = new Set();

    this.finishMaterial = new THREE.ShaderMaterial({
      name: FinishShader.name,
      uniforms: THREE.UniformsUtils.clone(FinishShader.uniforms),
      vertexShader: FinishShader.vertexShader,
      fragmentShader: FinishShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.finishQuad = new FullScreenQuad(this.finishMaterial);

    this.#buildTargets();
    this.applyQuality();
  }

  // The scene is drawn into one multisampled HDR target. All later passes are flat full-screen quads, which have no edges to smooth, so none of them draw into a multisampled target.
  #buildTargets() {
    this.sceneTarget?.dispose();
    this.bloomPass?.dispose();
    const q = this.quality;
    const size = new THREE.Vector2(this.width, this.height);
    this.sceneTarget = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: q.msaa, depthBuffer: true });
    // Only the color is read after the scene pass, so the multisampled depth is not copied out with it.
    this.sceneTarget.resolveDepthBuffer = false;
    // Threshold above 1: only the HDR lights (eyes, strips, beams) and the sharpest highlights bloom; the white shells stay crisp.
    this.bloomPass = new BloomTexturePass(size, 0.5, 0.7, 1.15);
    this.bloomPass.enabled = q.bloom;
  }

  /** Change the quality level at run time. */
  setQuality(name) {
    if (!QUALITY[name] || name === this.qualityName) return;
    this.qualityName = name;
    this.quality = QUALITY[name];
    this.#buildTargets();
    this.applyQuality();
    this.resize(this.cssWidth, this.cssHeight);
    for (const fn of this.onQualityChange) fn(this.quality, name);
  }

  applyQuality() {
    const q = this.quality;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.bloomPass.enabled = q.bloom;
  }

  /** Resize to the canvas' CSS size. */
  resize(cssWidth, cssHeight) {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.dpr);
    this.width = Math.max(1, Math.floor(cssWidth * dpr));
    this.height = Math.max(1, Math.floor(cssHeight * dpr));
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssWidth, cssHeight, false);
    this.sceneTarget.setSize(cssWidth * dpr, cssHeight * dpr);
    this.bloomPass.setSize(cssWidth * dpr, cssHeight * dpr);
    this.camera.aspect = cssWidth / cssHeight;
    this.camera.updateProjectionMatrix();
  }

  /** A short full-screen color flash (used for big moments when the player allows flashes). */
  setFlash(color, amount) {
    const flash = this.finishMaterial.uniforms.uFlash.value;
    flash.set(color.r, color.g, color.b, amount);
  }

  render(dt) {
    this.time += dt;
    const { renderer, scene, camera } = this;
    scene.updateMatrixWorld();
    if (camera.parent === null) camera.updateMatrixWorld();
    // Passes with their own target go first. Switching targets in the middle of the main pass would make the GPU store the half-drawn picture and load it back again.
    for (const pass of this.prePasses) pass(renderer, scene, camera);
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);

    const bloom = this.bloomPass.enabled;
    if (bloom) this.bloomPass.render(renderer, null, this.sceneTarget);

    const material = this.finishMaterial;
    if (bloom !== ('USE_BLOOM' in material.defines)) {
      if (bloom) material.defines.USE_BLOOM = '';
      else delete material.defines.USE_BLOOM;
      material.needsUpdate = true;
    }
    material.uniforms.tDiffuse.value = this.sceneTarget.texture;
    material.uniforms.tBloom.value = bloom ? this.bloomPass.texture : null;
    material.uniforms.uTime.value = this.time;
    renderer.setRenderTarget(null);
    this.finishQuad.render(renderer);
  }

  /** Wait until the graphics chip has finished every frame drawn so far. Reading one pixel back from the canvas is the one way a web page can wait for it. Only for measuring the frame time ("auto" quality): a normal frame must never wait. */
  waitForGpu() {
    const gl = this.renderer.getContext();
    this.renderer.setRenderTarget(null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.#pixel);
  }

  dispose() {
    this.sceneTarget.dispose();
    this.bloomPass.dispose();
    this.finishQuad.dispose();
    this.finishMaterial.dispose();
    this.renderer.dispose();
  }
}
