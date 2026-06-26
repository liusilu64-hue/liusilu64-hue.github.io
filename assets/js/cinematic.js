(() => {
  const root = document.documentElement;
  const body = document.body;
  const sections = Array.from(document.querySelectorAll('main > section'));
  const navLinks = Array.from(document.querySelectorAll('.nav a[href^="#"]'));
  const anchorLinks = Array.from(document.querySelectorAll('a[href^="#"]'));
  const revealItems = Array.from(document.querySelectorAll('.reveal'));

  body.classList.add('cinematic-ready');

  const progress = document.createElement('div');
  progress.className = 'cinematic-progress';
  progress.setAttribute('aria-hidden', 'true');
  body.prepend(progress);

  sections.forEach((section, index) => {
    if (section.classList.contains('hero')) return;
    const badge = document.createElement('div');
    badge.className = 'scene-number';
    badge.textContent = String(index).padStart(2, '0');
    section.prepend(badge);
  });

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  function scrollToTarget(target, behavior = 'smooth') {
    if (!target) return;
    const header = document.querySelector('.site-header');
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const top = target.getBoundingClientRect().top + window.scrollY - headerHeight;
    window.scrollTo({ top, behavior });
    requestAnimationFrame(updateCinematicScroll);
    window.setTimeout(updateCinematicScroll, 160);
  }

  anchorLinks.forEach(link => {
    link.addEventListener('click', event => {
      const href = link.getAttribute('href');
      if (!href || href === '#') return;
      const target = document.querySelector(href);
      if (!target) return;
      event.preventDefault();
      history.pushState(null, '', href);
      scrollToTarget(target);
    });
  });

  window.addEventListener('hashchange', () => {
    const target = document.querySelector(window.location.hash);
    scrollToTarget(target);
  });

  if (window.location.hash) {
    requestAnimationFrame(() => {
      const target = document.querySelector(window.location.hash);
      scrollToTarget(target, 'auto');
    });
  }

  function updateCinematicScroll() {
    const maxScroll = Math.max(1, root.scrollHeight - window.innerHeight);
    const ratio = clamp(window.scrollY / maxScroll, 0, 1);
    root.style.setProperty('--page-progress', `${(ratio * 100).toFixed(2)}%`);
    root.style.setProperty('--page-progress-ratio', ratio.toFixed(4));
    root.style.setProperty('--scroll-ratio', ratio.toFixed(4));

    let currentSection = null;
    let nearestDistance = Infinity;

    sections.forEach(section => {
      const rect = section.getBoundingClientRect();
      const viewportCenter = window.innerHeight * 0.52;
      const sectionCenter = rect.top + rect.height * 0.5;
      const distance = Math.abs(sectionCenter - viewportCenter);
      const localProgress = clamp((window.innerHeight - rect.top) / (window.innerHeight + rect.height), 0, 1);
      const mediaShift = (0.5 - localProgress) * 56;
      const mediaScale = 1 + (0.5 - Math.abs(localProgress - 0.5)) * 0.035;

      section.style.setProperty('--scene-shift', `${mediaShift.toFixed(1)}px`);
      section.style.setProperty('--scene-scale', mediaScale.toFixed(4));

      if (rect.top < window.innerHeight * 0.72 && rect.bottom > window.innerHeight * 0.28 && distance < nearestDistance) {
        nearestDistance = distance;
        currentSection = section;
      }
    });

    sections.forEach(section => section.classList.toggle('is-current', section === currentSection));

    revealItems.forEach(item => {
      const rect = item.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.94 && rect.bottom > window.innerHeight * 0.06) {
        item.classList.add('is-in');
      }
    });

    const activeId = currentSection ? currentSection.id : '';
    navLinks.forEach(link => {
      const href = link.getAttribute('href') || '';
      link.classList.toggle('is-active', activeId && href === `#${activeId}`);
    });
  }

  updateCinematicScroll();
  window.addEventListener('scroll', updateCinematicScroll, { passive: true });
  window.addEventListener('resize', updateCinematicScroll);
})();
