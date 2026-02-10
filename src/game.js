import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- Capsule collision: two spheres (bottom + top) vs AABB ---
function closestPointAABB(point, boxMin, boxMax) {
  return new THREE.Vector3(
    THREE.MathUtils.clamp(point.x, boxMin.x, boxMax.x),
    THREE.MathUtils.clamp(point.y, boxMin.y, boxMax.y),
    THREE.MathUtils.clamp(point.z, boxMin.z, boxMax.z)
  );
}

function resolveSphereAABB(center, radius, boxMin, boxMax, outNormal, outDepth, outClosest) {
  const closest = closestPointAABB(center, boxMin, boxMax);
  if (outClosest) outClosest.copy(closest);
  const delta = new THREE.Vector3().subVectors(center, closest);
  const distSq = delta.lengthSq();
  if (distSq >= radius * radius) return false;
  const dist = Math.sqrt(distSq);
  outDepth.value = dist > 1e-6 ? radius - dist : radius;
  if (dist > 1e-6) {
    outNormal.copy(delta).normalize();
    // Ceiling only when box bottom is above our sphere top (we're fully under it)
    if (outNormal.y > 0.5 && boxMin.y > center.y + radius) {
      outNormal.set(0, -1, 0);
      outDepth.value = (center.y + radius) - boxMin.y;
    }
  } else {
    // Sphere center inside box — push out along least penetration; prefer down for ceilings only
    const penX = Math.min(center.x - boxMin.x, boxMax.x - center.x);
    const penY = Math.min(center.y - boxMin.y, boxMax.y - center.y);
    const penZ = Math.min(center.z - boxMin.z, boxMax.z - center.z);
    // Ceiling: box bottom above our sphere top (we're under it), not the floor
    if (boxMin.y > center.y + radius) {
      outNormal.set(0, -1, 0);
      outDepth.value = (center.y + radius) - boxMin.y;
    } else if (penX <= penY && penX <= penZ) {
      outNormal.set(center.x > (boxMin.x + boxMax.x) / 2 ? 1 : -1, 0, 0);
    } else if (penY <= penZ) {
      outNormal.set(0, center.y > (boxMin.y + boxMax.y) / 2 ? 1 : -1, 0);
    } else {
      outNormal.set(0, 0, center.z > (boxMin.z + boxMax.z) / 2 ? 1 : -1);
    }
  }
  return true;
}

const STAGE_FLOOR_Y = 0;
const FLOOR_EXTENT = 10000; // effectively infinite plane

// --- Stage geometry as AABBs (min, max) for collision ---
function createStageColliders(roomSize) {
  const colliders = [];

  // Floor (index 0) — infinite extent
  const f = FLOOR_EXTENT / 2;
  colliders.push({
    min: new THREE.Vector3(-f, STAGE_FLOOR_Y, -f),
    max: new THREE.Vector3(f, STAGE_FLOOR_Y + 0.1, f),
  });

  return colliders;
}

function updateRoomSize(roomSize, colliders, stageMeshes) {
  const f = FLOOR_EXTENT / 2;
  colliders[0].min.set(-f, STAGE_FLOOR_Y, -f);
  colliders[0].max.set(f, STAGE_FLOOR_Y + 0.1, f);
  stageMeshes.floor.scale.set(1, 1, 1);
}

// --- Build Three.js scene (visible mesh) for the same stage ---
function createStageMeshes(scene, roomSize) {
  const floorGeo = new THREE.PlaneGeometry(FLOOR_EXTENT, FLOOR_EXTENT);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9, metalness: 0.1 });
  floorMat.receiveShadow = true;
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, STAGE_FLOOR_Y, 0);
  floor.receiveShadow = true;
  scene.add(floor);

  return { floor };
}

// --- Maze / arena import from .glb: match by name "maze-wall*"/"maze-floor*" or "arena-wall*"/"arena-floor*" or glTF extras.subtype ---
const MAZE_WALL_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.05, receiveShadow: true });
const MAZE_FLOOR_MAT = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9, metalness: 0.05, receiveShadow: true });
const MAZE_COLLIDER_DEBUG_COLOR = 0xff00ff; // pink

function getLevelPieceType(obj) {
  const subtype = obj?.userData?.subtype;
  if (subtype === 'maze-wall' || subtype === 'maze-floor') return subtype;
  if (subtype === 'arena-wall' || subtype === 'arena-floor') return subtype;
  const parentSub = obj?.parent?.userData?.subtype;
  if (parentSub === 'maze-wall' || parentSub === 'maze-floor') return parentSub;
  if (parentSub === 'arena-wall' || parentSub === 'arena-floor') return parentSub;
  const name = obj?.name ?? '';
  if (name.startsWith('maze-wall')) return 'maze-wall';
  if (name.startsWith('maze-floor')) return 'maze-floor';
  if (name.startsWith('arena-wall')) return 'arena-wall';
  if (name.startsWith('arena-floor')) return 'arena-floor';
  return null;
}

