import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createPerson, updatePerson, sitDown } from './people.js';

// 一个等距视角的「剖面办公室」小模型：两面墙 + 木地板，
// 工位、休息区、白板、咖啡角，Quaternius 人物在里面工作、聊天、走动。

const ROOM_W = 20; // x: -10 ~ 10
const ROOM_D = 14; // z: -7 ~ 7
const WALL_H = 3.2;

// ---------- 渲染器 / 场景 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x262626);

const camera = new THREE.PerspectiveCamera(28, window.innerWidth / window.innerHeight, 0.5, 200);
const OVERVIEW = { pos: new THREE.Vector3(21, 19, 23), target: new THREE.Vector3(0, 0, 0) };
camera.position.copy(OVERVIEW.pos);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.copy(OVERVIEW.target);
controls.minDistance = 4;
controls.maxDistance = 70;
controls.maxPolarAngle = Math.PI * 0.45;

// 暖色灯光
scene.add(new THREE.HemisphereLight(0xfff4e6, 0x5b4636, 1.3));
const sun = new THREE.DirectionalLight(0xffe9cf, 2.0);
sun.position.set(9, 16, 11);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 12, bottom: -12, near: 1, far: 50 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);

// ---------- 小工具 ----------
const matCache = new Map();
function mat(color, opts = {}) {
  const key = `${color}-${JSON.stringify(opts)}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...opts }));
  }
  return matCache.get(key);
}

function rbox(w, h, d, material, r = 0.03) {
  const radius = Math.min(r, w / 2, h / 2, d / 2);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rTop, rBottom, h, material, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function place(obj, x, y, z, rotY = 0, parent = scene) {
  obj.position.set(x, y, z);
  obj.rotation.y = rotY;
  parent.add(obj);
  return obj;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 伪随机，保证每次布局一样
let seed = 11;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

// ---------- 颜色 ----------
const C = {
  wall: 0xf2e7d5,
  floorEdge: 0xd9a86a,
  white: 0xf7f3ec,
  cream: 0xefe6d6,
  deskLeg: 0xaebdcb,
  dark: 0x2b2826,
  black: 0x18181a,
  wood: 0xb9824f,
  plant: 0x4f8a4a,
  plantDark: 0x3c7040,
  pot: 0xe9e4dc,
  blueGrey: 0xb7c6d3,
  chair: 0xf4efe6,
};

// ---------- 房间 ----------
function buildRoom() {
  // 木地板：画布画出木条
  const floorTex = canvasTexture(1024, 1024, (g, w, h) => {
    g.fillStyle = '#c98a4b';
    g.fillRect(0, 0, w, h);
    const rows = 16;
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rand() * 300;
      while (x < w) {
        const len = 220 + rand() * 260;
        const l = 40 + rand() * 14;
        g.fillStyle = `hsl(28, 52%, ${l}%)`;
        g.fillRect(x, r * rh, len, rh);
        g.fillStyle = 'rgba(80,40,10,0.35)';
        g.fillRect(x, r * rh, 2, rh);
        x += len;
      }
      g.fillStyle = 'rgba(70,35,10,0.4)';
      g.fillRect(0, r * rh, w, 2);
    }
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(3, 2.2);

  const floorTop = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55 });
  const floorSide = mat(C.floorEdge, { roughness: 0.6 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W + 0.4, 0.4, ROOM_D + 0.4), [
    floorSide, floorSide, floorTop, floorSide, floorSide, floorSide,
  ]);
  floor.position.set(0, -0.2, 0);
  floor.receiveShadow = true;
  scene.add(floor);

  // 两面墙：后墙 + 左墙
  const wallMat = mat(C.wall, { roughness: 0.9 });
  const back = rbox(ROOM_W + 0.4, WALL_H, 0.2, wallMat, 0.02);
  place(back, 0, WALL_H / 2, -ROOM_D / 2 - 0.1);
  const left = rbox(0.2, WALL_H, ROOM_D + 0.4, wallMat, 0.02);
  place(left, -ROOM_W / 2 - 0.1, WALL_H / 2, 0);
  // 踢脚线
  place(rbox(ROOM_W, 0.1, 0.03, mat(0xe2d3bd)), 0, 0.05, -ROOM_D / 2 + 0.015);
  place(rbox(0.03, 0.1, ROOM_D, mat(0xe2d3bd)), -ROOM_W / 2 + 0.015, 0.05, 0);
}

// 夜景窗户：天空、星星、山和海
const nightTex = canvasTexture(512, 320, (g, w, h) => {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1b2546');
  sky.addColorStop(0.6, '#3f4f84');
  sky.addColorStop(1, '#6a77a6');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.6})`;
    g.fillRect(rand() * w, rand() * h * 0.55, 1.6, 1.6);
  }
  const hill = (color, base, amp, freq, phase) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) {
      g.lineTo(x, base - Math.abs(Math.sin(x * freq + phase)) * amp - Math.sin(x * freq * 2.7) * amp * 0.2);
    }
    g.lineTo(w, h);
    g.fill();
  };
  hill('#4a5785', h * 0.62, 70, 0.009, 1);
  hill('#33406a', h * 0.7, 45, 0.014, 2.4);
  // 海面和灯光倒影
  g.fillStyle = '#26345c';
  g.fillRect(0, h * 0.74, w, h * 0.26);
  for (let i = 0; i < 40; i++) {
    const x = rand() * w;
    g.fillStyle = `rgba(255,214,140,${0.4 + rand() * 0.5})`;
    g.fillRect(x, h * 0.72, 2, 2);
    g.fillStyle = 'rgba(255,214,140,0.18)';
    g.fillRect(x, h * 0.75, 2, 6 + rand() * 20);
  }
});

