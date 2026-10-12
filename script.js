
const canvas = document.getElementById("gameBoard");
const ctx = canvas.getContext("2d");

const cellSize = 20;
const gridSize = canvas.width / cellSize;

const $ = id => document.getElementById(id);

const scoreElement = $("score");
const highScoreElement = $("highScore");
const finalScoreElement = $("finalScore");
const startScreen = $("startScreen");
const gameOverScreen = $("gameOver");
const gameOverTitle = $("gameOverTitle");
const startButton = $("startButton");
const restartButton = $("restartButton");
const difficultySelect = $("difficulty");
const pauseButton = $("pauseButton");
const soundButton = $("soundButton");
const vfxButton = $("vfxButton");
const boardWrapper = $("boardWrapper");

const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
);

let snake = [];
let food = null;
let direction = { x: 1, y: 0 };

let score = 0;
let highScore = 0;
let gameRunning = false;
let gamePaused = false;
let soundEnabled = true;
let vfxEnabled = true;

let gameInterval = null;
let moveDelay = 160;
let directionChangedThisTick = false;

let particles = [];
let floatingTexts = [];
let flashUntil = 0;
let flashColor = "#ff526b";
let lastImpactAt = 0;
let lastFrameTime = 0;

const animationDuration = 180;

try {
    highScore = Number(localStorage.getItem("snakeHighScore")) || 0;
} catch {
    highScore = 0;
}

highScoreElement.textContent = highScore;

// ---------- AUDIO ----------

let audioContext = null;

function playSound(frequency = 440, duration = 0.1) {
    if (!soundEnabled) return;

    try {
        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) return;

        if (!audioContext) {
            audioContext = new AudioContextClass();
        }

        if (audioContext.state === "suspended") {
            audioContext.resume();
        }

        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value = frequency;

        gain.gain.setValueAtTime(0.06, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(
            0.001,
            audioContext.currentTime + duration
        );

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.start();
        oscillator.stop(audioContext.currentTime + duration);
    } catch {
        // Audio is optional; gameplay continues without it.
    }
}

// ---------- HIGH SCORE ----------

function saveHighScore() {
    if (score <= highScore) return;

    highScore = score;
    highScoreElement.textContent = highScore;

    try {
        localStorage.setItem("snakeHighScore", String(highScore));
    } catch {
        // The current session still retains the score.
    }
}

function animateScore() {
    scoreElement.classList.remove("score-pop");

    // Restart the short CSS animation.
    void scoreElement.offsetWidth;
    scoreElement.classList.add("score-pop");
}

// ---------- VISUAL EFFECTS ----------

function cellCenter(position) {
    return {
        x: position.x * cellSize + cellSize / 2,
        y: position.y * cellSize + cellSize / 2
    };
}

function burstParticles(position, color = "#63ffad", count = 18) {
    if (!vfxEnabled || reducedMotion.matches) return;

    const center = cellCenter(position);

    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 35 + Math.random() * 115;
        const life = 0.35 + Math.random() * 0.4;

        particles.push({
            x: center.x,
            y: center.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life,
            maxLife: life,
            size: 1.5 + Math.random() * 3,
            color
        });
    }

    // Keep the effect pool bounded.
    if (particles.length > 250) {
        particles.splice(0, particles.length - 250);
    }
}

function addFloatingText(position, text, color = "#63ffad") {
    if (!vfxEnabled || reducedMotion.matches) return;

    const center = cellCenter(position);

    floatingTexts.push({
        x: center.x,
        y: center.y,
        text,
        color,
        life: 0.65,
        maxLife: 0.65
    });
}

function triggerImpact() {
    const now = performance.now();

    flashColor = "#ff526b";
    flashUntil = now + 180;

    if (
        vfxEnabled &&
        !reducedMotion.matches &&
        now - lastImpactAt > 300
    ) {
        boardWrapper.classList.remove("impact");
        void boardWrapper.offsetWidth;
        boardWrapper.classList.add("impact");
        lastImpactAt = now;
    }
}

