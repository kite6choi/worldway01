/**
 * viewer.js
 * 월드웨이 동결건조기 모바일 전용 AI 예지보전 뷰어 컨트롤러
 * 
 * - 모델 불러오기: PC에서 내보낸 JSON/BIN 파일 로드 & 기본 모델 즉시 로드
 * - 실시간 2단계 추론: 1단계 오토인코더 복원 MSE + 2단계 10D 융합 분류기 Softmax
 * - 센서 제어: 모의 실시간 스트림 & 수동 슬라이더 & 원클릭 고장 프리셋
 * - 동적 3색 스마트 사이렌 & 현장 부품별 한글 정비 가이드
 */

class MobileViewer {
  constructor() {
    this.autoencoder = null;
    this.classifier = null;
    this.threshold = 0.0450;

    // 5D MinMax 스케일러 파라미터 (정상 범위 기본값)
    this.scaler5D = {
      min: [5.0, 2.0, 2.0, 0.005, -55.0],
      max: [35.0, 25.0, 25.0, 0.500, 30.0]
    };

    // 10D StandardScaler 파라미터
    this.scaler10D = {
      mean: [0.35, 0.28, 0.27, 0.08, 0.20, 0.015, 0.015, 0.015, 0.010, 0.010],
      std:  [0.15, 0.12, 0.12, 0.05, 0.10, 0.020, 0.020, 0.020, 0.015, 0.015]
    };

    this.isModelLoaded = false;
    this.isStreaming = false;
    this.streamTimer = null;
    this.streamFrame = 0;

    // 현재 센서 값 [dry, b1, b2, vac, temp]
    this.currentSensor = [12.5, 8.2, 7.9, 0.050, -42.0];
  }

  init() {
    this.bindEvents();
    this.initServiceWorker();
    // 초기 렌더링
    this.updateUIWithInference();
  }

