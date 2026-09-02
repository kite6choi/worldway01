# 2단계 하이브리드 예지보전 AI 웹 앱 PWA 개발 설계서 (plan-v3.md)

본 설계서는 **`spec-v4.md`**에 명문화된 요구사항을 충족하고, 브라우저 단독(Client-side) 환경에서 **150,000건**의 대용량 제조 시계열 데이터를 안정적으로 처리하며, 하이브리드 AI 알고리즘의 실시간 추론 및 TDD 기반 성능 검증을 가능하게 하는 기술적 표준 설계서(Single Source of Truth)입니다.

---

## 1. 시스템 아키텍처 및 기술 스택 (System Architecture)

본 시스템은 기밀 데이터의 공장 외부 유출을 차단하기 위해 백엔드 서버가 없는 **100% 클라이언트 사이드 단독 연산 구조(Serverless Static SPA)**로 설계되었습니다. 대용량 데이터 전처리 및 모델 학습 시 발생하는 UI 스레드 차단 현상을 방지하고 고해상도 시각화를 60fps로 보장하기 위해 멀티스레딩 아키텍처를 도입합니다.

### 1.1 아키텍처 블록도 (Data & Execution Flow)

```
[원시 CSV 파일 입력] (드래그 앤 드롭)
   ├─ 챔버1_정상_12만건.csv (Class 0)
   └─ 챔버1_고장전1주일데이터_3만건.csv (Class 1, 2, 3)
                │
                ▼ (Web Worker: PapaParse Stream Parsing)
[데이터 전처리 및 층화 3분할 파이프라인]
   ├─ 1) 선형 보간 (결측치 제거)
   ├─ 2) 운전 영역 필터링 (진공도 > 10 Torr 비가동 영역 차단)
   └─ 3) Stratified 3-Split 할당 [8만 : 2만 : 5만] (Train / Val / Test)
                │
                ▼ (Dexie.js Bulk Add)
┌────────────────────────────────────────────────────────┐
│               IndexedDB Local Storage                  │
│  - train_set (80,000행)   - val_set (20,000행)         │
│  - test_set (50,000행) (시뮬레이션 플레이백용)        │
└────────────────────────────────────────────────────────┘
                │
                ├────────────────────────┐
                ▼ (정상 64,000행 로드)   ▼ (정상 16,000행 로드)
    ┌────────────────────────┐  ┌────────────────────────┐
    │ 1단계: TensorFlow.js   │  │  학습 조기 종료 평가   │
    │  Autoencoder 모델 학습 │◀─┤ (Validation Loss 감시) │
    └────────────────────────┘  └────────────────────────┘
                │
                ▼
    [Val 정상 오차 분포 백분위계산] ──▶ 이상 판단 임계치 (T_h) 결정 & 고정
                │
                ▼
    [학습 세트 전체 8만행 AE 통과] ──▶ 5차원 복원 오차 벡터 산출 (|x - x̂|)
                │
                ▼ (수평 병합: Feature Fusion)
    [10차원 융합 학습 피처 행렬 구축] (원시 5종 + 복원오차 5종)
                │
                ▼ (XGBoost / Random Forest JS 학습 및 검증)
    ┌────────────────────────────────────────────────────┐
    │          2단계: 다중 분류 고장 진단기 학습          │
    │  - Class 0(정상), 1(드라이펌프), 2(부스1), 3(부스2) │
    └────────────────────────────────────────────────────┘
                │
                ▼
[실시간 1초 주기 시뮬레이터 재생] (시험 데이터 5만행 기반 루프)
   ├─ Math.random() < 0.10 조건 발생 시 무작위 고장 벡터 인젝션
   ├─ 1단계 AE 실시간 복원 오차 연산 및 T_h 대조 (이상 탐지)
   │     ├─ 오차 <= T_h : 정상 판정 및 추론 조기 종료 (1단계 완료)
   │     └─ 오차 > T_h  : XGBoost 기동 및 10D 특징 융합 추론 (2단계 기동)
   │                        └─ 클래스별 실시간 고장 확률(%) 도출
   │
   ▼ (실시간 반응형 퍼블리싱 및 TDD 수집)
┌────────────────────────────────────────────────────────────────────────┐
│                     Tailwind CSS + DaisyUI UI 대시보드                  │
│  - 실시간 스크롤 차트 (uPlot/Chart.js 캔버스 렌더링, FIFO 버퍼 제어)  │
│  - 3색 경보 알람 (Green: 정상, Yellow: 주의, Red: 사이렌 & 정비가이드) │
│  - TDD 실증 판넬 (4x4 Confusion Matrix 및 실시간 F1-Score 갱신)        │
│  - F1-Score >= 0.80 달성 시 골드 품질 인증 스탬프 활성화                │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.2 상세 기술 스택 명세 (Technology Stack)

| 구분 | 선정 스택 | 핵심 이유 | CDN 및 임포트 규격 |
| :--- | :--- | :--- | :--- |
| **코어 인프라** | Vanilla JS (ES6+) | 프레임워크 오버헤드 배제, 순수 추론 속도 극대화 | 브라우저 네이티브 ES 모듈 활용 |
| **스타일링** | Tailwind CSS v3 | 유틸리티 퍼스트를 통한 초경량 다크 모드 구현 가능 | `<script src="https://cdn.tailwindcss.com"></script>` |
| **UI 컴포넌트** | DaisyUI v4 | HTML 마크업만으로 세련된 대시보드 요소 즉시 가동 | `<link href="https://cdn.jsdelivr.net/npm/daisyui@4.4.19/dist/full.css" rel="stylesheet" />` |
| **로컬 DB** | Dexie.js v3 | 비동기 트랜잭션 및 대용량 멀티 인덱싱 최적화 래퍼 | `<script src="https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js"></script>` |
| **DL 엔진** | TensorFlow.js v4 | WebGL 가속 기반 오토인코더 브라우저 고속 훈련/추론 | `<script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.15.0/dist/tf.min.js"></script>` |
| **ML 엔진** | ml-random-forest | JSON 가중치 포팅을 통해 브라우저 단독 다중 클래스 확률 추론 | `<script src="https://cdn.jsdelivr.net/npm/ml-random-forest@2.1.0/dist/ml-random-forest.min.js"></script>` |
| **시각화** | uPlot.js v1 | Canvas 기반 극단적 경량화(30KB), 초당 60fps 차트 갱신 | `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.min.css"><script src="https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.iife.min.js"></script>` |
| **CSV 파서** | PapaParse v5 | 스트림(chunk) 파싱 지원으로 브라우저 멈춤 방지 | `<script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>` |

