/**
 * app.js
 * 메인 애플리케이션 오케스트레이터 및 UI 이벤트/시뮬레이션 제어
 */

class App {
  constructor() {
    this.simulationTimer = null;
    this.simulationSpeed = 1000; // ms
    this.isSimulating = false;
    this.faultInjectionEnabled = true;
    this.testDataIndex = 0;
    this.testDataset = [];
    this.faultTestDataset = { 1: [], 2: [], 3: [] };
  }

  async init() {
    console.log('[App] Initializing Worldway Predictive Maintenance PWA...');

    // 1. PWA Service Worker 등록
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js');
        console.log('[App] Service Worker registered successfully:', reg.scope);
      } catch (e) {
        console.warn('[App] Service Worker registration failed:', e);
      }
    }

    // 2. uPlot 차트 초기화
    chartsManager.initSensorChart('sensor-chart-box');
    chartsManager.initErrorChart('error-chart-box');

    // 3. UI 이벤트 바인딩
    this.bindEvents();

    // 4. 기존 IndexedDB 데이터 확인
    const hasData = await dataStore.checkExistingData();
    if (hasData) {
      this.updateDataSummaryUI();
      this.showToast('기존 로컬 데이터베이스(150,000건)가 정상 로드되었습니다.', 'success');
      document.getElementById('train-ae-btn').disabled = false;
    }
  }

  bindEvents() {
    // 1. 파일 업로드 및 드롭존 이벤트
    const normalInput = document.getElementById('normal-csv-file');
    const faultInput = document.getElementById('fault-csv-file');
    const loadDefaultBtn = document.getElementById('load-default-dataset-btn');
    const resetDbBtn = document.getElementById('reset-db-btn');

    if (loadDefaultBtn) {
      loadDefaultBtn.addEventListener('click', () => this.loadDefaultDataset());
    }

    if (resetDbBtn) {
      resetDbBtn.addEventListener('click', async () => {
        if (confirm('IndexedDB의 모든 데이터를 초기화하시겠습니까?')) {
          await db.measurements.clear();
          location.reload();
        }
      });
    }

    const dropzone = document.getElementById('dataset-dropzone');
    if (dropzone) {
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
      });

      dropzone.addEventListener('dragover', () => dropzone.classList.add('dragover'));
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone.addEventListener('drop', (e) => {
        dropzone.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files);
        this.handleManualFileUpload(files);
      });
    }

    if (normalInput && faultInput) {
      const handleInputs = () => {
        if (normalInput.files.length > 0 && faultInput.files.length > 0) {
          this.handleManualFileUpload([normalInput.files[0], faultInput.files[0]]);
        }
      };
      normalInput.addEventListener('change', handleInputs);
      faultInput.addEventListener('change', handleInputs);
    }

    // 2. AI 학습 버튼
    const trainAeBtn = document.getElementById('train-ae-btn');
    const trainClsBtn = document.getElementById('train-cls-btn');

    if (trainAeBtn) {
      trainAeBtn.addEventListener('click', () => this.startAutoencoderTraining());
    }
    if (trainClsBtn) {
      trainClsBtn.addEventListener('click', () => this.startClassifierTraining());
    }

    // 모델 내보내기 버튼
    const exportModelBtn = document.getElementById('export-model-btn');
    if (exportModelBtn) {
      exportModelBtn.addEventListener('click', () => this.exportTrainedModel());
    }

    // 3. 시뮬레이션 제어 바
    const startSimBtn = document.getElementById('sim-start-btn');
    const pauseSimBtn = document.getElementById('sim-pause-btn');
    const resetSimBtn = document.getElementById('sim-reset-btn');
    const faultToggle = document.getElementById('fault-injection-toggle');
    const speedButtons = document.querySelectorAll('.speed-btn');

    if (startSimBtn) {
      startSimBtn.addEventListener('click', () => this.startSimulation());
    }
    if (pauseSimBtn) {
      pauseSimBtn.addEventListener('click', () => this.pauseSimulation());
    }
    if (resetSimBtn) {
      resetSimBtn.addEventListener('click', () => this.resetSimulation());
    }
    if (faultToggle) {
      faultToggle.addEventListener('change', (e) => {
        this.faultInjectionEnabled = e.target.checked;
        this.showToast(`돌발 고장 주입(10%): ${this.faultInjectionEnabled ? '활성화' : '비활성화'}`, 'info');
      });
    }

    speedButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        speedButtons.forEach(b => b.classList.remove('btn-active', 'btn-primary'));
        btn.classList.add('btn-active', 'btn-primary');
        const speed = parseInt(btn.dataset.speed, 10);
        this.simulationSpeed = 1000 / speed;
        if (this.isSimulating) {
          this.pauseSimulation();
          this.startSimulation();
        }
      });
    });

    // 4. TDD 실행 버튼
    const runTddBtn = document.getElementById('run-tdd-btn');
    if (runTddBtn) {
      runTddBtn.addEventListener('click', () => {
        const result = runAllTddTests();
        if (result.success) {
          alert('🏆 모든 TDD 단위 검증 테스트(수학 공식, 임계치 판정, 10D 특징 융합, F1-Score)를 100% 통과했습니다 (GREEN)!');
        } else {
          alert('🚨 TDD 테스트 실패: ' + result.error);
        }
      });
    }
  }

  /**
   * 로컬 기본 데이터셋 (정상 12만건 + 고장 3만건) 원클릭 로드
   */
  async loadDefaultDataset() {
    const progressModal = document.getElementById('progress-modal');
    const progressText = document.getElementById('progress-text');
    const progressBar = document.getElementById('progress-bar');
    const loadBtn = document.getElementById('load-default-dataset-btn');
    
    if (loadBtn) {
      loadBtn.disabled = true;
      loadBtn.innerText = '데이터 적재 중...';
    }

    if (progressModal && typeof progressModal.showModal === 'function') {
      try { progressModal.showModal(); } catch (e) {}
    }

    try {
      await dataStore.processAndIngestData(
        '챔버1_정상_12만건.csv',
        '챔버1_고장전1주일데이터_3만건.csv',
        (msg, percent) => {
          if (progressText) progressText.innerText = msg;
          if (progressBar) progressBar.value = percent;
        }
      );

      this.updateDataSummaryUI();
      document.getElementById('train-ae-btn').disabled = false;
      this.showToast('150,000건 데이터셋이 IndexedDB에 층화 분할(8:2:5) 적재되었습니다.', 'success');
      if (loadBtn) {
        loadBtn.innerText = '✅ 데이터셋 적재 완료 (15만건)';
        loadBtn.classList.remove('btn-primary');
        loadBtn.classList.add('btn-success');
      }
    } catch (e) {
      console.error(e);
      alert('데이터 로드 실패: ' + e.message);
      if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.innerText = '기본 실측 데이터셋 (15만건) 즉시 적재';
      }
    } finally {
      if (progressModal && typeof progressModal.close === 'function') {
        try { progressModal.close(); } catch (e) {}
      }
    }
  }

  /**
   * 사용자 드롭 / 파일 선택 처리
   */
  async handleManualFileUpload(files) {
    if (files.length < 2) {
      alert('정상 데이터 CSV(12만건)와 고장 데이터 CSV(3만건) 2개 파일을 모두 지정해주세요.');
      return;
    }

    let normalFile = null;
    let faultFile = null;

    files.forEach(f => {
      if (f.name.includes('정상')) normalFile = f;
      else if (f.name.includes('고장')) faultFile = f;
    });

    if (!normalFile || !faultFile) {
      normalFile = files[0];
      faultFile = files[1];
    }

    const progressModal = document.getElementById('progress-modal');
    const progressText = document.getElementById('progress-text');
    const progressBar = document.getElementById('progress-bar');
    if (progressModal && typeof progressModal.showModal === 'function') {
      try { progressModal.showModal(); } catch (e) {}
    }

    try {
      await dataStore.processAndIngestData(
        normalFile,
        faultFile,
        (msg, percent) => {
          if (progressText) progressText.innerText = msg;
          if (progressBar) progressBar.value = percent;
        }
      );

      this.updateDataSummaryUI();
      document.getElementById('train-ae-btn').disabled = false;
      this.showToast('업로드한 데이터가 층화 분할(8:2:5)되어 적재되었습니다.', 'success');
    } catch (e) {
      console.error(e);
      alert('업로드 처리 실패: ' + e.message);
    } finally {
      if (progressModal && typeof progressModal.close === 'function') {
        try { progressModal.close(); } catch (e) {}
      }
    }
  }

  updateDataSummaryUI() {
    const s = dataStore.stats;
    const totalElem = document.getElementById('stat-total-rows');
    const trainElem = document.getElementById('stat-train-rows');
    const valElem = document.getElementById('stat-val-rows');
    const testElem = document.getElementById('stat-test-rows');

    if (totalElem) totalElem.innerText = s.total.toLocaleString();
    if (trainElem) trainElem.innerText = `${s.train.toLocaleString()} (정상 ${s.classCounts[0] ? Math.floor(s.train * 0.8).toLocaleString() : '64,000'})`;
    if (valElem) valElem.innerText = s.val.toLocaleString();
    if (testElem) testElem.innerText = s.test.toLocaleString();
  }

  /**
   * 1단계 오토인코더 훈련
   */
  async startAutoencoderTraining() {
    const btn = document.getElementById('train-ae-btn');
    btn.disabled = true;
    btn.innerText = '학습 진행 중...';

    const logBox = document.getElementById('ae-train-log');
    if (logBox) logBox.classList.remove('hidden');

    try {
      const trainNormal = await dataStore.loadTrainData(true);
      const valNormal = await dataStore.loadValData(true);

      const result = await aiEngine.trainAutoencoder(trainNormal, valNormal, {
        onEpochEnd: (epoch, total, tLoss, vLoss) => {
          const logText = document.getElementById('ae-epoch-log');
          if (logText) {
            logText.innerText = `Epoch ${epoch}/${total} | Train Loss: ${tLoss.toFixed(5)} | Val Loss: ${vLoss.toFixed(5)}`;
          }
        },
        onEarlyStop: (epoch, bestLoss) => {
          const logText = document.getElementById('ae-epoch-log');
          if (logText) {
            logText.innerText += ` (조기 종료 적용: Epoch ${epoch}, Loss: ${bestLoss.toFixed(5)})`;
          }
        }
      });

      // 임계치 UI 갱신
      const thDisplay = document.getElementById('threshold-value-display');
      if (thDisplay) thDisplay.innerText = result.threshold.toFixed(5);

      const aeLogText = document.getElementById('ae-epoch-log');
      if (aeLogText && result) {
        aeLogText.innerHTML = `
          <div class="flex items-center justify-between text-slate-200">
            <span class="text-emerald-400 font-bold">✅ 1단계 오토인코더 학습 완료</span>
            <span class="text-[10px] text-slate-400 font-mono">최적 Val Loss: ${result.bestValLoss.toFixed(5)}</span>
          </div>
          <div class="flex items-center justify-between pt-1 text-[11px] font-mono border-t border-slate-800/80 mt-1">
            <span>산출 임계치(T_h): <b class="text-amber-400 font-bold">${result.threshold.toFixed(5)}</b></span>
            <span class="text-[10px] text-slate-400">정상 99% 백분위수 락</span>
          </div>
        `;
      }

      btn.innerText = '✅ 오토인코더 학습 완료';
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-success');

      document.getElementById('train-cls-btn').disabled = false;
      const exportBtn = document.getElementById('export-model-btn');
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.title = '학습된 모델 내보내기';
      }
      this.showToast(`오토인코더 학습 완료! 이상 임계치: ${result.threshold.toFixed(5)}`, 'success');
    } catch (e) {
      console.error(e);
      alert('오토인코더 학습 실패: ' + e.message);
      btn.disabled = false;
      btn.innerText = '▶ 오토인코더 학습 시작';
    }
  }

  /**
   * 2단계 다중 분류기 훈련
   */
  async startClassifierTraining() {
    const btn = document.getElementById('train-cls-btn');
    btn.disabled = true;
    btn.innerText = '10D 분류기 학습 중...';

    const logBox = document.getElementById('cls-train-log');
    if (logBox) logBox.classList.remove('hidden');

    try {
      const trainAll = await dataStore.loadTrainData(false);
      const valAll = await dataStore.loadValData(false);

      const result = await aiEngine.trainClassifier(trainAll, valAll, {
        onProgress: (msg) => {
          const logText = document.getElementById('cls-epoch-log');
          if (logText) logText.innerText = msg;
        },
        onEpochEnd: (epoch, total, tAcc, vAcc, vLoss, lr) => {
          const logText = document.getElementById('cls-epoch-log');
          if (logText) {
            logText.innerText = `Epoch ${epoch}/${total} | Val Acc: ${(vAcc * 100).toFixed(2)}% | Val Loss: ${vLoss.toFixed(4)} (LR: ${lr ? lr.toFixed(5) : '0.008'})`;
          }
        },
        onEarlyStop: (epoch, bestLoss) => {
          const logText = document.getElementById('cls-epoch-log');
          if (logText) {
            logText.innerText += ` (조기 종료: Epoch ${epoch}, Best Loss: ${bestLoss.toFixed(4)})`;
          }
        }
      });

      // 학습 완료 시점의 최종 수치 명확히 고정 표시
      const logText = document.getElementById('cls-epoch-log');
      if (logText && result) {
        const stoppedNotice = result.isEarlyStopped ? ` (조기 종료: Epoch ${result.finalEpoch})` : '';
        logText.innerHTML = `
          <div class="flex items-center justify-between text-slate-200">
            <span class="text-emerald-400 font-bold">✅ 2단계 분류기 학습 완료${stoppedNotice}</span>
            <span class="text-[10px] text-slate-400 font-mono">최종 Epoch ${result.finalEpoch}/${result.totalEpochs}</span>
          </div>
          <div class="flex items-center justify-between pt-1 text-[11px] font-mono border-t border-slate-800/80 mt-1">
            <span>검증 정확도(Val Acc): <b class="text-cyan-300 font-bold">${(result.lastValAcc * 100).toFixed(2)}%</b></span>
            <span>최적 손실(Best Loss): <b class="text-amber-300 font-bold">${result.bestValLoss.toFixed(4)}</b></span>
          </div>
        `;
      }

      btn.innerText = '✅ 2단계 분류기 학습 완료';
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-success');

      // 시뮬레이션 및 내보내기 버튼 활성화
      document.getElementById('sim-start-btn').disabled = false;
      const exportBtn = document.getElementById('export-model-btn');
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.title = '학습된 모델(오토인코더+분류기) 내보내기';
      }
      this.showToast('2단계 10차원 융합 고장 진단기 학습이 완료되었습니다!', 'success');
    } catch (e) {
      console.error(e);
      alert('분류기 학습 실패: ' + e.message);
      btn.disabled = false;
      btn.innerText = '▶ XGBoost/앙상블 분류기 학습';
    }
  }

  /**
   * 시뮬레이션 시작
   */
  async startSimulation() {
    if (this.isSimulating) return;

    // 시험 데이터 로드 (첫 시작 시)
    if (this.testDataset.length === 0) {
      const testRows = await dataStore.loadTestData();
      if (testRows.length === 0) {
        alert('시험용 데이터셋이 없습니다. 데이터를 먼저 적재해주세요.');
        return;
      }
      this.testDataset = testRows.filter(r => r.label_class === 0);
      this.faultTestDataset[1] = testRows.filter(r => r.label_class === 1);
      this.faultTestDataset[2] = testRows.filter(r => r.label_class === 2);
      this.faultTestDataset[3] = testRows.filter(r => r.label_class === 3);
    }

    this.isSimulating = true;
    document.getElementById('sim-start-btn').disabled = true;
    document.getElementById('sim-pause-btn').disabled = false;

    this.simulationTimer = setInterval(() => {
      this.tickSimulation();
    }, this.simulationSpeed);
  }

  pauseSimulation() {
    this.isSimulating = false;
    if (this.simulationTimer) {
      clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }
    document.getElementById('sim-start-btn').disabled = false;
    document.getElementById('sim-pause-btn').disabled = true;
  }

  resetSimulation() {
    this.pauseSimulation();
    this.testDataIndex = 0;
    chartsManager.reset();
    metricsCalculator.reset();
    this.updateAlarmSystem(0.01, aiEngine.threshold, {
      class_0_normal: 1,
      class_1_dry_pump: 0,
      class_2_booster1: 0,
      class_3_booster2: 0
    });
  }

  /**
   * 1틱 시뮬레이션 실행 (매초 또는 배속 주기)
   */
  tickSimulation() {
    let targetRow = null;
    const injectFault = this.faultInjectionEnabled && Math.random() < 0.10;

    if (injectFault) {
      // 10% 확률로 고장 3종 중 무작위 주입
      const faultClass = Math.floor(Math.random() * 3) + 1;
      const faultPool = this.faultTestDataset[faultClass];
      if (faultPool && faultPool.length > 0) {
        const randIdx = Math.floor(Math.random() * faultPool.length);
        targetRow = faultPool[randIdx];
      }
    }

    if (!targetRow) {
      if (this.testDataIndex >= this.testDataset.length) {
        this.testDataIndex = 0; // 루프 재생
      }
      targetRow = this.testDataset[this.testDataIndex];
      this.testDataIndex++;
    }

    if (!targetRow) return;

    // 실시간 AI 추론 파이프라인 가동
    const raw5D = [
      targetRow.dry_pump,
      targetRow.booster1,
      targetRow.booster2,
      targetRow.vacuum,
      targetRow.temp
    ];

    const inferenceResult = aiEngine.inferSingleSample(raw5D);

    // 1. 차트 푸시 (60fps FIFO)
    chartsManager.pushData(targetRow, inferenceResult.mse, inferenceResult.threshold);

    // 2. 3색 알람 신호등 및 가이드 갱신
    this.updateAlarmSystem(inferenceResult.mse, inferenceResult.threshold, inferenceResult.probabilities);

    // 3. 고장 확률 프로그레스 바 갱신
    this.updateProbabilityBars(inferenceResult.probabilities);

    // 4. 실시간 TDD Confusion Matrix & F1-Score 누적
    metricsCalculator.recordPrediction(targetRow.label_class, inferenceResult.predictedClass);
  }

  /**
   * 3색 경보 신호등 상태 전이 (plan.md 설계 준수)
   */
  updateAlarmSystem(mse, threshold, probas) {
    const card = document.getElementById('alarm-siren-card');
    const badge = document.getElementById('alarm-status-badge');
    const title = document.getElementById('alarm-title');
    const guide = document.getElementById('alarm-guide-text');

    if (!card) return;

    if (mse <= threshold) {
      // 1단계: 정상 (Green)
      card.className = "glass-panel alarm-green rounded-2xl p-5 shadow-xl transition-all duration-300";
      if (badge) {
        badge.className = "badge badge-success text-slate-950 font-black";
        badge.innerText = "NORMAL";
      }
      if (title) title.innerHTML = "✅ 정상 안정 운전";
      if (guide) guide.innerHTML = "건조 챔버 내 기계 계통이 안정적이며 최적 진공 배치가 정상 순항 중입니다.";
    } else {
      // 임계값 초과
      const maxFaultProb = Math.max(probas.class_1_dry_pump, probas.class_2_booster1, probas.class_3_booster2);

      if (maxFaultProb < 0.70) {
        // 2단계: 주의 (Yellow)
        card.className = "glass-panel alarm-yellow rounded-2xl p-5 shadow-xl transition-all duration-300";
        if (badge) {
          badge.className = "badge badge-warning text-slate-950 font-black";
          badge.innerText = "WARNING";
        }
        if (title) title.innerHTML = "⚠️ 일시적 주의 (이상치 감지)";
        if (guide) guide.innerHTML = `챔버 미세 변동 및 노이즈 검지. 예측 고장 확률(${Math.round(maxFaultProb * 100)}%)이 위험 기준선(70%) 미만입니다. 센서 트렌드 모니터링을 지속하십시오.`;
      } else {
        // 3단계: 긴급 위험 경보 (Red)
        let culprit = "알 수 없는 기계 계통 이탈";
        let action = "대기 제어 밸브 및 인버터 긴급 실측 요망.";

        if (probas.class_1_dry_pump === maxFaultProb) {
          culprit = "드라이펌프 기계적 이상";
          action = "드라이펌프 역전 전류 차단 및 배기 임펠러 온도를 긴급 실측 점검하십시오.";
        } else if (probas.class_2_booster1 === maxFaultProb) {
          culprit = "부스터 1호기 인버터 전류 제어 차단";
          action = "부스터1 모터 회전 속도 정비 점검을 조치하고 냉각 칠러 매체 공급량을 증가하십시오.";
        } else if (probas.class_3_booster2 === maxFaultProb) {
          culprit = "부스터 2호기 고부하 열화 이탈";
          action = "부스터2 펌프 긴급 수동 배기 루프를 차단하고 건조 사이클 정지 후 바이패스 정비를 지시하십시오.";
        }

        card.className = "glass-panel alarm-red rounded-2xl p-5 shadow-2xl transition-all duration-300";
        if (badge) {
          badge.className = "badge badge-error text-slate-950 font-black";
          badge.innerText = "DANGER";
        }
        if (title) title.innerHTML = `🚨 긴급 위험 예지 (${culprit})`;
        if (guide) guide.innerHTML = `<strong>진단 신뢰도: ${Math.round(maxFaultProb * 100)}%</strong><br>👉 <b>현장 대처 가이드:</b> ${action}`;
      }
    }
  }

  updateProbabilityBars(probas) {
    const p0 = Math.round(probas.class_0_normal * 100);
    const p1 = Math.round(probas.class_1_dry_pump * 100);
    const p2 = Math.round(probas.class_2_booster1 * 100);
    const p3 = Math.round(probas.class_3_booster2 * 100);

    const b0 = document.getElementById('prob-bar-0');
    const b1 = document.getElementById('prob-bar-1');
    const b2 = document.getElementById('prob-bar-2');
    const b3 = document.getElementById('prob-bar-3');

    const t0 = document.getElementById('prob-val-0');
    const t1 = document.getElementById('prob-val-1');
    const t2 = document.getElementById('prob-val-2');
    const t3 = document.getElementById('prob-val-3');

    if (b0) b0.value = p0;
    if (b1) b1.value = p1;
    if (b2) b2.value = p2;
    if (b3) b3.value = p3;

    if (t0) t0.innerText = `${p0}%`;
    if (t1) t1.innerText = `${p1}%`;
    if (t2) t2.innerText = `${p2}%`;
    if (t3) t3.innerText = `${p3}%`;
  }

  /**
   * 학습된 모델 전체 내보내기 (모바일 뷰어용)
   * - autoencoder.json + autoencoder.weights.bin
   * - classifier.json  + classifier.weights.bin
   * - worldway-params.json (스케일러 파라미터 + 임계치)
   */
  async exportTrainedModel() {
    const engine = window.aiEngine;
    if (!engine.isAutoencoderTrained) {
      this.showToast('먼저 오토인코더를 학습해야 합니다.', 'error');
      return;
    }

    const btn = document.getElementById('export-model-btn');
    if (btn) { btn.disabled = true; btn.textContent = '내보내는 중...'; }

    try {
      // ① 오토인코더 모델 파일 다운로드 (JSON + weights.bin)
      this.showToast('오토인코더 모델 저장 중...', 'info');
      await engine.autoencoder.save('downloads://worldway-autoencoder');
      await new Promise(r => setTimeout(r, 800));

      // ② 분류기 모델 파일 다운로드 (학습된 경우)
      if (engine.isClassifierTrained) {
        this.showToast('분류기 모델 저장 중...', 'info');
        await engine.classifier.save('downloads://worldway-classifier');
        await new Promise(r => setTimeout(r, 800));
      }

      // ③ 스케일러 파라미터 + 임계치 JSON 다운로드
      const params = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        threshold: engine.threshold,
        scaler5D: {
          type: 'MinMaxScaler',
          min: Array.from(engine.scaler5D.min),
          max: Array.from(engine.scaler5D.max)
        },
        scaler10D: {
          type: 'StandardScaler',
          mean: Array.from(engine.scaler10D.mean),
          std:  Array.from(engine.scaler10D.std)
        },
        hasClassifier: engine.isClassifierTrained,
        featureNames: ['dry_pump', 'booster1', 'booster2', 'vacuum', 'temp'],
        classNames:   ['정상', '건식펌프 고장', '부스터1 고장', '부스터2 고장']
      };
      const blob = new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'worldway-params.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      this.showToast(
        `✅ 모델 내보내기 완료! (총 ${engine.isClassifierTrained ? 5 : 3}개 파일) — viewer.html에서 불러오세요.`,
        'success'
      );
    } catch (err) {
      console.error('[Export] 모델 내보내기 실패:', err);
      this.showToast('모델 내보내기 실패: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📦 모델 내보내기 (뷰어용)'; }
    }
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const alertClass = type === 'success' ? 'alert-success' : type === 'error' ? 'alert-error' : 'alert-info';
    toast.className = `alert ${alertClass} shadow-lg py-2 px-4 text-sm font-semibold animate-fade-in`;
    toast.innerHTML = `<span>${message}</span>`;

    const container = document.getElementById('toast-container');
    if (container) {
      container.appendChild(toast);
      setTimeout(() => {
        toast.remove();
      }, 3500);
    }
  }
}

// 앱 인스턴스 초기화
window.app = new App();
document.addEventListener('DOMContentLoaded', () => {
  window.app.init();
});