function windowUnit(w = 2.6, h = 1.7) {
  const grp = new THREE.Group();
  const frame = mat(C.white, { roughness: 0.6 });
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: nightTex, emissive: 0xffffff, emissiveMap: nightTex, emissiveIntensity: 0.55, roughness: 0.3 }),
  );
  glass.position.z = 0.01;
  grp.add(glass);
  const t = 0.07;
  for (const [x, y, ww, hh] of [
    [0, h / 2, w + t, t], [0, -h / 2, w + t, t], [-w / 2, 0, t, h], [w / 2, 0, t, h], [0, 0, 0.05, h], [0, 0, w, 0.05],
  ]) {
    grp.add(place(rbox(ww, hh, 0.07, frame, 0.01), x, y, 0.03, 0, grp));
  }
  grp.add(place(rbox(w + 0.3, 0.06, 0.18, frame, 0.01), 0, -h / 2 - 0.06, 0.08, 0, grp)); // 窗台
  return grp;
}

// 云朵形状的地毯
function cloudRug(rx, rz, color = 0xf4eee4) {
  const shape = new THREE.Shape();
  const N = 200;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const bump = 1 + 0.07 * Math.abs(Math.sin(a * 6));
    const x = Math.cos(a) * rx * bump;
    const y = Math.sin(a) * rz * bump;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat(color, { roughness: 1 }));
  m.receiveShadow = true;
  return m;
}

function plant(scale = 1) {
  const grp = new THREE.Group();
  grp.add(place(cyl(0.16, 0.12, 0.32, mat(C.pot)), 0, 0.16, 0, 0, grp));
  const leaf = mat(C.plant, { flatShading: true });
  const leaf2 = mat(C.plantDark, { flatShading: true });
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17 + rand() * 0.06, 0), i % 2 ? leaf : leaf2);
    m.castShadow = true;
    m.position.set((rand() - 0.5) * 0.22, 0.45 + rand() * 0.25, (rand() - 0.5) * 0.22);
    grp.add(m);
  }
  grp.scale.setScalar(scale);
  return grp;
}

// 云朵坐墩 / 云朵灯
function puff(color, scale = 1, emissive = 0) {
  const grp = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, emissive: color, emissiveIntensity: emissive });
  for (const [x, y, z, r] of [[0, 0, 0, 0.26], [0.2, -0.02, 0.05, 0.2], [-0.2, -0.02, -0.03, 0.2], [0.03, 0.1, 0.15, 0.17], [-0.05, 0.08, -0.16, 0.17]]) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), m);
    s.position.set(x, y, z);
    s.castShadow = true;
    grp.add(s);
  }
  grp.scale.set(scale, scale * 0.8, scale);
  return grp;
}

// ---------- 家具 ----------
function chair() {
  const grp = new THREE.Group();
  const white = mat(C.chair);
  grp.add(place(rbox(0.46, 0.06, 0.44, white, 0.02), 0, 0.45, 0, 0, grp));
  grp.add(place(rbox(0.46, 0.46, 0.05, white, 0.02), 0, 0.72, -0.2, 0, grp));
  const leg = mat(C.deskLeg);
  for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) {
    grp.add(place(cyl(0.018, 0.018, 0.44, leg, 8), x, 0.22, z, 0, grp));
  }
  return grp; // 椅子朝 +Z（人坐着面朝 +Z）
}

const screenTex = canvasTexture(128, 80, (g, w, h) => {
  g.fillStyle = '#cfe0f5';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#7fa3d6';
  g.fillRect(8, 8, w - 16, 10);
  g.fillStyle = '#a9c1e3';
  for (let i = 0; i < 5; i++) g.fillRect(8, 26 + i * 10, 40 + ((i * 37) % 60), 5);
});

function laptop() {
  const grp = new THREE.Group();
  const alu = mat(0xd5d7db, { roughness: 0.4, metalness: 0.2 });
  grp.add(place(rbox(0.36, 0.02, 0.25, alu, 0.008), 0, 0.01, 0, 0, grp));
  const lid = new THREE.Group();
  lid.add(place(rbox(0.36, 0.24, 0.012, alu, 0.006), 0, 0.12, 0, 0, lid));
  const scr = new THREE.Mesh(
    new THREE.PlaneGeometry(0.32, 0.2),
    new THREE.MeshStandardMaterial({ map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 0.7 }),
  );
  scr.position.set(0, 0.125, 0.007);
  lid.add(scr);
  lid.position.set(0, 0.02, -0.12);
  lid.rotation.x = -0.25;
  grp.add(lid);
  return grp; // 屏幕朝 +Z
}

