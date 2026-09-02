/**
 * ai-engine.js
 * 1단계 오토인코더(Autoencoder) 이상 탐지 및
 * 10차원 지능형 특징 융합(Feature Fusion) &
 * 2단계 다중 분류(Multi-class Classifier) 고장 진단 엔진
 * (Class Weighting, StandardScaler, ReduceLROnPlateau, EarlyStopping 최적화 적용)
 */

class MinMaxScaler {
  constructor() {
    this.min = [];
    this.max = [];
    this.isFitted = false;
  }

  fit(data) {
    if (!data || data.length === 0) return;
    const numFeatures = data[0].length;
    this.min = new Array(numFeatures).fill(Infinity);
    this.max = new Array(numFeatures).fill(-Infinity);

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      for (let j = 0; j < numFeatures; j++) {
        const val = row[j];
        if (val < this.min[j]) this.min[j] = val;
        if (val > this.max[j]) this.max[j] = val;
      }
    }

    // 분모 0 방지 epsilon
    for (let j = 0; j < numFeatures; j++) {
      if (this.max[j] === this.min[j]) {
        this.max[j] += 1e-5;
      }
    }
    this.isFitted = true;
  }

  transform(data) {
    if (!this.isFitted) throw new Error('MinMaxScaler is not fitted yet.');
    const result = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const scaled = [];
      for (let j = 0; j < row.length; j++) {
        const norm = (row[j] - this.min[j]) / (this.max[j] - this.min[j]);
        scaled.push(norm);
      }
      result.push(scaled);
    }
    return result;
  }

  transformRow(row) {
    const scaled = [];
    for (let j = 0; j < row.length; j++) {
      const norm = (row[j] - this.min[j]) / (this.max[j] - this.min[j]);
      scaled.push(norm);
    }
    return scaled;
  }

  inverseTransformRow(scaledRow) {
    const original = [];
    for (let j = 0; j < scaledRow.length; j++) {
      const val = scaledRow[j] * (this.max[j] - this.min[j]) + this.min[j];
      original.push(val);
    }
    return original;
  }
}

class StandardScaler {
  constructor() {
    this.mean = [];
    this.std = [];
    this.isFitted = false;
  }

  fit(data) {
    if (!data || data.length === 0) return;
    const numFeatures = data[0].length;
    this.mean = new Array(numFeatures).fill(0);
    this.std = new Array(numFeatures).fill(0);

    const n = data.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < numFeatures; j++) {
        this.mean[j] += data[i][j];
      }
    }
    for (let j = 0; j < numFeatures; j++) {
      this.mean[j] /= n;
    }

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < numFeatures; j++) {
        this.std[j] += Math.pow(data[i][j] - this.mean[j], 2);
      }
    }
    for (let j = 0; j < numFeatures; j++) {
      this.std[j] = Math.sqrt(this.std[j] / n) || 1e-5;
    }
    this.isFitted = true;
  }

  transform(data) {
    if (!this.isFitted) throw new Error('StandardScaler is not fitted yet.');
    return data.map(row => row.map((val, j) => (val - this.mean[j]) / this.std[j]));
  }

  transformRow(row) {
    if (!this.isFitted) return row;
    return row.map((val, j) => (val - this.mean[j]) / this.std[j]);
  }

  /**
   * Float32Array(nRows × nCols) 형태의 평탄 배열에 fit
   * 중첩 배열 없이 대용량 데이터를 안전하게 처리 (스택 오버플로 방지)
   */
  fitFlat(flatData, nCols) {
    const n = Math.floor(flatData.length / nCols);
    this.mean = new Array(nCols).fill(0);
    this.std  = new Array(nCols).fill(0);
    for (let i = 0; i < flatData.length; i++) {
      this.mean[i % nCols] += flatData[i];
    }
    for (let j = 0; j < nCols; j++) this.mean[j] /= n;
    for (let i = 0; i < flatData.length; i++) {
      const j = i % nCols;
      this.std[j] += (flatData[i] - this.mean[j]) ** 2;
    }
    for (let j = 0; j < nCols; j++) {
      this.std[j] = Math.sqrt(this.std[j] / n) || 1e-5;
    }
    this.isFitted = true;
  }

  /**
   * Float32Array(nRows × nCols) → 정규화된 Float32Array 반환 (안전한 TypedArray 방식)
   */
  transformFlat(flatData, nCols) {
    const result = new Float32Array(flatData.length);
    for (let i = 0; i < flatData.length; i++) {
      const j = i % nCols;
      result[i] = (flatData[i] - this.mean[j]) / this.std[j];
    }
    return result;
  }
}