### 1.3 PWA 및 배포 오프라인 기동 전략

*   **배포 환경**: Netlify CDN 배포. 빌드 설정이 필요 없는 순수 정적 파일 디렉토리 배포 적용.
*   **파일 배치 구조 (Flattened Directory Structure)**:
    ```
    /dist/
    ├── index.html          # 단일 페이지 메인 UI 및 웹 앱 뼈대
    ├── app.js              # 데이터 파싱, DB 적재, 실시간 시뮬레이터 및 UI 바인딩 코어
    ├── sw.js               # 오프라인 가용성을 위한 서비스 워커 스크립트
    ├── manifest.json       # PWA 설치 명세 및 모바일 메타데이터
    └── icons/
        ├── icon-192.png    # PWA용 홈 화면 아이콘 (192x192)
        └── icon-512.png    # PWA용 실행 화면 아이콘 (512x512)
    ```
*   **PWA Cache Storage Policy**:
    `sw.js` 구동 시 CDN 리소스 및 핵심 코드를 하드 캐싱하여 기계실 등의 무선 네트워크 단절 상태(Offline)에서도 추론과 차트가 가동되도록 보장합니다.

---

## 2. 데이터베이스 및 스토리지 설계 (Database & Schema Design)

브라우저의 쿠키나 LocalStorage는 저장 용량이 5MB~10MB로 심하게 한계가 있어 본 사업의 실측 데이터인 150,000건(약 30MB)을 담는 것이 불가능합니다. 따라서 기기 용량의 최대 50%까지 동적 할당을 받을 수 있는 브라우저 내장 데이터베이스인 **IndexedDB**를 채택합니다.

### 2.1 Dexie.js 기반 스키마 초기화

