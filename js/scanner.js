/**
 * scanner.js - 相機控制、書背導引框取景與圖像前處理
 */

class CameraScanner {
  constructor(videoElement, canvasElement, guideOverlay) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d', { willReadFrequently: true });
    this.guideOverlay = guideOverlay;
    this.stream = null;
    this.isScanning = false;
    this.isTorchOn = false;
    this.orientation = 'horizontal'; // 'horizontal' (水平書背) or 'vertical' (垂直側標)
  }

  async startCamera() {
    try {
      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          focusMode: { ideal: 'continuous' }
        }
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      await this.video.play();
      this.isScanning = true;
      return true;
    } catch (err) {
      console.error('[CameraScanner] Failed to open camera:', err);
      // Fallback with basic constraints
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        this.video.srcObject = this.stream;
        await this.video.play();
        this.isScanning = true;
        return true;
      } catch (fallbackErr) {
        console.error('[CameraScanner] Camera access denied:', fallbackErr);
        throw fallbackErr;
      }
    }
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.isScanning = false;
    this.isTorchOn = false;
  }

  async toggleTorch() {
    if (!this.stream) return false;
    const track = this.stream.getVideoTracks()[0];
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    
    if (!capabilities.torch) {
      console.warn('[CameraScanner] Torch is not supported on this device/browser');
      return false;
    }

    this.isTorchOn = !this.isTorchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: this.isTorchOn }]
      });
      return this.isTorchOn;
    } catch (e) {
      console.error('[CameraScanner] Failed to toggle torch:', e);
      this.isTorchOn = false;
      return false;
    }
  }

  setOrientation(mode) {
    this.orientation = mode;
    if (this.guideOverlay) {
      this.guideOverlay.setAttribute('data-orientation', mode);
    }
  }

  /**
   * 根據導引框裁切遊戲書背並進行灰階對比度增強
   */
  /**
   * 根據導引框精準裁切遊戲書背 (精確計算 object-fit: cover 視窗縮放與裁切偏移)
   */
  captureROI(enhanceContrast = true) {
    if (!this.video || this.video.videoWidth === 0) return null;

    const vWidth = this.video.videoWidth;
    const vHeight = this.video.videoHeight;
    const rect = this.guideOverlay.getBoundingClientRect();
    const container = this.video.getBoundingClientRect();

    // 1. 計算 object-fit: cover 之真實渲染尺寸與平移量
    const videoRatio = vWidth / vHeight;
    const containerRatio = container.width / container.height;

    let renderedW, renderedH, offsetX = 0, offsetY = 0;

    if (videoRatio > containerRatio) {
      // 視頻寬度比例較大：高度貼齊容器，兩側被裁切
      renderedH = container.height;
      renderedW = container.height * videoRatio;
      offsetX = (renderedW - container.width) / 2;
    } else {
      // 視頻高度比例較大：寬度貼齊容器，上下被裁切
      renderedW = container.width;
      renderedH = container.width / videoRatio;
      offsetY = (renderedH - container.height) / 2;
    }

    const scale = vWidth / renderedW; // 像素等比縮放係數

    // 2. 映射取景框 (rect) 至實際視頻原圖的像素座標
    let roiX = (rect.left - container.left + offsetX) * scale;
    let roiY = (rect.top - container.top + offsetY) * scale;
    let roiW = rect.width * scale;
    let roiH = rect.height * scale;

    // 邊界保護
    roiX = Math.max(0, Math.min(roiX, vWidth - 10));
    roiY = Math.max(0, Math.min(roiY, vHeight - 10));
    roiW = Math.max(10, Math.min(roiW, vWidth - roiX));
    roiH = Math.max(10, Math.min(roiH, vHeight - roiY));

    // 3. 設定畫布尺寸（維持足夠 DPI 供 OCR 辨識，長邊至少 1200px）
    const minDim = Math.max(roiW, roiH);
    const upscale = minDim < 1200 ? (1200 / minDim) : 1.0;
    const targetW = Math.round(roiW * upscale);
    const targetH = Math.round(roiH * upscale);
    this.canvas.width = targetW;
    this.canvas.height = targetH;

    // 4. 繪製裁切區域
    this.ctx.drawImage(this.video, roiX, roiY, roiW, roiH, 0, 0, targetW, targetH);

    if (enhanceContrast) {
      this.preprocessImage(targetW, targetH);
    }

    return this.canvas.toDataURL('image/jpeg', 0.95);
  }

  /**
   * 圖像前處理：自適應對比增強與降噪
   */
  preprocessImage(width, height) {
    const imgData = this.ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // 溫和的對比度拉伸，避免反光過曝或黑字被吞噬
    let minL = 255;
    let maxL = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      if (lum < minL) minL = lum;
      if (lum > maxL) maxL = lum;
    }

    // 保留 5% 裕度防止噪點拉爆對比
    const range = Math.max(40, maxL - minL);
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      const normalized = Math.min(255, Math.max(0, ((lum - minL) / range) * 255));
      // 混合 70% 灰階增強與 30% 原色，保留彩色特徵
      data[i] = Math.round(data[i] * 0.3 + normalized * 0.7);
      data[i + 1] = Math.round(data[i + 1] * 0.3 + normalized * 0.7);
      data[i + 2] = Math.round(data[i + 2] * 0.3 + normalized * 0.7);
    }

    this.ctx.putImageData(imgData, 0, 0);
  }
}

if (typeof window !== 'undefined') {
  window.CameraScanner = CameraScanner;
}
