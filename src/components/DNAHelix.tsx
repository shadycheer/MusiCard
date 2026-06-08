'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type DNAHelixPhase = 'drift' | 'spinner' | 'checkmark';

type Props = {
  /** drift = loose particle cloud (idle hero, freeform motion).
   *  spinner = particles tighten onto a 3D sphere surface; a
   *  rotating "lit hemisphere" gradient sweeps around it so the
   *  rotation reads as motion (loading indicator).
   *  checkmark = sphere collapses (Z → 0) into a filled green disc
   *  with a bright ✓ stroke on top — designed to match the SVG
   *  badge that cross-fades over the helix center at completion. */
  phase?: DNAHelixPhase;
};

/* 250 total: 200 for the disc fill + 50 for the ✓ stroke. During
   sphere phase, every particle (disc + check) sits on a single
   fibonacci-distributed sphere surface — uniformly dense, no poles
   or seams. */
const DISC_COUNT = 200;
const CHECK_COUNT = 50;
const PARTICLE_COUNT = DISC_COUNT + CHECK_COUNT;

const SUCCESS_R = 30 / 255;
const SUCCESS_G = 215 / 255;
const SUCCESS_B = 96 / 255;

/* Sphere is slightly bigger than the disc so the spinner→check
   morph reads as visible contraction (sphere collapsing to disc). */
const SPHERE_RADIUS = 1.05;
const DISC_RADIUS = 0.81;

/* Lit-hemisphere rotation speed. Faster = snappier loading feel,
   slower = more contemplative. ~1/3 of a turn per second feels
   appropriate for a multi-second loading operation. */
const LIGHT_SPIN_HZ = 0.35;

/* ✓ stroke path. SVG: M7.2 12.2 L10.6 15.6 L16.8 9.2 in viewBox 24,
   translated to origin, Y-negated, scaled to scene units. */
const CHECK_A: [number, number] = [-0.353, -0.015];
const CHECK_B: [number, number] = [-0.103, -0.265];
const CHECK_C: [number, number] = [0.354, 0.206];

/* Fibonacci sphere — uniform-density point distribution on a sphere
   surface. Used for the spinner phase so the ball reads as a
   perfect sphere rather than clustered at poles. */
function buildSphereTargets(): Float32Array {
  const out = new Float32Array(PARTICLE_COUNT * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    /* y from +1 to -1 stratified; sqrt(1-y²) gives the latitudinal
       radius so the projection onto XY rings is correct. */
    const y = 1 - (i / (PARTICLE_COUNT - 1)) * 2;
    const ringRadius = Math.sqrt(1 - y * y);
    const theta = i * golden;
    out[i * 3] = Math.cos(theta) * ringRadius * SPHERE_RADIUS;
    out[i * 3 + 1] = y * SPHERE_RADIUS;
    out[i * 3 + 2] = Math.sin(theta) * ringRadius * SPHERE_RADIUS;
  }
  return out;
}

/* Sunflower disc — uniform-area particle distribution inside a circle.
   Used for the disc fill of the final ✓ badge. */
function buildDiscTargets(): Float32Array {
  const out = new Float32Array(DISC_COUNT * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < DISC_COUNT; i++) {
    const r = Math.sqrt((i + 0.5) / DISC_COUNT) * DISC_RADIUS;
    const a = i * golden;
    out[i * 3] = r * Math.cos(a);
    out[i * 3 + 1] = r * Math.sin(a);
    out[i * 3 + 2] = 0;
  }
  return out;
}

function buildCheckmarkTargets(): Float32Array {
  const out = new Float32Array(CHECK_COUNT * 3);
  const lenShort = Math.hypot(CHECK_B[0] - CHECK_A[0], CHECK_B[1] - CHECK_A[1]);
  const lenLong = Math.hypot(CHECK_C[0] - CHECK_B[0], CHECK_C[1] - CHECK_B[1]);
  const total = lenShort + lenLong;
  const shortCount = Math.max(2, Math.round((CHECK_COUNT * lenShort) / total));
  const longCount = CHECK_COUNT - shortCount;
  for (let i = 0; i < shortCount; i++) {
    const t = i / Math.max(1, shortCount - 1);
    out[i * 3] = CHECK_A[0] + (CHECK_B[0] - CHECK_A[0]) * t;
    out[i * 3 + 1] = CHECK_A[1] + (CHECK_B[1] - CHECK_A[1]) * t;
    out[i * 3 + 2] = 0.05;
  }
  for (let i = 0; i < longCount; i++) {
    const t = i / Math.max(1, longCount - 1);
    const j = shortCount + i;
    out[j * 3] = CHECK_B[0] + (CHECK_C[0] - CHECK_B[0]) * t;
    out[j * 3 + 1] = CHECK_B[1] + (CHECK_C[1] - CHECK_B[1]) * t;
    out[j * 3 + 2] = 0.05;
  }
  return out;
}