```javascript
// Dexie 데이터베이스 정의
const db = new Dexie('WorldwayPredictiveDB');

// 복잡한 쿼리 및 인덱싱 요구사항을 반영하여 split_type과 label_class를 복합 인덱스로 정의
db.version(1).stores({
  measurements: '++id, split_type, label_class, [split_type+label_class]'
});

// 데이터 유효성 검증을 위한 상태 딕셔너리 정의
const CLASS_MAP = {
  NORMAL: 0,
  DRY_PUMP_FAIL: 1,
  BOOSTER1_FAIL: 2,
  BOOSTER2_FAIL: 3
};
```

### 2.2 테이블 세부 스펙

IndexedDB는 스키마리스(Schema-less) 구조이나, 객체의 정합성과 자료형 안정을 위해 아래의 단일 `measurements` 테이블 구조로 통합 수용하여 조회 성능을 고도화합니다.

*   `id`: (Integer, Auto-increment, Primary Key)
*   `timestamp`: (String) 실측 시간 포맷 ("YYYY-MM-DD HH:MM:SS")
*   `dry_pump`: (Float) 드라이펌프 동작 부하 전류 (A)
*   `booster1`: (Float) 부스터1 펌프 동작 부하 전류 (A)
*   `booster2`: (Float) 부스터2 펌프 동작 부하 전류 (A)
*   `temp`: (Float) 열매체 공급 라인 입구 온도 (℃)
*   `vacuum`: (Float) 진공 챔버 내부 잔류 압력 (Torr)
*   `label_class`: (Integer) 상태 클래스 라벨 (`0: 정상, 1: 드라이펌프고장, 2: 부스터1고장, 3: 부스터2고장`)
*   `split_type`: (String) 데이터 층화 분할 마커 (`'train'`, `'val'`, `'test'`)

### 2.3 데이터 수집 및 층화 할당 파이프라인 알고리즘

사용자가 정상 시계열 파일인 `챔버1_정상_12만건.csv`와 `챔버1_고장전1주일데이터_3만건.csv`를 업로드하면, 웹 워커(Web Worker) 내부에서 두 데이터를 스트림 병합 정제한 뒤 IndexedDB에 고속으로 벌크 인서트하는 알고리즘 의사코드(Pseudocode)입니다.

```javascript
async function processAndIngestData(normalFile, faultFile) {
  // 1. PapaParse를 활용하여 메모리 효율적으로 데이터 스트림 로드
  const normalRows = await parseCsvStream(normalFile); // 120,000건 추출
  const faultRows = await parseCsvStream(faultFile);   // 30,000건 추출

  // 2. 가동/비가동 전처리 필터링 및 결측치 선형 보간 로직 적용
  const cleanNormal = preprocessRows(normalRows, CLASS_MAP.NORMAL);
  const cleanFault = preprocessFaultRows(faultRows); // 내부 파일 상태 분석 후 클래스 1, 2, 3 분배

  // 3. 층화 3분할(Stratified Train-Val-Test Split) 비율 배정 및 태깅
  // 비율: Train 53.3% (80k), Val 13.3% (20k), Test 33.3% (50k)
  const finalIngestData = [];

  // Class 0 (정상): Train 64,000, Val 16,000, Test 40,000 분할
  tagSplitType(cleanNormal, finalIngestData, 64000, 16000, 40000);

  // Class 1, 2, 3 (고장 3종): 각 고장별 Train 5,333, Val 1,333, Test 3,334 분할
  for (let c = 1; c <= 3; c++) {
    const subset = cleanFault.filter(row => row.label_class === c);
    tagSplitType(subset, finalIngestData, 5333, 1333, 3334);
  }

  // 4. Dexie.js bulkAdd를 통한 트랜잭션 속도 극대화
  await db.transaction('rw', db.measurements, async () => {
    await db.measurements.clear();
    // 5,000개 로우 단위의 벌크 청크 분할 삽입으로 브라우저 메모리 정체 해소
    const chunkSize = 5000;
    for (let i = 0; i < finalIngestData.length; i += chunkSize) {
      const chunk = finalIngestData.slice(i, i + chunkSize);
      await db.measurements.bulkAdd(chunk);
    }
  });
}
```

---

## 3. 하이브리드 AI 모델 및 연산 상세 설계 (AI Model Design)

### 3.1 1단계: TensorFlow.js 오토인코더 설계 (Autoencoder)

오토인코더는 입력 피처의 중요 특징을 은닉 차원으로 축소 후 원본 상태로 복원하는 과정에서 발생하는 에러를 활용하여 비지도 학습 기반 이상 탐지를 제어합니다.

