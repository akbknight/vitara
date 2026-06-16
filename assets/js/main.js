/* VITARA — Shared JS */

(function () {
  'use strict';

  // ─── Nav scroll effect ──────────────────────────────
  const nav = document.getElementById('nav');
  if (nav) {
    const onScroll = () => {
      nav.classList.toggle('scrolled', window.scrollY > 12);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ─── Mobile hamburger ────────────────────────────────
  const toggle = document.getElementById('nav-toggle');
  const mobileNav = document.getElementById('nav-mobile');
  if (toggle && mobileNav) {
    toggle.addEventListener('click', () => {
      const isOpen = mobileNav.classList.toggle('open');
      toggle.classList.toggle('active', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
    // Close on link click
    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileNav.classList.remove('open');
        toggle.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!nav.contains(e.target) && !mobileNav.contains(e.target)) {
        mobileNav.classList.remove('open');
        toggle.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ─── IntersectionObserver reveals ───────────────────
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    revealEls.forEach((el) => observer.observe(el));
  }

  // ─── Active nav link on scroll ──────────────────────
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
  if (sections.length && navLinks.length) {
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            navLinks.forEach((link) => {
              link.classList.toggle(
                'active',
                link.getAttribute('href') === '#' + entry.target.id
              );
            });
          }
        });
      },
      { threshold: 0.4 }
    );
    sections.forEach((s) => sectionObserver.observe(s));
  }

  // ─── Waitlist form ───────────────────────────────────
  const form = document.getElementById('waitlist-form');
  if (form) {
    const emailInput = document.getElementById('wl-email');
    const emailError = document.getElementById('wl-email-error');
    const submitBtn = document.getElementById('wl-submit');
    const success = document.getElementById('form-success');

    // Live validation: clear error as user types
    if (emailInput && emailError) {
      emailInput.addEventListener('input', () => {
        emailError.style.display = 'none';
        emailInput.style.borderColor = '';
      });
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      // Validate email
      const emailVal = emailInput ? emailInput.value.trim() : '';
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal);
      if (!emailValid) {
        if (emailInput) {
          emailInput.style.borderColor = '#C0392B';
          emailInput.focus();
        }
        if (emailError) emailError.style.display = 'block';
        return;
      }

      // Clear error state
      if (emailError) emailError.style.display = 'none';
      if (emailInput) emailInput.style.borderColor = '';

      // Show loading state
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding you to the list…';
      }

      // Store locally and show success
      setTimeout(() => {
        // Persist to sessionStorage so users know they signed up
        try {
          const entry = {
            name: (document.getElementById('wl-name') || {}).value || '',
            email: emailVal,
            culture: (document.getElementById('wl-culture') || {}).value || '',
            ts: new Date().toISOString()
          };
          const prev = JSON.parse(sessionStorage.getItem('vitara_wl') || '[]');
          prev.push(entry);
          sessionStorage.setItem('vitara_wl', JSON.stringify(prev));
        } catch (_) {}

        form.style.display = 'none';
        if (success) success.style.display = 'block';
        success && success.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (window.launchConfetti) window.launchConfetti();
      }, 700);
    });
  }

  // ─── Smooth scroll for anchor links ─────────────────
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const id = anchor.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        const offset = 80;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });


  // ─── Dark mode toggle ────────────────────────────────
  const themeToggle = document.getElementById('theme-toggle');
  const html = document.documentElement;
  const saved = sessionStorage.getItem('vitara-theme');
  if (saved) html.setAttribute('data-theme', saved);
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    html.setAttribute('data-theme', 'dark');
  }
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const next = html.getAttribute('data-theme') === 'dark' ? '' : 'dark';
      html.setAttribute('data-theme', next);
      sessionStorage.setItem('vitara-theme', next);
    });
  }

  // ─── Scroll indicator fade ───────────────────────────
  const scrollIndicator = document.getElementById('scroll-indicator');
  if (scrollIndicator) {
    const onScrollIndicator = () => {
      scrollIndicator.classList.toggle('hidden', window.scrollY > 80);
    };
    window.addEventListener('scroll', onScrollIndicator, { passive: true });
  }

  // ─── Confetti on waitlist success ───────────────────
  window.launchConfetti = function () {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const pieces = Array.from({ length: 90 }, () => ({
      x: Math.random() * canvas.width,
      y: -10 - Math.random() * 40,
      r: 4 + Math.random() * 5,
      d: 2.5 + Math.random() * 2.5,
      color: ['#1a5c3f','#c4932a','#4f9a9f','#e8e5df','#2a7a55'][Math.floor(Math.random() * 5)],
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.15,
      tilt: Math.random() * 10 - 5,
    }));
    let frame = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.r, p.r * 0.4, p.angle, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        p.y += p.d;
        p.x += Math.sin(p.angle) * 0.8;
        p.angle += p.spin;
        if (p.y > canvas.height) { p.y = -10; p.x = Math.random() * canvas.width; }
      });
      frame++;
      if (frame < 180) requestAnimationFrame(draw);
      else { canvas.remove(); }
    };
    draw();
  };

})();
