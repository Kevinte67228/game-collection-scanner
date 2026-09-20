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
  captureROI(enhanceContrast = true) {
    if (!this.video || this.video.videoWidth === 0) return null;

    const vWidth = this.video.videoWidth;
    const vHeight = this.video.videoHeight;
    const rect = this.guideOverlay.getBoundingClientRect();
    const container = this.video.getBoundingClientRect();

    // 計算取景框相對於視頻畫面的比例與像素座標
    const scaleX = vWidth / container.width;
    const scaleY = vHeight / container.height;

    let roiX = (rect.left - container.left) * scaleX;
    let roiY = (rect.top - container.top) * scaleY;
    let roiW = rect.width * scaleX;
    let roiH = rect.height * scaleY;

    // 邊界防護
    roiX = Math.max(0, Math.min(roiX, vWidth - 10));
    roiY = Math.max(0, Math.min(roiY, vHeight - 10));
    roiW = Math.min(roiW, vWidth - roiX);
    roiH = Math.min(roiH, vHeight - roiY);

    // 設定畫布尺寸（確保有足夠解析度供 OCR 辨識，放大 1.5 倍）
    const targetW = Math.round(roiW * 1.5);
    const targetH = Math.round(roiH * 1.5);
    this.canvas.width = targetW;
    this.canvas.height = targetH;

    // 繪製裁切區域
    this.ctx.drawImage(this.video, roiX, roiY, roiW, roiH, 0, 0, targetW, targetH);

    if (enhanceContrast) {
      this.preprocessImage(targetW, targetH);
    }

    return this.canvas.toDataURL('image/jpeg', 0.9);
  }

  /**
   * 圖像前處理：灰階化、自動色階展開、銳化以大幅增強文字與商品編號的識別率
   */
  preprocessImage(width, height) {
    const imgData = this.ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // 1. 計算亮度直方圖
    let minL = 255;
    let maxL = 0;
    for (let i = 0; i < data.length; i += 4) {
      // 灰階亮度 Y = 0.299R + 0.587G + 0.114B
      const lum = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      if (lum < minL) minL = lum;
      if (lum > maxL) maxL = lum;
    }

    const range = (maxL - minL) || 1;

    // 2. 對比度拉伸 (Linear Contrast Stretch)
    for (let i = 0; i < data.length; i += 4) {
      const lum = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      const stretched = Math.min(255, Math.max(0, Math.round(((lum - minL) / range) * 255)));
      
      // 增強文字邊緣
      data[i] = stretched;
      data[i + 1] = stretched;
      data[i + 2] = stretched;
    }

    this.ctx.putImageData(imgData, 0, 0);
  }
}

if (typeof window !== 'undefined') {
  window.CameraScanner = CameraScanner;
}
