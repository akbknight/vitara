/* VITARA — GSAP Motion System */

(function () {
  'use strict';

  if (typeof gsap === 'undefined') return;

  gsap.registerPlugin(ScrollTrigger);

  // ─── Hero entrance (homepage only) ──────────────────
  // Hero elements have NO .reveal class — natural opacity is 1
  // so gsap.from(opacity:0) correctly animates 0→1 here
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
      stagger: 0.12,
      ease: 'expo.out',
    }, '-=0.3');
    const emLine = document.querySelector('.hero-line--em');
    if (emLine) {
      tl.from(emLine, { opacity: 0, duration: 0.25, ease: 'expo.out' }, '-=0.7');
    }
    if (heroSub) {
      tl.from(heroSub, { opacity: 0, y: 20, duration: 0.7, ease: 'expo.out' }, '-=0.5');
    }
    if (heroActions) {
      tl.from(heroActions, { opacity: 0, y: 16, duration: 0.6, ease: 'expo.out' }, '-=0.4');
    }
  }

  // ─── ScrollTrigger reveals ───────────────────────────
  // BUG FIX: .reveal elements have CSS opacity:0 — gsap.from() reads that as
  // the "to" value, creating a 0→0 no-op while writing inline opacity:0 that
  // overrides the CSS .reveal.visible { opacity:1 } class. Use fromTo() to
  // explicitly declare both start and end states.
  gsap.utils.toArray('.reveal').forEach((el) => {
    if (el.classList.contains('visible')) return;
    gsap.fromTo(el,
      { opacity: 0, y: 22 },
      {
        scrollTrigger: {
          trigger: el,
          start: 'top 90%',
          toggleActions: 'play none none none',
        },
        opacity: 1,
        y: 0,
        duration: 0.65,
        ease: 'expo.out',
        clearProps: 'opacity,transform',
      }
    );
  });

  // ─── Pull quote — translateX entrance ───────────────
  gsap.utils.toArray('.pull-quote').forEach((el) => {
    gsap.fromTo(el,
      { opacity: 0, x: 24 },
      {
        scrollTrigger: { trigger: el, start: 'top 88%', toggleActions: 'play none none none' },
        opacity: 1,
        x: 0,
        duration: 0.85,
        ease: 'expo.out',
        clearProps: 'opacity,transform',
      }
    );
  });

  // ─── Timeline dot reveal (about page) ───────────────
  document.querySelectorAll('.tl-dot').forEach((dot, i) => {
    gsap.fromTo(dot,
      { scale: 0 },
      {
        scrollTrigger: { trigger: dot, start: 'top 90%', toggleActions: 'play none none none' },
        scale: 1,
        duration: 0.45,
        ease: 'back.out(2.5)',
        delay: i * 0.08,
        clearProps: 'transform',
      }
    );
  });

  // ─── Count-up numbers ────────────────────────────────
  document.querySelectorAll('.count-up').forEach((el) => {
    const target = +el.dataset.target;
    const obj = { val: 0 };
    gsap.to(obj, {
      scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none none' },
      val: target,
      duration: 1.8,
      ease: 'power2.out',
      onUpdate: function () {
        el.textContent = Math.round(obj.val).toLocaleString();
      },
    });
  });

  // ─── Section dividers — draw on scroll ──────────────
  const dividers = document.querySelectorAll('.section-divider');
  if (dividers.length) {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          obs.unobserve(e.target);
        }
      }),
      { threshold: 0.1 }
    );
    dividers.forEach((d) => obs.observe(d));
  }

  // ─── Persona parallax on scroll ─────────────────────
  const personaSection = document.getElementById('who');
  if (personaSection) {
    const personaEl = personaSection.querySelector('.personas');
    if (personaEl) {
      gsap.to(personaEl, {
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

  // ─── Docs sidebar sliding indicator ─────────────────
  const docsNav = document.querySelector('.docs-nav');
  if (docsNav) {
    const activeItem = docsNav.querySelector('.docs-nav-item.active');
    if (activeItem) {
      const pill = document.createElement('div');
      pill.className = 'docs-sidebar-pill';
      docsNav.style.position = 'relative';
      docsNav.appendChild(pill);
      pill.style.top = activeItem.offsetTop + 'px';
      pill.style.height = activeItem.offsetHeight + 'px';
      gsap.fromTo(pill,
        { scaleX: 0, opacity: 0 },
        { scaleX: 1, opacity: 1, duration: 0.4, ease: 'power2.out', delay: 0.35 }
      );
    }
  }

})();
