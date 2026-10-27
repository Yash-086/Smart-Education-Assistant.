import { useEffect } from 'react'

const revealTargets = [
  '.page-container > section',
  '.page-container > header',
  '.editorial-section-heading',
  '.intelligence-overview > article',
  '.dashboard-insights-grid > article',
  '.feature-story-card',
  '.recent-note-list > *',
  '.academic-panel',
  '.planner-summary',
  '.planner-list-section',
  '.recommendation-card',
  '.task-card',
  '.study-output',
].join(',')

const tiltTargets = '.intelligence-overview article, .week-card, .next-card, .academic-panel, .recommendation-card, .task-card, .recent-note, .feature-story-card'

export default function ExperienceEffects() {
  useEffect(() => {
    const app = document.querySelector<HTMLElement>('.app-shell')
    const main = document.querySelector<HTMLElement>('.main-content')
    const halo = app?.querySelector<HTMLElement>('.pointer-halo')
    const progress = app?.querySelector<HTMLElement>('.scroll-progress-fill')
    if (!app || !main) return

    const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const finePointer = typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const canReveal = !reducedMotion && 'IntersectionObserver' in window
    const requestFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16) as unknown as number
    const cancelFrame = typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : (frameId: number) => window.clearTimeout(frameId)

    let revealObserver: IntersectionObserver | null = null
    if (canReveal) {
      app.classList.add('motion-ready')
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-reveal-visible', 'true')
            revealObserver?.unobserve(entry.target)
          }
        })
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })

      const observeReveals = () => {
        main.querySelectorAll<HTMLElement>(revealTargets).forEach((element, index) => {
          if (!element.hasAttribute('data-reveal')) {
            element.setAttribute('data-reveal', 'true')
            element.style.setProperty('--reveal-delay', `${Math.min(index % 4, 3) * 75}ms`)
          }
          if (!element.hasAttribute('data-reveal-visible')) revealObserver?.observe(element)
        })
      }
      observeReveals()
      const pageObserver = new MutationObserver(observeReveals)
      pageObserver.observe(main, { childList: true, subtree: true })
      window.setTimeout(observeReveals, 0)

      const mutationCleanup = () => pageObserver.disconnect()
      app.addEventListener('experience-cleanup', mutationCleanup, { once: true })
    }

    let pointerFrame = 0
    let scrollFrame = 0
    let cursorX = 0
    let cursorY = 0
    let cursorButtons = 0
    let activeTilt: HTMLElement | null = null
    let activeMagnet: HTMLElement | null = null
    let lastTrailAt = 0
    let lastTrailX = 0
    let lastTrailY = 0

    const resetTilt = () => {
      if (!activeTilt) return
      activeTilt.style.removeProperty('--tilt-x')
      activeTilt.style.removeProperty('--tilt-y')
      activeTilt.style.removeProperty('--light-x')
      activeTilt.style.removeProperty('--light-y')
      activeTilt.classList.remove('is-pointer-tilted')
      activeTilt = null
    }
    const resetMagnet = () => {
      if (!activeMagnet) return
      activeMagnet.style.removeProperty('--magnet-x')
      activeMagnet.style.removeProperty('--magnet-y')
      activeMagnet.classList.remove('is-magnetic')
      activeMagnet = null
    }

    const updatePointer = () => {
      pointerFrame = 0
      if (halo) halo.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0)`
      const bounds = main.getBoundingClientRect()
      app.style.setProperty('--ambient-x', `${Math.max(0, Math.min(100, ((cursorX - bounds.left) / Math.max(1, bounds.width)) * 100))}%`)
      app.style.setProperty('--ambient-y', `${Math.max(0, Math.min(100, ((cursorY - bounds.top) / Math.max(1, bounds.height)) * 100))}%`)

      const target = document.elementFromPoint(cursorX, cursorY)
      const tilt = cursorButtons === 0 && target instanceof Element && !target.closest('input, textarea, select, button, [contenteditable="true"]')
        ? target.closest<HTMLElement>(tiltTargets)
        : null
      if (tilt !== activeTilt) resetTilt()
      if (tilt) {
        activeTilt = tilt
        const rect = tilt.getBoundingClientRect()
        const x = (cursorX - rect.left) / Math.max(1, rect.width) - 0.5
        const y = (cursorY - rect.top) / Math.max(1, rect.height) - 0.5
        activeTilt.style.setProperty('--tilt-x', `${(y * -3.2).toFixed(2)}deg`)
        activeTilt.style.setProperty('--tilt-y', `${(x * 3.2).toFixed(2)}deg`)
        activeTilt.style.setProperty('--light-x', `${((x + 0.5) * 100).toFixed(1)}%`)
        activeTilt.style.setProperty('--light-y', `${((y + 0.5) * 100).toFixed(1)}%`)
        activeTilt.classList.add('is-pointer-tilted')
      }

      const core = main.querySelector<HTMLElement>('.dashboard-orb')
      if (core) {
        const rect = core.getBoundingClientRect()
        const overCore = cursorX >= rect.left && cursorX <= rect.right && cursorY >= rect.top && cursorY <= rect.bottom
        core.style.setProperty('--core-pointer-x', `${overCore ? (((cursorX - rect.left) / Math.max(1, rect.width)) - 0.5) * 12 : 0}px`)
        core.style.setProperty('--core-pointer-y', `${overCore ? (((cursorY - rect.top) / Math.max(1, rect.height)) - 0.5) * 12 : 0}px`)
      } else {
        app.style.setProperty('--core-pointer-x', '0px')
        app.style.setProperty('--core-pointer-y', '0px')
      }

      const magnet = cursorButtons === 0 && target instanceof Element ? target.closest<HTMLElement>('.primary-button, .secondary-button, .theme-toggle, .icon-button') : null
      if (magnet !== activeMagnet) resetMagnet()
      if (magnet && !magnet.hasAttribute('disabled')) {
        activeMagnet = magnet
        const rect = magnet.getBoundingClientRect()
        magnet.style.setProperty('--magnet-x', `${(((cursorX - rect.left) / Math.max(1, rect.width)) - 0.5) * 5}px`)
        magnet.style.setProperty('--magnet-y', `${(((cursorY - rect.top) / Math.max(1, rect.height)) - 0.5) * 5}px`)
        magnet.classList.add('is-magnetic')
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      cursorX = event.clientX
      cursorY = event.clientY
      cursorButtons = event.buttons
      if (!pointerFrame) pointerFrame = requestFrame(updatePointer)
      const now = performance.now()
      const distance = Math.hypot(cursorX - lastTrailX, cursorY - lastTrailY)
      if (finePointer && !reducedMotion && distance > 46 && now - lastTrailAt > 55) {
        lastTrailX = cursorX
        lastTrailY = cursorY
        lastTrailAt = now
        const particle = document.createElement('span')
        particle.className = 'pointer-trail-dot'
        particle.setAttribute('aria-hidden', 'true')
        particle.style.left = `${cursorX}px`
        particle.style.top = `${cursorY}px`
        app.appendChild(particle)
        particle.addEventListener('animationend', () => particle.remove(), { once: true })
      }
    }
    const onPointerLeave = () => {
      if (halo) halo.style.opacity = '0'
      resetTilt()
      resetMagnet()
      app.style.setProperty('--ambient-x', '76%')
      app.style.setProperty('--ambient-y', '8%')
    }
    const onPointerEnter = () => { if (halo && finePointer) halo.style.opacity = '1' }
    const onPointerDown = (event: PointerEvent) => {
      if (!finePointer || event.button !== 0) return
      const target = event.target
      const button = target instanceof Element ? target.closest<HTMLElement>('button.primary-button, button.secondary-button, button.icon-button, button.theme-toggle') : null
      if (!button || button.hasAttribute('disabled')) return
      const rect = button.getBoundingClientRect()
      const ripple = document.createElement('span')
      ripple.className = 'pointer-ripple'
      ripple.setAttribute('aria-hidden', 'true')
      ripple.style.left = `${event.clientX - rect.left}px`
      ripple.style.top = `${event.clientY - rect.top}px`
      button.appendChild(ripple)
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true })
    }

    const updateScroll = () => {
      if (!scrollFrame) scrollFrame = requestFrame(() => {
        scrollFrame = 0
        const scrollable = document.documentElement.scrollHeight - window.innerHeight
        const value = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0
        if (progress) progress.style.transform = `scaleX(${value})`
        const orb = main.querySelector<HTMLElement>('.dashboard-orb')
        if (orb) orb.style.setProperty('--scroll-shift', `${Math.min(56, window.scrollY * 0.045)}px`)
      })
    }

    if (finePointer && !reducedMotion) {
      document.addEventListener('pointermove', onPointerMove, { passive: true })
      document.addEventListener('pointerdown', onPointerDown, { passive: true })
      app.addEventListener('pointerenter', onPointerEnter)
      app.addEventListener('pointerleave', onPointerLeave)
    }
    window.addEventListener('scroll', updateScroll, { passive: true })
    window.addEventListener('resize', updateScroll, { passive: true })
    updateScroll()

    return () => {
      app.dispatchEvent(new Event('experience-cleanup'))
      revealObserver?.disconnect()
      if (pointerFrame) cancelFrame(pointerFrame)
      if (scrollFrame) cancelFrame(scrollFrame)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerdown', onPointerDown)
      app.removeEventListener('pointerenter', onPointerEnter)
      app.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('scroll', updateScroll)
      window.removeEventListener('resize', updateScroll)
      resetTilt()
      resetMagnet()
    }
  }, [])

  return <div className="pointer-halo" aria-hidden="true" />
}
