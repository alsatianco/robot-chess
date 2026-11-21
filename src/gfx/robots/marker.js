// The base marker: a ring of light on the tile under each robot, with a small badge that shows the classic chess symbol. It links each robot to the real piece and keeps the board readable from the top-down camera.
import * as THREE from 'three';
import { TEAMS } from '../palette.js';
import { drawPieceIcon } from '../../ui/piece-icons.js';

const textures = new Map();
const geometry = new THREE.PlaneGeometry(1, 1);
geometry.rotateX(-Math.PI / 2);

function css(color, alpha = 1) {
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${alpha})`;
}

function getTexture(type, team) {
  const key = type + team;
  if (textures.has(key)) return textures.get(key);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // Colors are drawn in display space so the texture can be tagged sRGB.
  const glow = TEAMS[team].glow.clone().convertLinearToSRGB();
  const soft = TEAMS[team].glowSoft.clone().convertLinearToSRGB();
  const c = size / 2;

  // A thin ring with a gap at the front where the badge sits. It stays quiet so 32 of them do not clutter the board.
  ctx.lineCap = 'round';
  ctx.strokeStyle = css(glow, 0.75);
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(c, c, 92, Math.PI / 2 + 0.36, Math.PI / 2 - 0.36 + Math.PI * 2);
  ctx.stroke();

  // Badge with the chess symbol.
  const by = c + 92;
  ctx.fillStyle = 'rgba(6, 10, 20, 0.94)';
  ctx.beginPath();
  ctx.arc(c, by, 25, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = css(glow, 1);
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = team === 'w' ? '#ffffff' : css(soft, 1);
  drawPieceIcon(ctx, type, c - 17, by - 18, 34);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  textures.set(key, texture);
  return texture;
}

/** Create the marker mesh for one robot. The mesh lies flat on the tile; rotate it around y so the badge faces the camera. */
export function createMarker(type, team) {
  const material = new THREE.MeshBasicMaterial({ map: getTexture(type, team), transparent: true, depthWrite: false, toneMapped: false });
  material.color.setScalar(1.1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.011;
  mesh.scale.setScalar(0.98);
  mesh.renderOrder = 3;
  return mesh;
}
