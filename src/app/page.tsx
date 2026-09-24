'use client';

import { useState } from 'react';

type ImageResult = {
  url: string;
  originalSize: number;
  compressedSize: number;
  savings: number;
  savingsPercent: number;
  format: string;
};

type AnalyzeResponse = {
  success?: boolean;
  error?: string;
  url?: string;
  totalImagesFound?: number;
  processedImages?: number;
  images?: ImageResult[];
};

export default function Home() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState('');

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setIsLoading(true);
    setError('');
    setData(null);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || '분석 중 오류가 발생했습니다.');
      }

      setData(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate totals
  const totalOriginal = data?.images?.reduce((sum, img) => sum + img.originalSize, 0) || 0;
  const totalCompressed = data?.images?.reduce((sum, img) => sum + img.compressedSize, 0) || 0;
  const totalSavings = totalOriginal - totalCompressed;
  const totalSavingsPercent = totalOriginal > 0 ? (totalSavings / totalOriginal) * 100 : 0;

  return (
    <div className="container">
      <header className="header fade-in">
        <h1>Image Opti-Analyzer</h1>
        <p>URL을 입력하여 숨겨진 이미지 용량 다이어트 가능성을 확인해보세요.</p>
      </header>

      <main>
        <form onSubmit={handleAnalyze} className="url-form fade-in" style={{ animationDelay: '0.1s' }}>
          <input
            type="url"
            className="url-input"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <button type="submit" className="analyze-btn" disabled={isLoading}>
            {isLoading ? '분석 중...' : '분석 시작'}
          </button>
        </form>

        {error && (
          <div className="error-message fade-in">
            {error}
          </div>
        )}

        {isLoading && (
          <div className="loader-container fade-in">
            <div className="spinner"></div>
            <p>이미지를 수집하고 압축 시뮬레이션을 진행하고 있습니다...</p>
          </div>
        )}

        {data && !isLoading && (
          <div className="results-container fade-in" style={{ animationDelay: '0.2s' }}>
            <div className="results-summary glass">
              <div className="summary-item">
                <h3>총 이미지</h3>
                <p>{data.processedImages}개</p>
              </div>
              <div className="summary-item">
                <h3>현재 용량</h3>
                <p>{formatBytes(totalOriginal)}</p>
              </div>
              <div className="summary-item savings">
                <h3>절약 가능</h3>
                <p>{formatBytes(totalSavings)}</p>
              </div>
              <div className="summary-item savings">
                <h3>절감률</h3>
                <p>{totalSavingsPercent.toFixed(1)}%</p>
              </div>
            </div>

            {data.images && data.images.length > 0 ? (
              <div className="image-grid">
                {data.images.sort((a,b) => b.savings - a.savings).map((img, idx) => (
                  <div key={idx} className="image-card glass">
                    <div className="img-preview-container">
                      {/* 외부 이미지(네이버 등)의 핫링킹 차단을 우회하기 위해 referrerPolicy 추가 */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <a href={img.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', width: '100%', height: '100%' }}>
                        <img src={img.url} alt="Analyzed" className="img-preview" loading="lazy" referrerPolicy="no-referrer" />
                      </a>
                    </div>
                    <div className="card-details">
                      <div className="url-text" title={img.url}>{img.url}</div>
                      
                      <div className="stats-row">
                        <span>원본 크기</span>
                        <span>{formatBytes(img.originalSize)}</span>
                      </div>
                      <div className="stats-row">
                        <span>압축 후 (WebP)</span>
                        <span>{formatBytes(img.compressedSize)}</span>
                      </div>
                      
                      {img.savingsPercent > 0 ? (
                        <div className="savings-badge">
                          {img.savingsPercent}% ({formatBytes(img.savings)}) 절약!
                        </div>
                      ) : (
                        <div className="savings-badge" style={{ background: 'rgba(148, 163, 184, 0.2)', color: '#94a3b8' }}>
                          최적화 됨
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass" style={{ padding: '2rem', textAlign: 'center' }}>
                <p>분석할 수 있는 적절한 크기의 이미지를 찾지 못했습니다.</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