// 一组 2×2 的工位：返回 4 个座位 { x, z, yaw }
function deskCluster(cx, cz, { rugColor } = {}) {
  const grp = new THREE.Group();
  place(grp, cx, 0, cz);
  grp.add(place(cloudRug(2.6, 1.9, rugColor), 0, 0.001, 0, 0, grp));
  const top = mat(C.white, { roughness: 0.5 });
  const legM = mat(C.deskLeg);
  const seats = [];
  for (const side of [-1, 1]) {
    for (const dx of [-0.72, 0.72]) {
      const dz = side * 0.36;
      grp.add(place(rbox(1.42, 0.05, 0.7, top, 0.015), dx, 0.74, dz, 0, grp));
      for (const lx of [-0.66, 0.66]) {
        grp.add(place(rbox(0.04, 0.72, 0.62, legM, 0.01), dx + lx, 0.36, dz, 0, grp));
      }
      // 笔记本电脑（屏幕朝向坐的人）和小音箱
      const lap = laptop();
      grp.add(place(lap, dx - 0.1, 0.765, dz + side * 0.05, side > 0 ? 0 : Math.PI, grp));
      const spk = cyl(0.05, 0.05, 0.12, mat(C.black, { roughness: 0.4 }), 12);
      grp.add(place(spk, dx + 0.42, 0.825, dz - side * 0.15, 0, grp));
      // 椅子在外侧，面朝桌子
      const ch = chair();
      const chairZ = side * 1.05;
      grp.add(place(ch, dx, 0, chairZ, side > 0 ? Math.PI : 0, grp));
      seats.push({ x: cx + dx, z: cz + chairZ, yaw: side > 0 ? Math.PI : 0 });
    }
  }
  return seats;
}

function sofa(color, width = 2.2) {
  const grp = new THREE.Group();
  const m = mat(color, { roughness: 0.95 });
  grp.add(place(rbox(width, 0.42, 0.9, m, 0.08), 0, 0.21, 0, 0, grp));
  grp.add(place(rbox(width, 0.55, 0.24, m, 0.1), 0, 0.6, -0.33, 0, grp));
  grp.add(place(rbox(0.24, 0.62, 0.9, m, 0.1), -width / 2 + 0.12, 0.31, 0, 0, grp));
  grp.add(place(rbox(0.24, 0.62, 0.9, m, 0.1), width / 2 - 0.12, 0.31, 0, 0, grp));
  return grp; // 朝 +Z
}

function coffeeTable() {
  const grp = new THREE.Group();
  const wood = mat(C.wood, { roughness: 0.6 });
  grp.add(place(rbox(1.1, 0.06, 0.62, wood, 0.02), 0, 0.42, 0, 0, grp));
  for (const [x, z] of [[-0.48, -0.24], [0.48, -0.24], [-0.48, 0.24], [0.48, 0.24]]) {
    grp.add(place(cyl(0.025, 0.025, 0.4, wood, 8), x, 0.2, z, 0, grp));
  }
  grp.add(place(rbox(0.3, 0.03, 0.22, mat(0x3a3a3a)), 0.15, 0.465, 0.02, 0.3, grp)); // 平板
  return grp;
}

function floorLamp(lights) {
  const grp = new THREE.Group();
  grp.add(place(cyl(0.18, 0.2, 0.03, mat(0xdfe5ea)), 0, 0.015, 0, 0, grp));
  grp.add(place(cyl(0.02, 0.02, 1.55, mat(0xdfe5ea), 8), 0, 0.78, 0, 0, grp));
  grp.add(place(puff(0xfff6e5, 0.75, 0.9), 0, 1.65, 0, 0, grp));
  const light = new THREE.PointLight(0xffd9a0, 3, 6, 1.6);
  light.position.set(0, 1.6, 0);
  grp.add(light);
  lights.push(light);
  return grp;
}

function whiteboard() {
  const grp = new THREE.Group();
  const tex = canvasTexture(512, 320, (g, w, h) => {
    g.fillStyle = '#fbfbf8';
    g.fillRect(0, 0, w, h);
    g.lineWidth = 5;
    g.strokeStyle = '#3b6fb6';
    g.strokeRect(40, 50, 120, 70);
    g.strokeRect(220, 50, 120, 70);
    g.strokeStyle = '#d0453b';
    g.beginPath();
    g.moveTo(160, 85);
    g.lineTo(220, 85);
    g.moveTo(280, 120);
    g.lineTo(280, 180);
    g.stroke();
    g.strokeStyle = '#2f8a57';
    g.strokeRect(220, 180, 120, 70);
    g.strokeStyle = '#555';
    g.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(380, 60 + i * 30);
      g.lineTo(380 + 60 + ((i * 29) % 50), 60 + i * 30);
      g.stroke();
    }
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 0.04), [
    mat(0xd0d3d6), mat(0xd0d3d6), mat(0xd0d3d6), mat(0xd0d3d6),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 }), mat(0xeeeeee),
  ]);
  board.castShadow = true;
  board.position.y = 1.35;
  grp.add(board);
  const leg = mat(0xc8ced4);
  for (const x of [-0.95, 0.95]) {
    grp.add(place(cyl(0.025, 0.025, 1.9, leg, 8), x, 0.95, 0, 0, grp));
    grp.add(place(rbox(0.06, 0.04, 0.6, leg), x, 0.02, 0, 0, grp));
  }
  return grp; // 板面朝 +Z
}

