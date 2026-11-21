import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { BloomTexturePass, FinishShader } from '../../src/gfx/stage.js';

// The finish pass adds the bloom glow itself instead of letting three.js add it in an extra full-screen pass. These tests check the facts that make the two ways give the same picture, so a three.js update that changes the stock bloom is caught here and not on screen.

const size = new THREE.Vector2(64, 32);
const strip = (text) => text.replace(/\s+/g, '');

describe('bloom folded into the finish pass', () => {
  it('matches the last step of the stock bloom: a plain addition of the composite glow', () => {
    const stock = new UnrealBloomPass(size, 1, 0.5, 1);
    expect(stock.blendMaterial.blending).toBe(THREE.AdditiveBlending);
    // Premultiplied additive blending is ONE + ONE: the glow color is added as it is, its alpha plays no part.
    expect(stock.blendMaterial.premultipliedAlpha).toBe(true);
    expect(stock.copyUniforms.opacity.value).toBe(1);
    expect(strip(CopyShader.fragmentShader)).toContain('gl_FragColor=opacity*texel;');
    // The texture the stock pass adds is the composite target, the same one BloomTexturePass hands to the finish pass.
    expect(strip(UnrealBloomPass.prototype.render.toString())).toMatch(/copyUniforms\[['"]tDiffuse['"]\]\.value=this\.renderTargetsHorizontal\[0\]\.texture/);
    stock.dispose();
  });

  it('gives the composite target as the glow texture', () => {
    const pass = new BloomTexturePass(size, 0.5, 0.7, 1.15);
    expect(pass).toBeInstanceOf(UnrealBloomPass);
    expect(pass.texture).toBe(pass.renderTargetsHorizontal[0].texture);
    pass.dispose();
  });

  it('still finds every stock field its own render steps use', () => {
    const pass = new BloomTexturePass(size, 0.5, 0.7, 1.15);
    expect(pass.nMips).toBe(5);
    expect(pass.separableBlurMaterials).toHaveLength(pass.nMips);
    expect(pass.renderTargetsHorizontal).toHaveLength(pass.nMips);
    expect(pass.renderTargetsVertical).toHaveLength(pass.nMips);
    expect(pass.renderTargetBright).toBeInstanceOf(THREE.WebGLRenderTarget);
    expect(pass.highPassUniforms).toHaveProperty('tDiffuse');
    expect(pass.highPassUniforms).toHaveProperty('luminosityThreshold');
    expect(pass.materialHighPassFilter).toBeInstanceOf(THREE.ShaderMaterial);
    for (const blur of pass.separableBlurMaterials) {
      expect(blur.uniforms).toHaveProperty('colorTexture');
      expect(blur.uniforms).toHaveProperty('direction');
    }
    for (const name of ['bloomStrength', 'bloomRadius', 'bloomTintColors']) expect(pass.compositeMaterial.uniforms).toHaveProperty(name);
    expect(pass.clearColor).toBeInstanceOf(THREE.Color);
    expect(pass._oldClearColor).toBeInstanceOf(THREE.Color);
    expect(UnrealBloomPass.BlurDirectionX).toBeInstanceOf(THREE.Vector2);
    expect(UnrealBloomPass.BlurDirectionY).toBeInstanceOf(THREE.Vector2);
    pass.dispose();
  });
});

describe('finish shader', () => {
  it('ends with the renderer tone mapping and output color space, as the stock output pass did', () => {
    const body = FinishShader.fragmentShader;
    const write = body.indexOf('gl_FragColor = vec4(max(col, 0.0), 1.0);');
    expect(write).toBeGreaterThan(0);
    expect(body.indexOf('#include <tonemapping_fragment>')).toBeGreaterThan(write);
    expect(body.indexOf('#include <colorspace_fragment>')).toBeGreaterThan(body.indexOf('#include <tonemapping_fragment>'));
  });

  it('adds the glow only when bloom is on', () => {
    expect(FinishShader.fragmentShader).toMatch(/#ifdef USE_BLOOM[\s\S]*tBloom[\s\S]*#endif/);
    expect(FinishShader.uniforms).toHaveProperty('tBloom');
  });
});