function createBox3Wireframe(min, max, color) {
  const x0 = min.x, y0 = min.y, z0 = min.z, x1 = max.x, y1 = max.y, z1 = max.z;
  const vertices = new Float32Array([
    x0, y0, z0, x1, y0, z0,  x1, y0, z0, x1, y1, z0,  x1, y1, z0, x0, y1, z0,  x0, y1, z0, x0, y0, z0,
    x0, y0, z1, x1, y0, z1,  x1, y0, z1, x1, y1, z1,  x1, y1, z1, x0, y1, z1,  x0, y1, z1, x0, y0, z1,
    x0, y0, z0, x0, y0, z1,  x1, y0, z0, x1, y0, z1,  x1, y1, z0, x1, y1, z1,  x0, y1, z0, x0, y1, z1,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.computeBoundingSphere();
  const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: color ?? MAZE_COLLIDER_DEBUG_COLOR }));
  return line;
}

function applyMazeMaterials(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    const type = getLevelPieceType(child);
    if (type === 'maze-wall' || type === 'arena-wall') child.material = MAZE_WALL_MAT;
    else if (type === 'maze-floor' || type === 'arena-floor') child.material = MAZE_FLOOR_MAT;
    child.castShadow = true;
    if (child.material) child.material.receiveShadow = true;
  });
}

function enableShadowsOnObject(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    if (child.material) child.material.receiveShadow = true;
  });
}

function addMazeColliders(object, colliders, scene) {
  // Ensure world matrices are up to date so AABBs are in the correct space
  object.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let count = 0;
  object.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    const type = getLevelPieceType(child);
    const isWall = type === 'maze-wall' || type === 'arena-wall';
    const isFloor = type === 'maze-floor' || type === 'arena-floor';
    if (!isWall && !isFloor) return;
    box.setFromObject(child);
    const min = box.min.clone();
    const max = box.max.clone();
    colliders.push({ min, max, surfable: isWall });
    if (scene) {
      const debugLine = createBox3Wireframe(min, max, MAZE_COLLIDER_DEBUG_COLOR);
      scene.add(debugLine);
    }
    count++;
  });
  if (count > 0) console.log(`Level: ${count} colliders (pink debug) from maze/arena wall/floor (name or userData.subtype)`);
  else console.warn('Level: no meshes found. Use mesh name "maze-wall*"/"maze-floor*" or "arena-wall*"/"arena-floor*" (or matching extras.subtype).');
}

function loadMazeGlb(source, scene, colliders) {
  const loader = new GLTFLoader();
  const onLoad = (gltf) => {
    const root = gltf.scene;
    enableShadowsOnObject(root);
    applyMazeMaterials(root);
    scene.add(root);
    // Compute colliders after adding to scene so nested mesh world matrices are correct
    scene.updateMatrixWorld(true);
    addMazeColliders(root, colliders, scene);
  };
  if (typeof source === 'string') {
    loader.load(source, onLoad, undefined, (err) => console.error('Maze load failed:', err));
  } else if (source instanceof File) {
    const url = URL.createObjectURL(source);
    loader.load(url, (gltf) => { URL.revokeObjectURL(url); onLoad(gltf); }, undefined, (err) => { URL.revokeObjectURL(url); console.error('Maze load failed:', err); });
  }
}

// --- Player state and capsule ---
const CAPSULE_RADIUS = 0.4;
const CAPSULE_HEIGHT = 1.8;
const EYE_HEIGHT = 1.6;
const CROUCH_MULTIPLIER = 0.5;
const GRAVITY = 24;
const JUMP_VELOCITY = 8;
const MOVE_SPEED = 14; // default; overridden by Move speed slider
const WALL_RUN_GRAVITY_MULT = 0.25;
const WALL_RUN_SPEED = 16;
const WALL_RUN_SPEED_EASE = 10; // exponential easing rate toward surf speed cap
const INITIAL_SURF_SPEED = 6;   // fixed along-wall speed when mounting so arc is consistent
const WALL_JUMP_UP = 9;
const WALL_JUMP_OUT = 10;
const WALL_LATCH_JUMP = 2.5;
const WALL_RUN_LIFT_ACCEL = 12;
const WALL_RUN_ALONG_THRUST = 20;
const WALL_RUN_MOUNT_DELAY = 0.28;
const WALL_RUN_VERTICAL_THRUST_DURATION = 1.4;
const WALL_RUN_FORWARD_THRUST_DURATION = 0.85;  // forward (along-wall) thrust tapers to 0 over this time
const WALL_RUN_MOUNT_BOOST_DURATION = 0.2;  // extra vertical thrust at start so fall-into-wall feels like jump-in
const WALL_RUN_MOUNT_LIFT_BOOST = 18;
const WALL_RUN_NEAR_EPSILON = 0.28;
const WALL_RUN_ROLL_DEG = 18;
const WALL_RUN_ROLL_LERP = 10;
const MOUSE_SENSITIVITY = 0.002;
const FIXED_DT = 1 / 60; // fixed timestep so movement is identical across platforms
const MAX_ACCUMULATOR = 0.1; // cap to avoid spiral of death
const WALL_RUN_PLANE_TOLERANCE = 0.5; // still on wall if within this distance of wall plane (look-independent)
const GROUND_TOLERANCE = 0.05;
const WALL_NORMAL_THRESHOLD = 0.45; // |normal.y| < this => wall

// --- Movement FSM (Unreal CharacterMovement-style) ---
// States: WALKING (on ground), FALLING (in air, no wall), WALL_RUNNING (in air, on surfable wall).
// Transitions: WALKING -> FALLING (jump/step off), WALKING -> WALL_RUNNING (never directly),
//   FALLING -> WALKING (land), FALLING -> WALL_RUNNING (touch wall after being in air),
//   WALL_RUNNING -> FALLING (wall jump / run off wall), WALL_RUNNING -> WALKING (land).
const MovementState = Object.freeze({
  WALKING: 'walking',
  FALLING: 'falling',
  WALL_RUNNING: 'wall_running',
});

