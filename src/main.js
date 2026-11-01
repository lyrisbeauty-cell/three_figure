import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createPerson, updatePerson } from './people.js';

// ---------- 模型清单 ----------
// Kenney 官方 Starter Kit（CC0）+ Quaternius Universal Base Characters，见 public/models/LICENSE.txt
const MODELS = {
  character: 'models/character/character.glb',
  male: 'models/people/male.glb',
  female: 'models/people/female.glb',
  truckRed: 'models/vehicles/vehicle-truck-red.glb',
  truckGreen: 'models/vehicles/vehicle-truck-green.glb',
  truckYellow: 'models/vehicles/vehicle-truck-yellow.glb',
  truckPurple: 'models/vehicles/vehicle-truck-purple.glb',
  motorcycle: 'models/vehicles/vehicle-motorcycle.glb',
  trees: 'models/plants/grass-trees.glb',
  treesTall: 'models/plants/grass-trees-tall.glb',
  forest: 'models/plants/forest/decoration-forest.glb',
  lawn: 'models/plants/grass.glb',
  grassSmall: 'models/plants/grass-small.glb',
};

// 环形公路
const ROAD_INNER = 16;
const ROAD_OUTER = 21;
const WORLD_RADIUS = 52;

// ---------- 基础场景 ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe3f5);
scene.fog = new THREE.Fog(0xbfe3f5, 60, 130);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);
const DEFAULT_CAM = new THREE.Vector3(0, 28, 38);
camera.position.copy(DEFAULT_CAM);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 3;
controls.maxDistance = 110;

scene.add(new THREE.HemisphereLight(0xffffff, 0x6b8f5a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -55;
sc.right = sc.top = 55;
sc.near = 1;
sc.far = 150;
sun.shadow.bias = -0.0005;
scene.add(sun);

// 地面
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(WORLD_RADIUS + 40, 64),
  new THREE.MeshLambertMaterial({ color: 0x86c26a }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// 公路 + 中间虚线
const road = new THREE.Mesh(
  new THREE.RingGeometry(ROAD_INNER, ROAD_OUTER, 96),
  new THREE.MeshLambertMaterial({ color: 0x5b6169 }),
);
road.rotation.x = -Math.PI / 2;
road.position.y = 0.02;
road.receiveShadow = true;
scene.add(road);

{
  const dash = new THREE.BoxGeometry(0.18, 0.02, 1.2);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5f1d6 });
  const mid = (ROAD_INNER + ROAD_OUTER) / 2;
  const count = 48;
  const dashes = new THREE.InstancedMesh(dash, dashMat, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    m.makeRotationY(-a);
    m.setPosition(Math.cos(a) * mid, 0.04, Math.sin(a) * mid);
    dashes.setMatrixAt(i, m);
  }
  scene.add(dashes);
}

// ---------- 加载 ----------
const loadingEl = document.getElementById('loading');
const loadingFill = document.getElementById('loading-fill');
const loadingText = document.getElementById('loading-text');

const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => {
  loadingFill.style.width = `${(loaded / total) * 100}%`;
  loadingText.textContent = `正在加载模型… ${loaded}/${total}`;
};

const loader = new GLTFLoader(manager);
const loadGLTF = (url) => loader.loadAsync(url);

function prepare(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    // Kenney 模型用一张调色板贴图，最近邻采样避免颜色串色
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (mat.map) {
        mat.map.magFilter = THREE.NearestFilter;
        mat.map.minFilter = THREE.NearestFilter;
        mat.map.generateMipmaps = false;
        mat.map.needsUpdate = true;
      }
    }
  });
  return root;
}

// 让模型底部贴地
function groundIt(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.y -= box.min.y;
}

// 伪随机，保证每次打开场景布局一样
let seed = 7;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

// ---------- 可选中的对象（侧边栏 & 点击） ----------
const items = []; // { id, label, group, object, follow }
function register(id, label, group, object, follow = false, minDist = 11) {
  object.userData.itemId = id;
  items.push({ id, label, group, object, follow, minDist });
}

