// International Football Hub — site scripts

document.addEventListener('DOMContentLoaded', function () {
  // Mobile nav toggle
  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.nav-toggle');
  if (toggle && header) {
    toggle.addEventListener('click', function () {
      header.classList.toggle('nav-open');
    });
    document.querySelectorAll('.main-nav a').forEach(function (link) {
      link.addEventListener('click', function () {
        header.classList.remove('nav-open');
      });
    });
  }

  // Contact form handling — opens the visitor's own email client with the
  // message pre-filled, addressed to hq@internationalfootballhub.com.
  // No server involved, so this works on static hosting (e.g. GitHub Pages).
  var form = document.querySelector('.contact-form');
  if (form) {
    var status = form.querySelector('.form-status');
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      // honeypot spam check
      var honeypot = form.querySelector('.hp-field');
      if (honeypot && honeypot.value) {
        return;
      }

      var required = form.querySelectorAll('[required]');
      var valid = true;
      required.forEach(function (field) {
        if (!field.value.trim()) valid = false;
      });
      if (!valid) {
        showStatus('Please fill in all required fields.', 'error');
        return;
      }

      var firstName = form.first_name.value.trim();
      var lastName = form.last_name.value.trim();
      var organisation = form.organisation.value.trim();
      var country = form.country.value.trim();
      var email = form.email.value.trim();
      var phone = form.phone.value.trim();
      var message = form.message.value.trim();

      var subject = 'Website enquiry from ' + firstName + ' ' + lastName;
      var bodyLines = [
        'Name: ' + firstName + ' ' + lastName,
        'Organisation: ' + (organisation || '-'),
        'Country: ' + (country || '-'),
        'Email: ' + email,
        'Phone: ' + (phone || '-'),
        '',
        message
      ];

      var mailto = 'mailto:hq@internationalfootballhub.com'
        + '?subject=' + encodeURIComponent(subject)
        + '&body=' + encodeURIComponent(bodyLines.join('\n'));

      showStatus('Opening your email client to send this message…', 'success');
      window.location.href = mailto;
    });

    function showStatus(msg, type) {
      status.textContent = msg;
      status.className = 'form-status ' + (type === 'success' ? 'is-success' : 'is-error');
    }
  }

  // Case studies: click a card to reveal its full story in the shared panel below
  var caseButtons = document.querySelectorAll('.case-select-btn');
  var casePanel = document.getElementById('case-detail-panel');
  if (caseButtons.length && casePanel) {
    var closeCasePanel = function () {
      casePanel.hidden = true;
      document.querySelectorAll('.case-detail').forEach(function (d) { d.hidden = true; });
      caseButtons.forEach(function (b) { b.classList.remove('is-active'); });
    };

    caseButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var targetId = btn.getAttribute('data-case');
        var target = document.getElementById(targetId);
        var alreadyOpen = !casePanel.hidden && !target.hidden && btn.classList.contains('is-active');

        document.querySelectorAll('.case-detail').forEach(function (d) { d.hidden = true; });
        caseButtons.forEach(function (b) { b.classList.remove('is-active'); });

        if (alreadyOpen) {
          casePanel.hidden = true;
          return;
        }

        casePanel.hidden = false;
        target.hidden = false;
        btn.classList.add('is-active');
        casePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    var closeBtn = casePanel.querySelector('.case-detail-panel__close');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeCasePanel);
    }
  }

  // Homepage photo showcase carousel (coverflow: one main photo, neighbours peeking on each side)
  var slider = document.getElementById('showcase-slider');
  var track = document.getElementById('showcase-track');
  var dotsWrap = document.getElementById('showcase-dots');
  if (slider && track && dotsWrap) {
    var slides = Array.prototype.slice.call(track.querySelectorAll('.showcase-slider__slide'));
    var viewport = slider.querySelector('.showcase-slider__viewport');
    var count = slides.length;
    var current = 0;
    var autoTimer;

    slides.forEach(function (slide, i) {
      slide.addEventListener('click', function () {
        if (i !== current) { goTo(i); restartAuto(); }
      });
    });

    slides.forEach(function (_, i) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'showcase-slider__dot';
      dot.setAttribute('aria-label', 'Go to photo ' + (i + 1));
      dot.addEventListener('click', function () {
        goTo(i);
        restartAuto();
      });
      dotsWrap.appendChild(dot);
    });
    var dots = dotsWrap.querySelectorAll('.showcase-slider__dot');

    function shortestOffset(i) {
      var diff = i - current;
      if (diff > count / 2) diff -= count;
      if (diff < -count / 2) diff += count;
      return diff;
    }

    function layout() {
      var w = viewport.offsetWidth;
      slides.forEach(function (slide, i) {
        var offset = shortestOffset(i);
        var abs = Math.abs(offset);
        var x = 0, scale = 1, opacity = 1, z = 5, pointer = 'auto';
        if (abs === 1) {
          x = offset * w * 0.34;
          scale = 0.76;
          opacity = 0.55;
          z = 4;
        } else if (abs === 2) {
          x = offset * w * 0.56;
          scale = 0.6;
          opacity = 0;
          z = 3;
          pointer = 'none';
        } else if (abs > 2) {
          x = (offset > 0 ? 1 : -1) * w * 0.7;
          scale = 0.5;
          opacity = 0;
          z = 1;
          pointer = 'none';
        }
        slide.style.transform = 'translate(-50%, 0) translateX(' + x + 'px) scale(' + scale + ')';
        slide.style.opacity = opacity;
        slide.style.zIndex = z;
        slide.style.pointerEvents = pointer;
        slide.classList.toggle('is-active', offset === 0);
      });
      dots.forEach(function (d, i) { d.classList.toggle('is-active', i === current); });
    }

    function goTo(index) {
      current = (index + count) % count;
      layout();
    }

    function startAuto() {
      clearInterval(autoTimer);
      autoTimer = setInterval(function () { goTo(current + 1); }, 6000);
    }
    function restartAuto() {
      startAuto();
    }

    var prevBtn = slider.querySelector('.showcase-slider__arrow--prev');
    var nextBtn = slider.querySelector('.showcase-slider__arrow--next');
    if (prevBtn) prevBtn.addEventListener('click', function () { goTo(current - 1); restartAuto(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { goTo(current + 1); restartAuto(); });

    // Only pause-on-hover on devices that actually have a mouse — on touch
    // devices, taps can fire synthetic mouseenter/mouseleave events that
    // would otherwise race with the swipe handling below and make the
    // auto-advance feel erratic.
    if (window.matchMedia('(hover: hover)').matches) {
      slider.addEventListener('mouseenter', function () { clearInterval(autoTimer); });
      slider.addEventListener('mouseleave', function () { startAuto(); });
    }

    var touchStartX = null;
    viewport.addEventListener('touchstart', function (e) { touchStartX = e.touches[0].clientX; }, { passive: true });
    viewport.addEventListener('touchend', function (e) {
      if (touchStartX === null) return;
      var diff = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(diff) > 40) {
        goTo(diff < 0 ? current + 1 : current - 1);
        restartAuto();
      }
      touchStartX = null;
    });

    window.addEventListener('resize', layout);

    layout();
    startAuto();
  }
});
