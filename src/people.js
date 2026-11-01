import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

// Quaternius Universal Base Characters 本身不带动画，
// 这里用代码转动骨骼，做出「手臂放下 + 走路 + 待机呼吸」的效果。

const X_AXIS = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// 某个节点相对 holder 的朝向 / 位置（holder 视为「模型空间」）
function modelQuat(holder, obj, out = new THREE.Quaternion()) {
  const inv = holder.getWorldQuaternion(new THREE.Quaternion()).invert();
  return out.copy(inv.multiply(obj.getWorldQuaternion(new THREE.Quaternion())));
}
function modelPos(holder, obj, out = new THREE.Vector3()) {
  return holder.worldToLocal(obj.getWorldPosition(out));
}

// ---------- 「穿衣服」：按身体部位上色 ----------
// 基础人体模型只穿了内衣。这里在着色器里根据顶点在 T 字绑定姿势下的位置，
// 把躯干/手臂涂成衬衫，腿涂成裤子或裙子，脚涂成鞋子，头和手保留皮肤贴图。
function bindPositions(mesh) {
  const out = {};
  mesh.skeleton.bones.forEach((bone, i) => {
    out[bone.name] = new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[i].clone().invert());
  });
  return out;
}

function dressUp(mesh, outfit) {
  const b = bindPositions(mesh);
  const uniforms = {
    uShirt: { value: new THREE.Color(outfit.shirt) },
    uJacket: { value: new THREE.Color(outfit.jacket ?? outfit.shirt) },
    uBottom: { value: new THREE.Color(outfit.bottom) },
    uShoe: { value: new THREE.Color(outfit.shoes ?? 0x1c1a19) },
    uTie: { value: new THREE.Color(outfit.tie ?? 0x000000) },
    uHasTie: { value: outfit.tie ? 1 : 0 },
    uHasJacket: { value: outfit.jacket ? 1 : 0 },
    uShoeTop: { value: b.foot_l.y + 0.03 },
    uBottomTop: { value: b.pelvis.y + 0.07 },
    // 裙子到膝盖下一点；裤子一直到鞋
    uBottomEnd: { value: outfit.skirt ? b.calf_l.y - 0.06 : b.foot_l.y + 0.03 },
    uNeck: { value: b.neck_01.y - 0.01 },
    uSleeveEnd: { value: Math.abs(b.hand_l.x) - 0.03 },
    uArmStart: { value: Math.abs(b.upperarm_l.x) - 0.04 },
    uChestY: { value: b.spine_03.y - 0.2 },
  };

  const mat = mesh.material.clone();
  mat.normalScale = new THREE.Vector2(0.35, 0.35); // 弱化肌肉法线，衣服更平整
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBindPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBindPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vBindPos;
        uniform vec3 uShirt, uJacket, uBottom, uShoe, uTie;
        uniform float uHasTie, uHasJacket, uShoeTop, uBottomTop, uBottomEnd, uNeck, uSleeveEnd, uArmStart, uChestY;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float ax = abs(vBindPos.x);
          float y = vBindPos.y;
          float cloth = 0.0;
          vec3 cc = vec3(0.0);
          bool torso = ax < 0.35 && y >= uBottomTop && y < uNeck;
          bool arm = ax >= uArmStart && ax < uSleeveEnd && y > uChestY;
          if (y < uShoeTop) {
            cc = uShoe; cloth = 1.0;
          } else if (y < uBottomTop && ax < uArmStart + 0.1 && y >= uBottomEnd) {
            cc = uBottom; cloth = 1.0;
          } else if (torso || arm) {
            cc = uHasJacket > 0.5 ? uJacket : uShirt;
            cloth = 1.0;
            // 西装外套：胸前露出一条衬衫
            if (uHasJacket > 0.5 && torso && vBindPos.z > 0.0 && ax < 0.02 + (y - uChestY) * 0.32 && y > uChestY) cc = uShirt;
            // 领带
            if (uHasTie > 0.5 && torso && vBindPos.z > 0.03 && ax < 0.022 && y > uBottomTop + 0.08) cc = uTie;
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, cc, cloth);
        }`,
      )
      // 衣服部分不要皮肤的油光
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (vBindPos.y < uNeck && (abs(vBindPos.x) < uSleeveEnd) && !(vBindPos.y >= uShoeTop && vBindPos.y < uBottomEnd)) roughnessFactor = max(roughnessFactor, 0.8);`,
      );
  };
  mat.customProgramCacheKey = () => 'dressed';
  mesh.material = mat;
}

/**
 * 创建一个会走路的人。
 * @param {THREE.Object3D} source  GLTF 场景
 * @param {object} opts
 *   skin:   可选，替换身体底色贴图（用于不同肤色）
 *   height: 目标身高
 *   outfit: 可选，衣服颜色 { shirt, bottom, shoes, tie, jacket, skirt }
 */