function vendingMachine() {
  const grp = new THREE.Group();
  const tex = canvasTexture(256, 480, (g, w, h) => {
    g.fillStyle = '#1e2430';
    g.fillRect(0, 0, w, h);
    const colors = ['#e8584b', '#f2b134', '#4fa3e0', '#64c27b', '#c56cf0', '#f07fb0'];
    for (let r = 0; r < 6; r++) {
      g.fillStyle = '#2d3646';
      g.fillRect(14, 22 + r * 70, w - 28, 58);
      for (let c = 0; c < 5; c++) {
        g.fillStyle = colors[(r + c) % colors.length];
        g.fillRect(24 + c * 44, 30 + r * 70, 30, 42);
      }
    }
  });
  grp.add(place(rbox(1.0, 1.95, 0.8, mat(C.white), 0.04), 0, 0.975, 0, 0, grp));
  const front = new THREE.Mesh(
    new THREE.PlaneGeometry(0.66, 1.3),
    new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.45 }),
  );
  front.position.set(-0.1, 1.15, 0.405);
  grp.add(front);
  grp.add(place(rbox(0.16, 0.5, 0.02, mat(0x333333)), 0.36, 1.2, 0.41, 0, grp));
  return grp; // 正面朝 +Z
}

function bookshelf() {
  const grp = new THREE.Group();
  const w = mat(C.white);
  grp.add(place(rbox(2.0, 0.85, 0.36, w, 0.02), 0, 0.425, 0, 0, grp));
  const hole = mat(0xe4dccd);
  for (const y of [0.22, 0.62]) grp.add(place(rbox(1.86, 0.32, 0.3, hole, 0.01), 0, y, 0.04, 0, grp));
  const colors = [0x6aa36f, 0xd96b5f, 0x5b86c5, 0xe0b04a, 0x8e6bbf, 0x4f9c9a];
  let x = -0.85;
  while (x < 0.75) {
    const bw = 0.06 + rand() * 0.05;
    const bh = 0.2 + rand() * 0.08;
    grp.add(place(rbox(bw, bh, 0.22, mat(colors[Math.floor(rand() * colors.length)]), 0.005), x, 0.62 - 0.14 + bh / 2, 0.06, 0, grp));
    x += bw + 0.01 + (rand() < 0.15 ? 0.2 : 0);
  }
  return grp;
}

function tv() {
  const grp = new THREE.Group();
  const tex = canvasTexture(640, 360, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#141821');
    bg.addColorStop(1, '#232b3b');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e9edf5';
    g.font = 'bold 34px system-ui, sans-serif';
    g.fillText('Weekly Sync', 40, 64);
    g.fillStyle = '#8b96ab';
    g.font = '20px system-ui, sans-serif';
    g.fillText('Team progress · Q4', 40, 96);
    const bars = [0.45, 0.62, 0.38, 0.8, 0.7, 0.92];
    bars.forEach((b, i) => {
      g.fillStyle = i === bars.length - 1 ? '#5aa7ff' : '#3c5a86';
      g.fillRect(60 + i * 90, 310 - b * 170, 52, b * 170);
    });
  });
  grp.add(place(rbox(2.9, 1.65, 0.07, mat(C.black, { roughness: 0.3 }), 0.02), 0, 0, 0, 0, grp));
  const scr = new THREE.Mesh(
    new THREE.PlaneGeometry(2.78, 1.53),
    new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.8 }),
  );
  scr.position.z = 0.04;
  grp.add(scr);
  return grp;
}

function coffeeCorner() {
  const grp = new THREE.Group();
  grp.add(place(rbox(2.2, 0.9, 0.6, mat(C.dark), 0.02), 0, 0.45, 0, 0, grp));
  grp.add(place(rbox(2.25, 0.05, 0.64, mat(C.white, { roughness: 0.4 }), 0.01), 0, 0.92, 0, 0, grp));
  for (const x of [-0.55, 0.55]) grp.add(place(rbox(0.02, 0.7, 0.01, mat(0x444444)), x, 0.45, 0.305, 0, grp));
  // 咖啡机、杯子、水壶
  grp.add(place(rbox(0.38, 0.42, 0.34, mat(C.black, { roughness: 0.35 }), 0.03), 0.55, 1.15, -0.05, 0, grp));
  grp.add(place(cyl(0.06, 0.06, 0.1, mat(0xffffff), 12), 0.55, 1.0, 0.13, 0, grp));
  for (let i = 0; i < 3; i++) grp.add(place(cyl(0.045, 0.04, 0.09, mat([0xffffff, 0xe0b04a, 0x5b86c5][i]), 12), -0.2 + i * 0.13, 0.99, 0.1, 0, grp));
  grp.add(place(cyl(0.08, 0.09, 0.26, mat(0xcfd6dc, { metalness: 0.5, roughness: 0.3 }), 14), -0.7, 1.08, -0.05, 0, grp));
  // 墙上的木搁板
  grp.add(place(rbox(1.6, 0.05, 0.26, mat(C.wood)), 0, 1.85, -0.17, 0, grp));
  for (let i = 0; i < 4; i++) {
    grp.add(place(rbox(0.16, 0.2 + (i % 2) * 0.08, 0.14, mat([0xe8584b, 0xf7f3ec, 0x4f9c9a, 0xe0b04a][i]), 0.02), -0.55 + i * 0.36, 1.98 + (i % 2) * 0.04, -0.17, 0, grp));
  }
  return grp;
}

