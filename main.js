const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const overlayCtx = overlay.getContext('2d');
const particlesCanvas = document.getElementById('particles');
const particlesCtx = particlesCanvas.getContext('2d');
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');

let mediaStream = null;
let running = false;
let modelsLoaded = false;
let detectionRaf = null;
let particleRaf = null;
let particles = [];

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';

class Particle {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.tx = x;
    this.ty = y;
    this.vx = (Math.random() - 0.5) * 4;
    this.vy = (Math.random() - 0.5) * 4;
    this.size = 2 + Math.random() * 2.5;
    this.life = 1;
    this.hue = 180 + Math.random() * 120;
  }

  setTarget(x, y) {
    this.tx = x;
    this.ty = y;
  }

  update() {
    const spring = 0.15;
    this.vx += (this.tx - this.x) * spring + (Math.random() - 0.5) * 0.2;
    this.vy += (this.ty - this.y) * spring + (Math.random() - 0.5) * 0.2;

    this.vx *= 0.86;
    this.vy *= 0.86;

    this.x += this.vx;
    this.y += this.vy;

    this.life = Math.max(0, this.life - 0.005);
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.fillStyle = `hsla(${this.hue}, 100%, 70%, ${this.life})`;
    ctx.shadowColor = `hsla(${this.hue}, 100%, 70%, 0.45)`;
    ctx.shadowBlur = 16;
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

async function loadModels() {
  statusEl.textContent = '加载模型中...';
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
  ]);
  modelsLoaded = true;
  statusEl.textContent = '模型就绪，点击“启动识别”';
}

async function startCamera() {
  statusEl.textContent = '请求摄像头权限...';
  mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
  video.srcObject = mediaStream;
  await video.play();
  resizeCanvases();
  statusEl.textContent = '摄像头已开启，检测中...';
}

function stopCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  if (video.srcObject) {
    video.srcObject = null;
  }
}

function resizeCanvases() {
  const { clientWidth, clientHeight } = video;
  [overlay, particlesCanvas].forEach((c) => {
    c.width = clientWidth;
    c.height = clientHeight;
  });
}

function buildParticles(landmarks) {
  particles = [];
  const pts = landmarks.positions || landmarks;
  pts.forEach((p) => {
    for (let i = 0; i < 2; i++) {
      const jitter = (Math.random() - 0.5) * 8;
      const particle = new Particle(p.x + jitter, p.y + jitter);
      particles.push(particle);
    }
  });
}

function updateParticles(landmarks) {
  const pts = landmarks.positions || landmarks;
  pts.forEach((p, idx) => {
    const pair = particles[idx * 2];
    const pair2 = particles[idx * 2 + 1];
    if (pair) pair.setTarget(p.x, p.y);
    if (pair2) pair2.setTarget(p.x, p.y);
  });
}

function renderParticles() {
  particlesCtx.clearRect(0, 0, particlesCanvas.width, particlesCanvas.height);
  particlesCtx.globalCompositeOperation = 'lighter';
  particles.forEach((p) => {
    p.update();
    p.draw(particlesCtx);
  });
  particleRaf = requestAnimationFrame(renderParticles);
}

async function detectLoop() {
  if (!running) return;
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 256, scoreThreshold: 0.4 });
  const detection = await faceapi
    .detectSingleFace(video, options)
    .withFaceLandmarks(true);

  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (detection) {
    const resized = faceapi.resizeResults(detection, { width: overlay.width, height: overlay.height });
    drawOverlay(resized);
    const pts = resized.landmarks.positions.map((p) => ({ x: p.x, y: p.y }));

    if (particles.length === 0) {
      buildParticles(pts);
      if (!particleRaf) renderParticles();
    }
    updateParticles(pts);
    statusEl.textContent = '检测到人脸 ➜ 点云生成中';
  } else {
    statusEl.textContent = '未检测到人脸，尝试移动到光线更好的位置';
    particles.forEach((p) => p.setTarget(Math.random() * overlay.width, overlay.height + 60));
  }

  detectionRaf = requestAnimationFrame(detectLoop);
}

function drawOverlay(result) {
  const { detection, landmarks } = result;
  overlayCtx.strokeStyle = '#6cf0ff';
  overlayCtx.lineWidth = 2;
  overlayCtx.shadowBlur = 12;
  overlayCtx.shadowColor = 'rgba(108, 240, 255, 0.6)';
  overlayCtx.strokeRect(
    detection.box.x,
    detection.box.y,
    detection.box.width,
    detection.box.height
  );

  overlayCtx.shadowBlur = 0;
  overlayCtx.fillStyle = 'rgba(108, 240, 255, 0.08)';
  overlayCtx.beginPath();
  landmarks.positions.forEach((p, i) => {
    if (i === 0) overlayCtx.moveTo(p.x, p.y);
    else overlayCtx.lineTo(p.x, p.y);
  });
  overlayCtx.closePath();
  overlayCtx.fill();

  overlayCtx.fillStyle = '#9c6dff';
  landmarks.positions.forEach((p) => {
    overlayCtx.beginPath();
    overlayCtx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    overlayCtx.fill();
  });
}

async function start() {
  if (!modelsLoaded) {
    try {
      await loadModels();
    } catch (err) {
      statusEl.textContent = '模型加载失败，请检查网络连接。';
      console.error(err);
      return;
    }
  }

  try {
    await startCamera();
    running = true;
    detectLoop();
    if (!particleRaf) renderParticles();
  } catch (err) {
    statusEl.textContent = '无法访问摄像头，请检查权限或设备。';
    console.error(err);
  }
}

function stop() {
  running = false;
  cancelAnimationFrame(detectionRaf);
  cancelAnimationFrame(particleRaf);
  detectionRaf = null;
  particleRaf = null;
  particles = [];
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  particlesCtx.clearRect(0, 0, particlesCanvas.width, particlesCanvas.height);
  statusEl.textContent = '已停止';
  stopCamera();
}

video.addEventListener('loadedmetadata', resizeCanvases);
window.addEventListener('resize', resizeCanvases);

startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);

// Give the stage a subtle pulsing glow when idle
let pulse = 0;
function idleGlow() {
  pulse += 0.02;
  const alpha = 0.12 + Math.sin(pulse) * 0.06;
  particlesCtx.clearRect(0, 0, particlesCanvas.width, particlesCanvas.height);
  particlesCtx.fillStyle = `rgba(108, 240, 255, ${alpha})`;
  particlesCtx.fillRect(0, 0, particlesCanvas.width, particlesCanvas.height);
  if (!running) requestAnimationFrame(idleGlow);
}
idleGlow();
