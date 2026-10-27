(function () {
  'use strict';

  var CLIPS = {
    facil: [2, 4, 7, 12, 18],
    normal: [1, 2, 4, 8, 14],
    dificil: [1, 1.5, 2, 4, 8]
  };
  var POINTS = [100, 75, 55, 35, 20];
  var HINT_COST = 15;
  var STORAGE_KEY = 'adivina-la-cancion:config';
  var DECK_PREFIX = 'adivina-la-cancion:deck:';

  var NOISE = /(official|oficial|videoclip|video\s*clip|music\s*video|v[ií]deo|audio|lyric|letra|hd|hq|uhd|4k|8k|remaster|remastered|remasterizad[oa]|visualizer|visualiser|en\s*vivo|live|en\s*directo|directo|acoustic|acústico|acustico|version|versión|extended|radio\s*edit|clip\s*officiel|m\/v|mv|performance|session|cover|karaoke|feat|ft\.|featuring|prod\.)/i;

  function $(id) { return document.getElementById(id); }

  var el = {
    screenStart: $('screen-start'),
    screenGame: $('screen-game'),
    screenResults: $('screen-results'),
    playlistInput: $('playlistInput'),
    songCount: $('songCount'),
    difficulty: $('difficulty'),
    startBtn: $('startBtn'),
    startStatus: $('startStatus'),
    startError: $('startError'),
    quitBtn: $('quitBtn'),
    scoreChip: $('scoreChip'),
    scoreValue: $('scoreValue'),
    roundLabel: $('roundLabel'),
    pointsLabel: $('pointsLabel'),
    progressBar: $('progressBar'),
    playerCover: $('playerCover'),
    coverStatus: $('coverStatus'),
    coverPlay: $('coverPlay'),
    clipBar: $('clipBar'),
    attempts: $('attempts'),
    guessForm: $('guessForm'),
    guessInput: $('guessInput'),
    guessBtn: $('guessBtn'),
    suggestions: $('suggestions'),
    suggestToggle: $('suggestToggle'),
    triedList: $('triedList'),
    triedItems: $('triedItems'),
    hintBtn: $('hintBtn'),
    moreTimeBtn: $('moreTimeBtn'),
    replayBtn: $('replayBtn'),
    skipBtn: $('skipBtn'),
    volume: $('volume'),
    feedback: $('feedback'),
    revealPanel: $('revealPanel'),
    revealHead: $('revealHead'),
    revealSong: $('revealSong'),
    revealArtist: $('revealArtist'),
    revealLink: $('revealLink'),
    revealFull: $('revealFull'),
    revealNext: $('revealNext'),
    resultsScore: $('resultsScore'),
    resultsSummary: $('resultsSummary'),
    resultsList: $('resultsList'),
    playAgain: $('playAgain'),
    newPlaylist: $('newPlaylist')
  };

  var player = null;
  var playerPromise = null;
  var apiPromise = null;
  var volume = 0.7;
  var metaCache = new Map();
  var SONG_ALIASES = window.SONG_ALIASES || {};

  var clipTimer = null;
  var clipRaf = 0;
  var clipToken = 0;
  var clipStarted = false;
  var adWatchTimer = null;
  var adWaiting = false;
  var adStartedAt = 0;

  var game = {
    playlistId: '',
    source: 'youtube',
    cover: '',
    pool: [],
    queue: [],
    index: -1,
    score: 0,
    results: [],
    round: null,
    difficulty: 'normal',
    count: 20,
    suggestions: true,
    token: 0,
    deck: [],
    deckIndex: 0,
    deckLoaded: false
  };

  /* ---------- Utilidades ---------- */

  function showScreen(name) {
    el.screenStart.hidden = name !== 'start';
    el.screenGame.hidden = name !== 'game';
    el.screenResults.hidden = name !== 'results';
    el.scoreChip.hidden = name !== 'game';
    el.quitBtn.hidden = name !== 'game';
  }

  function shuffle(list) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function setStatus(text) {
    el.startStatus.hidden = !text;
    el.startStatus.textContent = text || '';
  }

  function showStartError(text) {
    el.startError.hidden = !text;
    el.startError.textContent = text || '';
  }

  function setBusy(busy) {
    el.startBtn.disabled = busy;
    el.startBtn.classList.toggle('loading', busy);
  }

  function setFeedback(text, kind) {
    el.feedback.textContent = text || '';
    el.feedback.className = 'feedback' + (kind ? ' ' + kind : '');
  }

  function setCoverState(state) {
    el.playerCover.dataset.state = state;
  }

  function setCoverStatus(text) {
    el.coverStatus.textContent = text || '';
  }

  function renderTried(round) {
    el.triedItems.innerHTML = '';

    round.guesses.forEach(function (text) {
      var chip = document.createElement('span');
      chip.className = 'tried-item';
      chip.textContent = text;
      el.triedItems.appendChild(chip);
    });

    el.triedList.hidden = !round.guesses.length;
  }

  function extractPlaylistId(input) {
    var value = String(input || '').trim();
    if (!value) return '';
    var match = value.match(/[?&]list=([A-Za-z0-9_-]{10,})/);
    if (match) return match[1];
    if (/^(PL|UU|OL|FL|RD|LL|ML)[A-Za-z0-9_-]{6,}$/.test(value)) return value;
    return '';
  }

  function detectSource(input) {
    var value = String(input || '').trim();
    if (!value) return null;

    var spotify = value.match(/spotify\.com\/(?:[a-z-]+\/)?playlist\/([A-Za-z0-9]{22})/) ||
      value.match(/^spotify:playlist:([A-Za-z0-9]{22})$/i);

    if (spotify) return { type: 'spotify', id: spotify[1] };

    var youtubeId = extractPlaylistId(value);
    if (youtubeId) return { type: 'youtube', id: youtubeId };

    if (/^[A-Za-z0-9]{22}$/.test(value)) return { type: 'spotify', id: value };

    return null;
  }

  function saveConfig() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        playlistId: game.playlistId,
        playlistUrl: String(el.playlistInput.value || '').trim(),
        source: game.source,
        count: el.songCount.value,
        difficulty: el.difficulty.value,
        suggestions: el.suggestToggle.value,
        volume: volume
      }));
    } catch (error) { /* almacenamiento no disponible */ }
  }

  function loadConfig() {
    var saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (error) { saved = null; }

    if (saved) {
      if (saved.playlistUrl) {
        el.playlistInput.value = saved.playlistUrl;
      } else if (saved.playlistId) {
        el.playlistInput.value = saved.source === 'spotify'
          ? 'https://open.spotify.com/playlist/' + saved.playlistId
          : saved.playlistId;
      }
      if (saved.source === 'spotify') game.source = 'spotify';
      if (saved.count && el.songCount.querySelector('option[value="' + saved.count + '"]')) {
        el.songCount.value = saved.count;
      }
      if (saved.difficulty && CLIPS[saved.difficulty]) el.difficulty.value = saved.difficulty;
      if (saved.suggestions === 'no') el.suggestToggle.value = 'no';
      if (typeof saved.volume === 'number') volume = Math.min(1, Math.max(0, saved.volume));
    }

    el.volume.value = Math.round(volume * 100);
    game.count = Number(el.songCount.value) || 0;
    game.difficulty = el.difficulty.value;
    game.suggestions = el.suggestToggle.value !== 'no';
  }

  /* ---------- YouTube ---------- */

  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (apiPromise) return apiPromise;

    apiPromise = new Promise(function (resolve, reject) {
      var settled = false;
      var finish = function (error) {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      var previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof previous === 'function') previous();
        finish();
      };

      var script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = function () {
        finish(new Error('No se pudo cargar el reproductor de YouTube. Revisa tu conexión.'));
      };
      document.head.appendChild(script);

      setTimeout(function () {
        if (window.YT && window.YT.Player) finish();
      }, 10000);
    });

    return apiPromise;
  }

  function createPlayer() {
    if (player && typeof player.playVideo === 'function') return Promise.resolve(player);
    if (playerPromise) return playerPromise;

    playerPromise = loadYouTubeApi().then(function () {
      return new Promise(function (resolve) {
        player = new window.YT.Player('yt-player', {
          width: 320,
          height: 180,
          playerVars: {
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            fs: 0,
            iv_load_policy: 3,
            origin: window.location.origin
          },
          events: {
            onReady: function () {
              try {
                player.setVolume(Math.round(volume * 100));
              } catch (error) { /* sin volumen todavía */ }
              resolve(player);
            },
            onStateChange: handleStateChange,
            onError: handlePlayerError
          }
        });
      });
    }).catch(function (error) {
      playerPromise = null;
      throw error;
    });

    return playerPromise;
  }

  function handleStateChange(event) {
    if (!window.YT) return;
    if (event.data === window.YT.PlayerState.PLAYING) {
      if (game.round && !game.round.ended) {
        clipStarted = true;
        setCoverState('playing');
        setCoverStatus('Escuchando…');
      }
    }
  }

  function handlePlayerError(event) {
    var round = game.round;
    if (!round || round.ended) return;

    var currentId = '';
    try {
      var data = player.getVideoData();
      currentId = data && data.video_id;
    } catch (error) { currentId = ''; }

    if (currentId && round.track.id && currentId !== round.track.id) return;

    if (event.data === 101 || event.data === 150) {
      failTrack('Este vídeo no permite reproducirse fuera de YouTube. Pasando a la siguiente…');
    } else {
      failTrack('No se pudo reproducir esta canción. Pasando a la siguiente…');
    }
  }

  function fetchPlaylistIds(playlistId) {
    return createPlayer().then(function () {
      return new Promise(function (resolve, reject) {
        var started = Date.now();
        var settled = false;

        function finish(error, ids) {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve(ids);
        }

        try {
          player.cuePlaylist({ list: playlistId, listType: 'playlist', index: 0, startSeconds: 0 });
        } catch (error) {
          return finish(new Error('YouTube no aceptó esa playlist. Comprueba el enlace.'));
        }

        function tick() {
          if (settled) return;
          var ids = [];
          try { ids = player.getPlaylist() || []; } catch (error) { ids = []; }

          if (ids.length) {
            try { player.stopVideo(); } catch (error) { /* nada */ }
            return finish(null, ids.slice());
          }

          if (Date.now() - started > 20000) {
            return finish(new Error('No pudimos leer la playlist. Debe ser pública o “no listada” y tener al menos una canción.'));
          }

          setTimeout(tick, 250);
        }

        tick();
      });
    });
  }

  function cueTrack(track) {
    return new Promise(function (resolve) {
      var started = performance.now();
      var done = false;

      function finish(ok) {
        if (done) return;
        done = true;
        resolve(ok);
      }

      try {
        player.cueVideoById(track.id);
      } catch (error) {
        return finish(false);
      }

      function tick() {
        if (done) return;
        var duration = 0;
        var videoId = '';

        try {
          duration = player.getDuration() || 0;
          var data = player.getVideoData();
          videoId = data && data.video_id;
        } catch (error) { /* reproductor ocupado */ }

        if (duration > 0 && (!videoId || videoId === track.id)) {
          track.duration = duration;
          return finish(true);
        }
        if (performance.now() - started > 9000) return finish(false);
        setTimeout(tick, 150);
      }

      setTimeout(tick, 200);
    });
  }

  /* ---------- Metadatos y respuestas ---------- */

  function fetchMeta(id) {
    if (metaCache.has(id)) return metaCache.get(id);

    var promise = fetch('/api/metadata?ids=' + encodeURIComponent(id))
      .then(function (response) {
        if (!response.ok) throw new Error('metadatos no disponibles');
        return response.json();
      })
      .then(function (payload) {
        var item = payload && payload.items && payload.items[0];
        if (!item || item.error || !item.title) throw new Error('metadatos no disponibles');
        return item;
      })
      .catch(function (error) {
        metaCache.delete(id);
        throw error;
      });

    metaCache.set(id, promise);
    return promise;
  }

  function isNoiseSegment(segment) {
    var words = String(segment || '')
      .replace(/[\s\-–—_·:|]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!words.length) return true;

    var meaningful = words.filter(function (word) { return !NOISE.test(word); });
    return meaningful.join('').length < 3;
  }

  function cleanTitle(title) {
    var text = String(title || '').trim();
    if (!text) return '';

    text = text.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, function (block) {
      return NOISE.test(block) ? ' ' : block;
    });

    text = text.split(/\s*[|｜]\s*/).filter(function (part) {
      return !isNoiseSegment(part);
    }).join(' - ');

    text = text.replace(/\s+(?:ft\.?|feat\.?|featuring)\s+.*$/i, '');

    text = text.replace(/\s*[-–—:]\s*([^-–—:|]+)$/i, function (match, tail) {
      return isNoiseSegment(tail) ? '' : match;
    });

    text = text
      .replace(/\s*[-–—]\s*Topic\s*$/i, '')
      .replace(/\bVEVO\b/gi, '')
      .replace(/^[\s"'“”«»]+|[\s"'“”«»]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '')
      .trim();

    return text;
  }

  function stripQuotes(text) {
    return String(text || '').replace(/^[\s"'“”«»]+|[\s"'“”«»]+$/g, '');
  }

  function splitArtistSong(clean, author) {
    var artist = String(author || '')
      .replace(/\s*-\s*Topic\s*$/i, '')
      .replace(/VEVO\s*$/i, '')
      .trim();

    var song = clean;
    var match = clean.match(/^(.{2,70}?)\s*[-–—]\s+(.+)$/);
    if (match) {
      artist = match[1].trim();
      song = match[2].trim();
    }

    return { artist: artist, song: song };
  }

  function addAnswers(track, values) {
    var answers = track.answers || [];

    (values || []).forEach(function (value) {
      var text = String(value || '').trim();
      if (text.length > 1 && answers.indexOf(text) === -1) answers.push(text);
    });

    track.answers = answers;
  }

  function applyAlias(track) {
    var alias = SONG_ALIASES[track.id];
    if (!alias) return track;

    if (alias.title) track.title = alias.title;
    if (alias.artist) track.artist = alias.artist;
    if (alias.subtitle) track.subtitle = alias.subtitle;
    if (alias.original) track.original = alias.original;
    if (alias.anime) track.anime = alias.anime;

    addAnswers(track, alias.aliases || []);
    if (alias.anime) addAnswers(track, [alias.anime]);
    if (alias.original) addAnswers(track, [alias.original]);

    return track;
  }

  function trackSubtitle(track) {
    var bits = [];

    if (track.artist) bits.push(track.artist);
    if (track.subtitle) bits.push(track.subtitle);
    if (track.anime) bits.push(track.anime);

    if (track.original &&
        normalize(track.original) !== normalize(track.title) &&
        normalize(track.original) !== normalize(track.subtitle || '')) {
      bits.push('Original: ' + track.original);
    }

    return bits.join(' · ');
  }

  function applyMeta(track, meta) {
    var raw = (meta.title || '').trim();
    var clean = cleanTitle(raw);
    var parts = splitArtistSong(clean, meta.author || '');

    track.rawTitle = raw;
    track.title = stripQuotes(parts.song || clean || raw);
    track.artist = parts.artist || '';
    track.thumbnail = meta.thumbnail || '';

    var answers = [parts.song, clean, raw];

    var bare = raw.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ');
    bare = bare.split(/\s*[|｜]\s*/)[0].trim();
    var bareParts = splitArtistSong(cleanTitle(bare), meta.author || '');
    answers.push(bareParts.song);

    if (parts.artist) {
      answers.push(parts.artist + ' ' + parts.song);
      answers.push(parts.song + ' ' + parts.artist);
    }

    track.answers = answers.filter(function (value, index, list) {
      return value && value.trim().length > 1 && list.indexOf(value) === index;
    });

    applyAlias(track);
  }

  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' y ')
      .replace(/\b(feat|ft|featuring)\b/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    var previous = new Array(b.length + 1);
    var current = new Array(b.length + 1);

    for (var j = 0; j <= b.length; j++) previous[j] = j;

    for (var i = 1; i <= a.length; i++) {
      current[0] = i;
      for (var k = 1; k <= b.length; k++) {
        var cost = a[i - 1] === b[k - 1] ? 0 : 1;
        current[k] = Math.min(current[k - 1] + 1, previous[k] + 1, previous[k - 1] + cost);
      }
      for (var m = 0; m <= b.length; m++) previous[m] = current[m];
    }

    return previous[b.length];
  }

  function similarity(a, b) {
    if (!a || !b) return 0;
    var longest = Math.max(a.length, b.length);
    if (!longest) return 0;
    return 1 - levenshtein(a, b) / longest;
  }

  function matches(guess, target) {
    if (!target) return false;

    var g = normalize(guess);
    var t = normalize(target);
    if (!g || !t) return false;
    if (g === t) return true;

    var compactGuess = g.replace(/\s+/g, '');
    var compactTarget = t.replace(/\s+/g, '');
    if (compactGuess && compactTarget && compactGuess === compactTarget) return true;

    var ratio = similarity(g, t);
    if (ratio >= 0.88) return true;

    if (t.length >= 8 && g.length >= 4 && ratio >= 0.65) {
      if (t.indexOf(g) !== -1 || g.indexOf(t) !== -1) return true;
    }

    var compactRatio = similarity(compactGuess, compactTarget);
    if (compactRatio >= 0.88) return true;

    if (compactTarget.length >= 8 && compactGuess.length >= 4 && compactRatio >= 0.65) {
      if (compactTarget.indexOf(compactGuess) !== -1 || compactGuess.indexOf(compactTarget) !== -1) return true;
    }

    var guessWords = g.split(' ').filter(function (word) { return word.length > 2; });
    var targetWords = t.split(' ');

    if (guessWords.length >= 2) {
      var hits = guessWords.filter(function (word) {
        return targetWords.some(function (candidate) {
          return candidate === word || (word.length > 3 && candidate.indexOf(word) === 0);
        });
      }).length;

      if (hits === guessWords.length && hits >= 2) return true;
    }

    return false;
  }

  function isCorrect(guess, track) {
    var raw = String(guess || '').trim().toLowerCase();

    return (track.answers || []).some(function (answer) {
      var text = String(answer || '').trim().toLowerCase();
      return text === raw || matches(guess, answer);
    });
  }

  /* ---------- Sugerencias ---------- */

  var suggestionItems = [];
  var suggestionIndex = -1;
  var suggestionsOpen = false;

  function hideSuggestions() {
    suggestionsOpen = false;
    suggestionIndex = -1;
    suggestionItems = [];
    el.suggestions.hidden = true;
    el.suggestions.innerHTML = '';
    el.guessInput.setAttribute('aria-expanded', 'false');
    el.guessInput.removeAttribute('aria-activedescendant');
  }

  function highlightSuggestion(index) {
    var rows = el.suggestions.children;

    for (var i = 0; i < rows.length; i++) {
      var active = i === index;
      rows[i].classList.toggle('active', active);
      rows[i].setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) rows[i].scrollIntoView({ block: 'nearest' });
    }

    if (rows[index]) el.guessInput.setAttribute('aria-activedescendant', rows[index].id);
  }

  function chooseSuggestion(index) {
    var track = suggestionItems[index];
    if (!track) return;

    el.guessInput.value = track.title;
    hideSuggestions();
    el.guessInput.focus();
  }

  function renderSuggestions() {
    var round = game.round;

    if (!game.suggestions || !round || round.ended || el.guessInput.disabled) {
      hideSuggestions();
      return;
    }

    var query = normalize(el.guessInput.value.trim());
    if (!query) {
      hideSuggestions();
      return;
    }

    var found = [];
    var seen = {};

    game.pool.forEach(function (track) {
      if (!track.title || !track.answers || !track.answers.length) return;

      var title = normalize(track.title);
      var full = normalize([track.artist, track.title, track.anime].filter(Boolean).join(' '));
      var aliases = normalize((track.answers || []).concat(track.anime ? [track.anime] : []).join(' '));
      var score = -1;

      if (title.indexOf(query) === 0) score = 0;
      else if (full.indexOf(query) === 0) score = 1;
      else if (aliases.indexOf(query) === 0) score = 1.5;
      else if (title.indexOf(query) !== -1) score = 2;
      else if (full.indexOf(query) !== -1) score = 3;
      else if (aliases.indexOf(query) !== -1) score = 4;

      if (score < 0) return;

      var key = String(track.title || '').trim().toLowerCase() + '|' +
        String(track.artist || '').trim().toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      found.push({ track: track, score: score });
    });

    found.sort(function (a, b) {
      return a.score - b.score || a.track.title.localeCompare(b.track.title, 'es', { sensitivity: 'base' });
    });

    var top = found;
    if (!top.length) {
      hideSuggestions();
      return;
    }

    suggestionItems = top.map(function (item) { return item.track; });
    suggestionIndex = -1;
    el.suggestions.innerHTML = '';

    top.forEach(function (item, index) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'suggestion';
      row.id = 'suggestion-' + index;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');

      var title = document.createElement('span');
      title.className = 'suggestion-title';
      title.textContent = item.track.title;
      row.appendChild(title);

      var suggestionMeta = [item.track.artist, item.track.anime].filter(Boolean).join(' · ');

      if (suggestionMeta) {
        var artist = document.createElement('span');
        artist.className = 'suggestion-artist';
        artist.textContent = suggestionMeta;
        row.appendChild(artist);
      }

      row.addEventListener('mousedown', function (event) {
        event.preventDefault();
        chooseSuggestion(index);
      });

      el.suggestions.appendChild(row);
    });

    el.suggestions.hidden = false;
    suggestionsOpen = true;
    el.guessInput.setAttribute('aria-expanded', 'true');
  }

  function prefetchPool() {
    if (isSpotify() || !game.pool.length) return;

    var token = game.token;
    var pending = game.pool.filter(function (track) { return !track.title; }).slice(0, 500);
    var chunks = [];

    for (var i = 0; i < pending.length; i += 20) chunks.push(pending.slice(i, i + 20));
    if (!chunks.length) return;

    var index = 0;

    function next() {
      if (token !== game.token || index >= chunks.length) return;
      var chunk = chunks[index++];
      var ids = chunk.map(function (track) { return track.id; });

      fetch('/api/metadata?ids=' + encodeURIComponent(ids.join(',')))
        .then(function (response) {
          if (!response.ok) throw new Error('metadatos no disponibles');
          return response.json();
        })
        .then(function (payload) {
          if (token !== game.token) return;

          var byId = {};
          (payload.items || []).forEach(function (item) {
            if (item && item.id && item.title) byId[item.id] = item;
          });

          chunk.forEach(function (track) {
            var meta = byId[track.id];
            if (!meta) return;
            metaCache.set(track.id, Promise.resolve(meta));
            applyMeta(track, meta);
          });

          if (suggestionsOpen) renderSuggestions();
        })
        .catch(function () { /* la ronda lo reintenta si hace falta */ })
        .then(function () { next(); });
    }

    next();
  }

  /* ---------- Spotify ---------- */

  function isSpotify() {
    return game.source === 'spotify';
  }

  var audioEl = null;

  function getAudioEl() {
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.preload = 'auto';
      audioEl.addEventListener('playing', function () {
        if (!game.round || game.round.ended) return;
        clipStarted = true;
        setCoverState('playing');
        setCoverStatus('Escuchando…');
      });
      audioEl.addEventListener('ended', function () {
        if (game.round && game.round.ended) {
          el.revealFull.textContent = isSpotify() ? 'Escuchar adelanto' : 'Escuchar completa';
        }
      });
    }
    return audioEl;
  }

  function audioPlayAt(start) {
    if (isSpotify()) {
      var el = getAudioEl();
      try {
        el.currentTime = start || 0;
        el.volume = volume;
      } catch (error) { /* audio aún sin cargar */ }

      var promise = el.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(function () {
          if (!game.round || game.round.ended) return;
          setCoverState('paused');
          setCoverStatus('Pulsa ▶ para escuchar');
        });
      }
      return;
    }

    try {
      player.seekTo(start || 0, true);
      player.setVolume(Math.round(volume * 100));
      player.playVideo();
    } catch (error) { /* el reproductor aún no está listo */ }
  }

  function audioPause() {
    if (isSpotify()) {
      if (audioEl) audioEl.pause();
      return;
    }
    try { player.pauseVideo(); } catch (error) { /* nada */ }
  }

  function audioIsPlaying() {
    if (isSpotify()) return Boolean(audioEl && !audioEl.paused);
    try {
      var state = player.getPlayerState();
      return state === 1 || state === 3;
    } catch (error) {
      return false;
    }
  }

  function audioPlayFull() {
    if (isSpotify()) {
      var el = getAudioEl();
      el.currentTime = 0;
      el.volume = volume;
      var promise = el.play();
      if (promise && typeof promise.catch === 'function') promise.catch(function () {});
      return;
    }

    try {
      player.seekTo(0, true);
      player.setVolume(Math.round(volume * 100));
      player.playVideo();
    } catch (error) { /* nada */ }
  }

  function audioSetVolume() {
    if (isSpotify()) {
      if (audioEl) audioEl.volume = volume;
      return;
    }
    try { player.setVolume(Math.round(volume * 100)); } catch (error) { /* nada */ }
  }

  function prepareSpotifyTrack(track) {
    return new Promise(function (resolve) {
      var audio = getAudioEl();
      var done = false;

      function finish(ok) {
        if (done) return;
        done = true;
        audio.onloadedmetadata = null;
        audio.onerror = null;
        resolve(ok);
      }

      audio.onloadedmetadata = function () {
        if (isFinite(audio.duration) && audio.duration > 0) {
          track.duration = audio.duration;
          finish(true);
        } else {
          finish(false);
        }
      };

      audio.onerror = function () { finish(false); };

      try {
        audio.src = track.preview;
        audio.load();
      } catch (error) {
        return finish(false);
      }

      if (audio.readyState >= 1 && isFinite(audio.duration) && audio.duration > 0) {
        track.duration = audio.duration;
        return finish(true);
      }

      setTimeout(function () {
        if (isFinite(audio.duration) && audio.duration > 0) {
          track.duration = audio.duration;
          finish(true);
        } else {
          finish(false);
        }
      }, 8000);
    });
  }

  function fetchSpotifyPlaylist(id) {
    return fetch('/api/spotify/playlist?id=' + encodeURIComponent(id))
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (!response.ok || !payload.items || !payload.items.length) {
            throw new Error(payload.error || 'No se pudo cargar la playlist de Spotify.');
          }
          return payload;
        });
      });
  }

  function buildSpotifyTracks(playlist) {
    return playlist.items.map(function (item) {
      var title = stripQuotes(cleanTitle(item.title) || item.title);
      var artist = String(item.artist || '').trim();
      var answers = [item.title, title];

      if (artist) {
        answers.push(artist + ' ' + item.title);
        answers.push(item.title + ' ' + artist);
        answers.push(artist + ' ' + title);
        answers.push(title + ' ' + artist);
      }

      var track = {
        id: item.id,
        title: title || item.title,
        artist: artist,
        subtitle: '',
        original: '',
        anime: '',
        rawTitle: item.title,
        answers: answers.filter(function (value, index, list) {
          return value && value.trim().length > 1 && list.indexOf(value) === index;
        }),
        duration: 0,
        startAt: 0,
        thumbnail: playlist.cover || '',
        preview: item.preview
      };

      applyAlias(track);
      return track;
    });
  }

  function cloneTrack(track) {
    return {
      id: track.id,
      title: track.title || '',
      artist: track.artist || '',
      subtitle: track.subtitle || '',
      original: track.original || '',
      anime: track.anime || '',
      rawTitle: track.rawTitle || '',
      answers: (track.answers || []).slice(),
      duration: 0,
      startAt: 0,
      thumbnail: track.thumbnail || '',
      preview: track.preview || ''
    };
  }

  /* ---------- Reproducción ---------- */

  function isAdPlaying(track) {
    if (!player || !track) return false;

    try {
      var data = player.getVideoData() || {};
      var id = data.video_id || '';
      if (id && track.id && id !== track.id) return true;

      var duration = player.getDuration() || 0;
      if (duration > 0 && track.duration > 2 && Math.abs(duration - track.duration) > 2) return true;
    } catch (error) {
      return false;
    }

    return false;
  }

  function stopAdWatch() {
    if (adWatchTimer) {
      clearInterval(adWatchTimer);
      adWatchTimer = null;
    }
    adWaiting = false;
  }

  function startAdWatch(round, seconds) {
    stopAdWatch();

    adWatchTimer = setInterval(function () {
      if (!game.round || game.round !== round || round.ended) {
        stopAdWatch();
        return;
      }

      var ad = isAdPlaying(round.track);

      if (adWaiting && Date.now() - adStartedAt > 90000) {
        stopAdWatch();
        setCoverState('idle');
        setCoverStatus('El anuncio no termina · pulsa ▶ para repetir');
        return;
      }

      if (ad && !adWaiting) {
        adWaiting = true;
        adStartedAt = Date.now();
        round.adSeconds = seconds;
        clearClip();
        try {
          if (player.getPlayerState() !== 1) player.playVideo();
        } catch (error) { /* nada */ }
        setCoverState('ad');
        setCoverStatus('Anuncio de YouTube: el fragmento se repetirá al terminar');
        setFeedback('Anuncio en curso. Pulsa «Saltar anuncio» si aparece.', 'warn');
        return;
      }

      if (!ad && adWaiting) {
        adWaiting = false;
        if (round.ended) return;
        setFeedback('', '');
        setCoverState('playing');
        setCoverStatus('Repitiendo el fragmento…');
        playClip(round.adSeconds || clipFor(round.clipsHeard - 1));
      }
    }, 500);
  }

  function clearClip() {
    clipToken++;
    clipStarted = false;
    if (clipTimer) {
      clearTimeout(clipTimer);
      clipTimer = null;
    }
    if (clipRaf) {
      cancelAnimationFrame(clipRaf);
      clipRaf = 0;
    }
    el.clipBar.style.transform = 'scaleX(0)';
  }

  function pickStart(duration) {    if (!duration || duration < 12) return 0;
    var min = duration * 0.2;
    var max = duration * 0.7;
    if (duration < 45) {
      min = duration * 0.1;
      max = duration * 0.6;
    }
    return Math.floor(min + Math.random() * Math.max(1, max - min));
  }

  function playClip(seconds) {
    var round = game.round;
    if (!round || round.ended || !round.ready) return;

    clearClip();

    var track = round.track;
    var duration = track.duration || 0;
    var length = Math.max(1, Math.min(seconds, duration > 4 ? duration - 2 : seconds));
    var start = track.startAt || 0;

    if (duration > 4) {
      start = Math.min(start, Math.max(0, duration - length - 1));
    } else {
      start = 0;
    }

    round.clipSeconds = length;

    audioPlayAt(start);

    setCoverState('playing');
    setCoverStatus('Escuchando ' + length + ' s…');

    var startedAt = performance.now();
    var total = length * 1000;
    var token = clipToken;

    function frame() {
      if (token !== clipToken || !clipTimer) return;
      var progress = Math.min(1, (performance.now() - startedAt) / total);
      el.clipBar.style.transform = 'scaleX(' + progress + ')';
      if (progress < 1) clipRaf = requestAnimationFrame(frame);
    }
    clipRaf = requestAnimationFrame(frame);

    clipTimer = setTimeout(function () {
      if (token !== clipToken) return;
      clipRaf = 0;
      clipTimer = null;
      audioPause();
      if (!game.round || game.round.ended) return;
      setCoverState('idle');
      setCoverStatus('Fragmento terminado · pulsa ▶ para repetir');
      el.clipBar.style.transform = 'scaleX(0)';
    }, total);

    if (!isSpotify()) startAdWatch(round, length);

    setTimeout(function () {
      if (token !== clipToken) return;
      if (!game.round || game.round !== round || round.ended) return;
      if (audioIsPlaying()) clipStarted = true;
      if (!clipStarted) {
        setCoverStatus('Pulsa ▶ si no suena el audio');
        setCoverState('paused');
      }
    }, 1600);
  }

  /* ---------- Ronda ---------- */

  function clipFor(index) {
    var table = CLIPS[game.difficulty] || CLIPS.normal;
    return table[Math.min(index, table.length - 1)];
  }

  function maxClips() {
    return (CLIPS[game.difficulty] || CLIPS.normal).length;
  }

  function renderAttempts(count) {
    var total = maxClips();
    el.attempts.innerHTML = '';
    for (var i = 0; i < total; i++) {
      var dot = document.createElement('i');
      if (i < count) dot.className = 'on';
      el.attempts.appendChild(dot);
    }
    updateTimeButton();
  }

  function updateTimeButton() {
    var round = game.round;
    var left = round ? maxClips() - round.clipsHeard : 0;
    var usable = Boolean(round && round.ready && !round.ended && left > 0);

    el.moreTimeBtn.disabled = !usable;
    if (!round || !round.ready) {
      el.moreTimeBtn.textContent = 'Más tiempo';
    } else if (left > 0) {
      el.moreTimeBtn.textContent = 'Más tiempo (' + clipFor(round.clipsHeard) + ' s)';
    } else {
      el.moreTimeBtn.textContent = 'Sin más tiempo';
    }
  }

  function updateHud() {
    var position = game.index + 1;
    el.roundLabel.textContent = 'Canción ' + position + ' de ' + game.queue.length;
    var progress = game.queue.length ? game.index / game.queue.length : 0;
    el.progressBar.style.transform = 'scaleX(' + Math.min(1, progress) + ')';
    el.scoreValue.textContent = String(game.score);
  }

  function updateStake() {
    var round = game.round;
    if (!round) {
      el.pointsLabel.textContent = '';
      return;
    }
    var index = Math.max(0, Math.min(round.clipsHeard - 1, POINTS.length - 1));
    var stake = Math.max(5, POINTS[index] - (round.hinted ? HINT_COST : 0));
    el.pointsLabel.textContent = 'En juego: ' + stake + ' pts';
  }

  function startRound() {
    stopAdWatch();
    game.index++;

    if (game.index >= game.queue.length) {
      finishGame();
      return;
    }

    var token = ++game.token;
    var track = game.queue[game.index];
    var round = {
      track: track,
      clipsHeard: 0,
      hinted: false,
      ended: false,
      ready: false,
      points: 0,
      failed: false,
      guesses: [],
      tried: []
    };

    game.round = round;

    el.revealPanel.hidden = true;
    el.guessInput.value = '';
    hideSuggestions();
    el.triedItems.innerHTML = '';
    el.triedList.hidden = true;
    el.guessInput.disabled = true;
    el.guessBtn.disabled = true;
    el.hintBtn.disabled = true;
    el.moreTimeBtn.disabled = true;
    el.replayBtn.disabled = true;
    el.skipBtn.disabled = true;
    el.revealFull.disabled = false;
    el.revealFull.textContent = isSpotify() ? 'Escuchar adelanto' : 'Escuchar completa';
    setFeedback('', '');
    setCoverState('loading');
    setCoverStatus('Buscando la canción…');
    renderAttempts(0);
    updateHud();
    updateStake();

    var prepareStep;

    if (isSpotify()) {
      prepareStep = prepareSpotifyTrack(track);
    } else {
      var metaStep = (track.answers && track.answers.length)
        ? Promise.resolve(true)
        : fetchMeta(track.id).then(function (meta) {
            if (token !== game.token) return false;
            applyMeta(track, meta);
            return true;
          });

      prepareStep = metaStep.then(function (metaOk) {
        if (!metaOk || token !== game.token) return false;
        return cueTrack(track);
      });
    }

    prepareStep
      .then(function (ok) {
        if (token !== game.token || game.round !== round || round.ended) return;

        if (!ok) {
          failTrack(isSpotify()
            ? 'No se pudo cargar este adelanto. Pasando a la siguiente…'
            : 'No se pudo cargar esta canción. Pasando a la siguiente…');
          return;
        }

        round.ready = true;
        track.startAt = pickStart(track.duration);

        el.guessInput.disabled = false;
        el.guessBtn.disabled = false;
        el.hintBtn.disabled = false;
        el.replayBtn.disabled = false;
        el.skipBtn.disabled = false;

        setCoverState('idle');
        setCoverStatus('Pulsa ▶ o espera el fragmento');

        round.clipsHeard = 1;
        renderAttempts(1);
        updateStake();
        playClip(clipFor(0));

        if (window.matchMedia('(min-width: 700px)').matches) {
          el.guessInput.focus();
        }
      })
      .catch(function () {
        if (token !== game.token || game.round !== round) return;
        failTrack('No pudimos obtener el título de esta canción. Pasando a la siguiente…');
      });
  }

  function failTrack(message) {
    var round = game.round;
    if (!round || round.ended) return;

    round.ended = true;
    round.failed = true;
    stopAdWatch();
    clearClip();
    audioPause();

    game.results.push({
      track: round.track,
      solved: false,
      points: 0,
      clipsHeard: 0,
      unavailable: true
    });

    setCoverState('paused');
    setCoverStatus('Canción no disponible');
    setFeedback(message, 'warn');
    hideSuggestions();

    var token = game.token;
    setTimeout(function () {
      if (token !== game.token || game.round !== round) return;
      nextRound();
    }, 1700);
  }

  function skipGuess() {
    var round = game.round;
    if (!round || round.ended || !round.ready) return;
    if (round.clipsHeard >= maxClips()) return;

    round.clipsHeard++;
    renderAttempts(round.clipsHeard);
    updateStake();

    el.guessInput.value = '';
    el.guessInput.focus();
    setFeedback('Saltas la oportunidad y escuchas más tiempo, pero quedan menos puntos en juego.', 'info');
    playClip(clipFor(round.clipsHeard - 1));
  }

  function submitGuess(event) {
    if (event) event.preventDefault();

    var round = game.round;
    if (!round || round.ended || !round.ready) return;

    var value = el.guessInput.value.trim();
    if (!value) {
      el.guessInput.focus();
      return;
    }

    var key = normalize(value) || String(value).trim().toLowerCase();

    if (round.tried.indexOf(key) !== -1) {
      hideSuggestions();
      setFeedback('Ya probaste «' + value + '». Prueba con otro título.', 'warn');
      el.feedback.classList.remove('shake');
      void el.feedback.offsetWidth;
      el.feedback.classList.add('shake');
      el.guessInput.select();
      return;
    }

    if (isCorrect(value, round.track)) {
      revealRound(true);
      return;
    }

    round.tried.push(key);
    round.guesses.push(value);
    renderTried(round);
    hideSuggestions();

    if (round.clipsHeard < maxClips()) {
      round.clipsHeard++;
      renderAttempts(round.clipsHeard);
      updateStake();
      setFeedback('No era esa… escucha un poco más.', 'warn');
      el.feedback.classList.remove('shake');
      void el.feedback.offsetWidth;
      el.feedback.classList.add('shake');
      el.guessInput.value = '';
      el.guessInput.focus();

      var heard = round.clipsHeard;
      setTimeout(function () {
        if (game.round !== round || round.ended) return;
        playClip(clipFor(heard - 1));
      }, 500);
      return;
    }

    revealRound(false);
  }

  function revealRound(solved) {
    var round = game.round;
    if (!round || round.ended) return;

    round.ended = true;
    round.solved = solved;
    stopAdWatch();
    clearClip();
    audioPause();

    var track = round.track;
    var base = POINTS[Math.max(0, Math.min(round.clipsHeard - 1, POINTS.length - 1))];
    var points = solved ? Math.max(5, base - (round.hinted ? HINT_COST : 0)) : 0;

    round.points = points;
    game.score += points;
    el.scoreValue.textContent = String(game.score);

    game.results.push({
      track: track,
      solved: solved,
      points: points,
      clipsHeard: round.clipsHeard,
      unavailable: false
    });

    setCoverState('reveal');
    setCoverStatus(solved ? '¡Bien!' : 'La canción era…');
    el.revealHead.textContent = solved ? '¡Correcto!' : 'No era…';
    el.revealHead.className = 'reveal-head ' + (solved ? 'ok' : 'fail');
    var revealMeta = trackSubtitle(track);
    el.revealSong.textContent = track.title || track.rawTitle || 'Canción';
    el.revealArtist.textContent = revealMeta;
    el.revealArtist.hidden = !revealMeta;
    el.revealLink.href = isSpotify()
      ? 'https://open.spotify.com/track/' + track.id
      : 'https://www.youtube.com/watch?v=' + track.id;
    el.revealLink.textContent = isSpotify() ? 'Ver en Spotify' : 'Ver en YouTube';
    el.revealPanel.hidden = false;

    el.guessInput.disabled = true;
    el.guessBtn.disabled = true;
    el.hintBtn.disabled = true;
    el.moreTimeBtn.disabled = true;
    el.replayBtn.disabled = true;
    el.skipBtn.disabled = true;

    el.revealNext.textContent = (game.index + 1 >= game.queue.length) ? 'Ver resultados →' : 'Siguiente canción →';
    el.revealNext.focus();

    hideSuggestions();
    setFeedback(solved ? '+' + points + ' puntos' : 'Sin puntos esta vez', solved ? 'ok' : 'fail');
    updateStake();
  }

  function nextRound() {
    if (!game.round || !game.round.ended) return;
    game.round = null;
    el.revealPanel.hidden = true;
    startRound();
  }

  function finishGame() {
    game.token++;
    stopAdWatch();
    clearClip();
    audioPause();

    game.round = null;
    el.revealPanel.hidden = true;
    el.progressBar.style.transform = 'scaleX(1)';
    showScreen('results');

    var playable = game.results.filter(function (item) { return !item.unavailable; });
    var solved = playable.filter(function (item) { return item.solved; }).length;
    var total = game.queue.length;
    var unavailable = total - playable.length;

    el.resultsScore.textContent = String(game.score);
    el.resultsSummary.textContent = 'Acertaste ' + solved + ' de ' + playable.length + ' canciones.' +
      (unavailable ? ' ' + unavailable + ' no se pudieron reproducir.' : '');

    el.resultsList.innerHTML = '';

    game.results.forEach(function (result, index) {
      var row = document.createElement('a');
      row.className = 'result-row ' + (result.unavailable ? 'unavailable' : result.solved ? 'ok' : 'fail');
      row.href = isSpotify()
        ? 'https://open.spotify.com/track/' + result.track.id
        : 'https://www.youtube.com/watch?v=' + result.track.id;
      row.target = '_blank';
      row.rel = 'noopener';

      var thumb = document.createElement('img');
      thumb.className = 'result-thumb';
      thumb.src = isSpotify()
        ? (result.track.thumbnail || game.cover)
        : 'https://i.ytimg.com/vi/' + result.track.id + '/default.jpg';
      thumb.alt = '';
      thumb.loading = 'lazy';

      var info = document.createElement('div');
      info.className = 'result-info';

      var song = document.createElement('div');
      song.className = 'result-song';
      song.textContent = result.unavailable
        ? 'Canción ' + (index + 1) + ' (no disponible)'
        : (result.track.title || result.track.rawTitle || 'Canción ' + (index + 1));

      var artist = document.createElement('div');
      artist.className = 'result-artist';
      artist.textContent = result.unavailable
        ? 'No se pudo cargar desde ' + (isSpotify() ? 'Spotify' : 'YouTube')
        : (trackSubtitle(result.track) || 'Artista desconocido');

      info.appendChild(song);
      info.appendChild(artist);

      var badge = document.createElement('div');
      badge.className = 'result-badge';
      badge.textContent = result.unavailable ? '!' : result.solved ? '✓' : '✕';

      var points = document.createElement('div');
      points.className = 'result-points';
      points.textContent = result.unavailable ? '—' : '+' + result.points;

      row.appendChild(thumb);
      row.appendChild(info);
      row.appendChild(points);
      row.appendChild(badge);
      el.resultsList.appendChild(row);
    });
  }

  /* ---------- Juego ---------- */

  function deckKey() {
    return DECK_PREFIX + game.source + ':' + game.playlistId;
  }

  function uniquePool() {
    var seen = {};
    return game.pool.filter(function (track) {
      if (!track || !track.id || seen[track.id]) return false;
      seen[track.id] = true;
      return true;
    });
  }

  function loadDeck() {
    if (!game.playlistId) return [];

    try {
      var saved = JSON.parse(localStorage.getItem(deckKey()) || 'null');
      if (!saved || !Array.isArray(saved.ids)) return [];

      var byId = {};
      game.pool.forEach(function (track) {
        if (track.id) byId[track.id] = track;
      });

      var seen = {};
      return saved.ids.map(function (id) {
        if (!byId[id] || seen[id]) return null;
        seen[id] = true;
        return byId[id];
      }).filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  function saveDeck() {
    if (!game.playlistId) return;

    try {
      var seen = {};
      var ids = [];

      game.deck.slice(game.deckIndex).forEach(function (track) {
        if (!track || !track.id || seen[track.id]) return;
        seen[track.id] = true;
        ids.push(track.id);
      });

      if (!ids.length) {
        localStorage.removeItem(deckKey());
        return;
      }

      localStorage.setItem(deckKey(), JSON.stringify({
        ids: ids,
        at: Date.now()
      }));
    } catch (error) { /* almacenamiento no disponible */ }
  }

  function rebuildDeck() {
    var pool = uniquePool();

    if (!pool.length) {
      game.deck = [];
      game.deckIndex = 0;
      saveDeck();
      return;
    }

    game.deck = shuffle(pool);
    game.deckIndex = 0;
    game.deckLoaded = true;
    saveDeck();
  }

  function drawFromDeck() {
    var available = uniquePool().length;
    var count = game.count > 0 ? Math.min(game.count, available) : available;
    var picked = [];
    var pickedIds = {};

    if (!available) return picked;

    if (!game.deckLoaded) {
      game.deck = loadDeck();
      game.deckIndex = 0;
      game.deckLoaded = true;
    }

    if (!game.deck.length || game.deckIndex >= game.deck.length) rebuildDeck();

    while (picked.length < count && game.deckIndex < game.deck.length) {
      var track = game.deck[game.deckIndex++];
      if (!track || pickedIds[track.id]) continue;

      pickedIds[track.id] = true;
      picked.push(track);
    }

    saveDeck();
    return picked;
  }

  function startGame() {
    game.token++;
    var picked = drawFromDeck();

    game.queue = picked.map(cloneTrack);

    game.index = -1;
    game.score = 0;
    game.results = [];
    game.round = null;

    audioPause();

    el.scoreValue.textContent = '0';
    el.progressBar.style.transform = 'scaleX(0)';
    showScreen('game');
    startRound();
    prefetchPool();
  }

  function beginFromForm() {
    var source = detectSource(el.playlistInput.value);

    if (!source) {
      showStartError('Pega un enlace de playlist de YouTube (con “list=”) o de Spotify.');
      return;
    }

    game.difficulty = el.difficulty.value;
    game.count = Number(el.songCount.value) || 0;
    game.source = source.type;
    game.playlistId = source.id;
    game.cover = '';
    game.deck = [];
    game.deckIndex = 0;
    game.deckLoaded = false;

    showStartError('');
    setBusy(true);

    if (source.type === 'spotify') {
      setStatus('Leyendo la playlist de Spotify…');
      stopAdWatch();
      audioPause();

      fetchSpotifyPlaylist(source.id)
        .then(function (playlist) {
          game.cover = playlist.cover || '';
          game.pool = buildSpotifyTracks(playlist);
          setStatus('Playlist cargada: ' + game.pool.length + ' canciones. ¡Mezclando…!');
          saveConfig();
          startGame();
        })
        .catch(function (error) {
          showStartError(error && error.message ? error.message : 'No se pudo cargar la playlist de Spotify.');
        })
        .then(function () {
          setBusy(false);
          setStatus('');
        });

      return;
    }

    setStatus('Conectando con YouTube…');

    createPlayer()
      .then(function () {
        return fetchPlaylistIds(source.id);
      })
      .then(function (ids) {
        if (!ids.length) throw new Error('La playlist está vacía o es privada.');
        setStatus('Playlist cargada: ' + ids.length + ' canciones. ¡Mezclando…!');
        game.pool = ids.map(function (id) { return { id: id }; });
        saveConfig();
        startGame();
      })
      .catch(function (error) {
        showStartError(error && error.message ? error.message : 'No se pudo cargar la playlist.');
      })
      .then(function () {
        setBusy(false);
        setStatus('');
      });
  }

  function useHint() {
    var round = game.round;
    if (!round || round.ended) return;

    if (round.hinted) {
      setFeedback('Ya usaste la pista de esta canción.', 'warn');
      return;
    }

    round.hinted = true;
    updateStake();

    var words = String(round.track.title || '').split(/\s+/).filter(Boolean);
    var pattern = words.map(function (word) {
      return word.charAt(0).toUpperCase() + '·'.repeat(Math.max(0, word.length - 1));
    }).join('   ');

    setFeedback('Pista: ' + words.length + ' palabra' + (words.length === 1 ? '' : 's') +
      ' · ' + pattern + '  (−' + HINT_COST + ' pts)', 'info');
  }

  function toggleFullSong() {
    var round = game.round;
    if (!round || !round.ended) return;

    if (audioIsPlaying()) {
      audioPause();
      el.revealFull.textContent = isSpotify() ? 'Escuchar adelanto' : 'Escuchar completa';
      return;
    }

    audioPlayFull();
    el.revealFull.textContent = 'Pausar';
  }

  function quitGame() {
    if (!window.confirm('¿Salir de la partida y volver al inicio?')) return;
    game.token++;
    game.round = null;
    stopAdWatch();
    clearClip();
    hideSuggestions();
    audioPause();
    showScreen('start');
  }

  /* ---------- Arranque ---------- */

  el.startBtn.addEventListener('click', beginFromForm);
  el.playlistInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      beginFromForm();
    }
  });
  el.guessForm.addEventListener('submit', submitGuess);
  el.guessInput.addEventListener('input', renderSuggestions);
  el.guessInput.addEventListener('focus', renderSuggestions);
  el.guessInput.addEventListener('blur', function () {
    setTimeout(function () {
      if (document.activeElement !== el.guessInput) hideSuggestions();
    }, 120);
  });
  el.guessInput.addEventListener('keydown', function (event) {
    if (!suggestionsOpen) return;

    var total = el.suggestions.children.length;
    if (!total) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      suggestionIndex = event.key === 'ArrowDown'
        ? (suggestionIndex + 1) % total
        : (suggestionIndex - 1 + total) % total;
      highlightSuggestion(suggestionIndex);
    } else if (event.key === 'Escape') {
      hideSuggestions();
    } else if (event.key === 'Enter' && suggestionIndex >= 0) {
      event.preventDefault();
      chooseSuggestion(suggestionIndex);
    }
  });
  el.hintBtn.addEventListener('click', useHint);
  el.moreTimeBtn.addEventListener('click', skipGuess);
  el.replayBtn.addEventListener('click', function () {
    var round = game.round;
    if (!round || round.ended) return;
    playClip(clipFor(Math.max(0, round.clipsHeard - 1)));
  });
  el.coverPlay.addEventListener('click', function () {
    var round = game.round;
    if (!round || round.ended || !round.ready) return;
    playClip(clipFor(Math.max(0, round.clipsHeard - 1)));
  });
  el.skipBtn.addEventListener('click', function () {
    var round = game.round;
    if (!round || round.ended) return;
    revealRound(false);
  });
  el.revealNext.addEventListener('click', nextRound);
  el.revealFull.addEventListener('click', toggleFullSong);
  el.volume.addEventListener('input', function () {
    volume = Number(el.volume.value) / 100;
    audioSetVolume();
    saveConfig();
  });
  el.playAgain.addEventListener('click', function () {
    if (game.pool.length) startGame();
  });
  el.newPlaylist.addEventListener('click', function () {
    showScreen('start');
    el.playlistInput.focus();
    el.playlistInput.select();
  });
  el.quitBtn.addEventListener('click', quitGame);
  el.songCount.addEventListener('change', function () {
    game.count = Number(el.songCount.value) || 0;
    saveConfig();
  });
  el.difficulty.addEventListener('change', function () {
    game.difficulty = el.difficulty.value;
    saveConfig();
  });
  el.suggestToggle.addEventListener('change', function () {
    game.suggestions = el.suggestToggle.value !== 'no';
    if (game.suggestions) renderSuggestions();
    else hideSuggestions();
    saveConfig();
  });

  loadConfig();
  createPlayer().catch(function () { /* se reintenta al comenzar */ });
})();