class AIEngine {
  constructor() {
    this.autoencoder = null;
    this.classifier = null;
    this.scaler5D = new MinMaxScaler();
    this.scaler10D = new StandardScaler();
    this.threshold = 0.0450; // 기본 임계치
    this.isAutoencoderTrained = false;
    this.isClassifierTrained = false;
  }

  /**
   * 1단계 오토인코더 모델 아키텍처 구축 (spec.md, plan.md 준수)
   * 5D -> 3D (ReLU) -> 2D (ReLU) -> 3D (ReLU) -> 5D (Linear)
   */
  buildAutoencoderModel() {
    const model = tf.sequential();

    model.add(tf.layers.dense({
      units: 3,
      activation: 'relu',
      inputShape: [5],
      name: 'encoder_hidden'
    }));

    model.add(tf.layers.dense({
      units: 2,
      activation: 'relu',
      name: 'latent_space'
    }));

    model.add(tf.layers.dense({
      units: 3,
      activation: 'relu',
      name: 'decoder_hidden'
    }));

    model.add(tf.layers.dense({
      units: 5,
      activation: 'linear',
      name: 'decoder_output'
    }));

    model.compile({
      optimizer: tf.train.adam(0.005),
      loss: 'meanSquaredError'
    });

    this.autoencoder = model;
    return model;
  }

  /**
   * 2단계 다중 분류 신경망 모델 구축 (10D -> 4 Class Softmax)
   * BatchNorm 및 고용량 Dense 레이어 적용으로 고장 식별력 극대화
   */
  buildClassifierModel(initialLearningRate = 0.008) {
    const model = tf.sequential();

    model.add(tf.layers.dense({
      units: 32,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      inputShape: [10],
      name: 'cls_hidden1'
    }));

    model.add(tf.layers.batchNormalization());

    model.add(tf.layers.dense({
      units: 16,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      name: 'cls_hidden2'
    }));

    model.add(tf.layers.dense({
      units: 4,
      activation: 'softmax',
      name: 'cls_output'
    }));

    model.compile({
      optimizer: tf.train.adam(initialLearningRate),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });

    this.classifier = model;
    return model;
  }

  extract5DFeatures(rows) {
    return rows.map(r => [
      r.dry_pump,
      r.booster1,
      r.booster2,
      r.vacuum,
      r.temp
    ]);
  }

  /**
   * 1단계 오토인코더 학습 (정상 64,000건, 검증 16,000건 조기종료 감시)
   */
  async trainAutoencoder(trainRows, valRows, callbacks = {}) {
    if (!trainRows || trainRows.length === 0) {
      throw new Error('학습용 정상 데이터가 없습니다. 먼저 데이터셋을 적재해주세요.');
    }
    if (!valRows || valRows.length === 0) {
      throw new Error('검증용 정상 데이터가 없습니다. 먼저 데이터셋을 적재해주세요.');
    }

    if (!this.autoencoder) {
      this.buildAutoencoderModel();
    }

    const trainRaw = this.extract5DFeatures(trainRows);
    const valRaw = this.extract5DFeatures(valRows);

    this.scaler5D.fit(trainRaw);
    const trainScaled = this.scaler5D.transform(trainRaw);
    const valScaled = this.scaler5D.transform(valRaw);

    const xTrain = tf.tensor2d(trainScaled);
    const xVal = tf.tensor2d(valScaled);

    const epochs = 20;
    const batchSize = 512;
    let bestValLoss = Infinity;
    let patienceCount = 0;
    const patience = 4;

    for (let epoch = 1; epoch <= epochs; epoch++) {
      const history = await this.autoencoder.fit(xTrain, xTrain, {
        epochs: 1,
        batchSize: batchSize,
        validationData: [xVal, xVal],
        shuffle: true,
        verbose: 0
      });

      const trainLoss = history.history.loss[0];
      const valLoss = history.history.val_loss[0];

      if (callbacks.onEpochEnd) {
        callbacks.onEpochEnd(epoch, epochs, trainLoss, valLoss);
      }

      await tf.nextFrame(); // UI 반응성 유지

      // 조기 종료 (Early Stopping)
      if (valLoss < bestValLoss) {
        bestValLoss = valLoss;
        patienceCount = 0;
      } else {
        patienceCount++;
        if (patienceCount >= patience) {
          if (callbacks.onEarlyStop) callbacks.onEarlyStop(epoch, bestValLoss);
          break;
        }
      }
    }

    xTrain.dispose();
    xVal.dispose();

    // 임계치 계산: 검증 정상 데이터 16,000건의 상위 99% 백분위수
    this.threshold = this.calculateThreshold(valScaled, 'percentile99');
    this.isAutoencoderTrained = true;

    return {
      threshold: this.threshold,
      bestValLoss
    };
  }