function getMovementState(onGround, isWallRunning) {
  if (onGround) return MovementState.WALKING;
  if (isWallRunning) return MovementState.WALL_RUNNING;
  return MovementState.FALLING;
}

function getCapsuleSpheres(position, capsuleHeight) {
  const y0 = position.y + CAPSULE_RADIUS;
  const y1 = position.y + capsuleHeight - CAPSULE_RADIUS;
  return [
    new THREE.Vector3(position.x, y0, position.z),
    new THREE.Vector3(position.x, y1, position.z),
  ];
}

function resolveCapsule(position, velocity, colliders, dt, capsuleHeight, outWallNormal, outWallPoint, outWallTopY, outWallColliderMin, outWallColliderMax) {
  const spheres = getCapsuleSpheres(position, capsuleHeight);
  const normal = new THREE.Vector3();
  const depth = { value: 0 };
  const collisionClosest = new THREE.Vector3();
  let onGround = false;
  // Don't clear outWallNormal at start — preserve surf wall when not penetrating (so looking away doesn't detach)
  const maxIter = 8;
  for (let iter = 0; iter < maxIter; iter++) {
    let resolved = false;
    for (const col of colliders) {
      for (const center of spheres) {
        if (resolveSphereAABB(center, CAPSULE_RADIUS, col.min, col.max, normal, depth, collisionClosest)) {
          const push = normal.clone().multiplyScalar(depth.value);
          position.add(push);
          if (normal.y > 0.5) {
            onGround = true;
            if (velocity.y < 0) velocity.y = 0;
          } else {
            velocity.addScaledVector(normal, -velocity.dot(normal));
            if (outWallNormal && col.surfable && Math.abs(normal.y) < WALL_NORMAL_THRESHOLD) {
              outWallNormal.copy(normal);
              if (outWallPoint) outWallPoint.copy(collisionClosest);
              if (outWallTopY) outWallTopY.value = col.max.y;
              if (outWallColliderMin) outWallColliderMin.copy(col.min);
              if (outWallColliderMax) outWallColliderMax.copy(col.max);
            }
          }
          resolved = true;
          break;
        }
      }
      if (resolved) break;
    }
    if (!resolved) break;
    spheres[0].set(position.x, position.y + CAPSULE_RADIUS, position.z);
    spheres[1].set(position.x, position.y + capsuleHeight - CAPSULE_RADIUS, position.z);
  }
  if (onGround && outWallNormal) outWallNormal.set(0, 0, 0);
  return onGround;
}

function sphereIntersectsAABB(center, radius, boxMin, boxMax) {
  const closest = closestPointAABB(center, boxMin, boxMax);
  return center.distanceToSquared(closest) < radius * radius;
}

function hasHeadroom(position, colliders) {
  const topCenter = new THREE.Vector3(
    position.x,
    position.y + CAPSULE_HEIGHT - CAPSULE_RADIUS,
    position.z
  );
  for (const col of colliders) {
    if (col.min.y <= 0.2) continue; // skip floor and low obstacles
    if (sphereIntersectsAABB(topCenter, CAPSULE_RADIUS, col.min, col.max)) return false;
  }
  return true;
}

const WALL_TOUCH_EPSILON = 0.12;

function getWallNormalWhenTouching(position, colliders, outWallNormal, touchEpsilon, outWallPoint, outWallTopY, outWallColliderMin, outWallColliderMax) {
  const bottomCenter = new THREE.Vector3(position.x, position.y + CAPSULE_RADIUS, position.z);
  const eps = touchEpsilon ?? WALL_TOUCH_EPSILON;
  const touchRadius = CAPSULE_RADIUS + eps;
  let bestDistSq = touchRadius * touchRadius;
  let bestWallTopY = 0;
  const closest = new THREE.Vector3();
  const delta = new THREE.Vector3();
  for (const col of colliders) {
    if (!col.surfable) continue; // only walls are surfable; skip floor, obstacles, overhang
    closest.copy(closestPointAABB(bottomCenter, col.min, col.max));
    delta.subVectors(bottomCenter, closest);
    const distSq = delta.lengthSq();
    if (distSq >= bestDistSq) continue;
    const dist = Math.sqrt(distSq);
    if (dist < 1e-6) continue;
    delta.normalize();
    if (Math.abs(delta.y) >= WALL_NORMAL_THRESHOLD) continue;
    if (!isClosestPointOnAABBFace(closest, col.min, col.max)) continue;
    bestDistSq = distSq;
    bestWallTopY = col.max.y;
    outWallNormal.copy(delta);
    if (outWallPoint) outWallPoint.copy(closest);
    if (outWallColliderMin) outWallColliderMin.copy(col.min);
    if (outWallColliderMax) outWallColliderMax.copy(col.max);
  }
  if (outWallTopY && bestDistSq < touchRadius * touchRadius) outWallTopY.value = bestWallTopY;
  return bestDistSq < touchRadius * touchRadius;
}

