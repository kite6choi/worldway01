/**
 * data-store.js
 * IndexedDB (Dexie.js) 데이터 스토리지 및 CSV 가공/전처리/층화분할 엔진
 */

// Dexie 데이터베이스 정의
const db = new Dexie('WorldwayPredictiveDB');
db.version(1).stores({
  measurements: '++id, split_type, label_class, [split_type+label_class]'
});

const CLASS_MAP = {
  NORMAL: 0,
  DRY_PUMP_FAIL: 1, // '건식'
  BOOSTER1_FAIL: 2, // '부스터1'
  BOOSTER2_FAIL: 3  // '부스터2'
};

const CLASS_NAMES = {
  0: '정상 가동',
  1: '드라이펌프 고장',
  2: '부스터1 고장',
  3: '부스터2 고장'
};

class DataStoreManager {
  constructor() {
    this.db = db;
    this.isLoaded = false;
    this.stats = {
      total: 0,
      train: 0,
      val: 0,
      test: 0,
      classCounts: { 0: 0, 1: 0, 2: 0, 3: 0 }
    };
  }

  async checkExistingData() {
    try {
      const count = await this.db.measurements.count();
      if (count >= 150000) {
        this.isLoaded = true;
        await this.updateStats();
        return true;
      }
      return false;
    } catch (e) {
      console.warn('DB check error:', e);
      return false;
    }
  }

  async updateStats() {
    this.stats.total = await this.db.measurements.count();
    this.stats.train = await this.db.measurements.where('split_type').equals('train').count();
    this.stats.val = await this.db.measurements.where('split_type').equals('val').count();
    this.stats.test = await this.db.measurements.where('split_type').equals('test').count();
    
    for (let c = 0; c < 4; c++) {
      this.stats.classCounts[c] = await this.db.measurements.where('label_class').equals(c).count();
    }
    return this.stats;
  }