  /**
   * 임계값 산출 통계 공식 (99% 백분위수 또는 3-Sigma)
   */
  calculateThreshold(valScaledFeatures, mode = 'percentile99') {
    return tf.tidy(() => {
      const inputs = tf.tensor2d(valScaledFeatures);
      const outputs = this.autoencoder.predict(inputs);
      const mseTensor = tf.sub(inputs, outputs).square().mean(1);
      const mseArray = Array.from(mseTensor.dataSync());

      mseArray.sort((a, b) => a - b);

      if (mode === 'percentile99') {
        const index99 = Math.floor(mseArray.length * 0.99);
        return mseArray[Math.min(index99, mseArray.length - 1)];
      } else {
        // 3-Sigma: mu + 3 * sigma
        const mean = mseArray.reduce((a, b) => a + b, 0) / mseArray.length;
        const variance = mseArray.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / mseArray.length;
        const std = Math.sqrt(variance);
        return mean + 3 * std;
      }
    });
  }

  /**
   * 10차원 융합 특징 벡터 생성
   * [x1..x5, |x1-xhat1|..|x5-xhat5|] + StandardScaler 변환
   */
  generate10DFeatureVector(raw5D) {
    return tf.tidy(() => {
      const scaled5D = this.scaler5D.transformRow(raw5D);
      const inputTensor = tf.tensor2d([scaled5D]);
      const reconTensor = this.autoencoder.predict(inputTensor);
      const reconScaled = Array.from(reconTensor.dataSync());
      
      const rawFused = new Float32Array(10);
      let mse = 0;

      for (let i = 0; i < 5; i++) {
        rawFused[i] = scaled5D[i];
        const error = Math.abs(scaled5D[i] - reconScaled[i]);
        rawFused[i + 5] = error;
        mse += (scaled5D[i] - reconScaled[i]) ** 2;
      }
      mse /= 5;

      const fusedNormalized = this.scaler10D.transformRow(Array.from(rawFused));

      return {
        fusedVector: fusedNormalized,
        reconstructedRaw: this.scaler5D.inverseTransformRow(reconScaled),
        mse: mse
      };
    });
  }

