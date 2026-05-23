let img;
let imgWidth, imgHeight;
let canvasWidth, canvasHeight;
let imgDrawX, imgDrawY, imgDrawW, imgDrawH;

let redYPositions;
let currentRedX = 0;
let lastFreqRed = 0;

let blueVolumeCurve;
let currentBlueX = 0;
let lastFreqBlue = 0;

const STATE_IDLE = -1;
const STATE_RED_SCANNING = 0;
const STATE_PAUSE = 1;
const STATE_BLUE_SCANNING = 2;
const STATE_BOTH_4S = 3;
const STATE_WHITE_BG = 4;
const STATE_FINISHED = 5;
let state = STATE_IDLE;

let pauseStart, bothStart, whiteStart;
let finalExportDone = false;
let scanSpeed = 1;

const SAT_THRESHOLD_255 = 205;
const BRIGHT_THRESHOLD_255 = 155;

const BLUE_R = 15, BLUE_G = 245, BLUE_B = 245;
const RED_ALPHA = 216;
const BLUE_ALPHA = 255;

let osc, delay;
let audioStarted = false;
let oscStopped = false;

let fileInput, startBtn, downloadBtn, statusP;
let canvas;
let loadMessage = '';

const MAX_CANVAS_WIDTH = 1200;

function setup() {
  pixelDensity(1);
  canvas = createCanvas(800, 400);
  canvas.parent('canvasContainer');
  noLoop();

  fileInput = select('#fileInput');
  startBtn = select('#startBtn');
  downloadBtn = select('#downloadBtn');
  statusP = select('#status');
  statusP.html('请先选择一张图片');

  fileInput.changed(handleFile);
  startBtn.mousePressed(startScan);
  downloadBtn.mousePressed(downloadResult);
}

function draw() {
  background(0);

  if (state === STATE_IDLE && loadMessage !== '') {
    fill(255);
    textAlign(CENTER, CENTER);
    textSize(18);
    text(loadMessage, width / 2, height / 2);
    return;
  }

  if (state === STATE_IDLE) return;

  switch(state) {
    case STATE_RED_SCANNING:
      background(0);
      drawImageScaled();
      drawRedTrail(0, currentRedX);
      stroke(255, 0, 0);
      let rx = map(currentRedX, 0, imgWidth, imgDrawX, imgDrawX + imgDrawW);
      line(rx, imgDrawY, rx, imgDrawY + imgDrawH);

      if (frameCount % scanSpeed === 0) {
        analyzeRedColumn(currentRedX);
        currentRedX++;
        if (currentRedX >= imgWidth) {
          if (osc) {
            osc.amp(0);
            osc.stop();
            oscStopped = true;
            osc = null;
          }
          state = STATE_PAUSE;
          pauseStart = millis();
        }
      }
      break;

    case STATE_PAUSE:
      background(0);
      drawImageScaled();
      drawRedTrail(0, imgWidth);
      if (millis() - pauseStart > 1000) {
        if (oscStopped) initAudio();
        currentBlueX = 0;
        lastFreqBlue = 0;
        state = STATE_BLUE_SCANNING;
      }
      break;

    case STATE_BLUE_SCANNING:
      background(0);
      drawImageScaled();
      drawBlueTrail(0, currentBlueX);
      stroke(BLUE_R, BLUE_G, BLUE_B);
      let bx = map(currentBlueX, 0, imgWidth, imgDrawX, imgDrawX + imgDrawW);
      line(bx, imgDrawY, bx, imgDrawY + imgDrawH);

      if (frameCount % scanSpeed === 0) {
        analyzeBlueColumn(currentBlueX);
        currentBlueX++;
        if (currentBlueX >= imgWidth) {
          if (osc) {
            osc.amp(0);
            osc.stop();
            oscStopped = true;
            osc = null;
          }
          state = STATE_BOTH_4S;
          bothStart = millis();
        }
      }
      break;

    case STATE_BOTH_4S:
      background(0);
      drawImageScaled();
      drawRedTrail(0, imgWidth);
      drawBlueTrail(0, imgWidth);
      if (millis() - bothStart > 4000) {
        state = STATE_WHITE_BG;
        whiteStart = millis();
      }
      break;

    case STATE_WHITE_BG:
      if (!finalExportDone) {
        finalExportDone = true;
        downloadBtn.style('display', 'inline-block');
        statusP.html('图像频谱报告已生成，点击下载保存报告');
      }
      background(255);
      drawRedTrail(0, imgWidth);
      drawBlueTrail(0, imgWidth);
      if (millis() - whiteStart > 3000) {
        state = STATE_FINISHED;
        noLoop();
      }
      break;

    case STATE_FINISHED:
      break;
  }
}