function arcade() {
  const grp = new THREE.Group();
  const body = mat(0x1b2030, { roughness: 0.5 });
  grp.add(place(rbox(0.75, 1.75, 0.75, body, 0.03), 0, 0.875, 0, 0, grp));
  const tex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#0d1630';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd34d';
    g.beginPath();
    g.arc(40, 70, 14, 0.4, Math.PI * 2 - 0.4);
    g.lineTo(40, 70);
    g.fill();
    g.fillStyle = '#ff6bb5';
    for (let i = 0; i < 4; i++) g.fillRect(66 + i * 14, 66, 6, 6);
    g.fillStyle = '#4fd1ff';
    g.fillRect(10, 20, w - 20, 4);
  });
  const scr = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 0.45),
    new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1 }),
  );
  scr.position.set(0, 1.25, 0.38);
  grp.add(scr);
  const marquee = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.16), new THREE.MeshStandardMaterial({ color: 0xff7a59, emissive: 0xff7a59, emissiveIntensity: 0.8 }));
  marquee.position.set(0, 1.62, 0.38);
  grp.add(marquee);
  grp.add(place(rbox(0.7, 0.08, 0.3, mat(0x2a3148)), 0, 0.95, 0.45, 0, grp));
  return grp;
}

function lockers() {
  const grp = new THREE.Group();
  for (const x of [-0.47, 0.47]) {
    grp.add(place(rbox(0.9, 2.15, 0.7, mat(C.blueGrey, { roughness: 0.5 }), 0.03), x, 1.075, 0, 0, grp));
    grp.add(place(rbox(0.03, 0.4, 0.03, mat(0x8a9aa8)), x + 0.33, 1.1, 0.36, 0, grp));
  }
  return grp;
}

function displayWall() {
  // 左墙上的展示板和下面的矮柜
  const grp = new THREE.Group();
  grp.add(place(rbox(2.8, 0.75, 0.55, mat(C.dark), 0.02), 0, 0.375, 0, 0, grp));
  grp.add(place(rbox(2.85, 0.04, 0.58, mat(C.white)), 0, 0.77, 0, 0, grp));
  grp.add(place(rbox(2.6, 1.0, 0.04, mat(C.white, { roughness: 0.6 })), 0, 1.75, -0.26, 0, grp));
  grp.add(place(rbox(2.6, 0.12, 0.05, mat(C.black)), 0, 2.32, -0.25, 0, grp));
  const colors = [0x2d2d2d, 0xffffff, 0x8fb3d9, 0x2d2d2d, 0xe0b04a];
  for (let i = 0; i < 5; i++) {
    grp.add(place(rbox(0.32, 0.4, 0.06, mat(colors[i]), 0.03), -1.0 + i * 0.5, 1.85, -0.21, 0, grp));
    grp.add(place(cyl(0.07, 0.07, 0.05, mat(colors[(i + 2) % 5]), 12), -1.0 + i * 0.5, 1.45, -0.2, 0, grp));
  }
  // 矮柜上的小物件
  grp.add(place(rbox(0.4, 0.2, 0.3, mat(C.black)), -0.8, 0.89, 0, 0, grp));
  grp.add(place(rbox(0.5, 0.06, 0.35, mat(0xdcdcdc)), 0.5, 0.82, 0, 0, grp));
  return grp; // 正面朝 +Z
}

function poster(colorA, colorB) {
  const tex = canvasTexture(200, 280, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, colorA);
    gr.addColorStop(1, colorB);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.ellipse(w * 0.5, h * 0.45, 40, 26, 0, 0, Math.PI * 2);
    g.ellipse(w * 0.38, h * 0.5, 30, 20, 0, 0, Math.PI * 2);
    g.ellipse(w * 0.64, h * 0.5, 30, 20, 0, 0, Math.PI * 2);
    g.fill();
  });
  const grp = new THREE.Group();
  grp.add(place(rbox(0.82, 1.12, 0.04, mat(C.white)), 0, 0, 0, 0, grp));
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
  p.position.z = 0.025;
  grp.add(p);
  return grp;
}

// ---------- 搭场景 ----------
const lampLights = [];
const areas = {}; // 侧边栏里的「区域」：{ label, target, dist }
const seats = [];

