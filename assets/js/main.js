(() => {
  const body = document.body;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- Loader ---------- */
  const count = document.querySelector('.loader__count');
  let n = 0;
  const finish = () => {
    count.textContent = '100';
    body.classList.add('is-loaded');
    body.classList.remove('is-loading');
  };
  if (reduced) {
    finish();
  } else {
    const t0 = performance.now();
    const tick = () => {
      n = Math.min(100, Math.round((performance.now() - t0) / 14));
      count.textContent = n;
      if (n < 100) setTimeout(tick, 40);
      else setTimeout(finish, 200);
    };
    tick();
  }

  /* ---------- Mobile menu ---------- */
  const menuBtn = document.querySelector('.header__menu');
  const mobileNav = document.querySelector('.mobile-nav');
  const setMenu = (open) => {
    body.classList.toggle('menu-open', open);
    menuBtn.setAttribute('aria-expanded', open);
    mobileNav.setAttribute('aria-hidden', !open);
  };
  menuBtn.addEventListener('click', () => setMenu(!body.classList.contains('menu-open')));
  mobileNav.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMenu(false)));

  /* ---------- Header: solid after hero, hide on scroll down, dark over footer ---------- */
  const header = document.querySelector('.header');
  const footer = document.querySelector('.footer');
  let lastY = scrollY;
  const onHeaderScroll = () => {
    const y = scrollY;
    header.classList.toggle('is-scrolled', y > innerHeight * 0.85);
    if (y > innerHeight && y > lastY + 2) header.classList.add('is-hidden');
    else if (y < lastY - 2 || y <= innerHeight) header.classList.remove('is-hidden');
    header.classList.toggle('is-dark', footer.getBoundingClientRect().top < header.offsetHeight);
    lastY = y;
  };
  addEventListener('scroll', onHeaderScroll, { passive: true });
  onHeaderScroll();

  /* ---------- Baku clock & year ---------- */
  const clocks = document.querySelectorAll('.js-clock');
  const fmt = new Intl.DateTimeFormat('az-AZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Baku', hour12: false });
  const updateClock = () => clocks.forEach((c) => { c.textContent = fmt.format(new Date()); });
  updateClock();
  setInterval(updateClock, 15000);
  document.querySelectorAll('.js-year').forEach((y) => { y.textContent = new Date().getFullYear(); });

  /* ---------- Reveal on scroll ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  /* ---------- Statement: word-by-word highlight tied to scroll ---------- */
  const words = document.querySelector('.js-words');
  if (words) {
    words.innerHTML = words.textContent.trim().split(/\s+/)
      .map((w) => `<span class="w">${w}</span>`).join(' ');
    const spans = [...words.querySelectorAll('.w')];
    const onScroll = () => {
      const r = words.getBoundingClientRect();
      const vh = innerHeight;
      const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
      const lit = Math.round(p * spans.length);
      spans.forEach((s, i) => s.classList.toggle('on', i < lit));
    };
    if (reduced) spans.forEach((s) => s.classList.add('on'));
    else { addEventListener('scroll', onScroll, { passive: true }); onScroll(); }
  }

  /* ---------- Counters ---------- */
  const countIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const target = +el.dataset.count;
      const t0 = performance.now();
      const dur = reduced ? 1 : 1400;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      countIO.unobserve(el);
    });
  }, { threshold: 0.6 });
  document.querySelectorAll('[data-count]').forEach((el) => countIO.observe(el));

  /* ---------- Custom cursor ---------- */
  const cursor = document.querySelector('.cursor');
  const label = cursor.querySelector('span');
  let cx = innerWidth / 2, cy = innerHeight / 2, tx = cx, ty = cy;
  if (finePointer) {
    addEventListener('mousemove', (e) => { tx = e.clientX; ty = e.clientY; }, { passive: true });
    const loop = () => {
      cx += (tx - cx) * 0.2; cy += (ty - cy) * 0.2;
      cursor.style.translate = `${cx}px ${cy}px`;
      requestAnimationFrame(loop);
    };
    loop();
    document.querySelectorAll('[data-cursor]').forEach((el) => {
      el.addEventListener('mouseenter', () => { label.textContent = el.dataset.cursor; cursor.classList.add('on'); });
      el.addEventListener('mouseleave', () => cursor.classList.remove('on'));
    });
  }

  /* ---------- Characters: drag to scroll ---------- */
  const row = document.querySelector('.chars__row');
  if (row) {
    let down = false, startX = 0, startScroll = 0;
    row.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      down = true; startX = e.clientX; startScroll = row.scrollLeft;
      row.classList.add('dragging');
    });
    addEventListener('pointermove', (e) => { if (down) row.scrollLeft = startScroll - (e.clientX - startX); });
    addEventListener('pointerup', () => { down = false; row.classList.remove('dragging'); });
  }

  /* ---------- Services accordion ---------- */
  document.querySelectorAll('.service').forEach((s) => {
    const btn = s.querySelector('.service__head');
    btn.addEventListener('click', () => {
      const open = !s.classList.contains('open');
      s.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open);
    });
  });

  /* ---------- Journal hover preview ---------- */
  const preview = document.querySelector('.journal__preview');
  if (preview && finePointer) {
    const img = preview.querySelector('img');
    const colors = { lime: 'var(--lime)', sky: 'var(--sky)', pink: 'var(--pink)', ink: 'var(--ink)', lav: 'var(--lav)' };
    let px = 0, py = 0, qx = 0, qy = 0, active = false;
    document.querySelectorAll('.journal__list a').forEach((a) => {
      a.addEventListener('mouseenter', () => {
        preview.style.background = colors[a.dataset.preview];
        img.src = a.dataset.char === 'lime'
          ? 'assets/brand/spiral-lime.svg'
          : `assets/characters/char-${a.dataset.char}.svg`;
        preview.classList.add('on'); active = true;
      });
      a.addEventListener('mouseleave', () => { preview.classList.remove('on'); active = false; });
      a.addEventListener('mousemove', (e) => { qx = e.clientX; qy = e.clientY; });
    });
    const loop = () => {
      px += (qx - px) * 0.15; py += (qy - py) * 0.15;
      if (active || preview.classList.contains('on')) {
        preview.style.translate = `${px + 30}px ${py - 100}px`;
      }
      requestAnimationFrame(loop);
    };
    loop();
  }
})();
