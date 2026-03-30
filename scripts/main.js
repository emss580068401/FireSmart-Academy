(function () {
    'use strict';

    /* ==================== CONFIGURATION ==================== */
    const DIFFICULTY = {
        easy:   { pairs: 8,  cols: 4,  label: '🟢 簡單' },
        medium: { pairs: 12, cols: 6,  label: '🟡 中等' },
        hard:   { pairs: 18, cols: 6,  label: '🔴 困難' },
        hell:   { pairs: 30, cols: 10, label: '🔥 地獄' }
    };

    const STORAGE_KEY = 'fireMemoryLeaderboard';
    const MAX_ENTRIES = 10;
    const FLIP_DELAY = 900;
    const REMOVE_DELAY = 600;

    /* ==================== STATE ==================== */
    let allCardData = [];
    let gameCards = [];
    let flippedEls = [];
    let matchedPairs = 0;
    let totalPairs = 0;
    let flipCount = 0;
    let timerHandle = null;
    let seconds = 0;
    let isLocked = false;
    let currentDifficulty = null;
    let matchedResults = [];
    let currentLeaderboardTab = 'easy';

    /* ==================== DOM REFS ==================== */
    const $ = id => document.getElementById(id);
    const screens = {
        start: $('start-screen'),
        game: $('game-screen')
    };
    const modals = {
        result: $('result-modal'),
        answers: $('answers-modal'),
        leaderboard: $('leaderboard-modal'),
        gallery: $('gallery-modal'),
        lightbox: $('lightbox-modal')
    };

    /* ==================== AUDIO SYSTEM (SYNTHETIC) ==================== */
    let audioCtx = null;
    function playTone(freq, type, duration, vol = 0.1) {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(vol, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    }

    const sfx = {
        flip: () => { playTone(800, 'triangle', 0.1, 0.1); setTimeout(() => playTone(1200, 'sine', 0.1, 0.1), 40); },
        match: () => { playTone(523.25, 'sine', 0.1, 0.25); setTimeout(() => playTone(659.25, 'sine', 0.1, 0.25), 100); setTimeout(() => playTone(783.99, 'sine', 0.3, 0.25), 200); },
        mismatch: () => { playTone(200, 'triangle', 0.1, 0.25); setTimeout(() => playTone(150, 'triangle', 0.2, 0.25), 150); },
        win: () => { [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => setTimeout(() => playTone(f, 'square', 0.2, 0.2), i * 150)); },
        click: () => playTone(600, 'sine', 0.05, 0.1),
        pop: () => { playTone(400, 'sine', 0.1, 0.1); setTimeout(() => playTone(800, 'sine', 0.2, 0.1), 50); },
        hover: () => playTone(1000, 'sine', 0.03, 0.06)
    };

    /* ==================== INIT ==================== */
    async function init() {
        await loadCardData();
        bindEvents();
        createFireParticles();
    }

    async function loadCardData() {
        if (typeof CARDS_DATA !== 'undefined' && Array.isArray(CARDS_DATA)) {
            allCardData = CARDS_DATA;
        } else {
            console.error('Failed to load data/cards.js');
            alert('⚠ 無法讀取 data/cards.js！\n\n系統已暫時使用預設假資料。請確認檔案是否存在。');
            // Fallback: build default data
            allCardData = Array.from({ length: 30 }, (_, i) => {
                const id = String(i + 1).padStart(2, '0');
                return { id, image: `images/${id}.jpg`, text: id, desc: `說明${id}` };
            });
        }
    }

    /* ==================== EVENT BINDING ==================== */
    function bindEvents() {
        // UI Sounds & Auto-play BGM
        let bgmStarted = false;
        document.body.addEventListener('click', (e) => {
            if (!bgmStarted) {
                const bgm = $('bgm');
                if (bgm) {
                    bgm.volume = 0.3; // Limit BGM volume to not overpower SFX
                    bgm.play().catch(err => console.log('BGM Autoplay prevented:', err));
                    bgmStarted = true;
                }
            }
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) sfx.click();
        });

        // Hover sound for cards and buttons
        document.body.addEventListener('mouseover', (e) => {
            const el = e.target.closest('.gallery-card, .answer-card, .btn-difficulty, .btn-action, .btn-game, .btn-result, .tab-btn');
            if (el && !el.dataset.hovered) {
                sfx.hover();
                el.dataset.hovered = 'true';
                el.addEventListener('mouseleave', () => delete el.dataset.hovered, { once: true });
            }
        });

        // Difficulty buttons
        document.querySelectorAll('.btn-difficulty').forEach(btn => {
            btn.addEventListener('click', () => startGame(btn.dataset.difficulty));
        });

        // Start screen actions
        $('btn-leaderboard').addEventListener('click', () => openLeaderboard());
        $('btn-gallery').addEventListener('click', () => openGallery());

        // Game controls
        $('btn-restart').addEventListener('click', () => startGame(currentDifficulty));
        $('btn-back-home').addEventListener('click', goHome);

        // Result modal
        $('btn-save-score').addEventListener('click', saveScore);
        $('btn-view-answers').addEventListener('click', () => openAnswers());
        $('btn-play-again').addEventListener('click', () => {
            closeModal(modals.result);
            startGame(currentDifficulty);
        });
        $('btn-result-home').addEventListener('click', () => {
            closeModal(modals.result);
            goHome();
        });

        // Close buttons
        $('btn-close-answers').addEventListener('click', () => closeModal(modals.answers));
        $('btn-close-leaderboard').addEventListener('click', () => closeModal(modals.leaderboard));
        $('btn-close-gallery').addEventListener('click', () => closeModal(modals.gallery));
        $('btn-close-lightbox').addEventListener('click', () => closeModal(modals.lightbox));

        // Background click to close lightbox
        modals.lightbox.addEventListener('click', (e) => {
            if (e.target === modals.lightbox) closeModal(modals.lightbox);
        });

        // Leaderboard tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                currentLeaderboardTab = btn.dataset.tab;
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderLeaderboardTable(currentLeaderboardTab);
            });
        });

        // Clear leaderboard
        $('btn-clear-leaderboard').addEventListener('click', () => {
            if (confirm(`確定要清除「${DIFFICULTY[currentLeaderboardTab].label}」的所有記錄嗎？`)) {
                clearLeaderboard(currentLeaderboardTab);
                renderLeaderboardTable(currentLeaderboardTab);
            }
        });

        // Close modals on overlay click
        Object.values(modals).forEach(modal => {
            modal.addEventListener('click', e => {
                if (e.target === modal) closeModal(modal);
            });
        });

        // Enter key on name input
        $('player-name').addEventListener('keydown', e => {
            if (e.key === 'Enter') saveScore();
        });
    }

    /* ==================== SCREEN NAVIGATION ==================== */
    function showScreen(screen) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screen.classList.add('active');
    }

    function goHome() {
        stopTimer();
        showScreen(screens.start);
    }

    function openModal(modal) {
        modal.classList.add('active');
    }

    function closeModal(modal) {
        modal.classList.remove('active');
    }

    /* ==================== GAME FLOW ==================== */
    function startGame(difficulty) {
        currentDifficulty = difficulty;
        const config = DIFFICULTY[difficulty];
        totalPairs = config.pairs;
        matchedPairs = 0;
        flipCount = 0;
        seconds = 0;
        flippedEls = [];
        matchedResults = [];
        isLocked = false;

        // Update UI
        $('flip-count').textContent = '0';
        $('match-count').textContent = '0';
        $('total-pairs').textContent = totalPairs;
        $('timer').textContent = '00:00';
        $('progress-bar').style.width = '0%';

        // Generate cards
        gameCards = generateCards(config.pairs);

        // Setup board
        const board = $('game-board');
        board.className = 'game-board diff-' + difficulty;
        board.innerHTML = '';

        gameCards.forEach((card, idx) => {
            const el = createCardElement(card, idx);
            board.appendChild(el);
        });

        showScreen(screens.game);
        startTimer();
    }

    function generateCards(numPairs) {
        // Randomly select numPairs from allCardData
        const shuffled = [...allCardData].sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, numPairs);

        const cards = [];
        selected.forEach(pair => {
            // Image card
            cards.push({
                pairId: pair.id,
                type: 'image',
                content: pair.image,
                text: pair.text,
                desc: pair.desc
            });
            // Text card
            cards.push({
                pairId: pair.id,
                type: 'text',
                content: pair.text,
                image: pair.image,
                desc: pair.desc
            });
        });

        // Fisher-Yates shuffle
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }

        return cards;
    }

    function createCardElement(card, index) {
        const el = document.createElement('div');
        el.className = 'card';
        el.dataset.pairId = card.pairId;
        el.dataset.type = card.type;
        el.dataset.index = index;
        el.style.animationDelay = `${index * 30}ms`;

        // Front face (revealed)
        const front = document.createElement('div');
        front.className = 'card-face card-front';

        if (card.type === 'image') {
            front.classList.add('image-face');
            const img = document.createElement('img');
            img.src = card.content;
            img.alt = `圖片 ${card.pairId}`;
            img.loading = 'lazy';
            front.appendChild(img);
        } else {
            front.classList.add('text-face');

            const text = document.createElement('span');
            text.className = 'text-content';
            text.textContent = card.content;
            front.appendChild(text);
        }

        // Back face (visible by default)
        const back = document.createElement('div');
        back.className = 'card-face card-back';
        back.innerHTML = `<img class="back-logo" src="卡牌logo.png" alt="消防局"><span class="back-text">職安科</span>`;

        // Inner container for 3D flip
        const inner = document.createElement('div');
        inner.className = 'card-inner';

        inner.appendChild(front);
        inner.appendChild(back);
        el.appendChild(inner);

        el.addEventListener('click', () => handleCardClick(el));

        return el;
    }

    /* ==================== CARD INTERACTION ==================== */
    function handleCardClick(el) {
        if (isLocked) return;
        if (el.classList.contains('flipped')) return;
        if (el.classList.contains('matched')) return;

        sfx.flip();
        el.classList.add('flipped');
        flippedEls.push(el);
        flipCount++;
        $('flip-count').textContent = flipCount;

        if (flippedEls.length === 2) {
            isLocked = true;
            checkMatch();
        }
    }

    function checkMatch() {
        const [a, b] = flippedEls;
        const sameId = a.dataset.pairId === b.dataset.pairId;
        const diffType = a.dataset.type !== b.dataset.type;

        if (sameId && diffType) {
            handleMatch(a, b);
        } else {
            handleMismatch(a, b);
        }
    }

    function handleMatch(a, b) {
        sfx.match();
        a.classList.add('matched');
        b.classList.add('matched');
        matchedPairs++;
        $('match-count').textContent = matchedPairs;
        $('progress-bar').style.width = `${(matchedPairs / totalPairs) * 100}%`;

        // Store result
        const pairId = a.dataset.pairId;
        const pairData = allCardData.find(d => d.id === pairId);
        if (pairData) matchedResults.push(pairData);

        // Show toast
        showToast(`✅ 配對成功：${pairData ? pairData.desc : `說明${pairId}`}`);

        // Remove animation
        setTimeout(() => {
            a.classList.add('removing');
            b.classList.add('removing');
        }, REMOVE_DELAY);

        flippedEls = [];
        isLocked = false;

        if (matchedPairs === totalPairs) {
            setTimeout(() => gameComplete(), REMOVE_DELAY + 400);
        }
    }

    function handleMismatch(a, b) {
        sfx.mismatch();
        a.classList.add('shake');
        b.classList.add('shake');

        setTimeout(() => {
            a.classList.remove('flipped', 'shake');
            b.classList.remove('flipped', 'shake');
            flippedEls = [];
            isLocked = false;
        }, FLIP_DELAY);
    }

    /* ==================== TIMER ==================== */
    function startTimer() {
        stopTimer();
        seconds = 0;
        timerHandle = setInterval(() => {
            seconds++;
            $('timer').textContent = formatTime(seconds);
        }, 1000);
    }

    function stopTimer() {
        if (timerHandle) {
            clearInterval(timerHandle);
            timerHandle = null;
        }
    }

    function formatTime(sec) {
        const m = String(Math.floor(sec / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        return `${m}:${s}`;
    }

    /* ==================== GAME COMPLETE ==================== */
    function gameComplete() {
        stopTimer();
        sfx.win();
        startCelebration();

        $('result-time').textContent = formatTime(seconds);
        $('result-flips').textContent = flipCount;
        $('result-difficulty').textContent = DIFFICULTY[currentDifficulty].label;

        // Check leaderboard qualification
        const qualifies = qualifiesForLeaderboard(currentDifficulty, seconds);
        const entryEl = $('leaderboard-entry');
        if (qualifies) {
            entryEl.style.display = 'block';
            $('player-name').value = '';
            $('btn-save-score').disabled = false;
            $('btn-save-score').textContent = '儲存成績';
        } else {
            entryEl.style.display = 'none';
        }

        openModal(modals.result);
    }

    /* ==================== TOAST ==================== */
    function showToast(msg) {
        const container = $('toast-container');
        const toast = document.createElement('div');
        toast.className = 'match-toast';
        toast.textContent = msg;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }, 2000);
    }

    /* ==================== LEADERBOARD ==================== */
    function getLeaderboard(difficulty) {
        try {
            const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return data[difficulty] || [];
        } catch {
            return [];
        }
    }

    function setLeaderboard(difficulty, entries) {
        try {
            const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            data[difficulty] = entries;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch { /* ignore */ }
    }

    function qualifiesForLeaderboard(difficulty, time) {
        const board = getLeaderboard(difficulty);
        if (board.length < MAX_ENTRIES) return true;
        return time < board[board.length - 1].time;
    }

    function addToLeaderboard(difficulty, name, time, flips) {
        const board = getLeaderboard(difficulty);
        board.push({
            name,
            time,
            flips,
            date: new Date().toLocaleDateString('zh-TW')
        });
        // Sort: time ascending, then flips ascending
        board.sort((a, b) => a.time - b.time || a.flips - b.flips);
        // Keep top N
        setLeaderboard(difficulty, board.slice(0, MAX_ENTRIES));
    }

    function clearLeaderboard(difficulty) {
        setLeaderboard(difficulty, []);
    }

    function saveScore() {
        const name = $('player-name').value.trim();
        if (!name) {
            $('player-name').focus();
            $('player-name').style.borderColor = 'var(--fire-red)';
            setTimeout(() => $('player-name').style.borderColor = '', 1000);
            return;
        }
        addToLeaderboard(currentDifficulty, name, seconds, flipCount);
        $('btn-save-score').disabled = true;
        $('btn-save-score').textContent = '✅ 已儲存';
    }

    function openLeaderboard() {
        currentLeaderboardTab = 'easy';
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === 'easy');
        });
        renderLeaderboardTable('easy');
        openModal(modals.leaderboard);
    }

    function renderLeaderboardTable(difficulty) {
        const board = getLeaderboard(difficulty);
        const container = $('leaderboard-body');

        if (board.length === 0) {
            container.innerHTML = `<div class="leaderboard-empty">🏆 目前沒有記錄<br>快來挑戰吧！</div>`;
            return;
        }

        const rankEmojis = ['🥇', '🥈', '🥉'];
        let html = `
            <table class="leaderboard-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>暱稱</th>
                        <th>時間</th>
                        <th>翻牌</th>
                        <th>日期</th>
                    </tr>
                </thead>
                <tbody>`;

        board.forEach((entry, i) => {
            const rankClass = i < 3 ? ` rank-${i + 1}` : '';
            const rankDisplay = i < 3 ? rankEmojis[i] : i + 1;
            html += `
                <tr>
                    <td class="rank${rankClass}">${rankDisplay}</td>
                    <td class="name">${escapeHtml(entry.name)}</td>
                    <td class="time">${formatTime(entry.time)}</td>
                    <td class="flips">${entry.flips} 次</td>
                    <td class="date">${entry.date}</td>
                </tr>`;
        });

        html += `</tbody></table>`;
        container.innerHTML = html;
    }

    /* ==================== GALLERY ==================== */
    function openGallery() {
        const grid = $('gallery-grid');
        grid.innerHTML = '';

        allCardData.forEach(pair => {
            const card = document.createElement('div');
            card.className = 'gallery-card';
            card.innerHTML = `
                <img class="gallery-card-img" src="${pair.image}" alt="圖片 ${pair.id}" loading="lazy" onclick="window.viewOriginal('${pair.image}')">
                <div class="gallery-card-text">
                    <span class="card-desc">【${escapeHtml(pair.text)}】<br>${escapeHtml(pair.desc || '')}</span>
                </div>`;
            grid.appendChild(card);
        });

        openModal(modals.gallery);
    }

    /* ==================== ANSWERS REVIEW ==================== */
    function openAnswers() {
        const grid = $('answers-grid');
        grid.innerHTML = '';

        matchedResults.forEach(pair => {
            const card = document.createElement('div');
            card.className = 'answer-card';
            card.innerHTML = `
                <img class="answer-card-img" src="${pair.image}" alt="圖片 ${pair.id}" loading="lazy" onclick="window.viewOriginal('${pair.image}')">
                <div class="answer-card-text">
                    <span class="card-desc">【${escapeHtml(pair.text)}】<br>${escapeHtml(pair.desc || '')}</span>
                </div>`;
            grid.appendChild(card);
        });

        openModal(modals.answers);
    }

    /* ==================== LIGHTBOX ==================== */
    window.viewOriginal = function(src) {
        const img = $('lightbox-img');
        if (img) {
            sfx.pop();
            img.src = src;
            openModal(modals.lightbox);
        }
    };

    /* ==================== CELEBRATION FIREWORKS ==================== */
    function startCelebration() {
        const canvas = $('celebration-canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        canvas.style.display = 'block';

        const particles = [];
        const colors = ['#e63946', '#ff6b35', '#ffd700', '#ffffff', '#2ecc71', '#ff4500', '#ff69b4'];

        function createBurst(x, y) {
            const count = 40 + Math.floor(Math.random() * 20);
            for (let i = 0; i < count; i++) {
                const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.3;
                const speed = 2 + Math.random() * 5;
                particles.push({
                    x, y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    life: 1,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    size: 1.5 + Math.random() * 3,
                    trail: []
                });
            }
        }

        let burstCount = 0;
        const maxBursts = 12;
        const burstInterval = setInterval(() => {
            createBurst(
                canvas.width * 0.15 + Math.random() * canvas.width * 0.7,
                canvas.height * 0.1 + Math.random() * canvas.height * 0.5
            );
            burstCount++;
            if (burstCount >= maxBursts) clearInterval(burstInterval);
        }, 350);

        let animFrame;
        function animate() {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.trail.push({ x: p.x, y: p.y });
                if (p.trail.length > 4) p.trail.shift();

                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.06;
                p.vx *= 0.99;
                p.life -= 0.012;

                if (p.life <= 0) {
                    particles.splice(i, 1);
                    continue;
                }

                // Draw trail
                p.trail.forEach((t, ti) => {
                    const alpha = (ti / p.trail.length) * p.life * 0.4;
                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = p.color;
                    ctx.beginPath();
                    ctx.arc(t.x, t.y, p.size * 0.5, 0, Math.PI * 2);
                    ctx.fill();
                });

                // Draw particle
                ctx.globalAlpha = p.life;
                ctx.fillStyle = p.color;
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }

            ctx.globalAlpha = 1;

            if (particles.length > 0 || burstCount < maxBursts) {
                animFrame = requestAnimationFrame(animate);
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                canvas.style.display = 'none';
                cancelAnimationFrame(animFrame);
            }
        }

        animate();
    }

    /* ==================== FIRE PARTICLES (AMBIENT) ==================== */
    function createFireParticles() {
        const container = $('fire-particles');
        const count = 25;

        for (let i = 0; i < count; i++) {
            const particle = document.createElement('div');
            particle.className = 'fire-particle';
            const size = 2 + Math.random() * 5;
            const hue = 15 + Math.random() * 30; // orange-red range
            particle.style.cssText = `
                width: ${size}px;
                height: ${size}px;
                left: ${Math.random() * 100}%;
                bottom: ${-10 - Math.random() * 20}%;
                background: hsl(${hue}, 100%, ${50 + Math.random() * 20}%);
                animation-duration: ${4 + Math.random() * 6}s;
                animation-delay: ${Math.random() * 6}s;
                box-shadow: 0 0 ${size * 2}px hsl(${hue}, 100%, 50%);
            `;
            container.appendChild(particle);
        }
    }

    /* ==================== UTILITIES ==================== */
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /* ==================== BOOT ==================== */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