*   **네트워크 구조 레이어 설계**:
    $$f_{\text{encoder}}(x) = \sigma(W_e \cdot x + b_e), \quad f_{\text{decoder}}(z) = W_d \cdot z + b_d$$

```javascript
function buildAutoencoderModel() {
  const model = tf.sequential();

  // 입력 레이어 및 은닉 인코더 레이어 (5차원 ➡ 3차원 축소, 활성화함수: ReLU)
  model.add(tf.layers.dense({
    units: 3,
    activation: 'relu',
    inputShape: [5],
    name: 'encoder_hidden'
  }));

  // 저차원 병목 Latent 레이어 (3차원 ➡ 2차원 축소, 활성화함수: ReLU)
  model.add(tf.layers.dense({
    units: 2,
    activation: 'relu',
    name: 'latent_space'
  }));

  // 디코더 레이어 1 (2차원 ➡ 3차원 복원, 활성화함수: ReLU)
  model.add(tf.layers.dense({
    units: 3,
    activation: 'relu',
    name: 'decoder_hidden'
  }));

  // 최종 복원 출력 레이어 (3차원 ➡ 5차원 복원, 활성화함수: Linear)
  model.add(tf.layers.dense({
    units: 5,
    activation: 'linear',
    name: 'decoder_output'
  }));

  model.compile({
    optimizer: tf.train.adam(0.005),
    loss: 'meanSquaredError'
  });

  return model;
}
```

*   **학습 스케줄러 및 조기 종료 (Early Stopping)**:
    정상 훈련 데이터 `64,000`건으로 가중치를 업데이트하되, 에포크마다 정상 검증 데이터 `16,000`건에 대한 오차 손실값을 계산하여 `patience: 3` 조건 만족 시 학습을 즉시 차단합니다.

### 3.2 조기 종료 및 복원 임계값 ($T_h$) 산출 통계 공식

오토인코더 신경망 가중치 훈련이 종료되면, 격리되었던 검증(Validation) 정상 데이터 16,000건 전체의 재구성 평균 제곱 오차(MSE)의 통계적 밀도를 파악하여 상위 99% 백분위값(99th Percentile)을 정상 작동 바운더리의 임계 한계선인 $T_h$로 지정합니다.

*   **재구성 제곱 오차 공식 (MSE)**:
    $$\text{MSE}_i = \frac{1}{5} \sum_{j=1}^{5} \left( x_{i,j} - \hat{x}_{i,j} \right)^2$$
*   **임계값 계산 자바스크립트 수치 계산 유틸리티**:

```javascript
function calculateThreshold(valNormalFeatures, trainedModel) {
  return tf.tidy(() => {
    const inputs = tf.tensor2d(valNormalFeatures);
    const outputs = trainedModel.predict(inputs);
    
    // 개별 샘플별 MSE 오차 벡터 계산
    const mseTensor = tf.sub(inputs, outputs).square().mean(1);
    const mseArray = Array.from(mseTensor.dataSync());
    
    // 오차값 정렬 후 상위 99% (Percentile 99) 단정 수치 계산
    mseArray.sort((a, b) => a - b);
    const index99 = Math.floor(mseArray.length * 0.99);
    
    return mseArray[index99]; // 이상 탐지 임계치 T_h 반환
  });
}
```

### 3.3 10차원 특징 융합 (Feature Fusion) 수식 및 파이프라인

정상 범위를 벗어나는 재구성 오차 변칙 상황이 발생했을 때, 다중 분류 예측 확률의 한계를 돌파하기 위해 원시 센서 데이터 5종에 각 센서별 복원 오차 절대값(Residuals) 5종을 가로로 결합(Concatenate)하여 10차원 벡터를 실시간 연산합니다.

*   **특징 융합 수학적 공식**:
    $$X_{\text{fusion}} = \left[ x_1, x_2, x_3, x_4, x_5, |x_1 - \hat{x}_1|, |x_2 - \hat{x}_2|, |x_3 - \hat{x}_3|, |x_4 - \hat{x}_4|, |x_5 - \hat{x}_5| \right]$$

