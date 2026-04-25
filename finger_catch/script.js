import {
    HandLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.js";

// --- Game State & DOM Elements ---
const video = document.getElementById("webcam");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const startScreen = document.getElementById("start-screen");
const gameOverScreen = document.getElementById("game-over-screen");
const hud = document.getElementById("hud");
const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");
const loadingStatus = document.getElementById("loading-status");
const scoreEl = document.getElementById("score");
const livesEl = document.getElementById("lives");
const finalScoreEl = document.getElementById("final-score");

// Game configuration
const GAME_CONFIG = {
    initialLives: 3,
    baseSpawnRate: 60, // frames between spawns initially
    minSpawnRate: 20,
    speedMultiplier: 1.0,
    paddleWidth: 100,
    paddleHeight: 20,
    paddleColor: "#00ffcc",
    particleCount: 15
};

// Game state variables
let state = {
    isPlaying: false,
    score: 0,
    lives: GAME_CONFIG.initialLives,
    spawnTimer: 0,
    currentSpawnRate: GAME_CONFIG.baseSpawnRate,
    objects: [],
    particles: [],
    fingerX: null,
    fingerY: null,
    paddleX: 0
};

// MediaPipe variables
let handLandmarker = undefined;
let webcamRunning = false;
let lastVideoTime = -1;

// --- Initialization ---

// Resize canvas to fit window
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // Set initial paddle position to center
    if (!state.isPlaying && state.fingerX === null) {
        state.paddleX = canvas.width / 2;
    }
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Initialize MediaPipe Hand Landmarker
async function initializeMediaPipe() {
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 1
        });

        loadingStatus.innerText = "Camera access required...";
        setupWebcam();
    } catch (error) {
        console.error("Error initializing MediaPipe:", error);
        loadingStatus.innerText = "Error loading AI Model. Please refresh.";
        loadingStatus.style.color = "red";
    }
}

// Set up Webcam
async function setupWebcam() {
    const constraints = {
        video: { width: 1280, height: 720, facingMode: "user" }
    };

    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        video.addEventListener("loadeddata", () => {
            webcamRunning = true;
            loadingStatus.innerText = "Ready!";
            loadingStatus.style.color = "#00ffcc";
            startBtn.disabled = false;
            startBtn.innerText = "Start Game";
        });
    } catch (error) {
        console.error("Error accessing webcam:", error);
        loadingStatus.innerText = "Webcam access denied or unavailable.";
        loadingStatus.style.color = "red";
    }
}

// --- Game Mechanics ---