function buildOffice() {
  buildRoom();
  const BACK = -ROOM_D / 2; // 后墙内表面 z
  const LEFT = -ROOM_W / 2; // 左墙内表面 x

  // 后墙：窗、电视、书架、咖啡角、游戏机
  place(windowUnit(), -4.2, 1.85, BACK + 0.01);
  place(windowUnit(), 6.2, 1.85, BACK + 0.01);
  place(tv(), 1.2, 1.9, BACK + 0.05);
  place(bookshelf(), 2.6, 0, BACK + 0.2);
  place(coffeeCorner(), -7.9, 0, BACK + 0.32);
  place(arcade(), 9.1, 0, BACK + 0.45);
  place(lockers(), 3.9, 0, -4.4, 0);

  // 左墙：窗、展示墙、自动售货机、海报
  place(windowUnit(), LEFT + 0.01, 1.85, 3.6, Math.PI / 2);
  place(displayWall(), LEFT + 0.3, 0, -0.6, Math.PI / 2);
  place(vendingMachine(), LEFT + 0.42, 0, -4.9, Math.PI / 2);
  place(poster('#f3b56b', '#e0705e'), LEFT + 0.03, 1.8, 1.4, Math.PI / 2);
  place(poster('#7fb6e8', '#5468c4'), LEFT + 0.03, 1.8, -2.6, Math.PI / 2);

  // 工位区
  seats.push(...deskCluster(-5.6, 3.4));
  seats.push(...deskCluster(-0.6, 3.4));
  seats.push(...deskCluster(-0.6, -2.3));
  seats.push(...deskCluster(5.8, 4.0, { rugColor: 0xefe7da }));

  // 白板和讨论区
  place(whiteboard(), -6.1, 0, -2.6, 0.25);
  place(puff(C.white, 0.9), -3.9, 0.17, -3.3);
  place(puff(C.white, 0.9), -3.6, 0.17, -4.4);

  // 休息区：沙发、扶手椅、茶几、落地灯
  place(cloudRug(2.5, 2.0, 0xf6f1e8), 6.0, 0.001, -1.3);
  place(sofa(C.cream), 6.0, 0, -2.75);
  const armA = sofa(C.blueGrey, 1.0);
  place(armA, 4.75, 0, 0.35, Math.PI - 0.35);
  const armB = sofa(C.blueGrey, 1.0);
  place(armB, 7.25, 0, 0.35, Math.PI + 0.35);
  place(coffeeTable(), 6.0, 0, -1.2);
  place(floorLamp(lampLights), 8.3, 0, -3.1);

  // 前景：矮柜、小桌、云朵坐墩、落地灯
  place(rbox(2.2, 0.9, 0.5, mat(C.black, { roughness: 0.4 }), 0.02), -3.2, 0.45, 6.4);
  const side = new THREE.Group();
  side.add(place(rbox(0.8, 0.05, 0.6, mat(C.wood)), 0, 0.55, 0, 0, side));
  for (const [x, z] of [[-0.35, -0.25], [0.35, -0.25], [-0.35, 0.25], [0.35, 0.25]]) side.add(place(cyl(0.02, 0.02, 0.54, mat(C.wood), 8), x, 0.27, z, 0, side));
  place(cloudRug(1.6, 0.8), 1.2, 0.001, 6.35);
  place(side, 1.2, 0, 6.35);
  place(puff(C.white, 0.9), 0.15, 0.17, 6.35);
  place(puff(C.white, 0.9), 2.25, 0.17, 6.35);
  place(floorLamp(lampLights), -0.9, 0, 6.5);

  // 绿植
  for (const [x, z, s] of [
    [-9.3, 6.3, 1.1], [9.3, 6.3, 1.0], [4.0, 6.4, 0.9], [-8.4, -1.9, 0.9], [-3.5, 0.6, 0.8], [2.6, 0.6, 0.8],
    [-2.6, -6.4, 0.9], [8.6, -0.6, 0.9], [-9.3, -6.3, 1.0], [5.0, -6.3, 0.9], [2.4, 3.1, 0.8],
  ]) {
    place(plant(s), x, 0, z, rand() * Math.PI);
  }

  Object.assign(areas, {
    overview: { label: '全景', pos: OVERVIEW.pos, target: OVERVIEW.target },
    desks: { label: '工位区', target: new THREE.Vector3(-2.5, 0.5, 1.5), dist: 13 },
    lounge: { label: '休息区', target: new THREE.Vector3(6, 0.6, -1.3), dist: 8 },
    whiteboard: { label: '白板讨论', target: new THREE.Vector3(-5.6, 1, -2), dist: 7 },
    coffee: { label: '咖啡角', target: new THREE.Vector3(-7.9, 1, -5.6), dist: 7 },
    arcade: { label: '游戏机', target: new THREE.Vector3(8.6, 1, -5.6), dist: 7 },
  });
}