```javascript
function generate10DFeatureVector(rawVector, reconstructedVector) {
  const fused = new Float32Array(10);
  // 원시 센서값 5종 이식
  for (let i = 0; i < 5; i++) {
    fused[i] = rawVector[i];
  }
  // 각 센서별 물리적 복원 오차(절대 에러값) 5종 병합
  for (let i = 0; i < 5; i++) {
    fused[i + 5] = Math.abs(rawVector[i] - reconstructedVector[i]);
  }
  return fused; // 10차원 융합 입력 변수 반환
}
```

### 3.4 2단계: 다중 분류기 클래스 확률 분배 연산

10차원 융합 특징 행렬을 통해 훈련이 완료된 의사결정 나무 앙상블(Random Forest) 모델은 실시간 입력된 이상 데이터에 대하여 단정적 판단 대신 소수점 확률 분포를 분배하여 리턴합니다.

*   **다중 분류 확률 추론 함수**:
    $$\text{predict\_proba}(X_{\text{fusion}}) \rightarrow \left[ P(\text{Normal}), P(\text{Dry\_Pump}), P(\text{Booster1}), P(\text{Booster2}) \right], \quad \sum_{c=0}^{3} P(c) = 1.0$$

```javascript
function inferenceClassifier(fused10DVector, trainedForestModel) {
  // ml-random-forest 추론 라이브러리 인터페이스 매핑
  const predictionProbabilities = trainedForestModel.predictMultipleClassesProbabilities([fused10DVector]);
  
  // 리턴 구조 표준화
  return {
    class_0_normal: predictionProbabilities[0][0],      // 정상 범위 이탈 확률
    class_1_dry_pump: predictionProbabilities[0][1],    // 드라이펌프 열화 고장률
    class_2_booster1: predictionProbabilities[0][2],    // 부스터1 펌프 열화 고장률
    class_3_booster2: predictionProbabilities[0][3]     // 부스터2 펌프 열화 고장률
  };
}
```

---

## 4. UI/UX 화면 Layout 및 대시보드 인터랙션 설계

### 4.1 대시보드 그리드 배치도 (12-Column Responsive Grid)

산업용 대형 모니터 및 현장 스마트 단말기(태블릿)의 반응형 디스플레이 요건을 확보하기 위해, 화면 레이아웃은 **Tailwind Grid (`grid-cols-12`)** 기반의 풀 다크 테마 대시보드로 격자화합니다.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  월드웨이 동결건조기 스마트 예지보전 대시보드 (Chamber 1)                                                     [PWA 설치]  │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [그리드 영역 A: col-span-4] 데이터 셋업 센터              │ [그리드 영역 B: col-span-8] AI 훈련 프로세스 컨트롤 부           │
│  - 챔버 셀렉터: [Chamber 1 ▼]                             │  - 오토인코더 학습 모니터 (Epoch: 00/30 | MSE Loss: 0.0031)     │
│  - 드래그 앤 드롭 파일 로더                               │  - 조기 종료 상태 및 임계치 설정 (현재 T_h: 0.0524)                    │
│    [정상 데이터 12만건 드롭 존]                           │    [■ 99% Percentile]  [□ 3-Sigma]                             │
│    [고장 데이터 3만건 드롭 존]                            │  - 모델 제어 단추:                                                     │
│  - [ 데이터셋 IndexedDB 파싱 및 분할 적재 실행 ]          │    [▶ 오토인코더 학습 시작]    [▶ XGBoost 분류기 학습 시작]     │
├───────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────┤
│ [그리드 영역 C: col-span-12] 실시간 예지보전 시뮬레이션 콘솔                                                            │
│  - 제어 바: [ ▶ 시뮬레이션 가동 ]  [ ⏸ 일시정지 ]  [ 재생배속: x1 / x5 / x10 ]                                         │
│  - 시뮬레이션 고장 강제 주입(Fault Injection) 설정: [ ◉ ON (10% 확률 주입) ]  [ ◯ OFF ]                                 │
│                                                                                                                        │
│  ┌────────────────────────────────────────────────────────┐┌─────────────────────────────────────────────────────────┐ │
│  │ 4.1. 센서 트렌드 실시간 시계열 그래프 (uPlot 60fps)      ││ 4.2. 실시간 AE 복원 오차 모니터링 그래프 (uPlot)         │ │
│  │  - 드라이펌프 / 부스터 1 / 부스터 2 전류                ││  - 실시간 입력 오차값 (MSE)                             │ │
│  │  - 챔버 진공도 (Torr) / 열매In온도 (℃)                 ││  - 이상 판단 임계치 (T_h 실선)  *침범 시 적색 강조      │ │
│  └────────────────────────────────────────────────────────┘└─────────────────────────────────────────────────────────┘ │
│                                                                                                                        │
│  ┌────────────────────────────────────────────────────────┐┌─────────────────────────────────────────────────────────┐ │
│  │ 4.3. 실시간 고장 원인별 진단 예측 확률 분포 (%)        ││ 4.4. 동적 3색 스마트 사이렌                             │ │
│  │  - Normal:        [██████████████████░░░] 85%          ││     ┌─────────────────────────────────────────────┐     │ │
│  │  - Dry Pump Fail: [█░░░░░░░░░░░░░░░░░░░░] 3%           ││     │            ● 녹색 (안정 가동)               │     │ │
│  │  - Booster 1 Fail: [██░░░░░░░░░░░░░░░░░░░] 10%          ││     │            ● 황색 (일시 이탈 주의)          │     │ │
│  │  - Booster 2 Fail: [░░░░░░░░░░░░░░░░░░░░░] 2%           ││     │            ● 적색 (부스터1 위험 사이렌)     │     │ │
│  └────────────────────────────────────────────────────────┘└─────────────────────────────────────────────┘     │ │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [그리드 영역 D: col-span-12] TDD 통합 정량 실증 평가 패널 (최종 시험 데이터 5만건 실증 매트릭스)                          │
│  - 종합 평가 상태: [ F1-Score: 0.8421 ]  [ Precision: 85.34% ]  [ Recall: 83.12% ]  [ 누적 평가 행 수: 14,213건 / 50,000건 ] │
│  - 품질 실증 검증: [★ 월드웨이 AI 공인 품질 규격 0.80 달성 완료 (Certified)]  *F1-Score 0.80 이상 시 골드 엠블럼 점등  │
│  - 4x4 Confusion Matrix 실시간 수치 데이터 표:                                                                         │
│    [ 실제 \ 예측 ] │   정상 (Class 0)   │ 드라이펌프 고장 (Class 1) │ 부스터1 고장 (Class 2) │ 부스터2 고장 (Class 3) │   합계   │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 3색 알람 신호등 상태 전이 매트릭스

