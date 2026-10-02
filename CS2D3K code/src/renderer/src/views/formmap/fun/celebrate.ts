// Confetti burst on a transient full-window <canvas>. Fired when a decision lands (done / decided / accepted).
import { resolveColor } from '@/theme/theme'

const DURATION = 1200
const COUNT = 90

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  w: number
  h: number
  color: string
  round: boolean
}

let active = 0

function palette(): string[] {
  const vars = ['--interactive-accent', '--color-green', '--color-yellow', '--color-orange', '--color-pink', '--color-cyan', '--color-purple', '--color-blue']
  return vars.map((v) => resolveColor(`var(${v})`))
}

/** Confetti burst from a screen point (defaults to the window center). No-op under prefers-reduced-motion. */
export function celebrate(clientX?: number, clientY?: number): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  // a few overlapping bursts are fun; dozens are not
  if (active >= 3) return
  const w = window.innerWidth
  const h = window.innerHeight
  const ox = clientX ?? w / 2
  const oy = clientY ?? h / 2.5
  const dpr = window.devicePixelRatio || 1

  const canvas = document.createElement('canvas')
  canvas.className = 'fm-confetti'
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: `${w}px`, height: `${h}px`, pointerEvents: 'none', zIndex: '9999' })
  canvas.setAttribute('aria-hidden', 'true')
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.remove()
    return
  }
  ctx.scale(dpr, dpr)
  active++

  const colors = palette()
  const pieces: Piece[] = Array.from({ length: COUNT }, () => {
    // mostly upward fan, a little sideways spray
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1
    const speed = 5 + Math.random() * 9
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      w: 5 + Math.random() * 5,
      h: 3 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      round: Math.random() < 0.25
    }
  })

  const start = performance.now()
  let last = start
  const frame = (now: number): void => {
    const t = now - start
    // normalise to ~60fps steps so slow frames don't slow the burst
    const k = Math.min(3, (now - last) / 16.67)
    last = now
    ctx.clearRect(0, 0, w, h)
    const fade = t > DURATION * 0.6 ? Math.max(0, 1 - (t - DURATION * 0.6) / (DURATION * 0.4)) : 1
    ctx.globalAlpha = fade
    for (const p of pieces) {
      p.vy += 0.32 * k
      p.vx *= Math.pow(0.985, k)
      p.vy *= Math.pow(0.985, k)
      p.x += p.vx * k
      p.y += p.vy * k
      p.rot += p.vr * k
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      if (p.round) {
        ctx.beginPath()
        ctx.arc(0, 0, p.h / 1.4, 0, Math.PI * 2)
        ctx.fill()
      } else {
        // flutter: squash on one axis
        ctx.scale(1, Math.cos(p.rot * 3))
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      }
      ctx.restore()
    }
    if (t < DURATION) requestAnimationFrame(frame)
    else {
      canvas.remove()
      active--
    }
  }
  requestAnimationFrame(frame)
}

/** True when changing `key` to `value` on a card of `kind` is a win worth celebrating. */
export function isWin(kind: string, key: string, value: unknown): boolean {
  if (key !== 'status') return false
  return (kind === 'feature' && value === 'done') || (kind === 'question' && value === 'decided') || (kind === 'approach' && value === 'accepted')
}