  bindEvents() {
    // 1. 모델 로드 버튼들
    const loadBuiltinBtn = document.getElementById('load-builtin-model-btn');
    if (loadBuiltinBtn) {
      loadBuiltinBtn.addEventListener('click', () => this.loadBuiltinModel());
    }

    const fileInput = document.getElementById('model-files-input');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => this.handleModelFiles(e.target.files));
    }

    // 2. 탭 전환 (스트림 vs 수동 슬라이더)
    const tabStream = document.getElementById('tab-stream-btn');
    const tabManual = document.getElementById('tab-manual-btn');
    const panelStream = document.getElementById('panel-stream');
    const panelManual = document.getElementById('panel-manual');

    if (tabStream && tabManual) {
      tabStream.addEventListener('click', () => {
        tabStream.classList.add('tab-active');
        tabManual.classList.remove('tab-active');
        panelStream.classList.remove('hidden');
        panelManual.classList.add('hidden');
      });

      tabManual.addEventListener('click', () => {
        tabManual.classList.add('tab-active');
        tabStream.classList.remove('tab-active');
        panelManual.classList.remove('hidden');
        panelStream.classList.add('hidden');
        // 스트림 일시정지
        if (this.isStreaming) this.pauseStream();
      });
    }

    // 3. 스트림 컨트롤러
    const startStreamBtn = document.getElementById('stream-start-btn');
    const pauseStreamBtn = document.getElementById('stream-pause-btn');
    const resetStreamBtn = document.getElementById('stream-reset-btn');

    if (startStreamBtn) startStreamBtn.addEventListener('click', () => this.startStream());
    if (pauseStreamBtn) pauseStreamBtn.addEventListener('click', () => this.pauseStream());
    if (resetStreamBtn) resetStreamBtn.addEventListener('click', () => this.resetStream());

    // 4. 슬라이더 이벤트
    const sliders = [
      { id: 'slider-dry', idx: 0, valId: 'val-dry', unit: ' A' },
      { id: 'slider-b1',  idx: 1, valId: 'val-b1',  unit: ' A' },
      { id: 'slider-b2',  idx: 2, valId: 'val-b2',  unit: ' A' },
      { id: 'slider-vac', idx: 3, valId: 'val-vac', unit: ' Torr', fixed: 3 },
      { id: 'slider-temp',idx: 4, valId: 'val-temp',unit: ' °C' }
    ];

    sliders.forEach(s => {
      const el = document.getElementById(s.id);
      const valEl = document.getElementById(s.valId);
      if (el) {
        el.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          this.currentSensor[s.idx] = val;
          if (valEl) valEl.innerText = (s.fixed ? val.toFixed(s.fixed) : val.toFixed(1)) + s.unit;
          this.updateUIWithInference();
        });
      }
    });

    // 5. 프리셋 버튼들
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-preset');
        this.applyPreset(type);
      });
    });
  }

  /**
   * 프리셋 주입
   */
  applyPreset(type) {
    if (type === 'normal') {
      this.setSliders([12.5, 8.2, 7.9, 0.050, -42.0]);
      this.showToast('안정 정상 프리셋 적용', 'success');
    } else if (type === 'dry') {
      this.setSliders([29.5, 9.1, 8.5, 0.095, -35.0]);
      this.showToast('드라이펌프 과부하 고장 프리셋 적용', 'error');
    } else if (type === 'b1') {
      this.setSliders([14.0, 22.8, 8.2, 0.120, -32.0]);
      this.showToast('부스터1 펌프 전류 이상 프리셋 적용', 'error');
    } else if (type === 'b2') {
      this.setSliders([13.5, 8.8, 23.4, 0.115, -33.0]);
      this.showToast('부스터2 펌프 열화 고장 프리셋 적용', 'error');
    }
    this.updateUIWithInference();
  }

  setSliders(vals) {
    this.currentSensor = [...vals];
    const ids = ['slider-dry', 'slider-b1', 'slider-b2', 'slider-vac', 'slider-temp'];
    const valIds = [
      { id: 'val-dry', unit: ' A' },
      { id: 'val-b1', unit: ' A' },
      { id: 'val-b2', unit: ' A' },
      { id: 'val-vac', unit: ' Torr', fixed: 3 },
      { id: 'val-temp', unit: ' °C' }
    ];

    vals.forEach((v, i) => {
      const el = document.getElementById(ids[i]);
      if (el) el.value = v;
      const vEl = document.getElementById(valIds[i].id);
      if (vEl) vEl.innerText = (valIds[i].fixed ? v.toFixed(valIds[i].fixed) : v.toFixed(1)) + valIds[i].unit;
    });
  }

  /**
   * 기본 모델 즉시 로드 (사전 구성된 신경망 또는 브라우저 내 빌트인 가중치)
   */
  async loadBuiltinModel() {
    const btn = document.getElementById('load-builtin-model-btn');
    if (btn) { btn.disabled = true; btn.textContent = '모델 탑재 중...'; }

    try {
      // 1. 오토인코더 모델 구성 (5D -> 3D -> 2D -> 3D -> 5D)
      const ae = tf.sequential();
      ae.add(tf.layers.dense({ units: 3, activation: 'relu', inputShape: [5] }));
      ae.add(tf.layers.dense({ units: 2, activation: 'relu' }));
      ae.add(tf.layers.dense({ units: 3, activation: 'relu' }));
      ae.add(tf.layers.dense({ units: 5, activation: 'linear' }));
      ae.compile({ optimizer: 'adam', loss: 'meanSquaredError' });
      this.autoencoder = ae;

      // 2. 분류기 모델 구성 (10D -> 32 -> 16 -> 4 Softmax)
      const cls = tf.sequential();
      cls.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [10] }));
      cls.add(tf.layers.dense({ units: 16, activation: 'relu' }));
      cls.add(tf.layers.dense({ units: 4, activation: 'softmax' }));
      cls.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy' });
      this.classifier = cls;

      // 3. 정상 상태 재구성을 위한 기본 정합 가중치 훈련 (초고속 1초 모의 피팅)
      const normalD = [
        [12.5, 8.2, 7.9, 0.05, -42.0],
        [12.2, 8.0, 7.8, 0.048, -43.0],
        [12.8, 8.4, 8.0, 0.052, -41.0],
        [12.4, 8.1, 7.9, 0.049, -42.5],
        [12.6, 8.3, 8.1, 0.051, -41.5]
      ];
      const scaledNormal = normalD.map(r => this.scale5D(r));
      const tensorNormal = tf.tensor2d(scaledNormal);

      await ae.fit(tensorNormal, tensorNormal, { epochs: 25, verbose: 0 });
      tensorNormal.dispose();

      this.threshold = 0.0450;
      this.isModelLoaded = true;

      // UI 갱신
      this.updateModelStatusUI('기본 하이브리드 AI 모델 활성', true);
      this.showToast('✅ 기본 AI 모델이 성공적으로 탑재되었습니다!', 'success');
      this.updateUIWithInference();
    } catch (err) {
      console.error(err);
      this.showToast('기본 모델 로드 실패: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '기본 모델 즉시 로드'; }
    }
  }

  /**
   * PC에서 내보낸 다중 파일 업로드 처리
   */
  async handleModelFiles(files) {
    if (!files || files.length === 0) return;

    let paramFile = null;
    let aeJson = null;
    let aeBin = null;
    let clsJson = null;
    let clsBin = null;

    for (const f of Array.from(files)) {
      const name = f.name.toLowerCase();
      if (name.includes('params') && name.endsWith('.json')) {
        paramFile = f;
      } else if (name.includes('autoencoder') && name.endsWith('.json')) {
        aeJson = f;
      } else if (name.includes('autoencoder') && name.endsWith('.bin')) {
        aeBin = f;
      } else if (name.includes('classifier') && name.endsWith('.json')) {
        clsJson = f;
      } else if (name.includes('classifier') && name.endsWith('.bin')) {
        clsBin = f;
      }
    }

    // 1. 파라미터 파일 로드
    if (paramFile) {
      try {
        const text = await paramFile.text();
        const params = JSON.parse(text);
        if (params.threshold) this.threshold = params.threshold;
        if (params.scaler5D) this.scaler5D = params.scaler5D;
        if (params.scaler10D) this.scaler10D = params.scaler10D;
        console.log('[Viewer] 스케일러 파라미터 로드 완료:', params);
      } catch (e) {
        console.warn('파라미터 파싱 오류:', e);
      }
    }

    // 2. 오토인코더 모델 로드
    if (aeJson && aeBin) {
      try {
        this.showToast('오토인코더 모델 로딩 중...', 'info');
        this.autoencoder = await tf.loadLayersModel(tf.io.browserFiles([aeJson, aeBin]));
        console.log('[Viewer] 오토인코더 로드 성공');
      } catch (err) {
        console.error('오토인코더 로드 실패:', err);
        this.showToast('오토인코더 로드 실패: ' + err.message, 'error');
        return;
      }
    }

    // 3. 분류기 모델 로드
    if (clsJson && clsBin) {
      try {
        this.showToast('분류기 모델 로딩 중...', 'info');
        this.classifier = await tf.loadLayersModel(tf.io.browserFiles([clsJson, clsBin]));
        console.log('[Viewer] 분류기 로드 성공');
      } catch (err) {
        console.warn('분류기 로드 실패:', err);
      }
    }

    if (this.autoencoder) {
      this.isModelLoaded = true;
      this.updateModelStatusUI(`내보낸 모델 로드 완료 (임계치: ${this.threshold.toFixed(5)})`, true);
      this.showToast('✅ 모델 파일이 성공적으로 로드되었습니다!', 'success');
      this.updateUIWithInference();
    } else {
      this.showToast('autoencoder.json 및 weights.bin 파일이 필요합니다.', 'error');
    }
  }

  updateModelStatusUI(msg, isSuccess) {
    const badge = document.getElementById('model-badge');
    const infoText = document.getElementById('model-info-text');

    if (badge) {
      badge.className = isSuccess
        ? 'badge badge-sm badge-success text-slate-950 font-black text-[10px]'
        : 'badge badge-sm badge-ghost text-slate-400 font-bold text-[10px]';
      badge.textContent = isSuccess ? '정상 가동 중' : '대기 (미탑재)';
    }

    if (infoText) {
      infoText.innerHTML = `✅ <b>${msg}</b>`;
    }
  }

  scale5D(raw) {
    return raw.map((val, i) => {
      const min = this.scaler5D.min[i];
      const max = this.scaler5D.max[i];
      return (val - min) / (max - min || 1e-5);
    });
  }

  scale10D(raw10D) {
    return raw10D.map((val, i) => {
      const mean = this.scaler10D.mean[i] || 0;
      const std = this.scaler10D.std[i] || 1;
      return (val - mean) / std;
    });
  }

  /**
   * 단일 센서 5D 추론 수행
   */
  infer(raw5D) {
    const scaled5D = this.scale5D(raw5D);

    // 1단계: 오토인코더 복원 오차 계산
    let mse = 0;
    let reconScaled = [...scaled5D];

    if (this.autoencoder) {
      const res = tf.tidy(() => {
        const inT = tf.tensor2d([scaled5D]);
        const outT = this.autoencoder.predict(inT);
        const diff = tf.sub(inT, outT).square().mean(1);
        return {
          mse: diff.dataSync()[0],
          recon: Array.from(outT.dataSync())
        };
      });
      mse = res.mse;
      reconScaled = res.recon;
    } else {
      // 모델 미로드 시 수식 기반 모의 이상치 점수 산출
      // 정상 범위: dry ~ 12.5, b1 ~ 8.2, b2 ~ 7.9, vac ~ 0.05
      const dev = Math.abs(raw5D[0] - 12.5) / 20 +
                  Math.abs(raw5D[1] - 8.2) / 15 +
                  Math.abs(raw5D[2] - 7.9) / 15 +
                  Math.abs(raw5D[3] - 0.05) / 0.2;
      mse = dev * 0.025;
    }

    const isAnomaly = mse > this.threshold;

    // 2단계: 10D 특징 융합 및 다중 분류 확률
    let p0 = 1.0, p1 = 0.0, p2 = 0.0, p3 = 0.0;

    if (isAnomaly) {
      if (this.classifier) {
        // 10D 융합
        const raw10D = [];
        for (let i = 0; i < 5; i++) raw10D.push(scaled5D[i]);
        for (let i = 0; i < 5; i++) raw10D.push(Math.abs(scaled5D[i] - reconScaled[i]));
        const scaled10D = this.scale10D(raw10D);

        const probas = tf.tidy(() => {
          const inT = tf.tensor2d([scaled10D]);
          const outT = this.classifier.predict(inT);
          return Array.from(outT.dataSync());
        });

        p0 = probas[0] || 0;
        p1 = probas[1] || 0;
        p2 = probas[2] || 0;
        p3 = probas[3] || 0;
      } else {
        // 분류기 미로드 시 센서 이탈 비율에 기반한 모의 분류
        const dryDev = Math.max(0, raw5D[0] - 18);
        const b1Dev = Math.max(0, raw5D[1] - 13);
        const b2Dev = Math.max(0, raw5D[2] - 13);
        const sum = dryDev + b1Dev + b2Dev;

        if (sum > 0) {
          p0 = 0.05;
          p1 = (dryDev / sum) * 0.95;
          p2 = (b1Dev / sum) * 0.95;
          p3 = (b2Dev / sum) * 0.95;
        } else {
          p0 = 0.2; p1 = 0.4; p2 = 0.2; p3 = 0.2;
        }
      }
    }

    return {
      mse,
      threshold: this.threshold,
      isAnomaly,
      probabilities: { p0, p1, p2, p3 }
    };
  }

  /**
   * UI 업데이트
   */
  updateUIWithInference() {
    const res = this.infer(this.currentSensor);

    // 1. MSE 및 임계치
    const mseEl = document.getElementById('current-mse');
    const thEl = document.getElementById('current-th');
    if (mseEl) mseEl.textContent = res.mse.toFixed(5);
    if (thEl) thEl.textContent = res.threshold.toFixed(5);

    // 2. 확률 바
    const p0 = Math.round(res.probabilities.p0 * 100);
    const p1 = Math.round(res.probabilities.p1 * 100);
    const p2 = Math.round(res.probabilities.p2 * 100);
    const p3 = Math.round(res.probabilities.p3 * 100);

    const b0 = document.getElementById('prob-bar-0');
    const b1 = document.getElementById('prob-bar-1');
    const b2 = document.getElementById('prob-bar-2');
    const b3 = document.getElementById('prob-bar-3');
    if (b0) b0.value = p0;
    if (b1) b1.value = p1;
    if (b2) b2.value = p2;
    if (b3) b3.value = p3;

    const t0 = document.getElementById('prob-val-0');
    const t1 = document.getElementById('prob-val-1');
    const t2 = document.getElementById('prob-val-2');
    const t3 = document.getElementById('prob-val-3');
    if (t0) t0.textContent = `${p0}%`;
    if (t1) t1.textContent = `${p1}%`;
    if (t2) t2.textContent = `${p2}%`;
    if (t3) t3.textContent = `${p3}%`;

    // 3. 3색 스마트 사이렌 & 가이드 카드
    const card = document.getElementById('alarm-card');
    const badge = document.getElementById('alarm-status-badge');
    const title = document.getElementById('alarm-title');
    const guide = document.getElementById('alarm-guide');
    const ping = document.getElementById('alarm-ping');

    if (!card) return;

    if (!res.isAnomaly) {
      // 1단계: 정상 (녹색)
      card.className = 'rounded-2xl p-4 shadow-xl border transition-all duration-300 alarm-green';
      if (badge) { badge.className = 'badge badge-sm badge-success text-slate-950 font-black text-[10px]'; badge.textContent = 'NORMAL'; }
      if (title) title.innerHTML = '✅ 정상 안정 운전';
      if (guide) guide.innerHTML = '동결건조 챔버1 압력 및 펌프 계통이 정상 가동 중입니다.';
      if (ping) ping.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
    } else {
      const maxFault = Math.max(res.probabilities.p1, res.probabilities.p2, res.probabilities.p3);

      if (maxFault < 0.70) {
        // 2단계: 주의 (황색)
        card.className = 'rounded-2xl p-4 shadow-xl border transition-all duration-300 alarm-yellow';
        if (badge) { badge.className = 'badge badge-sm badge-warning text-slate-950 font-black text-[10px]'; badge.textContent = 'WARNING'; }
        if (title) title.innerHTML = '⚠️ 일시적 주의 (이상 변동 감지)';
        if (guide) guide.innerHTML = `센서 복원 오차 상승. 고장 확률(${Math.round(maxFault * 100)}%)이 위험 기준(70%) 미만입니다. 센서 트렌드를 모니터링하십시오.`;
        if (ping) ping.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping';
      } else {
        // 3단계: 위험 긴급 사이렌 (적색)
        let culprit = '알 수 없는 기계 이상';
        let action = '대기 제어 밸브 및 인버터 긴급 실측 점검.';

        if (res.probabilities.p1 === maxFault) {
          culprit = '드라이펌프 기계적 고장';
          action = '드라이펌프 역전 전류 차단 및 배기 임펠러 온도를 긴급 실측 점검하십시오.';
        } else if (res.probabilities.p2 === maxFault) {
          culprit = '부스터 1호기 인버터 전류 차단';
          action = '부스터1 모터 회전 속도 점검을 조치하고 냉각 칠러 매체 공급량을 증가하십시오.';
        } else if (res.probabilities.p3 === maxFault) {
          culprit = '부스터 2호기 고부하 열화 이탈';
          action = '부스터2 펌프 긴급 수동 배기 루프를 차단하고 건조 사이클 정지 후 바이패스 정비를 지시하십시오.';
        }

        card.className = 'rounded-2xl p-4 shadow-2xl border transition-all duration-300 alarm-red';
        if (badge) { badge.className = 'badge badge-sm badge-error text-slate-950 font-black text-[10px]'; badge.textContent = 'DANGER'; }
        if (title) title.innerHTML = `🚨 긴급 위험 예지 (${culprit})`;
        if (guide) guide.innerHTML = `<b>진단 신뢰도: ${Math.round(maxFault * 100)}%</b><br>👉 <b>현장 조치:</b> ${action}`;
        if (ping) ping.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping';
      }
    }
  }

  /**
   * 실시간 가상 스트림 플레이백
   */
  startStream() {
    if (this.isStreaming) return;
    this.isStreaming = true;

    const startBtn = document.getElementById('stream-start-btn');
    const pauseBtn = document.getElementById('stream-pause-btn');
    const statusEl = document.getElementById('stream-status');

    if (startBtn) startBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = false;
    if (statusEl) { statusEl.textContent = '가동 중 (1초 주기)'; statusEl.className = 'text-emerald-400 font-bold'; }

    this.streamTimer = setInterval(() => {
      this.tickStream();
    }, 1000);
  }

  pauseStream() {
    this.isStreaming = false;
    if (this.streamTimer) {
      clearInterval(this.streamTimer);
      this.streamTimer = null;
    }

    const startBtn = document.getElementById('stream-start-btn');
    const pauseBtn = document.getElementById('stream-pause-btn');
    const statusEl = document.getElementById('stream-status');

    if (startBtn) startBtn.disabled = false;
    if (pauseBtn) pauseBtn.disabled = true;
    if (statusEl) { statusEl.textContent = '일시정지'; statusEl.className = 'text-amber-400 font-bold'; }
  }

  resetStream() {
    this.pauseStream();
    this.streamFrame = 0;
    const frameEl = document.getElementById('stream-frame-count');
    if (frameEl) frameEl.textContent = '0';
    this.applyPreset('normal');
  }

  tickStream() {
    this.streamFrame++;
    const frameEl = document.getElementById('stream-frame-count');
    if (frameEl) frameEl.textContent = this.streamFrame.toLocaleString();

    const faultToggle = document.getElementById('stream-fault-toggle');
    const injectFault = faultToggle && faultToggle.checked && Math.random() < 0.10;

    if (injectFault) {
      // 10% 돌발 고장 중 무작위 선택
      const r = Math.random();
      if (r < 0.33) {
        this.setSliders([28.0 + Math.random() * 4, 8.5 + Math.random(), 8.0 + Math.random(), 0.085, -36.0]);
      } else if (r < 0.66) {
        this.setSliders([13.0 + Math.random(), 21.0 + Math.random() * 5, 8.2 + Math.random(), 0.110, -33.0]);
      } else {
        this.setSliders([13.2 + Math.random(), 8.5 + Math.random(), 22.0 + Math.random() * 5, 0.112, -34.0]);
      }
    } else {
      // 정상 시계열 미세 노이즈
      const nDry = 12.5 + (Math.random() - 0.5) * 0.8;
      const nB1  = 8.2  + (Math.random() - 0.5) * 0.6;
      const nB2  = 7.9  + (Math.random() - 0.5) * 0.6;
      const nVac = 0.050 + (Math.random() - 0.5) * 0.006;
      const nTemp = -42.0 + (Math.random() - 0.5) * 1.2;
      this.setSliders([nDry, nB1, nB2, nVac, nTemp]);
    }

    this.updateUIWithInference();
  }

  showToast(message, type = 'info') {
    const toastBox = document.getElementById('toast-box');
    if (!toastBox) return;

    const alertClass = type === 'success' ? 'alert-success' : type === 'error' ? 'alert-error' : 'alert-info';
    const toast = document.createElement('div');
    toast.className = `alert ${alertClass} text-xs font-bold py-2 px-3 shadow-lg rounded-xl animate-fade-in`;
    toast.innerHTML = `<span>${message}</span>`;
    toastBox.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  initServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('[Viewer PWA] Service Worker 등록 완료'))
        .catch(err => console.warn('[Viewer PWA] Service Worker 등록 실패:', err));
    }
  }
}

// 인스턴스 초기화
window.viewer = new MobileViewer();
document.addEventListener('DOMContentLoaded', () => {
  window.viewer.init();
});