function updateEffects(deltaTime) {
    const dt = Math.min(deltaTime, 0.04);

    particles.forEach(particle => {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;

        particle.vx *= Math.pow(0.12, dt);
        particle.vy *= Math.pow(0.12, dt);

        particle.life -= dt;
    });

    particles = particles.filter(particle => particle.life > 0);

    floatingTexts.forEach(item => {
        item.y -= 28 * dt;
        item.life -= dt;
    });

    floatingTexts = floatingTexts.filter(item => item.life > 0);
}

function drawParticles() {
    if (!vfxEnabled) return;

    particles.forEach(particle => {
        const alpha = Math.max(0, particle.life / particle.maxLife);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = particle.color;

        ctx.shadowColor = particle.color;
        ctx.shadowBlur = 12;

        ctx.beginPath();
        ctx.arc(
            particle.x,
            particle.y,
            particle.size * (0.5 + alpha * 0.5),
            0,
            Math.PI * 2
        );
        ctx.fill();
        ctx.restore();
    });

    floatingTexts.forEach(item => {
        const alpha = Math.max(0, item.life / item.maxLife);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = item.color;
        ctx.shadowColor = item.color;
        ctx.shadowBlur = 12;
        ctx.font = "bold 16px Arial";
        ctx.textAlign = "center";
        ctx.fillText(item.text, item.x, item.y);
        ctx.restore();
    });
}

// ---------- FOOD ----------

function generateFood() {
    const emptyCells = [];

    for (let x = 0; x < gridSize; x++) {
        for (let y = 0; y < gridSize; y++) {
            const occupied = snake.some(segment =>
                segment.x === x && segment.y === y
            );

            if (!occupied) {
                emptyCells.push({ x, y });
            }
        }
    }

    if (emptyCells.length === 0) {
        food = null;
        endGame(true);
        return;
    }

    food = emptyCells[
        Math.floor(Math.random() * emptyCells.length)
    ];
}

// ---------- DRAWING ----------