class GameObject {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type; // 'good' (⭐) or 'bad' (💣)
        this.size = 30;
        this.speed = (Math.random() * 3 + 2) * (GAME_CONFIG.baseSpawnRate / state.currentSpawnRate); // Base speed based on difficulty
        this.rotation = Math.random() * Math.PI * 2;
        this.rotSpeed = (Math.random() - 0.5) * 0.1;
    }

    update() {
        this.y += this.speed;
        this.rotation += this.rotSpeed;
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.font = `${this.size}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // Since canvas is mirrored, we must un-mirror the text so emojis look right
        ctx.scale(-1, 1);
        ctx.fillText(this.type === 'good' ? "⭐" : "💣", 0, 0);
        ctx.restore();
    }
}

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.size = Math.random() * 5 + 2;
        this.vx = (Math.random() - 0.5) * 10;
        this.vy = (Math.random() - 0.5) * 10;
        this.life = 1.0;
        this.decay = Math.random() * 0.05 + 0.02;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function spawnObject() {
    const x = Math.random() * (canvas.width - 60) + 30; // Keep away from edges
    const isBad = Math.random() < 0.2; // 20% chance for a bomb
    state.objects.push(new GameObject(x, -50, isBad ? 'bad' : 'good'));
}

function createParticles(x, y, color) {
    for (let i = 0; i < GAME_CONFIG.particleCount; i++) {
        state.particles.push(new Particle(x, y, color));
    }
}

function updateGameLogic() {
    if (!state.isPlaying) return;

    // Difficulty progression
    state.currentSpawnRate = Math.max(GAME_CONFIG.minSpawnRate, GAME_CONFIG.baseSpawnRate - (state.score * 0.5));

    // Spawning
    state.spawnTimer++;
    if (state.spawnTimer >= state.currentSpawnRate) {
        spawnObject();
        state.spawnTimer = 0;
    }

    // Update Paddle Position (smooth follow finger X)
    if (state.fingerX !== null) {
        // Linear interpolation for smoother movement
        state.paddleX += (state.fingerX - state.paddleX) * 0.2;
    }
    const paddleY = canvas.height - GAME_CONFIG.paddleHeight - 20;

    // Update and check collisions for objects
    for (let i = state.objects.length - 1; i >= 0; i--) {
        let obj = state.objects[i];
        obj.update();

        // Check collision with paddle
        // Paddle is centered at paddleX
        const paddleLeft = state.paddleX - GAME_CONFIG.paddleWidth / 2;
        const paddleRight = state.paddleX + GAME_CONFIG.paddleWidth / 2;
        const paddleTop = paddleY;
        const paddleBottom = paddleY + GAME_CONFIG.paddleHeight;

        if (obj.y + obj.size/2 >= paddleTop && obj.y - obj.size/2 <= paddleBottom &&
            obj.x + obj.size/2 >= paddleLeft && obj.x - obj.size/2 <= paddleRight) {

            // Caught
            if (obj.type === 'good') {
                state.score += 10;
                scoreEl.innerText = state.score;
                createParticles(obj.x, obj.y, "#ffff00"); // Yellow particles
            } else {
                state.lives--;
                updateLivesDisplay();
                createParticles(obj.x, obj.y, "#ff0000"); // Red particles

                // Camera shake effect hack
                canvas.style.transform = `scaleX(-1) translate(${Math.random()*10-5}px, ${Math.random()*10-5}px)`;
                setTimeout(() => canvas.style.transform = 'scaleX(-1)', 100);

                if (state.lives <= 0) {
                    gameOver();
                }
            }
            state.objects.splice(i, 1);
            continue;
        }

        // Remove if off screen
        if (obj.y > canvas.height + 50) {
            if (obj.type === 'good') {
                // Optional: penalize for missing good objects?
                // For now, no penalty.
            }
            state.objects.splice(i, 1);
        }
    }

    // Update particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
        state.particles[i].update();
        if (state.particles[i].life <= 0) {
            state.particles.splice(i, 1);
        }
    }
}

function updateLivesDisplay() {
    let hearts = "";
    for(let i=0; i<state.lives; i++) hearts += "❤️";
    livesEl.innerText = `${state.lives} ${hearts}`;
}

// --- Rendering ---

function drawWebcamFeed() {
    // Draw video covering the canvas while maintaining aspect ratio
    const videoRatio = video.videoWidth / video.videoHeight;
    const canvasRatio = canvas.width / canvas.height;

    let drawWidth, drawHeight, offsetX, offsetY;

    if (canvasRatio > videoRatio) {
        drawWidth = canvas.width;
        drawHeight = canvas.width / videoRatio;
        offsetX = 0;
        offsetY = (canvas.height - drawHeight) / 2;
    } else {
        drawWidth = canvas.height * videoRatio;
        drawHeight = canvas.height;
        offsetX = (canvas.width - drawWidth) / 2;
        offsetY = 0;
    }

    ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

    // Add dark overlay
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawGameElements() {
    // Draw Paddle
    const paddleY = canvas.height - GAME_CONFIG.paddleHeight - 20;
    ctx.fillStyle = GAME_CONFIG.paddleColor;
    ctx.shadowBlur = 15;
    ctx.shadowColor = GAME_CONFIG.paddleColor;

    // Draw rounded rect
    const r = GAME_CONFIG.paddleHeight / 2;
    const x = state.paddleX - GAME_CONFIG.paddleWidth / 2;
    const y = paddleY;
    const w = GAME_CONFIG.paddleWidth;
    const h = GAME_CONFIG.paddleHeight;

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0; // reset

    // Draw objects
    for (let obj of state.objects) {
        obj.draw(ctx);
    }

    // Draw particles
    for (let p of state.particles) {
        p.draw(ctx);
    }

    // Draw Finger Tracker Dot
    if (state.fingerX !== null && state.fingerY !== null) {
        ctx.beginPath();
        ctx.arc(state.fingerX, state.fingerY, 10, 0, 2 * Math.PI);
        ctx.fillStyle = "#ff007f";
        ctx.shadowBlur = 20;
        ctx.shadowColor = "#ff007f";
        ctx.fill();
        ctx.shadowBlur = 0;
    }
}

// Main Game Loop
async function gameLoop() {
    // Process webcam frame with MediaPipe
    if (webcamRunning && handLandmarker) {
        let startTimeMs = performance.now();
        if (lastVideoTime !== video.currentTime) {
            lastVideoTime = video.currentTime;

            const results = handLandmarker.detectForVideo(video, startTimeMs);

            if (results.landmarks && results.landmarks.length > 0) {
                // Get Index Finger Tip (landmark 8)
                const indexFinger = results.landmarks[0][8];

                // Map normalized coordinates (0-1) to canvas size
                // Note: since canvas is mirrored via CSS scaleX(-1),
                // the raw X coordinate from mediapipe (which is not mirrored)
                // actually matches perfectly when drawn directly onto the mirrored canvas.
                state.fingerX = indexFinger.x * canvas.width;
                state.fingerY = indexFinger.y * canvas.height;
            } else {
                state.fingerX = null;
                state.fingerY = null;
            }
        }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (webcamRunning) {
        drawWebcamFeed();
    }

    updateGameLogic();
    drawGameElements();

    requestAnimationFrame(gameLoop);
}

// --- Game Control Methods ---

function startGame() {
    state = {
        isPlaying: true,
        score: 0,
        lives: GAME_CONFIG.initialLives,
        spawnTimer: 0,
        currentSpawnRate: GAME_CONFIG.baseSpawnRate,
        objects: [],
        particles: [],
        fingerX: null,
        fingerY: null,
        paddleX: canvas.width / 2
    };

    scoreEl.innerText = state.score;
    updateLivesDisplay();

    startScreen.classList.add("hidden");
    gameOverScreen.classList.add("hidden");
    hud.classList.remove("hidden");
}

function gameOver() {
    state.isPlaying = false;
    hud.classList.add("hidden");
    finalScoreEl.innerText = state.score;
    gameOverScreen.classList.remove("hidden");
}

// --- Event Listeners ---
startBtn.addEventListener("click", startGame);
restartBtn.addEventListener("click", startGame);

// Start initialization
initializeMediaPipe();
// Start rendering loop
requestAnimationFrame(gameLoop);
