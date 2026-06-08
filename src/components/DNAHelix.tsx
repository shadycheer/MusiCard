'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type DNAHelixPhase = 'drift' | 'spinner' | 'checkmark';

type Props = {
  /** drift = free particles in a spherical shell (idle hero).
   *  spinner = particles collapse to a flat dense ring with a
   *  travelling brightness wave (loading indicator).
   *  checkmark = particles morph into a filled green disc with a
   *  bright ✓ stroke on top — sized + colored to match the SVG badge
   *  that cross-fades in over the helix center. */
  phase?: DNAHelixPhase;
};

/* Particle budget split.
   200 fill the disc (sunflower-spiral distribution → visually even).
   50 form the ✓ stroke. Together: a 44px-diameter green badge with
   a bright check at the same screen position as the 48px SVG badge,
   so the cross-fade reads as "particles solidify" rather than a swap. */
const DISC_COUNT = 200;
const CHECK_COUNT = 50;
const PARTICLE_COUNT = DISC_COUNT + CHECK_COUNT;

const SUCCESS_R = 30 / 255;
const SUCCESS_G = 215 / 255;
const SUCCESS_B = 96 / 255;

const SPINNER_RADIUS = 1.45;
const SPIN_SPEED = 1.75; // revolutions per second of the brightness head

/* Disc radius in scene units = SVG circle r=11 inside 24 viewBox,
   rendered at 48px (badge), projected back through the camera onto
   the 180px helix stage. Matches the SVG badge size 1:1. */
const DISC_RADIUS = 0.81;

/* ✓ stroke path. SVG: M7.2 12.2 L10.6 15.6 L16.8 9.2 in viewBox 24.
   Translated to origin and negated Y (SVG Y-down → scene Y-up), then
   scaled by (48px / 24 / 27.16 px-per-unit) = 0.0736 scene/svg-units. */
const CHECK_A: [number, number] = [-0.353, -0.015];
const CHECK_B: [number, number] = [-0.103, -0.265];
const CHECK_C: [number, number] = [0.354, 0.206];

/* Golden-angle sunflower distribution → particles fill a disc with
   uniform area density. Looks like a smooth disc at this count. */
function buildDiscTargets(): Float32Array {
  const out = new Float32Array(DISC_COUNT * 3);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < DISC_COUNT; i++) {
    // sqrt(t) so density is even across radius, not clustered at center
    const r = Math.sqrt((i + 0.5) / DISC_COUNT) * DISC_RADIUS;
    const a = i * goldenAngle;
    out[i * 3] = r * Math.cos(a);
    out[i * 3 + 1] = r * Math.sin(a);
    out[i * 3 + 2] = 0;
  }
  return out;
}

/* ✓ stroke targets — split between short and long segments
   proportionally to arc length so spacing is even along the path. */
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
    // z slightly forward so check sits cleanly atop disc particles
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

/* Spinner targets — every particle (disc + check) sits on a single
   ring at index-based angles. With 250 particles around radius 1.45,
   the ring reads as a dense neon torus. Radius is recomputed per
   frame in the animation loop to add a breathing pulse + per-particle
   vibration, so this just supplies the base angular layout. */
function buildRingAngles(): Float32Array {
  const out = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    out[i] = (i / PARTICLE_COUNT) * Math.PI * 2;
  }
  return out;
}

/* Per-particle phase offsets for the micro-vibration so each particle
   jitters with its own rhythm — sums into a "music-reactive" feel
   without actual audio analysis. */
function buildJitterPhases(): Float32Array {
  const out = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    out[i] = Math.random() * Math.PI * 2;
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
    const ringAngles = buildRingAngles();
    const jitterPhases = buildJitterPhases();
    const discTargets = buildDiscTargets();
    const checkTargets = buildCheckmarkTargets();
    /* Reusable per-frame ring target buffer — populated each tick with
       the breathing radius + per-particle vibration so the spinner
       feels like it's pulsing to a beat. */
    const ringFrame = new Float32Array(PARTICLE_COUNT * 3);

    /* Drift init — all particles random in a spherical shell. The
       disc/check distinction only matters once we leave drift. */
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

    /* AdditiveBlending — disc particles tinted green accumulate into
       a solid green disc; bright-white check particles on top read as
       a glowing check. With 200 disc particles at sprite-size 0.12,
       neighbours overlap heavily and the disc reads as filled. */
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
    let headAngle = 0;
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
        headAngle += dt * SPIN_SPEED * Math.PI * 2;
        if (headAngle > Math.PI * 2) headAngle -= Math.PI * 2;
      }

      /* Music-reactive ring radius — composed sinusoids:
         - 1.4 Hz slow breath (±0.07): a "kick drum" pulse
         - 3.6 Hz quick swell (±0.03): the "hi-hat" overlay
         The two together feel like rhythm without needing audio. */
      const tSec = time * 0.001;
      const breath = Math.sin(tSec * 1.4 * Math.PI * 2) * 0.07;
      const swell = Math.sin(tSec * 3.6 * Math.PI * 2) * 0.03;
      const pulseRadius = SPINNER_RADIUS + (breath + swell) * spinnerWeight;
      /* Refresh the ring target buffer every frame: base ring + per-
         particle radial jitter so the dense ring shimmers like it's
         vibrating. Jitter scales with spinnerWeight so checkmark
         morph isn't polluted. */
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const a = ringAngles[i];
        const jitter =
          Math.sin(tSec * 5.5 + jitterPhases[i]) * 0.035 * spinnerWeight;
        const r = pulseRadius + jitter;
        ringFrame[i * 3] = Math.cos(a) * r;
        ringFrame[i * 3 + 1] = Math.sin(a) * r;
        ringFrame[i * 3 + 2] = 0;
      }

      /* Position update — each particle has its own target per phase.
         Disc particles (indices 0..199) go to disc fill in checkmark
         phase; check particles (200..249) go to the ✓ stroke. */
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
          positions[ix] += (ringFrame[ix] - positions[ix]) * k;
          positions[ix + 1] += (ringFrame[ix + 1] - positions[ix + 1]) * k;
          positions[ix + 2] += (ringFrame[ix + 2] - positions[ix + 2]) * k;
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

      /* Color update — drift/spinner: all particles white with spinner's
         brightness wave. Checkmark: disc particles tint green (form
         the SVG's green fill), check particles stay bright white (form
         the highlight check stroke on top of the disc). */
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const ix = i * 3;
        const isCheck = i >= DISC_COUNT;
        let r = 1;
        let g = 1;
        let b = 1;

        if (spinnerWeight > 0.01) {
          const particleAngle = (i / PARTICLE_COUNT) * Math.PI * 2;
          let delta = particleAngle - headAngle;
          while (delta < -Math.PI) delta += Math.PI * 2;
          while (delta > Math.PI) delta -= Math.PI * 2;
          const sigma = 0.42;
          const brightness = Math.exp(-((delta / sigma) ** 2));
          const wave = 0.10 + 0.90 * brightness;
          r = 1 - spinnerWeight * (1 - wave);
          g = 1 - spinnerWeight * (1 - wave);
          b = 1 - spinnerWeight * (1 - wave);
        }

        if (checkWeight > 0.01 && !isCheck) {
          /* Disc particles tint white → SUCCESS_GREEN. */
          const cw = checkWeight;
          r = r * (1 - cw) + SUCCESS_R * cw;
          g = g * (1 - cw) + SUCCESS_G * cw;
          b = b * (1 - cw) + SUCCESS_B * cw;
        }
        /* Check particles stay white (r=g=b=1 from base) so they pop
           bright against the green disc under additive blending. */

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