// ---------- 状态 ----------
let character = null;
let mixer = null;
const actions = {};
let currentAction = null;
const vehicles = [];
const people = [];
const PEOPLE_AREA = { minR: 4, maxR: 13 }; // 在公路内侧散步

const charState = {
  velocityY: 0,
  onGround: true,
  target: null, // 点击地面后的目标点
  speed: 5,
};

async function init() {
  const gltfs = {};
  const entries = Object.entries(MODELS);
  const loaded = await Promise.all(entries.map(([, url]) => loadGLTF(url)));
  entries.forEach(([key], i) => (gltfs[key] = loaded[i]));

  // --- 人物 ---
  character = prepare(gltfs.character.scene);
  character.scale.setScalar(2.2);
  groundIt(character);
  character.userData.baseY = character.position.y;
  scene.add(character);
  mixer = new THREE.AnimationMixer(character);
  for (const clip of gltfs.character.animations) {
    actions[clip.name] = mixer.clipAction(clip);
  }
  if (actions.jump) {
    actions.jump.setLoop(THREE.LoopOnce, 1);
    actions.jump.clampWhenFinished = true;
  }
  playAction('idle');
  register('character', '机器人小人', '人物', character, true);

  // --- 真人比例的男女（Quaternius） ---
  const texLoader = new THREE.TextureLoader(manager);
  const loadSkin = async (url) => {
    const t = await texLoader.loadAsync(url);
    t.flipY = false; // glTF 贴图约定
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const [maleLight, femaleLight] = await Promise.all([
    loadSkin('models/people/male-light.webp'),
    loadSkin('models/people/female-light.webp'),
  ]);
  const peopleDefs = [
    {
      id: 'man1', label: '男士 1', src: gltfs.male, skin: null, height: 1.95, pos: [-4, 3],
      outfit: { shirt: 0xf2f2ee, bottom: 0x1f2a44, tie: 0x8a1c2b },
    },
    {
      id: 'man2', label: '男士 2', src: gltfs.male, skin: maleLight, height: 1.9, pos: [5, -3],
      outfit: { shirt: 0xe9eef5, jacket: 0x34383f, bottom: 0x34383f, tie: 0x2a4d8f },
    },
    {
      id: 'woman1', label: '女士 1', src: gltfs.female, skin: null, height: 1.8, pos: [-3, -5],
      outfit: { shirt: 0xb9d3ee, bottom: 0x1d1d22, skirt: true },
    },
    {
      id: 'woman2', label: '女士 2', src: gltfs.female, skin: femaleLight, height: 1.82, pos: [4, 5],
      outfit: { shirt: 0xf1e6d2, bottom: 0x6b6f76, shoes: 0x5a3a2a },
    },
  ];
  for (const def of peopleDefs) {
    const person = createPerson(def.src.scene, { skin: def.skin, height: def.height, outfit: def.outfit });
    person.object.position.set(def.pos[0], 0, def.pos[1]);
    person.object.rotation.y = rand() * Math.PI * 2;
    scene.add(person.object);
    people.push(person);
    register(def.id, def.label, '人物', person.object, true, 6);
  }

  // --- 车辆 ---
  const mid = (ROAD_INNER + ROAD_OUTER) / 2;
  const vehicleDefs = [
    { key: 'truckRed', label: '红色卡车', lane: mid - 1.2, dir: 1, speed: 7, angle: 0 },
    { key: 'truckGreen', label: '绿色卡车', lane: mid - 1.2, dir: 1, speed: 7, angle: Math.PI },
    { key: 'truckYellow', label: '黄色卡车', lane: mid + 1.2, dir: -1, speed: 6, angle: Math.PI / 2 },
    { key: 'truckPurple', label: '紫色卡车', lane: mid + 1.2, dir: -1, speed: 6, angle: -Math.PI / 2 },
    { key: 'motorcycle', label: '摩托车', lane: mid - 1.2, dir: 1, speed: 9, angle: Math.PI / 2 },
  ];
  for (const def of vehicleDefs) {
    const model = prepare(gltfs[def.key].scene);
    const holder = new THREE.Group();
    holder.add(model);
    groundIt(model);
    model.position.y += 0.03;

    // 根据前轮位置判断模型朝向（+Z 还是 -Z）
    const wheels = [];
    let frontZ = 0;
    let backZ = 0;
    model.traverse((o) => {
      if (/^wheel/i.test(o.name) && !wheels.includes(o)) {
        wheels.push(o);
        if (/front/i.test(o.name)) frontZ += o.position.z;
        if (/back|rear/i.test(o.name)) backZ += o.position.z;
      }
    });
    const forward = frontZ >= backZ ? 1 : -1;

    scene.add(holder);
    const v = { ...def, holder, wheels, forward };
    vehicles.push(v);
    placeVehicle(v, 0);
    register(def.key, def.label, '车辆', holder, true);
  }

  // --- 植物 ---
  const plantFirst = {};
  const addPlant = (key, label, x, z, scale, rotY) => {
    const obj = prepare(gltfs[key].scene.clone());
    obj.scale.setScalar(scale);
    obj.rotation.y = rotY;
    obj.position.set(x, 0, z);
    groundIt(obj);
    scene.add(obj);
    obj.userData.itemId = key;
    if (!plantFirst[key]) {
      plantFirst[key] = obj;
      register(key, label, '植物', obj);
    }
    return obj;
  };

  // 外圈森林
  const forestCount = 8;
  for (let i = 0; i < forestCount; i++) {
    const a = (i / forestCount) * Math.PI * 2 + 0.3;
    const r = 34 + (i % 2) * 6;
    addPlant('forest', '森林', Math.cos(a) * r, Math.sin(a) * r, 1, Math.floor(rand() * 4) * (Math.PI / 2));
  }

  // 散落的树丛：环内 & 环外
  const scatter = (key, label, n, rMin, rMax, sMin, sMax) => {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = rMin + rand() * (rMax - rMin);
      addPlant(key, label, Math.cos(a) * r, Math.sin(a) * r, sMin + rand() * (sMax - sMin), rand() * Math.PI * 2);
    }
  };
  addPlant('trees', '树丛', -6, -8, 3, 0.4);
  addPlant('treesTall', '高树丛', 7, -7, 3, 1.2);
  scatter('trees', '树丛', 10, 7, 13, 2.4, 3.4);
  scatter('treesTall', '高树丛', 8, 7, 13, 2.4, 3.4);
  scatter('trees', '树丛', 14, 23.5, 30, 2.6, 3.6);
  scatter('treesTall', '高树丛', 12, 23.5, 30, 2.6, 3.6);

  // 草坪块 + 小草
  // 3×3 的草坪
  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz++) addPlant('lawn', '草坪块', ix * 3, 8 + iz * 3, 3, 0);
  }
  addPlant('grassSmall', '小草', 2, 3, 1.8, 0);
  scatter('grassSmall', '小草', 50, 3, 14, 1.2, 2.2);
  scatter('grassSmall', '小草', 60, 22.5, 48, 1.2, 2.2);

  buildPanel();
  focusItem('character', true);
  loadingEl.classList.add('done');
}