function drawImageScaled() {
  if (img) image(img, imgDrawX, imgDrawY, imgDrawW, imgDrawH);
}

function drawRedTrail(start, end) {
  push();
  stroke(255, 0, 0, RED_ALPHA);
  strokeWeight(1);
  noFill();
  beginShape();
  let e = min(end, imgWidth);
  for (let i = start; i < e; i++) {
    let sx = map(i, 0, imgWidth, imgDrawX, imgDrawX + imgDrawW);
    let sy = map(redYPositions[i], 0, imgHeight, imgDrawY, imgDrawY + imgDrawH);
    vertex(sx, sy);
  }
  endShape();
  pop();
}

function drawBlueTrail(start, end) {
  push();
  stroke(BLUE_R, BLUE_G, BLUE_B, BLUE_ALPHA);
  strokeWeight(1);
  noFill();
  beginShape();
  let e = min(end, imgWidth);
  for (let i = start; i < e; i++) {
    if (blueVolumeCurve[i] !== -1) {
      let sx = map(i, 0, imgWidth, imgDrawX, imgDrawX + imgDrawW);
      let sy = map(blueVolumeCurve[i], 0, imgHeight, imgDrawY, imgDrawY + imgDrawH);
      vertex(sx, sy);
    }
  }
  endShape();
  pop();
}

function getRGB(x, y) {
  let idx = (y * imgWidth + x) * 4;
  return {
    r: img.pixels[idx],
    g: img.pixels[idx + 1],
    b: img.pixels[idx + 2]
  };
}

function rgbToHSB(r, g, b) {
  let h = 0, s = 0, v = 0;
  let cmax = max(r, g, b);
  let cmin = min(r, g, b);
  let delta = cmax - cmin;
  v = cmax;
  if (cmax !== 0) {
    s = (delta * 255) / cmax;
  }
  if (delta !== 0) {
    if (cmax === r) {
      h = ((g - b) / delta) % 6;
    } else if (cmax === g) {
      h = ((b - r) / delta) + 2;
    } else {
      h = ((r - g) / delta) + 4;
    }
    h = h * 42.5;
    if (h < 0) h += 255;
  }
  return { h: h, s: s, v: v };
}

function analyzeRedColumn(x) {
  let validY = [];
  for (let y = 0; y < imgHeight; y++) {
    let { r, g, b } = getRGB(x, y);
    let hsb = rgbToHSB(r, g, b);
    if (hsb.s > SAT_THRESHOLD_255 && hsb.v > BRIGHT_THRESHOLD_255) {
      validY.push(y);
    }
  }

  let maxContrast = 0;
  let targetY = 0;

  if (validY.length >= 2) {
    for (let i = 0; i < validY.length - 1; i++) {
      let y1 = validY[i];
      let y2 = validY[i + 1];
      let c1 = getRGB(x, y1);
      let c2 = getRGB(x, y2);
      let contrast = calcContrast(c1, c2);
      if (contrast > maxContrast) {
        maxContrast = contrast;
        targetY = y1;
      }
    }
  } else {
    for (let y = 0; y < imgHeight - 1; y++) {
      let c1 = getRGB(x, y);
      let c2 = getRGB(x, y + 1);
      let contrast = calcContrast(c1, c2);
      if (contrast > maxContrast) {
        maxContrast = contrast;
        targetY = y;
      }
    }
  }

  redYPositions[x] = targetY;
  let normalized = map(targetY, 0, imgHeight, 1.0, 0.0);
  let freq = pow(normalized, 2) * 1800 + 150;
  freq = lerp(freq, lastFreqRed, 0.3);
  if (osc) osc.freq(freq);

  let amp = map(constrain(maxContrast * 1.5, 0, 255), 0, 255, 0.3, 0.6);
  if (osc) osc.amp(amp, 0.05);
  lastFreqRed = freq;
}

function calcContrast(c1, c2) {
  let hs1 = rgbToHSB(c1.r, c1.g, c1.b);
  let hs2 = rgbToHSB(c2.r, c2.g, c2.b);
  let h1 = hs1.h, s1 = hs1.s, b1 = hs1.v;
  let h2 = hs2.h, s2 = hs2.s, b2 = hs2.v;
  let dh = min(abs(h1 - h2), 256 - abs(h1 - h2));
  let dhNorm = dh / 128.0;
  let avgS = (s1 + s2) / 2.0;
  let hueContrast = dhNorm * (avgS / 255.0) * 255.0;
  let ds = abs(s2 - s1);
  let db = abs(b2 - b1);
  return hueContrast * 1.5 + ds * 0.5 + db * 0.5;
}