  /**
   * 청크 단위 비동기 10D 융합 생성 — Float32Array 반환 (콜스택 안전)
   *
   * ▸ 반환값: { flatData: Float32Array(nRows×10), nRows: number }
   * ▸ 중첩 배열(nested array) 미사용 → 스프레드/flatMap 없음 → 스택 안전
   * ▸ 각 청크: tf.tidy() 텐서 즉시 해제 + tf.nextFrame() UI 양보
   *
   * @param {Array}  rows            - 원시 센서 행 배열
   * @param {Object} [opts]
   * @param {boolean} [opts.diagnoseLog=false]  - 진단 로그 여부
   * @param {number}  [opts.chunkSize=2500]     - 청크 크기
   * @param {number}  [opts.progressStart=0]   - 시작 진행률
   * @param {number}  [opts.progressEnd=100]   - 종료 진행률
   * @param {Function}[opts.onProgress]        - (msg, pct) 콜백
   * @returns {Promise<{flatData: Float32Array, nRows: number}>}
   */
  async batchGenerate10DFeaturesAsync(rows, opts = {}) {
    const {
      diagnoseLog = false,
      chunkSize = 2500,
      progressStart = 0,
      progressEnd = 100,
      onProgress = null
    } = opts;

    const nRows = rows.length;
    const raw5DList   = this.extract5DFeatures(rows);
    const scaled5DList = this.scaler5D.transform(raw5DList);

    // ── 출력 버퍼 사전 할당 (중첩 배열 완전 제거) ────────────────────────────
    const flatData    = new Float32Array(nRows * 10);
    const totalChunks = Math.ceil(nRows / chunkSize);

    for (let ci = 0; ci < totalChunks; ci++) {
      const start = ci * chunkSize;
      const end   = Math.min(start + chunkSize, nRows);
      const chunkSlice = scaled5DList.slice(start, end); // Array<Array<5>>, 최대 2500행
      const chunkLen   = end - start;

      // ── tf.tidy: 청크 텐서 즉시 해제 ────────────────────────────────────────
      const chunkFlat = tf.tidy(() => {
        const inTensor  = tf.tensor2d(chunkSlice);          // [chunkLen, 5]
        const reconTensor = this.autoencoder.predict(inTensor); // [chunkLen, 5]
        // dataSync() → Float32Array (스프레드 없이 안전한 TypedArray 반환)
        const inData    = inTensor.dataSync();              // Float32Array(chunkLen×5)
        const reconData = reconTensor.dataSync();           // Float32Array(chunkLen×5)

        const out = new Float32Array(chunkLen * 10);
        for (let i = 0; i < chunkLen; i++) {
          for (let j = 0; j < 5; j++) {
            const raw  = inData[i * 5 + j];
            const recon = reconData[i * 5 + j];
            out[i * 10 + j]     = raw;
            out[i * 10 + j + 5] = Math.abs(raw - recon);
          }
        }
        return out; // Float32Array — tidy 탈출 가능 (primitive typed array)
      });

      // ── 청크 결과를 메인 버퍼에 인덱스 복사 (push/spread 없음) ────────────
      flatData.set(chunkFlat, start * 10);

      // ── 진행률 콜백 ─────────────────────────────────────────────────────────
      if (onProgress) {
        const ratio = (ci + 1) / totalChunks;
        const pct   = Math.round(progressStart + ratio * (progressEnd - progressStart));
        onProgress(
          `10D 융합 생성 중... ${end.toLocaleString()}/${nRows.toLocaleString()}건 (${pct}%)`,
          pct
        );
      }

      // ── 메인 스레드 양보 ─────────────────────────────────────────────────────
      await tf.nextFrame();
    }

    // ── 진단 로그 (스프레드/flatMap 미사용 — 안전한 루프 방식) ─────────────
    if (diagnoseLog) {
      console.group('[10D Feature Fusion 진단] 상위 5개 샘플 (Float32Array)');
      const sampleCount = Math.min(5, nRows);
      for (let s = 0; s < sampleCount; s++) {
        const base = s * 10;
        const rawPart = Array.from(flatData.subarray(base,     base + 5)).map(v => v.toFixed(4));
        const errPart = Array.from(flatData.subarray(base + 5, base + 10)).map(v => v.toFixed(5));
        let eMin = Infinity, eMax = -Infinity;
        for (let j = base + 5; j < base + 10; j++) {
          if (flatData[j] < eMin) eMin = flatData[j];
          if (flatData[j] > eMax) eMax = flatData[j];
        }
        console.log(`  Sample ${s}: raw=[${rawPart}] | error=[${errPart}] | err_range=[${eMin.toFixed(5)}, ${eMax.toFixed(5)}]`);
      }
      // 전체 오차 통계 (루프 기반, Math.max 스프레드 미사용)
      let errSum = 0, errMax = 0;
      const errCount = nRows * 5;
      for (let i = 0; i < nRows; i++) {
        for (let j = 5; j < 10; j++) {
          const v = flatData[i * 10 + j];
          errSum += v;
          if (v > errMax) errMax = v;
        }
      }
      const errMean = errSum / errCount;
      console.log(`  전체 복원오차 평균: ${errMean.toFixed(5)}, 최대: ${errMax.toFixed(5)}`);
      console.log(errMax < 0.001
        ? '  ⚠️ 경고: AE 복원오차가 0 근처! 임계치/스케일러 확인 필요.'
        : '  ✅ 복원오차 다양성 정상 (AE 피처 융합 유효).');
      console.groupEnd();
    }

    return { flatData, nRows };
  }

