// The robot shell material. One physically based material draws a whole robot: each vertex carries a slot number, and the team's palette turns that slot into color, roughness, metalness, glow and clearcoat inside the shader. This keeps a robot at a handful of draw calls and gives every robot its own live controls (power, flash, rim light, teleport wipe).
import * as THREE from 'three';
import { TEAMS, SLOT_COUNT } from './palette.js';

const VERTEX_PARS = /* glsl */ `
  attribute float aSlot;
  uniform vec3 uPalette[${SLOT_COUNT}];
  uniform vec4 uPbr[${SLOT_COUNT}];
  varying vec3 vSlotColor;
  varying vec4 vSlotPbr;
  varying vec3 vRcWorld;
`;

const VERTEX_MAIN = /* glsl */ `
  int rcSlot = int(aSlot + 0.5);
  vSlotColor = uPalette[rcSlot];
  vSlotPbr = uPbr[rcSlot];
  vRcWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAGMENT_PARS = /* glsl */ `
  varying vec3 vSlotColor;
  varying vec4 vSlotPbr;
  varying vec3 vRcWorld;
  uniform float uPower;
  uniform vec4 uFlash;
  uniform vec3 uRimColor;
  uniform float uRimPower;
  uniform vec2 uWipe;
  uniform vec3 uWipeColor;
`;

// Injected after the normal is known: glow from the slot, a fresnel rim in the team color (it keeps dark robots readable against the dark sky), a flash color for hits and selection, and the bright edge of the teleport wipe.
const FRAGMENT_EMISSIVE = /* glsl */ `
  totalEmissiveRadiance = vSlotColor * vSlotPbr.z * uPower;
  float rcFresnel = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.6);
  totalEmissiveRadiance += uRimColor * rcFresnel * uRimPower;
  totalEmissiveRadiance += uFlash.rgb * uFlash.a;
  float rcBand = smoothstep(uWipe.x - uWipe.y, uWipe.x, vRcWorld.y);
  totalEmissiveRadiance += uWipeColor * rcBand * 6.0;
`;

function patchShader(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERTEX_PARS}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MAIN}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n  if (vRcWorld.y > uWipe.x) discard;`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.rgb = vSlotColor * mix(1.0, 0.25, clamp(vSlotPbr.z, 0.0, 1.0));`)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSlotPbr.x;')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSlotPbr.y;')
    .replace('#include <emissivemap_fragment>', FRAGMENT_EMISSIVE)
    .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n  #ifdef USE_CLEARCOAT\n    material.clearcoat *= vSlotPbr.w;\n  #endif`);
}

/**
 * Create the shell material for one robot. Each robot gets its own material object (so it has its own uniforms), but all of them share one compiled shader program.
 * @param {'w'|'b'} team
 * @param {{clearcoat: boolean}} quality
 */
export function createRobotMaterial(team, quality) {
  const palette = TEAMS[team];
  const uniforms = {
    uPalette: { value: palette.colors },
    uPbr: { value: palette.pbr.map((v) => new THREE.Vector4(...v)) },
    uPower: { value: 1 },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uRimColor: { value: palette.rim.clone() },
    uRimPower: { value: team === 'b' ? 0.55 : 0.22 },
    // x: world height above which the robot is cut away (teleport); y: width of the glowing edge.
    uWipe: { value: new THREE.Vector2(1000, 0.08) },
    uWipeColor: { value: palette.glow.clone() },
  };
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0,
    clearcoat: quality.clearcoat ? 1 : 0,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1,
  });
  material.userData.uniforms = uniforms;
  material.userData.baseRim = uniforms.uRimPower.value;
  material.onBeforeCompile = (shader) => patchShader(shader, material.userData.uniforms);
  // One shared program for all robots: the patch is the same text for every instance.
  material.customProgramCacheKey = () => 'robot-shell-v1';
  return material;
}

/** Switch clearcoat on or off when the graphics quality changes. */
export function setRobotMaterialQuality(material, quality) {
  const next = quality.clearcoat ? 1 : 0;
  if (material.clearcoat !== next) {
    material.clearcoat = next;
    material.needsUpdate = true;
  }
}

// Hologram look for the coach's "ghost" pieces: see-through, bright at the edges, with moving scan lines. It is clearly not a real piece.
const GhostShader = {
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vView;
    varying vec3 vWorld;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      vec4 mv = viewMatrix * world;
      vView = -mv.xyz;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vView;
    varying vec3 vWorld;
    uniform vec3 uColor;
    uniform float uTime;
    uniform float uAlpha;
    void main() {
      float fres = pow(clamp(1.0 - abs(dot(normalize(vView), normalize(vNormal))), 0.0, 1.0), 1.6);
      float scan = 0.6 + 0.4 * sin(vWorld.y * 70.0 - uTime * 6.0);
      float sweep = smoothstep(0.0, 0.1, fract(vWorld.y * 0.9 - uTime * 0.5)) * smoothstep(0.3, 0.1, fract(vWorld.y * 0.9 - uTime * 0.5));
      float a = clamp((0.42 + fres * 0.6) * scan + sweep * 0.3, 0.0, 1.0);
      gl_FragColor = vec4(uColor * (0.75 + fres * 1.5 + sweep), a * uAlpha);
    }`,
};

/** Material for a ghost robot shown by the coach. */
export function createGhostMaterial(team) {
  return new THREE.ShaderMaterial({
    ...GhostShader,
    uniforms: {
      uColor: { value: TEAMS[team].glow.clone() },
      uTime: { value: 0 },
      uAlpha: { value: 1 },
    },
    // Normal blending (not additive) so the hologram stays readable on bright tiles as well as dark ones.
    transparent: true,
    depthWrite: false,
  });
}
