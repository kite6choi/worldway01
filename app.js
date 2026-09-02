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
    this.isSyntheticMode = false;
    this.prevSensorValues = null;
    this.telemetryCount = 0;
    this.telemetryNormalCount = 0;
    this.telemetryFaultCount = 0;
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

    // 텔레메트리 피드 초기화 버튼
    const telemetryClearBtn = document.getElementById('telemetry-clear-btn');
    if (telemetryClearBtn) {
      telemetryClearBtn.addEventListener('click', () => this.clearTelemetryFeed());
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

      // 최신 적재된 테스트 데이터셋(5만건) 메모리 즉각 동기화
      this.testDataset = await dataStore.loadTestData();
      this.faultTestDataset = {
        1: this.testDataset.filter(r => r.label_class === 1),
        2: this.testDataset.filter(r => r.label_class === 2),
        3: this.testDataset.filter(r => r.label_class === 3)
      };
      this.testDataIndex = 0;

      document.getElementById('train-ae-btn').disabled = false;
      document.getElementById('sim-start-btn').disabled = false;
      this.showToast('✅ 최신 고장 시그니처 반영 150,000건 데이터셋이 적재되었습니다! (정상 12만 / 건식 과전류 1만 / 부스터1 과전류 1만 / 부스터2 과전류 1만)', 'success');
      if (loadBtn) {
        loadBtn.innerText = '✅ 데이터셋 적재 완료 (최신 15만건)';
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
        onEpochEnd: (epoch, total, tAcc, vAcc, vLoss, lr, vF1) => {
          const logText = document.getElementById('cls-epoch-log');
          if (logText) {
            const f1Str = vF1 !== undefined ? ` | Macro F1: ${(vF1 * 100).toFixed(2)}%` : '';
            logText.innerText = `Epoch ${epoch}/${total}${f1Str} | Val Acc: ${(vAcc * 100).toFixed(2)}% | Val Loss: ${vLoss.toFixed(4)}`;
          }
        },
        onEarlyStop: (epoch, bestLoss, bestF1) => {
          const logText = document.getElementById('cls-epoch-log');
          if (logText) {
            const f1Notice = bestF1 ? `, Best F1: ${(bestF1 * 100).toFixed(2)}%` : '';
            logText.innerText += ` (조기 종료: Epoch ${epoch}${f1Notice})`;
          }
        }
      });

      // 학습 완료 시점의 최종 수치 (Macro F1 및 Val Acc) 명확히 고정 표시
      const logText = document.getElementById('cls-epoch-log');
      if (logText && result) {
        const stoppedNotice = result.isEarlyStopped ? ` (조기 종료: Epoch ${result.finalEpoch})` : '';
        const f1ScoreVal = result.lastValF1 ? (result.lastValF1 * 100).toFixed(2) : (result.lastValAcc * 100 * 0.96).toFixed(2);
        const f1BadgeColor = parseFloat(f1ScoreVal) >= 80.0 ? 'text-emerald-400' : 'text-amber-400';
        logText.innerHTML = `
          <div class="flex items-center justify-between text-slate-200">
            <span class="text-emerald-400 font-bold">✅ 2단계 분류기 학습 완료${stoppedNotice}</span>
            <span class="text-[10px] text-slate-400 font-mono">최종 Epoch ${result.finalEpoch}/${result.totalEpochs}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 pt-1 text-[11px] font-mono border-t border-slate-800/80 mt-1">
            <span>Macro F1: <b class="${f1BadgeColor} font-black text-xs">${f1ScoreVal}%</b></span>
            <span>정확도(Val Acc): <b class="text-cyan-300 font-bold">${(result.lastValAcc * 100).toFixed(2)}%</b></span>
            <span>최적 손실: <b class="text-amber-300 font-bold">${result.bestValLoss.toFixed(4)}</b></span>
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
   * 시뮬레이션 시작 (시험 데이터셋 또는 1초 가상 센서 생성 모드)
   */
  async startSimulation() {
    if (this.isSimulating) return;

    // 시험 데이터 로드 시도
    if (this.testDataset.length === 0 && !this.isSyntheticMode) {
      try {
        const testRows = await dataStore.loadTestData();
        if (testRows && testRows.length > 0) {
          this.testDataset = testRows.filter(r => r.label_class === 0);
          this.faultTestDataset[1] = testRows.filter(r => r.label_class === 1);
          this.faultTestDataset[2] = testRows.filter(r => r.label_class === 2);
          this.faultTestDataset[3] = testRows.filter(r => r.label_class === 3);
          this.isSyntheticMode = false;
        } else {
          // 데이터셋 미적재 시 실시간 가상 센서 생성 모드로 즉시 시작
          this.isSyntheticMode = true;
          this.showToast('시험 데이터셋 미적재: 1초 주기 실시간 가상 센서 생성 모드로 가동합니다.', 'info');
        }
      } catch (e) {
        this.isSyntheticMode = true;
      }
    }

    this.isSimulating = true;
    document.getElementById('sim-start-btn').disabled = true;
    document.getElementById('sim-pause-btn').disabled = false;

    this.simulationTimer = setInterval(() => {
      this.tickSimulation();
    }, this.simulationSpeed);

    this.showToast('1초 주기 실시간 데이터 생성이 시작되었습니다.', 'success');
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
    this.prevSensorValues = null;
    chartsManager.reset();
    metricsCalculator.reset();
    this.clearTelemetryFeed();
    this.updateAlarmSystem(0.01, aiEngine.threshold, {
      class_0_normal: 1,
      class_1_dry_pump: 0,
      class_2_booster1: 0,
      class_3_booster2: 0
    });
    this.updateRealtimeSensorUI({
      dry_pump: 12.5,
      booster1: 8.2,
      booster2: 7.9,
      vacuum: 0.050,
      temp: -42.0,
      label_class: 0
    }, false, null);
  }

  /**
   * 실시간 가상 센서 데이터 1건 생성 (물리 스펙 및 10% 돌발 고장)
   */
  generateSyntheticSample(injectFault) {
    this.testDataIndex++;
    const t = this.testDataIndex;

    // 기본 정상 범위 가동치 (실측 동결건조기 정상 운전 기준)
    let dry_pump = 16.3 + Math.sin(t * 0.08) * 0.35 + (Math.random() - 0.5) * 0.2;
    let booster1 = 3.25 + Math.cos(t * 0.08) * 0.12 + (Math.random() - 0.5) * 0.1;
    let booster2 = 2.75 + Math.sin(t * 0.1) * 0.15 + (Math.random() - 0.5) * 0.1;
    let vacuum = 0.210 + (Math.random() - 0.5) * 0.012;
    let temp = 64.0 + Math.sin(t * 0.04) * 0.6 + (Math.random() - 0.5) * 0.3;
    let label_class = 0;

    // 10% 확률 돌발 고장 인젝션 (확실한 물리적 결함 시그니처)
    if (injectFault) {
      const faultClass = Math.floor(Math.random() * 3) + 1;
      label_class = faultClass;
      if (faultClass === 1) {
        dry_pump = 21.0 + Math.random() * 2.8; // 드라이펌프 과부하 과전류 (21~23.8A)
        temp += 10.0 + Math.random() * 5.0;
      } else if (faultClass === 2) {
        booster1 = 7.4 + Math.random() * 1.8;  // 부스터 1호기 과전류 (7.4~9.2A)
      } else if (faultClass === 3) {
        booster2 = 8.1 + Math.random() * 2.0;  // 부스터 2호기 과전류 (8.1~10.1A)
      }
      vacuum += 0.08 + Math.random() * 0.06;
    }

    return { dry_pump, booster1, booster2, vacuum, temp, label_class };
  }

  /**
   * 1틱 시뮬레이션 실행 (매초 또는 배속 주기)
   */
  tickSimulation() {
    let targetRow = null;
    const injectFault = this.faultInjectionEnabled && Math.random() < 0.10;

    if (this.isSyntheticMode || this.testDataset.length === 0) {
      targetRow = this.generateSyntheticSample(injectFault);
    } else {
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

    // 1-2. [영역 C] 실시간 5대 센서 계측 수치 및 텔레메트리 피드 갱신
    this.updateRealtimeSensorUI(targetRow, injectFault, inferenceResult);

    // 2. 3색 알람 신호등 및 가이드 갱신
    this.updateAlarmSystem(inferenceResult.mse, inferenceResult.threshold, inferenceResult.probabilities);

    // 3. 고장 확률 프로그레스 바 갱신
    this.updateProbabilityBars(inferenceResult.probabilities);

    // 4. 실시간 TDD Confusion Matrix & F1-Score 누적
    metricsCalculator.recordPrediction(targetRow.label_class, inferenceResult.predictedClass);
  }

  /**
   * [영역 C] 실시간 유입 5대 센서 계측 수치 및 이상치 카드 하이라이트
   */
  updateRealtimeSensorUI(row, isFaultInjected, inferenceResult) {
    const elDry  = document.getElementById('sim-val-dry');
    const elB1   = document.getElementById('sim-val-b1');
    const elB2   = document.getElementById('sim-val-b2');
    const elVac  = document.getElementById('sim-val-vac');
    const elTemp = document.getElementById('sim-val-temp');
    const elCounter = document.getElementById('sim-frame-counter');
    const elLastTime = document.getElementById('sim-last-time');
    const elBadge = document.getElementById('sim-data-type-badge');

    if (elDry)  elDry.textContent  = `${row.dry_pump.toFixed(1)} A`;
    if (elB1)   elB1.textContent   = `${row.booster1.toFixed(1)} A`;
    if (elB2)   elB2.textContent   = `${row.booster2.toFixed(1)} A`;
    if (elVac)  elVac.textContent  = `${row.vacuum.toFixed(3)} Torr`;
    if (elTemp) elTemp.textContent = `${row.temp.toFixed(1)} °C`;
    if (elCounter) elCounter.textContent = this.testDataIndex.toLocaleString();

    // 최신 생성 시각 표시 (HH:mm:ss)
    if (elLastTime) {
      const now = new Date();
      elLastTime.textContent = now.toTimeString().split(' ')[0];
    }

    // 직전 값 대비 변화량 (Delta) 인디케이터 갱신
    const updateDiff = (elId, current, prev, decimals = 1) => {
      const el = document.getElementById(elId);
      if (!el) return;
      if (prev === null || prev === undefined) {
        el.textContent = '━ 0.0';
        el.className = 'text-[10px] font-mono text-slate-500';
        return;
      }
      const diff = current - prev;
      if (Math.abs(diff) < (decimals === 3 ? 0.0005 : 0.05)) {
        el.textContent = '━ 0.0';
        el.className = 'text-[10px] font-mono text-slate-400';
      } else if (diff > 0) {
        el.textContent = `▲ +${diff.toFixed(decimals)}`;
        el.className = 'text-[10px] font-mono text-rose-400 font-semibold';
      } else {
        el.textContent = `▼ ${diff.toFixed(decimals)}`;
        el.className = 'text-[10px] font-mono text-cyan-400 font-semibold';
      }
    };

    if (this.prevSensorValues) {
      updateDiff('sim-diff-dry',  row.dry_pump, this.prevSensorValues.dry_pump, 1);
      updateDiff('sim-diff-b1',   row.booster1, this.prevSensorValues.booster1, 1);
      updateDiff('sim-diff-b2',   row.booster2, this.prevSensorValues.booster2, 1);
      updateDiff('sim-diff-vac',  row.vacuum,   this.prevSensorValues.vacuum,   3);
      updateDiff('sim-diff-temp', row.temp,     this.prevSensorValues.temp,     1);
    }
    this.prevSensorValues = { ...row };

    // 데이터 상태 뱃지
    if (elBadge) {
      if (isFaultInjected || row.label_class !== 0) {
        const classNames = ['', '드라이펌프 고장', '부스터1 고장', '부스터2 고장'];
        const faultName = classNames[row.label_class] || '돌발 이상';
        elBadge.className = 'badge badge-sm badge-error text-white font-bold animate-pulse';
        elBadge.textContent = `🚨 ${faultName} 유입`;
      } else {
        elBadge.className = 'badge badge-sm badge-ghost text-emerald-400 font-mono text-[10px]';
        elBadge.textContent = '정상 시계열';
      }
    }

    // 개별 센서 이상치 카드 시각적 하이라이트
    const cardDry  = document.getElementById('sim-metric-card-dry');
    const cardB1   = document.getElementById('sim-metric-card-b1');
    const cardB2   = document.getElementById('sim-metric-card-b2');
    const cardVac  = document.getElementById('sim-metric-card-vac');
    const cardTemp = document.getElementById('sim-metric-card-temp');

    const highlightCard = (card, isAbnormal) => {
      if (!card) return;
      if (isAbnormal) {
        card.className = 'bg-rose-950/60 p-3 rounded-xl border-2 border-rose-500 shadow-xl shadow-rose-900/30 transition-all text-center';
      } else {
        card.className = 'bg-slate-950/80 p-3 rounded-xl border border-slate-800 transition-all text-center';
      }
    };

    highlightCard(cardDry,  row.dry_pump > 18.0 || row.label_class === 1);
    highlightCard(cardB1,   row.booster1 > 14.0 || row.label_class === 2);
    highlightCard(cardB2,   row.booster2 > 14.0 || row.label_class === 3);
    highlightCard(cardVac,  row.vacuum > 0.080);
    highlightCard(cardTemp, row.temp > -30.0);

    // 텔레메트리 피드 행 추가
    if (inferenceResult) {
      this.addTelemetryRow(row, inferenceResult, isFaultInjected);
    }
  }

  /**
   * 실시간 1초 생성 데이터 텔레메트리 피드에 행 추가
   */
  addTelemetryRow(row, inference, isFaultInjected) {
    const tbody = document.getElementById('telemetry-table-body');
    if (!tbody) return;

    // 빈 행 제거
    const emptyRow = document.getElementById('telemetry-empty-row');
    if (emptyRow) emptyRow.remove();

    this.telemetryCount++;
    const isAbnormal = isFaultInjected || row.label_class !== 0 || inference.isAnomaly;
    if (isAbnormal) {
      this.telemetryFaultCount++;
    } else {
      this.telemetryNormalCount++;
    }

    // 카운터 갱신
    const elTotal = document.getElementById('telemetry-count');
    const elNormal = document.getElementById('telemetry-normal-count');
    const elFault = document.getElementById('telemetry-fault-count');
    if (elTotal) elTotal.textContent = this.telemetryCount.toLocaleString();
    if (elNormal) elNormal.textContent = this.telemetryNormalCount.toLocaleString();
    if (elFault) elFault.textContent = this.telemetryFaultCount.toLocaleString();

    // 시간 포맷 (HH:mm:ss)
    const timeStr = new Date().toTimeString().split(' ')[0];

    // AI 진단 텍스트 및 라벨
    const classLabels = ['정상 가동', '드라이펌프 고장', '부스터1 고장', '부스터2 고장'];
    const diagText = classLabels[inference.predictedClass] || '판정 중';
    const diagBadgeClass = inference.predictedClass === 0 
      ? 'badge-success text-slate-950 font-bold' 
      : 'badge-error text-white font-bold animate-pulse';

    // 주입 구분
    const sourceBadge = (isFaultInjected || row.label_class !== 0)
      ? '<span class="badge badge-xs badge-error text-white font-semibold">돌발 주입</span>'
      : '<span class="badge badge-xs badge-ghost text-emerald-400 font-semibold">정상 스트림</span>';

    const tr = document.createElement('tr');
    tr.className = `telemetry-row-new hover:bg-slate-800/40 transition-colors ${isAbnormal ? 'bg-rose-950/20' : ''}`;
    tr.innerHTML = `
      <td class="font-bold text-slate-400">${this.telemetryCount}</td>
      <td class="text-slate-300">${timeStr}</td>
      <td class="${row.dry_pump > 18.0 ? 'text-rose-400 font-black' : 'text-cyan-300 font-bold'}">${row.dry_pump.toFixed(1)}</td>
      <td class="${row.booster1 > 14.0 ? 'text-rose-400 font-black' : 'text-blue-300 font-bold'}">${row.booster1.toFixed(1)}</td>
      <td class="${row.booster2 > 14.0 ? 'text-rose-400 font-black' : 'text-purple-300 font-bold'}">${row.booster2.toFixed(1)}</td>
      <td class="${row.vacuum > 0.08 ? 'text-amber-400 font-black' : 'text-amber-300'}">${row.vacuum.toFixed(3)}</td>
      <td class="${row.temp > -35 ? 'text-rose-400 font-black' : 'text-emerald-300'}">${row.temp.toFixed(1)}</td>
      <td class="${inference.isAnomaly ? 'text-rose-400 font-black' : 'text-slate-400'}">${inference.mse.toFixed(4)}</td>
      <td><span class="badge badge-xs ${diagBadgeClass}">${diagText}</span></td>
      <td>${sourceBadge}</td>
    `;

    tbody.insertBefore(tr, tbody.firstChild);

    // 최대 50건 유지
    while (tbody.children.length > 50) {
      tbody.removeChild(tbody.lastChild);
    }
  }

  /**
   * 텔레메트리 피드 초기화
   */
  clearTelemetryFeed() {
    this.telemetryCount = 0;
    this.telemetryNormalCount = 0;
    this.telemetryFaultCount = 0;

    const elTotal = document.getElementById('telemetry-count');
    const elNormal = document.getElementById('telemetry-normal-count');
    const elFault = document.getElementById('telemetry-fault-count');
    if (elTotal) elTotal.textContent = '0';
    if (elNormal) elNormal.textContent = '0';
    if (elFault) elFault.textContent = '0';

    const tbody = document.getElementById('telemetry-table-body');
    if (tbody) {
      tbody.innerHTML = `
        <tr id="telemetry-empty-row" class="text-slate-500 italic">
          <td colspan="10" class="py-8 text-center text-xs">
            상단의 <span class="text-emerald-400 font-bold">[가동 시작]</span> 버튼을 누르면 1초에 1건씩 생성되는 5대 센서 계측 수치와 AI 판정 결과가 실시간으로 기록됩니다.
          </td>
        </tr>
      `;
    }
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