  /**
   * @deprecated 동기 버전 (하위 호환 유지 - 실시간 추론 내부에서만 사용)
   */
  batchGenerate10DFeatures(rows, diagnoseLog = false) {
    const raw5DList = this.extract5DFeatures(rows);
    const scaled5DList = this.scaler5D.transform(raw5DList);
    return tf.tidy(() => {
      const inputTensor = tf.tensor2d(scaled5DList);
      const reconTensor = this.autoencoder.predict(inputTensor);
      const reconArray = reconTensor.arraySync();
      const fusedMatrix = [];
      for (let i = 0; i < scaled5DList.length; i++) {
        const row = scaled5DList[i];
        const recon = reconArray[i];
        const fused = new Float32Array(10);
        for (let j = 0; j < 5; j++) {
          fused[j] = row[j];
          fused[j + 5] = Math.abs(row[j] - recon[j]);
        }
        fusedMatrix.push(Array.from(fused));
      }
      return fusedMatrix;
    });
  }

  /**
   * 2단계 다중 분류기 학습 (10D 특징 행렬 80,000건, 검증 20,000건)
   * ─ 청크 비동기 융합 (2,500건/청크 × tf.tidy + tf.nextFrame)
   * ─ Class Weights 부여 (정상 0.31 vs 고장 3.75)
   * ─ StandardScaler 10차원 전체 정합 정규화
   * ─ Batch Size 512, Early Stopping (patience=6), ReduceLROnPlateau
   */
  async trainClassifier(trainRows, valRows, callbacks = {}) {
    if (!this.isAutoencoderTrained) {
      throw new Error('1단계 오토인코더를 먼저 학습해야 합니다.');
    }

    let currentLr = 0.003;
    this.buildClassifierModel(currentLr);

    // ── [1단계] 10D 피처 융합 - 청크 비동기 처리 ─────────────────────────────
    const progressCb = (msg, pct) => {
      if (callbacks.onProgress) callbacks.onProgress(msg, pct);
    };

    progressCb('10D 특징 융합 생성 시작 (학습 8만건, 청크 2,500건 단위)...', 5);

    const rawXTrain10D = await this.batchGenerate10DFeaturesAsync(trainRows, {
      diagnoseLog: true,
      chunkSize: 2500,
      progressStart: 5,
      progressEnd: 40,
      onProgress: progressCb
    });

    progressCb('10D 특징 융합 생성 시작 (검증 2만건)...', 42);

    const rawXVal10D = await this.batchGenerate10DFeaturesAsync(valRows, {
      diagnoseLog: false,
      chunkSize: 2500,
      progressStart: 42,
      progressEnd: 60,
      onProgress: progressCb
    });

    // ── [2단계] StandardScaler 표준화 (flatFlat 방식 — 스택 안전) ───────────
    progressCb('10D 피처 전체 StandardScaler 정합 표준화 중...', 62);
    await tf.nextFrame();

    // fitFlat / transformFlat: Float32Array 직접 연산 (중첩 배열/스프레드 없음)
    this.scaler10D.fitFlat(rawXTrain10D.flatData, 10);
    const xTrainFlat = this.scaler10D.transformFlat(rawXTrain10D.flatData, 10); // Float32Array
    const xValFlat   = this.scaler10D.transformFlat(rawXVal10D.flatData,   10); // Float32Array

    await tf.nextFrame();

    // ── [3단계] One-hot 레이블 — Float32Array (중첩 배열 없음) ────────────────
    const nTrain = rawXTrain10D.nRows;
    const nVal   = rawXVal10D.nRows;
    const yTrainFlat = new Float32Array(nTrain * 4);
    for (let i = 0; i < nTrain; i++) yTrainFlat[i * 4 + trainRows[i].label_class] = 1;
    const yValFlat   = new Float32Array(nVal   * 4);
    for (let i = 0; i < nVal;   i++) yValFlat[i   * 4 + valRows[i].label_class]   = 1;

    // ── [4단계] Class Weights 계산 ────────────────────────────────────────────
    const classCounts = [0, 0, 0, 0];
    trainRows.forEach(r => classCounts[r.label_class]++);
    const classWeights = {};
    for (let c = 0; c < 4; c++) {
      classWeights[c] = nTrain / (4 * Math.max(1, classCounts[c]));
    }
    console.log('[Classifier] Class Weights:', classWeights);

    // ── [5단계] 텐서 생성 — tf.tensor(TypedArray, shape) (스택 안전) ─────────
    // ⚠️ tf.tensor2d(nestedArray) 대신 tf.tensor(Float32Array, shape) 사용
    //    → TF.js 내부 재귀 flatten 호출 없음 → 콜스택 오버플로 방지
    progressCb('분류기 학습 텐서 변환 중...', 65);
    await tf.nextFrame();

    const xTrainTensor = tf.tensor(xTrainFlat, [nTrain, 10]);
    const yTrainTensor = tf.tensor(yTrainFlat, [nTrain,  4]);
    const xValTensor   = tf.tensor(xValFlat,   [nVal,   10]);
    const yValTensor   = tf.tensor(yValFlat,   [nVal,    4]);

    // ── [6단계] 에포크 학습 루프 ──────────────────────────────────────────────
    const epochs    = 40;
    const batchSize = 512;
    const patience  = 6;
    let bestValLoss  = Infinity;
    let patienceCount = 0;
    let lrPlateauCount = 0;

    console.log(
      `[Classifier] 학습 시작 — Epochs: ${epochs}, BatchSize: ${batchSize}, ` +
      `LR: ${currentLr}, patience: ${patience}`
    );

    let lastValAcc = 0;
    let lastValLoss = 0;
    let lastEpoch = 0;
    let isEarlyStopped = false;

    for (let epoch = 1; epoch <= epochs; epoch++) {
      const history = await this.classifier.fit(xTrainTensor, yTrainTensor, {
        epochs: 1,
        batchSize,
        validationData: [xValTensor, yValTensor],
        classWeight: classWeights,
        shuffle: true,
        verbose: 0
      });

      const trainAcc = history.history.acc?.[0] ?? history.history.accuracy[0];
      const valAcc   = history.history.val_acc?.[0] ?? history.history.val_accuracy[0];
      const valLoss  = history.history.val_loss[0];

      lastValAcc  = valAcc;
      lastValLoss = valLoss;
      lastEpoch   = epoch;

      // 에포크 기반 진행률: 65% ~ 98% 구간
      const epochPct = Math.round(65 + (epoch / epochs) * 33);
      progressCb(
        `Epoch ${epoch}/${epochs} — Val Acc: ${(valAcc * 100).toFixed(2)}%, Val Loss: ${valLoss.toFixed(4)}, LR: ${currentLr.toFixed(5)}`,
        epochPct
      );

      if (callbacks.onEpochEnd) {
        callbacks.onEpochEnd(epoch, epochs, trainAcc, valAcc, valLoss, currentLr);
      }

      await tf.nextFrame();

      // ── EarlyStopping & ReduceLROnPlateau ─────────────────────────────────
      if (valLoss < bestValLoss) {
        bestValLoss    = valLoss;
        patienceCount  = 0;
        lrPlateauCount = 0;
      } else {
        patienceCount++;
        lrPlateauCount++;

        if (lrPlateauCount >= 2 && currentLr > 0.0003) {
          currentLr *= 0.5;
          if (typeof this.classifier.optimizer.setLearningRate === 'function') {
            this.classifier.optimizer.setLearningRate(currentLr);
          } else {
            this.classifier.optimizer.learningRate = currentLr;
          }
          lrPlateauCount = 0;
          console.log(`[Classifier] ReduceLROnPlateau → LR: ${currentLr.toFixed(6)}`);
        }

        if (patienceCount >= patience) {
          isEarlyStopped = true;
          console.log(`[Classifier] Early Stopping at Epoch ${epoch} — Best Val Loss: ${bestValLoss.toFixed(4)}`);
          if (callbacks.onEarlyStop) callbacks.onEarlyStop(epoch, bestValLoss);
          break;
        }
      }
    }

    // ── 텐서 명시적 해제 ──────────────────────────────────────────────────────
    xTrainTensor.dispose();
    yTrainTensor.dispose();
    xValTensor.dispose();
    yValTensor.dispose();

    const summaryMsg = `✅ 2단계 분류기 학습 완료 (Epoch ${lastEpoch}/${epochs}${isEarlyStopped ? ' 조기종료' : ''}) | Val Acc: ${(lastValAcc * 100).toFixed(2)}% | Best Loss: ${bestValLoss.toFixed(4)}`;
    progressCb(summaryMsg, 100);
    this.isClassifierTrained = true;
    return {
      success: true,
      bestValLoss,
      lastValAcc,
      lastValLoss,
      finalEpoch: lastEpoch,
      totalEpochs: epochs,
      isEarlyStopped
    };
  }