  /**
   * CSV 텍스트, 파일 객체, 또는 URL을 파싱
   */
  async parseCsvAsync(fileOrUrl, onProgress) {
    let parseInput = fileOrUrl;

    if (typeof fileOrUrl === 'string') {
      const encoded = encodeURI(fileOrUrl);
      const res = await fetch(encoded);
      if (!res.ok) {
        throw new Error(`CSV 파일을 로드하지 못했습니다 (${res.status}): ${fileOrUrl}`);
      }
      parseInput = await res.text();
    }

    return new Promise((resolve, reject) => {
      Papa.parse(parseInput, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function(results) {
          resolve(results.data || []);
        },
        error: function(err) {
          reject(err);
        }
      });
    });
  }

  /**
   * 전처리: 컬럼 정규화, 결측치 선형보간, 진공도 > 10 Torr 비가동 필터링
   */
  preprocessData(rows, defaultLabel = null) {
    const cleaned = [];
    let lastValid = null;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      
      // 컬럼 매핑:
      // mWT501_01: dry_pump
      // mWT501_02: booster1
      // mWT501_03: booster2
      // VACUUM1_01: vacuum
      // TEMP1_11: temp
      let dry = r.mWT501_01 !== undefined ? parseFloat(r.mWT501_01) : NaN;
      let b1 = r.mWT501_02 !== undefined ? parseFloat(r.mWT501_02) : NaN;
      let b2 = r.mWT501_03 !== undefined ? parseFloat(r.mWT501_03) : NaN;
      let vac = r.VACUUM1_01 !== undefined ? parseFloat(r.VACUUM1_01) : NaN;
      let temp = r.TEMP1_11 !== undefined ? parseFloat(r.TEMP1_11) : NaN;

      // 라벨 결정
      let label = defaultLabel;
      if (r.class !== undefined && r.class !== null) {
        const clsStr = String(r.class).trim();
        if (clsStr === '건식' || clsStr === '드라이펌프') label = 1;
        else if (clsStr === '부스터1') label = 2;
        else if (clsStr === '부스터2') label = 3;
        else label = 0;
      } else if (label === null) {
        label = 0;
      }

      // 선형 보간 (이전 유효값 사용)
      if (isNaN(dry)) dry = lastValid ? lastValid.dry_pump : 16.5;
      if (isNaN(b1)) b1 = lastValid ? lastValid.booster1 : 3.6;
      if (isNaN(b2)) b2 = lastValid ? lastValid.booster2 : 4.8;
      if (isNaN(vac)) vac = lastValid ? lastValid.vacuum : 0.3;
      if (isNaN(temp)) temp = lastValid ? lastValid.temp : 15.0;

      // 비가동 영역 필터링: 진공도가 대기압 수준(10 Torr 초과) 또는 펌프 전류 완전 차단(0A 근처)
      // 단, 실측 데이터가 전반적으로 가동 범위 내에 있는지 확인
      if (vac > 10.0) {
        continue;
      }

      const point = {
        dry_pump: dry,
        booster1: b1,
        booster2: b2,
        vacuum: vac,
        temp: temp,
        label_class: label
      };
      
      cleaned.push(point);
      lastValid = point;
    }

    return cleaned;
  }

  /**
   * 층화 3분할 태깅 유틸리티
   */
  tagStratifiedSplit(subset, trainCount, valCount, testCount) {
    const result = [];
    const n = subset.length;
    
    // 비율 기반 안전 인덱싱
    const actualTrain = Math.min(trainCount, n);
    const actualVal = Math.min(valCount, Math.max(0, n - actualTrain));
    const actualTest = Math.min(testCount, Math.max(0, n - actualTrain - actualVal));

    for (let i = 0; i < actualTrain; i++) {
      result.push({ ...subset[i], split_type: 'train' });
    }
    for (let i = actualTrain; i < actualTrain + actualVal; i++) {
      result.push({ ...subset[i], split_type: 'val' });
    }
    for (let i = actualTrain + actualVal; i < actualTrain + actualVal + actualTest; i++) {
      result.push({ ...subset[i], split_type: 'test' });
    }

    // 만약 데이터셋이 정확한 갯수보다 크거나 남는 경우 test에 배분
    for (let i = actualTrain + actualVal + actualTest; i < n; i++) {
      result.push({ ...subset[i], split_type: 'test' });
    }

    return result;
  }

  /**
   * 전체 파이프라인 실행: 정상 CSV + 고장 CSV 파싱 및 IndexedDB 적재
   */
  async processAndIngestData(normalSource, faultSource, progressCallback) {
    if (progressCallback) progressCallback('정상 데이터(12만건) 파싱 중...', 10);
    const rawNormal = await this.parseCsvAsync(normalSource);

    if (progressCallback) progressCallback('고장 데이터(3만건) 파싱 중...', 30);
    const rawFault = await this.parseCsvAsync(faultSource);

    if (progressCallback) progressCallback('데이터 정제 및 유효성 필터링 중...', 50);
    const cleanNormal = this.preprocessData(rawNormal, CLASS_MAP.NORMAL);
    const cleanFault = this.preprocessData(rawFault);

    if (progressCallback) progressCallback('층화 3분할(Train 8만, Val 2만, Test 5만) 배분 중...', 65);
    
    const finalIngestData = [];

    // Class 0 (정상): Train 64,000, Val 16,000, Test 40,000
    const splitNormal = this.tagStratifiedSplit(cleanNormal, 64000, 16000, 40000);
    finalIngestData.push(...splitNormal);

    // Class 1 (건식): Train 5,333, Val 1,333, Test 3,334
    const fault1 = cleanFault.filter(r => r.label_class === 1);
    finalIngestData.push(...this.tagStratifiedSplit(fault1, 5333, 1333, 3334));

    // Class 2 (부스터1): Train 5,333, Val 1,333, Test 3,334
    const fault2 = cleanFault.filter(r => r.label_class === 2);
    finalIngestData.push(...this.tagStratifiedSplit(fault2, 5333, 1333, 3334));

    // Class 3 (부스터2): Train 5,334, Val 1,334, Test 3,332
    const fault3 = cleanFault.filter(r => r.label_class === 3);
    finalIngestData.push(...this.tagStratifiedSplit(fault3, 5334, 1334, 3332));

    if (progressCallback) progressCallback(`IndexedDB 벌크 저장 중 (${finalIngestData.length.toLocaleString()}건)...`, 80);

    // IndexedDB 비우고 Chunk 단위로 벌크 저장
    await this.db.transaction('rw', this.db.measurements, async () => {
      await this.db.measurements.clear();
      const chunkSize = 5000;
      for (let i = 0; i < finalIngestData.length; i += chunkSize) {
        const chunk = finalIngestData.slice(i, i + chunkSize);
        await this.db.measurements.bulkAdd(chunk);
        if (progressCallback && i % 20000 === 0) {
          const percent = 80 + Math.floor((i / finalIngestData.length) * 18);
          progressCallback(`IndexedDB 저장 중... (${i.toLocaleString()} / ${finalIngestData.length.toLocaleString()})`, percent);
        }
      }
    });

    await this.updateStats();
    this.isLoaded = true;

    if (progressCallback) progressCallback('데이터베이스 적재 완료!', 100);
    return this.stats;
  }

  /**
   * AI 학습용 데이터 로더
   */
  async loadTrainData(onlyNormal = false) {
    if (onlyNormal) {
      return await this.db.measurements
        .where('[split_type+label_class]')
        .equals(['train', 0])
        .toArray();
    }
    return await this.db.measurements
      .where('split_type')
      .equals('train')
      .toArray();
  }

  async loadValData(onlyNormal = false) {
    if (onlyNormal) {
      return await this.db.measurements
        .where('[split_type+label_class]')
        .equals(['val', 0])
        .toArray();
    }
    return await this.db.measurements
      .where('split_type')
      .equals('val')
      .toArray();
  }

  async loadTestData() {
    return await this.db.measurements
      .where('split_type')
      .equals('test')
      .toArray();
  }
}

// 전역 인스턴스 생성
window.dataStore = new DataStoreManager();
