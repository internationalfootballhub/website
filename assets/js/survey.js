// IFH Teamwear Survey — data-driven renderer.
// Reads enquete/survey.config.json; renders sections/questions from it.
// Talks to a Google Apps Script web app for validation + submission.
//
// TODO (deploy step): set APPS_SCRIPT_URL below to the deployed Apps Script
// web app URL once it exists (see apps-script/README.md).
var APPS_SCRIPT_URL = '';

(function () {
  'use strict';

  var UI = {
    nl: {
      codeLabel: 'Toegangscode',
      codePlaceholder: 'IFH-XXXX-XXXX',
      codeButton: 'Start enquête',
      codeChecking: 'Code wordt gecontroleerd…',
      codeInvalid: 'Deze code is niet geldig. Controleer de link die je ontving.',
      codeUsed: 'Deze code werd al gebruikt om de enquête in te dienen.',
      codeNetworkError: 'Er ging iets mis bij het controleren van de code. Probeer het later opnieuw.',
      gateExplain: 'Deze enquête is enkel toegankelijk via een persoonlijke uitnodigingslink met toegangscode.',
      next: 'Volgende',
      prev: 'Vorige',
      submit: 'Verzenden',
      submitting: 'Bezig met verzenden…',
      requiredError: 'Dit veld is verplicht.',
      maxSelectError: function (n) { return 'Je kan maximaal ' + n + ' opties kiezen.'; },
      progress: function (i, n) { return 'Sectie ' + i + ' van ' + n; },
      thankYouTitle: 'Bedankt!',
      submitError: 'Verzenden is niet gelukt. Probeer het opnieuw.',
      retry: 'Opnieuw proberen',
      otherPlaceholder: 'Vul aan…',
      optionalSection: 'Dit deel is optioneel. Je kunt de enquête ook zonder dit deel indienen.',
      selectedOf: function (n, max) { return n + ' van max. ' + max + ' gekozen'; },
      privacy: 'International Football Hub (Campo Sports Connect, België) verwerkt je antwoorden voor dit marktonderzoek. Resultaten worden enkel geaggregeerd gerapporteerd. Vragen? hq@internationalfootballhub.com'
    },
    en: {
      codeLabel: 'Access code',
      codePlaceholder: 'IFH-XXXX-XXXX',
      codeButton: 'Start survey',
      codeChecking: 'Checking code…',
      codeInvalid: 'This code is not valid. Please check the link you received.',
      codeUsed: 'This code has already been used to submit the survey.',
      codeNetworkError: 'Something went wrong while checking the code. Please try again later.',
      gateExplain: 'This survey is only accessible via a personal invitation link with an access code.',
      next: 'Next',
      prev: 'Previous',
      submit: 'Submit',
      submitting: 'Submitting…',
      requiredError: 'This field is required.',
      maxSelectError: function (n) { return 'You can select up to ' + n + ' options.'; },
      progress: function (i, n) { return 'Section ' + i + ' of ' + n; },
      thankYouTitle: 'Thank you!',
      submitError: 'Submission failed. Please try again.',
      retry: 'Try again',
      otherPlaceholder: 'Please specify…',
      optionalSection: 'This section is optional. You can submit the survey without it.',
      selectedOf: function (n, max) { return n + ' of max. ' + max + ' selected'; },
      privacy: 'International Football Hub (Campo Sports Connect, Belgium) processes your answers for this market research. Results are only reported in aggregate. Questions? hq@internationalfootballhub.com'
    }
  };

  var CONFIG = null;
  var STATE = {
    code: null,
    lang: 'nl',
    clubName: '',
    view: 'loading', // loading | gate | survey | done | already_done | error
    sectionIndex: 0,
    maxSectionReached: 0,
    answers: {},
    meta: {}
  };

  var root = document.getElementById('surveyApp');
  if (!root) return;

  // ---------------------------------------------------------------
  // utilities
  // ---------------------------------------------------------------
  function t(key) {
    var s = UI[STATE.lang] || UI.nl;
    return s[key];
  }
  function tt(obj) {
    if (!obj) return '';
    return obj[STATE.lang] || obj.nl || '';
  }
  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function lsKey() { return 'ifh_survey_' + STATE.code; }
  function saveLocal() {
    try {
      localStorage.setItem(lsKey(), JSON.stringify({
        answers: STATE.answers, meta: STATE.meta, sectionIndex: STATE.sectionIndex, maxSectionReached: STATE.maxSectionReached
      }));
    } catch (e) { /* ignore storage errors (private mode, quota, ...) */ }
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem(lsKey());
      if (!raw) return;
      var data = JSON.parse(raw);
      STATE.answers = data.answers || {};
      STATE.meta = data.meta || {};
      STATE.sectionIndex = data.sectionIndex || 0;
      STATE.maxSectionReached = data.maxSectionReached || STATE.sectionIndex;
    } catch (e) { /* ignore */ }
  }
  function clearLocal() {
    try { localStorage.removeItem(lsKey()); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------
  // config helpers: resolve rows_from / options_from / products
  // ---------------------------------------------------------------
  function productsFiltered(excludeList) {
    var excl = excludeList || [];
    return CONFIG.products.filter(function (p) { return excl.indexOf(p.code) === -1; });
  }
  function questionRows(q) {
    if (q.rows) return q.rows;
    if (q.rows_from === 'products') return productsFiltered(q.exclude_products);
    return [];
  }
  function questionOptions(q) {
    var opts = [];
    if (q.options) opts = opts.concat(q.options);
    if (q.options_from === 'products') opts = opts.concat(productsFiltered(q.exclude_products));
    if (q.extra_options) opts = opts.concat(q.extra_options);
    return opts;
  }

  // ---------------------------------------------------------------
  // condition evaluation (show_if / required_if)
  // ---------------------------------------------------------------
  function evalCond(cond) {
    if (!cond) return true;
    var val = STATE.answers[cond.q];
    if (cond.row !== undefined) {
      var cell = (val && typeof val === 'object') ? val[cond.row] : undefined;
      if (cond.not_in) return !cell || cond.not_in.indexOf(cell) === -1;
      if (cond.in) return !!cell && cond.in.indexOf(cell) !== -1;
      return true;
    }
    if (cond.not_includes !== undefined) {
      var arr = Array.isArray(val) ? val : [];
      return arr.indexOf(cond.not_includes) === -1;
    }
    if (cond.in) {
      return val !== undefined && val !== null && cond.in.indexOf(val) !== -1;
    }
    if (cond.any_except) {
      var arr2 = Array.isArray(val) ? val : [];
      for (var i = 0; i < arr2.length; i++) {
        if (cond.any_except.indexOf(arr2[i]) === -1) return true;
      }
      return false;
    }
    if (cond.filled !== undefined) {
      var filled = val !== undefined && val !== null && String(val).trim() !== '';
      return cond.filled ? filled : !filled;
    }
    return true;
  }
  function isVisible(q) { return evalCond(q.show_if); }
  function isRequired(q) {
    if (q.required_if) return evalCond(q.required_if);
    return !!q.required;
  }

  // ---------------------------------------------------------------
  // answer get/set
  // ---------------------------------------------------------------
  function getAnswer(id) { return STATE.answers[id]; }
  function setAnswer(id, value) {
    if (value === undefined || value === null || value === '' ||
        (Array.isArray(value) && value.length === 0)) {
      delete STATE.answers[id];
    } else {
      STATE.answers[id] = value;
    }
  }
  function setMatrixAnswer(id, row, col) {
    var cur = STATE.answers[id];
    if (!cur || typeof cur !== 'object') cur = {};
    cur[row] = col;
    STATE.answers[id] = cur;
  }

  // ---------------------------------------------------------------
  // rendering: question type renderers return an HTML string
  // ---------------------------------------------------------------
  function renderErrorSlot() {
    return '<p class="survey-error-text">' + escapeHtml(t('requiredError')) + '</p>';
  }

  function renderShortText(q, idPrefix) {
    var val = getAnswer(q.id) || '';
    if (!val && q.prefill_from === 'access_code.club_name' && STATE.clubName) {
      val = STATE.clubName;
      setAnswer(q.id, val);
    }
    return '' +
      '<label class="survey-question__label" for="' + idPrefix + q.id + '">' + escapeHtml(tt(q.text)) + (isRequired(q) ? ' *' : '') + '</label>' +
      '<input class="survey-input" type="text" id="' + idPrefix + q.id + '" data-qid="' + q.id + '" data-kind="text" value="' + escapeHtml(val) + '">' +
      renderErrorSlot();
  }

  function renderEmail(q, idPrefix) {
    var val = getAnswer(q.id) || '';
    return '' +
      '<label class="survey-question__label" for="' + idPrefix + q.id + '">' + escapeHtml(tt(q.text)) + (isRequired(q) ? ' *' : '') + '</label>' +
      '<input class="survey-input" type="email" id="' + idPrefix + q.id + '" data-qid="' + q.id + '" data-kind="email" value="' + escapeHtml(val) + '">' +
      renderErrorSlot();
  }

  function renderOtherField(q, selected) {
    if (!q.other_field) return '';
    var isOther = Array.isArray(selected) ? selected.indexOf('other') !== -1 : selected === 'other';
    if (!isOther) return '';
    var val = getAnswer(q.other_field) || '';
    return '<div class="survey-other-field"><input class="survey-input" type="text" data-qid="' + q.other_field + '" data-kind="text" placeholder="' + escapeHtml(t('otherPlaceholder')) + '" value="' + escapeHtml(val) + '"></div>';
  }

  function renderSingleSelect(q, idPrefix) {
    var selected = getAnswer(q.id);
    var opts = questionOptions(q);
    var html = '<fieldset><legend class="survey-question__label">' + escapeHtml(tt(q.text)) + (isRequired(q) ? ' *' : '') + '</legend>';
    if (q.help) html += '<p class="survey-question__help">' + escapeHtml(tt(q.help)) + '</p>';

    if (q.display === 'dropdown') {
      html += '<select class="survey-option-dropdown" data-qid="' + q.id + '" data-kind="single_select">';
      html += '<option value="">—</option>';
      opts.forEach(function (o) {
        html += '<option value="' + escapeHtml(o.code) + '"' + (selected === o.code ? ' selected' : '') + '>' + escapeHtml(tt(o)) + '</option>';
      });
      html += '</select>';
    } else {
      html += '<div class="survey-options">';
      opts.forEach(function (o, i) {
        var checked = selected === o.code;
        var inputId = idPrefix + q.id + '_' + i;
        html += '<label class="survey-option' + (checked ? ' is-checked' : '') + '" for="' + inputId + '">' +
          '<input type="radio" id="' + inputId + '" name="' + idPrefix + q.id + '" value="' + escapeHtml(o.code) + '" data-qid="' + q.id + '" data-kind="single_select"' + (checked ? ' checked' : '') + '>' +
          '<span>' + escapeHtml(tt(o)) + '</span></label>';
      });
      html += '</div>';
    }
    html += renderOtherField(q, selected);
    html += renderErrorSlot();
    html += '</fieldset>';
    return html;
  }

  function renderScale15(q, idPrefix) {
    var selected = getAnswer(q.id);
    var html = '<fieldset><legend class="survey-question__label">' + escapeHtml(tt(q.text)) + (isRequired(q) ? ' *' : '') + '</legend>';
    html += '<div class="survey-scale">';
    for (var n = 1; n <= 5; n++) {
      var checked = selected === n;
      var inputId = idPrefix + q.id + '_' + n;
      html += '<label class="survey-scale__opt' + (checked ? ' is-checked' : '') + '" for="' + inputId + '">' +
        '<input type="radio" id="' + inputId + '" name="' + idPrefix + q.id + '" value="' + n + '" data-qid="' + q.id + '" data-kind="scale_1_5"' + (checked ? ' checked' : '') + '>' +
        '<span class="survey-scale__num">' + n + '</span></label>';
    }
    html += '</div>';
    if (q.labels) {
      html += '<div class="survey-scale__labels"><span>' + escapeHtml(tt(q.labels['1'])) + '</span><span>' + escapeHtml(tt(q.labels['5'])) + '</span></div>';
    }
    html += renderErrorSlot();
    html += '</fieldset>';
    return html;
  }

  function renderMultiSelect(q, idPrefix) {
    var selected = getAnswer(q.id) || [];
    var opts = questionOptions(q);
    var html = '<fieldset><legend class="survey-question__label">' + escapeHtml(tt(q.text)) + (isRequired(q) ? ' *' : '') + '</legend>';
    if (q.help) html += '<p class="survey-question__help">' + escapeHtml(tt(q.help)) + '</p>';
    html += '<div class="survey-options">';
    opts.forEach(function (o, i) {
      var checked = selected.indexOf(o.code) !== -1;
      var inputId = idPrefix + q.id + '_' + i;
      html += '<label class="survey-option' + (checked ? ' is-checked' : '') + '" for="' + inputId + '">' +
        '<input type="checkbox" id="' + inputId + '" value="' + escapeHtml(o.code) + '" data-qid="' + q.id + '" data-kind="multi_select" data-exclusive="' + (o.exclusive ? '1' : '0') + '" data-max="' + (q.max_select || '') + '"' + (checked ? ' checked' : '') + '>' +
        '<span>' + escapeHtml(tt(o)) + '</span></label>';
    });
    html += '</div>';
    if (q.max_select) html += '<p class="survey-chip-count">' + escapeHtml(t('selectedOf')(selected.length, q.max_select)) + '</p>';
    html += renderOtherField(q, selected);
    html += renderErrorSlot();
    html += '</fieldset>';
    return html;
  }

  function matrixRowOrder(q) {
    var rows = questionRows(q);
    if (!q.randomise_rows) return rows;
    var metaKey = q.id + '_row_order';
    var order = STATE.meta[metaKey];
    if (!order) {
      order = rows.map(function (r) { return r.code; });
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
      }
      STATE.meta[metaKey] = order;
    }
    var byCode = {};
    rows.forEach(function (r) { byCode[r.code] = r; });
    return order.map(function (code) { return byCode[code]; }).filter(Boolean);
  }

  // Deliberately built from plain <div>s, not a real <table>. Overriding
  // display on <table>/<tr>/<td> (e.g. table->flex for the mobile card
  // layout) makes browsers' anonymous-table-box generation and the painted
  // layout disagree about where things are — elementFromPoint/clicks land
  // on the wrong row. Divs with role="table" etc. don't have that quirk.
  function renderMatrix(q, idPrefix, isScale) {
    var rows = isScale ? matrixRowOrder(q) : questionRows(q);
    var cols = isScale ? [1, 2, 3, 4, 5] : q.columns;
    var answers = getAnswer(q.id) || {};

    var html = '<fieldset><legend class="survey-question__label">' + escapeHtml(tt(q.text)) + (isRequired(q) ? ' *' : '') + '</legend>';
    if (q.help) html += '<p class="survey-question__help">' + escapeHtml(tt(q.help)) + '</p>';
    html += '<div class="survey-matrix" data-qid="' + q.id + '" data-kind="' + (isScale ? 'matrix_scale_1_5' : 'matrix_single') + '" role="table">';

    html += '<div class="survey-matrix__row survey-matrix__row--head" role="row"><div class="survey-matrix__headcell" role="columnheader"></div>';
    cols.forEach(function (c) { html += '<div class="survey-matrix__headcell" role="columnheader">' + (isScale ? c : escapeHtml(tt(c))) + '</div>'; });
    html += '</div>';

    rows.forEach(function (row, rIdx) {
      var rowAns = answers[row.code];
      html += '<div class="survey-matrix__row" role="row"><div class="survey-matrix__rowlabel" role="rowheader">' + escapeHtml(tt(row)) + '</div>';
      cols.forEach(function (c, cIdx) {
        var colCode = isScale ? String(c) : c.code;
        var checked = rowAns === colCode;
        var inputId = idPrefix + q.id + '_' + rIdx + '_' + cIdx;
        html += '<div class="survey-matrix__cell' + (checked ? ' is-checked' : '') + '" role="cell">' +
          '<label for="' + inputId + '">' +
          '<input type="radio" id="' + inputId + '" name="' + idPrefix + q.id + '_' + row.code + '" value="' + escapeHtml(colCode) + '" data-qid="' + q.id + '" data-kind="matrix" data-row="' + escapeHtml(row.code) + '"' + (checked ? ' checked' : '') + '>' +
          '<span>' + (isScale ? colCode : escapeHtml(tt(c))) + '</span></label></div>';
      });
      html += '</div>';
    });
    html += '</div>';
    html += renderErrorSlot();
    html += '</fieldset>';
    return html;
  }

  function renderCheckbox(q, idPrefix) {
    var checked = !!getAnswer(q.id);
    var inputId = idPrefix + q.id;
    return '' +
      '<label class="survey-option' + (checked ? ' is-checked' : '') + '" for="' + inputId + '">' +
      '<input type="checkbox" id="' + inputId + '" data-qid="' + q.id + '" data-kind="checkbox"' + (checked ? ' checked' : '') + '>' +
      '<span>' + escapeHtml(tt(q.text)) + (isRequired(q) ? ' *' : '') + '</span></label>' +
      renderErrorSlot();
  }

  function renderGroup(q, idPrefix) {
    var html = '<div class="survey-group"><p class="survey-question__label">' + escapeHtml(tt(q.text)) + '</p>';
    (q.items || []).forEach(function (item) {
      if (!isVisible(item)) return;
      html += '<div class="survey-question survey-subquestion" data-qid-wrap="' + item.id + '">' + renderQuestionBody(item, idPrefix) + '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderQuestionBody(q, idPrefix) {
    switch (q.type) {
      case 'short_text': return renderShortText(q, idPrefix);
      case 'email': return renderEmail(q, idPrefix);
      case 'single_select': return renderSingleSelect(q, idPrefix);
      case 'multi_select': return renderMultiSelect(q, idPrefix);
      case 'scale_1_5': return renderScale15(q, idPrefix);
      case 'matrix_single': return renderMatrix(q, idPrefix, false);
      case 'matrix_scale_1_5': return renderMatrix(q, idPrefix, true);
      case 'checkbox': return renderCheckbox(q, idPrefix);
      case 'group': return renderGroup(q, idPrefix);
      default: return '';
    }
  }

  function renderQuestion(q, idPrefix) {
    if (!isVisible(q)) return '';
    if (q.type === 'group') return '<div class="survey-question" data-qid-wrap="' + q.id + '">' + renderQuestionBody(q, idPrefix) + '</div>';
    return '<div class="survey-question" data-qid-wrap="' + q.id + '">' + renderQuestionBody(q, idPrefix) + '</div>';
  }

  // ---------------------------------------------------------------
  // section rendering + navigation
  // ---------------------------------------------------------------
  function currentSection() { return CONFIG.sections[STATE.sectionIndex]; }

  function renderSurveyView() {
    var section = currentSection();
    var total = CONFIG.sections.length;
    var idPrefix = 's' + STATE.sectionIndex + '_';
    var isLast = STATE.sectionIndex === total - 1;

    var html = '';
    html += '<div class="survey-stepper" role="tablist" aria-label="' + escapeHtml(t('progress')(STATE.sectionIndex + 1, total)) + '">';
    for (var i = 0; i < total; i++) {
      var reached = i <= STATE.maxSectionReached;
      var isCurrent = i === STATE.sectionIndex;
      var cls = 'survey-step' + (isCurrent ? ' is-current' : '') + (reached && !isCurrent ? ' is-reached' : '');
      html += '<button type="button" class="' + cls + '" data-step="' + i + '"' + (reached ? '' : ' disabled') +
        ' role="tab" aria-selected="' + (isCurrent ? 'true' : 'false') + '" aria-label="' + escapeHtml(tt(CONFIG.sections[i].title)) + '">' + (i + 1) + '</button>';
      if (i < total - 1) html += '<span class="survey-step__line' + (i < STATE.maxSectionReached ? ' is-reached' : '') + '"></span>';
    }
    html += '</div>';
    html += '<div class="survey-progress__label">' + escapeHtml(t('progress')(STATE.sectionIndex + 1, total)) + '</div>';

    html += '<form class="survey-section" id="surveyForm" novalidate>';
    html += '<h2>' + escapeHtml(tt(section.title)) + '</h2>';
    if (section.help) html += '<div class="survey-optional-note">' + escapeHtml(tt(section.help)) + '</div>';

    section.questions.forEach(function (q) {
      html += renderQuestion(q, idPrefix);
    });

    html += '<div class="survey-nav">';
    if (STATE.sectionIndex > 0) html += '<button type="button" class="btn btn--ghost" id="btnPrev">' + escapeHtml(t('prev')) + '</button>';
    html += '<button type="submit" class="btn btn--primary" id="btnNext">' + escapeHtml(isLast ? t('submit') : t('next')) + '</button>';
    html += '</div>';
    html += '</form>';

    root.innerHTML = html;
    bindSectionEvents();
  }

  function bindSectionEvents() {
    var form = qs('#surveyForm');

    qsa('[data-kind="text"], [data-kind="email"]', form).forEach(function (el) {
      el.addEventListener('input', function () {
        setAnswer(el.getAttribute('data-qid'), el.value);
        saveLocal();
      });
    });

    qsa('[data-kind="single_select"]', form).forEach(function (el) {
      el.addEventListener('change', function () {
        setAnswer(el.getAttribute('data-qid'), el.value);
        saveLocal();
        renderSurveyView();
      });
    });

    qsa('[data-kind="scale_1_5"]', form).forEach(function (el) {
      el.addEventListener('change', function () {
        setAnswer(el.getAttribute('data-qid'), parseInt(el.value, 10));
        saveLocal();
        renderSurveyView();
      });
    });

    qsa('[data-kind="checkbox"]', form).forEach(function (el) {
      el.addEventListener('change', function () {
        setAnswer(el.getAttribute('data-qid'), el.checked);
        saveLocal();
        renderSurveyView();
      });
    });

    qsa('[data-kind="multi_select"]', form).forEach(function (el) {
      el.addEventListener('change', function () {
        var qid = el.getAttribute('data-qid');
        var exclusive = el.getAttribute('data-exclusive') === '1';
        var max = parseInt(el.getAttribute('data-max'), 10) || 0;
        var cur = (getAnswer(qid) || []).slice();

        if (el.checked) {
          if (exclusive) {
            cur = [el.value];
          } else {
            // uncheck any exclusive option already selected
            var group = qsa('[data-qid="' + qid + '"][data-exclusive="1"]', form);
            group.forEach(function (g) {
              var idx = cur.indexOf(g.value);
              if (idx !== -1) cur.splice(idx, 1);
            });
            if (max && cur.length >= max) {
              el.checked = false;
              return;
            }
            cur.push(el.value);
          }
        } else {
          var i = cur.indexOf(el.value);
          if (i !== -1) cur.splice(i, 1);
        }
        setAnswer(qid, cur);
        saveLocal();
        renderSurveyView();
      });
    });

    qsa('[data-kind="matrix"]', form).forEach(function (el) {
      el.addEventListener('change', function () {
        setMatrixAnswer(el.getAttribute('data-qid'), el.getAttribute('data-row'), el.value);
        saveLocal();
        renderSurveyView();
      });
    });

    var prev = qs('#btnPrev');
    if (prev) prev.addEventListener('click', function () {
      STATE.sectionIndex = Math.max(0, STATE.sectionIndex - 1);
      saveLocal();
      renderSurveyView();
      window.scrollTo(0, 0);
    });

    qsa('.survey-step', document).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        STATE.sectionIndex = parseInt(btn.getAttribute('data-step'), 10);
        saveLocal();
        renderSurveyView();
        window.scrollTo(0, 0);
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validateCurrentSection()) return;
      var total = CONFIG.sections.length;
      if (STATE.sectionIndex < total - 1) {
        STATE.sectionIndex++;
        STATE.maxSectionReached = Math.max(STATE.maxSectionReached, STATE.sectionIndex);
        saveLocal();
        renderSurveyView();
        window.scrollTo(0, 0);
      } else {
        doSubmit();
      }
    });
  }

  // ---------------------------------------------------------------
  // validation
  // ---------------------------------------------------------------
  function flattenVisibleQuestions(section) {
    var list = [];
    section.questions.forEach(function (q) {
      if (!isVisible(q)) return;
      if (q.type === 'group') {
        (q.items || []).forEach(function (item) {
          if (isVisible(item)) list.push(item);
        });
      } else {
        list.push(q);
      }
    });
    return list;
  }

  function questionHasAnswer(q) {
    var val = getAnswer(q.id);
    switch (q.type) {
      case 'multi_select':
        return Array.isArray(val) && val.length > 0;
      case 'matrix_single':
      case 'matrix_scale_1_5':
        var rows = questionRows(q);
        if (!val) return false;
        return rows.every(function (r) { return val[r.code] !== undefined; });
      case 'checkbox':
        return val === true;
      default:
        return val !== undefined && val !== null && String(val).trim() !== '';
    }
  }

  function validateCurrentSection() {
    var section = currentSection();
    var questions = flattenVisibleQuestions(section);
    var allOk = true;
    questions.forEach(function (q) {
      var wrap = qs('[data-qid-wrap="' + q.id + '"]');
      if (!wrap) return;
      var ok = true;
      if (isRequired(q) && !questionHasAnswer(q)) ok = false;
      if (q.other_field) {
        var mainVal = getAnswer(q.id);
        var hasOther = Array.isArray(mainVal) ? mainVal.indexOf('other') !== -1 : mainVal === 'other';
        if (hasOther && !getAnswer(q.other_field)) ok = false;
      }
      wrap.classList.toggle('has-error', !ok);
      if (!ok) allOk = false;
    });
    if (!allOk) {
      var firstError = qs('.survey-question.has-error');
      if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return allOk;
  }

  // ---------------------------------------------------------------
  // submission
  // ---------------------------------------------------------------
  function buildPayload() {
    return { code: STATE.code, lang: STATE.lang, answers: STATE.answers, meta: STATE.meta };
  }

  function doSubmit() {
    var btn = qs('#btnNext');
    if (btn) { btn.disabled = true; btn.textContent = t('submitting'); }
    submitToBackend(buildPayload(), function (res) {
      if (res && res.ok) {
        clearLocal();
        STATE.view = 'done';
        renderView();
      } else {
        if (btn) { btn.disabled = false; btn.textContent = t('submit'); }
        showToast(t('submitError'));
      }
    });
  }

  function submitToBackend(payload, cb) {
    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(cb).catch(function () { cb({ ok: false, networkError: true }); });
  }

  function validateCode(code, cb) {
    var url = APPS_SCRIPT_URL + (APPS_SCRIPT_URL.indexOf('?') === -1 ? '?' : '&') + 'action=validate&code=' + encodeURIComponent(code);
    fetch(url).then(function (r) { return r.json(); }).then(cb).catch(function () { cb({ valid: false, networkError: true }); });
  }

  function showToast(msg) {
    var el = document.createElement('p');
    el.className = 'survey-error-text';
    el.style.display = 'block';
    el.style.textAlign = 'center';
    el.textContent = msg;
    root.insertBefore(el, root.firstChild);
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------
  // gate view
  // ---------------------------------------------------------------
  function renderGateView(errorMsg) {
    var html = '';
    html += '<div class="survey-intro">';
    html += '<h1>' + escapeHtml(tt(CONFIG.title)) + '</h1>';
    html += '<p class="survey-subtitle">' + escapeHtml(tt(CONFIG.subtitle)) + '</p>';
    html += '</div>';
    html += '<div class="survey-gate">';
    html += '<p>' + escapeHtml(t('gateExplain')) + '</p>';
    html += '<form id="gateForm" style="margin-top:16px;">';
    html += '<label for="gateCode">' + escapeHtml(t('codeLabel')) + '</label>';
    html += '<input type="text" id="gateCode" placeholder="' + escapeHtml(t('codePlaceholder')) + '" autocomplete="off" autocapitalize="characters">';
    if (errorMsg) html += '<p class="survey-error">' + escapeHtml(errorMsg) + '</p>';
    html += '<div class="survey-nav"><button type="submit" class="btn btn--primary">' + escapeHtml(t('codeButton')) + '</button></div>';
    html += '</form>';
    html += '</div>';
    root.innerHTML = html;

    qs('#gateForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var code = qs('#gateCode').value.trim().toUpperCase();
      if (!code) return;
      startWithCode(code);
    });
  }

  function renderEndView(kind) {
    var html = '<div class="survey-end">';
    if (kind === 'already_done') {
      html += '<h2>' + escapeHtml(t('thankYouTitle')) + '</h2><p>' + escapeHtml(t('codeUsed')) + '</p>';
    } else {
      html += '<h2>' + escapeHtml(t('thankYouTitle')) + '</h2><p>' + escapeHtml(tt(CONFIG.thank_you)) + '</p>';
    }
    html += '</div>';
    root.innerHTML = html;
  }

  function renderErrorView(msg) {
    root.innerHTML = '<div class="survey-end"><p class="survey-error">' + escapeHtml(msg) + '</p>' +
      '<div class="survey-nav" style="justify-content:center;"><button type="button" class="btn btn--primary" id="btnRetry">' + escapeHtml(t('retry')) + '</button></div></div>';
    qs('#btnRetry').addEventListener('click', function () { startWithCode(STATE.code); });
  }

  function renderView() {
    if (STATE.view === 'gate') renderGateView();
    else if (STATE.view === 'survey') renderSurveyView();
    else if (STATE.view === 'done') renderEndView('done');
    else if (STATE.view === 'already_done') renderEndView('already_done');
    else if (STATE.view === 'error') renderErrorView(t('codeNetworkError'));
  }

  // ---------------------------------------------------------------
  // flow control
  // ---------------------------------------------------------------
  function startWithCode(code) {
    STATE.code = code;
    renderGateView(t('codeChecking'));
    qs('#gateForm button').disabled = true;

    validateCode(code, function (res) {
      if (res.networkError) { STATE.view = 'error'; renderView(); return; }
      if (!res.valid) { renderGateView(t('codeInvalid')); return; }
      if (res.status === 'completed') { STATE.view = 'already_done'; renderView(); return; }

      STATE.clubName = res.club_name || '';
      if (!getUrlLang()) STATE.lang = res.lang === 'en' ? 'en' : 'nl';
      loadLocal();
      STATE.view = 'survey';
      renderView();
      updateLangButtons();
    });
  }

  function getUrlLang() {
    var params = new URLSearchParams(window.location.search);
    var lang = params.get('lang');
    return (lang === 'nl' || lang === 'en') ? lang : null;
  }

  function updateLangButtons() {
    qsa('.survey-lang button').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-lang') === STATE.lang);
    });
  }

  function initLangToggle() {
    qsa('.survey-lang button').forEach(function (b) {
      b.addEventListener('click', function () {
        STATE.lang = b.getAttribute('data-lang');
        updateLangButtons();
        renderView();
      });
    });
  }

  function initFooterPrivacy() {
    var el = document.getElementById('surveyPrivacy');
    if (el) el.textContent = t('privacy');
  }

  // ---------------------------------------------------------------
  // boot
  // ---------------------------------------------------------------
  fetch('survey.config.json')
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      CONFIG = cfg;
      var params = new URLSearchParams(window.location.search);
      var urlLang = getUrlLang();
      STATE.lang = urlLang || cfg.default_language || 'nl';
      initLangToggle();
      updateLangButtons();
      initFooterPrivacy();

      var codeParam = params.get('code');
      if (codeParam) {
        startWithCode(codeParam.trim().toUpperCase());
      } else {
        STATE.view = 'gate';
        renderView();
      }
    })
    .catch(function () {
      root.innerHTML = '<p class="survey-error">Config kon niet geladen worden / Could not load config.</p>';
    });
})();