export default function DNAHelix({ phase = 'drift' }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;

    const width = mount.clientWidth || 1;
    const height = mount.clientHeight || 1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const sphereTargets = buildSphereTargets();
    const discTargets = buildDiscTargets();
    const checkTargets = buildCheckmarkTargets();

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const r = 2.3 + Math.random() * 0.6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      velocities[i * 3] = (Math.random() - 0.5) * 0.005;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.005;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.005;
      colors[i * 3] = 1;
      colors[i * 3 + 1] = 1;
      colors[i * 3 + 2] = 1;
    }

    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const spriteCanvas = document.createElement('canvas');
    spriteCanvas.width = 64;
    spriteCanvas.height = 64;
    const sctx = spriteCanvas.getContext('2d')!;
    const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 64, 64);
    const sprite = new THREE.CanvasTexture(spriteCanvas);

    const particleMat = new THREE.PointsMaterial({
      size: 0.16,
      map: sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    let rafId: number;
    let driftWeight = 1;
    let spinnerWeight = 0;
    let checkWeight = 0;
    /* Rotating light direction for the spinner — sweeps around the
       sphere, makes a "lit hemisphere" gradient that the eye reads
       as rotation. */
    let lightAngle = 0;
    /* Sphere breath modulates the per-particle target radius so the
       ball expands and contracts slowly, alive-feeling. */
    let breathPhase = 0;
    let lastTime = performance.now();

    const animate = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;

      const p = phaseRef.current;
      const wantDrift = p === 'drift' ? 1 : 0;
      const wantSpinner = p === 'spinner' ? 1 : 0;
      const wantCheck = p === 'checkmark' ? 1 : 0;

      driftWeight += (wantDrift - driftWeight) * Math.min(dt * 1.6, 1);
      spinnerWeight += (wantSpinner - spinnerWeight) * Math.min(dt * 5.0, 1);
      checkWeight += (wantCheck - checkWeight) * Math.min(dt * 5.0, 1);

      if (p === 'spinner') {
        lightAngle += dt * LIGHT_SPIN_HZ * Math.PI * 2;
        if (lightAngle > Math.PI * 2) lightAngle -= Math.PI * 2;
        breathPhase += dt;
      }

      /* Breath: slow ±3% radius modulation around the sphere. */
      const breathScale =
        1 + Math.sin(breathPhase * 1.2 * Math.PI * 2) * 0.03 * spinnerWeight;

      /* Light direction unit vector — rotates around the Y axis with
         a slight upward tilt so the lit hemisphere doesn't sit only
         on the equator. */
      const lightX = Math.cos(lightAngle) * Math.cos(0.3);
      const lightY = Math.sin(0.3);
      const lightZ = Math.sin(lightAngle) * Math.cos(0.3);

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const ix = i * 3;
        const isCheck = i >= DISC_COUNT;
        const checkIdx = (i - DISC_COUNT) * 3;

        if (driftWeight > 0.01) {
          positions[ix] += velocities[ix] * driftWeight;
          positions[ix + 1] += velocities[ix + 1] * driftWeight;
          positions[ix + 2] += velocities[ix + 2] * driftWeight;
          const r = Math.sqrt(
            positions[ix] ** 2 + positions[ix + 1] ** 2 + positions[ix + 2] ** 2,
          ) || 0.01;
          const pull = (2.6 - r) * 0.012 * driftWeight;
          positions[ix] += (positions[ix] / r) * pull;
          positions[ix + 1] += (positions[ix + 1] / r) * pull;
          positions[ix + 2] += (positions[ix + 2] / r) * pull;
        }

        if (spinnerWeight > 0.01) {
          const k = Math.min(dt * 6.5 * spinnerWeight, 1);
          const tx = sphereTargets[ix] * breathScale;
          const ty = sphereTargets[ix + 1] * breathScale;
          const tz = sphereTargets[ix + 2] * breathScale;
          positions[ix] += (tx - positions[ix]) * k;
          positions[ix + 1] += (ty - positions[ix + 1]) * k;
          positions[ix + 2] += (tz - positions[ix + 2]) * k;
        }

        if (checkWeight > 0.01) {
          const k = Math.min(dt * 7.5 * checkWeight, 1);
          const targets = isCheck ? checkTargets : discTargets;
          const ti = isCheck ? checkIdx : i * 3;
          positions[ix] += (targets[ti] - positions[ix]) * k;
          positions[ix + 1] += (targets[ti + 1] - positions[ix + 1]) * k;
          positions[ix + 2] += (targets[ti + 2] - positions[ix + 2]) * k;
        }
      }
      particleGeo.attributes.position.needsUpdate = true;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const ix = i * 3;
        const isCheck = i >= DISC_COUNT;
        let r = 1;
        let g = 1;
        let b = 1;

        if (spinnerWeight > 0.01) {
          /* Lit-hemisphere shading — dot product of the particle's
             unit position with the rotating light direction. Lit
             side bright, far side dim. Baseline 0.20 so the dim half
             still reads as "there". */
          const px = positions[ix];
          const py = positions[ix + 1];
          const pz = positions[ix + 2];
          const mag = Math.sqrt(px * px + py * py + pz * pz) || 1;
          const dot = (px * lightX + py * lightY + pz * lightZ) / mag;
          /* Soft falloff: 0.20 baseline + up to +0.80 on the lit pole. */
          const lit = 0.20 + 0.80 * Math.max(0, dot);
          r = 1 - spinnerWeight * (1 - lit);
          g = 1 - spinnerWeight * (1 - lit);
          b = 1 - spinnerWeight * (1 - lit);
        }

        if (checkWeight > 0.01 && !isCheck) {
          const cw = checkWeight;
          r = r * (1 - cw) + SUCCESS_R * cw;
          g = g * (1 - cw) + SUCCESS_G * cw;
          b = b * (1 - cw) + SUCCESS_B * cw;
        }

        colors[ix] = r;
        colors[ix + 1] = g;
        colors[ix + 2] = b;
      }
      particleGeo.attributes.color.needsUpdate = true;

      if (driftWeight > 0.05) {
        scene.rotation.y += dt * 0.1 * driftWeight;
        scene.rotation.x = Math.sin(time * 0.0003) * 0.18 * driftWeight;
      } else {
        scene.rotation.y *= 1 - Math.min(dt * 3, 1);
        scene.rotation.x *= 1 - Math.min(dt * 3, 1);
      }

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    const handleResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      sprite.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
      aria-hidden
    />
  );
}