오토인코더 복원 오차와 XGBoost 분류기에서 연속적으로 출력되는 고장 확률을 실시간 이벤트 가동기로 연계 감시하여 대시보드 테마와 정비 지시 가이드를 동적으로 제어합니다.

```javascript
function updateDashboardAlarmSystem(mseError, threshold, classifierProba) {
  const alarmCard = document.getElementById('alarm-siren-card');
  const alertText = document.getElementById('alarm-guide-text');

  // 상태 판단 조건 분기
  if (mseError <= threshold) {
    // 1단계: 정상 상태 (Green)
    alarmCard.className = "card bg-success text-success-content shadow-lg animate-pulse border-2 border-emerald-500 p-4";
    alertText.innerHTML = "<strong>✅ 안정 가동</strong>: 건조 챔버 내 기계 계통이 안정적이며 최적 진공 배치가 정상 순항 중입니다.";
  } else {
    // 임계값 초과 상태 돌출 시
    const maxFailureProb = Math.max(classifierProba.class_1_dry_pump, classifierProba.class_2_booster1, classifierProba.class_3_booster2);
    
    if (maxFailureProb < 0.70) {
      // 2단계: 주의 상태 (Yellow)
      alarmCard.className = "card bg-warning text-warning-content shadow-lg border-2 border-amber-500 p-4";
      alertText.innerHTML = `<strong>⚠️ 일시적 주의 (이상치 감지)</strong>: 챔버 미세 변동 및 노이즈 검지. 예측 고장 확률(${Math.round(maxFailureProb * 100)}%)이 위험 기준선(70%) 미만입니다. 센서 트렌드 모니터링을 지속하십시오.`;
    } else {
      // 3단계: 긴급 위험 경보 상태 (Red) - XGBoost 예측 고장 확률 70% 초과 확정 시
      let culpritComponent = "알 수 없는 이탈";
      let guideAction = "대기 제어 밸브 확인 필요.";
      
      if (classifierProba.class_1_dry_pump === maxFailureProb) {
        culpritComponent = "드라이펌프 기계적 이상";
        guideAction = "드라이펌프 역전 전류 차단 및 배기 임펠러 온도를 긴급 실측 점검하십시오.";
      } else if (classifierProba.class_2_booster1 === maxFailureProb) {
        culpritComponent = "부스터 1호기 인버터 전류 제어 차단";
        guideAction = "부스터1 모터 회전 속도 정비 점검을 조치하고 냉각 칠러 매체 공급량을 증가하십시오.";
      } else if (classifierProba.class_3_booster2 === maxFailureProb) {
        culpritComponent = "부스터 2호기 고부하 열화 이탈";
        guideAction = "부스터2 펌프 긴급 수동 배기 루프를 차단하고 건조 사이클 정지 후 바이패스 정비를 지시하십시오.";
      }

      alarmCard.className = "card bg-error text-error-content shadow-lg animate-bounce border-4 border-red-600 p-4";
      alarmSoundTrigger(); // 오프라인 무설정 웹 오디오 비프음 재생
      alertText.innerHTML = `<strong>🚨 긴급 위험 예지 (고장 확정)</strong>: ${culpritComponent} 상태(신뢰도 ${Math.round(maxFailureProb * 100)}%)가 예지되었습니다! 즉시 정비원 비상 배치 요망.<br><b>👉 조치가이드:</b> ${guideAction}`;
    }
  }
}
```