function placeVehicle(v, dt) {
  v.angle += (v.dir * v.speed * dt) / v.lane;
  const x = Math.cos(v.angle) * v.lane;
  const z = Math.sin(v.angle) * v.lane;
  // 行驶方向（切线）
  const vx = -Math.sin(v.angle) * v.dir;
  const vz = Math.cos(v.angle) * v.dir;
  v.holder.position.set(x, 0, z);
  v.holder.rotation.y = Math.atan2(vx, vz) + (v.forward === 1 ? 0 : Math.PI);
  // 车轮转动：绕父节点 X 轴旋转，左右轮方向一致
  const spin = (v.speed * dt) / 0.3;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spin * v.forward);
  for (const w of v.wheels) w.quaternion.premultiply(q);
}

// ---------- 人物动画 ----------
function playAction(name, fade = 0.2) {
  const next = actions[name];
  if (!next || next === currentAction) return;
  next.reset().fadeIn(fade).play();
  if (currentAction) currentAction.fadeOut(fade);
  currentAction = next;
}

// ---------- 输入 ----------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
    e.preventDefault();
    charState.target = null;
    if (followItem?.id !== 'character') focusItem('character');
  }
  if (k === ' ' && charState.onGround && character) {
    charState.velocityY = 7.5;
    charState.onGround = false;
    playAction('jump', 0.1);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

// 点击：选中物体，或让人物走到地面上的点
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  const quick = performance.now() - downAt.t < 400;
  downAt = null;
  if (moved > 6 || !quick) return; // 是拖动，不是点击

  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);

  // 先看是否点中了人物或车辆
  const pickables = items.filter((i) => i.follow).map((i) => i.object);
  const hit = raycaster.intersectObjects(pickables, true)[0];
  if (hit) {
    let o = hit.object;
    while (o && !o.userData.itemId) o = o.parent;
    if (o) {
      focusItem(o.userData.itemId);
      return;
    }
  }

  const g = raycaster.intersectObject(ground)[0];
  if (g && character) {
    const p = g.point;
    if (Math.hypot(p.x, p.z) > WORLD_RADIUS) p.setLength(WORLD_RADIUS);
    charState.target = new THREE.Vector3(p.x, 0, p.z);
    if (followItem?.id !== 'character') focusItem('character');
  }
});