  /**
   * 실시간 단일 데이터 추론 파이프라인
   * 1단계: AE 복원 오차 계산
   *   - mse <= threshold: 정상 판정 및 추론 조기 종료
   *   - mse > threshold: 2단계 10D 분류기 기동 및 클래스별 확률 산출
   */
  inferSingleSample(raw5DPoint) {
    if (!this.isAutoencoderTrained) {
      throw new Error('모델이 훈련되지 않았습니다.');
    }

    const { fusedVector, reconstructedRaw, mse } = this.generate10DFeatureVector(raw5DPoint);
    const isAnomaly = mse > this.threshold;

    let probabilities = {
      class_0_normal: 1.0,
      class_1_dry_pump: 0.0,
      class_2_booster1: 0.0,
      class_3_booster2: 0.0
    };
    let predictedClass = 0;

    if (this.isClassifierTrained) {
      const probaArray = tf.tidy(() => {
        const inputTensor = tf.tensor2d([fusedVector]);
        const probaTensor = this.classifier.predict(inputTensor);
        return Array.from(probaTensor.dataSync());
      });

      probabilities = {
        class_0_normal: probaArray[0],
        class_1_dry_pump: probaArray[1],
        class_2_booster1: probaArray[2],
        class_3_booster2: probaArray[3]
      };

      // 1단계 오차가 임계치 이하(정상)라면 정상 클래스로 빠른 연산 종결
      if (!isAnomaly) {
        predictedClass = 0;
      } else {
        // 이상 발생 시 최대 확률 클래스 판정 (Class 1, 2, 3 우선)
        let maxP = -1;
        let maxC = 0;
        for (let c = 0; c < 4; c++) {
          if (probaArray[c] > maxP) {
            maxP = probaArray[c];
            maxC = c;
          }
        }
        if (maxC === 0) {
          const faultProbas = [
            { c: 1, p: probaArray[1] },
            { c: 2, p: probaArray[2] },
            { c: 3, p: probaArray[3] }
          ];
          faultProbas.sort((a, b) => b.p - a.p);
          predictedClass = faultProbas[0].c;
        } else {
          predictedClass = maxC;
        }
      }
    } else {
      predictedClass = isAnomaly ? 1 : 0;
    }

    return {
      raw5D: raw5DPoint,
      reconstructed5D: reconstructedRaw,
      mse: mse,
      threshold: this.threshold,
      isAnomaly: isAnomaly,
      fused10D: fusedVector,
      probabilities: probabilities,
      predictedClass: predictedClass
    };
  }
}

// 전역 싱글톤 인스턴스 생성
window.aiEngine = new AIEngine();