// ---------- 人物 ----------
const people = [];
const OUTFITS = [
  { shirt: 0xf4efe6, bottom: 0x2b3a55, tie: 0x8a1c2b },
  { shirt: 0xdfe8f1, jacket: 0x3a3f47, bottom: 0x3a3f47, tie: 0x2a4d8f },
  { shirt: 0xb9d3ee, bottom: 0x1d1d22, skirt: true },
  { shirt: 0xf1e6d2, bottom: 0x6b6f76, shoes: 0x5a3a2a },
  { shirt: 0xc9d8b6, bottom: 0x47506a },
  { shirt: 0xf0c987, bottom: 0x2f2f35, skirt: true },
  { shirt: 0xe7c1c8, bottom: 0x58606e },
  { shirt: 0xffffff, jacket: 0x6a5a48, bottom: 0x3f3a35 },
  { shirt: 0xd6d2f0, bottom: 0x2b2b30 },
  { shirt: 0xcfe3e0, bottom: 0x6a5d4d, skirt: true },
  { shirt: 0xf5f5f5, bottom: 0x24324a, tie: 0x2f6b4f },
];

async function loadPeople(manager) {
  const loader = new GLTFLoader(manager);
  const files = {
    male: 'models/people/male.glb',
    female: 'models/people/female.glb',
    buzzed: 'models/people/hair/hair-buzzed.glb',
    beard: 'models/people/hair/hair-beard.glb',
    parted: 'models/people/hair/hair-simpleparted.glb',
    buns: 'models/people/hair/hair-buns.glb',
    long: 'models/people/hair/hair-long.glb',
    buzzedF: 'models/people/hair/hair-buzzedfemale.glb',
  };
  const g = {};
  await Promise.all(Object.entries(files).map(async ([k, url]) => (g[k] = await loader.loadAsync(url))));
  const texLoader = new THREE.TextureLoader(manager);
  const skin = async (url) => {
    const t = await texLoader.loadAsync(url);
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const [maleLight, femaleLight] = await Promise.all([skin('models/people/male-light.webp'), skin('models/people/female-light.webp')]);

  const H = (key, color) => ({ scene: g[key].scene, color });
  // 每个人：外形 + 在办公室里做什么
  const defs = [
    { label: '小陈', sex: 'm', skin: null, hair: [H('buzzed', 0x2b2420), H('beard', 0x2b2420)], role: { seat: 0 } },
    { label: '安娜', sex: 'f', skin: femaleLight, hair: [H('long', 0xd9a86a)], role: { seat: 3 } },
    { label: '大卫', sex: 'm', skin: maleLight, hair: [H('parted', 0x8a5a36)], role: { seat: 5 } },
    { label: '琳达', sex: 'f', skin: null, hair: [H('buns', 0x2a201b)], role: { seat: 6 } },
    { label: '马克', sex: 'm', skin: maleLight, hair: [H('buzzed', 0xb88a52)], role: { seat: 9 } },
    { label: '苏菲', sex: 'f', skin: femaleLight, hair: [H('buns', 0x9c4a2a)], role: { seat: 14 } },
    { label: '阿杰', sex: 'm', skin: null, hair: [H('parted', 0x1f1a17)], role: { sofa: [5.4, -2.62] } },
    { label: '艾米', sex: 'f', skin: null, hair: [H('long', 0x2a201b)], role: { stand: [-6.7, -1.35], face: 0.9, gesture: true } },
    { label: '汤姆', sex: 'm', skin: maleLight, hair: [H('parted', 0x5a3b26), H('beard', 0x5a3b26)], role: { stand: [-5.2, -1.2], face: -1.2 } },
    {
      label: '凯特', sex: 'f', skin: femaleLight, hair: [H('buzzedF', 0x7a4b2e)],
      role: { path: [[2.6, 5.4, 2, 0], [2.6, 0.9], [-7.9, 0.9], [-7.9, -5.6, 4, Math.PI], [-7.9, 0.9], [2.6, 0.9]] },
    },
    {
      label: '杰森', sex: 'm', skin: null, hair: [H('buzzed', 0x1f1a17)],
      role: { path: [[2.6, -3.6, 3, Math.PI], [2.6, 0.9], [9.0, 0.9], [9.0, -5.4, 5, Math.PI], [9.0, 0.9], [2.6, 0.9]] },
    },
  ];

  defs.forEach((d, i) => {
    const person = createPerson(d.sex === 'm' ? g.male.scene : g.female.scene, {
      skin: d.skin,
      height: d.sex === 'm' ? 1.82 + rand() * 0.08 : 1.68 + rand() * 0.07,
      outfit: OUTFITS[i % OUTFITS.length],
      hair: d.hair,
    });
    const o = person.object;
    const r = d.role;
    if (r.seat !== undefined) {
      const s = seats[r.seat];
      o.position.set(s.x, 0, s.z);
      o.rotation.y = s.yaw;
      sitDown(person, { height: 0.48, style: 'desk' });
    } else if (r.sofa) {
      o.position.set(r.sofa[0], 0, r.sofa[1]);
      o.rotation.y = 0;
      sitDown(person, { height: 0.42, style: 'sofa' });
    } else if (r.stand) {
      o.position.set(r.stand[0], 0, r.stand[1]);
      o.rotation.y = r.face;
      person.faceYaw = r.face;
      person.waitTime = Infinity;
      person.gesture = !!r.gesture;
    } else if (r.path) {
      person.path = r.path.map(([x, z, wait, face]) => ({ pos: new THREE.Vector3(x, 0, z), wait, face }));
      person.pathIndex = 0;
      o.position.copy(person.path[0].pos);
      person.waitTime = 1 + i * 0.7;
      person.speed = 1.2;
    }
    o.userData.itemId = `p${i}`;
    scene.add(o);
    people.push({ id: `p${i}`, label: d.label, person });
  });
}

// ---------- 镜头 ----------
let followPerson = null;
let flight = null;
const lastPos = new THREE.Vector3();
const followBox = document.getElementById('follow');

function flyTo(camPos, target) {
  flight = { t: 0, fromCam: camera.position.clone(), fromTarget: controls.target.clone(), camPos, target };
}

function focusArea(key) {
  const a = areas[key];
  followPerson = null;
  if (a.pos) {
    flyTo(a.pos.clone(), a.target.clone());
  } else {
    const dir = camera.position.clone().sub(controls.target).normalize();
    dir.y = Math.max(dir.y, 0.55);
    dir.normalize();
    flyTo(a.target.clone().add(dir.multiplyScalar(a.dist)), a.target.clone());
  }
  setActive(`a-${key}`);
}

function focusPerson(id) {
  const entry = people.find((p) => p.id === id);
  if (!entry) return;
  followPerson = entry;
  const o = entry.person.object;
  const target = o.position.clone().add(new THREE.Vector3(0, 1.1, 0));
  const dir = camera.position.clone().sub(controls.target).normalize();
  dir.y = Math.max(dir.y, 0.4);
  dir.normalize();
  flyTo(target.clone().add(dir.multiplyScalar(5)), target);
  lastPos.copy(o.position);
  setActive(id);
}

function updateCamera(dt) {
  if (flight) {
    flight.t = Math.min(1, flight.t + dt / 1.0);
    const k = 1 - Math.pow(1 - flight.t, 3);
    // 跟随走动中的人：终点随人移动
    if (followPerson) {
      const d = followPerson.person.object.position.clone().sub(lastPos);
      d.y = 0;
      flight.camPos.add(d);
      flight.target.add(d);
      lastPos.copy(followPerson.person.object.position);
    }
    camera.position.lerpVectors(flight.fromCam, flight.camPos, k);
    controls.target.lerpVectors(flight.fromTarget, flight.target, k);
    if (flight.t >= 1) flight = null;
    return;
  }
  if (followPerson && followBox.checked) {
    const p = followPerson.person.object.position;
    const d = p.clone().sub(lastPos);
    d.y = 0;
    camera.position.add(d);
    controls.target.add(d);
  }
  if (followPerson) lastPos.copy(followPerson.person.object.position);
}

// 点击人物
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
  down = null;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(people.map((p) => p.person.object), true)[0];
  if (!hit) return;
  let o = hit.object;
  while (o && !o.userData.itemId) o = o.parent;
  if (o) focusPerson(o.userData.itemId);
});