// ---------- 镜头 ----------
let followItem = null;
let flight = null; // 镜头飞行动画
const followCheckbox = document.getElementById('follow');
const lastTargetPos = new THREE.Vector3();

function focusItem(id, instant = false) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  followItem = item;

  const box = new THREE.Box3().setFromObject(item.object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dist = THREE.MathUtils.clamp(size * 1.8, item.minDist, 40);

  // 保持当前观察方向，只调整距离
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.y < 0.35) dir.y = 0.35;
  dir.normalize();
  const camTo = center.clone().add(dir.multiplyScalar(dist));

  lastTargetPos.copy(item.object.position);
  if (instant) {
    controls.target.copy(center);
    camera.position.copy(camTo);
    flight = null;
  } else {
    flight = {
      t: 0,
      fromCam: camera.position.clone(),
      fromTarget: controls.target.clone(),
      // 跟随运动物体时，目标相对物体的偏移
      camOffset: camTo.clone().sub(item.object.position),
      targetOffset: center.clone().sub(item.object.position),
    };
  }
  updateChips();
}

function resetView() {
  followItem = null;
  flight = {
    t: 0,
    fromCam: camera.position.clone(),
    fromTarget: controls.target.clone(),
    fixedCam: DEFAULT_CAM.clone(),
    fixedTarget: new THREE.Vector3(0, 0, 0),
  };
  updateChips();
}

function updateCamera(dt) {
  if (flight) {
    flight.t = Math.min(1, flight.t + dt / 0.9);
    const k = 1 - Math.pow(1 - flight.t, 3);
    let camTo;
    let targetTo;
    if (flight.fixedCam) {
      camTo = flight.fixedCam;
      targetTo = flight.fixedTarget;
    } else {
      const p = followItem.object.position;
      camTo = p.clone().add(flight.camOffset);
      targetTo = p.clone().add(flight.targetOffset);
    }
    camera.position.lerpVectors(flight.fromCam, camTo, k);
    controls.target.lerpVectors(flight.fromTarget, targetTo, k);
    if (flight.t >= 1) flight = null;
    if (followItem) lastTargetPos.copy(followItem.object.position);
    return;
  }
  // 跟随：物体移动多少，镜头就平移多少，用户仍可自由旋转
  if (followItem && followCheckbox.checked) {
    const p = followItem.object.position;
    const delta = p.clone().sub(lastTargetPos);
    delta.y = 0;
    camera.position.add(delta);
    controls.target.add(delta);
  }
  if (followItem) lastTargetPos.copy(followItem.object.position);
}

