// Hero 3D scene: glossy lime "clay" tubes, chrome + perforated chrome capsules,
// and the Ağıllı Nağıllar spiral extruded in 3D. Style reference: lime/chrome CGI on lavender.
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { SVGLoader } from '../vendor/SVGLoader.js';

const hero = document.querySelector('.hero');
const canvas = document.querySelector('.hero__canvas');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  renderer = null;
}

if (renderer) init().catch((e) => console.warn('3D scene disabled:', e));

async function init() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 11);

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(4, 6, 8);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xf4f1ff, 0x9a9400, 0.35));

  /* ---------- Procedural textures ---------- */
  const limeTex = canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#cfe000';
    ctx.fillRect(0, 0, w, h);
    // marbled swirls
    ctx.filter = 'blur(14px)';
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = Math.random() < 0.55 ? 'rgba(120,135,0,.35)' : 'rgba(250,255,170,.45)';
      ctx.lineWidth = 6 + Math.random() * 26;
      ctx.beginPath();
      let x = Math.random() * w, y = Math.random() * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        ctx.bezierCurveTo(x + rnd(160), y + rnd(120), x + rnd(160), y + rnd(120), (x += rnd(220)), (y += rnd(140)));
      }
      ctx.stroke();
    }
    ctx.filter = 'none';
    // pores
    ctx.fillStyle = '#141408';
    for (let i = 0; i < 38; i++) {
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h, 6 + Math.random() * 4, 5 + Math.random() * 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  limeTex.wrapS = limeTex.wrapT = THREE.RepeatWrapping;
  limeTex.repeat.set(3, 1);

  const perfTex = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#39400a';
    const step = 20;
    for (let y = 0; y < h; y += step) {
      for (let x = (y / step) % 2 ? step / 2 : 0; x < w; x += step) {
        ctx.beginPath(); ctx.arc(x, y, 4.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  });
  perfTex.wrapS = perfTex.wrapT = THREE.RepeatWrapping;
  perfTex.repeat.set(3, 1.5);

  /* ---------- Materials ---------- */
  const uniforms = { uTime: { value: 0 } };
  const wobble = (mat, amt) => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float wob = sin(position.x * 1.7 + uTime * .9) * sin(position.y * 2.1 + uTime * .7) * sin(position.z * 1.3 + uTime * .5);
         transformed += normal * wob * ${amt.toFixed(3)};`
      );
    };
    return mat;
  };

  const clay = wobble(new THREE.MeshPhysicalMaterial({
    map: limeTex, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.15, sheenColor: new THREE.Color('#f7ff9c'),
  }), 0.09);
  const clayPlain = new THREE.MeshPhysicalMaterial({
    color: '#d4ea00', roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.08,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: '#f2f2f2', metalness: 1, roughness: 0.06 });
  const perforated = new THREE.MeshStandardMaterial({ color: '#f5f7e8', map: perfTex, metalness: 1, roughness: 0.14 });
  const pearl = new THREE.MeshPhysicalMaterial({
    color: '#efe9f2', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.6,
  });

  /* ---------- Objects ---------- */
  const world = new THREE.Group();
  scene.add(world);
  const floaters = [];
  const add = (mesh, float = 1) => {
    mesh.userData.base = mesh.position.clone();
    mesh.userData.phase = Math.random() * Math.PI * 2;
    mesh.userData.float = float;
    world.add(mesh);
    floaters.push(mesh);
    return mesh;
  };

  // Brand spiral in 3D
  const svgText = await fetch('assets/brand/spiral-ink.svg').then((r) => r.text());
  const data = new SVGLoader().parse(svgText);
  const shapes = data.paths.flatMap((p) => SVGLoader.createShapes(p));
  const spiralGeo = new THREE.ExtrudeGeometry(shapes, {
    depth: 110, bevelEnabled: true, bevelThickness: 22, bevelSize: 16, bevelSegments: 10, curveSegments: 64,
  });
  spiralGeo.center();
  const spiral = new THREE.Mesh(spiralGeo, clayPlain);
  const s = 3.4 / 680;
  spiral.scale.set(s, -s, s); // SVG y-axis points down
  const spiralPivot = new THREE.Group();
  spiralPivot.add(spiral);
  spiralPivot.position.set(1.7, 0.55, 0.6);
  spiralPivot.rotation.set(-0.15, -0.35, 0.05);
  add(spiralPivot, 0.6);

  // Lime clay tubes sweeping through the frame
  const tube = (pts, r) => new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 180, r, 48, false),
    clay
  );
  add(tube([[-7, -3.2, -1.5], [-4.2, -1.2, 0.2], [-3.2, 1.4, -0.4], [-1.2, 2.6, -1.8], [1.2, 3.6, -2.4], [3.5, 5, -2]], 0.62), 0.3);
  add(tube([[7.5, -4.5, -2.2], [4.8, -2.7, -0.6], [2.6, -2.6, 0.5], [0.2, -3.4, 0.2], [-2.5, -4.8, -1]], 0.5), 0.3);
  add(tube([[6.8, 4.2, -3], [5.2, 2.2, -1.6], [5.6, 0.2, -1.2], [7.4, -1.4, -2]], 0.42), 0.4);

  // Chrome + perforated capsules, glass and chrome spheres
  const perf = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.72, 2.4, 24, 64), perforated), 1);
  perf.position.set(-2.1, 0.55, 0.8);
  perf.rotation.set(0.2, 0, 1.15);
  perf.userData.base = perf.position.clone();

  const cap = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.5, 16, 48), chrome), 1.2);
  cap.position.set(-0.4, -1.2, 1.6);
  cap.rotation.set(0.4, 0.2, -0.9);
  cap.userData.base = cap.position.clone();

  const pearlBall = add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 64, 64), pearl), 1.4);
  pearlBall.position.set(0.1, 1.55, 2.1);
  pearlBall.userData.base = pearlBall.position.clone();

  const chromeBall = add(new THREE.Mesh(new THREE.SphereGeometry(0.38, 64, 64), chrome), 1.6);
  chromeBall.position.set(3.9, -1.25, 1.4);
  chromeBall.userData.base = chromeBall.position.clone();

  const limeBall = add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 48, 48), clayPlain), 1.8);
  limeBall.position.set(-3.6, -1.9, 1.8);
  limeBall.userData.base = limeBall.position.clone();

  /* ---------- Sizing ---------- */
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the composition framed on narrow screens
    camera.position.z = camera.aspect < 1 ? 11 / Math.max(camera.aspect, 0.5) * 0.85 : 11;
    world.position.set(camera.aspect < 1 ? -1 : 0, camera.aspect < 1 ? 0.9 : 0, 0);
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  /* ---------- Interaction ---------- */
  const pointer = new THREE.Vector2();
  const eased = new THREE.Vector2();
  addEventListener('pointermove', (e) => {
    pointer.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
  }, { passive: true });

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(hero);

  const clock = new THREE.Clock();
  const render = () => {
    const t = clock.getElapsedTime();
    uniforms.uTime.value = t;
    eased.lerp(pointer, 0.05);
    const scroll = Math.min(1, scrollY / innerHeight);

    world.rotation.y = eased.x * 0.35;
    world.rotation.x = eased.y * 0.22 + scroll * 0.35;
    camera.position.y = -scroll * 1.5;

    spiral.rotation.z = Math.sin(t * 0.4) * 0.08;
    spiralPivot.rotation.y = -0.35 + Math.sin(t * 0.3) * 0.25 + scroll * 1.2;

    for (const m of floaters) {
      const b = m.userData.base, p = m.userData.phase, f = m.userData.float;
      m.position.y = b.y + Math.sin(t * 0.8 * f + p) * 0.12 * f;
      m.position.x = b.x + Math.cos(t * 0.6 * f + p) * 0.06 * f;
    }
    perf.rotation.z = 1.15 + Math.sin(t * 0.5) * 0.12;
    cap.rotation.z = -0.9 + Math.sin(t * 0.7 + 1) * 0.15;
    limeTex.offset.x = t * 0.01;

    renderer.render(scene, camera);
  };

  if (reduced) {
    render();
    addEventListener('resize', render);
  } else {
    renderer.setAnimationLoop(() => { if (visible) render(); });
  }
  hero.classList.add('has-webgl');
}

function rnd(n) { return (Math.random() - 0.5) * 2 * n; }

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
