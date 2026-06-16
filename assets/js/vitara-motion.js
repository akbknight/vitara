/* VITARA — GSAP Motion System */

(function () {
  'use strict';

  if (typeof gsap === 'undefined') return;

  gsap.registerPlugin(ScrollTrigger);

  // ─── Hero entrance (homepage only) ──────────────────
  const heroLines = document.querySelectorAll('.hero-line');
  const heroEyebrow = document.querySelector('.hero-eyebrow');
  const heroSub = document.querySelector('#hero .hero-sub');
  const heroActions = document.querySelector('#hero .hero-actions');

  if (heroLines.length) {
    const tl = gsap.timeline({ delay: 0.1 });
    if (heroEyebrow) {
      tl.from(heroEyebrow, { opacity: 0, y: 16, duration: 0.6, ease: 'expo.out' });
    }
    tl.from(heroLines, {
      y: 64,
      opacity: 0,
      duration: 0.9,
      stagger: 0.1,
      ease: 'expo.out',
    }, '-=0.3');
    if (heroSub) {
      tl.from(heroSub, { opacity: 0, y: 20, duration: 0.7, ease: 'expo.out' }, '-=0.5');
    }
    if (heroActions) {
      tl.from(heroActions, { opacity: 0, y: 16, duration: 0.6, ease: 'expo.out' }, '-=0.4');
    }
  }

  // ─── ScrollTrigger reveals (replace IntersectionObserver) ──
  gsap.utils.toArray('.reveal').forEach((el) => {
    if (el.classList.contains('visible')) return;
    gsap.from(el, {
      scrollTrigger: {
        trigger: el,
        start: 'top 88%',
        toggleActions: 'play none none none',
        onEnter: () => el.classList.add('visible'),
      },
      opacity: 0,
      y: 28,
      duration: 0.7,
      ease: 'expo.out',
    });
  });

  // ─── Failure cards — alternating entrance ───────────
  const failureItems = document.querySelectorAll('.failure-item');
  failureItems.forEach((el, i) => {
    const dir = i % 2 === 0 ? -24 : 24;
    gsap.from(el, {
      scrollTrigger: { trigger: el, start: 'top 88%', toggleActions: 'play none none none' },
      x: dir,
      opacity: 0,
      duration: 0.65,
      ease: 'expo.out',
      delay: i * 0.08,
    });
  });

  // ─── Persona rows — stagger ─────────────────────────
  const personaRows = document.querySelectorAll('.persona-row');
  if (personaRows.length) {
    gsap.from(personaRows, {
      scrollTrigger: { trigger: personaRows[0], start: 'top 85%', toggleActions: 'play none none none' },
      opacity: 0,
      x: -20,
      duration: 0.6,
      stagger: 0.1,
      ease: 'expo.out',
    });
  }

  // ─── Feature cards — stagger ─────────────────────────
  const featureCards = document.querySelectorAll('.feature-card');
  if (featureCards.length) {
    gsap.from(featureCards, {
      scrollTrigger: { trigger: featureCards[0], start: 'top 85%', toggleActions: 'play none none none' },
      opacity: 0,
      y: 32,
      duration: 0.65,
      stagger: 0.09,
      ease: 'expo.out',
    });
  }

  // ─── Phase cards — stagger ──────────────────────────
  const phases = document.querySelectorAll('.phase');
  if (phases.length) {
    gsap.from(phases, {
      scrollTrigger: { trigger: phases[0], start: 'top 85%', toggleActions: 'play none none none' },
      opacity: 0,
      y: 24,
      duration: 0.6,
      stagger: 0.1,
      ease: 'expo.out',
    });
  }

  // ─── Persona parallax on scroll ─────────────────────
  const personaSection = document.getElementById('who');
  if (personaSection) {
    gsap.to(personaSection.querySelector('.personas'), {
      scrollTrigger: {
        trigger: personaSection,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
      y: -20,
      ease: 'none',
    });
  }

  // ─── Why Now watermark ───────────────────────────────
  const whyNow = document.getElementById('why-now');
  if (whyNow) {
    const mark = document.createElement('span');
    mark.textContent = '2026';
    mark.style.cssText = [
      'position:absolute',
      'right:-0.05em',
      'bottom:-0.15em',
      'font-family:var(--ff-display,Georgia,serif)',
      'font-size:clamp(8rem,18vw,16rem)',
      'font-weight:600',
      'color:var(--ink)',
      'opacity:0.03',
      'line-height:1',
      'pointer-events:none',
      'user-select:none',
      'letter-spacing:-0.04em',
    ].join(';');
    whyNow.style.position = 'relative';
    whyNow.style.overflow = 'hidden';
    whyNow.appendChild(mark);
    gsap.to(mark, {
      scrollTrigger: {
        trigger: whyNow,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
      y: -40,
      ease: 'none',
    });
  }

})();