// ---------- 侧边栏 ----------
function buildPanel() {
  const groupsEl = document.getElementById('groups');
  const order = ['人物', '车辆', '植物'];
  for (const g of order) {
    const section = document.createElement('div');
    section.className = 'group';
    section.innerHTML = `<h2>${g}</h2><div class="chips"></div>`;
    const chips = section.querySelector('.chips');
    for (const item of items.filter((i) => i.group === g)) {
      const b = document.createElement('button');
      b.textContent = item.label;
      b.dataset.id = item.id;
      b.addEventListener('click', () => focusItem(item.id));
      chips.appendChild(b);
    }
    groupsEl.appendChild(section);
  }
  document.getElementById('reset').addEventListener('click', resetView);
  const panel = document.getElementById('panel');
  const toggle = document.getElementById('panel-toggle');
  toggle.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    toggle.textContent = panel.classList.contains('collapsed') ? '+' : '–';
  });
  if (window.innerWidth < 600) toggle.click();
}

function updateChips() {
  document.querySelectorAll('.chips button').forEach((b) => {
    b.classList.toggle('active', b.dataset.id === followItem?.id);
  });
}

// ---------- 每帧更新 ----------
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
const camForward = new THREE.Vector3();
const camRight = new THREE.Vector3();

function updateCharacter(dt) {
  if (!character) return;
  const move = new THREE.Vector3();

  // 键盘：相对镜头方向移动
  camera.getWorldDirection(camForward);
  camForward.y = 0;
  camForward.normalize();
  camRight.crossVectors(camForward, THREE.Object3D.DEFAULT_UP);
  if (keys.has('w') || keys.has('arrowup')) move.add(camForward);
  if (keys.has('s') || keys.has('arrowdown')) move.sub(camForward);
  if (keys.has('d') || keys.has('arrowright')) move.add(camRight);
  if (keys.has('a') || keys.has('arrowleft')) move.sub(camRight);

  // 点击目标
  if (move.lengthSq() === 0 && charState.target) {
    tmp.copy(charState.target).sub(character.position);
    tmp.y = 0;
    if (tmp.length() < 0.2) charState.target = null;
    else move.copy(tmp);
  }

  const moving = move.lengthSq() > 0;
  if (moving) {
    move.normalize();
    character.position.addScaledVector(move, charState.speed * dt);
    const r = Math.hypot(character.position.x, character.position.z);
    if (r > WORLD_RADIUS) {
      character.position.x *= WORLD_RADIUS / r;
      character.position.z *= WORLD_RADIUS / r;
    }
    // 平滑转向
    const targetYaw = Math.atan2(move.x, move.z);
    let diff = targetYaw - character.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    character.rotation.y += diff * Math.min(1, dt * 12);
  }

  // 跳跃
  if (!charState.onGround) {
    charState.velocityY -= 22 * dt;
    character.position.y += charState.velocityY * dt;
    if (character.position.y <= character.userData.baseY) {
      character.position.y = character.userData.baseY;
      charState.velocityY = 0;
      charState.onGround = true;
    }
  }

  if (charState.onGround) playAction(moving ? 'walk' : 'idle');
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  updateCharacter(dt);
  for (const v of vehicles) placeVehicle(v, dt);
  for (const p of people) updatePerson(p, dt, PEOPLE_AREA);
  if (mixer) mixer.update(dt);
  updateCamera(dt);
  controls.update();
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

init().catch((err) => {
  console.error(err);
  loadingText.textContent = '模型加载失败，请查看控制台';
});