### 4.3 초당 60fps 시각화 및 FIFO 스크롤 링버퍼 제어

1초에 1건씩 실시간 차트가 전진할 때 브라우저 멈춤이나 프레임 드랍을 막기 위해 렌더링에 필요한 슬라이딩 윈도우 크기를 **최대 100포인트**로 제정하여 FIFO(First-In-First-Out) 슬라이싱 버퍼링을 수행합니다.

```javascript
const CHART_MAX_POINTS = 100;
const chartDataBuffer = {
  timestamps: [],
  dryPump: [],
  booster1: [],
  booster2: [],
  errors: []
};

function pushDataToChartBuffer(newDataPoint, currentError) {
  // 1. 신규 타임스탬프 및 센서 입력 수치 추가
  chartDataBuffer.timestamps.push(newDataPoint.timestamp);
  chartDataBuffer.dryPump.push(newDataPoint.dry_pump);
  chartDataBuffer.booster1.push(newDataPoint.booster1);
  chartDataBuffer.booster2.push(newDataPoint.booster2);
  chartDataBuffer.errors.push(currentError);

  // 2. FIFO 임계 길이 초과 시 맨 앞의 원격 데이터 슬라이싱 제거
  if (chartDataBuffer.timestamps.length > CHART_MAX_POINTS) {
    chartDataBuffer.timestamps.shift();
    chartDataBuffer.dryPump.shift();
    chartDataBuffer.booster1.shift();
    chartDataBuffer.booster2.shift();
    chartDataBuffer.errors.shift();
  }
}
```

---

## 5. 시뮬레이터 및 성능 검증(TDD) 연동 설계

### 5.1 1초 주기 데이터 스트리머 및 10% 돌발 고장 인젝터

실시간 대시보드 실증을 모사하기 위해 격리 저장해 둔 `test_set` (50,000건) 데이터를 매초 1행씩 플레이백하되, **10%의 고정 주입 확률(난수 < 0.10)**로 고장 실측 행을 난수로 매칭하여 실시간 추론기에 전달합니다.

```javascript
let simulationIntervalId = null;
let testPointerIndex = 1;

async function startSimulationStream() {
  if (simulationIntervalId) clearInterval(simulationIntervalId);
  
  // 1초 주기로 실행 루프 전개
  simulationIntervalId = setInterval(async () => {
    let targetRow = null;
    const injectFaultFlag = Math.random() < 0.10; // 10% 돌발 고장 인젝션

    if (injectFaultFlag) {
      // 1) 고장 주입 활성화 시, IndexedDB에서 고장 클래스(label_class: 1, 2, 3) 중 한 행을 무작위 샘플링
      const randomFaultClass = Math.floor(Math.random() * 3) + 1; // 1, 2, 3 클래스
      const faultSubset = await db.measurements
        .where('[split_type+label_class]')
        .equals(['test', randomFaultClass])
        .toArray();
      
      const randomIndex = Math.floor(Math.random() * faultSubset.length);
      targetRow = faultSubset[randomIndex];
    } else {
      // 2) 정상 주입 시, 격리된 시험용 정상 데이터셋에서 포인터 순차 추출
      const testNormalSet = await db.measurements
        .where('[split_type+label_class]')
        .equals(['test', 0])
        .offset(testPointerIndex)
        .limit(1)
        .toArray();
      
      targetRow = testNormalSet[0];
      testPointerIndex++;
    }

    if (targetRow) {
      // 실시간 추론 파이프라인 트리거
      await executeRealTimeInference(targetRow);
    }
  }, 1000);
}
```

