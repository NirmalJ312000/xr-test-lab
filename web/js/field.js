/**
 * THE FIELD — XR Test Lab's signature background interaction.
 *
 * A sparse lattice of short vector segments sits behind the interface at very
 * low opacity. As the cursor moves, nearby segments refract around it — the
 * lattice bends the way light bends through a lens — and settles back to rest
 * when the pointer stops. It reads as moving a lens through a spatial field,
 * not as particles or a glowing blob.
 *
 * Performance is the governing constraint:
 *   - one canvas, 2D, no shadows, no per-segment gradients
 *   - a single strokeStyle and one path batch per frame
 *   - backing store capped at 1.5x DPR (the layer is deliberately faint)
 *   - the rAF loop STOPS COMPLETELY once the field is at rest, so an idle
 *     screen costs nothing
 *
 * Disabled outright for reduced-motion and for coarse/touch pointers.
 */

const SPACING = 58;      // px between lattice nodes
const RADIUS = 230;      // px of cursor influence
const SEG = 9;           // half-length of each segment at rest
const EASE = 0.12;       // how quickly strength approaches its target
const IDLE_MS = 1100;    // pointer stillness before the field relaxes

export function initField(canvas) {
  if (!canvas) return () => {};

  const fine = window.matchMedia?.('(hover:hover) and (pointer:fine)').matches ?? false;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (!fine || reduced) return () => {};

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return () => {};

  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  let w = 0;
  let h = 0;
  let cols = 0;
  let rows = 0;

  // Pointer state, in CSS pixels.
  let px = -9999;
  let py = -9999;
  let lastMove = 0;

  // Global influence, eased 0..1. When it reaches 0 with an idle pointer the
  // loop halts until the next pointermove.
  let strength = 0;
  let target = 0;
  let running = false;
  let raf = 0;

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(w / SPACING) + 1;
    rows = Math.ceil(h / SPACING) + 1;
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);

    // One path, one stroke: the whole lattice is a single draw call.
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(124,140,220,${0.055 + strength * 0.06})`;
    ctx.beginPath();

    const r2 = RADIUS * RADIUS;

    for (let iy = 0; iy < rows; iy++) {
      const y = iy * SPACING;
      for (let ix = 0; ix < cols; ix++) {
        const x = ix * SPACING;

        // At rest every segment lies flat; near the cursor it rotates to run
        // tangentially around it and stretches slightly, like a field line.
        let angle = 0;
        let len = SEG;

        if (strength > 0.001) {
          const dx = x - px;
          const dy = y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < r2) {
            const d = Math.sqrt(d2) || 0.0001;
            // Smooth falloff: 1 at the centre, 0 at the radius.
            const f = (1 - d / RADIUS) ** 2 * strength;
            // Tangent to the circle centred on the cursor.
            angle = Math.atan2(dy, dx) + Math.PI / 2;
            len = SEG * (1 + f * 1.35);
            angle *= f;
          }
        }

        const cos = Math.cos(angle) * len;
        const sin = Math.sin(angle) * len;
        ctx.moveTo(x - cos, y - sin);
        ctx.lineTo(x + cos, y + sin);
      }
    }
    ctx.stroke();
  }

  function frame() {
    const idle = performance.now() - lastMove > IDLE_MS;
    target = idle ? 0 : 1;
    strength += (target - strength) * EASE;

    draw();

    // Settle and stop: an idle field costs zero CPU.
    if (idle && strength < 0.004) {
      strength = 0;
      draw();
      running = false;
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }

  function onMove(e) {
    px = e.clientX;
    py = e.clientY;
    lastMove = performance.now();
    start();
  }

  function onLeave() {
    // Let the normal idle path relax the field.
    lastMove = 0;
    start();
  }

  let resizeTimer;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  }

  resize();
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerleave', onLeave, { passive: true });
  window.addEventListener('resize', onResize);

  return function destroy() {
    cancelAnimationFrame(raf);
    clearTimeout(resizeTimer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('resize', onResize);
  };
}

export default initField;