function isClosestPointOnAABBFace(closest, boxMin, boxMax, eps) {
  const e = eps ?? 1e-4;
  const onBoundaryX = Math.abs(closest.x - boxMin.x) <= e || Math.abs(closest.x - boxMax.x) <= e;
  const onBoundaryY = Math.abs(closest.y - boxMin.y) <= e || Math.abs(closest.y - boxMax.y) <= e;
  const onBoundaryZ = Math.abs(closest.z - boxMin.z) <= e || Math.abs(closest.z - boxMax.z) <= e;
  const boundaryCount = (onBoundaryX ? 1 : 0) + (onBoundaryY ? 1 : 0) + (onBoundaryZ ? 1 : 0);
  return boundaryCount === 1;
}

export function initGame(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, EYE_HEIGHT, 8);
  camera.rotation.order = 'YXZ';

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0x404060, 0.6);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(10, 20, 10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 500;
  dirLight.shadow.camera.left = -150;
  dirLight.shadow.camera.right = 150;
  dirLight.shadow.camera.top = 150;
  dirLight.shadow.camera.bottom = -150;
  dirLight.shadow.bias = -0.0001;
  scene.add(dirLight);

  const roomSize = { value: 36 };
  const stageMeshes = createStageMeshes(scene, roomSize.value);
  const colliders = createStageColliders(roomSize.value);

  const floorTexLoader = new THREE.TextureLoader();
  floorTexLoader.load(
    '/textures/Dark/texture_01.png',
    (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      const w = tex.image?.width ?? 1;
      const h = tex.image?.height ?? 1;
      const n = Math.max(1, Math.floor(FLOOR_EXTENT / 2));
      tex.repeat.set(n, n * (h / w));
      if (tex.colorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
      const floorMat = new THREE.MeshStandardMaterial({
        map: tex,
        color: 0x2a2a2a,
        roughness: 0.9,
        metalness: 0.1,
      });
      floorMat.receiveShadow = true;
      stageMeshes.floor.material.dispose();
      stageMeshes.floor.material = floorMat;
    },
    undefined,
    (err) => console.error('Floor texture failed to load:', err)
  );

  const playerPosition = new THREE.Vector3(0, 0, 8);
  const playerVelocity = new THREE.Vector3(0, 0, 0);
  let pitch = 0;
  let yaw = 0;
  let onGround = false;
  let wallRunningLastFrame = false;
  let wallRunMode = false;
  let wallRunTime = 0;
  let spaceDownLastFrame = false;
  let wallJumpCooldown = 0; // ignore same wall for this many frames after wall jump
  const jumpFromWallNormal = new THREE.Vector3(); // wall we jumped from; only ignore re-attach to this one
  let onGroundLastFrame = true;
  let cameraRoll = 0;
  const wallNormal = new THREE.Vector3();
  const wallAnchor = new THREE.Vector3();
  const wallTopY = { value: 0 }; // top of current surf wall; don't mount if camera is above it
  const wallColliderMin = new THREE.Vector3();
  const wallColliderMax = new THREE.Vector3();
  const wallRunThrustDir = new THREE.Vector3(); // thrust direction along wall; set at mount, never from look
  const prevWallNormal = new THREE.Vector3(); // last frame's wall normal to detect wall switch (e.g. A -> B)
  const tempWallNormal = new THREE.Vector3();
  const tempWallAnchor = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const keys = { w: false, a: false, s: false, d: false, space: false, c: false };
  let isCrouching = false;
  let currentCapsuleHeight = CAPSULE_HEIGHT;
  let currentEyeHeight = EYE_HEIGHT;
  const targetCapsuleHeight = () => (isCrouching ? CAPSULE_HEIGHT * CROUCH_MULTIPLIER : CAPSULE_HEIGHT);
  const targetEyeHeight = () => (isCrouching ? EYE_HEIGHT * CROUCH_MULTIPLIER : EYE_HEIGHT);

  // Crouch, wall-run, and look controls (top right)
  const crouchLerpSpeed = { value: 8 };
  const wallRunLiftAccel = { value: 12 };
  const wallRunAlongThrust = { value: 20 };
  const mouseSensitivity = { value: 0.002 };
  const moveSpeed = { value: 14 };
  const airControl = { value: 0.3 }; // 0 = no control while falling, 1 = full control
  const ui = document.createElement('div');
  ui.className = 'crouch-lerp-ui';
  ui.innerHTML = `
    <label>
      <span>Crouch speed</span>
      <input type="range" min="1" max="25" value="8" step="0.5" data-binding="crouch" />
      <output>8</output>
    </label>
    <label>
      <span>Upward thrust</span>
      <input type="range" min="0" max="30" value="12" step="1" data-binding="lift" />
      <output>12</output>
    </label>
    <label>
      <span>Forward thrust</span>
      <input type="range" min="0" max="40" value="20" step="1" data-binding="along" />
      <output>20</output>
    </label>
    <label>
      <span>Look sensitivity</span>
      <input type="range" min="0.001" max="2" value="1" step="0.0001" data-binding="sensitivity" />
      <output>1</output>
    </label>
    <label>
      <span>Move speed</span>
      <input type="range" min="4" max="30" value="14" step="1" data-binding="move" />
      <output>14</output>
    </label>
    <label>
      <span>Air control</span>
      <input type="range" min="0" max="1" value="0.3" step="0.05" data-binding="airControl" />
      <output>0.3</output>
    </label>
    <label>
      <span>Room size</span>
      <input type="range" min="16" max="56" value="36" step="2" data-binding="roomsize" />
      <output>36</output>
    </label>
    <label>
      <span>Light intensity</span>
      <input type="range" min="0" max="3" value="0.9" step="0.1" data-binding="lightIntensity" />
      <output>0.9</output>
    </label>
    <label>
      <span>Light X</span>
      <input type="range" min="-50" max="50" value="10" step="1" data-binding="lightX" />
      <output>10</output>
    </label>
    <label>
      <span>Light Y</span>
      <input type="range" min="0" max="50" value="20" step="1" data-binding="lightY" />
      <output>20</output>
    </label>
    <label>
      <span>Light Z</span>
      <input type="range" min="-50" max="50" value="10" step="1" data-binding="lightZ" />
      <output>10</output>
    </label>
    <label class="maze-load-label">
      <span>Load maze</span>
      <input type="file" accept=".glb" multiple data-binding="maze" />
    </label>
    <button type="button" class="fullscreen-btn" data-binding="fullscreen">Full screen</button>
  `;
  const fullscreenBtn = ui.querySelector('button[data-binding="fullscreen"]');
  const updateFullscreenLabel = () => {
    if (fullscreenBtn) fullscreenBtn.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  };
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!document.fullscreenElement) {
        container.requestFullscreen?.() || container.webkitRequestFullscreen?.(Element.ALLOW_KEYBOARD_INPUT);
      } else {
        document.exitFullscreen?.() || document.webkitExitFullscreen?.();
      }
    });
    document.addEventListener('fullscreenchange', updateFullscreenLabel);
    document.addEventListener('webkitfullscreenchange', updateFullscreenLabel);
  }
  const mazeInput = ui.querySelector('input[data-binding="maze"]');
  if (mazeInput) {
    mazeInput.addEventListener('change', () => {
      const files = mazeInput.files;
      if (!files?.length) return;
      for (let i = 0; i < files.length; i++) loadMazeGlb(files[i], scene, colliders);
      mazeInput.value = '';
    });
    mazeInput.addEventListener('click', (e) => e.stopPropagation());
  }
  ui.querySelectorAll('input[type="range"]').forEach((rangeInput) => {
    const outputEl = rangeInput.parentElement.querySelector('output');
    const binding = rangeInput.dataset.binding;
    const update = () => {
      const v = Number(rangeInput.value);
      outputEl.textContent = binding === 'sensitivity' ? (v < 0.1 ? v.toFixed(4) : v < 1 ? v.toFixed(3) : Number(v).toFixed(2)) : rangeInput.value;
      if (binding === 'crouch') crouchLerpSpeed.value = v;
      else if (binding === 'lift') wallRunLiftAccel.value = v;
      else if (binding === 'along') wallRunAlongThrust.value = v;
      else if (binding === 'sensitivity') mouseSensitivity.value = MOUSE_SENSITIVITY * v;
      else if (binding === 'move') moveSpeed.value = v;
      else if (binding === 'airControl') airControl.value = v;
      else if (binding === 'roomsize') {
        roomSize.value = v;
        updateRoomSize(roomSize.value, colliders, stageMeshes);
      } else if (binding === 'lightIntensity') dirLight.intensity = v;
      else if (binding === 'lightX') dirLight.position.x = v;
      else if (binding === 'lightY') dirLight.position.y = v;
      else if (binding === 'lightZ') dirLight.position.z = v;
    };
    rangeInput.addEventListener('input', update);
    rangeInput.addEventListener('click', (e) => e.stopPropagation());
    update(); // sync state from DOM on load
  });
  ui.addEventListener('click', (e) => e.stopPropagation());
  container.appendChild(ui);

  const isLocalhost = typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  const devControllerEl = isLocalhost ? (() => {
    const el = document.createElement('div');
    el.className = 'dev-controller-debug';
    el.textContent = '';
    container.appendChild(el);
    return el;
  })() : null;

  document.addEventListener('keydown', (e) => {
    const k = e.code.toLowerCase();
    if (k === 'keyw') keys.w = true;
    if (k === 'keya') keys.a = true;
    if (k === 'keys') keys.s = true;
    if (k === 'keyd') keys.d = true;
    if (k === 'space') { e.preventDefault(); keys.space = true; }
    if (k === 'keyc') { e.preventDefault(); keys.c = true; isCrouching = true; }
  });
  document.addEventListener('keyup', (e) => {
    const k = e.code.toLowerCase();
    if (k === 'keyw') keys.w = false;
    if (k === 'keya') keys.a = false;
    if (k === 'keys') keys.s = false;
    if (k === 'keyd') keys.d = false;
    if (k === 'space') keys.space = false;
    if (k === 'keyc') keys.c = false;
  });

  const canvas = renderer.domElement;
  canvas.setAttribute('tabindex', '0');
  canvas.style.outline = 'none';
  const requestLock = () => {
    canvas.focus();
    canvas.requestPointerLock();
  };
  container.addEventListener('click', requestLock);
  canvas.addEventListener('click', requestLock);

  function onMouseMove(e) {
    if (document.pointerLockElement !== canvas) return;
    const dx = e.movementX ?? e.mozMovementX ?? e.webkitMovementX ?? 0;
    const dy = e.movementY ?? e.mozMovementY ?? e.webkitMovementY ?? 0;
    const sens = mouseSensitivity.value;
    yaw -= dx * sens;
    pitch -= dy * sens;
    pitch = THREE.MathUtils.clamp(pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }
  document.addEventListener('mousemove', onMouseMove, { passive: true });
  canvas.addEventListener('mousemove', onMouseMove, { passive: true });

  function getForward() {
    const f = new THREE.Vector3(0, 0, -1);
    f.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    f.y = 0;
    if (f.lengthSq() > 1e-6) f.normalize();
    return f;
  }
  function getRight() {
    const r = new THREE.Vector3(1, 0, 0);
    r.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return r;
  }

  const GAMEPAD_DEADZONE = 0.2;
  const GAMEPAD_LOOK_DEADZONE = 0.12;
  const GAMEPAD_LOOK_RAD_PER_SEC = 2.2; // full stick rad/s at 1x look sensitivity
  let lastGamepadA = false;

  function pollGamepad(dt) {
    const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
    if (!gp || !gp.connected) return;
    const aPressed = !!(gp.buttons[0]?.pressed);
    if (!document.pointerLockElement) {
      if (aPressed && !lastGamepadA) {
        canvas.focus();
        canvas.requestPointerLock();
      }
      lastGamepadA = aPressed;
      return;
    }
    lastGamepadA = aPressed;
    keys.w = gp.axes[1] < -GAMEPAD_DEADZONE;
    keys.s = gp.axes[1] > GAMEPAD_DEADZONE;
    keys.a = gp.axes[0] < -GAMEPAD_DEADZONE;
    keys.d = gp.axes[0] > GAMEPAD_DEADZONE;
    keys.space = aPressed;
    keys.c = !!(gp.buttons[1]?.pressed) || !!(gp.buttons[10]?.pressed); // B or left stick click (L3)
    // Right stick: 6+ axes = use 4,5 (2,3 are triggers); 4 axes = use 2,3
    const axes = gp.axes;
    const useRightStick45 = axes.length >= 6;
    const rx = (useRightStick45 ? axes[4] : axes[2]) ?? 0;
    const ry = (useRightStick45 ? axes[5] : axes[3]) ?? 0;
    const rxClamp = Math.abs(rx) > GAMEPAD_LOOK_DEADZONE ? rx : 0;
    const ryClamp = Math.abs(ry) > GAMEPAD_LOOK_DEADZONE ? ry : 0;
    const lookSens = GAMEPAD_LOOK_RAD_PER_SEC * (mouseSensitivity.value / MOUSE_SENSITIVITY) * dt;
    yaw -= rxClamp * lookSens;
    pitch -= ryClamp * lookSens;
    pitch = THREE.MathUtils.clamp(pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }

  function update(dt, applyThrustThisStep, thrustDt, thrustState) {
    if (document.pointerLockElement !== canvas) return;
    const thrustDelta = thrustDt != null ? thrustDt : dt; // once-per-frame thrust dt when using fixed timestep

    // Crouch: hold C to crouch; only stand when released and there is headroom
    isCrouching = keys.c || !hasHeadroom(playerPosition, colliders);

    const forward = getForward();
    const right = getRight();

    // --- FSM: input based on previous frame's state ---
    const lastState = getMovementState(onGroundLastFrame, wallRunningLastFrame);
    switch (lastState) {
      case MovementState.WALL_RUNNING:
        if (keys.space && !spaceDownLastFrame) {
          playerVelocity.addScaledVector(wallNormal, WALL_JUMP_OUT);
          playerVelocity.y = WALL_JUMP_UP;
          jumpFromWallNormal.copy(wallNormal);
          wallNormal.set(0, 0, 0);
          wallRunMode = false;
          wallJumpCooldown = 3;
        }
        break;
      case MovementState.WALKING:
        {
          const moveF = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
          const moveR = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
          if (moveF !== 0 || moveR !== 0) {
            const dir = new THREE.Vector3().addScaledVector(forward, moveF).addScaledVector(right, moveR);
            dir.y = 0;
            if (dir.lengthSq() > 1e-6) dir.normalize();
            const speed = moveSpeed.value;
            playerVelocity.x = dir.x * speed;
            playerVelocity.z = dir.z * speed;
          }
          if (keys.space) {
            if (wallNormal.lengthSq() > 0.1) {
              playerVelocity.y = WALL_LATCH_JUMP;
              onGround = false;
            } else {
              playerVelocity.y = JUMP_VELOCITY;
              onGround = false;
            }
          }
        }
        break;
      case MovementState.FALLING:
        if (airControl.value > 0) {
          const moveF = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
          const moveR = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
          if (moveF !== 0 || moveR !== 0) {
            const dir = new THREE.Vector3().addScaledVector(forward, moveF).addScaledVector(right, moveR);
            dir.y = 0;
            if (dir.lengthSq() > 1e-6) dir.normalize();
            const desiredX = dir.x * moveSpeed.value;
            const desiredZ = dir.z * moveSpeed.value;
            const t = airControl.value;
            playerVelocity.x += (desiredX - playerVelocity.x) * t;
            playerVelocity.z += (desiredZ - playerVelocity.z) * t;
          }
        }
        break;
    }

    playerPosition.x += playerVelocity.x * dt;
    playerPosition.y += playerVelocity.y * dt;
    playerPosition.z += playerVelocity.z * dt;

    const speed = crouchLerpSpeed.value;
    const t = 1 - Math.exp(-speed * dt);
    currentCapsuleHeight += (targetCapsuleHeight() - currentCapsuleHeight) * t;
    currentEyeHeight += (targetEyeHeight() - currentEyeHeight) * t;

    onGround = resolveCapsule(playerPosition, playerVelocity, colliders, dt, currentCapsuleHeight, wallNormal, wallAnchor, wallTopY, wallColliderMin, wallColliderMax);
    if (onGround && wallNormal.lengthSq() < 0.1)
      getWallNormalWhenTouching(playerPosition, colliders, wallNormal, undefined, wallAnchor, wallTopY, wallColliderMin, wallColliderMax);
    // Recover wall when we were surfing and lost it; also pick up a wall when we just jumped off one (so we can stick to the next)
    if (!onGround && wallNormal.lengthSq() < 0.1 && (wallRunningLastFrame || wallJumpCooldown > 0))
      getWallNormalWhenTouching(playerPosition, colliders, wallNormal, WALL_RUN_NEAR_EPSILON, wallAnchor, wallTopY, wallColliderMin, wallColliderMax);
    // After wall jump, ignore re-attach only to the *same* wall; allow sticking to a different (e.g. perpendicular) wall
    if (wallJumpCooldown > 0) {
      if (wallNormal.lengthSq() > 0.1 && jumpFromWallNormal.lengthSq() > 0.1 && wallNormal.dot(jumpFromWallNormal) > 0.99) {
        wallNormal.set(0, 0, 0);
        wallRunMode = false;
      }
      wallJumpCooldown--;
    }
    // Don't mount if camera/player is above the wall top (e.g. looking down at the wall from above)
    const eyeY = playerPosition.y + currentEyeHeight;
    if (wallNormal.lengthSq() > 0.1 && eyeY >= wallTopY.value - 0.05) {
      wallNormal.set(0, 0, 0);
      wallRunMode = false;
    }
    // If we think we're on a wall but we've run off (past top, too far from plane, or off the wall's edge), stop wall run.
    if (!onGround && wallNormal.lengthSq() > 0.1) {
      const toWall = playerPosition.clone().sub(wallAnchor);
      const distToPlane = Math.abs(toWall.dot(wallNormal));
      if (distToPlane > CAPSULE_RADIUS + WALL_RUN_PLANE_TOLERANCE) {
        wallNormal.set(0, 0, 0);
        wallRunMode = false;
      } else {
        const closestOnWall = closestPointAABB(playerPosition, wallColliderMin, wallColliderMax);
        if (!isClosestPointOnAABBFace(closestOnWall, wallColliderMin, wallColliderMax)) {
          wallNormal.set(0, 0, 0);
          wallRunMode = false;
        }
      }
    }
    if (onGround) {
      wallRunMode = false;
      wallRunTime = 0;
    } else if (wallNormal.lengthSq() > 0.1 && !onGroundLastFrame) {
      // Only start surfing when we were already in the air (e.g. after a jump), not when we just ran into a wall on the ground
      wallRunMode = true;
    }
    const isWallRunning = wallRunMode && !onGround && wallNormal.lengthSq() > 0.1;
    if (!isWallRunning) wallRunTime = 0;
    const justMounted = isWallRunning && !wallRunningLastFrame;
    const wallChanged = isWallRunning && wallRunningLastFrame && prevWallNormal.lengthSq() > 0.1 && wallNormal.lengthSq() > 0.1 && prevWallNormal.dot(wallNormal) < 0.99;
    if (justMounted) {
      wallRunTime = 0;
      wallRunThrustDir.set(0, 0, 0);
    } else if (wallChanged) {
      wallRunTime = 0;
      wallRunThrustDir.set(0, 0, 0);
    }

    // --- FSM: physics per state ---
    const movementState = getMovementState(onGround, isWallRunning);
    switch (movementState) {
      case MovementState.WALKING:
        // resolveCapsule already zeroed vy when landing
        break;
      case MovementState.WALL_RUNNING:
        {
          let outN = playerVelocity.dot(wallNormal);
          if (outN > 0) playerVelocity.addScaledVector(wallNormal, -outN);
          playerVelocity.y -= GRAVITY * WALL_RUN_GRAVITY_MULT * dt;
          const canApplyThisStep = applyThrustThisStep !== false || justMounted || wallChanged;
          const shouldApplyThrust = canApplyThisStep && (!thrustState || !thrustState.applied);
          if (shouldApplyThrust) {
            if (thrustState) thrustState.applied = true;
            const surfingTime = Math.max(0, wallRunTime - WALL_RUN_MOUNT_DELAY);
            const verticalLiftMult = Math.max(0, 1 - surfingTime / WALL_RUN_VERTICAL_THRUST_DURATION);
            playerVelocity.y += wallRunLiftAccel.value * thrustDelta * verticalLiftMult;
            if (wallRunTime < WALL_RUN_MOUNT_BOOST_DURATION)
              playerVelocity.y += WALL_RUN_MOUNT_LIFT_BOOST * thrustDelta;
            const forwardThrustMult = Math.max(0, 1 - surfingTime / WALL_RUN_FORWARD_THRUST_DURATION);
            const alongWall = new THREE.Vector3().crossVectors(wallNormal, up);
            alongWall.y = 0;
            if (alongWall.lengthSq() > 0.01) alongWall.normalize();
            const inWallPlane = new THREE.Vector3()
              .copy(playerVelocity)
              .addScaledVector(wallNormal, -playerVelocity.dot(wallNormal));
            inWallPlane.y = 0;
            if (justMounted || wallChanged) {
              if (playerVelocity.y < 0) playerVelocity.y = 0;
              if (alongWall.lengthSq() > 0.01) {
                const fwd = getForward();
                const thrustAlong = alongWall.clone();
                if (fwd.dot(thrustAlong) < 0) thrustAlong.negate();
                wallRunThrustDir.copy(thrustAlong).normalize();
                const incomingAlongSpeed = inWallPlane.length();
                const mountSpeed = Math.max(INITIAL_SURF_SPEED, incomingAlongSpeed);
                playerVelocity.addScaledVector(inWallPlane, -1);
                playerVelocity.addScaledVector(thrustAlong, mountSpeed);
              }
            }
            const alongSpeed = inWallPlane.length();
            let thrustDir;
            if (justMounted || wallChanged) {
              thrustDir = wallRunThrustDir.lengthSq() > 0.01 ? wallRunThrustDir.clone().normalize() : (alongWall.lengthSq() > 0.01 ? alongWall.clone() : new THREE.Vector3(1, 0, 0));
            } else if (alongSpeed > 0.3 && inWallPlane.lengthSq() > 0.01) {
              inWallPlane.normalize();
              thrustDir = inWallPlane;
              wallRunThrustDir.copy(thrustDir);
            } else if (wallRunThrustDir.lengthSq() > 0.01) {
              thrustDir = wallRunThrustDir.clone().normalize();
            } else if (alongWall.lengthSq() > 0.01) {
              wallRunThrustDir.copy(alongWall).normalize();
              thrustDir = wallRunThrustDir.clone();
            } else {
              thrustDir = new THREE.Vector3(1, 0, 0);
            }
            if (thrustDir.lengthSq() > 0.01) thrustDir.normalize();
            playerVelocity.addScaledVector(thrustDir, wallRunAlongThrust.value * forwardThrustMult * thrustDelta);
            wallRunTime += thrustDelta;
          }
          outN = playerVelocity.dot(wallNormal);
          if (outN > 0) playerVelocity.addScaledVector(wallNormal, -outN);
          const inWallPlaneCap = new THREE.Vector3()
            .copy(playerVelocity)
            .addScaledVector(wallNormal, -playerVelocity.dot(wallNormal));
          inWallPlaneCap.y = 0;
          const speedCap = inWallPlaneCap.length();
          if (speedCap > 1e-6) {
            const ease = 1 - Math.exp(-WALL_RUN_SPEED_EASE * dt);
            const targetSpeed = Math.min(speedCap, WALL_RUN_SPEED);
            const newSpeed = speedCap + (targetSpeed - speedCap) * ease;
            playerVelocity.addScaledVector(inWallPlaneCap, (newSpeed - speedCap) / speedCap);
          }
          const wallDist = playerPosition.clone().sub(wallAnchor).dot(wallNormal);
          playerPosition.addScaledVector(wallNormal, CAPSULE_RADIUS - wallDist);
        }
        break;
      case MovementState.FALLING:
        playerVelocity.y -= GRAVITY * dt;
        break;
    }

    if (!isWallRunning) wallRunThrustDir.set(0, 0, 0);
    prevWallNormal.copy(wallNormal);
    wallRunningLastFrame = isWallRunning;
    spaceDownLastFrame = keys.space;
    onGroundLastFrame = onGround;

    if (!isWallRunning) {
      playerVelocity.x *= 0.92;
      playerVelocity.z *= 0.92;
    }

    const rollRad = (WALL_RUN_ROLL_DEG * Math.PI) / 180;
    let targetRoll = 0;
    if (isWallRunning && wallNormal.lengthSq() > 0.1) {
      const wallHoriz = new THREE.Vector3(wallNormal.x, 0, wallNormal.z);
      if (wallHoriz.lengthSq() > 0.01) {
        wallHoriz.normalize();
        targetRoll = -getRight().dot(wallHoriz) * rollRad;
      }
    }
    cameraRoll += (targetRoll - cameraRoll) * (1 - Math.exp(-WALL_RUN_ROLL_LERP * dt));

    camera.position.copy(playerPosition);
    camera.position.y = playerPosition.y + currentEyeHeight;
    camera.rotation.order = 'YXZ';
    camera.rotation.x = pitch;
    camera.rotation.y = yaw;
    camera.rotation.z = cameraRoll;
  }

  let lastFrameTime = 0;
  let accumulator = 0;
  function animate(time) {
    requestAnimationFrame(animate);
    const rawDelta = lastFrameTime ? time - lastFrameTime : 0;
    const dt = rawDelta === 0 ? FIXED_DT : Math.min(0.05, rawDelta > 1 ? rawDelta / 1000 : rawDelta);
    lastFrameTime = time;
    pollGamepad(dt); // run every frame so gamepad works and "press A to start" works when not locked
    if (devControllerEl) {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const hasGamepad = Array.from(gamepads).some((g) => g?.connected);
      devControllerEl.textContent = hasGamepad ? 'controller connected' : '';
    }
    accumulator += dt;
    if (accumulator > MAX_ACCUMULATOR) accumulator = MAX_ACCUMULATOR;
    const steps = Math.floor(accumulator / FIXED_DT);
    const thrustDt = steps * FIXED_DT; // thrust once per frame with total frame time so it doesn't oscillate
    const thrustState = { applied: false }; // so we apply thrust at most once per frame, including when we mount mid-frame
    for (let i = 0; i < steps; i++) {
      update(FIXED_DT, i === 0, thrustDt, thrustState);
      accumulator -= FIXED_DT;
    }
    renderer.render(scene, camera);
  }
  animate(0);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer };
}