export function createPerson(source, { skin = null, height = 1.9, outfit = null } = {}) {
  const model = cloneSkinned(source);
  const holder = new THREE.Group(); // 负责位置和朝向
  const pivot = new THREE.Group(); // 负责把模型转到面朝 +Z
  holder.add(pivot);
  pivot.add(model);

  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false; // 骨骼动起来后包围盒会变，避免被误裁剪
    if (/superhero/i.test(o.material.name)) {
      if (skin) {
        o.material = o.material.clone();
        o.material.map = skin;
      }
      if (outfit && o.isSkinnedMesh) dressUp(o, outfit);
    }
  });

  // 统一身高，并让脚踩在地面上
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  model.scale.multiplyScalar(height / (box.max.y - box.min.y));

  const bones = {};
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
  });

  // 根据脚尖相对脚跟的方向判断模型朝向，转成面朝 +Z
  holder.updateMatrixWorld(true);
  const toe = modelPos(holder, bones.ball_l);
  const heel = modelPos(holder, bones.foot_l);
  pivot.rotation.y = -Math.atan2(toe.x - heel.x, toe.z - heel.z);
  holder.updateMatrixWorld(true);

  // 手臂从 T/A 字姿势放下来，稍微向外张开一点
  for (const side of ['l', 'r']) {
    const upper = bones[`upperarm_${side}`];
    const hand = bones[`hand_${side}`];
    const dir = modelPos(holder, hand).sub(modelPos(holder, upper)).normalize();
    const target = _v2.set(Math.sign(dir.x) * 0.12, -1, 0.02).normalize();
    const rot = new THREE.Quaternion().setFromUnitVectors(dir, target);
    rotateInModelSpace(holder, upper, rot);
    holder.updateMatrixWorld(true);
  }

  box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;
  holder.updateMatrixWorld(true);

  // 记录要动的骨骼：静止姿势 + 「模型空间 X 轴」在父骨骼坐标系里的方向
  const rig = {};
  for (const name of ['thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'spine_01']) {
    const bone = bones[name];
    const parentQ = modelQuat(holder, bone.parent);
    rig[name] = {
      bone,
      rest: bone.quaternion.clone(),
      axis: X_AXIS.clone().applyQuaternion(parentQ.invert()),
    };
  }

  const person = {
    object: holder,
    rig,
    phase: Math.random() * Math.PI * 2,
    walkWeight: 0,
    target: null,
    waitTime: Math.random() * 2,
    speed: 1.3 + Math.random() * 0.4,
    baseY: 0,
    time: Math.random() * 10,
  };
  return person;
}

// 让骨骼绕「模型空间」里的某个旋转转动（只在初始化时用）
function rotateInModelSpace(holder, bone, rot) {
  const parentQ = modelQuat(holder, bone.parent);
  const local = parentQ.clone().invert().multiply(rot).multiply(parentQ);
  bone.quaternion.premultiply(local);
}

// 绕模型 X 轴（左右方向）摆动骨骼。正角度 = 往后摆，负角度 = 往前摆
function swing(part, angle) {
  part.bone.quaternion.copy(part.rest);
  part.bone.quaternion.premultiply(_q.setFromAxisAngle(part.axis, angle));
}

/**
 * 每帧更新：在区域内随机散步
 * @param area { minR, maxR } 允许活动的圆环范围
 */
export function updatePerson(p, dt, area) {
  p.time += dt;
  const obj = p.object;

  // 选目标、走过去、停一会儿
  let moving = false;
  if (!p.target) {
    p.waitTime -= dt;
    if (p.waitTime <= 0) {
      const a = Math.random() * Math.PI * 2;
      const r = area.minR + Math.random() * (area.maxR - area.minR);
      p.target = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  } else {
    _v1.copy(p.target).sub(obj.position);
    _v1.y = 0;
    const dist = _v1.length();
    if (dist < 0.3) {
      p.target = null;
      p.waitTime = 1.5 + Math.random() * 3;
    } else {
      moving = true;
      _v1.normalize();
      const targetYaw = Math.atan2(_v1.x, _v1.z);
      let diff = targetYaw - obj.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      obj.rotation.y += diff * Math.min(1, dt * 5);
      // 先转向再加速，避免原地横移
      const facing = Math.max(0, Math.cos(diff));
      obj.position.addScaledVector(_v1, p.speed * facing * p.walkWeight * dt);
    }
  }

  // 走路 / 待机之间平滑过渡
  p.walkWeight = THREE.MathUtils.damp(p.walkWeight, moving ? 1 : 0, 6, dt);
  const w = p.walkWeight;
  p.phase += dt * p.speed * 4.2 * w;
  const s = Math.sin(p.phase);
  const c = Math.cos(p.phase);

  const legAmp = 0.45 * w;
  swing(p.rig.thigh_l, -s * legAmp);
  swing(p.rig.thigh_r, s * legAmp);
  // 膝盖：腿往后收时弯曲
  swing(p.rig.calf_l, (0.05 + Math.max(0, c) * 0.7) * w);
  swing(p.rig.calf_r, (0.05 + Math.max(0, -c) * 0.7) * w);

  // 手臂与腿反向摆动；待机时轻微晃动
  const idle = Math.sin(p.time * 1.6) * 0.03 * (1 - w);
  swing(p.rig.upperarm_l, s * 0.35 * w + idle);
  swing(p.rig.upperarm_r, -s * 0.35 * w + idle);
  swing(p.rig.lowerarm_l, -0.25 - Math.max(0, s) * 0.25 * w);
  swing(p.rig.lowerarm_r, -0.25 - Math.max(0, -s) * 0.25 * w);

  // 呼吸 / 走路时身体轻微上下
  swing(p.rig.spine_01, Math.sin(p.time * 1.6) * 0.015 * (1 - w) - 0.04 * w);
  obj.position.y = p.baseY + Math.abs(Math.sin(p.phase)) * 0.05 * w;
}
