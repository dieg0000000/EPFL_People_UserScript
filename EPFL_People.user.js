// ==UserScript==
// @name         EPFL People (Position Email)
// @version      2.4.3
// @description  Amélioration de la navigation sur people.epfl.ch et search.epfl.ch
// @author       EPFL-dojo
// @namespace    EPFL-dojo
// @include      https://people.epfl.ch/*
// @exclude      https://people.epfl.ch/signatures/*
// @include      https://personnes.epfl.ch/*
// @include      https://search.epfl.ch/*
// @require      https://code.jquery.com/jquery-3.5.1.min.js
// @grant        GM_xmlhttpRequest
// @connect      people.epfl.ch
// @connect      personnes.epfl.ch
// ==/UserScript==

$(document).ready(async function () {

  console.clear()
  console.log("%cCoded by EPFL-DOJO","color:#060;font-weight:bold;"),
  console.log("%cPlease visit https://github.com/epfl-dojo/\nand checkout-out EPFL Userscripts here\nhttps://github.com/search?q=topic:epfl-userscript&type=Repositories\n\nFeel free to contribute (https://github.com/epfl-dojo/EPFL_People_UserScript) and add issues or feature request here\nhttps://github.com/epfl-dojo/EPFL_People_UserScript/issues","color:#08ff00;font-weight:bold;"),
  console.log("%c	⊂(◉‿◉)つ","font-size:50px; line-height:1.4em;");

  // API LDAP de search-api.epfl.ch
  // c'est là qu'on récupère sciper, email, accreds
  const getPeopleFromSearchAPI = async function (q) {
    try {
      const url = 'https://search-api.epfl.ch/api/ldap?q=' + encodeURIComponent(q) + '&showall=0&hl=en&pageSize=all&siteSearch=people.epfl.ch';
      return await $.ajax({ type: 'GET', url: url });
    } catch (e) {
      return [];
    }
  };

  // attend que l'élément existe dans la page
  const waitForEl = function (selector, callback) {
    if ($(selector).length) {
      callback();
    } else {
      setTimeout(function () {
        waitForEl(selector, callback);
      }, 100);
    }
  };

  // charge une page HTML et la parse
  // GM_xmlhttpRequest sinon bloqué par le CORS entre search.epfl.ch et people.epfl.ch
  const fetchDoc = function (url) {
    return new Promise(function (resolve) {
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          onload: function (res) {
            resolve(res.status === 200 ? new DOMParser().parseFromString(res.responseText, 'text/html') : null);
          },
          onerror: function () {
            resolve(null);
          }
        });
      } catch (e) {
        resolve(null);
      }
    });
  };

  // USERNAME
  const extractUsername = function (docAdmin, fallbackUser) {
    if (docAdmin) {
      let found = '';
      $(docAdmin).find('dt').each(function () {
        const text = $(this).text().toLowerCase();
        if (text.indexOf('username') !== -1 || text.indexOf('gaspar') !== -1 || text.indexOf('utilisateur') !== -1) {
          found = $(this).next('dd').text().trim();
          return false;
        }
      });
      if (found) return found;
    }
    return (fallbackUser && (fallbackUser.username || fallbackUser.id)) ? (fallbackUser.username || fallbackUser.id) : '?';
  };

  // trouve le bouton "Données administratives"
  const findAdminToggle = function () {
    return $('a, button, summary').filter(function () {
      return /données administratives|administrative data/i.test($(this).text());
    }).first();
  };

  // ouvre le bloc "Données administratives" de la page de profil
  const openAdminData = function ($adminToggle) {
    if (!$adminToggle.length) {
      console.warn('⚠ Bouton "Données administratives" introuvable');
      return;
    }
    if ($adminToggle.is('summary')) {
      // bloc <details> : on l'ouvre directement
      $adminToggle.parent('details').attr('open', true);
    } else if ($adminToggle.attr('aria-expanded') !== 'true') {
      // bouton ou lien qui déplie le bloc : on clique dessus
      $adminToggle[0].click();
    }
  };


  // Page de recherche (search.epfl.ch)

  if (window.location.hostname === 'search.epfl.ch') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('filter') !== 'people') return;

    const updateList = async function (query) {
      if (!query) return;

      // tout le monde qui matche la recherche, via l'API
      const users = await getPeopleFromSearchAPI(query);
      if (!users || !users.length) return;

      waitForEl('div.result h3 > a[href*="people.epfl.ch"]', function () {
        $('div.result h3 > a[href*="people.epfl.ch"]').each(async function () {
          const $a = $(this);
          const $h3 = $a.parents('h3');

          // email lu dans le lien mailto du résultat, sert juste à retrouver la bonne personne dans l'API
          const email = $a.parents('div.result').find('a[href^="mailto:"]').first().text().trim().toLowerCase();
          const user = users.find(function (u) {
            return (u.email || '').toLowerCase() === email;
          });

          // déjà traité ou pas trouvé on skip
          if (!user || $h3.find('.sciperID').length) return;

          // SCIPER - API (user.sciper)
          $a.after(' <span class="sciperID">#' + user.sciper + '</span>');

          // PHOTO pas dans l'API, on charge la page profil
          // et on prend la 1re image qui vient de /rails/active_storage/
          const profileUrl = $a.attr('href').replace(/\/$/, '');
          const docProfile = await fetchDoc(profileUrl);
          const photoSrc = docProfile ? $(docProfile).find('img[src*="/rails/active_storage/"]').first().attr('src') : null;

          if (photoSrc) {
            $h3.prepend('<img src="' + photoSrc + '" style="max-width:80px; margin-right:8px;" />');
          }
        });
      });
    };

    // au chargement, avec le ?q= de l'URL
    updateList(params.get('q'));

    // et quand on tape dans la barre
    let timer;
    $(document).on('input', 'input[type=search], input[name=search]', function (e) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        updateList($(e.target).val());
      }, 500);
    });
  }


  // Page de profil (people.epfl.ch/prenom.nom)

  if (window.location.hostname.indexOf('people.epfl.ch') !== -1 || window.location.hostname.indexOf('personnes.epfl.ch') !== -1) {
    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    if (pathSegments.length !== 1) return; // que /prenom.nom, pas les sous-pages

    // ouvrir "Données administratives" dès l'arrivée sur la page
    const $adminToggle = findAdminToggle();
    openAdminData($adminToggle);

    // nom de la personne : titre de l'onglet ("EPFL - Prénom Nom")
    const name = document.title.replace(/^EPFL\s*-\s*/, '').trim();
    const email = $('a[href^="mailto:"]').first().text().trim().toLowerCase();

    // on interroge l'API avec l'email (plus fiable), sinon avec le nom
    const users = await getPeopleFromSearchAPI(email || name);
    if (!users || !users.length) return;

    // on garde celui qui a le même email, sinon le 1er résultat
    const user = users.find(function (u) {
      return email && (u.email || '').toLowerCase() === email;
    }) || users[0];

    if (!user) return;

    // chemin de la 1re accréditation (user.accreds[0].path)
    const firstUnit = (user.accreds && user.accreds.length) ? user.accreds[0].path : '?';

    // h1 qui contient le nom de la personne
    let $title = $('h1').filter(function () {
      return $(this).text().trim() === name;
    }).first();
    if (!$title.length) $title = $('main h1').first();
    if (!$title.length) $title = $('h1').last();

    // LIGNE D'INFOS
    const $dataBox = $('<div id="EPFLPeopleData"></div>').css({
      'white-space': 'nowrap',
      'margin': '-28px 0 12px 0',
      'font-family': 'SFMono-Regular, Menlo, Consolas, "Liberation Mono", "Courier New", monospace',
      'font-size': '18px',
      'font-weight': '400',
      'color': '#212121',
      'letter-spacing': '0'
    });

    const addField = function (label, value, cls) {
      const $span = $('<span></span>').text(value);
      if (cls) $span.addClass(cls);
      if ($dataBox.children().length) $dataBox.append(document.createTextNode('   '));
      $dataBox.append(document.createTextNode(label + ': '), $span);
    };

    addField('sciper', user.sciper);
    addField('username', '…', 'username');
    addField('email', user.email || '?');
    addField('unit', firstUnit);
    $dataBox.css('white-space', 'pre');

    // avant la rangée nom + photo, sinon juste avant le nom
    const $infoRow = $title.closest('.row');
    if ($infoRow.length) {
      $dataBox.insertBefore($infoRow);
    } else {
      $dataBox.insertBefore($title);
    }

    // USERNAME page /admin_data
    const docAdmin = await fetchDoc(window.location.origin + '/' + pathSegments[0] + '/admin_data');
    const username = extractUsername(docAdmin, user);
    $dataBox.find('.username').text(username);

    // BUREAUX API, accred.officeList pour chaque accréditation
    const $maps = $('<div id="EPFLPeopleMaps"></div>');
    (user.accreds || []).forEach(function (accred) {
      (accred.officeList || []).forEach(function (office) {
        $maps.append('<div><iframe height="350px" width="100%" style="border:0" src="https://plan.epfl.ch/iframe/?room==' + encodeURIComponent(office) + '&map_zoom=10"></iframe></div>');
      });
    });

    if ($maps.children().length) {
      // colonne qui contient "Données administratives", puis la colonne juste à sa gauche
      const $adminCol = $adminToggle.closest('[class*="col"]');
      const $leftCol = $adminCol.prevAll('[class*="col"]').first();

      if ($leftCol.length) {
        $leftCol.append($maps);
      } else {
        // pas de colonnes trouvées : sous le bouton e-mail, sinon sous l'encadré
        const $emailCol = $('a[href^="mailto:"]').first().closest('[class*="col"]');
        if ($emailCol.length) {
          $emailCol.append($maps);
        } else {
          $maps.insertAfter($dataBox);
        }
      }
    }
  }

});