function drawBoard(now = performance.now()) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dark board background
    ctx.fillStyle = "#09130f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle grid
    ctx.strokeStyle = "#1b3028";
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let i = 0; i <= canvas.width; i += cellSize) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
    }

    ctx.stroke();

    // Food pulse and glow
    if (food) {
        const center = cellCenter(food);
        const pulse = vfxEnabled
            ? 1 + Math.sin(now / 170) * 0.12
            : 1;

        ctx.save();

        ctx.translate(center.x, center.y);
        ctx.scale(pulse, pulse);

        if (vfxEnabled) {
            ctx.shadowColor = "#ff526b";
            ctx.shadowBlur = 18;
        }

        ctx.fillStyle = "#ff526b";
        ctx.beginPath();
        ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ffe2e7";
        ctx.beginPath();
        ctx.arc(-2, -2, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    // Snake glow
    snake.forEach((segment, index) => {
        const x = segment.x * cellSize;
        const y = segment.y * cellSize;
        const inset = index === 0 ? 2 : 2.5;
        const size = cellSize - inset * 2;

        ctx.save();

        if (vfxEnabled) {
            ctx.shadowColor = index === 0 ? "#63ffad" : "#24df89";
            ctx.shadowBlur = index === 0 ? 17 : 9;
        }

        ctx.fillStyle = index === 0 ? "#b1ffd1" : "#42ed9a";
        ctx.beginPath();
        ctx.roundRect(
            x + inset,
            y + inset,
            size,
            size,
            index === 0 ? 6 : 4
        );
        ctx.fill();

        // Eyes on the snake's head
        if (index === 0) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = "#09251a";

            let eye1;
            let eye2;

            if (direction.x !== 0) {
                eye1 = { x: x + 10 + direction.x * 4, y: y + 6 };
                eye2 = { x: x + 10 + direction.x * 4, y: y + 14 };
            } else {
                eye1 = { x: x + 6, y: y + 10 + direction.y * 4 };
                eye2 = { x: x + 14, y: y + 10 + direction.y * 4 };
            }

            for (const eye of [eye1, eye2]) {
                ctx.beginPath();
                ctx.arc(eye.x, eye.y, 1.7, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.restore();
    });

    // Collection particles and floating score
    drawParticles();

    // Brief red overlay on collision
    if (vfxEnabled && now < flashUntil) {
        const alpha = (flashUntil - now) / 180;

        ctx.fillStyle = `rgba(255, 40, 75, ${alpha * 0.19})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Pause overlay
    if (gamePaused) {
        ctx.fillStyle = "rgba(4, 12, 10, 0.76)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#63ffad";
        ctx.font = "bold 30px Arial";
        ctx.shadowColor = "#63ffad";
        ctx.shadowBlur = vfxEnabled ? 18 : 0;

        ctx.fillText("PAUSED", canvas.width / 2, canvas.height / 2);

        ctx.shadowBlur = 0;
    }
}

// Separate render loop for smooth VFX
function renderFrame(now) {
    const deltaTime = lastFrameTime
        ? (now - lastFrameTime) / 1000
        : 0;

    lastFrameTime = now;

    updateEffects(deltaTime);
    drawBoard(now);

    requestAnimationFrame(renderFrame);
}

// ---------- GAME STATE ----------

function resetGame() {
    snake = [{ x: 10, y: 10 }];
    direction = { x: 1, y: 0 };

    score = 0;
    scoreElement.textContent = score;
    finalScoreElement.textContent = score;

    gamePaused = false;
    directionChangedThisTick = false;

    particles = [];
    floatingTexts = [];
    flashUntil = 0;

    food = null;
    generateFood();
    drawBoard();
}

function startGame() {
    clearInterval(gameInterval);
    gameInterval = null;

    gameRunning = false;
    gamePaused = false;

    resetGame();

    moveDelay = Number(difficultySelect.value) || 160;
    gameRunning = true;

    startScreen.hidden = true;
    gameOverScreen.hidden = true;

    pauseButton.disabled = false;
    pauseButton.textContent = "Ⅱ Pause";

    gameInterval = setInterval(moveSnake, moveDelay);
}

function saveHighScore() {
    if (score <= highScore) return;

    highScore = score;
    highScoreElement.textContent = highScore;

    try {
        localStorage.setItem("snakeHighScore", String(highScore));
    } catch {
        // Continue without persistent storage if unavailable.
    }
}

function endGame(won = false) {
    gameRunning = false;
    gamePaused = false;

    clearInterval(gameInterval);
    gameInterval = null;

    saveHighScore();

    finalScoreElement.textContent = score;
    gameOverTitle.textContent = won ? "YOU WIN!" : "GAME OVER";

    gameOverScreen.hidden = false;

    pauseButton.disabled = true;
    pauseButton.textContent = "Ⅱ Pause";

    if (!won) {
        triggerImpact();
    }

    playSound(won ? 760 : 180, 0.25);
}

function togglePause() {
    if (!gameRunning) return;

    gamePaused = !gamePaused;

    if (gamePaused) {
        clearInterval(gameInterval);
        gameInterval = null;
        pauseButton.textContent = "▶ Resume";
    } else {
        directionChangedThisTick = false;
        gameInterval = setInterval(moveSnake, moveDelay);
        pauseButton.textContent = "Ⅱ Pause";
    }

    drawBoard();
}

// ---------- MOVEMENT ----------

function changeDirection(newDirection) {
    if (!gameRunning || gamePaused || directionChangedThisTick) {
        return;
    }

    if (
        newDirection.x === -direction.x &&
        newDirection.y === -direction.y
    ) {
        return;
    }

    direction = newDirection;
    directionChangedThisTick = true;
}

function moveSnake() {
    if (!gameRunning || gamePaused) return;

    directionChangedThisTick = false;

    const head = snake[0];

    const newHead = {
        x: head.x + direction.x,
        y: head.y + direction.y
    };

    // Wall collision
    if (
        newHead.x < 0 ||
        newHead.x >= gridSize ||
        newHead.y < 0 ||
        newHead.y >= gridSize
    ) {
        triggerImpact();
        endGame(false);
        return;
    }

    const ateFood =
        food &&
        newHead.x === food.x &&
        newHead.y === food.y;

    // The tail moves away if food isn't eaten.
    const bodyToCheck = ateFood ? snake : snake.slice(0, -1);

    const hitSelf = bodyToCheck.some(segment =>
        segment.x === newHead.x &&
        segment.y === newHead.y
    );

    if (hitSelf) {
        triggerImpact();
        endGame(false);
        return;
    }

    snake.unshift(newHead);

    if (ateFood) {
        burstParticles(food, "#63ffad", 24);
        addFloatingText(food, "+1");

        score++;
        scoreElement.textContent = score;
        animateScore();

        saveHighScore();
        playSound(600, 0.08);

        generateFood();

        if (!gameRunning) return;
    } else {
        snake.pop();
    }

    drawBoard();
}

// ---------- CONTROLS ----------

document.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();

    if (
        ["arrowup", "arrowdown", "arrowleft", "arrowright",
         " ", "w", "a", "s", "d"].includes(key)
    ) {
        event.preventDefault();
    }

    if (key === " ") {
        togglePause();
        return;
    }

    const directions = {
        arrowup: { x: 0, y: -1 },
        w: { x: 0, y: -1 },

        arrowdown: { x: 0, y: 1 },
        s: { x: 0, y: 1 },

        arrowleft: { x: -1, y: 0 },
        a: { x: -1, y: 0 },

        arrowright: { x: 1, y: 0 },
        d: { x: 1, y: 0 }
    };

    if (directions[key]) {
        changeDirection(directions[key]);
    }
});

// Mobile directional pad
document.querySelectorAll("[data-direction]").forEach(button => {
    button.addEventListener("click", () => {
        const directions = {
            up: { x: 0, y: -1 },
            down: { x: 0, y: 1 },
            left: { x: -1, y: 0 },
            right: { x: 1, y: 0 }
        };

        changeDirection(directions[button.dataset.direction]);
    });
});

// Swipe gestures
let swipeStartX = 0;
let swipeStartY = 0;

canvas.addEventListener("pointerdown", event => {
    swipeStartX = event.clientX;
    swipeStartY = event.clientY;
});

canvas.addEventListener("pointerup", event => {
    const dx = event.clientX - swipeStartX;
    const dy = event.clientY - swipeStartY;

    if (Math.max(Math.abs(dx), Math.abs(dy)) < 25) return;

    if (Math.abs(dx) > Math.abs(dy)) {
        changeDirection(
            dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 }
        );
    } else {
        changeDirection(
            dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 }
        );
    }
});

// UI buttons
startButton.addEventListener("click", startGame);
restartButton.addEventListener("click", startGame);
pauseButton.addEventListener("click", togglePause);

soundButton.addEventListener("click", () => {
    soundEnabled = !soundEnabled;

    soundButton.textContent = soundEnabled
        ? "♫ Sound: On"
        : "♫ Sound: Off";

    if (soundEnabled) playSound(440, 0.08);
});

vfxButton.addEventListener("click", () => {
    vfxEnabled = !vfxEnabled;

    vfxButton.textContent = vfxEnabled
        ? "✦ VFX: On"
        : "✦ VFX: Off";

    vfxButton.setAttribute("aria-pressed", String(vfxEnabled));

    if (!vfxEnabled) {
        particles = [];
        floatingTexts = [];
        boardWrapper.classList.remove("impact");
    }
});

// Initial screen and continuous renderer
resetGame();
requestAnimationFrame(renderFrame);