### 5.2 실시간 Confusion Matrix 및 F1-Score 계량기 연산

시뮬레이터가 데이터를 주입할 때마다 누적 예측과 실제 정답 라벨($c \in \{0, 1, 2, 3\}$)을 비교 대조하여 4차원 다중 클래스 수치 대입 행렬을 동적으로 연산하여 실증 성능을 누적 산출합니다.

*   **실시간 다중 클래스 F1-Score 매크로 평균 통계 공식**:
    $$\text{Precision}_c = \frac{\text{TP}_c}{\text{TP}_c + \text{FP}_c}, \quad \text{Recall}_c = \frac{\text{TP}_c}{\text{TP}_c + \text{FN}_c}$$
    $$\text{F1}_c = 2 \times \frac{\text{Precision}_c \times \text{Recall}_c}{\text{Precision}_c + \text{Recall}_c}, \quad \text{Macro F1} = \frac{1}{4} \sum_{c=0}^{3} \text{F1}_c$$

```javascript
// 4x4 Confusion Matrix 누적 배열 정의 (실제 정답 행, 예측 열)
const confusionMatrix = [
  [0, 0, 0, 0], // 실제 Class 0에 대응하는 예측 [P0, P1, P2, P3] 수치
  [0, 0, 0, 0], // 실제 Class 1에 대응하는 예측 [P0, P1, P2, P3] 수치
  [0, 0, 0, 0], // 실제 Class 2에 대응하는 예측 [P0, P1, P2, P3] 수치
  [0, 0, 0, 0]  // 실제 Class 3에 대응하는 예측 [P0, P1, P2, P3] 수치
];

function updateMetricsAndDom(actualLabel, predictedLabel) {
  // 1. 혼동 행렬 상태 수치 즉시 반영 누적
  confusionMatrix[actualLabel][predictedLabel]++;

  // DOM 테이블 엘리먼트 가시적 갱신
  document.getElementById(`cell-${actualLabel}-${predictedLabel}`).innerText = confusionMatrix[actualLabel][predictedLabel];

  // 2. 클래스별 Precision, Recall, F1 계산 수행
  let sumF1 = 0;
  for (let c = 0; c < 4; c++) {
    let tp = confusionMatrix[c][c];
    
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < 4; i++) {
      if (i !== c) {
        fp += confusionMatrix[i][c]; // 열의 합산 - 예측오류
        fn += confusionMatrix[c][i]; // 행의 합산 - 미탐오류
      }
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    
    sumF1 += f1;
  }

  // 3. 매크로 F1-Score 도출
  const macroF1 = sumF1 / 4;
  
  // UI 갱신 바인딩
  const f1Display = document.getElementById('macro-f1-display');
  f1Display.innerText = macroF1.toFixed(4);

  // 4. 정부 과제 F1-Score 0.80 돌파 성공 조건 검사 및 배지 시동
  const certificationBadge = document.getElementById('quality-gold-badge');
  if (macroF1 >= 0.80) {
    certificationBadge.className = "flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500 text-amber-950 font-black animate-bounce shadow-xl";
    certificationBadge.innerHTML = "⭐ 월드웨이 예지보전 AI 규격 0.80 돌파 성공 (Certified)";
  } else {
    certificationBadge.className = "flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800 text-slate-500 font-bold border border-slate-700";
    certificationBadge.innerHTML = "🔒 최종 성능 검증 대기 중 (Target 0.80)";
  }
}
```

---

*본 `plan.md`는 Vanilla JS 및 TensorFlow.js 연동 정적 아키텍처에 대응하는 브라우저 가중치 분배 및 제어 성능을 완벽히 매핑하여 설계되었습니다. 본 문서를 통해 모든 프론트엔드 코드 및 TDD 개발을 정형적으로 실행할 수 있습니다.*