function analyzeBlueColumn(x) {
  let sumBrightness = 0;
  for (let y = 0; y < imgHeight; y++) {
    let { r, g, b } = getRGB(x, y);
    let hsb = rgbToHSB(r, g, b);
    sumBrightness += hsb.v;
  }
  let avgBrightness255 = sumBrightness / imgHeight;
  let normalized = avgBrightness255 / 255.0;
  let freq = pow(normalized, 2) * 1800 + 200;
  freq = lerp(freq, lastFreqBlue, 0.3);
  if (osc) osc.freq(freq);

  let amp = map(constrain(avgBrightness255 * 1.2, 0, 255), 0, 255, 0.2, 0.6);
  if (osc) osc.amp(amp, 0.05);
  lastFreqBlue = freq;
  blueVolumeCurve[x] = map(freq, 200, 2000, imgHeight, 0);
}

function initAudio() {
  osc = new p5.Oscillator('sine');
  osc.freq(400);
  osc.amp(0);
  delay = new p5.Delay();
  osc.disconnect();
  osc.connect(delay);
  delay.process(osc, 0.1, 0.2, 2300);
  delay.connect();
  osc.start();
  oscStopped = false;
}

function handleFile() {
  const file = fileInput.elt.files[0];
  if (!file) return;

  statusP.html('图片加载中...');
  loadMessage = '正在载入图片，请稍候...';
  redraw();

  const objectURL = URL.createObjectURL(file);
  loadImage(
    objectURL,
    function(loadedImg) {
      URL.revokeObjectURL(objectURL);
      let scale = 2560 / max(loadedImg.width, loadedImg.height);
      imgWidth = int(loadedImg.width * scale);
      imgHeight = int(loadedImg.height * scale);
      img = createImage(imgWidth, imgHeight);
      img.copy(loadedImg, 0, 0, loadedImg.width, loadedImg.height,
               0, 0, imgWidth, imgHeight);
      img.loadPixels();

      redYPositions = new Array(imgWidth).fill(0);
      blueVolumeCurve = new Array(imgWidth).fill(-1);

      let maxCanvasW = min(windowWidth * 0.9, MAX_CANVAS_WIDTH);
      let ratio = imgHeight / imgWidth;
      canvasWidth = maxCanvasW;
      canvasHeight = canvasWidth * ratio;
      resizeCanvas(canvasWidth, canvasHeight);

      let canvasRatio = canvasWidth / canvasHeight;
      let imgRatio = imgWidth / imgHeight;
      if (canvasRatio > imgRatio) {
        imgDrawH = canvasHeight;
        imgDrawW = imgDrawH * imgRatio;
      } else {
        imgDrawW = canvasWidth;
        imgDrawH = imgDrawW / imgRatio;
      }
      imgDrawX = (canvasWidth - imgDrawW) / 2;
      imgDrawY = (canvasHeight - imgDrawH) / 2;

      startBtn.removeAttribute('disabled');
      statusP.html('图片已加载，点击“开始扫描”');
      downloadBtn.style('display', 'none');
      finalExportDone = false;
      state = STATE_IDLE;
      loadMessage = '';
      redraw();
    },
    function(err) {
      URL.revokeObjectURL(objectURL);
      statusP.html('图片加载失败，请重试或换一张图片');
      loadMessage = '加载失败，请重新选择图片';
      console.error(err);
      redraw();
    }
  );
}

function startScan() {
  if (!img) return;

  if (!audioStarted) {
    userStartAudio();
    audioStarted = true;
  }

  if (oscStopped || !osc) {
    initAudio();
  }

  currentRedX = 0;
  currentBlueX = 0;
  lastFreqRed = 0;
  lastFreqBlue = 0;
  blueVolumeCurve.fill(-1);
  state = STATE_RED_SCANNING;
  finalExportDone = false;
  downloadBtn.style('display', 'none');
  statusP.html('图像频谱报告生成中...');
  loop();
  redraw();
}

function downloadResult() {
  if (!img || !finalExportDone) return;
  let result = createGraphics(imgWidth, imgHeight);
  result.image(img, 0, 0);

  result.stroke(255, 0, 0, RED_ALPHA);
  result.strokeWeight(1);
  result.noFill();
  result.beginShape();
  for (let i = 0; i < imgWidth; i++) result.vertex(i, redYPositions[i]);
  result.endShape();

  result.stroke(BLUE_R, BLUE_G, BLUE_B, BLUE_ALPHA);
  result.strokeWeight(2);
  result.beginShape();
  for (let i = 0; i < imgWidth; i++) {
    if (blueVolumeCurve[i] !== -1) result.vertex(i, blueVolumeCurve[i]);
  }
  result.endShape();

  save(result, 'final_output.png');
}

function windowResized() {}