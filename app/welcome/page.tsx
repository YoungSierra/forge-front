'use client'

// Página de bienvenida / presentación pública de Forge.
// Se muestra antes del login: hero + bondades + cómo funciona + CTA "Sign in".
// Mismo lenguaje visual que Forge (tokens ember/dark, Forgy, Inter/JetBrains).

import { useEffect, useRef } from 'react'
import Link from 'next/link'

export default function WelcomePage() {
  const heroRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Forzar dark (como el login) para el look de presentación
  useEffect(() => {
    const html = document.documentElement
    const prev = html.getAttribute('data-theme')
    html.setAttribute('data-theme', 'dark')
    return () => {
      if (prev) html.setAttribute('data-theme', prev)
      else html.removeAttribute('data-theme')
    }
  }, [])

  // Red de partículas del hero (colores del brand)
  useEffect(() => {
    const cv = canvasRef.current, host = heroRef.current
    if (!cv || !host) return
    const cx = cv.getContext('2d')
    if (!cx) return
    const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const COLORS = ['#ff8a3d', '#a78bfa', '#5fb8ea', '#4fd2c2', '#9ee36b', '#f5c451']
    let pts: { x: number; y: number; vx: number; vy: number; c: string }[] = []
    let raf = 0

    function build() {
      const r = host!.getBoundingClientRect()
      const n = Math.round(Math.min(60, r.width / 24))
      pts = Array.from({ length: n }, (_, i) => ({
        x: Math.random() * r.width, y: Math.random() * r.height,
        vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28,
        c: COLORS[i % COLORS.length],
      }))
    }
    function size() {
      const r = host!.getBoundingClientRect()
      const d = Math.min(window.devicePixelRatio || 1, 2)
      cv!.width = r.width * d; cv!.height = r.height * d
      cx!.setTransform(d, 0, 0, d, 0, 0)
      build()
    }
    function frame() {
      const r = host!.getBoundingClientRect()
      cx!.clearRect(0, 0, r.width, r.height)
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy
        if (p.x < 0 || p.x > r.width) p.vx *= -1
        if (p.y < 0 || p.y > r.height) p.vy *= -1
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], b = pts[j]
          const dist = Math.hypot(a.x - b.x, a.y - b.y)
          if (dist < 130) {
            cx!.globalAlpha = (1 - dist / 130) * 0.2
            cx!.strokeStyle = a.c; cx!.lineWidth = 1
            cx!.beginPath(); cx!.moveTo(a.x, a.y); cx!.lineTo(b.x, b.y); cx!.stroke()
          }
        }
      }
      for (const p of pts) {
        cx!.globalAlpha = 0.9; cx!.fillStyle = p.c
        cx!.shadowColor = p.c; cx!.shadowBlur = 10
        cx!.beginPath(); cx!.arc(p.x, p.y, 1.7, 0, 7); cx!.fill()
      }
      cx!.shadowBlur = 0; cx!.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }
    size()
    if (RM) { frame(); cancelAnimationFrame(raf) } else frame()
    const onResize = () => { cancelAnimationFrame(raf); size(); if (!RM) frame() }
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize) }
  }, [])

  const BENEFITS = [
    { k: '◆', c: 'var(--cat-design)', kow: 'Visual pipeline', t: 'A canvas of AI nodes', p: 'Wire concept → design → docs → assets and watch each step run. No black box — every stage is inspectable and re-runnable.' },
    { k: '▤', c: 'var(--ember)', kow: 'Documentation-first', t: 'GDDs & TDDs engineers accept', p: 'Forge assembles consistent design and technical docs from the same source — not hand-wavy prose that drifts between documents.' },
    { k: '✦', c: 'var(--cat-asset)', kow: 'Multi-model AI', t: 'The right model per task', p: 'Orchestrates multiple providers — reasoning, vision, image, 3D — picking the best engine for each job instead of one-size-fits-all.' },
    { k: '▦', c: 'var(--state-running)', kow: '2D & 3D assets', t: 'Art & models, in the flow', p: 'Produce concept art, cutouts and 3D models inside the same pipeline — most of it running natively, referenced from a moodboard.' },
    { k: '▧', c: 'var(--state-warning)', kow: 'Built for studios', t: 'Teams, roles & credits', p: 'Organizations, member roles, prepaid credits and usage control. Onboard a whole studio, keep spend under one roof.' },
    { k: '⧉', c: 'var(--state-success)', kow: 'Reusable blueprints', t: 'Capture a pipeline once', p: 'Save a proven sequence of nodes as a blueprint and reuse it across projects — start every prototype from a running head start.' },
  ]

  const STEPS = [
    { n: '01', t: 'Describe the concept', p: 'Drop in your game idea, pillars and references. Forge seeds the pipeline from it.' },
    { n: '02', t: 'Run the pipeline', p: 'AI nodes generate concept, GDD, TDD and assets — step by step, each one reviewable.' },
    { n: '03', t: 'Refine & ship', p: 'Iterate on any node and carry it past the prototype to a production-ready vertical slice your team can build the full game from.' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', color: 'var(--text-1)', fontFamily: 'var(--font-sans)' }}>
      <style>{`
        .wl-cta{display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 22px;border-radius:9px;
          font-size:14px;font-weight:600;text-decoration:none;cursor:pointer;transition:filter .15s,transform .15s,border-color .15s,color .15s}
        .wl-cta.primary{background:var(--action);color:var(--action-fg);box-shadow:0 6px 22px rgba(255,138,61,.32)}
        .wl-cta.primary:hover{filter:brightness(1.06);transform:translateY(-1px)}
        .wl-cta.ghost{background:transparent;color:var(--text-1);border:1px solid var(--line-2)}
        .wl-cta.ghost:hover{color:var(--text-0);border-color:var(--text-3)}
        .wl-nav-btn{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 16px;border-radius:8px;
          background:var(--action);color:var(--action-fg);font-size:13px;font-weight:600;text-decoration:none;transition:filter .15s}
        .wl-nav-btn:hover{filter:brightness(1.06)}
        .wl-card{position:relative;border-radius:16px;padding:22px;background:var(--bg-2);border:1px solid var(--line-2);
          transition:transform .2s,border-color .2s,box-shadow .2s}
        .wl-card:hover{transform:translateY(-4px);border-color:color-mix(in srgb,var(--ck) 45%,var(--line-2));
          box-shadow:0 20px 44px rgba(0,0,0,.45),0 0 34px color-mix(in srgb,var(--ck) 16%,transparent)}
        .wl-ico{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:15px;
          background:color-mix(in srgb,var(--ck) 15%,var(--bg-0));color:var(--ck);
          box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ck) 30%,transparent),0 0 24px color-mix(in srgb,var(--ck) 22%,transparent)}
        .wl-grad{background:linear-gradient(105deg,var(--ember) 0%,var(--accent-violet) 50%,var(--type-3d) 100%);
          -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
        @keyframes wl-pulse{0%,100%{opacity:1}50%{opacity:.35}}
        .wl-h1{text-wrap:balance}
        .wl-balance{text-wrap:balance}
        .wl-band{position:relative;overflow:hidden;border-radius:22px;background:linear-gradient(160deg,var(--bg-2),var(--bg-1))}
        .wl-band::before{content:"";position:absolute;inset:0;border-radius:22px;padding:1px;pointer-events:none;
          background:linear-gradient(120deg,color-mix(in srgb,var(--ember) 62%,transparent),transparent 42%,color-mix(in srgb,var(--accent-violet) 52%,transparent));
          -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
        .wl-dots{position:absolute;inset:0;pointer-events:none;opacity:.6;
          background-image:radial-gradient(circle, var(--line-2) 1px, transparent 1px);background-size:22px 22px;
          -webkit-mask-image:radial-gradient(ellipse 72% 72% at 50% 36%, #000 16%, transparent 76%);
          mask-image:radial-gradient(ellipse 72% 72% at 50% 36%, #000 16%, transparent 76%)}
        .wl-tag{font-family:var(--font-mono);font-size:11px;color:var(--text-3);padding:5px 11px;border-radius:20px;border:1px solid var(--line-2);background:var(--bg-2)}
        @keyframes wl-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        .wl-bob{animation:wl-bob 4.5s ease-in-out infinite}
        @media (prefers-reduced-motion:reduce){.wl-bob{animation:none}}
        .wl-hero-grid{display:grid;grid-template-columns:minmax(0,0.9fr) minmax(0,1.25fr);gap:clamp(20px,3.5vw,48px);align-items:center}
        .wl-frame{position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--line-2);background:var(--bg-1);
          box-shadow:0 36px 84px rgba(0,0,0,.62),0 0 80px rgba(255,138,61,.14),0 0 130px rgba(167,139,250,.08);
          transform:perspective(1300px) rotateY(-5deg) rotateX(2deg);transition:transform .45s ease}
        .wl-frame::before{content:"";position:absolute;inset:0;border-radius:14px;padding:1px;pointer-events:none;z-index:4;
          background:linear-gradient(130deg,color-mix(in srgb,var(--ember) 62%,transparent),transparent 46%,color-mix(in srgb,var(--accent-violet) 50%,transparent));
          -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
        .wl-frame::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:3;
          background:linear-gradient(150deg,rgba(255,255,255,.06),transparent 34%)}
        .wl-frame:hover{transform:perspective(1300px) rotateY(0deg) rotateX(0deg)}
        .wl-winbar{display:flex;align-items:center;gap:12px;padding:9px 13px;background:var(--bg-2);border-bottom:1px solid var(--line)}
        .wl-winbar .dots{display:flex;gap:6px}
        .wl-winbar .dots i{width:9px;height:9px;border-radius:50%;display:block}
        .wl-winbar .wtitle{font-family:var(--font-mono);font-size:10px;color:var(--text-3);letter-spacing:.06em}
        @keyframes wl-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
        .wl-frame-wrap{position:relative;width:max-content;max-width:100%;margin:0 auto;animation:wl-float 6s ease-in-out infinite}
        .wl-barforgy{width:20px;height:20px;object-fit:contain;flex-shrink:0;filter:drop-shadow(0 0 7px rgba(255,138,61,.5))}
        .wl-chat{position:absolute;top:46px;right:14px;width:216px;z-index:5;border-radius:11px;overflow:hidden;
          background:var(--bg-1);border:1px solid var(--line-2);box-shadow:0 20px 44px rgba(0,0,0,.62),0 0 26px rgba(255,138,61,.08)}
        .wl-chat-hd{display:flex;align-items:center;gap:7px;padding:7px 9px;border-bottom:1px solid var(--line);background:var(--bg-2)}
        .wl-chat-hd img{width:18px;height:18px;object-fit:contain;flex-shrink:0}
        .wl-chat-hd .nm{font-size:10px;font-weight:600;color:var(--text-0)}
        .wl-chat-hd .st{margin-left:auto;font-family:var(--font-mono);font-size:7px;color:var(--state-success);border:1px solid color-mix(in srgb,var(--state-success) 36%,transparent);border-radius:3px;padding:1px 4px}
        .wl-chat-bd{padding:9px;display:flex;flex-direction:column;gap:7px}
        .wl-msg{max-width:90%;font-size:9px;line-height:1.45;padding:6px 8px;border-radius:9px}
        .wl-msg.u{align-self:flex-end;background:var(--bg-3);color:var(--text-1);border:1px solid var(--line-2)}
        .wl-msg.a{align-self:flex-start;background:var(--bg-2);color:var(--text-2);border:1px solid var(--line)}
        .wl-chat-in{display:flex;align-items:center;gap:6px;padding:6px 8px;border-top:1px solid var(--line);background:var(--bg-2)}
        .wl-chat-in .ph{flex:1;font-family:var(--font-mono);font-size:8px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .wl-chat-in .snd{width:18px;height:18px;border-radius:5px;background:var(--action);color:var(--action-fg);display:flex;align-items:center;justify-content:center;font-size:9px;flex-shrink:0}
        @media (max-width:520px){.wl-chat{width:186px;top:42px;right:10px}}
        @media (prefers-reduced-motion:reduce){.wl-frame-wrap{animation:none}}
        .fc-stage{position:relative;width:460px;max-width:100%;height:300px;overflow:hidden;
          background:radial-gradient(circle at 1px 1px, rgba(255,255,255,.05) 1px, transparent 0) 0 0/20px 20px, var(--bg-0)}
        .fc-cables{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
        @keyframes fc-flow{to{stroke-dashoffset:-26}}
        .fc-flow{stroke-dasharray:7 6;animation:fc-flow 1s linear infinite}
        @media (prefers-reduced-motion:reduce){.fc-flow{animation:none}}
        .fc-node{position:absolute;width:120px;border-radius:8px;background:var(--bg-2);border:1px solid var(--line-2);box-shadow:0 6px 16px rgba(0,0,0,.4);overflow:hidden}
        .fc-node.ok{border-color:color-mix(in srgb,var(--state-success) 55%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--state-success) 38%,transparent),0 0 22px color-mix(in srgb,var(--state-success) 15%,transparent)}
        .fc-hd{display:flex;align-items:center;gap:5px;padding:5px 7px;border-bottom:1px solid var(--line);background:var(--bg-4)}
        .fc-hd .id{font-family:var(--font-mono);font-size:8px;color:var(--text-3)}
        .fc-hd .ti{font-size:9px;font-weight:600;color:var(--text-0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
        .fc-hd .llm{font-family:var(--font-mono);font-size:6.5px;font-weight:700;color:var(--cat-asset);border:1px solid color-mix(in srgb,var(--cat-asset) 42%,transparent);border-radius:3px;padding:1px 3px;line-height:1.2}
        .fc-hd .play{width:14px;height:14px;border-radius:50%;background:var(--cat-asset);color:#04121f;display:flex;align-items:center;justify-content:center;font-size:7px;flex-shrink:0}
        .fc-bd{padding:5px 7px;display:flex;flex-direction:column;gap:5px}
        .fc-ports{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:7px;color:var(--text-3)}
        .fc-chip{align-self:flex-start;font-family:var(--font-mono);font-size:7px;padding:2px 5px;border-radius:4px;background:var(--bg-3);color:var(--text-2);border:1px solid var(--line-2)}
        .fc-chip.g{background:color-mix(in srgb,var(--state-success) 14%,var(--bg-0));color:var(--state-success);border-color:color-mix(in srgb,var(--state-success) 34%,transparent)}
        .fc-chip.gate{background:color-mix(in srgb,var(--state-warning) 14%,var(--bg-0));color:var(--state-warning);border-color:color-mix(in srgb,var(--state-warning) 34%,transparent)}
        .fc-seed{position:absolute;width:50px;height:64px;border-radius:6px;background:linear-gradient(160deg,var(--bg-3),var(--bg-2));border:1px solid var(--line-2);box-shadow:0 6px 14px rgba(0,0,0,.45)}
        @media (max-width:1060px){.wl-hero-grid{grid-template-columns:1fr}.wl-frame{transform:none;margin:0 auto}}
        @media (max-width:620px){.wl-frame-wrap{display:none}}
        @media (max-width:560px){.wl-h1{font-size:40px !important}}
      `}</style>

      {/* ── Nav ── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 24px', background: 'color-mix(in srgb, var(--bg-1) 82%, transparent)',
        backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--line)',
      }}>
        <img src="/forgy/forgyi.png" alt="Forge" width={30} height={30} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 8px rgba(255,138,61,.45))' }} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-0)' }}>Forge</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, color: 'var(--text-3)', letterSpacing: '0.12em', marginTop: 5 }}>AI GAME PIPELINE</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <a href="#benefits" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)', textDecoration: 'none' }}>What it does</a>
          <Link href="/login" className="wl-nav-btn">Sign in</Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <header ref={heroRef} style={{ position: 'relative', overflow: 'hidden', padding: '22px 24px 34px' }}>
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 }} />
        <div style={{
          position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
          background: 'radial-gradient(720px 440px at 20% 6%, rgba(255,138,61,.14), transparent 60%), radial-gradient(680px 480px at 84% 20%, rgba(167,139,250,.13), transparent 62%), radial-gradient(620px 420px at 60% 118%, rgba(95,184,234,.10), transparent 58%)',
        }} />
        <div className="wl-hero-grid" style={{ position: 'relative', zIndex: 2, maxWidth: 1180, margin: '0 auto' }}>
          <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 9, marginBottom: 18,
            padding: '6px 13px', borderRadius: 30, fontFamily: 'var(--font-mono)', fontSize: 11,
            letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ember)',
            border: '1px solid color-mix(in srgb, var(--ember) 32%, transparent)', background: 'color-mix(in srgb, var(--ember) 8%, transparent)',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ember)', boxShadow: '0 0 10px var(--ember)', animation: 'wl-pulse 2.4s infinite' }} />
            V57 Studio · AI-native game production
          </div>

          <h1 className="wl-h1" style={{ margin: 0, fontSize: 'clamp(38px, 4.2vw, 58px)', lineHeight: 1.02, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-0)', maxWidth: '15ch' }}>
            From concept to a playable <span className="wl-grad">vertical slice</span>.
          </h1>

          <p style={{ margin: '24px 0 0', fontSize: 17, lineHeight: 1.6, color: 'var(--text-1)', maxWidth: '44ch' }}>
            Forge orchestrates AI across a visual canvas — carrying a game idea past the prototype into <b style={{ color: 'var(--text-0)', fontWeight: 600 }}>design docs, art and a playable vertical slice</b> of the real game.
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 30, flexWrap: 'wrap' }}>
            <Link href="/login" className="wl-cta primary">Sign in →</Link>
            <a href="#benefits" className="wl-cta ghost">See what Forge does</a>
          </div>
          <div style={{ marginTop: 16, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.04em' }}>
            For authorized studios · invite-only access
          </div>
          </div>

          {/* Canvas real de Forge — enmarcado tipo ventana de app */}
          <div className="wl-frame-wrap">
            <div className="wl-frame" style={{ width: 600, maxWidth: '100%' }}>
              <div className="wl-winbar">
                <img className="wl-barforgy" src="/forgy/forgyi.png" alt="Forgy" />
                <span className="wtitle">forge · concept pipeline</span>
              </div>
              <img src="/welcome/canvas.png" alt="A Forge canvas — concept nodes wired into a pipeline" style={{ display: 'block', width: '100%', height: 'auto' }} />
              <div className="wl-chat">
                <div className="wl-chat-hd">
                  <img src="/forgy/forgyi.png" alt="" />
                  <span className="nm">Forge Assistant</span>
                  <span className="st">1.1</span>
                </div>
                <div className="wl-chat-bd">
                  <div className="wl-msg u">Explore 3 concept directions for the pitch.</div>
                  <div className="wl-msg a">Done — 3 concepts generated. Approve to wire them downstream.</div>
                </div>
                <div className="wl-chat-in">
                  <span className="ph">Ask or describe an adjustment…</span>
                  <span className="snd">→</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Bondades ── */}
      <section id="benefits" style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 24px 20px' }}>
        <h2 className="wl-balance" style={{ margin: '0 0 6px', fontSize: 30, fontWeight: 750, letterSpacing: '-0.02em', color: 'var(--text-0)' }}>
          Everything to go from idea to a vertical slice
        </h2>
        <p style={{ margin: '0 0 28px', fontSize: 15, color: 'var(--text-2)', maxWidth: '56ch' }}>
          A single pipeline that carries a concept past the prototype — to documented, asset-backed, playable output.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18 }}>
          {BENEFITS.map((b, i) => (
            <div key={i} className="wl-card" style={{ '--ck': b.c } as React.CSSProperties}>
              <div className="wl-ico">{b.k}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: b.c, marginBottom: 8 }}>{b.kow}</div>
              <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--text-0)', letterSpacing: '-0.01em' }}>{b.t}</h3>
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6 }}>{b.p}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Cómo funciona ── */}
      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '44px 24px 20px' }}>
        <h2 style={{ margin: '0 0 26px', fontSize: 30, fontWeight: 750, letterSpacing: '-0.02em', color: 'var(--text-0)' }}>
          Three steps, one canvas
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{ position: 'relative', padding: '22px', borderRadius: 16, background: 'var(--bg-1)', border: '1px solid var(--line)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 800, color: 'color-mix(in srgb, var(--ember) 60%, var(--text-3))', letterSpacing: '-0.02em', marginBottom: 12 }}>{s.n}</div>
              <h3 style={{ margin: '0 0 7px', fontSize: 17, fontWeight: 700, color: 'var(--text-0)' }}>{s.t}</h3>
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6 }}>{s.p}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA final ── */}
      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '52px 24px 68px' }}>
        <div className="wl-band" style={{ maxWidth: 820, margin: '0 auto', padding: '38px 34px', textAlign: 'center' }}>
          <div className="wl-dots" />
          <div style={{
            position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
            background: 'radial-gradient(480px 220px at 50% -10%, rgba(255,138,61,.18), transparent 60%), radial-gradient(420px 240px at 84% 126%, rgba(167,139,250,.14), transparent 62%)',
          }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <img src="/forgy/forgyi.png" alt="" width={64} height={64} className="wl-bob" style={{ display: 'block', margin: '0 auto 14px', objectFit: 'contain', filter: 'drop-shadow(0 12px 28px rgba(255,138,61,.45))' }} />
            <h2 className="wl-balance" style={{ margin: '0 0 10px', fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-0)' }}>
              Ready to forge your next vertical slice?
            </h2>
            <p style={{ margin: '0 auto 24px', fontSize: 15.5, color: 'var(--text-2)', maxWidth: '48ch', lineHeight: 1.6 }}>
              Sign in to your studio and pick up where the pipeline left off — or see what Forge produces first.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link href="/login" className="wl-cta primary" style={{ height: 48, padding: '0 28px' }}>Sign in →</Link>
              <a href="#benefits" className="wl-cta ghost" style={{ height: 48, padding: '0 22px' }}>What Forge does</a>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 26 }}>
              {['Concept', 'GDD', 'TDD', '2D / 3D assets', 'Blueprints', 'Vertical slice'].map((t, i) => (
                <span key={i} className="wl-tag">{t}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ borderTop: '1px solid var(--line)', padding: '20px 24px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <img src="/forgy/forgyi.png" alt="" width={20} height={20} style={{ objectFit: 'contain' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.05em' }}>Forge · V57 Studio</span>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.05em' }}>Authorized access only</span>
        </div>
      </footer>
    </div>
  )
}