// ---------- 侧边栏 ----------
function buildPanel() {
  const groups = document.getElementById('groups');
  const addGroup = (title, entries, onClick) => {
    const sec = document.createElement('div');
    sec.className = 'group';
    sec.innerHTML = `<h2>${title}</h2><div class="chips"></div>`;
    const chips = sec.querySelector('.chips');
    for (const [id, label] of entries) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.id = id;
      b.addEventListener('click', () => onClick(id));
      chips.appendChild(b);
    }
    groups.appendChild(sec);
  };
  addGroup('区域', Object.entries(areas).map(([k, a]) => [`a-${k}`, a.label]), (id) => focusArea(id.slice(2)));
  addGroup('同事', people.map((p) => [p.id, p.label]), focusPerson);
  document.getElementById('reset').addEventListener('click', () => focusArea('overview'));
  const panel = document.getElementById('panel');
  const toggle = document.getElementById('panel-toggle');
  toggle.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    toggle.textContent = panel.classList.contains('collapsed') ? '+' : '–';
  });
  if (innerWidth < 600) toggle.click();
}

function setActive(id) {
  document.querySelectorAll('.chips button').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
}

// ---------- 启动 ----------
const loadingEl = document.getElementById('loading');
const fill = document.getElementById('loading-fill');
const text = document.getElementById('loading-text');
const manager = new THREE.LoadingManager();
manager.onProgress = (_u, loaded, total) => {
  fill.style.width = `${(loaded / total) * 100}%`;
  text.textContent = `正在加载模型… ${loaded}/${total}`;
};

buildOffice();
loadPeople(manager)
  .then(() => {
    buildPanel();
    setActive('a-overview');
    loadingEl.classList.add('done');
  })
  .catch((err) => {
    console.error(err);
    text.textContent = '模型加载失败，请查看控制台';
  });

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  for (const p of people) updatePerson(p.person, dt, null);
  updateCamera(dt);
  controls.update();
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
